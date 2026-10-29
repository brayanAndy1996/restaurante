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
import { contieneControlDeTransaccion, mencionaContextoDeEmpresa } from './control-transaccion';
import { argumentosDeActor, type ActorTransaccion } from '../contexto-empresa/actor';
import { SQL_FIJAR_ACTOR } from '../fijar-contexto';
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

const PROHIBIDO_NOMBRE =
  'Una operación de plataforma no puede nombrar funciones ni objetos que cambien el contexto o la ' +
  'sesión, ejecuten SQL armado como texto o muestren sesiones, consultas u objetos grandes ajenos, ' +
  'o el estado de las transacciones y la base entera (set_config, pg_settings, ts_rewrite, *_to_xml*, ' +
  'pg_stat_activity, pg_stat_ssl, pg_stat_progress_*, pg_cancel_backend, lo_*, txid_*, ' +
  'pg_current_xact_id*, pg_xact_status, pg_stat_database…)';

/** Pool pequeño: las operaciones de plataforma son raras y manuales. */
const POOL_PLATAFORMA = 2;

export class ConexionPlataforma {
  readonly sequelize: Sequelize;
  private readonly autorizadas = new WeakSet<Transaction>();
  private readonly cerrando = new WeakSet<Transaction>();
  private readonly conActor = new WeakSet<Transaction>();
  private readonly cola = new ColaPorTransaccion();
  /** `sequelize.query` original, sin la guarda: solo lo usa `fijarActor` con el texto exacto del actor. */
  private readonly consultarDirecto: (sql: unknown, opciones?: unknown) => Promise<unknown>;

  constructor(url: string) {
    this.sequelize = crearSequelize({
      url,
      poolMax: POOL_PLATAFORMA,
      aplicacion: 'restaurante-plataforma',
    });
    this.consultarDirecto = this.sequelize.query.bind(this.sequelize) as (
      sql: unknown,
      opciones?: unknown,
    ) => Promise<unknown>;
    this.instalarGuarda();
  }

  /**
   * Fija el actor de la transacción de la operación en curso (historia 002, criterio 117), una sola vez:
   * la base rechaza una segunda fijación. Es la única vía: la guarda rechaza toda mención de la función
   * que fija el actor dentro de `fn` (como las de la empresa, criterio 38e), y este método manda la
   * sentencia fija por la instancia sin guarda. Debe llamarse al empezar la operación.
   */
  async fijarActor(transaccion: Transaction, actor: ActorTransaccion): Promise<void> {
    if (!estadoActual()?.plataforma) throw new OperacionPlataformaAusenteError();
    const interna = transaccion as TransaccionInterna;
    if (!this.autorizadas.has(transaccion) || interna.finished) {
      throw new OperacionPlataformaAusenteError();
    }
    if (this.conActor.has(transaccion)) {
      throw new Error('El actor de la transacción de plataforma ya está fijado');
    }
    const argumentos = argumentosDeActor(actor);
    this.conActor.add(transaccion);
    await this.cola.ejecutar(transaccion, () =>
      this.consultarDirecto(SQL_FIJAR_ACTOR, {
        bind: argumentos,
        transaction: transaccion,
        raw: true,
      }),
    );
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
      // Criterio 38e: la misma lista de nombres que la guarda de la API (set_config, pg_settings,
      // ts_*, *_to_xml*, app.empresa_id, fijar_contexto_empresa y fijar_contexto_actor sin excepción
      // (el actor lo fija `fijarActor`, que no pasa por aquí), empresa_de_usuario, pg_stat_activity,
      // señales, objetos grandes…) y el rechazo de `U&"…"`. Aquí no hay lista blanca de sentencias,
      // pero `DO`, `PREPARE` y `SET` (las vías para ejecutar SQL dinámico sin nombrarlo) ya se
      // rechazaron arriba. Es un `ConsultaProhibidaError`, no un error de la base.
      if (mencionaContextoDeEmpresa(texto)) throw new ConsultaProhibidaError(PROHIBIDO_NOMBRE);
      return this.cola.ejecutar(transaccion, () => consultar(sql, opts));
    };
    sequelize.query = guardada as unknown as typeof sequelize.query;
  }
}

/** Crea la conexión de plataforma (la usa solo `PlataformaModule`). */
export function crearConexionPlataforma(url: string): ConexionPlataforma {
  return new ConexionPlataforma(url);
}
