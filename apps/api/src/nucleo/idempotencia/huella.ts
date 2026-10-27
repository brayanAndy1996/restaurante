import { createHash } from 'node:crypto';

/** JSON canónico: claves ordenadas, así el mismo cuerpo escrito en otro orden da la misma huella. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v)).join(',')}]`;
  const objeto = valor as Record<string, unknown>;
  const claves = Object.keys(objeto)
    .filter((clave) => objeto[clave] !== undefined)
    .sort();
  return `{${claves.map((clave) => `${JSON.stringify(clave)}:${jsonCanonico(objeto[clave])}`).join(',')}}`;
}

/** Huella de lo que identifica una petición idempotente: ruta, actor y cuerpo canónico (criterios 85 y 86). */
export function huellaDeEntrada(ruta: string, actor: string, cuerpo: unknown): string {
  return createHash('sha256')
    .update(`${ruta}\n${actor}\n${jsonCanonico(cuerpo)}`)
    .digest('hex');
}

/** Retención de las claves de idempotencia: 24 horas (criterio 85). */
export const RETENCION_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;
