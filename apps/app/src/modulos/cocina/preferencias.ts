/**
 * Lo que el equipo recuerda del KDS (criterio 96): las estaciones elegidas en los filtros (por empresa y
 * sucursal, porque cada sucursal sirve las suyas) y si el sonido está activo (por equipo). Nunca una
 * credencial. Sin almacenamiento (modo privado), vale solo mientras la pantalla está abierta.
 */

const PREFIJO = 'restaurante.cocina.';
const CLAVE_SONIDO = `${PREFIJO}sonido`;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

const claveDeEstaciones = (empresaId: string, sucursalId: string) =>
  `${PREFIJO}estaciones.${empresaId}.${sucursalId}`;

/** Las estaciones que este equipo mira en esa sucursal; vacío = todas. */
export function estacionesDelEquipo(empresaId: string, sucursalId: string): string[] {
  try {
    const texto = local()?.getItem(claveDeEstaciones(empresaId, sucursalId));
    const valor: unknown = texto ? JSON.parse(texto) : [];
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function guardarEstacionesDelEquipo(
  empresaId: string,
  sucursalId: string,
  estacionIds: readonly string[],
): void {
  try {
    local()?.setItem(claveDeEstaciones(empresaId, sucursalId), JSON.stringify(estacionIds));
  } catch {
    // Almacenamiento lleno o bloqueado: el filtro vale solo en esta pantalla.
  }
}

/** El sonido viene activo; la persona lo silencia en este equipo. */
export function sonidoActivoEnElEquipo(): boolean {
  try {
    return local()?.getItem(CLAVE_SONIDO) !== 'silenciado';
  } catch {
    return true;
  }
}

export function guardarSonidoDelEquipo(activo: boolean): void {
  try {
    local()?.setItem(CLAVE_SONIDO, activo ? 'activo' : 'silenciado');
  } catch {
    // Sin almacenamiento, no se recuerda.
  }
}
