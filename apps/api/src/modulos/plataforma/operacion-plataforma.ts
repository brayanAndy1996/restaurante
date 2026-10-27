import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import type { ActorTransaccion } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { insertarAuditoriaPlataforma } from '../auditoria';
import type { TransaccionInterna } from '../../nucleo/base-de-datos/transaccion-interna';
import {
  ejecutarConEstado,
  estadoActual,
  terminarEstado,
  type EstadoOperacion,
} from '../../nucleo/base-de-datos';
import {
  CONEXION_PLATAFORMA,
  ConexionPlataforma,
} from '../../nucleo/base-de-datos/conexion-plataforma';
import { textoObligatorio, validarAuditoria } from './auditoria';
import { OperacionPlataformaAnidadaError, OperacionPlataformaCerradaError } from './errores';
import type { ActorPlataforma, OpcionesOperacionPlataforma, TransaccionPlataforma } from './tipos';

/** Datos que una operación agrega a su fila de auditoría mientras corre. */
export interface DatosAuditoria {
  empresaId?: string;
  sucursalId?: string;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
}

/** Actor de trazabilidad de la transacción: texto → sistema; `{ superadministradorId }` → superadministrador. */
function actorDeTransaccion(actor: ActorPlataforma): ActorTransaccion {
  return typeof actor === 'string' ? { sistema: actor } : actor;
}

/**
 * Operaciones del superadministrador que no pertenecen a una empresa. Usa la conexión de
 * `restaurante_plataforma`, abre una transacción explícita, fija su actor (historia 002, criterio 117: un
 * texto es un actor de sistema y `{ superadministradorId }`, el superadministrador), corre `fn` y escribe
 * la fila de auditoría en `auditoria` (origen plataforma, con la hora del reloj de la API) en esa misma
 * transacción antes de confirmar: o queda el cambio con su auditoría, o no queda nada. `fn` no puede confirmar ni revertir la transacción por su cuenta: si lo intenta, la
 * operación falla y no queda nada (criterio 32b). No se puede llamar dentro de un contexto de empresa ni de otra operación de plataforma.
 */
@Injectable()
export class OperacionPlataforma {
  private readonly datosDeAuditoria = new WeakMap<Transaction, DatosAuditoria>();

  constructor(
    @Inject(CONEXION_PLATAFORMA) private readonly conexion: ConexionPlataforma,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  async ejecutar<T>(
    opciones: OpcionesOperacionPlataforma,
    fn: (transaccion: TransaccionPlataforma) => Promise<T>,
  ): Promise<T> {
    const { actor, motivo } = validarAuditoria(opciones);
    const operacion = textoObligatorio('operacion', opciones.operacion, 'La operación');
    this.exigirSinContexto();

    return this.enTransaccion(
      async (transaccion) => {
        const resultado = await fn(transaccion);
        this.exigirAbierta(transaccion);
        const datos = this.datosDeAuditoria.get(transaccion);
        await insertarAuditoriaPlataforma(transaccion, {
          accion: operacion,
          empresaId: opciones.empresaId ?? datos?.empresaId ?? null,
          sucursalId: datos?.sucursalId ?? null,
          motivo,
          entidad: datos?.entidad ?? null,
          entidadId: datos?.entidadId ?? null,
          sesionId: opciones.sesionId ?? null,
          detalle: datos?.detalle ?? {},
          ocurridoEn: this.reloj.ahora(),
        });
        return resultado;
      },
      { confirmar: true, actor: actorDeTransaccion(actor) },
    );
  }

  /**
   * Agrega la empresa afectada y el detalle a la fila de auditoría de la operación en curso (por
   * ejemplo, el id de la empresa que acaba de crear `registrar_empresa`).
   */
  registrarDatosDeAuditoria(transaccion: TransaccionPlataforma, datos: DatosAuditoria): void {
    this.datosDeAuditoria.set(transaccion, { ...this.datosDeAuditoria.get(transaccion), ...datos });
  }

  /**
   * Lectura por la vía de plataforma, sin auditoría ni cambios: la transacción es de solo lectura y
   * siempre se revierte; `fn` no puede confirmarla (criterio 32b). Mismas restricciones de anidamiento que `ejecutar`.
   */
  async consultar<T>(fn: (transaccion: TransaccionPlataforma) => Promise<T>): Promise<T> {
    this.exigirSinContexto();
    return this.enTransaccion(fn, { confirmar: false });
  }

  /** `fn` no puede haber cerrado la transacción (la guarda ya lo impide; esto cubre un error tragado). */
  private exigirAbierta(transaccion: Transaction): void {
    if ((transaccion as TransaccionInterna).finished) throw new OperacionPlataformaCerradaError();
  }

  private exigirSinContexto(): void {
    if (estadoActual() !== undefined) throw new OperacionPlataformaAnidadaError();
  }

  private enTransaccion<T>(
    fn: (transaccion: TransaccionPlataforma) => Promise<T>,
    { confirmar, actor }: { confirmar: boolean; actor?: ActorTransaccion } = { confirmar: true },
  ): Promise<T> {
    const estado: EstadoOperacion = { plataforma: true };
    return ejecutarConEstado(estado, async () => {
      const transaccion = (await this.conexion.abrirTransaccion({
        soloLectura: !confirmar,
      })) as TransaccionInterna;
      try {
        let resultado: T;
        try {
          // El actor se fija antes que nada: toda escritura de la operación (y su auditoría) lo lleva.
          if (actor !== undefined) await this.conexion.fijarActor(transaccion, actor);
          resultado = await fn(transaccion);
          this.exigirAbierta(transaccion);
        } finally {
          // `fn` terminó (bien o mal): el código que siga vivo con este almacén ya no está dentro de
          // una operación de plataforma ni de ningún contexto (criterio 27b).
          terminarEstado(estado);
        }
        if (confirmar) await this.conexion.confirmar(transaccion);
        else await this.conexion.revertir(transaccion);
        return resultado;
      } catch (error) {
        if (!transaccion.finished) {
          try {
            await this.conexion.revertir(transaccion);
          } catch {
            // Sequelize destruye la conexión si el rollback falla; importa el error original.
          }
        }
        throw error;
      }
    });
  }
}
