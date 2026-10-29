/**
 * Almacenamiento de credenciales en el navegador (plan, "Almacenamiento"):
 *
 * - Tokens de equipo (`eq.…`): `localStorage`, un mapa `empresaId → token`. Deben sobrevivir al cierre
 *   del navegador: son lo que permite entrar después con PIN.
 * - Token de la sesión de empresa (`se.…`) y de superadministrador (`sa.…`): `sessionStorage`, así
 *   mueren con la pestaña.
 * - Preferencias del equipo (la estación elegida en Disponibilidad): `localStorage`.
 *
 * La PWA nunca guarda un PIN ni una contraseña.
 */

const CLAVE_EQUIPOS = 'restaurante.equipos';
const CLAVE_SESION = 'restaurante.sesion';
const CLAVE_PLATAFORMA = 'restaurante.plataforma';
const CLAVE_SOPORTE = 'restaurante.soporte';
const PREFIJO_ESTACION = 'restaurante.disponibilidad.estacion.';

export type Ambito = 'empresa' | 'plataforma';

function leerJson<T>(almacen: Storage | undefined, clave: string): T | null {
  try {
    const texto = almacen?.getItem(clave);
    return texto ? (JSON.parse(texto) as T) : null;
  } catch {
    return null;
  }
}

function guardarJson(almacen: Storage | undefined, clave: string, valor: unknown): void {
  try {
    almacen?.setItem(clave, JSON.stringify(valor));
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado): la sesión sigue en memoria de la pestaña.
  }
}

function borrar(almacen: Storage | undefined, clave: string): void {
  try {
    almacen?.removeItem(clave);
  } catch {
    // Nada que borrar.
  }
}

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;
const sesion = (): Storage | undefined =>
  typeof sessionStorage === 'undefined' ? undefined : sessionStorage;

// --- Tokens de equipo -----------------------------------------------------------------------------

export function tokensDeEquipo(): Record<string, string> {
  const mapa = leerJson<Record<string, unknown>>(local(), CLAVE_EQUIPOS) ?? {};
  const limpio: Record<string, string> = {};
  for (const [empresaId, token] of Object.entries(mapa)) {
    if (typeof token === 'string' && token.startsWith('eq.')) limpio[empresaId] = token;
  }
  return limpio;
}

export function tokenDeEquipo(empresaId: string): string | null {
  return tokensDeEquipo()[empresaId] ?? null;
}

export function guardarTokenDeEquipo(empresaId: string, token: string): void {
  guardarJson(local(), CLAVE_EQUIPOS, { ...tokensDeEquipo(), [empresaId]: token });
}

export function borrarTokenDeEquipo(empresaId: string): void {
  const { [empresaId]: _quitado, ...resto } = tokensDeEquipo();
  guardarJson(local(), CLAVE_EQUIPOS, resto);
}

// --- Sesión de empresa -----------------------------------------------------------------------------

export function tokenDeSesion(): string | null {
  return leerJson<{ token: string }>(sesion(), CLAVE_SESION)?.token ?? null;
}

/**
 * Token del equipo con el que se abrió una sesión PIN. La API exige `X-Equipo` en cada petición de una
 * sesión PIN (criterio 37): el cliente lo manda solo mientras esa sesión esté guardada.
 */
export function equipoDeSesion(): string | null {
  const equipo = leerJson<{ equipo?: unknown }>(sesion(), CLAVE_SESION)?.equipo;
  return typeof equipo === 'string' && equipo.startsWith('eq.') ? equipo : null;
}

export function guardarTokenDeSesion(token: string, equipo?: string): void {
  guardarJson(sesion(), CLAVE_SESION, equipo ? { token, equipo } : { token });
}

export function borrarTokenDeSesion(): void {
  borrar(sesion(), CLAVE_SESION);
}

// --- Sesión del superadministrador ------------------------------------------------------------------

export interface SesionPlataforma {
  token: string;
  superadministrador: { id: string; nombre: string };
}

