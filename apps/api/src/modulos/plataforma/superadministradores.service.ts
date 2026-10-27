import { Inject, Injectable } from '@nestjs/common';
import {
  minusculasAscii,
  type IngresoSuperadministradorEntrada,
  type IngresoSuperadministradorRespuesta,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { insertarAuditoriaPlataforma } from '../auditoria';
import {
  Credenciales,
  armarTokenSuperadministrador,
  parsearTokenSuperadministrador,
  segundosHasta,
} from '../seguridad';
import { OperacionPlataforma } from './operacion-plataforma';
import type { SuperadministradorAutenticado } from './tipos';

/** Duración de una sesión de superadministrador (criterio 61); sin inactividad en el servidor. */
export const HORAS_SESION_SUPERADMINISTRADOR = 8;
/** Fallos seguidos que bloquean el ingreso y por cuánto (criterio 61). */
export const FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR = 5;
export const MINUTOS_BLOQUEO_SUPERADMINISTRADOR = 15;

const HORA_MS = 3_600_000;
const MINUTO_MS = 60_000;

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

const credencialesInvalidas = () =>
  new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');

/** Resultado de validar un token `sa.…`: la persona o por qué no vale. */
export type ValidacionSesionSuperadministrador =
  | { valida: true; superadministrador: SuperadministradorAutenticado }
  | { valida: false; motivo: 'INVALIDA' | 'EXPIRADA' };

/**
 * Ingreso, salida y validación de las sesiones del superadministrador (criterios 61 y 62). Todo corre por la
 * vía de plataforma: lecturas con `OperacionPlataforma.consultar` y escrituras con `ejecutar`, que audita
 * cada una sin empresa. Los fallos y el bloqueo se guardan en su propia operación y el error se lanza
 * después de confirmarla.
 */
@Injectable()
export class SuperadministradoresService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
  ) {}

  /** `POST /plataforma/sesiones`. */
  async ingresar(
    entrada: IngresoSuperadministradorEntrada,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const usuario = minusculasAscii(entrada.usuario);
    const ahora = this.reloj.ahora();
    const fila = await this.operacion.consultar(async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<{
        id: string;
        nombre: string;
        hash_contrasena: string;
        activo: boolean;
        bloqueado_hasta: Date | null;
      }>(
        `SELECT id, nombre, hash_contrasena, activo, bloqueado_hasta
           FROM superadministrador WHERE usuario = $1`,
        { transaction: transaccion, bind: [usuario], type: QueryTypes.SELECT },
      );
      return filas[0];
    });
    if (fila === undefined || !fila.activo) {
      // Inexistente o inactivo: el mismo tiempo y el mismo cuerpo que una contraseña incorrecta.
      await this.credenciales.verificarContrasenaFalsa(entrada.contrasena);
      throw credencialesInvalidas();
    }
    if (fila.bloqueado_hasta !== null && fila.bloqueado_hasta.getTime() > ahora.getTime()) {
      throw new ErrorAplicacion(
        429,
        'BLOQUEO_TEMPORAL',
        'Demasiados intentos fallidos; intenta de nuevo más tarde',
        undefined,
        segundosHasta(fila.bloqueado_hasta, ahora),
      );
    }

    const correcta = await this.credenciales.verificarContrasena(
      entrada.contrasena,
      fila.hash_contrasena,
    );
    if (!correcta) {
      await this.registrarFallo(fila.id, usuario);
      throw credencialesInvalidas();
    }

    const secreto = this.credenciales.generarSecreto();
    const sesionId = randomUUID();
    await this.operacion.ejecutar(
      {
        actor: { superadministradorId: fila.id },
        motivo: 'Ingreso de superadministrador',
        operacion: 'ingreso_superadministrador',
      },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        await sequelize.query(
          `INSERT INTO sesion_superadministrador (id, superadministrador_id, huella_secreto, expira_en, creado_en)
           VALUES ($1, $2, $3, $4, $5)`,
          {
            transaction: transaccion,
            bind: [
              sesionId,
              fila.id,
              this.credenciales.huellaSecreto(secreto),
              new Date(ahora.getTime() + HORAS_SESION_SUPERADMINISTRADOR * HORA_MS),
              ahora,
            ],
          },
        );
        // Un ingreso correcto reinicia la cuenta de fallos.
        await sequelize.query(
          `UPDATE superadministrador SET fallos_seguidos = 0, bloqueado_hasta = NULL, actualizado_en = $2
            WHERE id = $1`,
          { transaction: transaccion, bind: [fila.id, ahora] },
        );
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: fila.id,
          detalle: { superadministradorId: fila.id, usuario },
        });
      },
    );
    return {
      token: armarTokenSuperadministrador(sesionId, secreto),
      superadministrador: { id: fila.id, nombre: fila.nombre },
    };
  }

  /** Cuenta un fallo; al quinto bloquea 15 minutos y deja su fila de auditoría. Actor: `autenticacion`. */
  private async registrarFallo(superadministradorId: string, usuario: string): Promise<void> {
    const ahora = this.reloj.ahora();
    await this.operacion.ejecutar(
      {
        actor: 'autenticacion',
        motivo: 'Ingreso fallido de superadministrador',
        operacion: 'ingreso_superadministrador_fallido',
      },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        // Si el bloqueo anterior ya venció, la cuenta vuelve a empezar en 1; la fila queda bloqueada
        // para que los fallos concurrentes se cuenten uno detrás de otro.
        const contados = await sequelize.query<{ fallos_seguidos: number }>(
          `UPDATE superadministrador SET
              fallos_seguidos = CASE
                WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= $2 THEN 1
                ELSE fallos_seguidos + 1 END,
              bloqueado_hasta = CASE
                WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= $2 THEN NULL
                ELSE bloqueado_hasta END,
              actualizado_en = $2
            WHERE id = $1
            RETURNING fallos_seguidos`,
          {
            transaction: transaccion,
            bind: [superadministradorId, ahora],
            type: QueryTypes.SELECT,
          },
        );
        const fallos = contados[0]!.fallos_seguidos;
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: superadministradorId,
          detalle: { superadministradorId, usuario, fallosSeguidos: fallos },
        });
        if (fallos < FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR) return;
        const hasta = new Date(ahora.getTime() + MINUTOS_BLOQUEO_SUPERADMINISTRADOR * MINUTO_MS);
        const bloqueadas = await sequelize.query<{ id: string }>(
          `UPDATE superadministrador SET bloqueado_hasta = $2
            WHERE id = $1 AND bloqueado_hasta IS NULL
            RETURNING id`,
          {
            transaction: transaccion,
            bind: [superadministradorId, hasta],
            type: QueryTypes.SELECT,
          },
        );
        if (bloqueadas.length > 0) {
          await insertarAuditoriaPlataforma(transaccion, {
            accion: 'bloqueo_superadministrador',
            motivo: 'Bloqueo por intentos fallidos de superadministrador',
            entidad: 'superadministrador',
            entidadId: superadministradorId,
            detalle: {
              superadministradorId,
              usuario,
              fallosSeguidos: fallos,
              bloqueadoHasta: hasta.toISOString(),
            },
            ocurridoEn: ahora,
          });
        }
      },
    );
  }

  /** `DELETE /plataforma/sesion`: cierra la sesión y la audita. */
  async salir(superadministrador: SuperadministradorAutenticado): Promise<void> {
    const ahora = this.reloj.ahora();
    await this.operacion.ejecutar(
      {
        actor: { superadministradorId: superadministrador.id },
        motivo: 'Salida de superadministrador',
        operacion: 'salida_superadministrador',
      },
      async (transaccion) => {
        await sequelizeDe(transaccion).query(
          `UPDATE sesion_superadministrador SET cerrada_en = $2
            WHERE id = $1 AND cerrada_en IS NULL`,
          { transaction: transaccion, bind: [superadministrador.sesionId, ahora] },
        );
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: superadministrador.id,
          detalle: { superadministradorId: superadministrador.id },
        });
      },
    );
  }

  /**
   * Valida un token `sa.<sesión>.<secreto>` (lo usa `SuperadministradorGuard`): la huella del secreto en
   * tiempo constante, que la sesión no esté cerrada ni vencida (8 horas desde que se creó) y que la
   * persona siga activa. Solo lectura.
   */
  async validarToken(token: string): Promise<ValidacionSesionSuperadministrador> {
    const partes = parsearTokenSuperadministrador(token);
    if (partes === null) return { valida: false, motivo: 'INVALIDA' };
    const ahora = this.reloj.ahora();
    const fila = await this.operacion.consultar(async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<{
        id: string;
        huella_secreto: Buffer;
        expira_en: Date;
        cerrada_en: Date | null;
        superadministrador_id: string;
        nombre: string;
        activo: boolean;
      }>(
        `SELECT s.id, s.huella_secreto, s.expira_en, s.cerrada_en, s.superadministrador_id, a.nombre, a.activo
           FROM sesion_superadministrador s
           JOIN superadministrador a ON a.id = s.superadministrador_id
          WHERE s.id = $1`,
        { transaction: transaccion, bind: [partes.sesionId], type: QueryTypes.SELECT },
      );
      return filas[0];
    });
    if (
      fila === undefined ||
      !this.credenciales.secretoCoincide(partes.secreto, fila.huella_secreto) ||
      fila.cerrada_en !== null ||
      !fila.activo
    ) {
      return { valida: false, motivo: 'INVALIDA' };
    }
    if (ahora.getTime() >= fila.expira_en.getTime()) return { valida: false, motivo: 'EXPIRADA' };
    return {
      valida: true,
      superadministrador: {
        id: fila.superadministrador_id,
        nombre: fila.nombre,
        sesionId: fila.id,
      },
    };
  }
}
