import { useSyncExternalStore } from 'react';
import type { MotivoDeCambioDeIdentidad } from './identidad';

/**
 * Aviso global de envíos que esperaban la red y se cancelaron porque la sesión cambió (se cerró, entró
 * otra persona, o cambió la sucursal). Si la pantalla que los originó ya no está, este aviso es lo único que
 * le dice a la persona que el cambio no se mandó. Dura hasta que se cierra con "Entendido".
 */
export interface AvisoDeEnvioCancelado {
  motivo: MotivoDeCambioDeIdentidad;
  /** Cuántos envíos se cancelaron por el mismo motivo. */
  cantidad: number;
}

/** Frase corta del porqué, con la misma forma en la pantalla y en el aviso global. */
export const PORQUE_NO_SE_ENVIO: Readonly<Record<MotivoDeCambioDeIdentidad, string>> = {
  usuario: 'cambiaste de usuario',
  cierre: 'se cerró la sesión',
  sucursal: 'cambiaste de sucursal',
};

/** "No se envió: cambiaste de usuario." / "No se enviaron 3 cambios: se cerró la sesión." */
export function textoDeEnvioCancelado(motivo: MotivoDeCambioDeIdentidad, cantidad = 1): string {
  const quien = cantidad === 1 ? 'No se envió' : `No se enviaron ${cantidad} cambios`;
  return `${quien}: ${PORQUE_NO_SE_ENVIO[motivo]}.`;
}

let aviso: AvisoDeEnvioCancelado | null = null;
const oyentes = new Set<() => void>();

function fijar(siguiente: AvisoDeEnvioCancelado | null): void {
  aviso = siguiente;
  oyentes.forEach((oyente) => oyente());
}

export const avisosDeEnvio = {
  leer: (): AvisoDeEnvioCancelado | null => aviso,
  suscribir(oyente: () => void): () => void {
    oyentes.add(oyente);
    return () => oyentes.delete(oyente);
  },
  /** Suma un envío cancelado; con el mismo motivo se cuentan juntos, con otro se muestra el último. */
  publicar(motivo: MotivoDeCambioDeIdentidad): void {
    fijar({ motivo, cantidad: aviso?.motivo === motivo ? aviso.cantidad + 1 : 1 });
  },
  descartar: () => fijar(null),
};

export function useAvisoDeEnvioCancelado(): AvisoDeEnvioCancelado | null {
  return useSyncExternalStore(avisosDeEnvio.suscribir, avisosDeEnvio.leer, avisosDeEnvio.leer);
}
