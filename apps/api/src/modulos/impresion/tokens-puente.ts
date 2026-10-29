/**
 * Formato de los tokens del puente (historia 004, entrega 3b, criterios 106 y 107): cuatro partes separadas por
 * punto, con el mismo formato que `eq.…` de 002. Los ids son UUID en minúsculas y el secreto, 32 bytes aleatorios
 * en base64url (43 caracteres). Solo se guarda la huella del secreto.
 *
 * - `vi.<empresaId>.<vinculacionId>.<secreto>`: código de vinculación (un solo uso, 10 minutos).
 * - `pu.<empresaId>.<puenteId>.<secreto>`: credencial del puente.
 *
 * El analizador es estricto: cualquier otra forma es "mal formado" y quien llama responde 401 sin abrir ningún
 * contexto de empresa ni consultar la base.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SECRETO = '[A-Za-z0-9_-]{43}';

const TOKEN_VINCULACION = new RegExp(`^vi\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);
const TOKEN_PUENTE = new RegExp(`^pu\\.(${UUID})\\.(${UUID})\\.(${SECRETO})$`);

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

/** Partes de un token `vi.…`, o `null` si está mal formado. */
export function parsearTokenVinculacion(token: string): TokenVinculacion | null {
  const partes = TOKEN_VINCULACION.exec(token);
  if (partes === null) return null;
  return { empresaId: partes[1]!, vinculacionId: partes[2]!, secreto: partes[3]! };
}

/** Partes de un token `pu.…`, o `null` si está mal formado. */
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
