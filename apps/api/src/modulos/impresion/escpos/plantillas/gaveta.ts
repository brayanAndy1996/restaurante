import { VERSION_DOCUMENTO_TICKET, type DocumentoTicket } from '@restaurante/contratos';

/**
 * Plantilla del trabajo `GAVETA` (historia 006, criterio 93): solo el bloque `gaveta`, sin texto, sin avance y sin
 * corte. Lo encola la apertura del turno con fondo y cada ingreso o egreso. El renderizador manda el pulso
 * (`ESC p 0 25 250`) si la impresora tiene gaveta y es la primera entrega a tiempo (criterio 94).
 */
export function documentoDeGaveta(): DocumentoTicket {
  return { version: VERSION_DOCUMENTO_TICKET, tipo: 'GAVETA', bloques: [{ tipo: 'gaveta' }] };
}
