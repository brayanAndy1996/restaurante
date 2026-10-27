import { uuidSchema } from '@restaurante/contratos';
import type { Sequelize, Transaction } from 'sequelize';
import {
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
} from '../contexto-empresa/errores';
import { SQL_FIJAR_CONTEXTO } from '../contexto-empresa/contexto-empresa';
import {
  esConsultaSinEmpresaValida,
  esControlDeTransaccion,
  textoDeConsulta,
  type OpcionesSinEmpresa,
} from './consultas-sin-empresa';
import { estaCerrandoPropio } from './cierre-propio';
import { consumirPendienteDeAutorizar } from './autorizacion-transaccion';
import {
  contieneControlDeTransaccion,
  contieneSentenciaNoPermitida,
  mencionaContextoDeEmpresa,
} from './control-transaccion';
import { ColaPorTransaccion } from './cola-por-transaccion';
import { ConsultaProhibidaError } from './errores';
import { SQLSTATE } from './errores-pg';
import type { OpcionesConsultaInterna, TransaccionInterna } from './transaccion-interna';
import { estadoActual } from './estado-operacion';

const PROHIBIDO_CONTROLAR =
  'Dentro de ContextoEmpresa.ejecutar no se puede confirmar, revertir ni subdividir la transacción ' +
  '(COMMIT, ROLLBACK, END, ABORT, SAVEPOINT, RELEASE, BEGIN, START TRANSACTION, PREPARE…): ' +
  'lo hace ejecutar al terminar fn';

const PROHIBIDO_NOMBRE =
  'Dentro de ContextoEmpresa.ejecutar no se pueden nombrar funciones ni objetos que cambien el ' +
  'contexto o la sesión, ejecuten SQL armado como texto o muestren sesiones, consultas u objetos ' +
  'grandes ajenos (set_config, pg_settings, ts_rewrite, *_to_xml*, pg_stat_activity, ' +
  'pg_cancel_backend, lo_*…)';

const PROHIBIDO_SENTENCIA =
  'Dentro de ContextoEmpresa.ejecutar solo se admiten sentencias que empiecen por SELECT, INSERT, ' +
  'UPDATE, DELETE, WITH, VALUES o TABLE';

/**
 * Instala la guarda de la API en `sequelize.query`, por donde pasan todas las consultas de la
 * instancia (modelos, `queryInterface`, consultas crudas y las sentencias de transacción).
 *
 * Reglas:
 * 1. Una consulta marcada `sinEmpresa` solo pasa si es una de las dos consultas fijas de salud y de
 *    verificación de roles (ver `consultas-sin-empresa.ts`).
 * 2. Toda otra consulta debe correr en una transacción abierta por `ContextoEmpresa.ejecutar`: la
 *    pasada en `options.transaction` o, si no hay, la del `AsyncLocalStorage`. Si no la hay, lanza
 *    `ContextoEmpresaAusenteError` antes de pedir una conexión al pool, y la consulta nunca sale.
 * 3. Una transacción queda autorizada cuando el SQL exacto de `ContextoEmpresa` (`SQL_FIJAR_CONTEXTO`,
 *    que llama a `fijar_contexto_empresa`, con un UUID) se ejecuta en ella con éxito Y `ContextoEmpresa.ejecutar` la había registrado como
 *    pendiente al abrirla (`autorizacion-transaccion.ts`, criterio 22c). El texto solo no autoriza:
 *    código que corre dentro de `fn` y abre otra transacción no puede autorizarla fijando una empresa
 *    (ni otra ni la propia). El registro es de un solo uso, así que una transacción no cambia de
 *    empresa.
 * 4. Las sentencias de control de transacción (`START TRANSACTION`, `COMMIT`, `ROLLBACK`) pasan solo
 *    antes de la autorización, porque la transacción tiene que abrirse antes de poder fijar la
 *    empresa. Ya autorizada, solo pasan el `COMMIT` y el `ROLLBACK` de `ContextoEmpresa.ejecutar`
 *    (ver `cierre-propio.ts`); toda otra sentencia de control, sola, entre varias o tras comentarios,
 *    se rechaza antes de llegar a la base (criterio 22b, analizador de `control-transaccion.ts`).
 * 5. En una transacción autorizada también se rechazan `set_config`, `SET`/`RESET`/`DISCARD`/`DO` y
 *    los demás medios de cambiar el contexto o la sesión, y toda mención de los nombres y prefijos de
 *    `NOMBRES_PROHIBIDOS` y `PREFIJOS_PROHIBIDOS` (criterio 38e, incluida toda mención de la función
 *    que fija el contexto salvo la fijación propia, que sale antes por su origen). La decisión se toma
 *    sobre el texto sin literales ni comentarios (el mismo analizador), así que un valor como
 *    `'x; set y'` pasa.
 * 6. Lista blanca (criterio 22d): dentro de una transacción autorizada, la primera palabra de cada
 *    sentencia debe ser `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, `VALUES` o `TABLE`; todo lo
 *    demás (`LISTEN`, `COPY`, `DECLARE`, `EXPLAIN`…) se rechaza antes de pedir la conexión. No depende
 *    de nombres de funciones: es la capa que no se puede esquivar con una función nueva.
 *
 * Esto sustituye al CLS de Sequelize (`useCLS` es global para toda la clase `Sequelize` y mezclaría
 * la API con la plataforma): la transacción de la petición se toma del `AsyncLocalStorage` aquí,
 * sin tocar la instancia de plataforma.
 */
