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
import { ColaPorTransaccion } from './cola-por-transaccion';
import { ConsultaProhibidaError } from './errores';
import type { OpcionesConsultaInterna, TransaccionInterna } from './transaccion-interna';
import { estadoActual } from './estado-operacion';

/**
 * Sentencias que, dentro de una transacción con contexto, nunca puede mandar código de la API: fijar
 * o cambiar parámetros de sesión (`set_config`, `SET`, `RESET`, `DISCARD`), bloques anónimos (`DO`) y
 * cualquier mención del parámetro del contexto. La única vía es `ContextoEmpresa.ejecutar`. Es una
 * segunda barrera: la primera es la RLS y que `restaurante_api` no puede saltársela.
 */
const PATRON_CONTEXTO = /set_config|app\s*\.\s*empresa_id/i;
const PATRON_SESION = /(^|;)\s*(SET|RESET|DISCARD|DO)\b/i;

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
 *    con un UUID) se ejecuta en ella con éxito. Fijarlo dos veces en la misma transacción falla, así
 *    que una transacción no cambia de empresa.
 * 4. Las sentencias de control de transacción (`START TRANSACTION`, `COMMIT`, `ROLLBACK`) pasan sin
 *    autorización, porque la transacción tiene que abrirse antes de poder fijar la empresa.
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

    if (esControlDeTransaccion(texto))
      return cola.ejecutar(transaccion, () => consultar(sql, opts));
    if (transaccion.finished && !opts.completesTransaction) throw new ContextoEmpresaAusenteError();

    if (texto === SQL_FIJAR_CONTEXTO) {
      if (autorizadas.has(transaccion)) throw new ContextoEmpresaConflictoError();
      const bind = opts.bind;
      if (!Array.isArray(bind) || bind.length !== 1 || !uuidSchema.safeParse(bind[0]).success) {
        throw new ConsultaProhibidaError();
      }
      const resultado = await cola.ejecutar(transaccion, () => consultar(sql, opts));
      autorizadas.add(transaccion);
      return resultado;
    }

    if (!autorizadas.has(transaccion)) throw new ContextoEmpresaAusenteError();
    if (texto === undefined || PATRON_CONTEXTO.test(texto) || PATRON_SESION.test(texto)) {
      throw new ConsultaProhibidaError();
    }
    return cola.ejecutar(transaccion, () => consultar(sql, opts));
  }

  sequelize.query = guardada as unknown as typeof sequelize.query;
}
