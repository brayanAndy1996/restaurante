import type { EventoCocinaListo } from '@restaurante/contratos';
import { useSyncExternalStore } from 'react';
import { alRecibirEvento, datosDeCocinaListo } from './tiempo-real';

/**
 * Avisos de "Listo" del salón (criterio 98 de 004). Cuando la cocina marca una línea como lista, la API
 * publica `cocina.listo` con los `destinatarios`: el mozo responsable de la orden y quien comandó el ítem.
 * Solo esas personas guardan el aviso; para el resto del salón el evento pasa de largo.
 *
 * - Los avisos viven en memoria y en esta pestaña: sin notificaciones del sistema (fuera de alcance), solo con
 *   la app abierta.
 * - Cada aviso se queda en la lista "Avisos" del salón hasta que la persona lo toca.
 * - Pertenecen a la persona de la sesión: al cambiar de usuario o salir, se vacían, y no se ven en otro usuario.
 */

type DatosDeListo = EventoCocinaListo['datos'];

export interface AvisoDeListo {
  /** Uno por línea de comanda: si la misma línea vuelve a quedar lista, reemplaza al aviso anterior. */
  id: string;
  /** "Lomo saltado × 1 de la mesa 4 está listo". */
  texto: string;
  ordenId: string;
  /** Cuándo llegó (ms de época del equipo). */
  recibidoEn: number;
}

let avisos: readonly AvisoDeListo[] = [];
const oyentes = new Set<() => void>();

function poner(nuevos: readonly AvisoDeListo[]): void {
  avisos = nuevos;
  oyentes.forEach((oyente) => oyente());
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** Los avisos pendientes, el más reciente primero. */
export function useAvisosDeListo(): readonly AvisoDeListo[] {
  return useSyncExternalStore(
    suscribir,
    () => avisos,
    () => avisos,
  );
}

/** El aviso se tocó: sale de la lista. */
export function quitarAviso(id: string): void {
  poner(avisos.filter((a) => a.id !== id));
}

export function quitarTodosLosAvisos(): void {
  if (avisos.length > 0) poner([]);
}

/** "mesa 4", "mesas 4 y 5", "mesas 4, 5 y 6": los nombres de mesa sin repetir la palabra "mesa". */
function mesasEnFrase(mesas: DatosDeListo['mesas']): string {
  const nombres = mesas.map((m) => m.nombre.trim().replace(/^mesa\s+/i, ''));
  if (nombres.length === 0) return 'la orden';
  if (nombres.length === 1) return `la mesa ${nombres[0]}`;
  return `las mesas ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** "Lomo saltado × 1 de la mesa 4 está listo". */
export function textoDeAvisoDeListo(listo: DatosDeListo): string {
  return `${listo.nombre} × ${listo.cantidad} de ${mesasEnFrase(listo.mesas)} está listo`;
}

function vibrar(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate([200, 100, 200]);
  } catch {
    // El navegador no deja vibrar (iPhone, o sin gesto previo): el aviso se ve igual.
  }
}

/** Una línea quedó lista: si esta persona es destinataria, se guarda el aviso y se vibra. */
export function recibirListo(datos: unknown, usuarioId: string, ahoraMs = Date.now()): void {
  const listo = datosDeCocinaListo(datos);
  if (!listo || !listo.destinatarios.includes(usuarioId)) return;
  const aviso: AvisoDeListo = {
    id: listo.lineaId,
    texto: textoDeAvisoDeListo(listo),
    ordenId: listo.ordenId,
    recibidoEn: ahoraMs,
  };
  poner([aviso, ...avisos.filter((a) => a.id !== aviso.id)]);
  vibrar();
}

/**
 * Empieza a guardar los avisos de `usuarioId` (la persona de la sesión). Devuelve cómo parar; al parar se
 * vacía la lista, para que no pase a quien entre después en el mismo equipo.
 */
export function instalarAvisosDeListo(usuarioId: string): () => void {
  quitarTodosLosAvisos();
  const dejar = alRecibirEvento((nombre, datos) => {
    if (nombre === 'cocina.listo') recibirListo(datos, usuarioId);
  });
  return () => {
    dejar();
    quitarTodosLosAvisos();
  };
}
