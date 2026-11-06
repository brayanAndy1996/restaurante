import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../../config/entorno';

/**
 * Cifrado de secretos con AES-256-GCM de `node:crypto`, sin servicios externos (historia 006, entrega 6b, criterios
 * 123 y 160). `sellar` cifra con una clave derivada por HKDF-SHA256 de `CLAVE_CIFRADO` y el `proposito`, con un IV
 * aleatorio de 12 bytes y los `datosAsociados` autenticados; el resultado es
 * `versión (1 byte) ‖ claveId (1 byte) ‖ iv (12) ‖ etiqueta (16) ‖ cifrado`. `abrir` prueba la clave del `claveId`
 * (la actual o `CLAVE_CIFRADO_ANTERIOR`, que solo descifra) y falla con un error propio, sin detalles.
 *
 * - **Clave por propósito:** `HKDF-SHA256(CLAVE_CIFRADO, sal fija del sistema, info = proposito)`. Lo sellado para un
 *   propósito no se abre con el de otro.
 * - **Datos asociados:** viajan autenticados pero no dentro del cifrado: lo sellado con `credencial-pse:<empresa>:<emisor>`
 *   copiado a la fila de otro emisor no se puede abrir. La versión y el id de la clave también se autentican.
 * - **Id de la clave:** el primer byte de un resumen SHA-256 de la clave maestra. Así se rota sin guardar una tabla de
 *   claves: al poner la clave nueva en `CLAVE_CIFRADO` y la vieja en `CLAVE_CIFRADO_ANTERIOR`, lo viejo se sigue abriendo y
 *   lo nuevo se cifra con la nueva. El resumen no revela la clave (un byte) y GCM comprueba cuál es la correcta.
 *
 * Propósitos: `credencial-pse` (datos asociados `credencial-pse:<empresaId>:<emisorId>`) y `enlace-comprobante`.
 */

/** Los propósitos con que se deriva la clave (criterios 123 y 160). */
export const PROPOSITOS_DE_CIFRADO = ['credencial-pse', 'enlace-comprobante'] as const;
export type PropositoDeCifrado = (typeof PROPOSITOS_DE_CIFRADO)[number];

export interface OpcionesDeCifrado {
  proposito: PropositoDeCifrado;
  /** Datos autenticados que no viajan en el cifrado: uno copiado a otra fila no se puede abrir. */
  datosAsociados?: string;
}

/** No se pudo abrir lo sellado: clave cambiada, datos asociados que no coinciden o contenido alterado. */
export class CifradoInvalidoError extends Error {
  constructor() {
    super('No se pudo abrir el contenido cifrado');
    this.name = 'CifradoInvalidoError';
  }
}

const VERSION = 1;
const LARGO_IV = 12;
const LARGO_ETIQUETA = 16;
const LARGO_ENCABEZADO = 2;
const LARGO_MINIMO = LARGO_ENCABEZADO + LARGO_IV + LARGO_ETIQUETA;
const LARGO_MINIMO_CLAVE = 32;
/** Sal fija del sistema para HKDF (no es secreta: la clave maestra y el propósito hacen la diferencia). */
const SAL = Buffer.from('restaurante/cifrado/v1', 'utf8');

interface ClaveMaestra {
  bytes: Buffer;
  id: number;
}

function clavesDe(base64: string | undefined, nombre: string): ClaveMaestra | null {
  if (base64 === undefined || base64 === '') return null;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < LARGO_MINIMO_CLAVE) {
    throw new Error(`${nombre} debe tener al menos ${LARGO_MINIMO_CLAVE} bytes en base64`);
  }
  const id = createHash('sha256').update('cifrado/clave-id\0').update(bytes).digest()[0]!;
  return { bytes, id };
}

function derivar(maestra: ClaveMaestra, proposito: PropositoDeCifrado): Buffer {
  return Buffer.from(hkdfSync('sha256', maestra.bytes, SAL, Buffer.from(proposito, 'utf8'), 32));
}

function datosAutenticados(encabezado: Buffer, opciones: OpcionesDeCifrado): Buffer {
  return Buffer.concat([encabezado, Buffer.from(opciones.datosAsociados ?? '', 'utf8')]);
}

function exigirProposito(proposito: string): asserts proposito is PropositoDeCifrado {
  if (!(PROPOSITOS_DE_CIFRADO as readonly string[]).includes(proposito)) {
    throw new TypeError(`Propósito de cifrado desconocido: ${proposito}`);
  }
}

@Injectable()
export class Cifrado {
  private readonly actual: ClaveMaestra | null;
  private readonly anterior: ClaveMaestra | null;

  constructor(@Inject(ENTORNO) entorno: Entorno) {
    this.actual = clavesDe(entorno.CLAVE_CIFRADO, 'CLAVE_CIFRADO');
    this.anterior = clavesDe(entorno.CLAVE_CIFRADO_ANTERIOR, 'CLAVE_CIFRADO_ANTERIOR');
  }

  /** El id de la clave con que `sellar` cifra ahora (`configuracion_pse.clave_id`); el mismo byte que va en lo sellado. */
  claveIdActual(): number {
    return this.claveActual().id;
  }

  /** Cifra `texto`. */
  sellar(texto: string, opciones: OpcionesDeCifrado): Buffer {
    exigirProposito(opciones.proposito);
    const maestra = this.claveActual();
    const encabezado = Buffer.from([VERSION, maestra.id]);
    const iv = randomBytes(LARGO_IV);
    const cifrador = createCipheriv('aes-256-gcm', derivar(maestra, opciones.proposito), iv, {
      authTagLength: LARGO_ETIQUETA,
    });
    cifrador.setAAD(datosAutenticados(encabezado, opciones));
    const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
    return Buffer.concat([encabezado, iv, cifrador.getAuthTag(), cifrado]);
  }

  /** Abre lo sellado o lanza `CifradoInvalidoError` (sin decir por qué: clave, datos asociados o contenido). */
  abrir(sellado: Buffer, opciones: OpcionesDeCifrado): string {
    try {
      exigirProposito(opciones.proposito);
      if (!Buffer.isBuffer(sellado) || sellado.length < LARGO_MINIMO || sellado[0] !== VERSION) {
        throw new CifradoInvalidoError();
      }
      const encabezado = sellado.subarray(0, LARGO_ENCABEZADO);
      const claveId = sellado[1]!;
      const iv = sellado.subarray(LARGO_ENCABEZADO, LARGO_ENCABEZADO + LARGO_IV);
      const etiqueta = sellado.subarray(LARGO_ENCABEZADO + LARGO_IV, LARGO_MINIMO);
      const cifrado = sellado.subarray(LARGO_MINIMO);
      for (const maestra of [this.actual, this.anterior]) {
        if (maestra === null || maestra.id !== claveId) continue;
        try {
          const descifrador = createDecipheriv(
            'aes-256-gcm',
            derivar(maestra, opciones.proposito),
            iv,
            { authTagLength: LARGO_ETIQUETA },
          );
          descifrador.setAAD(datosAutenticados(encabezado, opciones));
          descifrador.setAuthTag(etiqueta);
          return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
        } catch {
          // Otra clave con el mismo id (1 de cada 256) o contenido alterado: se prueba la siguiente.
        }
      }
    } catch {
      // Todo falla igual, sin detalles.
    }
    throw new CifradoInvalidoError();
  }

  private claveActual(): ClaveMaestra {
    if (this.actual === null) throw new Error('Falta CLAVE_CIFRADO');
    return this.actual;
  }
}
