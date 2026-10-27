import { Inject, Injectable } from '@nestjs/common';
import type {
  AvisoSuscripcion,
  ConsumoPeriodo,
  PagoEntrada,
  PagoRespuesta,
  SuscripcionRespuesta,
  SuscripcionResumen,
} from '@restaurante/contratos';
import {
  MODULOS,
  estadoSuscripcion,
  fechaLima,
  periodoLima,
  sumarMeses,
  type Modulo,
  type ResultadoEstadoSuscripcion,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';

/** Estado calculado de la suscripción de una sucursal con el reloj de la API. */
export interface EstadoDeSucursal extends ResultadoEstadoSuscripcion {
  sucursalId: string;
  planId: string;
  /** Último día activo (`AAAA-MM-DD`, fecha de Lima). */
  vencimiento: string;
}

/** Resultado de contar un comprobante emitido (criterio 78); `cuota` es `null` si el plan no la define. */
export interface ConsumoRegistrado {
  /** Mes de Lima (`AAAA-MM`). */
  periodo: string;
  emitidos: number;
  cuota: number | null;
  /** `max(0, emitidos − cuota)`; 0 si no hay cuota. */
  excedente: number;
}

/** Plan con el que nace una suscripción (ya validado: existe y está activo). */
export interface PlanDeSuscripcion {
  id: string;
  codigo: string;
  nombre: string;
  diasGracia: number;
}

/** Datos para crear la suscripción de una sucursal en una operación de plataforma. */
export interface DatosSuscripcionNueva {
  empresaId: string;
  sucursalId: string;
  plan: PlanDeSuscripcion;
  /** `AAAA-MM-DD`. */
  vencimiento: string;
  ahora: Date;
}

interface FilaSuscripcion {
  id: string;
  empresa_id: string;
  sucursal_id: string;
  vencimiento: string;
  plan_id: string;
  plan_codigo: string;
  plan_nombre: string;
  dias_gracia: number;
}

interface FilaAviso extends FilaSuscripcion {
  sucursal_nombre: string;
}

/**
 * `avisoSuscripcion` (criterio 80) con las sucursales en gracia o suspendidas en `ahora`, en el orden
 * recibido; `null` si todas están `ACTIVA`.
 */
function aAviso(filas: FilaAviso[], ahora: Date): AvisoSuscripcion | null {
  const sucursales: AvisoSuscripcion['sucursales'] = [];
  for (const fila of filas) {
    const estado = estadoSuscripcion(
      { vencimiento: fila.vencimiento, diasGracia: fila.dias_gracia },
      ahora,
    );
    if (estado.estado === 'ACTIVA') continue;
    sucursales.push({
      sucursalId: fila.sucursal_id,
      nombre: fila.sucursal_nombre,
      estado: estado.estado,
      vencimiento: fila.vencimiento,
      suspensionDesde: estado.suspensionDesde,
      diasRestantesGracia: estado.diasRestantesGracia,
    });
  }
  return sucursales.length === 0 ? null : { sucursales };
}

const SQL_AVISOS = `SELECT s.id, s.empresa_id, s.sucursal_id, s.vencimiento::text AS vencimiento,
       p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.dias_gracia,
       su.nombre AS sucursal_nombre
  FROM suscripcion s
  JOIN plan p ON p.id = s.plan_id
  JOIN sucursal su ON su.id = s.sucursal_id AND su.empresa_id = s.empresa_id
 WHERE s.empresa_id = $1
 ORDER BY su.nombre, su.id`;

const SQL_SUSCRIPCION = `SELECT s.id, s.empresa_id, s.sucursal_id, s.vencimiento::text AS vencimiento,
       p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.dias_gracia
  FROM suscripcion s
  JOIN plan p ON p.id = s.plan_id`;

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/** `suscripcionRespuesta` de una fila, con el estado calculado en `ahora` (nunca se guarda). */
function aRespuesta(fila: FilaSuscripcion, ahora: Date): SuscripcionRespuesta {
  const estado = estadoSuscripcion(
    { vencimiento: fila.vencimiento, diasGracia: fila.dias_gracia },
    ahora,
  );
  return {
    id: fila.id,
    empresaId: fila.empresa_id,
    sucursalId: fila.sucursal_id,
    plan: { id: fila.plan_id, codigo: fila.plan_codigo, nombre: fila.plan_nombre },
    vencimiento: fila.vencimiento,
    estado: estado.estado,
    suspensionDesde: estado.suspensionDesde,
    diasRestantesGracia: estado.diasRestantesGracia,
  };
}

/** Consumo de un periodo con la cuota del plan vigente (criterios 78 y 79). */
function consumoDe(periodo: string, emitidos: number, cuota: number | null): ConsumoPeriodo {
  return {
    periodo,
    emitidos,
    cuota,
    excedente: cuota === null ? 0 : Math.max(0, emitidos - cuota),
  };
}

const suscripcionNoEncontrada = () =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La suscripción no existe');

/**
 * Único lector y escritor de `suscripcion`, `pago_suscripcion` y `consumo_comprobantes` (y lector de
 * `plan`; `PlanesService` es quien lo escribe). RF-03 a RF-06. Tiene dos juegos de métodos:
 *
 * - **Con contexto de empresa** (los que usan las demás historias: caja, facturación, sesión, módulos):
 *   `estadoDeSucursal`, `exigirAperturaDeCaja`, `registrarComprobanteEmitido`, `modulosDeSucursal` y
 *   `crearParaSucursal`. Corren por la conexión de la API, bajo RLS, dentro de `ContextoEmpresa.ejecutar`.
 * - **Con la transacción de una operación de plataforma** (alta de empresas y sucursales, consultas,
 *   pagos y cambios del superadministrador): reciben la transacción de `OperacionPlataforma`, que ya
 *   fijó su actor.
 *
 * El estado no se guarda: se calcula con `estadoSuscripcion` y el reloj de la API (criterio 71).
 * Los montos se guardan en `NUMERIC` y viajan como texto; este servicio no los suma.
 */
@Injectable()
export class SuscripcionService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  // ---- Con contexto de empresa -----------------------------------------------------------------

  /** Estado de la sucursal con el reloj de la API; debe llamarse dentro de un contexto de empresa. */
  async estadoDeSucursal(sucursalId: string): Promise<EstadoDeSucursal> {
    const filas = await this.conexion.query<FilaSuscripcion>(
      `${SQL_SUSCRIPCION} WHERE s.sucursal_id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) {
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no tiene suscripción');
    }
    const estado = estadoSuscripcion(
      { vencimiento: fila.vencimiento, diasGracia: fila.dias_gracia },
      this.reloj.ahora(),
    );
    return { ...estado, sucursalId, planId: fila.plan_id, vencimiento: fila.vencimiento };
  }

  /**
   * No lanza si la sucursal está `ACTIVA` o `EN_GRACIA`; lanza 403 `SUCURSAL_SUSPENDIDA` si está
   * `SUSPENDIDA` (criterio 81), evaluado con el reloj de la API en ese momento. La llama solo la apertura
   * de caja (criterio 84): ninguna otra operación consulta el estado de la suscripción.
   */
  async exigirAperturaDeCaja(sucursalId: string): Promise<void> {
    const estado = await this.estadoDeSucursal(sucursalId);
    if (estado.estado === 'SUSPENDIDA') {
      throw new ErrorAplicacion(
        403,
        'SUCURSAL_SUSPENDIDA',
        'La sucursal está suspendida por falta de pago: no se puede abrir caja',
      );
    }
  }

  /**
   * Aviso para el Administrador (criterio 80): las sucursales de la empresa del contexto en gracia o
   * suspendidas, o `null` si todas están `ACTIVA`. Corre bajo RLS dentro de un contexto de empresa.
   */
  async avisoDeEmpresa(): Promise<AvisoSuscripcion | null> {
    const filas = await this.conexion.query<FilaAviso>(SQL_AVISOS, {
      bind: [this.contexto.empresaActual()],
      type: QueryTypes.SELECT,
    });
    return aAviso(filas, this.reloj.ahora());
  }

  /** Lo mismo que `avisoDeEmpresa` para la sesión de soporte, que abre la plataforma (sin contexto). */
  async avisoPlataforma(
    transaccion: Transaction,
    empresaId: string,
    ahora: Date,
  ): Promise<AvisoSuscripcion | null> {
    const filas = await sequelizeDe(transaccion).query<FilaAviso>(SQL_AVISOS, {
      transaction: transaccion,
      bind: [empresaId],
      type: QueryTypes.SELECT,
    });
    return aAviso(filas, ahora);
  }

  /**
   * Suma 1 al consumo del mes de Lima de `instante` dentro del contexto de empresa; nunca lanza por
   * superar la cuota (criterio 78). La llama la emisión de cada comprobante, en su misma transacción. La
   * cuota es la del plan que tiene la suscripción en este momento (criterio 79). Con `INSERT … ON
   * CONFLICT … DO UPDATE` dos llamadas concurrentes no pierden incrementos.
   */
  async registrarComprobanteEmitido(
    sucursalId: string,
    instante: Date,
  ): Promise<ConsumoRegistrado> {
    const periodo = periodoLima(instante);
    const ahora = this.reloj.ahora();
    let emitidos: number;
    try {
      const filas = await this.conexion.query<{ emitidos: number }>(
        `INSERT INTO consumo_comprobantes (empresa_id, sucursal_id, periodo, emitidos, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, $4, $4)
         ON CONFLICT (sucursal_id, periodo)
         DO UPDATE SET emitidos = consumo_comprobantes.emitidos + 1, actualizado_en = EXCLUDED.actualizado_en
         RETURNING emitidos`,
        {
          bind: [this.contexto.empresaActual(), sucursalId, periodo, ahora],
          type: QueryTypes.SELECT,
        },
      );
      emitidos = filas[0]!.emitidos;
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_LLAVE_FORANEA) {
        throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
      }
      throw error;
    }
    const cuotas = await this.conexion.query<{ cuota: number | null }>(
      `SELECT p.cuota_comprobantes_mes AS cuota
         FROM suscripcion s JOIN plan p ON p.id = s.plan_id
        WHERE s.sucursal_id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return consumoDe(periodo, emitidos, cuotas[0]?.cuota ?? null);
  }

  /**
   * Módulos del plan de la sucursal (criterio 77); vacío si la sucursal no tiene suscripción. Los toma
   * del plan vigente, así que un cambio de plan rige desde la siguiente consulta.
   */
  async modulosDeSucursal(sucursalId: string): Promise<Modulo[]> {
    const filas = await this.conexion.query<{ modulos: string[] }>(
      `SELECT p.modulos FROM suscripcion s JOIN plan p ON p.id = s.plan_id WHERE s.sucursal_id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return soloModulos(filas[0]?.modulos);
  }

  /**
   * Suscripción de una sucursal que crea el Administrador (`POST /sucursales`, criterio 70): plan por
   * defecto y vencimiento el día del alta (fecha de Lima). Dentro del contexto de empresa de la petición.
   */
  async crearParaSucursal(sucursalId: string): Promise<{
    id: string;
    planId: string;
    vencimiento: string;
  }> {
    const planes = await this.conexion.query<{ id: string }>(
      'SELECT id FROM plan WHERE por_defecto AND activo',
      { type: QueryTypes.SELECT },
    );
    const plan = planes[0];
    if (plan === undefined) {
      throw new ErrorAplicacion(422, 'PLAN_INVALIDO', 'No hay un plan por defecto activo');
    }
    const ahora = this.reloj.ahora();
    const vencimiento = fechaLima(ahora);
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO suscripcion (empresa_id, sucursal_id, plan_id, vencimiento, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id`,
      {
        bind: [this.contexto.empresaActual(), sucursalId, plan.id, vencimiento, ahora],
        type: QueryTypes.SELECT,
      },
    );
    return { id: filas[0]!.id, planId: plan.id, vencimiento };
  }

  // ---- Con la transacción de una operación de plataforma ---------------------------------------

  /** Crea la suscripción de una sucursal recién creada por la vía de plataforma (criterio 69). */
  async crear(
    transaccion: Transaction,
    datos: DatosSuscripcionNueva,
  ): Promise<SuscripcionRespuesta> {
    const filas = await sequelizeDe(transaccion).query<{ id: string }>(
      `INSERT INTO suscripcion (empresa_id, sucursal_id, plan_id, vencimiento, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id`,
      {
        transaction: transaccion,
        bind: [datos.empresaId, datos.sucursalId, datos.plan.id, datos.vencimiento, datos.ahora],
        type: QueryTypes.SELECT,
      },
    );
    return aRespuesta(
      {
        id: filas[0]!.id,
        empresa_id: datos.empresaId,
        sucursal_id: datos.sucursalId,
        vencimiento: datos.vencimiento,
        plan_id: datos.plan.id,
        plan_codigo: datos.plan.codigo,
        plan_nombre: datos.plan.nombre,
        dias_gracia: datos.plan.diasGracia,
      },
      datos.ahora,
    );
  }

  /** Vencimiento por defecto de una sucursal nueva: un mes desde hoy (fecha de Lima, criterio 69). */
  vencimientoPorDefecto(ahora: Date): string {
    return sumarMeses(fechaLima(ahora), 1);
  }

  /** Las suscripciones de las sucursales de las empresas indicadas (todas si no se indica), por sucursal. */
  async porSucursal(
    transaccion: Transaction,
    empresaIds: string[] | null,
    ahora: Date,
  ): Promise<Map<string, SuscripcionRespuesta>> {
    const filas = await sequelizeDe(transaccion).query<FilaSuscripcion>(
      empresaIds === null
        ? SQL_SUSCRIPCION
        : `${SQL_SUSCRIPCION} WHERE s.empresa_id = ANY($1::uuid[])`,
      {
        transaction: transaccion,
        type: QueryTypes.SELECT,
        ...(empresaIds === null ? {} : { bind: [empresaIds] }),
      },
    );
    return new Map(filas.map((f) => [f.sucursal_id, aRespuesta(f, ahora)]));
  }

  /** Módulos del plan de una sucursal, para la sesión de soporte (que abre la plataforma). */
  async modulosPlataforma(transaccion: Transaction, sucursalId: string): Promise<Modulo[]> {
    const filas = await sequelizeDe(transaccion).query<{ modulos: string[] }>(
      `SELECT p.modulos FROM suscripcion s JOIN plan p ON p.id = s.plan_id WHERE s.sucursal_id = $1`,
      { transaction: transaccion, bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return soloModulos(filas[0]?.modulos);
  }

  /**
   * `GET /plataforma/suscripciones` (criterio 76): una fila por sucursal con empresa, plan, vencimiento,
   * estado calculado y el consumo del mes de Lima actual y del anterior con su excedente (cuota del plan
   * vigente). `estado` filtra por el estado calculado.
   */
  async listar(
    transaccion: Transaction,
    ahora: Date,
    estado: SuscripcionRespuesta['estado'] | undefined,
  ): Promise<SuscripcionResumen[]> {
    const sequelize = sequelizeDe(transaccion);
    const filas = await sequelize.query<
      FilaSuscripcion & {
        cuota: number | null;
        empresa_nombre: string;
        sucursal_nombre: string;
      }
    >(
      `SELECT s.id, s.empresa_id, s.sucursal_id, s.vencimiento::text AS vencimiento,
              p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.dias_gracia,
              p.cuota_comprobantes_mes AS cuota, e.nombre AS empresa_nombre, su.nombre AS sucursal_nombre
         FROM suscripcion s
         JOIN plan p ON p.id = s.plan_id
         JOIN empresa e ON e.id = s.empresa_id
         JOIN sucursal su ON su.id = s.sucursal_id AND su.empresa_id = s.empresa_id
        ORDER BY e.nombre, su.nombre, s.id`,
      { transaction: transaccion, type: QueryTypes.SELECT },
    );
    const actual = periodoLima(ahora);
    const anterior = sumarMeses(`${actual}-01`, -1).slice(0, 7);
    const consumos = await sequelize.query<{
      sucursal_id: string;
      periodo: string;
      emitidos: number;
    }>(
      `SELECT sucursal_id, periodo::text AS periodo, emitidos
         FROM consumo_comprobantes WHERE periodo = ANY($1::text[])`,
      { transaction: transaccion, bind: [[actual, anterior]], type: QueryTypes.SELECT },
    );
    const emitidosEn = (sucursalId: string, periodo: string) =>
      consumos.find((c) => c.sucursal_id === sucursalId && c.periodo === periodo)?.emitidos ?? 0;

    const resumenes: SuscripcionResumen[] = [];
    for (const fila of filas) {
      const base = aRespuesta(fila, ahora);
      if (estado !== undefined && base.estado !== estado) continue;
      resumenes.push({
        ...base,
        empresaNombre: fila.empresa_nombre,
        sucursalNombre: fila.sucursal_nombre,
        consumoMesActual: consumoDe(actual, emitidosEn(fila.sucursal_id, actual), fila.cuota),
        consumoMesAnterior: consumoDe(anterior, emitidosEn(fila.sucursal_id, anterior), fila.cuota),
      });
    }
    return resumenes;
  }

  /** La suscripción con la fila bloqueada (`FOR UPDATE`) dentro de la operación; 404 si no existe. */
  private async bloquear(transaccion: Transaction, id: string): Promise<FilaSuscripcion> {
    const filas = await sequelizeDe(transaccion).query<FilaSuscripcion>(
      `${SQL_SUSCRIPCION} WHERE s.id = $1 FOR UPDATE OF s`,
      { transaction: transaccion, bind: [id.toLowerCase()], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) throw suscripcionNoEncontrada();
    return fila;
  }

  /**
   * `PATCH /plataforma/suscripciones/:id` (criterio 74): cambia el plan y/o fija el vencimiento a cualquier
   * fecha. Primero bloquea la suscripción (404 si no existe) y después valida el plan nuevo con
   * `elegirPlan` (422 `PLAN_INVALIDO`). Devuelve la suscripción nueva y los valores de antes y después
   * para la auditoría.
   */
  async modificar(
    transaccion: Transaction,
    id: string,
    cambios: { planId?: string; vencimiento?: string },
    elegirPlan: (planId: string) => Promise<PlanDeSuscripcion>,
    ahora: Date,
  ): Promise<{
    suscripcion: SuscripcionRespuesta;
    antes: { empresaId: string; sucursalId: string; planId: string; vencimiento: string };
    despues: { planId: string; vencimiento: string };
  }> {
    const fila = await this.bloquear(transaccion, id);
    const plan = cambios.planId === undefined ? undefined : await elegirPlan(cambios.planId);
    const nueva: FilaSuscripcion = {
      ...fila,
      ...(plan === undefined
        ? {}
        : {
            plan_id: plan.id,
            plan_codigo: plan.codigo,
            plan_nombre: plan.nombre,
            dias_gracia: plan.diasGracia,
          }),
      ...(cambios.vencimiento === undefined ? {} : { vencimiento: cambios.vencimiento }),
    };
    await sequelizeDe(transaccion).query(
      'UPDATE suscripcion SET plan_id = $2, vencimiento = $3, actualizado_en = $4 WHERE id = $1',
      { transaction: transaccion, bind: [fila.id, nueva.plan_id, nueva.vencimiento, ahora] },
    );
    return {
      suscripcion: aRespuesta(nueva, ahora),
      antes: {
        empresaId: fila.empresa_id,
        sucursalId: fila.sucursal_id,
        planId: fila.plan_id,
        vencimiento: fila.vencimiento,
      },
      despues: { planId: nueva.plan_id, vencimiento: nueva.vencimiento },
    };
  }

  /**
   * `POST /plataforma/suscripciones/:id/pagos` (criterio 73): con la suscripción bloqueada (`SELECT … FOR
   * UPDATE`) comprueba que `vencimientoNuevo` sea posterior al vencimiento actual, guarda el pago (con el
   * vencimiento anterior y el nuevo; no se edita ni se borra) y mueve el vencimiento.
   */
  async registrarPago(
    transaccion: Transaction,
    id: string,
    entrada: PagoEntrada,
    ahora: Date,
  ): Promise<{ pago: PagoRespuesta; suscripcion: SuscripcionRespuesta }> {
    const fila = await this.bloquear(transaccion, id);
    if (entrada.vencimientoNuevo <= fila.vencimiento) {
      throw new ErrorAplicacion(
        400,
        'DATOS_INVALIDOS',
        'El vencimiento nuevo debe ser posterior al vencimiento actual',
        [
          {
            campo: 'vencimientoNuevo',
            mensaje: `Debe ser posterior al vencimiento actual (${fila.vencimiento})`,
          },
        ],
      );
    }
    const sequelize = sequelizeDe(transaccion);
    const pagos = await sequelize.query<{
      id: string;
      monto: string;
      fecha_pago: string;
      referencia: string | null;
      creado_en: Date;
    }>(
      `INSERT INTO pago_suscripcion (empresa_id, suscripcion_id, monto, fecha_pago, medio, referencia,
                                     vencimiento_anterior, vencimiento_nuevo, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, monto::text AS monto, fecha_pago::text AS fecha_pago, referencia, creado_en`,
      {
        transaction: transaccion,
        type: QueryTypes.SELECT,
        bind: [
          fila.empresa_id,
          fila.id,
          entrada.monto,
          entrada.fechaPago,
          entrada.medio,
          entrada.referencia ?? null,
          fila.vencimiento,
          entrada.vencimientoNuevo,
          ahora,
        ],
      },
    );
    const pago = pagos[0]!;
    await sequelize.query(
      'UPDATE suscripcion SET vencimiento = $2, actualizado_en = $3 WHERE id = $1',
      {
        transaction: transaccion,
        bind: [fila.id, entrada.vencimientoNuevo, ahora],
      },
    );
    return {
      pago: {
        id: pago.id,
        suscripcionId: fila.id,
        monto: pago.monto,
        fechaPago: pago.fecha_pago,
        medio: entrada.medio,
        referencia: pago.referencia,
        vencimientoAnterior: fila.vencimiento,
        vencimientoNuevo: entrada.vencimientoNuevo,
        creadoEn: pago.creado_en.toISOString(),
      },
      suscripcion: aRespuesta({ ...fila, vencimiento: entrada.vencimientoNuevo }, ahora),
    };
  }
}

/** Los módulos del catálogo (en el orden del catálogo); lo que no esté en él se descarta. */
function soloModulos(modulos: string[] | undefined): Modulo[] {
  if (modulos === undefined) return [];
  return MODULOS.filter((m) => modulos.includes(m));
}
