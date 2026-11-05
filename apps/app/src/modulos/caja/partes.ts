import type { ParteCalculada } from '@restaurante/dominio/caja';

/**
 * Lo que este equipo recuerda de una cuenta que se cobra por partes (historia 006, criterios 65 y 113): las partes ya
 * cobradas desde aquí, tal como las calculó `calcularParte` (hacen falta para calcular la siguiente), en cuántas
 * partes iguales se dividió, y el `id` del cobro en curso hasta que haya una respuesta final. Vive en `localStorage`,
 * por empresa, persona y orden, como el borrador de 004. Nunca guarda una credencial.
 *
 * Si otro equipo cobró una parte, aquí no se conoce su detalle: `anterioresConocidas` devuelve `null` y la pantalla
 * solo ofrece cobrar lo que falta (el saldo que dice la API).
 */

const PREFIJO = 'restaurante.cobro.';

export interface ParteCobrada {
  cobroId: string;
  parte: ParteCalculada;
}

export interface EstadoDeCobro {
  /** Las partes cobradas desde este equipo, en orden. */
  cobradas: ParteCobrada[];
  /** En cuántas partes iguales se dividió la cuenta y cuáles ya se cobraron (ids de cobro); `null` si no se dividió así. */
  iguales: { partes: number; cobroIds: string[] } | null;
  /** El cobro que se mandó y todavía no tiene una respuesta final: el mismo `id` se repite en "Reintentar". */
  enCurso: { id: string; huella: string } | null;
}

export const COBRO_VACIO: EstadoDeCobro = Object.freeze({
  cobradas: [],
  iguales: null,
  enCurso: null,
}) as EstadoDeCobro;

export const claveDeCobro = (empresaId: string, usuarioId: string | null, ordenId: string) =>
  `${PREFIJO}${empresaId}.${usuarioId ?? 'soporte'}.${ordenId}`;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

function esObjeto(dato: unknown): dato is Record<string, unknown> {
  return typeof dato === 'object' && dato !== null;
}

function analizar(texto: string | null | undefined): EstadoDeCobro {
  if (!texto) return COBRO_VACIO;
  try {
    const dato: unknown = JSON.parse(texto);
    if (!esObjeto(dato)) return COBRO_VACIO;
    const cobradas = Array.isArray(dato.cobradas)
      ? dato.cobradas.filter(
          (c): c is ParteCobrada =>
            esObjeto(c) && typeof c.cobroId === 'string' && esObjeto(c.parte),
        )
      : [];
    const iguales =
      esObjeto(dato.iguales) &&
      typeof dato.iguales.partes === 'number' &&
      Array.isArray(dato.iguales.cobroIds)
        ? {
            partes: dato.iguales.partes,
            cobroIds: dato.iguales.cobroIds.filter((i): i is string => typeof i === 'string'),
          }
        : null;
    const enCurso =
      esObjeto(dato.enCurso) &&
      typeof dato.enCurso.id === 'string' &&
      typeof dato.enCurso.huella === 'string'
        ? { id: dato.enCurso.id, huella: dato.enCurso.huella }
        : null;
    return { cobradas, iguales, enCurso };
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

export function guardarEstadoDeCobro(clave: string, estado: EstadoDeCobro): void {
  try {
    const vacio = estado.cobradas.length === 0 && !estado.iguales && !estado.enCurso;
    if (vacio) local()?.removeItem(clave);
    else local()?.setItem(clave, JSON.stringify(estado));
  } catch {
    // Sin almacenamiento, no se recuerda: la cuenta se cobra igual, con lo que dice la API.
  }
}

/**
 * Las partes ya cobradas que este equipo conoce, en el orden de los cobros de la cuenta; `[]` si no hay cobros y
 * `null` si alguno se hizo desde otro equipo (no se sabe qué tomó) y por eso no se puede calcular una parte exacta.
 */
export function anterioresConocidas(
  cobrosDeLaCuenta: readonly { id: string }[],
  estado: EstadoDeCobro,
): ParteCalculada[] | null {
  const partes: ParteCalculada[] = [];
  for (const cobro of cobrosDeLaCuenta) {
    const conocida = estado.cobradas.find(
      (c) => c.cobroId.toLowerCase() === cobro.id.toLowerCase(),
    );
    if (!conocida) return null;
    partes.push(conocida.parte);
  }
  return partes;
}

/** Cuántas partes iguales del plan ya se cobraron (las que siguen en la cuenta). */
export function igualesCobradas(
  cobrosDeLaCuenta: readonly { id: string }[],
  estado: EstadoDeCobro,
): number {
  if (!estado.iguales) return 0;
  const ids = new Set(cobrosDeLaCuenta.map((c) => c.id.toLowerCase()));
  return estado.iguales.cobroIds.filter((i) => ids.has(i.toLowerCase())).length;
}
