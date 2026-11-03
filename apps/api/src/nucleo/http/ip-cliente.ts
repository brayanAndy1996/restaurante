import { createHmac, hkdfSync } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * La IP del cliente de una petición pública y su huella (historia 005, criterio 33). La IP solo sirve para contar
 * llamados por conexión: **nunca se guarda**, solo su huella (HMAC-SHA256 con un secreto derivado de `PIN_PEPPER`).
 */

/** Lo mínimo que se lee de la petición (una `Request` de Express lo cumple). */
export interface PeticionConIp {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined };
}

/**
 * La IP del cliente: el primer valor de la cabecera `cabecera` (`CABECERA_IP_CLIENTE`, en producción
 * `cf-connecting-ip`) si la variable está definida y la cabecera trae una IP válida; si no, la IP de la conexión.
 * Cualquier otra cabecera (`X-Forwarded-For`, `Forwarded`…) se ignora: un cliente podría escribir lo que quisiera
 * en ella. Una IPv4 escrita como IPv6 (`::ffff:1.2.3.4`) se reduce a su IPv4 para que cuente igual por cualquier vía.
 * `undefined` si no hay ninguna.
 */
export function ipDelCliente(
  peticion: PeticionConIp,
  cabecera: string | undefined,
): string | undefined {
  if (cabecera !== undefined) {
    const valor = peticion.headers[cabecera.toLowerCase()];
    const primero = (Array.isArray(valor) ? valor[0] : valor)?.split(',')[0]?.trim();
    if (primero !== undefined && primero !== '' && isIP(primero) !== 0)
      return normalizarIp(primero);
  }
  const conexion = peticion.socket.remoteAddress;
  return conexion === undefined || conexion === '' ? undefined : normalizarIp(conexion);
}

/** Minúsculas y sin el prefijo `::ffff:` de una IPv4 sobre IPv6. */
export function normalizarIp(ip: string): string {
  const minusculas = ip.toLowerCase();
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(minusculas);
  return mapeada?.[1] ?? minusculas;
}

/**
 * Clave con la que se calcula la huella de la IP: `HKDF-SHA256(PIN_PEPPER, info = 'llamado-ip')`, otra clave
 * distinta de las de los PIN y la idempotencia, igual de secreta.
 */
export function derivarClaveHuellaIp(pinPepperBase64: string | undefined): Buffer {
  if (pinPepperBase64 === undefined) {
    throw new Error('PIN_PEPPER es obligatoria: sin ella no se puede calcular la huella de la IP');
  }
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(pinPepperBase64, 'base64'), Buffer.alloc(0), 'llamado-ip', 32),
  );
}

/** Huella de la IP: `HMAC-SHA256(clave, ip)`, 32 bytes. Sin la clave no se puede recalcular ni invertir. */
export function huellaDeIp(clave: Buffer, ip: string): Buffer {
  return createHmac('sha256', clave).update(normalizarIp(ip), 'utf8').digest();
}
