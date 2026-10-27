import { useSyncExternalStore } from 'react';

/**
 * Estado de la conexión con la API, para la cenefa y el banner de "Sin conexión". La PWA solo vive de
 * la nube: no hay modo sin conexión, pero ante un microcorte las escrituras se reintentan sin
 * duplicarse y la pantalla dice cuántos cambios esperan salir.
 */
export interface EstadoConexion {
  /** El último intento de hablar con la API no llegó, o el navegador dice que no hay red. */
  sinConexion: boolean;
  /** Escrituras que fallaron por la red y se siguen reintentando. */
  pendientes: number;
}

let estado: EstadoConexion = {
  sinConexion: typeof navigator !== 'undefined' && navigator.onLine === false,
  pendientes: 0,
};
const oyentes = new Set<() => void>();

function cambiar(cambios: Partial<EstadoConexion>): void {
  const siguiente = { ...estado, ...cambios };
  if (siguiente.sinConexion === estado.sinConexion && siguiente.pendientes === estado.pendientes)
    return;
  estado = siguiente;
  oyentes.forEach((oyente) => oyente());
}

export const conexion = {
  leer: (): EstadoConexion => estado,
  suscribir(oyente: () => void): () => void {
    oyentes.add(oyente);
    return () => oyentes.delete(oyente);
  },
  /** La API respondió (con lo que sea): hay conexión. */
  respondio: () => cambiar({ sinConexion: false }),
  /** Un intento no llegó a la API. */
  fallo: () => cambiar({ sinConexion: true }),
  /** Una escritura empieza a reintentarse por la red. */
  pendienteMas: () => cambiar({ pendientes: estado.pendientes + 1 }),
  /** Una escritura que se reintentaba terminó (bien o mal). */
  pendienteMenos: () => cambiar({ pendientes: Math.max(0, estado.pendientes - 1) }),
  /** Solo para pruebas. */
  reiniciar: () => {
    estado = { sinConexion: false, pendientes: 0 };
    oyentes.forEach((oyente) => oyente());
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => conexion.fallo());
  // Volver la red no prueba que la API responda: se quita el aviso y el siguiente intento lo confirma.
  window.addEventListener('online', () => conexion.respondio());
}

export function useConexion(): EstadoConexion {
  return useSyncExternalStore(conexion.suscribir, conexion.leer, conexion.leer);
}
