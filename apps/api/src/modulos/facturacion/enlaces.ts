import { Inject, Injectable } from '@nestjs/common';
import { Cifrado } from '../../nucleo/cifrado';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { RELOJ, type Reloj } from '../../nucleo/reloj';

/** Lo que lleva un enlace público (criterio 160): `{ v: 1, empresaId, comprobanteId, expiraEn }` cifrado. */
export interface DatosDeEnlace {
  empresaId: string;
  comprobanteId: string;
}

/**
 * El sello del enlace público de un comprobante (historia 006, entrega 6b, criterio 160): `{ v: 1, empresaId,
 * comprobanteId, expiraEn }` cifrado con AES-256-GCM (propósito `enlace-comprobante`) y codificado en base64url: no se
 * puede adivinar, alterar ni fabricar, y no deja ver los ids. Vence a los `DIAS_ENLACE_COMPROBANTE` días; no se guarda,
 * así que no se revoca.
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')` hasta T43.
 */
@Injectable()
export class EnlacesComprobante {
  constructor(
    @Inject(Cifrado) private readonly cifrado: Cifrado,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** El sello de un comprobante, con vencimiento a `DIAS_ENLACE_COMPROBANTE` días del reloj de la API. */
  sellar(datos: DatosDeEnlace & { expiraEn: Date }): string {
    void this.cifrado;
    void this.reloj;
    void datos;
    throw noImplementado();
  }

  /** Abre el sello con el reloj de la API; `null` si está alterado, vencido, de otra clave o mal formado. */
  abrir(sello: string): DatosDeEnlace | null {
    void sello;
    throw noImplementado();
  }
}