export function instalarGuardaApi(sequelize: Sequelize): void {
  const autorizadas = new WeakSet<Transaction>();
  const cola = new ColaPorTransaccion();
  const consultar = sequelize.query.bind(sequelize) as (
    sql: unknown,
    opciones?: unknown,
  ) => Promise<unknown>;

  async function guardada(sql: unknown, opciones: unknown = {}): Promise<unknown> {
    const opts = { ...((opciones ?? {}) as OpcionesSinEmpresa & OpcionesConsultaInterna) };
    const texto = textoDeConsulta(sql);

    if (opts.sinEmpresa !== undefined) {
      if (!esConsultaSinEmpresaValida(texto, opts, ['salud', 'verificacion-roles'])) {
        throw new ContextoEmpresaAusenteError(
          'La marca sinEmpresa solo vale para las consultas fijas de salud y de verificación de roles',
        );
      }
      return consultar(sql, opts);
    }

    const transaccion = (opts.transaction ?? estadoActual()?.transaccion) as
      TransaccionInterna | undefined;
    if (!transaccion || transaccion.sequelize !== sequelize) {
      throw new ContextoEmpresaAusenteError();
    }
    opts.transaction = transaccion;

    if (esControlDeTransaccion(texto)) {
      // Abrir la transacción (`START TRANSACTION`) pasa antes de la autorización. Ya autorizada, solo
      // el cierre propio de `ContextoEmpresa.ejecutar` puede mandar `COMMIT` o `ROLLBACK` (22b).
      const cierra = /^(COMMIT|ROLLBACK);?$/i.test(texto ?? '');
      if (autorizadas.has(transaccion) && !(cierra && estaCerrandoPropio(transaccion))) {
        throw new ConsultaProhibidaError(PROHIBIDO_CONTROLAR);
      }
      return cola.ejecutar(transaccion, () => consultar(sql, opts));
    }
    if (transaccion.finished && !opts.completesTransaction) throw new ContextoEmpresaAusenteError();

    if (texto === SQL_FIJAR_CONTEXTO) {
      if (autorizadas.has(transaccion)) throw new ContextoEmpresaConflictoError();
      // Solo la transacción que `ContextoEmpresa.ejecutar` acaba de abrir (sin contexto vigente) y
      // registró como pendiente puede autorizarse; cualquier otra recibe el mismo rechazo que una
      // transacción sin contexto, antes de llegar a la base (criterio 22c).
      if (!consumirPendienteDeAutorizar(transaccion)) throw new ContextoEmpresaAusenteError();
      const bind = opts.bind;
      if (!Array.isArray(bind) || bind.length !== 1 || !uuidSchema.safeParse(bind[0]).success) {
        throw new ConsultaProhibidaError();
      }
      const resultado = await cola.ejecutar(transaccion, () => consultar(sql, opts));
      autorizadas.add(transaccion);
      return resultado;
    }

    if (!autorizadas.has(transaccion)) throw new ContextoEmpresaAusenteError();
    if (texto === undefined) throw new ConsultaProhibidaError();
    // Nombres de la lista del criterio 38e (y `set_config`, `pg_settings`, `ts_*`, `app.empresa_id`,
    // la función que fija el contexto, `U&"…"`): denegación equivalente a un permiso denegado.
    if (mencionaContextoDeEmpresa(texto)) {
      throw new ConsultaProhibidaError(PROHIBIDO_NOMBRE, SQLSTATE.PERMISO_DENEGADO);
    }
    // Incluye `SET`/`RESET`/`DISCARD`/`DO` como sentencia, además del control de transacción.
    if (contieneControlDeTransaccion(texto)) throw new ConsultaProhibidaError(PROHIBIDO_CONTROLAR);
    // Lista blanca (22d): solo SELECT, INSERT, UPDATE, DELETE, WITH, VALUES y TABLE. Las sentencias
    // internas (abrir y cerrar la transacción, fijar el contexto) ya salieron más arriba por su origen.
    if (contieneSentenciaNoPermitida(texto)) {
      throw new ConsultaProhibidaError(PROHIBIDO_SENTENCIA);
    }
    return cola.ejecutar(transaccion, () => consultar(sql, opts));
  }

  sequelize.query = guardada as unknown as typeof sequelize.query;
}
