/**
 * Conexión de plataforma (`restaurante_plataforma`, `DATABASE_PLATAFORMA_URL`).
 *
 * Solo `PlataformaModule` (src/modulos/plataforma/) puede importar este archivo: una regla de ESLint
 * (`no-restricted-imports`) lo exige (criterio 37), y por eso `index.ts` de esta carpeta no lo
 * re-exporta. La API nunca usa esta conexión ni la de plataforma atiende consultas de la API.
 *
 * Cierre de la transacción (criterio 32b): solo `confirmar()` y `revertir()` pueden mandar `COMMIT` o
 * `ROLLBACK` sobre una transacción abierta con `abrirTransaccion()`. Si el código de `fn` intenta
 * cerrarla (con `commit()`, `rollback()` o SQL), la guarda rechaza la sentencia y Sequelize destruye
 * la conexión, así que PostgreSQL revierte lo hecho; tampoco puede mandar `SAVEPOINT`, `RELEASE`,
 * `BEGIN`, `SET` ni otras sentencias de control (ver `control-transaccion.ts`).
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
import { contieneControlDeTransaccion } from './control-transaccion';
import { crearSequelize } from './crear-sequelize';
import { ConsultaProhibidaError } from './errores';
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

const SQL_SOLO_LECTURA = 'SET TRANSACTION READ ONLY';

const PROHIBIDO_CERRAR =
  'Una operación de plataforma no puede confirmar, revertir ni reabrir su transacción, ni cambiar ' +
  'la sesión: lo hace OperacionPlataforma (COMMIT, ROLLBACK, END, ABORT, SAVEPOINT, RELEASE, BEGIN, SET…)';

/** Pool pequeño: las operaciones de plataforma son raras y manuales. */
const POOL_PLATAFORMA = 2;

export class ConexionPlataforma {
  readonly sequelize: Sequelize;
  private readonly autorizadas = new WeakSet<Transaction>();
  private readonly cerrando = new WeakSet<Transaction>();
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
  async abrirTransaccion(opciones: { soloLectura?: boolean } = {}): Promise<Transaction> {
    if (!estadoActual()?.plataforma) throw new OperacionPlataformaAusenteError();
    const transaccion = await this.sequelize.transaction();
    try {
      if (opciones.soloLectura) {
        // Antes de autorizarla: así `fn` no puede escribir ni confirmar nada en esta transacción.
        await this.sequelize.query(SQL_SOLO_LECTURA, { transaction: transaccion, raw: true });
      }
    } catch (error) {
      await this.cierre(transaccion, 'rollback').catch(() => undefined);
      throw error;
    }
    this.autorizadas.add(transaccion);
    return transaccion;
  }

  /** Confirma la transacción (única vía autorizada para el `COMMIT`). */
  confirmar(transaccion: Transaction): Promise<void> {
    return this.cierre(transaccion, 'commit');
  }

  /** Revierte la transacción (única vía autorizada para el `ROLLBACK`). */
  revertir(transaccion: Transaction): Promise<void> {
    return this.cierre(transaccion, 'rollback');
  }

  /**
   * Cierra la transacción. La marca solo vale mientras se llama a `commit()`/`rollback()`: ambas
   * mandan la sentencia de forma síncrona, antes del primer `await`, y la guarda la mira ahí mismo.
   */
  private cierre(transaccion: Transaction, como: 'commit' | 'rollback'): Promise<void> {
    this.cerrando.add(transaccion);
    let promesa: Promise<void>;
    try {
      promesa = como === 'commit' ? transaccion.commit() : transaccion.rollback();
    } finally {
      this.cerrando.delete(transaccion);
    }
    return promesa;
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
      const autorizada = this.autorizadas.has(transaccion);
      if (esControlDeTransaccion(texto) || texto === SQL_SOLO_LECTURA) {
        // `START TRANSACTION` y `SET TRANSACTION …` solo abren la transacción; `COMMIT` y
        // `ROLLBACK` solo los manda `confirmar()`/`revertir()`, o el rollback de una apertura fallida.
        const cierra = /^(COMMIT|ROLLBACK);?$/i.test(texto ?? '');
        if (autorizada && !(cierra && this.cerrando.has(transaccion))) {
          throw new ConsultaProhibidaError(PROHIBIDO_CERRAR);
        }
        return this.cola.ejecutar(transaccion, () => consultar(sql, opts));
      }
      if (texto === undefined || contieneControlDeTransaccion(texto)) {
        throw new ConsultaProhibidaError(PROHIBIDO_CERRAR);
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
