import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';

/** Qué se bloquea (columna `bloqueo_intentos.ambito`). */
export type AmbitoBloqueo =
  'CONTRASENA_USUARIO' | 'PIN_EQUIPO_RECORDADO' | 'CLAVE_USUARIO' | 'CLAVE_EQUIPO';

export interface EstadoBloqueo {
  fallosSeguidos: number;
  /** Fin del bloqueo vigente, o `null` si no hay (o ya venció). */
  bloqueadoHasta: Date | null;
}

export interface ResultadoFallo {
  fallosSeguidos: number;
  bloqueadoHasta: Date | null;
  /** `true` si este fallo es el que dejó la cuenta bloqueada (una sola vez por bloqueo). */
  bloqueoNuevo: boolean;
}

export interface ResultadoFalloAcumulado {
  fallosSeguidos: number;
  /** Fin del bloqueo que este fallo dejó (cada `cada` fallos), o `null` si no dejó ninguno. */
  bloqueadoHasta: Date | null;
  /** `true` si la cuenta llegó a `maximo` fallos seguidos (no se bloquea: se corta el acceso). */
  agotado: boolean;
}

/** Resultado de reservar un intento de ingreso (ver `BloqueosService.reservarIntento`). */
export type ReservaIntento =
  /**
   * No se puede evaluar: hay un bloqueo vigente (`vigente`) o el cupo de evaluaciones en curso ya está lleno
   * (`vigente` falso: `bloqueadoHasta` es solo la duración completa del bloqueo que vendría).
   */
  | { permitido: false; bloqueadoHasta: Date; vigente: boolean }
  /** Se puede evaluar; el intento ya cuenta (`fallosSeguidos` incluye este). */
  | { permitido: true; fallosSeguidos: number };

export interface OpcionesReserva {
  umbral: number;
  duracionMs: number;
  /**
   * Cuánto vale una reserva sin resolver: si pasó más que esto desde la última reserva y la cuenta sigue en
   * el umbral sin bloqueo, quien la hizo murió sin resolverla y la cuenta vuelve a empezar.
   */
  vigenciaReservaMs?: number;
}

/** Una reserva que nadie resolvió en este tiempo se da por perdida (el proceso murió a media evaluación). */
export const VIGENCIA_RESERVA_MS = 60_000;

/**
 * Cuenta de fallos seguidos y bloqueo temporal (criterios 12, 36 y 47), en la transacción de la empresa
 * en curso. Quien llama lo hace dentro de su propio `ContextoEmpresa.ejecutar` y lanza el error después
 * de que la transacción se confirmó, así los fallos y el bloqueo quedan guardados aunque la respuesta sea
 * un error. La hora la da quien llama (el reloj de la API).
 *
 * `bloqueo_intentos` es una de las cuatro tablas sin trazabilidad (se escribe en ingresos fallidos, sin
 * persona autenticada), así que no necesita actor para escribir.
 */
