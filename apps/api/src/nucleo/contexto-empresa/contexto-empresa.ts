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
import { SQL_FIJAR_CONTEXTO } from '../fijar-contexto';
import type { TransaccionInterna } from '../base-de-datos/transaccion-interna';
import type { ActorTransaccion, OpcionesEjecucion } from './actor';
import {
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
  EmpresaIdInvalidoError,
} from './errores';

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
   * siga corriendo con el almacén asíncrono (criterio 27b). `opciones.actor` es el actor de la
   * transacción para la trazabilidad (historia 002, criterio 117); hasta la tarea T7 se ignora.
   */
  async ejecutar<T>(
    empresaId: string,
    fn: () => Promise<T>,
    _opciones: OpcionesEjecucion = {},
  ): Promise<T> {
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

  /**
   * Fija el actor de la transacción en curso, una sola vez, cuando se conoce más tarde que al abrir el
   * contexto (los ingresos lo fijan después de verificar las credenciales). Hasta la tarea T7 se
   * acepta y no hace nada.
   */
  async fijarActor(_actor: ActorTransaccion): Promise<void> {
    this.empresaActual(); // exige un contexto activo, como el resto de la API
  }

  /** Empresa del contexto activo; lanza `ContextoEmpresaAusenteError` si no hay contexto. */
  empresaActual(): string {
    const empresaId = estadoActual()?.empresaId;
    if (empresaId === undefined) throw new ContextoEmpresaAusenteError();
    return empresaId;
  }
}