export function sesionDePlataforma(): SesionPlataforma | null {
  const dato = leerJson<SesionPlataforma>(sesion(), CLAVE_PLATAFORMA);
  return dato?.token && dato.superadministrador ? dato : null;
}

export function guardarSesionDePlataforma(datos: SesionPlataforma): void {
  guardarJson(sesion(), CLAVE_PLATAFORMA, datos);
}

export function borrarSesionDePlataforma(): void {
  borrar(sesion(), CLAVE_PLATAFORMA);
}

// --- Modo soporte ------------------------------------------------------------------------------------

/** Datos del soporte en curso: la sesión de empresa es la de soporte, y esto dice a quién se atiende. */
export interface SoporteEnCurso {
  empresaId: string;
  empresaNombre: string;
  /** Momento en que se abrió (ISO): el soporte dura 2 horas como máximo. */
  iniciadoEn: string;
}

export function soporteEnCurso(): SoporteEnCurso | null {
  return leerJson<SoporteEnCurso>(sesion(), CLAVE_SOPORTE);
}

export function guardarSoporteEnCurso(datos: SoporteEnCurso): void {
  guardarJson(sesion(), CLAVE_SOPORTE, datos);
}

export function borrarSoporteEnCurso(): void {
  borrar(sesion(), CLAVE_SOPORTE);
}

/** Token según el ámbito de la petición. */
export function tokenDe(ambito: Ambito): string | null {
  return ambito === 'plataforma' ? (sesionDePlataforma()?.token ?? null) : tokenDeSesion();
}

// --- Preferencias de este equipo -----------------------------------------------------------------------

/**
 * La última estación elegida en Disponibilidad para la empresa; `null` = todas. Es una preferencia del
 * equipo (`localStorage`), no una credencial. Un almacenamiento bloqueado no rompe nada.
 */
export function estacionGuardada(empresaId: string): string | null {
  try {
    const guardada = local()?.getItem(`${PREFIJO_ESTACION}${empresaId}`);
    return guardada && guardada !== 'todas' ? guardada : null;
  } catch {
    return null;
  }
}

export function guardarEstacion(empresaId: string, estacionId: string | null): void {
  // Almacenamiento lleno o bloqueado (modo privado): el filtro vale solo en esta pantalla.
  try {
    local()?.setItem(`${PREFIJO_ESTACION}${empresaId}`, estacionId ?? 'todas');
  } catch {
    // Sin almacenamiento no hay nada que recordar.
  }
}

// --- Salón: zona y vista de este equipo ------------------------------------------------------------------

const PREFIJO_SALON = 'restaurante.salon.';

export type VistaDelSalon = 'mapa' | 'lista';

/** Lo que el equipo recuerda del salón: la última zona vista y si prefirió el mapa o la lista. */
export interface PreferenciaDelSalon {
  zonaId: string | null;
  vista: VistaDelSalon | null;
}

/** Es del equipo, de la empresa y de la sucursal (otra sucursal tiene otras zonas); nunca una credencial. */
export function preferenciaDelSalon(empresaId: string, sucursalId: string): PreferenciaDelSalon {
  const dato = leerJson<{ zonaId?: unknown; vista?: unknown }>(
    local(),
    `${PREFIJO_SALON}${empresaId}.${sucursalId}`,
  );
  return {
    zonaId: typeof dato?.zonaId === 'string' ? dato.zonaId : null,
    vista: dato?.vista === 'mapa' || dato?.vista === 'lista' ? dato.vista : null,
  };
}

export function guardarPreferenciaDelSalon(
  empresaId: string,
  sucursalId: string,
  cambios: Partial<PreferenciaDelSalon>,
): void {
  guardarJson(local(), `${PREFIJO_SALON}${empresaId}.${sucursalId}`, {
    ...preferenciaDelSalon(empresaId, sucursalId),
    ...cambios,
  });
}
