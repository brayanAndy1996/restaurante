import { MAXIMO_PARTES_IGUALES } from '@restaurante/dominio';

/**
 * Lo que este equipo recuerda de un cobro (historia 006, criterios 55, 65 y 113). Vive en `localStorage`, por empresa,
 * persona y orden, como el borrador de 004. Nunca guarda una credencial. Son dos datos y nada más:
 *
 * - `enCurso`: el `id` del cobro que se mandó y aún no tiene respuesta final, para que «Reintentar» mande el mismo
 *   cobro y no se duplique.
 * - `partesTotales`: en cuántas partes iguales se dividió la cuenta. La API no lo guarda (solo las partes ya cobradas,
 *   con su `detalleParte`), así que con este total y lo cobrado se calculan las partes que faltan, también al recargar.
 *
 * Las partes ya cobradas no se recuerdan aquí: cada cobro de `GET /cuentas/:ordenId` trae su `detalleParte`, y con eso
 * se calcula la parte siguiente desde cualquier equipo.
 */

const PREFIJO = 'restaurante.cobro.';

export interface EstadoDeCobro {
  /** El cobro que se mandó y todavía no tiene una respuesta final: el mismo `id` se repite en "Reintentar". */
  enCurso: { id: string; huella: string } | null;
  /** En cuántas partes iguales se dividió la cuenta, contando las ya cobradas; `null` si este equipo no lo sabe. */
  partesTotales: number | null;
}

export const COBRO_VACIO: EstadoDeCobro = Object.freeze({
  enCurso: null,
  partesTotales: null,
}) as EstadoDeCobro;

export const claveDeCobro = (empresaId: string, usuarioId: string | null, ordenId: string) =>
  `${PREFIJO}${empresaId}.${usuarioId ?? 'soporte'}.${ordenId}`;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

function analizar(texto: string | null | undefined): EstadoDeCobro {
  if (!texto) return COBRO_VACIO;
  try {
    const dato: unknown = JSON.parse(texto);
    if (typeof dato !== 'object' || dato === null) return COBRO_VACIO;
    const { enCurso, partesTotales } = dato as { enCurso?: unknown; partesTotales?: unknown };
    let cobro: EstadoDeCobro['enCurso'] = null;
    if (typeof enCurso === 'object' && enCurso !== null) {
      const { id, huella } = enCurso as { id?: unknown; huella?: unknown };
      if (typeof id === 'string' && typeof huella === 'string') cobro = { id, huella };
    }
    const partes =
      Number.isInteger(partesTotales) &&
      (partesTotales as number) >= 2 &&
      (partesTotales as number) <= MAXIMO_PARTES_IGUALES
        ? (partesTotales as number)
        : null;
    return cobro === null && partes === null
      ? COBRO_VACIO
      : { enCurso: cobro, partesTotales: partes };
  } catch {
    return COBRO_VACIO;
  }
}

export function leerEstadoDeCobro(clave: string): EstadoDeCobro {
  try {
    return analizar(local()?.getItem(clave));
  } catch {
    return COBRO_VACIO;
  }
}

/** Guarda el estado; si no queda nada que recordar, borra la clave. */
export function guardarEstadoDeCobro(clave: string, estado: EstadoDeCobro): void {
  try {
    if (estado.enCurso || estado.partesTotales !== null) {
      local()?.setItem(
        clave,
        JSON.stringify({ enCurso: estado.enCurso, partesTotales: estado.partesTotales }),
      );
    } else {
      local()?.removeItem(clave);
    }
  } catch {
    // Sin almacenamiento, no se recuerda: la cuenta se cobra igual, con lo que dice la API.
  }
}

/** Cambia una parte del estado guardado sin tocar la otra. */
export function recordarEnCobro(clave: string, cambio: Partial<EstadoDeCobro>): void {
  guardarEstadoDeCobro(clave, { ...leerEstadoDeCobro(clave), ...cambio });
}
