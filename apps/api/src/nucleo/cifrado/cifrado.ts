import { Inject, Injectable } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../../config/entorno';

/**
 * Cifrado de secretos con AES-256-GCM de `node:crypto`, sin servicios externos (historia 006, entrega 6b, criterios
 * 123 y 160). `sellar` cifra con una clave derivada por HKDF-SHA256 de `CLAVE_CIFRADO` y el `proposito`, con un IV
 * aleatorio de 12 bytes y los `datosAsociados` autenticados; el resultado es
 * `versión (1 byte) ‖ claveId (1 byte) ‖ iv (12) ‖ etiqueta (16) ‖ cifrado`. `abrir` prueba la clave del `claveId`
 * (la actual o `CLAVE_CIFRADO_ANTERIOR`, que solo descifra) y falla con un error propio, sin detalles.
 *
 * Propósitos: `credencial-pse` (datos asociados `credencial-pse:<empresaId>:<emisorId>`) y `enlace-comprobante`.
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')` hasta T30.
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

@Injectable()
export class Cifrado {
  constructor(@Inject(ENTORNO) private readonly entorno: Entorno) {}

  /** Cifra `texto`. */
  sellar(texto: string, opciones: OpcionesDeCifrado): Buffer {
    void this.entorno;
    void texto;
    void opciones;
    throw new Error('No implementado');
  }

  /** Abre lo sellado o lanza `CifradoInvalidoError`. */
  abrir(sellado: Buffer, opciones: OpcionesDeCifrado): string {
    void sellado;
    void opciones;
    throw new Error('No implementado');
  }
}
