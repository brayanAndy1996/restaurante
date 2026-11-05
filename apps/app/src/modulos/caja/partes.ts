/**
 * Lo que este equipo recuerda de un cobro (historia 006, criterio 55): solo el `id` del cobro en curso hasta que haya
 * una respuesta final, para que «Reintentar» mande el mismo cobro y no se duplique. Vive en `localStorage`, por
 * empresa, persona y orden, como el borrador de 004. Nunca guarda una credencial.
 *
 * Las partes ya cobradas no se recuerdan aquí: cada cobro de `GET /cuentas/:ordenId` trae su `detalleParte`, y con eso
 * se calcula la parte siguiente desde cualquier equipo.
 */

const PREFIJO = 'restaurante.cobro.';

export interface EstadoDeCobro {
  /** El cobro que se mandó y todavía no tiene una respuesta final: el mismo `id` se repite en "Reintentar". */
  enCurso: { id: string; huella: string } | null;
}

export const COBRO_VACIO: EstadoDeCobro = Object.freeze({ enCurso: null }) as EstadoDeCobro;

export const claveDeCobro = (empresaId: string, usuarioId: string | null, ordenId: string) =>
  `${PREFIJO}${empresaId}.${usuarioId ?? 'soporte'}.${ordenId}`;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

function analizar(texto: string | null | undefined): EstadoDeCobro {
  if (!texto) return COBRO_VACIO;
  try {
    const dato: unknown = JSON.parse(texto);
    if (typeof dato !== 'object' || dato === null) return COBRO_VACIO;
    const { enCurso } = dato as { enCurso?: unknown };
    if (typeof enCurso !== 'object' || enCurso === null) return COBRO_VACIO;
    const { id, huella } = enCurso as { id?: unknown; huella?: unknown };
    return typeof id === 'string' && typeof huella === 'string'
      ? { enCurso: { id, huella } }
      : COBRO_VACIO;
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
    if (estado.enCurso) local()?.setItem(clave, JSON.stringify({ enCurso: estado.enCurso }));
    else local()?.removeItem(clave);
  } catch {
    // Sin almacenamiento, no se recuerda: la cuenta se cobra igual, con lo que dice la API.
  }
}
