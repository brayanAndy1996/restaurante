import {
  eventoLlamadoCambioDatosSchema,
  eventoLlamadoNuevoDatosSchema,
  type EventoLlamadoNuevo,
} from '@restaurante/contratos';
import { useSyncExternalStore } from 'react';
import { motorDeSonido } from '../modulos/cocina/sonido';
import { alRecibirEvento } from './tiempo-real';

/**
 * Avisos de llamados desde la mesa (005, criterios 69 y 70). Cuando un cliente manda un pedido o llama al
 * mozo desde el QR de su mesa, la API publica `llamado.nuevo` con los `destinatarios`: el mozo responsable
 * de la mesa o, si estaba libre, `null` (todas las personas que atienden mesas). Solo esas personas reciben el
 * aviso (banner, sonido y vibración); las demás lo ven en la lista, sin sonido.
 *
 * - Los avisos viven en memoria y en esta pestaña (sin notificaciones del sistema: solo con la app abierta).
 * - Un aviso se queda hasta que se toca "Ver" o hasta que el llamado deja de estar pendiente
 *   (`llamado.cambio`): atenderlo en otro equipo lo quita aquí también.
 * - El sonido se puede silenciar en este equipo (se recuerda) y empieza después del primer toque en la app,
 *   porque los navegadores bloquean el audio sin un gesto de la persona.
 * - Pertenecen a la persona de la sesión: al cambiar de usuario o salir, se vacían.
 */

type DatosDeLlamadoNuevo = EventoLlamadoNuevo['datos'];

export interface AvisoDeLlamado {
  /** El id del llamado: uno por llamado, así que un evento repetido reemplaza al aviso anterior. */
  id: string;
  tipo: DatosDeLlamadoNuevo['tipo'];
  mesaNombre: string;
  /** Cuándo llegó (ms de época del equipo). */
  recibidoEn: number;
}

let avisos: readonly AvisoDeLlamado[] = [];
const oyentes = new Set<() => void>();

function poner(nuevos: readonly AvisoDeLlamado[]): void {
  avisos = nuevos;
  oyentes.forEach((oyente) => oyente());
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** Los avisos pendientes, el más reciente primero. */
export function useAvisosDeLlamados(): readonly AvisoDeLlamado[] {
  return useSyncExternalStore(
    suscribir,
    () => avisos,
    () => avisos,
  );
}

export function quitarAvisoDeLlamado(id: string): void {
  if (avisos.some((a) => a.id === id)) poner(avisos.filter((a) => a.id !== id));
}

export function quitarTodosLosAvisosDeLlamados(): void {
  if (avisos.length > 0) poner([]);
}

// --- Sonido y vibración ---------------------------------------------------------------------------

const CLAVE_SONIDO = 'restaurante.llamados.sonido';
const oyentesDeSonido = new Set<() => void>();

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/** El aviso sonoro viene activo; la persona lo silencia en este equipo. */
export function sonidoDeLlamadosActivo(): boolean {
  try {
    return local()?.getItem(CLAVE_SONIDO) !== 'silenciado';
  } catch {
    return true;
  }
}

export function guardarSonidoDeLlamados(activo: boolean): void {
  try {
    local()?.setItem(CLAVE_SONIDO, activo ? 'activo' : 'silenciado');
  } catch {
    // Sin almacenamiento no se recuerda: vale hasta recargar.
  }
  oyentesDeSonido.forEach((oyente) => oyente());
}

/** Si el sonido de los llamados está activo en este equipo, y cómo cambiarlo. */
export function useSonidoDeLlamados(): [boolean, (activo: boolean) => void] {
  const activo = useSyncExternalStore(
    (oyente) => {
      oyentesDeSonido.add(oyente);
      const alAlmacenar = (e: StorageEvent) => {
        if (e.key === null || e.key === CLAVE_SONIDO) oyente();
      };
      window.addEventListener('storage', alAlmacenar);
      return () => {
        oyentesDeSonido.delete(oyente);
        window.removeEventListener('storage', alAlmacenar);
      };
    },
    sonidoDeLlamadosActivo,
    () => true,
  );
  return [activo, guardarSonidoDeLlamados];
}

function vibrar(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate([300, 120, 300, 120, 300]);
  } catch {
    // El navegador no deja vibrar (iPhone, o sin gesto previo): el aviso se ve igual.
  }
}

/**
 * Los navegadores no dejan sonar nada hasta que la persona toca la pantalla: el primer toque (o tecla)
 * despierta el audio. Si la persona ya tocó la app antes de que esto se instalara, se despierta de una vez.
 * Devuelve cómo quitar los oyentes.
 */
export function instalarDesbloqueoDeSonido(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const activacion = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  if (activacion?.hasBeenActive) motorDeSonido().desbloquear();
  const eventos = ['pointerdown', 'keydown', 'touchstart'] as const;
  const quitar = () => eventos.forEach((e) => window.removeEventListener(e, desbloquear));
  function desbloquear() {
    if (motorDeSonido().desbloquear()) quitar();
  }
  eventos.forEach((e) => window.addEventListener(e, desbloquear, { passive: true }));
  return quitar;
}

// --- Eventos --------------------------------------------------------------------------------------

/**
 * Llegó un `llamado.nuevo`: si esta persona es destinataria (o `destinatarios` es `null`), se guarda el aviso,
 * suena (salvo que el equipo esté en silencio) y vibra. Un evento mal formado no hace nada. Devuelve si lo
 * guardó.
 */
export function recibirLlamadoNuevo(
  datos: unknown,
  usuarioId: string,
  ahoraMs = Date.now(),
): boolean {
  const analizado = eventoLlamadoNuevoDatosSchema.safeParse(datos);
  if (!analizado.success) return false;
  const llamado = analizado.data;
  if (llamado.destinatarios !== null && !llamado.destinatarios.includes(usuarioId)) return false;
  const repetido = avisos.some((a) => a.id === llamado.llamadoId);
  poner([
    {
      id: llamado.llamadoId,
      tipo: llamado.tipo,
      mesaNombre: llamado.mesaNombre,
      recibidoEn: ahoraMs,
    },
    ...avisos.filter((a) => a.id !== llamado.llamadoId),
  ]);
  if (!repetido) {
    if (sonidoDeLlamadosActivo()) motorDeSonido().avisar();
    vibrar();
  }
  return true;
}

/** Llegó un `llamado.cambio`: si el llamado ya no está pendiente, su aviso sale (otro equipo lo atendió). */
export function recibirLlamadoCambio(datos: unknown): void {
  const analizado = eventoLlamadoCambioDatosSchema.safeParse(datos);
  if (analizado.success && analizado.data.estado !== 'PENDIENTE')
    quitarAvisoDeLlamado(analizado.data.llamadoId);
}

/**
 * Empieza a guardar los avisos de `usuarioId` (la persona de la sesión). Devuelve cómo parar; al parar se
 * vacía la lista, para que no pase a quien entre después en el mismo equipo.
 */
export function instalarAvisosDeLlamados(usuarioId: string): () => void {
  quitarTodosLosAvisosDeLlamados();
  const quitarDesbloqueo = instalarDesbloqueoDeSonido();
  const dejar = alRecibirEvento((nombre, datos) => {
    if (nombre === 'llamado.nuevo') recibirLlamadoNuevo(datos, usuarioId);
    else if (nombre === 'llamado.cambio') recibirLlamadoCambio(datos);
  });
  return () => {
    dejar();
    quitarDesbloqueo();
    quitarTodosLosAvisosDeLlamados();
  };
}
