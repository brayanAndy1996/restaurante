import type { AnchoPapelMm, DocumentoTicket, JuegoCaracteres } from '@restaurante/contratos';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/** Lo que el renderizador necesita saber de la impresora de destino (la configuración vigente al entregar). */
export interface ImpresoraParaRenderizar {
  anchoMm: AnchoPapelMm;
  juegoCaracteres: JuegoCaracteres;
}

/**
 * Arma los bytes ESC/POS de un ticket (historia 004, criterios 123 a 126): `ESC @`, la página de códigos del
 * juego de caracteres (`ESC t`), el texto codificado en ese juego (con `SIN_TILDES`, transliterado), 32 columnas
 * en 58 mm y 48 en 80 mm, negrita y doble alto en los títulos, avance y corte parcial (`GS V`).
 *
 * Firma de la fase A (T35): lanza "No implementado"; la implementa T41.
 */
export function renderizarTicket(
  documento: DocumentoTicket,
  impresora: ImpresoraParaRenderizar,
): Uint8Array {
  void documento;
  void impresora;
  throw noImplementado();
}
