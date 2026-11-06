import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import { Cifrado } from '../../nucleo/cifrado';
import { RELOJ, type Reloj } from '../../nucleo/reloj';

/** Lo que lleva un enlace público (criterio 160): `{ v: 1, empresaId, comprobanteId, expiraEn }` cifrado. */
export interface DatosDeEnlace {
  empresaId: string;
  comprobanteId: string;
}

/** Un sello válido mide unos 190 caracteres; uno más largo que esto ni se intenta abrir. */
const LARGO_MAXIMO_DEL_SELLO = 512;
const VERSION_DEL_SELLO = 1;
const PROPOSITO = 'enlace-comprobante';

/**
 * El sello del enlace público de un comprobante (historia 006, entrega 6b, criterio 160): `{ v: 1, empresaId,
 * comprobanteId, expiraEn }` cifrado con AES-256-GCM (propósito `enlace-comprobante`, clave derivada de `CLAVE_CIFRADO`) y
 * codificado en base64url: no se puede adivinar, alterar ni fabricar, y no deja ver los ids (el IV es aleatorio, así que
 * dos sellos del mismo comprobante son distintos). Vence a los `DIAS_ENLACE_COMPROBANTE` días con el reloj de la API; no
 * se guarda, así que no se revoca.
 *
 * `abrir` solo acepta la codificación canónica del sello (lo que `sellar` produce): un carácter de más, uno cambiado en
 * los bits de relleno o basura al final no abren nada, y devuelve `null` sin decir por qué (alterado, de otra clave, de
 * otro propósito, mal formado o vencido).
 */
@Injectable()
export class EnlacesComprobante {
  constructor(
    @Inject(Cifrado) private readonly cifrado: Cifrado,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** El sello de un comprobante, con vencimiento en `expiraEn` (el llamador usa `DIAS_ENLACE_COMPROBANTE` días del reloj). */
  sellar(datos: DatosDeEnlace & { expiraEn: Date }): string {
    const texto = JSON.stringify({
      v: VERSION_DEL_SELLO,
      empresaId: datos.empresaId,
      comprobanteId: datos.comprobanteId,
      expiraEn: datos.expiraEn.toISOString(),
    });
    return this.cifrado.sellar(texto, { proposito: PROPOSITO }).toString('base64url');
  }

  /** Abre el sello con el reloj de la API; `null` si está alterado, vencido, de otra clave o mal formado. */
  abrir(sello: string): DatosDeEnlace | null {
    try {
      if (
        typeof sello !== 'string' ||
        sello.length === 0 ||
        sello.length > LARGO_MAXIMO_DEL_SELLO ||
        !/^[A-Za-z0-9_-]+$/.test(sello)
      ) {
        return null;
      }
      const bytes = Buffer.from(sello, 'base64url');
      // Solo la forma canónica: lo que no vuelve a codificarse igual tiene relleno o caracteres de más.
      if (bytes.toString('base64url') !== sello) return null;
      const dato: unknown = JSON.parse(this.cifrado.abrir(bytes, { proposito: PROPOSITO }));
      if (typeof dato !== 'object' || dato === null) return null;
      const { v, empresaId, comprobanteId, expiraEn } = dato as Record<string, unknown>;
      if (v !== VERSION_DEL_SELLO || typeof expiraEn !== 'string') return null;
      const empresa = uuidSchema.safeParse(empresaId);
      const comprobante = uuidSchema.safeParse(comprobanteId);
      if (!empresa.success || !comprobante.success) return null;
      const vence = Date.parse(expiraEn);
      if (Number.isNaN(vence) || vence <= this.reloj.ahora().getTime()) return null;
      return {
        empresaId: empresa.data.toLowerCase(),
        comprobanteId: comprobante.data.toLowerCase(),
      };
    } catch {
      return null;
    }
  }
}
