import { Inject, Injectable } from '@nestjs/common';
import type { DescuentoEntrada, DescuentoRespuesta } from '@restaurante/contratos';
import { validarDescuento } from '@restaurante/dominio/caja';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import {
  SesionActual,
  UsuariosConsultaService,
  exigirObjetivo,
  normalizarValor,
} from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import {
  baseDeCuenta,
  baseDeItem,
  cuentaDeDatos,
  descuentoQueNoSeAdmite,
  leerDatosDeCuenta,
  personasDeCuenta,
  respuestasDeCuenta,
  type DatosDeCuenta,
  type DescuentoGuardado,
} from './cuenta-de-orden';
import {
  conflictoDeCuenta,
  cuentaEnCobro,
  descuentoInvalido,
  descuentoNoAdmitido,
  idDeClienteReutilizado,
  ordenNoEncontrada,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { cambiarLaCuenta } from './precuenta-invalidacion';
import { huellaDeDescuento } from './replica';

interface FilaDescuentoPrevia {
  id: string;
  orden_id: string;
  huella_entrada: Buffer;
}

/**
 * Descuentos por ítem y por cuenta (historia 006, criterios 38 a 46 y 45a; ruta crítica P5). Todo corre en la
 * transacción de la petición, con la empresa y el actor de la sesión; la sucursal es siempre la activa. La clave del
 * supervisor ya la consumió `ClaveDiferidaInterceptor` en esa misma transacción: si esta operación falla después, el
 * consumo se revierte con ella (criterio 40).
 *
 * Orden de una aplicación: la clave debe ser del objetivo exacto (403); la orden se bloquea (`FOR UPDATE`: serializa
 * los descuentos con los envíos, las anulaciones, las uniones y las pre-cuentas, 404); la réplica por el `id` del
 * descuento; el estado de la orden (409), la cuenta sin cobros (409), el ítem (404 / 409) y el descuento
 * (409 `CONFLICTO`, 422 `DESCUENTO_INVALIDO`); la escritura, la versión, la pre-cuenta, la auditoría y los eventos,
 * que salen solo al confirmar.
 */
@Injectable()
export class DescuentosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
  ) {}

  async aplicar(ordenId: string, entrada: DescuentoEntrada): Promise<DescuentoRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const id = entrada.id.toLowerCase();
    const itemId = entrada.itemId === null ? null : entrada.itemId.toLowerCase();
    const valor = normalizarValor(entrada.valor);
    const autorizacion = this.sesion.autorizacionConsumida();

    // La clave vale solo para esta cuenta, este ítem y este descuento (criterio 40).
    exigirObjetivo(autorizacion, {
      tipo: 'DESCUENTO',
      ordenId: ordenId.toLowerCase(),
      itemId,
      descuento: { tipo: entrada.tipo, valor },
    });

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);

    // Réplica por el id del descuento (criterio 46): antes del estado de la orden.
    const huella = huellaDeDescuento({ itemId, tipo: entrada.tipo, valor });
    const previas = await this.conexion.query<FilaDescuentoPrevia>(
      'SELECT id, orden_id, huella_entrada FROM descuento WHERE id = $1',
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
    let base: string;
    let nombreDelItem: string | null = null;
    if (itemId === null) {
      if (datos.descuentoCuenta !== null) {
        throw conflictoDeCuenta('La cuenta ya tiene un descuento: quítalo antes de aplicar otro');
      }
      base = baseDeCuenta(cuentaDeDatos(datos));
    } else {
      const item = datos.items.find((i) => i.id === itemId);
      if (item === undefined) {
        // Un ítem de otra orden o inexistente es 404; uno de esta orden que se anuló del todo, 409.
        const existe = await this.conexion.query(
          'SELECT 1 FROM item WHERE id = $1 AND orden_id = $2',
          { bind: [itemId, orden.id], type: QueryTypes.SELECT },
        );
        if (existe.length === 0) throw ordenNoEncontrada();
        throw conflictoDeCuenta('El ítem está anulado: no admite descuento');
      }
      nombreDelItem = item.nombre;
      if (datos.descuentosDeItem.some((d) => d.itemId === itemId)) {
        throw conflictoDeCuenta('El ítem ya tiene un descuento: quítalo antes de aplicar otro');
      }
      const cortesia = datos.cortesias.find((c) => c.itemId === itemId)?.cantidad ?? 0;
      if (cortesia >= item.cantidad) {
        throw conflictoDeCuenta('El ítem está todo en cortesía: no admite descuento');
      }
      base = baseDeItem(item, cortesia);
    }

    const resultado = validarDescuento(base, { tipo: entrada.tipo, valor });
    if (!resultado.valido) throw descuentoInvalido(resultado.codigo);

    // Un descuento nuevo reduce la base del de la cuenta: ese también debe seguir cabiendo (criterio 45a).
    const nuevo: DescuentoGuardado = {
      id,
      itemId,
      tipo: entrada.tipo,
      valor,
      motivo: entrada.motivo,
      autorizadoPorId: null,
      creadoEn: this.reloj.ahora(),
      creadoPorId: null,
    };
    const conElNuevo: DatosDeCuenta =
      itemId === null
        ? { ...datos, descuentoCuenta: nuevo }
        : { ...datos, descuentosDeItem: [...datos.descuentosDeItem, nuevo] };
    if (descuentoQueNoSeAdmite(cuentaDeDatos(conElNuevo))) {
      throw descuentoNoAdmitido('aplicar otro descuento');
    }

    const ahora = this.reloj.ahora();
    const insertado = await this.conexion.query<{ id: string }>(
      `INSERT INTO descuento (id, empresa_id, orden_id, item_id, tipo, valor, motivo, autorizado_por_id,
                              autorizacion_id, huella_entrada, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $11)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING id`,
      {
        bind: [
          id,
          empresaId,
          orden.id,
          itemId,
          entrada.tipo,
          valor,
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
    if (insertado.length === 0) throw idDeClienteReutilizado();

    const respuesta = await this.respuestaDe(orden.id, id);
    const estabaEnPrecuenta = await cambiarLaCuenta(this.conexion, orden.id, orden.estado, ahora);
    await this.auditoria.registrar({
      accion: 'aplicar_descuento',
      entidad: 'descuento',
      entidadId: id,
      motivo: entrada.motivo,
      autorizadoPorId: autorizacion?.autorizadorId ?? null,
      autorizacionId: autorizacion?.autorizacionId ?? null,
      detalle: {
        ordenId: orden.id,
        itemId,
        nombre: nombreDelItem,
        tipo: entrada.tipo,
        valor,
        monto: respuesta.monto,
      },
    });
    await this.publicar(sucursalId, orden.id, estabaEnPrecuenta);
    return respuesta;
  }

  /**
   * Quita un descuento sin borrar la fila (`quitado_en`, `quitado_por_id`; criterio 42): no pide clave porque sube el
   * monto. Quitar uno que ya estaba quitado responde igual, sin efecto ni auditoría.
   */
  async quitar(ordenId: string, descuentoId: string): Promise<void> {
    const sucursalId = this.sesion.sucursalActiva();
    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    const id = descuentoId.toLowerCase();

    const filas = await this.conexion.query<{ quitado_en: Date | null; motivo: string }>(
      `SELECT d.quitado_en, d.motivo
         FROM descuento d LEFT JOIN item i ON i.id = d.item_id AND i.empresa_id = d.empresa_id
        WHERE d.id = $1 AND ((d.item_id IS NULL AND d.orden_id = $2) OR i.orden_id = $2)
          FOR UPDATE OF d`,
      { bind: [id, orden.id], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El descuento no existe');
    if (fila.quitado_en !== null) return;

    exigirOrdenAbierta(orden);
    await this.exigirSinCobros(orden.id);

    // El monto y el nombre, tal como estaba la cuenta (para la auditoría).
    const datos = await leerDatosDeCuenta(this.conexion, orden.id);
    const guardado =
      datos.descuentoCuenta?.id === id
        ? datos.descuentoCuenta
        : datos.descuentosDeItem.find((d) => d.id === id);
    const antes =
      guardado === undefined ? null : ((await this.respuestaDeDatos(datos, guardado.id)) ?? null);

    const ahora = this.reloj.ahora();
    await this.conexion.query(
      `UPDATE descuento SET quitado_en = $2, quitado_por_id = $3, actualizado_en = $2 WHERE id = $1`,
      {
        bind: [id, ahora, this.sesion.principal().usuarioId],
        type: QueryTypes.UPDATE,
      },
    );
    const estabaEnPrecuenta = await cambiarLaCuenta(this.conexion, orden.id, orden.estado, ahora);
    await this.auditoria.registrar({
      accion: 'quitar_descuento',
      entidad: 'descuento',
      entidadId: id,
      motivo: fila.motivo,
      detalle: {
        ordenId: orden.id,
        itemId: guardado?.itemId ?? null,
        nombre: datos.items.find((i) => i.id === guardado?.itemId)?.nombre ?? null,
        tipo: guardado?.tipo ?? null,
        valor: guardado?.valor ?? null,
        monto: antes?.monto ?? null,
      },
    });
    await this.publicar(sucursalId, orden.id, estabaEnPrecuenta);
  }

  // -------------------------------------------------------------------------------------------------

  /** 409 `CUENTA_EN_COBRO`: con algún cobro ya no se tocan los descuentos (criterio 45). */
  private async exigirSinCobros(ordenId: string): Promise<void> {
    const [orden] = await this.conexion.query<{ cobros: number }>(
      'SELECT cobros FROM orden WHERE id = $1',
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    if ((orden?.cobros ?? 0) > 0) throw cuentaEnCobro();
  }

  /** La respuesta del descuento `id` de la cuenta tal como está ahora; si ya no está vigente, con monto cero. */
  private async respuestaDe(ordenId: string, id: string): Promise<DescuentoRespuesta> {
    const datos = await leerDatosDeCuenta(this.conexion, ordenId);
    const respuesta = await this.respuestaDeDatos(datos, id);
    if (respuesta !== undefined) return respuesta;
    // Quitado después: sale tal como se guardó, sin monto (ya no descuenta nada).
    const [fila] = await this.conexion.query<{
      id: string;
      item_id: string | null;
      tipo: 'PORCENTAJE' | 'MONTO';
      valor: string;
      motivo: string;
      autorizado_por_id: string | null;
      creado_en: Date;
      creado_por_usuario_id: string | null;
    }>(
      `SELECT id, item_id, tipo, valor::text AS valor, motivo, autorizado_por_id, creado_en,
              creado_por_usuario_id
         FROM descuento WHERE id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    if (fila === undefined) throw ordenNoEncontrada();
    const nombres = await this.usuarios.nombres(
      [fila.autorizado_por_id, fila.creado_por_usuario_id].filter((x): x is string => x !== null),
    );
    const persona = (p: string | null) =>
      p === null ? null : { id: p, nombre: nombres.get(p) ?? '' };
    return {
      id: fila.id,
      itemId: fila.item_id,
      tipo: fila.tipo,
      valor: fila.valor,
      monto: '0.00',
      motivo: fila.motivo,
      autorizadoPor: persona(fila.autorizado_por_id),
      creadoEn: new Date(fila.creado_en).toISOString(),
      creadoPor: persona(fila.creado_por_usuario_id),
    };
  }

  private async respuestaDeDatos(
    datos: DatosDeCuenta,
    id: string,
  ): Promise<DescuentoRespuesta | undefined> {
    const nombres = await this.usuarios.nombres(personasDeCuenta(datos));
    const respuestas = respuestasDeCuenta(datos, nombres);
    if (respuestas.descuentoCuenta?.id === id) return respuestas.descuentoCuenta;
    return [...respuestas.descuentoDeItem.values()].find((d) => d.id === id);
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
