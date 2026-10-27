import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import type { TransaccionInterna } from '../../nucleo/base-de-datos/transaccion-interna';
import { ejecutarConEstado, estadoActual } from '../../nucleo/base-de-datos';
import {
  CONEXION_PLATAFORMA,
  ConexionPlataforma,
} from '../../nucleo/base-de-datos/conexion-plataforma';
import { textoObligatorio, validarAuditoria } from './auditoria';
import { OperacionPlataformaAnidadaError } from './errores';
import { MODELOS_PLATAFORMA, type Modelos } from './modelos';
import type { OpcionesOperacionPlataforma, TransaccionPlataforma } from './tipos';

/** Datos que una operación agrega a su fila de auditoría mientras corre. */
export interface DatosAuditoria {
  empresaId?: string;
  detalle?: unknown;
}

/**
 * Operaciones del superadministrador que no pertenecen a una empresa. Usa la conexión de
 * `restaurante_plataforma`, abre una transacción explícita, corre `fn` y escribe la fila de
 * auditoría en esa misma transacción antes de confirmar: o queda el cambio con su auditoría, o no
 * queda nada. No se puede llamar dentro de un contexto de empresa ni de otra operación de plataforma.
 */
@Injectable()
export class OperacionPlataforma {
  private readonly datosDeAuditoria = new WeakMap<Transaction, DatosAuditoria>();

  constructor(
    @Inject(CONEXION_PLATAFORMA) private readonly conexion: ConexionPlataforma,
    @Inject(MODELOS_PLATAFORMA) private readonly modelos: Modelos,
  ) {}

  async ejecutar<T>(
    opciones: OpcionesOperacionPlataforma,
    fn: (transaccion: TransaccionPlataforma) => Promise<T>,
  ): Promise<T> {
    const { actor, motivo } = validarAuditoria(opciones);
    const operacion = textoObligatorio('operacion', opciones.operacion, 'La operación');
    this.exigirSinContexto();

    const Auditoria = this.modelos.AuditoriaPlataforma;
    if (!Auditoria) throw new Error('Los modelos de plataforma no incluyen la auditoría');

    return this.enTransaccion(async (transaccion) => {
      const resultado = await fn(transaccion);
      const datos = this.datosDeAuditoria.get(transaccion);
      await Auditoria.create(
        {
          actor,
          operacion,
          motivo,
          empresaId: opciones.empresaId ?? datos?.empresaId ?? null,
          detalle: datos?.detalle ?? {},
        },
        { transaction: transaccion },
      );
      return resultado;
    });
  }

  /**
   * Agrega la empresa afectada y el detalle a la fila de auditoría de la operación en curso (por
   * ejemplo, el id de la empresa que acaba de crear `registrar_empresa`).
   */
  registrarDatosDeAuditoria(transaccion: TransaccionPlataforma, datos: DatosAuditoria): void {
    this.datosDeAuditoria.set(transaccion, { ...this.datosDeAuditoria.get(transaccion), ...datos });
  }

  /**
   * Lectura por la vía de plataforma, sin auditoría ni cambios (la transacción siempre se revierte).
   * Mismas restricciones de anidamiento que `ejecutar`.
   */
  async consultar<T>(fn: (transaccion: TransaccionPlataforma) => Promise<T>): Promise<T> {
    this.exigirSinContexto();
    return this.enTransaccion(fn, { confirmar: false });
  }

  private exigirSinContexto(): void {
    if (estadoActual() !== undefined) throw new OperacionPlataformaAnidadaError();
  }

  private enTransaccion<T>(
    fn: (transaccion: TransaccionPlataforma) => Promise<T>,
    { confirmar }: { confirmar: boolean } = { confirmar: true },
  ): Promise<T> {
    return ejecutarConEstado({ plataforma: true }, async () => {
      const transaccion = (await this.conexion.abrirTransaccion()) as TransaccionInterna;
      try {
        const resultado = await fn(transaccion);
        if (confirmar) await transaccion.commit();
        else await transaccion.rollback();
        return resultado;
      } catch (error) {
        if (!transaccion.finished) {
          try {
            await transaccion.rollback();
          } catch {
            // Sequelize destruye la conexión si el rollback falla; importa el error original.
          }
        }
        throw error;
      }
    });
  }
}
