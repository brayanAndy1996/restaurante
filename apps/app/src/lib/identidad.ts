import { tokenDeSesion } from './almacen';

/**
 * Quién y dónde escribe la sesión de empresa en este momento: el token (una persona, en un ingreso) y la
 * sucursal activa. Un envío que espera la red (`envios.ts`) guarda la identidad con la que nació y no sale
 * si cambia: así la auditoría nunca atribuye una escritura a otra persona ni la aplica en otra sucursal.
 */
export interface IdentidadDeSesion {
  /** Token de la sesión de empresa; `null` si no hay sesión. */
  token: string | null;
  /** Sucursal activa de la sesión; `null` si aún no eligió o no se conoce. */
  sucursalId: string | null;
}

/** Por qué una identidad dejó de valer: se cerró la sesión, entró otra persona, o cambió de sucursal. */
export type MotivoDeCambioDeIdentidad = 'cierre' | 'usuario' | 'sucursal';

type Fuente = () => IdentidadDeSesion;

/** Sin proveedor de sesión (pruebas de la capa de red), solo se conoce el token guardado. */
let fuente: Fuente = () => ({ token: tokenDeSesion(), sucursalId: null });
const oyentes = new Set<(sugerido?: MotivoDeCambioDeIdentidad) => void>();

/** `SesionProvider` dice de dónde sale la sucursal activa (la sesión en caché). */
export function configurarIdentidad(nueva: Fuente): void {
  fuente = nueva;
}

export function identidadActual(): IdentidadDeSesion {
  return fuente();
}

/** Compara la identidad con la que nació un envío contra la de ahora; `null` si sigue siendo la misma. */
export function cambioDeIdentidad(
  origen: IdentidadDeSesion,
  actual: IdentidadDeSesion = identidadActual(),
): MotivoDeCambioDeIdentidad | null {
  if (origen.token !== actual.token) return actual.token === null ? 'cierre' : 'usuario';
  if (origen.sucursalId !== actual.sucursalId) return 'sucursal';
  return null;
}

/** Quien necesita enterarse de inmediato (los envíos que esperan la red). Devuelve cómo dejar de oír. */
export function alCambiarLaIdentidad(
  oyente: (sugerido?: MotivoDeCambioDeIdentidad) => void,
): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * La sesión cambió (ingreso, cierre, otra sucursal): los envíos pendientes comprueban si siguen valiendo.
 * `sugerido` afina el porqué de un cierre ("Cambiar usuario" cierra la sesión, pero se dice así).
 */
export function avisarCambioDeIdentidad(sugerido?: MotivoDeCambioDeIdentidad): void {
  [...oyentes].forEach((oyente) => oyente(sugerido));
}
