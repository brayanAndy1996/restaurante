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

  /** Reinicia la cuenta (ingreso correcto o rechazo por horario, que implica credenciales correctas). */
  async reiniciar(ambito: AmbitoBloqueo, objetivoId: string): Promise<void> {
    await this.conexion.query(
      'DELETE FROM bloqueo_intentos WHERE ambito = $1 AND objetivo_id = $2',
      { bind: [ambito, objetivoId] },
    );
  }
}

/** Segundos que faltan para `hasta` (mínimo 1), para `reintentarEnSegundos` y `Retry-After`. */
export function segundosHasta(hasta: Date, ahora: Date): number {
  return Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 1000));
}
