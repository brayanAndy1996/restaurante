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
  /** Hay un bloqueo vigente hasta `bloqueadoHasta`: no se evalúa ni se cuenta. */
  | { permitido: false; motivo: 'BLOQUEO'; bloqueadoHasta: Date }
  /**
   * `fallos + en curso` ya llena el umbral: hay tantas evaluaciones corriendo que, si todas fallan, la cuenta
   * se bloquea. No se evalúa, no se cuenta como fallo y no bloquea; quien llama responde 429 de 1 segundo.
   */
  | { permitido: false; motivo: 'CUPO_LLENO' }
  /** Se puede evaluar; el intento ya figura como "en curso" hasta que se resuelva. */
  | { permitido: true };

export interface OpcionesReserva {
  umbral: number;
  /**
   * Cuánto vale una reserva sin resolver: si pasó más que esto desde que empezó la racha de evaluaciones en
   * curso, quien las hizo murió sin resolverlas y la cuenta de "en curso" vuelve a cero.
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
   * Primera mitad de un ingreso con contraseña: decide si se puede evaluar y, si se puede, **marca el intento
   * como "en curso"**. Así la evaluación (scrypt, lenta) corre fuera de toda transacción y de todo bloqueo de
   * fila, y aun así ninguna ráfaga evalúa más de `umbral` contraseñas por bloqueo.
   *
   * `fallos_seguidos` solo cuenta fallos ya resueltos; las evaluaciones que corren se llevan aparte en
   * `en_curso`. Un intento que llega cuando `fallos + en_curso` ya llena el umbral no se evalúa, **no cuenta
   * como fallo y no bloquea**: hay `umbral` intentos decidiendo la cuenta, y si todos resultan correctos no
   * habrá habido ni un fallo. Así seis ingresos correctos simultáneos nunca dejan a la persona bloqueada.
   *
   * - Bloqueo vigente: no se evalúa ni se cuenta.
   * - Bloqueo vencido: la cuenta de fallos vuelve a empezar.
   * - Reservas perdidas (`en_curso` sin resolver durante `vigenciaReservaMs`): se descartan.
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
      en_curso: number;
      en_curso_desde: Date | null;
      bloqueado_hasta: Date | null;
    }>(
      `SELECT fallos_seguidos, en_curso, en_curso_desde, bloqueado_hasta
         FROM bloqueo_intentos WHERE ambito = $1 AND objetivo_id = $2`,
      { bind: [ambito, objetivoId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    let fallos = 0;
    let enCurso = 0;
    let desde: Date | null = null;
    if (fila !== undefined) {
      if (fila.bloqueado_hasta !== null) {
        if (fila.bloqueado_hasta.getTime() > ahora.getTime()) {
          return { permitido: false, motivo: 'BLOQUEO', bloqueadoHasta: fila.bloqueado_hasta };
        }
        // El bloqueo venció: la cuenta de fallos empieza de cero.
      } else {
        fallos = fila.fallos_seguidos;
      }
      const perdidas =
        fila.en_curso > 0 &&
        (fila.en_curso_desde === null ||
          ahora.getTime() - fila.en_curso_desde.getTime() >=
            (opciones.vigenciaReservaMs ?? VIGENCIA_RESERVA_MS));
      if (!perdidas) {
        enCurso = fila.en_curso;
        desde = fila.en_curso_desde;
      }
    }
    if (fallos + enCurso >= opciones.umbral) return { permitido: false, motivo: 'CUPO_LLENO' };
    if (enCurso === 0) desde = null; // la racha de evaluaciones en curso empieza con esta reserva
    await this.conexion.query(
      `INSERT INTO bloqueo_intentos AS b
         (empresa_id, ambito, objetivo_id, fallos_seguidos, en_curso, en_curso_desde, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $5, 1, $4, $4, $4)
       ON CONFLICT (empresa_id, ambito, objetivo_id) DO UPDATE SET
         fallos_seguidos = $5,
         en_curso = $6::integer + 1,
         en_curso_desde = COALESCE($7::timestamptz, $4),
         bloqueado_hasta = NULL,
         actualizado_en = $4`,
      { bind: [empresaId, ambito, objetivoId, ahora, fallos, enCurso, desde] },
    );
    return { permitido: true };
  }

  /**
   * Segunda mitad de un ingreso que falló: la reserva deja de estar en curso y cuenta un fallo. Al llegar la
   * cuenta al umbral sin bloqueo vigente, lo pone (una sola vez por bloqueo, también con varios fallos
   * resolviéndose a la vez) y lo informa para que quien llama deje su fila de auditoría. Con un bloqueo
   * vigente (puesto por otros fallos mientras este se evaluaba) no suma ni lo alarga. Requiere la fila de la
   * persona bloqueada, como `reservarIntento`.
   */
  async resolverFallo(
    ambito: AmbitoBloqueo,
    objetivoId: string,
    ahora: Date,
    opciones: { umbral: number; duracionMs: number },
  ): Promise<ResultadoFallo> {
    const empresaId = this.contexto.empresaActual();
    const contados = await this.conexion.query<{
      fallos_seguidos: number;
      bloqueado_hasta: Date | null;
    }>(
      `INSERT INTO bloqueo_intentos AS b
         (empresa_id, ambito, objetivo_id, fallos_seguidos, ultimo_fallo_en, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 1, $4, $4, $4)
       ON CONFLICT (empresa_id, ambito, objetivo_id) DO UPDATE SET
         en_curso = GREATEST(b.en_curso - 1, 0),
         en_curso_desde = CASE WHEN b.en_curso - 1 > 0 THEN b.en_curso_desde ELSE NULL END,
         fallos_seguidos = CASE
           WHEN b.bloqueado_hasta IS NOT NULL AND b.bloqueado_hasta <= $4 THEN 1
           WHEN b.bloqueado_hasta IS NOT NULL THEN b.fallos_seguidos
           ELSE b.fallos_seguidos + 1 END,
         bloqueado_hasta = CASE
           WHEN b.bloqueado_hasta IS NOT NULL AND b.bloqueado_hasta <= $4 THEN NULL
           ELSE b.bloqueado_hasta END,
         ultimo_fallo_en = $4,
         actualizado_en = $4
       RETURNING fallos_seguidos, bloqueado_hasta`,
      { bind: [empresaId, ambito, objetivoId, ahora], type: QueryTypes.SELECT },
    );
    const { fallos_seguidos: fallosSeguidos, bloqueado_hasta: vigente } = contados[0]!;
    if (vigente !== null || fallosSeguidos < opciones.umbral) {
      return { fallosSeguidos, bloqueadoHasta: vigente, bloqueoNuevo: false };
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
   * Segunda mitad de un ingreso correcto: la reserva deja de estar en curso y la cuenta de fallos vuelve a
   * cero. **Nunca toca un bloqueo vigente**: un éxito no levanta el bloqueo que pusieron otros fallos
   * (criterio 61). Los intentos que siguen en curso no se tocan: cada uno cuenta cuando se resuelva.
   */
  async resolverExito(ambito: AmbitoBloqueo, objetivoId: string, ahora: Date): Promise<void> {
    await this.conexion.query(
      `UPDATE bloqueo_intentos
          SET en_curso = GREATEST(en_curso - 1, 0),
              en_curso_desde = CASE WHEN en_curso - 1 > 0 THEN en_curso_desde ELSE NULL END,
              fallos_seguidos = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > $3
                                     THEN fallos_seguidos ELSE 0 END,
              bloqueado_hasta = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > $3
                                     THEN bloqueado_hasta ELSE NULL END,
              actualizado_en = $3
        WHERE ambito = $1 AND objetivo_id = $2`,
      { bind: [ambito, objetivoId, ahora] },
    );
    await this.borrarSiVacia(ambito, objetivoId);
  }

  /**
   * La reserva termina sin resultado para la cuenta (la persona dejó de estar activa o cambió su contraseña
   * mientras se evaluaba): deja de estar en curso y no cuenta ni como fallo ni como éxito.
   */
  async liberarReserva(ambito: AmbitoBloqueo, objetivoId: string, ahora: Date): Promise<void> {
    await this.conexion.query(
      `UPDATE bloqueo_intentos
          SET en_curso = GREATEST(en_curso - 1, 0),
              en_curso_desde = CASE WHEN en_curso - 1 > 0 THEN en_curso_desde ELSE NULL END,
              actualizado_en = $3
        WHERE ambito = $1 AND objetivo_id = $2`,
      { bind: [ambito, objetivoId, ahora] },
    );
    await this.borrarSiVacia(ambito, objetivoId);
  }

  /** Quita la fila de una cuenta sin fallos, sin evaluaciones en curso y sin bloqueo. */
  private async borrarSiVacia(ambito: AmbitoBloqueo, objetivoId: string): Promise<void> {
    await this.conexion.query(
      `DELETE FROM bloqueo_intentos
        WHERE ambito = $1 AND objetivo_id = $2
          AND fallos_seguidos = 0 AND en_curso = 0 AND bloqueado_hasta IS NULL`,
      { bind: [ambito, objetivoId] },
    );
  }
}

/** Segundos que faltan para `hasta` (mínimo 1), para `reintentarEnSegundos` y `Retry-After`. */
export function segundosHasta(hasta: Date, ahora: Date): number {
  return Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 1000));
}
