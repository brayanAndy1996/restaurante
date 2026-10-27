import { createHmac } from 'node:crypto';

/** Token de inyección de la clave con la que se calcula la huella de las entradas idempotentes. */
export const CLAVE_HUELLA = Symbol('CLAVE_HUELLA');

/**
 * Clave de la huella de entrada, derivada de `PIN_PEPPER` (`HMAC-SHA256(PIN_PEPPER, 'huella-idempotencia:v1')`):
 * es otra clave distinta de la de los PIN, pero igual de secreta. Sin ella, nadie con solo la base puede
 * recalcular una huella para probar valores de un cuerpo con datos sensibles (como el PIN de `/autorizaciones`).
 */
export function derivarClaveHuella(pinPepperBase64: string | undefined): Buffer {
  if (pinPepperBase64 === undefined) {
    throw new Error(
      'PIN_PEPPER es obligatoria: sin ella no se puede calcular la huella de idempotencia',
    );
  }
  return createHmac('sha256', Buffer.from(pinPepperBase64, 'base64'))
    .update('huella-idempotencia:v1')
    .digest();
}

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

/**
 * Huella de lo que identifica una petición idempotente: ruta, actor y cuerpo canónico (criterios 85 y 86),
 * con HMAC-SHA256 y la clave secreta del entorno (`CLAVE_HUELLA`). Sin esa clave no se puede recalcular.
 */
export function huellaDeEntrada(
  clave: Buffer,
  ruta: string,
  actor: string,
  cuerpo: unknown,
): string {
  return createHmac('sha256', clave)
    .update(`${ruta}\n${actor}\n${jsonCanonico(cuerpo)}`)
    .digest('hex');
}

/** Retención de las claves de idempotencia: 24 horas (criterio 85). */
export const RETENCION_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;
