import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { horaLocal } from '../../nucleo/reloj';
import { CartaConsultaService } from '../carta';
import {
  documentoDeComanda,
  documentoDePrecuenta,
  type ComandaParaTicket,
  type LineaDeComanda,
} from '../impresion';
import { SucursalesConsultaService } from '../plataforma';
import { MesasConsultaService } from '../salon';
import { UsuariosConsultaService } from '../seguridad';
import type { ComandaGuardada, ComandasPorGuardar } from './comandas';
import type { TrabajoParaEncolar } from './impresion';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import type { PrecuentaRespuesta } from '@restaurante/contratos';

/**
 * Arma los trabajos de impresión de pedidos (historia 004, 3b, criterios 101, 102 y 114): el documento lógico de
 * cada comanda con destino `IMPRESORA` y el de cada pre-cuenta con impresora de caja, con las plantillas de
 * `impresion` y los datos de la orden (mesas, mozo, estación, hora). Las lecturas de otros módulos pasan por sus
 * servicios; solo se consulta la orden, que es de pedidos. Solo se llama si hay algo que imprimir: las comandas
 * que van al KDS no hacen ninguna consulta de más.
 */
@Injectable()
export class TicketsDePedidos {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(CartaConsultaService) private readonly carta: CartaConsultaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
  ) {}

  /** Un trabajo por cada comanda guardada con destino `IMPRESORA`, en el orden de las comandas. */
  async deComandas(
    entrada: ComandasPorGuardar,
    comandas: readonly ComandaGuardada[],
  ): Promise<TrabajoParaEncolar[]> {
    const aImprimir = comandas.filter((c) => c.impresoraId !== null);
    if (aImprimir.length === 0) return [];

    const mesaIds = await mesasVigentesDeOrden(this.conexion, entrada.ordenId);
    const nombresMesas = await this.mesas.nombres(mesaIds);
    const mesas = mesaIds.map((id) => nombresMesas.get(id) ?? '');
    const [orden] = await this.conexion.query<{ mozo_id: string | null }>(
      'SELECT mozo_id FROM orden WHERE id = $1',
      { bind: [entrada.ordenId], type: QueryTypes.SELECT },
    );
    const mozoId = orden?.mozo_id ?? null;
    const mozos = await this.usuarios.nombres(mozoId === null ? [] : [mozoId]);
    const mozo = mozoId === null ? '' : (mozos.get(mozoId) ?? '');
    const estaciones = await this.carta.nombres(aImprimir.map((c) => c.estacionId));
    const hora = horaLocal(entrada.ahora);

    return aImprimir.map((c) => {
      const lineas: LineaDeComanda[] = entrada.partes
        .filter((p) => p.parte.estacionId === c.estacionId)
        .map((p) => ({
          cantidad: p.cantidadFija ?? p.parte.cantidad,
          nombre: p.parte.nombre,
          contexto: p.parte.contexto,
          modificadores: p.parte.modificadores,
          observacion: p.parte.observacion,
          paraLlevar: p.parte.paraLlevar,
          esperar: p.esperar,
        }));
      const comanda: ComandaParaTicket = {
        tipo: c.tipo,
        estacion: estaciones.get(c.estacionId) ?? '',
        lineas,
        motivo: entrada.motivo ?? null,
      };
      return {
        sucursalId: entrada.sucursalId,
        impresoraId: c.impresoraId!,
        estacionId: c.estacionId,
        tipo: c.tipo,
        comandaId: c.id,
        precuentaId: null,
        mesa: mesas.join(', '),
        documento: documentoDeComanda(comanda, {
          mesas,
          mozo,
          hora,
          envioNumero: entrada.envioNumero ?? null,
        }),
      };
    });
  }

  /** El trabajo de una pre-cuenta para la impresora de caja (criterio 102). */
  async dePrecuenta(
    sucursalId: string,
    impresoraId: string,
    precuenta: PrecuentaRespuesta,
    emitidaEn: Date,
  ): Promise<TrabajoParaEncolar> {
    const [sucursal] = await this.sucursales.listar([sucursalId]);
    return {
      sucursalId,
      impresoraId,
      estacionId: null,
      tipo: 'PRECUENTA',
      comandaId: null,
      precuentaId: precuenta.id,
      mesa: precuenta.orden.mesas.map((m) => m.nombre).join(', '),
      documento: documentoDePrecuenta(precuenta, {
        sucursal: sucursal?.nombre ?? '',
        hora: horaLocal(emitidaEn),
      }),
    };
  }
}
