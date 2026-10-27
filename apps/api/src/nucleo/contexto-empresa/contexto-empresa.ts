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
 * Sentencia que fija la empresa de la transacción. Este es el único archivo de la API autorizado a
 * escribir el parámetro (regla de ESLint, criterio 37), y el texto no se puede importar fuera de
 * `src/nucleo/` (criterio 22c). La guarda de consultas (`base-de-datos/guarda-api.ts`) reconoce este
 * texto exacto, pero solo autoriza la transacción si `ejecutar` la registró antes como pendiente.
 * El tercer argumento `true` hace que el valor muera con la transacción.
 */
export const SQL_FIJAR_CONTEXTO = "SELECT set_config('app.empresa_id', $1, true)";

/**
 * Contexto de empresa de la operación en curso: `AsyncLocalStorage` + parámetro de transacción
 * `app.empresa_id` en PostgreSQL. Sin contexto, ninguna consulta de la API llega a la base.
 */
@Injectable()
export class ContextoEmpresa {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * Valida el UUID, abre una transacción en la conexión de la API, fija `app.empresa_id` como
   * primera sentencia y corre `fn` con el contexto activo. Confirma si `fn` termina bien y revierte
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
