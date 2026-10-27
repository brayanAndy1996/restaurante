import { useEffect, useState } from 'react';
import { ahoraDelServidor } from './api';

/** Segundos que faltan hasta `hasta` (ms de época), medidos con la hora del servidor; 0 si ya pasó. */
export function segundosHasta(hasta: number): number {
  return Math.max(0, Math.ceil((hasta - ahoraDelServidor()) / 1000));
}

/**
 * Cuenta regresiva en segundos hasta un instante (ISO o ms de época). Se vuelve a dibujar cada segundo
 * mientras falte tiempo y se detiene en 0. Sin instante, siempre 0. El valor se calcula al dibujar, así
 * que un instante nuevo se ve de inmediato, sin un cuadro con el valor viejo.
 */
export function useSegundosHasta(hasta: string | number | null): number {
  const meta = hasta === null ? null : typeof hasta === 'number' ? hasta : Date.parse(hasta);
  const valido = meta !== null && !Number.isNaN(meta);
  const [, dibujar] = useState(0);
  useEffect(() => {
    if (!valido || segundosHasta(meta) <= 0) return;
    const reloj = setInterval(() => {
      dibujar((n) => n + 1);
      if (segundosHasta(meta) <= 0) clearInterval(reloj);
    }, 1000);
    return () => clearInterval(reloj);
  }, [meta, valido]);
  return valido ? segundosHasta(meta) : 0;
}
