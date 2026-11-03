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
 * en ella. La IP sale en su forma canónica (`normalizarIp`): una IPv4 escrita como IPv6 (`::ffff:1.2.3.4`) es su IPv4
 * y una IPv6 tiene una sola escritura, para que cuente igual por cualquier vía. `undefined` si no hay ninguna.
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

/**
 * Los ocho grupos de 16 bits de una IPv6 (acepta la forma comprimida `::`, mayúsculas, un sufijo IPv4 como
 * `::ffff:1.2.3.4` y un identificador de zona `%eth0`, que se ignora), o `undefined` si no lo es.
 */
function gruposIpv6(ip: string): number[] | undefined {
  let texto = ip.trim().toLowerCase();
  const zona = texto.indexOf('%');
  if (zona >= 0) texto = texto.slice(0, zona);
  const cola = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texto);
  if (cola !== null) {
    const octetos = cola.slice(1, 5).map(Number);
    if (octetos.some((o) => o > 255)) return undefined;
    const hex = (n: number) => n.toString(16);
    texto = `${texto.slice(0, cola.index)}${hex(octetos[0]! * 256 + octetos[1]!)}:${hex(octetos[2]! * 256 + octetos[3]!)}`;
  }
  const partes = texto.split('::');
  if (partes.length > 2) return undefined;
  const izquierda = partes[0] === '' ? [] : (partes[0] ?? '').split(':');
  const derecha = partes.length === 2 && partes[1] !== '' ? (partes[1] ?? '').split(':') : [];
  let grupos: string[];
  if (partes.length === 1) {
    grupos = izquierda;
  } else {
    const faltan = 8 - izquierda.length - derecha.length;
    if (faltan < 1) return undefined;
    grupos = [...izquierda, ...Array<string>(faltan).fill('0'), ...derecha];
  }
  if (grupos.length !== 8) return undefined;
  const numeros = grupos.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return numeros.some(Number.isNaN) ? undefined : numeros;
}

/** `true` si los grupos son una IPv4 escrita como IPv6 (`::ffff:a.b.c.d`, también en su forma `::ffff:abcd:ef01`). */
const esIpv4Mapeada = (g: readonly number[]): boolean =>
  g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;

/** La IPv6 en su forma canónica de RFC 5952: minúsculas, sin ceros a la izquierda y el tramo más largo de ceros como `::`. */
function ipv6Canonica(g: readonly number[]): string {
  let mejorInicio = -1;
  let mejorLargo = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i += 1;
      continue;
    }
    let fin = i;
    while (fin < 8 && g[fin] === 0) fin += 1;
    if (fin - i > mejorLargo) {
      mejorInicio = i;
      mejorLargo = fin - i;
    }
    i = fin;
  }
  const hex = (n: number) => n.toString(16);
  if (mejorLargo < 2) return g.map(hex).join(':');
  const antes = g.slice(0, mejorInicio).map(hex).join(':');
  const despues = g.slice(mejorInicio + mejorLargo).map(hex).join(':');
  return `${antes}::${despues}`;
}

/**
 * La IP en una sola forma canónica, para que la misma conexión cuente igual escrita de cualquier manera: una IPv4 es
 * su forma de cuatro números; una IPv4 sobre IPv6 (`::ffff:1.2.3.4`, `::FFFF:0102:0304`) es esa IPv4; una IPv6 es su
 * forma de RFC 5952 (`2001:DB8:0:0::1` y `2001:0db8::1` son `2001:db8::1`) y sin el identificador de zona. Lo que no
 * se reconoce como IP vuelve en minúsculas.
 */
export function normalizarIp(ip: string): string {
  const texto = ip.trim();
  if (!texto.includes(':')) return texto.toLowerCase();
  const grupos = gruposIpv6(texto);
  if (grupos === undefined) return texto.toLowerCase();
  if (esIpv4Mapeada(grupos)) {
    const [a, b] = [grupos[6]!, grupos[7]!];
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return ipv6Canonica(grupos);
}

/**
 * Lo que identifica a la conexión en el límite: la IPv4 completa, o de una IPv6 su prefijo /64 (los primeros cuatro
 * grupos): una sola conexión doméstica tiene un /64 entero y cambiar de dirección dentro de él no debe dar un límite
 * nuevo (criterio 33).
 */
export function conexionDeIp(ip: string): string {
  const canonica = normalizarIp(ip);
  if (!canonica.includes(':')) return canonica;
  const grupos = gruposIpv6(canonica);
  if (grupos === undefined) return canonica;
  return `${grupos
    .slice(0, 4)
    .map((x) => x.toString(16).padStart(4, '0'))
    .join(':')}/64`;
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

/**
 * Huella de la IP: `HMAC-SHA256(clave, conexión)`, 32 bytes, donde la conexión es la IPv4 canónica o el prefijo /64 de
 * la IPv6 (`conexionDeIp`). Sin la clave no se puede recalcular ni invertir.
 */
export function huellaDeIp(clave: Buffer, ip: string): Buffer {
  return createHmac('sha256', clave).update(conexionDeIp(ip), 'utf8').digest();
}
