import { Inject, Injectable } from '@nestjs/common';
import {
  estadoLlamadoPublicoSchema,
  mesaPublicaSchema,
  type EstadoLlamadoPublico,
  type LlamadoDetalle,
  type LlamadosRespuesta,
  type MesaPublica,
} from '@restaurante/contratos';
import { aceptaLlamados, estadoVigenteLlamado, type EstadoLlamado } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ContextoPublico, cartaNoDisponible } from '../carta-web';
import { PedidosConsultaService } from '../pedidos';
import { SucursalesConsultaService } from '../plataforma';
import { ResolucionMesa } from './resolucion-mesa';

/** `uuid` en cualquier caja, como lo manda el navegador. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lecturas de los llamados (historia 005, criterios 25, 38, 39 y 40): la mesa pública, el estado para el cliente,
 * la lista del mozo y el detalle con la revisión. El vencimiento se calcula al leer con el reloj de la API
 * (criterio 54). La lista y el detalle del mozo llegan en la fase C3 (T12).
 */
@Injectable()
export class VistaLlamadosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoPublico) private readonly publico: ContextoPublico,
    @Inject(ResolucionMesa) private readonly mesas: ResolucionMesa,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * `GET /publico/mesas/:codigo` (criterio 25): el nombre de la mesa, las direcciones de su carta, si acepta llamados
   * (horario, criterio 35) y el llamado pendiente vigente. No dice si la mesa está ocupada, ni el mozo, la cuenta o
   * lo consumido (pregunta 2).
   */
  async mesaPublica(codigo: string): Promise<MesaPublica> {
    return this.publico.porCodigoDeMesa(codigo, async () => {
      const mesa = await this.mesas.resolver(codigo);
      const ahora = this.reloj.ahora();
      const datos = await this.sucursales.datosPublicos([mesa.sucursalId]);
      const ordenes = await this.pedidos.ordenesVigentesDeMesas([mesa.mesaId]);
      const pendientes = await this.conexion.query<{
        tipo: 'PEDIDO' | 'LLAMAR_MOZO' | 'PEDIR_CUENTA';
        vence_en: Date;
      }>(`SELECT tipo, vence_en FROM llamado WHERE mesa_id = $1 AND estado = 'PENDIENTE'`, {
        bind: [mesa.mesaId],
        type: QueryTypes.SELECT,
      });
      const horario = datos.get(mesa.sucursalId)?.horario ?? [];
      const acepta = aceptaLlamados({ horario, ahora, mesaConCuenta: ordenes.has(mesa.mesaId) });
      const pendiente = pendientes.find(
        (p) =>
          estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn: new Date(p.vence_en) }, ahora) ===
          'PENDIENTE',
      );
      return mesaPublicaSchema.parse({
        mesa: { nombre: mesa.mesaNombre },
        carta: { empresaSlug: mesa.empresaSlug, sucursalSlug: mesa.sucursalSlug },
        aceptaLlamados: acepta,
        motivoNoAcepta: acepta ? null : 'FUERA_DE_HORARIO',
        llamadoPendiente:
          pendiente === undefined
            ? null
            : { tipo: pendiente.tipo, venceEn: new Date(pendiente.vence_en).toISOString() },
      });
    });
  }

  /**
   * `GET /publico/mesas/:codigo/llamados/:id` (criterio 38): el estado vigente (`VENCIDO` si está `PENDIENTE` y ya
   * pasó `venceEn`), sin nombres de personas. Un llamado de otra mesa (aunque sea de la misma sucursal), de otra
   * empresa o inexistente, o un código reemplazado, responde el mismo 404 de siempre.
   */
  async estadoPublico(codigo: string, llamadoId: string): Promise<EstadoLlamadoPublico> {
    if (typeof llamadoId !== 'string' || !FORMA_UUID.test(llamadoId)) throw cartaNoDisponible();
    return this.publico.porCodigoDeMesa(codigo, async () => {
      const mesa = await this.mesas.resolver(codigo);
      const ahora = this.reloj.ahora();
      const filas = await this.conexion.query<{
        id: string;
        tipo: 'PEDIDO' | 'LLAMAR_MOZO' | 'PEDIR_CUENTA';
        estado: EstadoLlamado;
        vence_en: Date;
      }>(`SELECT id, tipo, estado, vence_en FROM llamado WHERE id = $1 AND mesa_id = $2`, {
        bind: [llamadoId.toLowerCase(), mesa.mesaId],
        type: QueryTypes.SELECT,
      });
      const fila = filas[0];
      if (fila === undefined) throw cartaNoDisponible();
      const venceEn = new Date(fila.vence_en);
      return estadoLlamadoPublicoSchema.parse({
        id: fila.id,
        tipo: fila.tipo,
        estado: estadoVigenteLlamado({ estado: fila.estado, venceEn }, ahora),
        venceEn: venceEn.toISOString(),
      });
    });
  }

  /** `GET /llamados` (criterio 39), de la sucursal activa. FIRMA: la implementación llega en la fase C3 (T12). */
  async lista(): Promise<LlamadosRespuesta> {
    throw new Error('No implementado');
  }

  /** `GET /llamados/:id` (criterio 40), con la revisión de cada línea. FIRMA: llega en la fase C3 (T12). */
  async detalle(llamadoId: string): Promise<LlamadoDetalle> {
    void llamadoId;
    throw new Error('No implementado');
  }
}
