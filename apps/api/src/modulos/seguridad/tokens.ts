/**
 * Formato de los tokens (spec.md, "Contrato"): tres o cuatro partes separadas por punto; los ids son UUID
 * en minúsculas y el secreto, 32 bytes aleatorios en base64url (43 caracteres).
 *
 * - `se.<empresaId>.<sesionId>.<secreto>`: sesión de empresa (contraseña, PIN o soporte).
 * - `sa.<sesionId>.<secreto>`: sesión de superadministrador.
 * - `eq.<empresaId>.<equipoId>.<secreto>`: equipo (cabecera `X-Equipo`).
 * - `vi.<empresaId>.<vinculacionId>.<secreto>`: código de vinculación del puente de impresión (3b; un solo uso).
 * - `pu.<empresaId>.<puenteId>.<secreto>`: credencial del puente de impresión (3b).
 *
 * El analizador es estricto: cualquier otra forma es "mal formado" y quien llama responde 401 sin abrir
 * ningún contexto de empresa ni consultar la base.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SECRETO = '[A-Za-z0-9_-]{43}';

const TOKEN_SESION = new RegExp(`^se\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);
const TOKEN_SUPERADMINISTRADOR = new RegExp(`^sa\\.(${UUID})\\.(${SECRETO})$`);
const TOKEN_EQUIPO = new RegExp(`^eq\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);
const TOKEN_VINCULACION = new RegExp(`^vi\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);
const TOKEN_PUENTE = new RegExp(`^pu\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);

export interface TokenSesion {
  empresaId: string;
  sesionId: string;
  secreto: string;
}

export interface TokenSuperadministrador {
  sesionId: string;
  secreto: string;
}

export interface TokenEquipo {
  empresaId: string;
  equipoId: string;
  secreto: string;
}

/** Partes de un token `se.…`, o `null` si está mal formado. */
export function parsearTokenSesion(token: string): TokenSesion | null {
  const partes = TOKEN_SESION.exec(token);
  if (partes === null) return null;
  return { empresaId: partes[1]!, sesionId: partes[2]!, secreto: partes[3]! };
}

export interface TokenVinculacion {
  empresaId: string;
  vinculacionId: string;
  secreto: string;
}

export interface TokenPuente {
  empresaId: string;
  puenteId: string;
  secreto: string;
}

/** Partes de un token `sa.…`, o `null` si está mal formado. */
export function parsearTokenSuperadministrador(token: string): TokenSuperadministrador | null {
  const partes = TOKEN_SUPERADMINISTRADOR.exec(token);
  if (partes === null) return null;
  return { sesionId: partes[1]!, secreto: partes[2]! };
}

/** Partes de un token `eq.…`, o `null` si está mal formado. */
export function parsearTokenEquipo(token: string): TokenEquipo | null {
  const partes = TOKEN_EQUIPO.exec(token);
  if (partes === null) return null;
  return { empresaId: partes[1]!, equipoId: partes[2]!, secreto: partes[3]! };
}

export function armarTokenSesion(empresaId: string, sesionId: string, secreto: string): string {
  return `se.${empresaId}.${sesionId}.${secreto}`;
}

export function armarTokenSuperadministrador(sesionId: string, secreto: string): string {
  return `sa.${sesionId}.${secreto}`;
}

export function armarTokenEquipo(empresaId: string, equipoId: string, secreto: string): string {
  return `eq.${empresaId}.${equipoId}.${secreto}`;
}

/** Partes de un token `vi.…` de vinculación del puente, o `null` si está mal formado. */
export function parsearTokenVinculacion(token: string): TokenVinculacion | null {
  const partes = TOKEN_VINCULACION.exec(token);
  if (partes === null) return null;
  return { empresaId: partes[1]!, vinculacionId: partes[2]!, secreto: partes[3]! };
}

/** Partes de un token `pu.…` del puente, o `null` si está mal formado. */
export function parsearTokenPuente(token: string): TokenPuente | null {
  const partes = TOKEN_PUENTE.exec(token);
  if (partes === null) return null;
  return { empresaId: partes[1]!, puenteId: partes[2]!, secreto: partes[3]! };
}

export function armarTokenVinculacion(
  empresaId: string,
  vinculacionId: string,
  secreto: string,
): string {
  return `vi.${empresaId}.${vinculacionId}.${secreto}`;
}

export function armarTokenPuente(empresaId: string, puenteId: string, secreto: string): string {
  return `pu.${empresaId}.${puenteId}.${secreto}`;
}
