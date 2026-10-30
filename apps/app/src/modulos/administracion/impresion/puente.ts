import {
  MINUTOS_VIGENCIA_VINCULACION,
  puenteRespuestaSchema,
  trabajoCreadoRespuestaSchema,
  vinculacionRespuestaSchema,
  type EstadoImpresionRespuesta,
  type PuenteRespuesta,
} from '@restaurante/contratos';
import { api, listaDe } from '../../../lib/api';
import type { ExtraDeEscritura } from '../../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../../lib/errores';
import { claveEstadoImpresion, leerEstadoDeImpresion, textoDeHace } from '../../impresion/estado';

// El estado de la impresión lo comparten el aviso de todas las pantallas, el KDS y esta sección.
export { claveEstadoImpresion, leerEstadoDeImpresion, textoDeHace };

/**
 * Ajustes › Impresión, el puente (historia 004, entrega 3b, criterios 106 a 108, 121, 127 y 137): vincular,
 * ver el estado, revocar y la página de prueba. Aquí van las llamadas a la API y las reglas de presentación,
 * sin React.
 */

export const clavePuentes = (sucursalId: string) => ['impresion', 'puentes', sucursalId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

/** `GET /sucursales/:sucursalId/puentes`: los puentes de la sucursal, activos y revocados. */
export const listarPuentes = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/puentes`, {
    esquema: listaDe(puenteRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

/**
 * `POST /sucursales/:sucursalId/vinculaciones-puente` (criterio 106): un código de un solo uso que vence en 10
 * minutos. `clave` se conserva mientras no salga bien, así un reintento no crea otro código.
 */
export const crearVinculacion = (sucursalId: string, clave: string, senal?: AbortSignal) =>
  api.post(`/sucursales/${sucursalId}/vinculaciones-puente`, undefined, {
    esquema: vinculacionRespuestaSchema,
    idempotente: clave,
    ...(senal ? { senal } : {}),
  });

/** `DELETE /sucursales/:sucursalId/puentes/:id` (criterio 108): repetirlo responde igual. */
export const revocarPuente = (sucursalId: string, puenteId: string, extra?: ExtraDeEscritura) =>
  api.delete(`/sucursales/${sucursalId}/puentes/${puenteId}`, { ...extra });

/** `POST /sucursales/:sucursalId/impresoras/:id/prueba` (criterio 127): funciona aunque esté inactiva. */
export const imprimirPaginaDePrueba = (
  sucursalId: string,
  impresoraId: string,
  extra?: ExtraDeEscritura,
) =>
  api.post(`/sucursales/${sucursalId}/impresoras/${impresoraId}/prueba`, undefined, {
    esquema: trabajoCreadoRespuestaSchema,
    ...extra,
  });

// --- Reglas de presentación -----------------------------------------------------------------------

/** Cuánto dura un código de vinculación, en segundos (criterio 106). */
export const SEGUNDOS_DE_VIGENCIA = MINUTOS_VIGENCIA_VINCULACION * 60;

/** Segundos que le quedan a un código; nunca negativos. */
export const segundosRestantes = (expiraEn: string, ahoraMs: number): number =>
  Math.max(0, Math.ceil((Date.parse(expiraEn) - ahoraMs) / 1000));

export type SituacionDelPuente =
  | { tipo: 'ninguno' }
  | { tipo: 'conectado'; nombre: string; senal: string }
  | { tipo: 'sin-senal'; nombre: string; senal: string | null };

/**
 * Cómo está el puente, con la hora de la API y no la del equipo (criterio 121): `ahora` de la respuesta más el
 * tiempo que pasó desde que llegó.
 */
export function situacionDelPuente(
  estado: EstadoImpresionRespuesta,
  desdeLaRespuestaMs: number,
): SituacionDelPuente {
  const puente = estado.puente;
  if (!puente) return { tipo: 'ninguno' };
  const ahora = Date.parse(estado.ahora) + Math.max(0, desdeLaRespuestaMs);
  const senal = puente.ultimaSenalEn
    ? textoDeHace((ahora - Date.parse(puente.ultimaSenalEn)) / 1000)
    : null;
  return puente.conectado && senal !== null
    ? { tipo: 'conectado', nombre: puente.nombre, senal }
    : { tipo: 'sin-senal', nombre: puente.nombre, senal };
}

/** "Pixel 6 · app 1.2.0": lo que el puente dijo de sí mismo al vincularse. */
export function detalleDelPuente(puente: PuenteRespuesta | undefined): string | null {
  if (!puente) return null;
  const partes = [puente.modelo, puente.versionApp ? `app ${puente.versionApp}` : null].filter(
    (p): p is string => !!p,
  );
  return partes.length > 0 ? partes.join(' · ') : null;
}

export const MENSAJES_DEL_PUENTE = {
  NO_ENCONTRADO: 'Ese puente ya no está. Actualizamos la pantalla.',
} as const;

/** Por qué no se pudo generar el código. */
export const falloDeVinculacion = (error: unknown): string =>
  error instanceof ErrorApi && error.codigo === 'PROHIBIDO'
    ? 'Solo un Administrador puede vincular el puente.'
    : mensajeDeError(error);
