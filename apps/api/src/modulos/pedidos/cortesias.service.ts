import { Inject, Injectable } from '@nestjs/common';
import type { CortesiaEntrada, CortesiaRespuesta } from '@restaurante/contratos';
import { multiplicarMonto } from '@restaurante/dominio/caja';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SesionActual, UsuariosConsultaService, exigirObjetivo } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import {
  cuentaDeDatos,
  descuentoQueNoSeAdmite,
  leerDatosDeCuenta,
  personasDeCuenta,
  respuestasDeCuenta,
  type CortesiaGuardada,
  type DatosDeCuenta,
} from './cuenta-de-orden';
import {
  conflictoDeCuenta,
  cortesiaInvalida,
  cuentaEnCobro,
  descuentoNoAdmitido,
  idDeClienteReutilizado,
  ordenNoEncontrada,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { cambiarLaCuenta } from './precuenta-invalidacion';
import { huellaDeCortesia } from './replica';

interface FilaCortesiaPrevia {
  id: string;
  orden_id: string;
  huella_entrada: Buffer;
}

/**
 * Cortesías (historia 006, criterios 43 a 46 y 45a; ruta crítica P5): unidades de un ítem ya enviado que no se
 * cobran. Como los descuentos: la clave atada al ítem y a la cantidad exactas, la orden bloqueada, solo antes de
 * cobrar, y la versión, la pre-cuenta, la auditoría y los eventos al confirmar. Las cortesías descuentan stock
 * porque el ítem ya se envió (B.7): no hay nada nuevo que llamar.
 */
@Injectable()
export class CortesiasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
  ) {}

  async aplicar(ordenId: string, entrada: CortesiaEntrada): Promise<CortesiaRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const id = entrada.id.toLowerCase();
    const itemId = entrada.itemId.toLowerCase();
    const autorizacion = this.sesion.autorizacionConsumida();

    // La clave vale solo para esta cuenta, este ítem y esta cantidad (criterio 43).
    exigirObjetivo(autorizacion, {
      tipo: 'CORTESIA',
      ordenId: ordenId.toLowerCase(),
      itemId,
      cantidad: entrada.cantidad,
    });

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);

    // Réplica por el id de la cortesía: antes del estado de la orden.
    const huella = huellaDeCortesia({ itemId, cantidad: entrada.cantidad });
    const previas = await this.conexion.query<FilaCortesiaPrevia>(
      'SELECT id, orden_id, huella_entrada FROM cortesia WHERE id = $1',
      { bind: [id], type: QueryTypes.SELECT },
    );
    const previa = previas[0];
    if (previa !== undefined) {
      if (previa.orden_id !== orden.id || !previa.huella_entrada.equals(huella)) {
        throw idDeClienteReutilizado();
      }
      return this.respuestaDe(orden.id, id);
    }

    exigirOrdenAbierta(orden);
    await this.exigirSinCobros(orden.id);

    const datos = await leerDatosDeCuenta(this.conexion, orden.id);
    const item = datos.items.find((i) => i.id === itemId);
    if (item === undefined) {
      // Un ítem de otra orden o inexistente es 404; uno de esta orden que se anuló del todo, 409.
      const existe = await this.conexion.query(
        'SELECT 1 FROM item WHERE id = $1 AND orden_id = $2',
        {
          bind: [itemId, orden.id],
          type: QueryTypes.SELECT,
        },
      );
      if (existe.length === 0) throw ordenNoEncontrada();
      throw conflictoDeCuenta('El ítem está anulado: no admite cortesía');
    }
    if (datos.cortesias.some((c) => c.itemId === itemId)) {
      throw conflictoDeCuenta('El ítem ya tiene una cortesía: quítala antes de dar otra');
    }
    if (datos.descuentosDeItem.some((d) => d.itemId === itemId)) {
      throw conflictoDeCuenta('El ítem tiene un descuento: quítalo antes de dar la cortesía');
    }
    if (item.aplicaIcbper) {
      throw cortesiaInvalida('Un producto con ICBPER no admite cortesía');
    }
    if (entrada.cantidad > item.cantidad) {
      throw cortesiaInvalida(
        `La cantidad supera las ${item.cantidad} unidades vigentes del ítem`,
        'cantidad',
      );
    }

    // Una cortesía reduce la base del descuento de la cuenta: ese debe seguir cabiendo (criterio 45a).
    const ahora = this.reloj.ahora();
    const nueva: CortesiaGuardada = {
      id,
      itemId,
      cantidad: entrada.cantidad,
      motivo: entrada.motivo,
      autorizadoPorId: null,
      creadoEn: ahora,
      creadoPorId: null,
    };
    if (
      descuentoQueNoSeAdmite(cuentaDeDatos({ ...datos, cortesias: [...datos.cortesias, nueva] }))
    ) {
      throw descuentoNoAdmitido('dar la cortesía');
    }

    const insertada = await this.conexion.query<{ id: string }>(
      `INSERT INTO cortesia (id, empresa_id, orden_id, item_id, cantidad, motivo, autorizado_por_id,
                             autorizacion_id, huella_entrada, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING id`,
      {
        bind: [
          id,
          empresaId,
          orden.id,
          itemId,
          entrada.cantidad,
          entrada.motivo,
          autorizacion?.autorizadorId ?? null,
          autorizacion?.autorizacionId ?? null,
          huella,
          ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    // El mismo id lo guardó otra petición de otra orden mientras esta esperaba: no es una réplica.
    if (insertada.length === 0) throw idDeClienteReutilizado();

    const respuesta = await this.respuestaDe(orden.id, id);
    const estabaEnPrecuenta = await cambiarLaCuenta(this.conexion, orden.id, orden.estado, ahora);
    await this.auditoria.registrar({
      accion: 'aplicar_cortesia',
      entidad: 'cortesia',
      entidadId: id,
      motivo: entrada.motivo,
      autorizadoPorId: autorizacion?.autorizadorId ?? null,
      autorizacionId: autorizacion?.autorizacionId ?? null,
      detalle: {
        ordenId: orden.id,
        itemId,
        nombre: item.nombre,
        cantidad: entrada.cantidad,
        valorReferencial: respuesta.valorReferencial,
      },
    });
    await this.publicar(sucursalId, orden.id, estabaEnPrecuenta);
    return respuesta;
  }

  /** Quita una cortesía sin borrar la fila (criterio 43): sin clave, auditado; repetirlo responde igual sin efecto. */
  async quitar(ordenId: string, cortesiaId: string): Promise<void> {
    const sucursalId = this.sesion.sucursalActiva();
    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    const id = cortesiaId.toLowerCase();

    const filas = await this.conexion.query<{
      quitada_en: Date | null;
      motivo: string;
      item_id: string;
      cantidad: number;
    }>(
      `SELECT c.quitada_en, c.motivo, c.item_id, c.cantidad
         FROM cortesia c JOIN item i ON i.id = c.item_id AND i.empresa_id = c.empresa_id
        WHERE c.id = $1 AND i.orden_id = $2
          FOR UPDATE OF c`,
      { bind: [id, orden.id], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La cortesía no existe');
    if (fila.quitada_en !== null) return;

    exigirOrdenAbierta(orden);
    await this.exigirSinCobros(orden.id);

    const [item] = await this.conexion.query<{ nombre: string; precio_unitario: string }>(
      'SELECT nombre, precio_unitario::text AS precio_unitario FROM item WHERE id = $1',
      { bind: [fila.item_id], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora();
    await this.conexion.query(
      `UPDATE cortesia SET quitada_en = $2, quitada_por_id = $3, actualizado_en = $2 WHERE id = $1`,
      { bind: [id, ahora, this.sesion.principal().usuarioId], type: QueryTypes.UPDATE },
    );
    const estabaEnPrecuenta = await cambiarLaCuenta(this.conexion, orden.id, orden.estado, ahora);
    await this.auditoria.registrar({
      accion: 'quitar_cortesia',
      entidad: 'cortesia',
      entidadId: id,
      motivo: fila.motivo,
      detalle: {
        ordenId: orden.id,
        itemId: fila.item_id,
        nombre: item?.nombre ?? null,
        cantidad: fila.cantidad,
        valorReferencial:
          item === undefined ? null : multiplicarMonto(item.precio_unitario, fila.cantidad),
      },
    });
    await this.publicar(sucursalId, orden.id, estabaEnPrecuenta);
  }

  // -------------------------------------------------------------------------------------------------

  /** 409 `CUENTA_EN_COBRO`: con algún cobro ya no se tocan las cortesías (criterio 45). */
  private async exigirSinCobros(ordenId: string): Promise<void> {
    const [orden] = await this.conexion.query<{ cobros: number }>(
      'SELECT cobros FROM orden WHERE id = $1',
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    if ((orden?.cobros ?? 0) > 0) throw cuentaEnCobro();
  }

  /** La respuesta de la cortesía `id` tal como está ahora (vigente, o quitada después). */
  private async respuestaDe(ordenId: string, id: string): Promise<CortesiaRespuesta> {
    const datos: DatosDeCuenta = await leerDatosDeCuenta(this.conexion, ordenId);
    const nombres = await this.usuarios.nombres(personasDeCuenta(datos));
    const vigente = respuestasDeCuenta(datos, nombres).cortesias.find((c) => c.id === id);
    if (vigente !== undefined) return vigente;
    // Quitada después: sale tal como se guardó.
    const [fila] = await this.conexion.query<{
      id: string;
      item_id: string;
      cantidad: number;
      motivo: string;
      autorizado_por_id: string | null;
      creado_en: Date;
      creado_por_usuario_id: string | null;
      precio_unitario: string;
    }>(
      `SELECT c.id, c.item_id, c.cantidad, c.motivo, c.autorizado_por_id, c.creado_en, c.creado_por_usuario_id,
              i.precio_unitario::text AS precio_unitario
         FROM cortesia c JOIN item i ON i.id = c.item_id AND i.empresa_id = c.empresa_id
        WHERE c.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    if (fila === undefined) throw ordenNoEncontrada();
    const personas = await this.usuarios.nombres(
      [fila.autorizado_por_id, fila.creado_por_usuario_id].filter((x): x is string => x !== null),
    );
    const persona = (p: string | null) =>
      p === null ? null : { id: p, nombre: personas.get(p) ?? '' };
    return {
      id: fila.id,
      itemId: fila.item_id,
      cantidad: fila.cantidad,
      valorReferencial: multiplicarMonto(fila.precio_unitario, fila.cantidad),
      motivo: fila.motivo,
      autorizadoPor: persona(fila.autorizado_por_id),
      creadoEn: new Date(fila.creado_en).toISOString(),
      creadoPor: persona(fila.creado_por_usuario_id),
    };
  }

  private async publicar(
    sucursalId: string,
    ordenId: string,
    estabaEnPrecuenta: boolean,
  ): Promise<void> {
    this.eventos.ordenCambio(sucursalId, ordenId);
    if (estabaEnPrecuenta) {
      this.eventos.salonCambio(
        sucursalId,
        ordenId,
        await mesasVigentesDeOrden(this.conexion, ordenId),
      );
    }
  }
}
