import { Icono, IconoAlerta, IconoReloj } from './iconos';
import { clases } from './utilidades';

/** Desde cuántos minutos una comanda "demora" (ají). Fijo, decisión del especificador aprobada el 2026-10-29. */
export const MINUTOS_DE_DEMORA = 10;
/** Desde cuántos minutos una comanda está "atrasada" (rocoto). */
export const MINUTOS_DE_ATRASO = 20;

export type NivelDeTiempo = 'normal' | 'demora' | 'atraso';

/** Cómo va una comanda según los minutos que lleva: menos de 10, de 10 a 19 y 20 o más. */
export function nivelDeTiempo(minutos: number): NivelDeTiempo {
  if (minutos >= MINUTOS_DE_ATRASO) return 'atraso';
  if (minutos >= MINUTOS_DE_DEMORA) return 'demora';
  return 'normal';
}

/** La palabra que acompaña al color: el color nunca es la única señal. */
export const TEXTO_DE_NIVEL: Record<NivelDeTiempo, string | null> = {
  normal: null,
  demora: 'Demora',
  atraso: 'Atrasada',
};

/** Minutos enteros desde `desde` hasta `ahora` (ms de época), nunca negativos. */
export function minutosTranscurridos(desde: string | number, ahora: number): number {
  const inicio = typeof desde === 'number' ? desde : Date.parse(desde);
  if (Number.isNaN(inicio)) return 0;
  return Math.max(0, Math.floor((ahora - inicio) / 60_000));
}

/** "7 min", "1 h 05 min". */
export function textoDeMinutos(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

interface PropsTemporizador {
  /** Cuándo llegó la comanda (texto ISO o ms de época). */
  desde: string | number;
  /** La hora de ahora en ms de época; quien lo usa la saca de la hora del servidor, no del reloj del equipo. */
  ahora: number;
  className?: string;
}

/**
 * Tiempo transcurrido de una comanda, grande para leerlo de lejos. Cambia a ají a los 10 minutos ("Demora") y
 * a rocoto a los 20 ("Atrasada"): siempre con la palabra y el icono además del color. Es un `timer`, así que
 * los lectores de pantalla no lo repiten cada vez que cambia.
 */
export function Temporizador({ desde, ahora, className }: PropsTemporizador) {
  const minutos = minutosTranscurridos(desde, ahora);
  const nivel = nivelDeTiempo(minutos);
  const palabra = TEXTO_DE_NIVEL[nivel];
  const tiempo = textoDeMinutos(minutos);
  return (
    <span
      className={clases('ui-temporizador', `ui-temporizador--${nivel}`, className)}
      role="timer"
      aria-label={palabra ? `${tiempo}, ${palabra.toLowerCase()}` : tiempo}
      data-nivel={nivel}
    >
      <span className="ui-temporizador__tiempo">
        <Icono icono={nivel === 'normal' ? IconoReloj : IconoAlerta} tamano={20} />
        {tiempo}
      </span>
      {palabra ? <span className="ui-temporizador__nivel">{palabra}</span> : null}
    </span>
  );
}
