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
  TopeDeIntentos,
  VIGENCIA_RESERVA_MS,
  armarTokenSuperadministrador,
  parsearTokenSuperadministrador,
  segundosHasta,
} from '../seguridad';
import { OperacionPlataforma } from './operacion-plataforma';
import type { SuperadministradorAutenticado, TransaccionPlataforma } from './tipos';

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

interface FilaSuperadministrador {
  id: string;
  nombre: string;
  hash_contrasena: string;
  activo: boolean;
  bloqueado_hasta: Date | null;
  fallos_seguidos: number;
  actualizado_en: Date;
}

const bloqueoTemporal = (hasta: Date, ahora: Date) =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    segundosHasta(hasta, ahora),
  );

/** Aviso interno de `bloquearSiCorresponde`: otro ya puso el bloqueo; revierte sin escribir nada. */
class SinBloqueoNuevo extends Error {}

/** Aviso interno de `reservarIntento`: no hay superadministrador activo con ese nombre; revierte sin escribir nada. */
class SinCuenta extends Error {}

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
    @Inject(TopeDeIntentos) private readonly tope: TopeDeIntentos,
  ) {}

  /**
   * `POST /plataforma/sesiones` (criterio 61). Va en tres tiempos y ninguna conexión ni bloqueo de fila queda
   * retenido mientras corre scrypt (mismo diseño que el ingreso de las personas de empresa):
   *
   * 1. Operación corta que bloquea la fila del superadministrador activo (`FOR NO KEY UPDATE`), revisa el
   *    bloqueo y **reserva el intento** (lo cuenta como fallo de antemano). Con el bloqueo vigente, o con el
   *    cupo de evaluaciones en curso lleno, responde 429 sin evaluar y sin escribir nada: ninguna ráfaga evalúa
   *    más de 5 contraseñas.
   * 2. La contraseña se evalúa fuera de toda operación.
   * 3. Otra operación corta aplica el resultado: si falló, deja su fila de auditoría y pone el bloqueo cuando
   *    la cuenta llegó a 5; si es correcta, vuelve a bloquear la fila, comprueba que sigue activo, crea la
   *    sesión y reinicia la cuenta sin borrar un bloqueo vigente.
   */
  async ingresar(
    entrada: IngresoSuperadministradorEntrada,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const usuario = minusculasAscii(entrada.usuario);
    // Una ráfaga contra un mismo nombre no pasa del tope: lo demás se rechaza sin tocar la base.
    const { soltar } = this.tope.entrar(`superadministrador:${usuario}`);
    try {
      return await this.ingresarConTope(usuario, entrada.contrasena);
    } finally {
      soltar();
    }
  }

  private async ingresarConTope(
    usuario: string,
    contrasena: string,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const reserva = await this.reservarIntento(usuario);
    if (reserva === null) return this.rechazarSinCuenta(usuario, contrasena);
    if ('error' in reserva) throw reserva.error;

    const { fila } = reserva;
    let correcta: boolean;
    try {
      correcta = await this.credenciales.verificarContrasena(contrasena, fila.hash_contrasena);
    } catch {
      correcta = false; // el intento ya se contó: un error al evaluar cuenta como contraseña incorrecta
    }
    if (!correcta) {
      await this.registrarFallo(fila, usuario);
      throw credencialesInvalidas();
    }
    return this.abrirSesion(fila, usuario);
  }

  /** Nombre sin superadministrador activo: mismo scrypt y misma respuesta que una contraseña mala, con tope de evaluaciones en curso. */
  private async rechazarSinCuenta(usuario: string, contrasena: string): Promise<never> {
    await this.tope.conTopeFalso(`superadministrador:${usuario}`, () =>
      this.credenciales.verificarContrasenaFalsa(contrasena),
    );
    throw credencialesInvalidas();
  }

  /**
   * Tiempo 1. Devuelve la fila reservada (`fila.fallos_seguidos` es el turno de este intento), el rechazo a
   * responder, o `null` si no hay superadministrador activo con ese nombre. Se confirma (y deja su fila de
   * auditoría `intento_ingreso_superadministrador`) el intento que se evalúa y el que llega con el cupo
   * lleno, que también cuenta; un nombre sin cuenta o un bloqueo vigente revierten la operación con un
   * aviso interno y no escriben nada.
   */
  private async reservarIntento(
    usuario: string,
  ): Promise<{ fila: FilaSuperadministrador } | { error: ErrorAplicacion } | null> {
    try {
      return await this.operacion.ejecutar(
        {
          actor: 'autenticacion',
          motivo: 'Intento de ingreso de superadministrador',
          operacion: 'intento_ingreso_superadministrador',
        },
        (transaccion) => this.reservar(transaccion, usuario),
      );
    } catch (error) {
      if (error instanceof SinCuenta) return null;
      throw error;
    }
  }

  private async reservar(
    transaccion: TransaccionPlataforma,
    usuario: string,
  ): Promise<{ fila: FilaSuperadministrador } | { error: ErrorAplicacion }> {
    const sequelize = sequelizeDe(transaccion);
    const filas = await sequelize.query<FilaSuperadministrador>(
      `SELECT id, nombre, hash_contrasena, activo, bloqueado_hasta, fallos_seguidos, actualizado_en
         FROM superadministrador WHERE usuario = $1 AND activo
          FOR NO KEY UPDATE`,
      { transaction: transaccion, bind: [usuario], type: QueryTypes.SELECT },
    );
    // La hora se toma después de esperar el turno.
    const ahora = this.reloj.ahora();
    const fila = filas[0];
    if (fila === undefined) throw new SinCuenta();
    let fallos = fila.fallos_seguidos;
    if (fila.bloqueado_hasta !== null) {
      if (fila.bloqueado_hasta.getTime() > ahora.getTime()) {
        throw bloqueoTemporal(fila.bloqueado_hasta, ahora);
      }
      fallos = 0; // el bloqueo venció: la cuenta empieza de cero
    } else if (
      fallos >= FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR &&
      ahora.getTime() - fila.actualizado_en.getTime() >= VIGENCIA_RESERVA_MS
    ) {
      fallos = 0; // una reserva que nadie resolvió (el proceso murió a media evaluación)
    }
    // Un intento que llega con las 5 evaluaciones en curso sin resolver no se evalúa, pero cuenta: llegó
    // después de ellas y, si ninguna resulta correcta, habría sido un fallo más. Solo el que se evalúa
    // renueva `actualizado_en` (hora de la última reserva viva).
    const turno = fallos + 1;
    const evaluable = turno <= FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR;
    await sequelize.query(
      `UPDATE superadministrador
          SET fallos_seguidos = $2, bloqueado_hasta = NULL,
              actualizado_en = CASE WHEN $4::boolean OR bloqueado_hasta IS NOT NULL THEN $3 ELSE actualizado_en END
        WHERE id = $1`,
      { transaction: transaccion, bind: [fila.id, turno, ahora, evaluable] },
    );
    this.operacion.registrarDatosDeAuditoria(transaccion, {
      entidad: 'superadministrador',
      entidadId: fila.id,
      detalle: {
        superadministradorId: fila.id,
        usuario,
        fallosSeguidos: turno,
        evaluado: evaluable,
      },
    });
    if (!evaluable) {
      return {
        error: bloqueoTemporal(
          new Date(ahora.getTime() + MINUTOS_BLOQUEO_SUPERADMINISTRADOR * MINUTO_MS),
          ahora,
        ),
      };
    }
    return { fila: { ...fila, fallos_seguidos: turno } };
  }

  /**
   * Tiempo 3, contraseña incorrecta (actor `autenticacion`). El intento ya se contó al reservarlo; aquí se
   * deja la fila de auditoría del fallo y, si la cuenta llegó a 5 y aún no hay bloqueo, se pone (una vez) con
   * la suya.
   */
  private async registrarFallo(fila: FilaSuperadministrador, usuario: string): Promise<void> {
    await this.operacion.ejecutar(
      {
        actor: 'autenticacion',
        motivo: 'Ingreso fallido de superadministrador',
        operacion: 'ingreso_superadministrador_fallido',
      },
      async (transaccion) => {
        await this.bloquearFila(transaccion, fila.id);
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: fila.id,
          detalle: { superadministradorId: fila.id, usuario, fallosSeguidos: fila.fallos_seguidos },
        });
        const ahora = this.reloj.ahora();
        const bloqueo = await this.ponerBloqueo(transaccion, fila.id);
        if (bloqueo === null) return;
        await insertarAuditoriaPlataforma(transaccion, {
          accion: 'bloqueo_superadministrador',
          motivo: 'Bloqueo por intentos fallidos de superadministrador',
          entidad: 'superadministrador',
          entidadId: fila.id,
          detalle: {
            superadministradorId: fila.id,
            usuario,
            fallosSeguidos: bloqueo.fallosSeguidos,
            bloqueadoHasta: bloqueo.hasta.toISOString(),
          },
          ocurridoEn: ahora,
        });
      },
    );
  }

  /**
   * Un ingreso correcto cuya evaluación coincidió con una ráfaga: los intentos que llegaron después de él ya
   * llenan el umbral y nadie puso el bloqueo. Lo pone con su fila de auditoría (la operación misma); si
   * otro ya lo puso, no escribe nada.
   */
  private async bloquearSiCorresponde(
    superadministradorId: string,
    usuario: string,
  ): Promise<void> {
    try {
      await this.operacion.ejecutar(
        {
          actor: 'autenticacion',
          motivo: 'Bloqueo por intentos fallidos de superadministrador',
          operacion: 'bloqueo_superadministrador',
        },
        async (transaccion) => {
          await this.bloquearFila(transaccion, superadministradorId);
          const bloqueo = await this.ponerBloqueo(transaccion, superadministradorId);
          if (bloqueo === null) throw new SinBloqueoNuevo();
          this.operacion.registrarDatosDeAuditoria(transaccion, {
            entidad: 'superadministrador',
            entidadId: superadministradorId,
            detalle: {
              superadministradorId,
              usuario,
              fallosSeguidos: bloqueo.fallosSeguidos,
              bloqueadoHasta: bloqueo.hasta.toISOString(),
            },
          });
        },
      );
    } catch (error) {
      if (!(error instanceof SinBloqueoNuevo)) throw error;
    }
  }

  private async bloquearFila(transaccion: TransaccionPlataforma, id: string): Promise<void> {
    await sequelizeDe(transaccion).query(
      'SELECT id FROM superadministrador WHERE id = $1 FOR NO KEY UPDATE',
      { transaction: transaccion, bind: [id], type: QueryTypes.SELECT },
    );
  }

  /** Pone el bloqueo si la cuenta llegó al umbral y todavía no hay (una sola vez por bloqueo); `null` si no. */
  private async ponerBloqueo(
    transaccion: TransaccionPlataforma,
    id: string,
  ): Promise<{ hasta: Date; fallosSeguidos: number } | null> {
    const ahora = this.reloj.ahora();
    const hasta = new Date(ahora.getTime() + MINUTOS_BLOQUEO_SUPERADMINISTRADOR * MINUTO_MS);
    const bloqueadas = await sequelizeDe(transaccion).query<{ fallos_seguidos: number }>(
      `UPDATE superadministrador SET bloqueado_hasta = $2, actualizado_en = $3
        WHERE id = $1 AND bloqueado_hasta IS NULL AND fallos_seguidos >= $4
        RETURNING fallos_seguidos`,
      {
        transaction: transaccion,
        bind: [id, hasta, ahora, FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR],
        type: QueryTypes.SELECT,
      },
    );
    return bloqueadas[0] === undefined
      ? null
      : { hasta, fallosSeguidos: bloqueadas[0].fallos_seguidos };
  }

  /**
   * Tiempo 3, contraseña correcta: con la fila bloqueada comprueba que sigue activo y con la misma contraseña
   * (si lo desactivaron mientras se evaluaba, 401 y no queda sesión ni auditoría de ingreso: la desactivación
   * toma el mismo bloqueo, así que una de las dos va primero), crea la sesión, reinicia la cuenta de fallos
   * sin borrar un bloqueo vigente y audita el ingreso.
   */
  private async abrirSesion(
    verificado: FilaSuperadministrador,
    usuario: string,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const secreto = this.credenciales.generarSecreto();
    const sesionId = randomUUID();
    const bloquear = await this.operacion.ejecutar(
      {
        actor: { superadministradorId: verificado.id },
        motivo: 'Ingreso de superadministrador',
        operacion: 'ingreso_superadministrador',
      },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        const actuales = await sequelize.query<{ activo: boolean; hash_contrasena: string }>(
          `SELECT activo, hash_contrasena FROM superadministrador WHERE id = $1
            FOR NO KEY UPDATE`,
          { transaction: transaccion, bind: [verificado.id], type: QueryTypes.SELECT },
        );
        const ahora = this.reloj.ahora(); // después de esperar el turno
        const actual = actuales[0];
        if (
          actual === undefined ||
          !actual.activo ||
          actual.hash_contrasena !== verificado.hash_contrasena
        ) {
          throw credencialesInvalidas(); // revierte: sin sesión y sin fila de ingreso
        }
        await sequelize.query(
          `INSERT INTO sesion_superadministrador (id, superadministrador_id, huella_secreto, expira_en, creado_en)
           VALUES ($1, $2, $3, $4, $5)`,
          {
            transaction: transaccion,
            bind: [
              sesionId,
              verificado.id,
              this.credenciales.huellaSecreto(secreto),
              new Date(ahora.getTime() + HORAS_SESION_SUPERADMINISTRADOR * HORA_MS),
              ahora,
            ],
          },
        );
        // Un ingreso correcto perdona los intentos hasta su turno (como un ingreso correcto antes del quinto
        // fallo) y conserva los que llegaron después, pero nunca levanta un bloqueo vigente.
        const quedan = await sequelize.query<{ fallos_seguidos: number }>(
          `UPDATE superadministrador
              SET fallos_seguidos = CASE WHEN bloqueado_hasta IS NOT NULL THEN 0
                                         ELSE GREATEST(fallos_seguidos - $3, 0) END,
                  bloqueado_hasta = NULL, actualizado_en = $2
            WHERE id = $1 AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= $2)
            RETURNING fallos_seguidos`,
          {
            transaction: transaccion,
            bind: [verificado.id, ahora, verificado.fallos_seguidos],
            type: QueryTypes.SELECT,
          },
        );
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: verificado.id,
          detalle: { superadministradorId: verificado.id, usuario },
        });
        // `true` si los intentos posteriores ya llenan el umbral y nadie puso el bloqueo.
        return (quedan[0]?.fallos_seguidos ?? 0) >= FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR;
      },
    );
    if (bloquear) await this.bloquearSiCorresponde(verificado.id, usuario);
    return {
      token: armarTokenSuperadministrador(sesionId, secreto),
      superadministrador: { id: verificado.id, nombre: verificado.nombre },
    };
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