@Injectable()
export class BloqueosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
  ) {}

  /** Estado vigente: un bloqueo ya vencido cuenta como sin bloqueo. */
  async estado(ambito: AmbitoBloqueo, objetivoId: string, ahora: Date): Promise<EstadoBloqueo> {
    const filas = await this.conexion.query<{
      fallos_seguidos: number;
      bloqueado_hasta: Date | null;
    }>(
      'SELECT fallos_seguidos, bloqueado_hasta FROM bloqueo_intentos WHERE ambito = $1 AND objetivo_id = $2',
      {
        bind: [ambito, objetivoId],
        type: QueryTypes.SELECT,
      },
    );
    const fila = filas[0];
    if (fila === undefined) return { fallosSeguidos: 0, bloqueadoHasta: null };
    const vigente =
      fila.bloqueado_hasta !== null && fila.bloqueado_hasta.getTime() > ahora.getTime();
    return {
      fallosSeguidos: fila.fallos_seguidos,
      bloqueadoHasta: vigente ? fila.bloqueado_hasta : null,
    };
  }

  /**
   * Cuenta un fallo más. Si el bloqueo anterior ya venció, la cuenta vuelve a empezar en 1. Al llegar
   * a `umbral` fallos seguidos, fija el bloqueo hasta `ahora + duracionMs` (solo si no lo había: dos
   * fallos concurrentes no lo alargan ni lo cuentan dos veces). La primera sentencia bloquea la fila,
   * así que los fallos concurrentes de la misma cuenta se cuentan uno detrás de otro.
   */
  async registrarFallo(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    opciones: { umbral: number; duracionMs: number },
  ): Promise<ResultadoFallo> {
    const empresaId = this.contexto.empresaActual();
    const contados = await this.conexion.query<{ fallos_seguidos: number }>(
      `INSERT INTO bloqueo_intentos AS b
         (empresa_id, ambito, objetivo_id, fallos_seguidos, ultimo_fallo_en, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 1, $4, $4, $4)
       ON CONFLICT (empresa_id, ambito, objetivo_id) DO UPDATE SET
         fallos_seguidos = CASE
           WHEN b.bloqueado_hasta IS NOT NULL AND b.bloqueado_hasta <= $4 THEN 1
           ELSE b.fallos_seguidos + 1 END,
         bloqueado_hasta = CASE
           WHEN b.bloqueado_hasta IS NOT NULL AND b.bloqueado_hasta <= $4 THEN NULL
           ELSE b.bloqueado_hasta END,
         ultimo_fallo_en = $4,
         actualizado_en = $4
       RETURNING fallos_seguidos`,
      { bind: [empresaId, ambito, objetivoId, ahora], type: QueryTypes.SELECT },
    );
    const fallosSeguidos = contados[0]!.fallos_seguidos;
    if (fallosSeguidos < opciones.umbral) {
      return { fallosSeguidos, bloqueadoHasta: null, bloqueoNuevo: false };
    }
    const hasta = new Date(ahora.getTime() + opciones.duracionMs);
    const bloqueadas = await this.conexion.query<{ bloqueado_hasta: Date }>(
      `UPDATE bloqueo_intentos SET bloqueado_hasta = $3, actualizado_en = $4
        WHERE ambito = $1 AND objetivo_id = $2 AND bloqueado_hasta IS NULL AND fallos_seguidos >= $5
        RETURNING bloqueado_hasta`,
      { bind: [ambito, objetivoId, hasta, ahora, opciones.umbral], type: QueryTypes.SELECT },
    );
    const nuevo = bloqueadas[0] !== undefined;
    return { fallosSeguidos, bloqueadoHasta: nuevo ? hasta : null, bloqueoNuevo: nuevo };
  }

  /**
   * Cuenta un fallo más **sin reiniciar la cuenta cuando vence un bloqueo** (criterio 36: los fallos del
   * PIN de una persona en un equipo solo se reinician con un PIN correcto). Cada `cada` fallos seguidos
   * (5.º, 10.º…) deja un bloqueo de `duracionMs`; al llegar a `maximo` (15.º) no bloquea: avisa con
   * `agotado` para que quien llama corte el acceso. La primera sentencia bloquea la fila, así que los
   * fallos concurrentes de la misma cuenta se cuentan uno detrás de otro.
   */
  async registrarFalloAcumulado(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    opciones: { cada: number; maximo: number; duracionMs: number },
  ): Promise<ResultadoFalloAcumulado> {
    const empresaId = this.contexto.empresaActual();
    const contados = await this.conexion.query<{ fallos_seguidos: number }>(
      `INSERT INTO bloqueo_intentos AS b
         (empresa_id, ambito, objetivo_id, fallos_seguidos, ultimo_fallo_en, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 1, $4, $4, $4)
       ON CONFLICT (empresa_id, ambito, objetivo_id) DO UPDATE SET
         fallos_seguidos = b.fallos_seguidos + 1,
         ultimo_fallo_en = $4,
         actualizado_en = $4
       RETURNING fallos_seguidos`,
      { bind: [empresaId, ambito, objetivoId, ahora], type: QueryTypes.SELECT },
    );
    const fallosSeguidos = contados[0]!.fallos_seguidos;
    if (fallosSeguidos >= opciones.maximo) {
      return { fallosSeguidos, bloqueadoHasta: null, agotado: true };
    }
    if (fallosSeguidos % opciones.cada !== 0) {
      return { fallosSeguidos, bloqueadoHasta: null, agotado: false };
    }
    const hasta = new Date(ahora.getTime() + opciones.duracionMs);
    await this.conexion.query(
      `UPDATE bloqueo_intentos SET bloqueado_hasta = $3, actualizado_en = $4
        WHERE ambito = $1 AND objetivo_id = $2`,
      { bind: [ambito, objetivoId, hasta, ahora] },
    );
    return { fallosSeguidos, bloqueadoHasta: hasta, agotado: false };
  }

  /**
   * Reinicia la cuenta (ingreso correcto o rechazo por horario, que implica credenciales correctas). Con
   * `ahora`, un bloqueo vigente nunca se borra: un éxito no levanta el bloqueo que otros fallos pusieron
   * (criterio 61); la cuenta solo se reinicia si no hay bloqueo o ya venció.
   */
  async reiniciar(ambito: AmbitoBloqueo, objetivoId: string, ahora?: Date): Promise<void> {
    if (ahora === undefined) {
      await this.conexion.query(
        'DELETE FROM bloqueo_intentos WHERE ambito = $1 AND objetivo_id = $2',
        { bind: [ambito, objetivoId] },
      );
      return;
    }
    await this.conexion.query(
      `DELETE FROM bloqueo_intentos
        WHERE ambito = $1 AND objetivo_id = $2
          AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= $3)`,
      { bind: [ambito, objetivoId, ahora] },
    );
  }

  // ---- Ingresos con scrypt: reserva, evaluación fuera de la transacción y resolución --------------

  /**
   * Primera mitad de un ingreso con contraseña: decide si se puede evaluar y, si se puede, **cuenta el
   * intento de antemano** y le da su número de turno (`fallosSeguidos`). Así la evaluación (scrypt, lenta)
   * corre fuera de toda transacción y de todo bloqueo de fila, y aun así ninguna ráfaga evalúa más de
   * `umbral` contraseñas por bloqueo: el intento `umbral + 1` encuentra la cuenta llena y se rechaza sin
   * evaluarse.
   *
   * - Bloqueo vigente: no se evalúa ni se cuenta.
   * - Bloqueo vencido: la cuenta vuelve a empezar.
   * - Cuenta en el umbral sin bloqueo: hay `umbral` evaluaciones en curso que todavía no se resolvieron (el
   *   bloqueo lo pone la primera que se resuelva, `resolverFallo` / `liberarIntento`). No se evalúa, pero
   *   **sí se cuenta**: llegó después de esas `umbral` y, si ninguna resulta correcta, habría sido un fallo
   *   más. Se responde con la duración completa del bloqueo.
   *
   * Quien llama tiene bloqueada la fila de la persona (`FOR NO KEY UPDATE`), así que la lectura y la
   * escritura de aquí no se pisan con otro intento de la misma cuenta.
   */
  async reservarIntento(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    opciones: OpcionesReserva,
  ): Promise<ReservaIntento> {
    const empresaId = this.contexto.empresaActual();
    const filas = await this.conexion.query<{
      fallos_seguidos: number;
      bloqueado_hasta: Date | null;
      actualizado_en: Date;
    }>(
      `SELECT fallos_seguidos, bloqueado_hasta, actualizado_en
         FROM bloqueo_intentos WHERE ambito = $1 AND objetivo_id = $2`,
      { bind: [ambito, objetivoId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    let fallos = 0;
    if (fila !== undefined) {
      if (fila.bloqueado_hasta !== null) {
        if (fila.bloqueado_hasta.getTime() > ahora.getTime()) {
          return { permitido: false, bloqueadoHasta: fila.bloqueado_hasta, vigente: true };
        }
        // El bloqueo venció: la cuenta empieza de cero.
      } else {
        const perdida =
          fila.fallos_seguidos >= opciones.umbral &&
          ahora.getTime() - fila.actualizado_en.getTime() >=
            (opciones.vigenciaReservaMs ?? VIGENCIA_RESERVA_MS);
        if (!perdida) fallos = fila.fallos_seguidos;
      }
    }
    const turno = fallos + 1;
    const evaluable = turno <= opciones.umbral;
    // Solo un intento evaluable renueva `actualizado_en`: es la hora de la última reserva viva.
    await this.conexion.query(
      `INSERT INTO bloqueo_intentos AS b
         (empresa_id, ambito, objetivo_id, fallos_seguidos, ultimo_fallo_en, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $5, $4, $4, $4)
       ON CONFLICT (empresa_id, ambito, objetivo_id) DO UPDATE SET
         fallos_seguidos = $5,
         bloqueado_hasta = NULL,
         ultimo_fallo_en = $4,
         actualizado_en = CASE WHEN $6::boolean OR b.bloqueado_hasta IS NOT NULL THEN $4 ELSE b.actualizado_en END`,
      { bind: [empresaId, ambito, objetivoId, ahora, turno, evaluable] },
    );
    if (!evaluable) {
      return {
        permitido: false,
        bloqueadoHasta: new Date(ahora.getTime() + opciones.duracionMs),
        vigente: false,
      };
    }
    return { permitido: true, fallosSeguidos: turno };
  }

  /**
   * Segunda mitad de un ingreso que falló: si la cuenta llegó al umbral y todavía no hay bloqueo, lo pone
   * (una sola vez por bloqueo, también con varios fallos resolviéndose a la vez) y lo informa para que quien
   * llama deje su fila de auditoría. El intento ya se contó en `reservarIntento`. Requiere la fila de la
   * persona bloqueada, como `reservarIntento`.
   */
  async resolverFallo(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    opciones: { umbral: number; duracionMs: number },
  ): Promise<ResultadoFallo> {
    const hasta = new Date(ahora.getTime() + opciones.duracionMs);
    const bloqueadas = await this.conexion.query<{ fallos_seguidos: number }>(
      `UPDATE bloqueo_intentos SET bloqueado_hasta = $3, actualizado_en = $4
        WHERE ambito = $1 AND objetivo_id = $2 AND bloqueado_hasta IS NULL AND fallos_seguidos >= $5
        RETURNING fallos_seguidos`,
      { bind: [ambito, objetivoId, hasta, ahora, opciones.umbral], type: QueryTypes.SELECT },
    );
    const nuevo = bloqueadas[0] !== undefined;
    return {
      fallosSeguidos: bloqueadas[0]?.fallos_seguidos ?? 0,
      bloqueadoHasta: nuevo ? hasta : null,
      bloqueoNuevo: nuevo,
    };
  }

  /**
   * Segunda mitad de un ingreso correcto: perdona los intentos hasta su turno (los que llegaron antes que él,
   * como un ingreso correcto antes del quinto fallo) y conserva los que llegaron después. **Nunca toca un
   * bloqueo vigente**: un éxito no levanta el bloqueo que pusieron otros fallos (criterio 61). Devuelve
   * `true` si los intentos posteriores ya llenan el umbral sin que haya bloqueo (todos se rechazaron sin
   * evaluarse mientras este se evaluaba): entonces quien llama debe poner el bloqueo con `resolverFallo`.
   */
  async liberarIntento(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    turno: number,
    umbral: number,
  ): Promise<boolean> {
    const filas = await this.conexion.query<{ fallos_seguidos: number }>(
      `UPDATE bloqueo_intentos
          SET fallos_seguidos = CASE WHEN bloqueado_hasta IS NOT NULL THEN 0
                                     ELSE GREATEST(fallos_seguidos - $3, 0) END,
              bloqueado_hasta = NULL,
              actualizado_en = $4
        WHERE ambito = $1 AND objetivo_id = $2 AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= $4)
        RETURNING fallos_seguidos`,
      { bind: [ambito, objetivoId, turno, ahora], type: QueryTypes.SELECT },
    );
    const quedan = filas[0]?.fallos_seguidos;
    if (quedan === undefined) return false;
    if (quedan === 0) {
      await this.conexion.query(
        `DELETE FROM bloqueo_intentos
          WHERE ambito = $1 AND objetivo_id = $2 AND fallos_seguidos = 0 AND bloqueado_hasta IS NULL`,
        { bind: [ambito, objetivoId] },
      );
    }
    return quedan >= umbral;
  }
}

/** Segundos que faltan para `hasta` (mínimo 1), para `reintentarEnSegundos` y `Retry-After`. */
export function segundosHasta(hasta: Date, ahora: Date): number {
  return Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 1000));
}
