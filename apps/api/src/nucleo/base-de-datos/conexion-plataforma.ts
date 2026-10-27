/**
 * Conexión de plataforma (`restaurante_plataforma`, `DATABASE_PLATAFORMA_URL`).
 *
 * Solo `PlataformaModule` (src/modulos/plataforma/) puede importar este archivo: una regla de ESLint
 * (`no-restricted-imports`) lo exige (criterio 37), y por eso `index.ts` de esta carpeta no lo
 * re-exporta. La API nunca usa esta conexión ni la de plataforma atiende consultas de la API.
 *
 * Aislamiento de la API: es otra instancia de Sequelize con su propio pool y sin CLS. Toda consulta
 * debe llevar una transacción abierta con `abrirTransaccion()` (que usa `OperacionPlataforma`) y
 * correr dentro de una operación de plataforma; no se toma ninguna transacción "implícita".
 */
import type { Sequelize, Transaction } from 'sequelize';
import { ColaPorTransaccion } from './cola-por-transaccion';
import {
  esConsultaSinEmpresaValida,
  esControlDeTransaccion,
  textoDeConsulta,
} from './consultas-sin-empresa';
import type { OpcionesSinEmpresa } from './consultas-sin-empresa';
import { crearSequelize } from './crear-sequelize';
import { estadoActual } from './estado-operacion';
import type { OpcionesConsultaInterna, TransaccionInterna } from './transaccion-interna';

export const CONEXION_PLATAFORMA = Symbol('CONEXION_PLATAFORMA');

/** Se intentó usar la conexión de plataforma fuera de una operación de plataforma. */
export class OperacionPlataformaAusenteError extends Error {
  constructor(
    mensaje = 'La conexión de plataforma solo se puede usar dentro de OperacionPlataforma.ejecutar',
  ) {
    super(mensaje);
    this.name = 'OperacionPlataformaAusenteError';
  }
}

/** Pool pequeño: las operaciones de plataforma son raras y manuales. */
const POOL_PLATAFORMA = 2;

export class ConexionPlataforma {
  readonly sequelize: Sequelize;
  private readonly autorizadas = new WeakSet<Transaction>();
  private readonly cola = new ColaPorTransaccion();

  constructor(url: string) {
    this.sequelize = crearSequelize({
      url,
      poolMax: POOL_PLATAFORMA,
      aplicacion: 'restaurante-plataforma',
    });
    this.instalarGuarda();
  }

  /**
   * Abre una transacción explícita (no gestionada) y la autoriza. Debe llamarse dentro de
   * `OperacionPlataforma.ejecutar`; quien la abre debe confirmarla o revertirla.
   */
  async abrirTransaccion(): Promise<Transaction> {
    if (!estadoActual()?.plataforma) throw new OperacionPlataformaAusenteError();
    const transaccion = await this.sequelize.transaction();
    this.autorizadas.add(transaccion);
    return transaccion;
  }

  cerrar(): Promise<void> {
    return this.sequelize.close();
  }

  private instalarGuarda(): void {
    const sequelize = this.sequelize;
    const consultar = sequelize.query.bind(sequelize) as (
      sql: unknown,
      opciones?: unknown,
    ) => Promise<unknown>;

    const guardada = async (sql: unknown, opciones: unknown = {}): Promise<unknown> => {
      const opts = { ...((opciones ?? {}) as OpcionesSinEmpresa & OpcionesConsultaInterna) };
      const texto = textoDeConsulta(sql);

      if (opts.sinEmpresa !== undefined) {
        if (!esConsultaSinEmpresaValida(texto, opts, ['verificacion-roles'])) {
          throw new OperacionPlataformaAusenteError(
            'La marca sinEmpresa solo vale para la verificación de roles en la conexión de plataforma',
          );
        }
        return consultar(sql, opts);
      }

      // Sin transacción implícita: nada de CLS ni del almacén de la API.
      const transaccion = opts.transaction as TransaccionInterna | null | undefined;
      if (!transaccion || transaccion.sequelize !== sequelize) {
        throw new OperacionPlataformaAusenteError();
      }
      if (esControlDeTransaccion(texto)) {
        return this.cola.ejecutar(transaccion, () => consultar(sql, opts));
      }
      if (
        !this.autorizadas.has(transaccion) ||
        (transaccion.finished && !opts.completesTransaction) ||
        !estadoActual()?.plataforma
      ) {
        throw new OperacionPlataformaAusenteError();
      }
      return this.cola.ejecutar(transaccion, () => consultar(sql, opts));
    };
    sequelize.query = guardada as unknown as typeof sequelize.query;
  }
}

/** Crea la conexión de plataforma (la usa solo `PlataformaModule`). */
export function crearConexionPlataforma(url: string): ConexionPlataforma {
  return new ConexionPlataforma(url);
}
