import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { Sequelize } from 'sequelize';
import {
  registrarActorPendiente,
  registrarPendienteDeAutorizar,
} from '../base-de-datos/autorizacion-transaccion';
import { confirmarPropia, revertirPropia } from '../base-de-datos/cierre-propio';
import {
  ejecutarConEstado,
  estadoActual,
  terminarEstado,
  type EstadoOperacion,
} from '../base-de-datos/estado-operacion';
import { CONEXION_API } from '../base-de-datos/token-api';
import { SQL_FIJAR_ACTOR, SQL_FIJAR_CONTEXTO } from '../fijar-contexto';
import type { TransaccionInterna } from '../base-de-datos/transaccion-interna';
import { argumentosDeActor, type ActorTransaccion, type OpcionesEjecucion } from './actor';
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
  /** Transacciones que ya tienen su actor (se fija una sola vez; la base también lo exige). */
  private readonly conActor = new WeakSet<TransaccionInterna>();
  private readonly logger = new Logger(ContextoEmpresa.name);

  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * Valida el UUID, abre una transacción en la conexión de la API, fija la empresa con
   * `fijar_contexto_empresa` como primera sentencia y corre `fn` con el contexto activo. Confirma si `fn` termina bien y revierte
   * si lanza; `fn` no puede controlar la transacción por SQL (la guarda de la API lo rechaza, criterio
   * 22b) ni autorizar otra transacción de la API (criterio 22c). Misma empresa dentro de un contexto
   * activo: reutiliza la transacción; otra empresa: `ContextoEmpresaConflictoError`. Dentro de una
   * operación de plataforma también falla. Al terminar, el contexto termina también para el código que
   * siga corriendo con el almacén asíncrono (criterio 27b). `opciones.actor` es el actor de la
   * transacción para la trazabilidad (historia 002, criterio 117). Los efectos registrados con `alConfirmar`
   * corren al final, solo si el `COMMIT` volvió sin error (ver `alConfirmar`).
   */
  async ejecutar<T>(
    empresaId: string,
    fn: () => Promise<T>,
    opciones: OpcionesEjecucion = {},
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
    const efectos: Array<() => void | Promise<void>> = [];
    const nuevoEstado: EstadoOperacion = { empresaId: empresa, transaccion, efectos };
    let confirmada = false;
    try {
      // Solo esta transacción, abierta aquí sin contexto vigente, puede autorizarse (criterio 22c).
      registrarPendienteDeAutorizar(transaccion);
      await this.conexion.query(SQL_FIJAR_CONTEXTO, { bind: [empresa], transaction: transaccion });
      if (opciones.actor !== undefined) await this.enviarActor(transaccion, opciones.actor);
      let resultado: T;
      try {
        resultado = await ejecutarConEstado(nuevoEstado, fn);
      } finally {
        // `fn` terminó (bien o mal): el código que siga vivo con este almacén ya no tiene contexto
        // (criterio 27b). Se marca antes de cerrar la transacción.
        terminarEstado(nuevoEstado);
      }
      await confirmarPropia(transaccion);
      confirmada = true;
      await this.correrEfectos(efectos);
      return resultado;
    } catch (error) {
      // Tras la confirmación `correrEfectos` no lanza; si algo lo hiciera, no hay nada que revertir.
      if (!confirmada && !transaccion.finished) {
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
   * contexto (los ingresos lo fijan después de verificar las credenciales: el usuario si son correctas y
   * `{ sistema: 'autenticacion' }` si no). Exige un contexto activo; un segundo actor en la misma
   * transacción lanza `ContextoEmpresaConflictoError` (la base también lo rechaza, `42501`). Es la única
   * vía, junto con `opciones.actor` de `ejecutar`: la guarda rechaza el texto de la función en el código
   * de `fn`.
   */
  async fijarActor(actor: ActorTransaccion): Promise<void> {
    this.empresaActual(); // exige un contexto activo, como el resto de la API
    const transaccion = estadoActual()?.transaccion as TransaccionInterna | undefined;
    if (transaccion === undefined) throw new ContextoEmpresaAusenteError();
    await this.enviarActor(transaccion, actor);
  }

  /** Manda `fijar_contexto_actor` por la transacción; la guarda lo deja pasar solo si se registró aquí. */
  private async enviarActor(
    transaccion: TransaccionInterna,
    actor: ActorTransaccion,
  ): Promise<void> {
    if (this.conActor.has(transaccion)) {
      throw new ContextoEmpresaConflictoError('El actor de la transacción ya está fijado');
    }
    const argumentos = argumentosDeActor(actor);
    this.conActor.add(transaccion);
    // Se registra y se manda en el mismo instante: la guarda consume el registro de forma síncrona.
    registrarActorPendiente(transaccion);
    await this.conexion.query(SQL_FIJAR_ACTOR, { bind: argumentos, transaction: transaccion });
  }

  /**
   * Registra un efecto secundario que debe correr **después** de confirmar la transacción en curso: no corre
   * si se revierte ni si el `COMMIT` falla (por ejemplo, una restricción diferida que se viola al confirmar).
   * Exige un contexto activo. Los efectos se guardan en el estado de la operación y `ejecutar` los corre, en
   * orden de registro, cuando su propio `COMMIT` vuelve sin error. Dentro de un contexto anidado (misma
   * empresa) el efecto queda en la operación dueña de la transacción y corre cuando esta confirma.
   *
   * Cada efecto corre aislado: si lanza (o rechaza), el error se registra en el log y no se propaga ni
   * impide los demás, porque la transacción ya está confirmada. Los efectos deben ser breves (encolar un
   * trabajo, avisar), pues `ejecutar` espera a que terminen antes de devolver. Corren fuera de cualquier
   * contexto: no pueden consultar la base con la empresa de la operación.
   */
  alConfirmar(efecto: () => void | Promise<void>): void {
    this.empresaActual(); // exige un contexto activo, como el resto de la API
    const estado = estadoActual();
    if (estado?.transaccion === undefined || estado.efectos === undefined) {
      throw new ContextoEmpresaAusenteError();
    }
    estado.efectos.push(efecto);
  }

  /** Corre los efectos ya confirmados, cada uno en su try/catch; nunca lanza. */
  private async correrEfectos(efectos: Array<() => void | Promise<void>>): Promise<void> {
    for (const efecto of efectos.splice(0)) {
      try {
        await efecto();
      } catch (error) {
        this.logger.error(
          'Falló un efecto posterior a la confirmación; la transacción ya estaba confirmada',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** Empresa del contexto activo; lanza `ContextoEmpresaAusenteError` si no hay contexto. */
  empresaActual(): string {
    const empresaId = estadoActual()?.empresaId;
    if (empresaId === undefined) throw new ContextoEmpresaAusenteError();
    return empresaId;
  }
}
