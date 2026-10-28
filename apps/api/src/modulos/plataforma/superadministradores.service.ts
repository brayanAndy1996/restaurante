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
  CupoScrypt,
  GRUPO_PLATAFORMA,
  GRUPO_SIN_CUENTA_PLATAFORMA,
  TopeDeIntentos,
  armarTokenSuperadministrador,
  claveDeIngresoSuperadministrador,
  credencialesInvalidas,
  decidirReserva,
  errorDeReserva,
  parsearTokenSuperadministrador,
  resolverFalloEnFila,
  type FilaDeFallo,
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

interface FilaSuperadministrador {
  id: string;
  nombre: string;
  hash_contrasena: string;
  activo: boolean;
  bloqueado_hasta: Date | null;
  fallos_seguidos: number;
  en_curso: number;
  en_curso_desde: Date | null;
}

/** Aviso interno de `reservarIntento`: no hay superadministrador activo con ese nombre; revierte sin escribir nada. */
class SinCuenta extends Error {}

/** Aviso interno de `reservar`: la reserva se rechaza (bloqueo o cupo lleno); revierte sin escribir nada. */
class ReservaRechazada extends Error {
  constructor(readonly error: ErrorAplicacion) {
    super(error.message);
  }
}

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
    @Inject(CupoScrypt) private readonly cupo: CupoScrypt,
  ) {}

  /**
   * `POST /plataforma/sesiones` (criterio 61). Va en tres tiempos y ninguna conexión ni bloqueo de fila queda
   * retenido mientras corre scrypt (mismo diseño que el ingreso de las personas de empresa):
   *
   * 0. Tope de ingresos por nombre, turno (uno a la vez por nombre), una lectura corta que dice si el nombre es
   *    de un superadministrador **activo** y un cupo del scrypt (`CupoScrypt`): los activos van al grupo
   *    `plataforma` y los demás (nombres inventados) a su propio grupo `sin-cuenta-plataforma`, así una
   *    inundación de nombres inexistentes no llena la cola donde espera el superadministrador real (criterio
   *    61). Lo que no entra a tiempo responde 429 de 1 s, sin evaluar y sin contar como fallo.
   * 1. Operación corta que bloquea la fila del superadministrador activo (`FOR NO KEY UPDATE`), revisa el
   *    bloqueo y **reserva el intento** (lo marca "en curso"). Con el bloqueo vigente responde 429 de la
   *    duración restante; con `fallos + en curso` en el umbral, 429 de 1 s: sin evaluar, sin contar y sin
   *    escribir nada. Ninguna ráfaga evalúa más de 5 contraseñas.
   * 2. La contraseña se evalúa fuera de toda operación.
   * 3. Otra operación corta aplica el resultado: si falló, cuenta el fallo, deja su fila de auditoría y pone el
   *    bloqueo cuando la cuenta llegó a 5; si es correcta, vuelve a bloquear la fila, comprueba que sigue
   *    activo, crea la sesión y reinicia la cuenta de fallos sin borrar un bloqueo vigente.
   *
   * Un nombre sin superadministrador activo toma el mismo cupo, gasta el mismo scrypt y responde igual que una
   * contraseña incorrecta.
   */
  async ingresar(
    entrada: IngresoSuperadministradorEntrada,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const usuario = minusculasAscii(entrada.usuario);
    // Una ráfaga contra un mismo nombre no pasa del tope: lo demás se rechaza sin tocar la base.
    const clave = claveDeIngresoSuperadministrador(usuario);
    const { soltar } = this.tope.entrar(clave);
    try {
      return await this.tope.conTurno(clave, async () => {
        if (await this.hayActivo(usuario)) {
          return this.cupo.conCupo(GRUPO_PLATAFORMA, () =>
            this.ingresarConCupo(usuario, entrada.contrasena),
          );
        }
        // Sin superadministrador activo: mismo scrypt y misma respuesta que una contraseña mala, en su grupo.
        return this.cupo.conCupo(GRUPO_SIN_CUENTA_PLATAFORMA, () =>
          this.rechazarSinCuenta(entrada.contrasena),
        );
      });
    } finally {
      soltar();
    }
  }

  /**
   * Lectura corta y sin bloqueo de fila (solo lectura, sin auditoría): ¿hay un superadministrador activo con
   * ese nombre? Decide el grupo del cupo; la reserva definitiva la vuelve a comprobar con la fila bloqueada.
   */
  private async hayActivo(usuario: string): Promise<boolean> {
    return this.operacion.consultar(async (transaccion) => {
      const filas = await sequelizeDe(transaccion).query<{ id: string }>(
        'SELECT id FROM superadministrador WHERE usuario = $1 AND activo',
        { transaction: transaccion, bind: [usuario], type: QueryTypes.SELECT },
      );
      return filas.length > 0;
    });
  }

  private async rechazarSinCuenta(contrasena: string): Promise<never> {
    await this.credenciales.verificarContrasenaFalsa(contrasena);
    throw credencialesInvalidas();
  }

  private async ingresarConCupo(
    usuario: string,
    contrasena: string,
  ): Promise<IngresoSuperadministradorRespuesta> {
    const reserva = await this.reservarIntento(usuario);
    if (reserva === null) {
      // Lo desactivaron entre la lectura previa y la reserva: se trata como un nombre sin cuenta.
      return this.rechazarSinCuenta(contrasena);
    }
    if ('error' in reserva) throw reserva.error;

    const { fila } = reserva;
    try {
      let correcta: boolean;
      try {
        correcta = await this.credenciales.verificarContrasena(contrasena, fila.hash_contrasena);
      } catch {
        correcta = false; // un error al evaluar cuenta como contraseña incorrecta
      }
      if (!correcta) {
        await this.registrarFallo(fila, usuario);
        throw credencialesInvalidas();
      }
      return await this.abrirSesion(fila, usuario);
    } catch (error) {
      // Algo inesperado (la base falló al resolver): la reserva se libera sin contar para que no quede en curso.
      if (!(error instanceof ErrorAplicacion))
        await this.liberarReserva(fila.id).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Tiempo 1. Devuelve la fila reservada, el rechazo a responder, o `null` si no hay superadministrador activo
   * con ese nombre. Solo se confirma (y deja su fila de auditoría `intento_ingreso_superadministrador`) el
   * intento que se evalúa; un nombre sin cuenta, un bloqueo vigente o un cupo lleno revierten la operación con
   * un aviso interno y no escriben nada.
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
      if (error instanceof ReservaRechazada) return { error: error.error };
      throw error;
    }
  }

  private async reservar(
    transaccion: TransaccionPlataforma,
    usuario: string,
  ): Promise<{ fila: FilaSuperadministrador }> {
    const sequelize = sequelizeDe(transaccion);
    const filas = await sequelize.query<FilaSuperadministrador>(
      `SELECT id, nombre, hash_contrasena, activo, bloqueado_hasta, fallos_seguidos, en_curso, en_curso_desde
         FROM superadministrador WHERE usuario = $1 AND activo
          FOR NO KEY UPDATE`,
      { transaction: transaccion, bind: [usuario], type: QueryTypes.SELECT },
    );
    // La hora se toma después de esperar el turno.
    const ahora = this.reloj.ahora();
    const fila = filas[0];
    if (fila === undefined) throw new SinCuenta();
    // Misma regla que las personas de empresa (`decidirReserva`): con el bloqueo vigente o con `fallos + en
    // curso` en el umbral hay 5 intentos decidiendo la cuenta, y este no se evalúa, no cuenta como fallo y no
    // bloquea (si los 5 resultan correctos no habrá habido ni un fallo).
    const decision = decidirReserva(fila, ahora, {
      umbral: FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR,
    });
    if (!decision.permitido) throw new ReservaRechazada(errorDeReserva(decision, ahora));
    const { fallos, enCurso } = decision;
    const desde = enCurso === 0 ? null : decision.desde;
    await sequelize.query(
      `UPDATE superadministrador
          SET fallos_seguidos = $2, en_curso = $3::integer + 1,
              en_curso_desde = COALESCE($4::timestamptz, $5::timestamptz),
              bloqueado_hasta = NULL, actualizado_en = $5
        WHERE id = $1`,
      { transaction: transaccion, bind: [fila.id, fallos, enCurso, desde, ahora] },
    );
    this.operacion.registrarDatosDeAuditoria(transaccion, {
      entidad: 'superadministrador',
      entidadId: fila.id,
      detalle: {
        superadministradorId: fila.id,
        usuario,
        fallosSeguidos: fallos,
        enCurso: enCurso + 1,
      },
    });
    return { fila };
  }

  /**
   * Tiempo 3, contraseña incorrecta (actor `autenticacion`). La reserva deja de estar en curso y cuenta un
   * fallo: se deja la fila de auditoría y, si la cuenta llegó a 5 y aún no hay bloqueo, se pone (una vez) con
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
        const ahora = this.reloj.ahora();
        const fallo = await this.contarFallo(transaccion, fila.id, ahora);
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: fila.id,
          detalle: {
            superadministradorId: fila.id,
            usuario,
            fallosSeguidos: fallo.fallosSeguidos,
          },
        });
        if (fallo.bloqueoNuevoHasta === null) return;
        await insertarAuditoriaPlataforma(transaccion, {
          accion: 'bloqueo_superadministrador',
          motivo: 'Bloqueo por intentos fallidos de superadministrador',
          entidad: 'superadministrador',
          entidadId: fila.id,
          detalle: {
            superadministradorId: fila.id,
            usuario,
            fallosSeguidos: fallo.fallosSeguidos,
            bloqueadoHasta: fallo.bloqueoNuevoHasta.toISOString(),
          },
          ocurridoEn: ahora,
        });
      },
    );
  }

  private async bloquearFila(transaccion: TransaccionPlataforma, id: string): Promise<void> {
    await sequelizeDe(transaccion).query(
      'SELECT id FROM superadministrador WHERE id = $1 FOR NO KEY UPDATE',
      { transaction: transaccion, bind: [id], type: QueryTypes.SELECT },
    );
  }

  /**
   * Resuelve una reserva fallida con la fila bloqueada: deja de estar en curso y suma un fallo (si hay un
   * bloqueo vigente, otros fallos ya lo pusieron y no suma ni lo alarga; si venció, la cuenta empieza en 1).
   * Si la cuenta llega al umbral sin bloqueo, lo pone (una sola vez por bloqueo) y devuelve su fin.
   */
  private async contarFallo(
    transaccion: TransaccionPlataforma,
    id: string,
    ahora: Date,
  ): Promise<{ fallosSeguidos: number; bloqueoNuevoHasta: Date | null }> {
    const sequelize = sequelizeDe(transaccion);
    const fallo = await resolverFalloEnFila(
      {
        contar: async () => {
          const contados = await sequelize.query<FilaDeFallo>(
            `UPDATE superadministrador SET
                en_curso = GREATEST(en_curso - 1, 0),
                en_curso_desde = CASE WHEN en_curso - 1 > 0 THEN en_curso_desde ELSE NULL END,
                fallos_seguidos = CASE
                  WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= $2 THEN 1
                  WHEN bloqueado_hasta IS NOT NULL THEN fallos_seguidos
                  ELSE fallos_seguidos + 1 END,
                bloqueado_hasta = CASE
                  WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= $2 THEN NULL
                  ELSE bloqueado_hasta END,
                actualizado_en = $2
              WHERE id = $1
              RETURNING fallos_seguidos, bloqueado_hasta`,
            { transaction: transaccion, bind: [id, ahora], type: QueryTypes.SELECT },
          );
          return contados[0]!;
        },
        bloquear: async (hasta) => {
          const bloqueadas = await sequelize.query<{ fallos_seguidos: number }>(
            `UPDATE superadministrador SET bloqueado_hasta = $2, actualizado_en = $3
              WHERE id = $1 AND bloqueado_hasta IS NULL AND fallos_seguidos >= $4
              RETURNING fallos_seguidos`,
            {
              transaction: transaccion,
              bind: [id, hasta, ahora, FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR],
              type: QueryTypes.SELECT,
            },
          );
          return bloqueadas[0] !== undefined;
        },
      },
      ahora,
      {
        umbral: FALLOS_PARA_BLOQUEAR_SUPERADMINISTRADOR,
        duracionMs: MINUTOS_BLOQUEO_SUPERADMINISTRADOR * MINUTO_MS,
      },
    );
    return {
      fallosSeguidos: fallo.fallosSeguidos,
      bloqueoNuevoHasta: fallo.bloqueoNuevo ? fallo.bloqueadoHasta : null,
    };
  }

  /** La reserva termina sin resultado para la cuenta: deja de estar en curso y no cuenta como fallo ni éxito. */
  private async liberarReserva(id: string): Promise<void> {
    await this.operacion.ejecutar(
      {
        actor: 'autenticacion',
        motivo: 'Fin de un intento de ingreso de superadministrador sin resultado',
        operacion: 'liberar_intento_superadministrador',
      },
      async (transaccion) => {
        await sequelizeDe(transaccion).query(
          `UPDATE superadministrador
              SET en_curso = GREATEST(en_curso - 1, 0),
                  en_curso_desde = CASE WHEN en_curso - 1 > 0 THEN en_curso_desde ELSE NULL END
            WHERE id = $1`,
          { transaction: transaccion, bind: [id] },
        );
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          entidad: 'superadministrador',
          entidadId: id,
          detalle: { superadministradorId: id },
        });
      },
    );
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
    let cambio = false;
    try {
      await this.operacion.ejecutar(
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
            cambio = true;
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
          // Un ingreso correcto deja de estar en curso y reinicia la cuenta de fallos, pero nunca levanta un
          // bloqueo vigente (los intentos que siguen en curso cuentan cuando se resuelvan).
          await sequelize.query(
            `UPDATE superadministrador
                SET en_curso = GREATEST(en_curso - 1, 0),
                    en_curso_desde = CASE WHEN en_curso - 1 > 0 THEN en_curso_desde ELSE NULL END,
                    fallos_seguidos = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > $2
                                           THEN fallos_seguidos ELSE 0 END,
                    bloqueado_hasta = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > $2
                                           THEN bloqueado_hasta ELSE NULL END,
                    actualizado_en = $2
              WHERE id = $1`,
            { transaction: transaccion, bind: [verificado.id, ahora] },
          );
          this.operacion.registrarDatosDeAuditoria(transaccion, {
            entidad: 'superadministrador',
            entidadId: verificado.id,
            detalle: { superadministradorId: verificado.id, usuario },
          });
        },
      );
    } catch (error) {
      // La persona cambió mientras se evaluaba: la operación se revirtió y la reserva termina sin contar.
      if (cambio) await this.liberarReserva(verificado.id);
      throw error;
    }
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
