import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { Sequelize } from 'sequelize';
import { registrarPendienteDeAutorizar } from '../base-de-datos/autorizacion-transaccion';
import { confirmarPropia, revertirPropia } from '../base-de-datos/cierre-propio';
import {
  ejecutarConEstado,
  estadoActual,
  terminarEstado,
  type EstadoOperacion,
} from '../base-de-datos/estado-operacion';
import { CONEXION_API } from '../base-de-datos/token-api';
import type { TransaccionInterna } from '../base-de-datos/transaccion-interna';
import {
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
  EmpresaIdInvalidoError,
} from './errores';

/**
 * Nombre de la función de la base que fija la empresa de la transacción (criterio 22e). La guarda de
 * consultas lo lee de aquí para rechazar toda otra mención, porque el lint prohíbe escribir el texto
 * fuera de este archivo y de las migraciones.
 */
export const NOMBRE_FUNCION_FIJAR_CONTEXTO = 'fijar_contexto_empresa';

/**
 * Sentencia que fija la empresa de la transacción. Este es el único archivo de la API autorizado a
 * escribir `fijar_contexto_empresa` y el parámetro `app.empresa_id` (regla de ESLint, criterios 37 y
 * 22e), y el texto no se puede importar fuera de `src/nucleo/` (criterio 22c). La guarda de consultas
 * (`base-de-datos/guarda-api.ts`) reconoce este texto exacto, pero solo autoriza la transacción si
 * `ejecutar` la registró antes como pendiente. La base (no la guarda) garantiza que la empresa se
 * fija una sola vez por transacción: una segunda llamada falla con `42501` (criterio 22e).
 */
export const SQL_FIJAR_CONTEXTO = `SELECT ${NOMBRE_FUNCION_FIJAR_CONTEXTO}($1)`;

/**
 * Contexto de empresa de la operación en curso: `AsyncLocalStorage` + la fila de la sesión en
 * `contexto.sesion_empresa` (la fija `fijar_contexto_empresa`, una sola vez por transacción). Sin
 * contexto, ninguna consulta de la API llega a la base.
 */
@Injectable()
export class ContextoEmpresa {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * Valida el UUID, abre una transacción en la conexión de la API, fija la empresa con
   * `fijar_contexto_empresa` como primera sentencia y corre `fn` con el contexto activo. Confirma si `fn` termina bien y revierte
   * si lanza; `fn` no puede controlar la transacción por SQL (la guarda de la API lo rechaza, criterio
   * 22b) ni autorizar otra transacción de la API (criterio 22c). Misma empresa dentro de un contexto
   * activo: reutiliza la transacción; otra empresa: `ContextoEmpresaConflictoError`. Dentro de una
   * operación de plataforma también falla. Al terminar, el contexto termina también para el código que
   * siga corriendo con el almacén asíncrono (criterio 27b).
   */
  async ejecutar<T>(empresaId: string, fn: () => Promise<T>): Promise<T> {
    if (typeof empresaId !== 'string' || !uuidSchema.safeParse(empresaId).success) {
      throw new EmpresaIdInvalidoError();
    }
    const empresa = empresaId.toLowerCase();

    const estado = estadoActual();
    if (estado?.plataforma) {
      throw new ContextoEmpresaConflictoError(
        'No se puede abrir un contexto de empresa dentro de una operación de plataforma',
      );
    }
    if (estado?.empresaId !== undefined) {
      if (estado.empresaId === empresa) return fn();
      throw new ContextoEmpresaConflictoError();
    }

    // Transacción no gestionada: no toca ningún CLS global; la guarda la toma del almacén.
    const transaccion = (await this.conexion.transaction()) as TransaccionInterna;
    const nuevoEstado: EstadoOperacion = { empresaId: empresa, transaccion };
    try {
      // Solo esta transacción, abierta aquí sin contexto vigente, puede autorizarse (criterio 22c).
      registrarPendienteDeAutorizar(transaccion);
      await this.conexion.query(SQL_FIJAR_CONTEXTO, { bind: [empresa], transaction: transaccion });
      let resultado: T;
      try {
        resultado = await ejecutarConEstado(nuevoEstado, fn);
      } finally {
        // `fn` terminó (bien o mal): el código que siga vivo con este almacén ya no tiene contexto
        // (criterio 27b). Se marca antes de cerrar la transacción.
        terminarEstado(nuevoEstado);
      }
      await confirmarPropia(transaccion);
      return resultado;
    } catch (error) {
      if (!transaccion.finished) {
        try {
          await revertirPropia(transaccion);
        } catch {
          // Sequelize ya destruye la conexión si el rollback falla; el error original es el que importa.
        }
      }
      throw error;
    }
  }

  /** Empresa del contexto activo; lanza `ContextoEmpresaAusenteError` si no hay contexto. */
  empresaActual(): string {
    const empresaId = estadoActual()?.empresaId;
    if (empresaId === undefined) throw new ContextoEmpresaAusenteError();
    return empresaId;
  }
}
