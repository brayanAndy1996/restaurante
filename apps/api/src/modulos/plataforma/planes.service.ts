import { Inject, Injectable } from '@nestjs/common';
import type { PlanCrearEntrada, PlanModificarEntrada, PlanRespuesta } from '@restaurante/contratos';
import type { Modulo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { OperacionPlataforma } from './operacion-plataforma';
import type { TransaccionPlataforma } from './tipos';

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

interface FilaPlan {
  id: string;
  codigo: string;
  nombre: string;
  precio_mensual: string | null;
  cuota_comprobantes_mes: number | null;
  precio_excedente: string | null;
  dias_gracia: number;
  modulos: string[];
  por_defecto: boolean;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

/** Plan elegido para una suscripción nueva o cambiada (criterios 63, 64 y 74). */
export interface PlanElegido {
  id: string;
  codigo: string;
  nombre: string;
  diasGracia: number;
}

const COLUMNAS = `id, codigo, nombre, precio_mensual::text AS precio_mensual, cuota_comprobantes_mes,
  precio_excedente::text AS precio_excedente, dias_gracia, modulos, por_defecto, activo, creado_en, actualizado_en`;

function aRespuesta(fila: FilaPlan): PlanRespuesta {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    precioMensual: fila.precio_mensual,
    cuotaComprobantesMes: fila.cuota_comprobantes_mes,
    precioExcedente: fila.precio_excedente,
    diasGracia: fila.dias_gracia,
    modulos: fila.modulos as Modulo[],
    porDefecto: fila.por_defecto,
    activo: fila.activo,
    creadoEn: fila.creado_en.toISOString(),
    actualizadoEn: fila.actualizado_en.toISOString(),
  };
}

const planNoEncontrado = () => new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El plan no existe');

const codigoRepetido = () =>
  new ErrorAplicacion(409, 'CONFLICTO', 'Ya existe un plan con ese código');

/**
 * Planes de suscripción (RF-04, criterio 75): único escritor de la tabla `plan`. Siempre hay exactamente
 * un plan por defecto y está activo: marcar otro como por defecto quita la marca al anterior; desactivar
 * el plan por defecto o quitarle la marca sin dar otro responde 409 `CONFLICTO`. Cada escritura es una
 * operación de plataforma con su fila de auditoría (`crear_plan`, `modificar_plan`, sin empresa).
 */
@Injectable()
export class PlanesService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** `GET /plataforma/planes`: el plan por defecto primero, luego los activos por código. */
  async listar(): Promise<PlanRespuesta[]> {
    return this.operacion.consultar(async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<FilaPlan>(
        `SELECT ${COLUMNAS} FROM plan ORDER BY por_defecto DESC, activo DESC, codigo, id`,
        { transaction: transaccion, type: QueryTypes.SELECT },
      );
      return filas.map(aRespuesta);
    });
  }

  /** `POST /plataforma/planes` (201). */
  async crear(entrada: PlanCrearEntrada, superadministradorId: string): Promise<PlanRespuesta> {
    const { motivo, ...plan } = entrada;
    if (plan.porDefecto && !plan.activo) throw planPorDefectoInactivo();
    const ahora = this.reloj.ahora();
    return this.operacion.ejecutar(
      { actor: { superadministradorId }, motivo, operacion: 'crear_plan' },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        // El plan nuevo es el único por defecto: se quita la marca al anterior antes de insertar.
        if (plan.porDefecto) await quitarMarcaDePorDefecto(transaccion, null, ahora);
        try {
          const filas = await sequelize.query<FilaPlan>(
            `INSERT INTO plan (codigo, nombre, precio_mensual, cuota_comprobantes_mes, precio_excedente,
                               dias_gracia, modulos, por_defecto, activo, creado_en, actualizado_en)
             VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $10)
             RETURNING ${COLUMNAS}`,
            {
              transaction: transaccion,
              type: QueryTypes.SELECT,
              bind: [
                plan.codigo,
                plan.nombre,
                plan.precioMensual ?? null,
                plan.cuotaComprobantesMes ?? null,
                plan.precioExcedente ?? null,
                plan.diasGracia,
                [...new Set(plan.modulos)],
                plan.porDefecto,
                plan.activo,
                ahora,
              ],
            },
          );
          const creado = aRespuesta(filas[0]!);
          this.operacion.registrarDatosDeAuditoria(transaccion, {
            entidad: 'plan',
            entidadId: creado.id,
            detalle: { plan: creado },
          });
          return creado;
        } catch (error) {
          if (esCodigoRepetido(error)) throw codigoRepetido();
          throw error;
        }
      },
    );
  }

  /** `PATCH /plataforma/planes/:id`: cualquier subconjunto del plan, con el antes y el después en la auditoría. */
  async modificar(
    id: string,
    cambios: PlanModificarEntrada,
    superadministradorId: string,
  ): Promise<PlanRespuesta> {
    const { motivo, ...nuevos } = cambios;
    const ahora = this.reloj.ahora();
    return this.operacion.ejecutar(
      { actor: { superadministradorId }, motivo, operacion: 'modificar_plan' },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        const previas = await sequelize.query<FilaPlan>(
          `SELECT ${COLUMNAS} FROM plan WHERE id = $1 FOR UPDATE`,
          { transaction: transaccion, type: QueryTypes.SELECT, bind: [id.toLowerCase()] },
        );
        const antes = previas[0];
        if (antes === undefined) throw planNoEncontrado();

        const porDefecto = nuevos.porDefecto ?? antes.por_defecto;
        const activo = nuevos.activo ?? antes.activo;
        if (antes.por_defecto && !porDefecto) {
          throw new ErrorAplicacion(
            409,
            'CONFLICTO',
            'Siempre debe haber un plan por defecto: marca otro plan como por defecto',
          );
        }
        if (porDefecto && !activo) throw planPorDefectoInactivo();
        if (porDefecto && !antes.por_defecto) {
          await quitarMarcaDePorDefecto(transaccion, antes.id, ahora);
        }

        try {
          const filas = await sequelize.query<FilaPlan>(
            `UPDATE plan
                SET codigo = $2, nombre = $3, precio_mensual = $4, cuota_comprobantes_mes = $5,
                    precio_excedente = $6, dias_gracia = $7, modulos = $8::text[],
                    por_defecto = $9, activo = $10, actualizado_en = $11
              WHERE id = $1
              RETURNING ${COLUMNAS}`,
            {
              transaction: transaccion,
              type: QueryTypes.SELECT,
              bind: [
                antes.id,
                nuevos.codigo ?? antes.codigo,
                nuevos.nombre ?? antes.nombre,
                nuevos.precioMensual !== undefined ? nuevos.precioMensual : antes.precio_mensual,
                nuevos.cuotaComprobantesMes !== undefined
                  ? nuevos.cuotaComprobantesMes
                  : antes.cuota_comprobantes_mes,
                nuevos.precioExcedente !== undefined
                  ? nuevos.precioExcedente
                  : antes.precio_excedente,
                nuevos.diasGracia ?? antes.dias_gracia,
                nuevos.modulos !== undefined ? [...new Set(nuevos.modulos)] : antes.modulos,
                porDefecto,
                activo,
                ahora,
              ],
            },
          );
          const despues = aRespuesta(filas[0]!);
          this.operacion.registrarDatosDeAuditoria(transaccion, {
            entidad: 'plan',
            entidadId: despues.id,
            detalle: { antes: aRespuesta(antes), despues },
          });
          return despues;
        } catch (error) {
          if (esCodigoRepetido(error)) throw codigoRepetido();
          throw error;
        }
      },
    );
  }

  /**
   * Plan para una suscripción nueva o cambiada, dentro de una operación de plataforma: el indicado (debe
   * existir y estar activo) o el plan por defecto. Un plan inexistente o inactivo responde 422
   * `PLAN_INVALIDO`.
   */
  async elegirParaSuscripcion(
    transaccion: TransaccionPlataforma,
    planId: string | undefined,
  ): Promise<PlanElegido> {
    const filas = await sequelizeDe(transaccion).query<{
      id: string;
      codigo: string;
      nombre: string;
      dias_gracia: number;
    }>(
      planId === undefined
        ? 'SELECT id, codigo, nombre, dias_gracia FROM plan WHERE por_defecto AND activo'
        : 'SELECT id, codigo, nombre, dias_gracia FROM plan WHERE id = $1 AND activo',
      {
        transaction: transaccion,
        type: QueryTypes.SELECT,
        ...(planId === undefined ? {} : { bind: [planId.toLowerCase()] }),
      },
    );
    const plan = filas[0];
    if (plan === undefined) {
      throw new ErrorAplicacion(422, 'PLAN_INVALIDO', 'El plan no existe o no está activo');
    }
    return { id: plan.id, codigo: plan.codigo, nombre: plan.nombre, diasGracia: plan.dias_gracia };
  }
}

function planPorDefectoInactivo(): ErrorAplicacion {
  return new ErrorAplicacion(409, 'CONFLICTO', 'El plan por defecto debe estar activo');
}

function esCodigoRepetido(error: unknown): boolean {
  return (
    sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD &&
    restriccionDe(error) === 'plan_codigo_unico'
  );
}

/** Quita la marca de plan por defecto al actual (menos a `salvo`, si se indica). */
async function quitarMarcaDePorDefecto(
  transaccion: Transaction,
  salvo: string | null,
  ahora: Date,
): Promise<void> {
  await sequelizeDe(transaccion).query(
    `UPDATE plan SET por_defecto = false, actualizado_en = $1
      WHERE por_defecto AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    { transaction: transaccion, bind: [ahora, salvo] },
  );
}
