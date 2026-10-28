import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { segundosHasta } from './bloqueos.service';
import { demasiadosALaVez } from './tope-de-intentos';

/**
 * Errores que comparten los ingresos de las personas de empresa, del superadministrador, de los equipos
 * recordados y de la clave de supervisor. Una sola definición: el mensaje y el código no deben divergir
 * entre rutas (quien ataca no puede distinguir una ruta de otra por el cuerpo de la respuesta).
 */

/** 401 de un ingreso con nombre o contraseña incorrectos (también para un nombre sin cuenta). */
export const credencialesInvalidas = (): ErrorAplicacion =>
  new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');

/** 429 de una cuenta con bloqueo vigente hasta `hasta`; `reintentarEnSegundos` es lo que falta (mínimo 1). */
export const bloqueoTemporal = (hasta: Date, ahora: Date): ErrorAplicacion =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    segundosHasta(hasta, ahora),
  );

/**
 * Error de una reserva rechazada por `decidirReserva`: 429 con la duración que falta si hay un bloqueo
 * vigente, y 429 de 1 s si el cupo de evaluaciones en curso está lleno (no se evalúa ni cuenta como fallo).
 */
export const errorDeReserva = (
  rechazo: { motivo: 'BLOQUEO'; bloqueadoHasta: Date } | { motivo: 'CUPO_LLENO' },
  ahora: Date,
): ErrorAplicacion =>
  rechazo.motivo === 'BLOQUEO'
    ? bloqueoTemporal(rechazo.bloqueadoHasta, ahora)
    : demasiadosALaVez();
