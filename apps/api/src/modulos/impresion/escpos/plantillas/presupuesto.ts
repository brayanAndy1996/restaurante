import { MAXIMO_BLOQUES_TICKET, type BloqueTicket } from '@restaurante/contratos';
import { aLargoValido } from './texto';

/**
 * Bloques que las plantillas dejan libres para las marcas que se agregan al entregar o al reimprimir
 * (`conMarcas`: "REIMPRESIÓN", "Impreso con retraso" y una línea en blanco, tres bloques) más uno de margen. Un
 * documento armado por una plantilla siempre admite las dos marcas sin pasar de `MAXIMO_BLOQUES_TICKET`.
 */
export const RESERVA_PARA_MARCAS = 4;

/** Bloques que puede tener un documento recién armado. */
export const PRESUPUESTO_DE_BLOQUES = MAXIMO_BLOQUES_TICKET - RESERVA_PARA_MARCAS;

/** El aviso que cierra un ticket al que no le cupo todo (último recurso, siempre visible). */
function avisoDeCorte(omitidos: number): BloqueTicket {
  return {
    tipo: 'linea',
    texto: `... Ticket incompleto: faltan ${omitidos} líneas. Mira la cuenta en la pantalla.`,
    negrita: true,
  };
}

/**
 * Arma el documento de una plantilla para que nunca pase del presupuesto de bloques. `niveles` da el cuerpo del
 * ticket del más completo al más denso; se usa el primero que cabe junto con el encabezado y el pie (que
 * siempre salen completos: el total de una pre-cuenta no se pierde). Si ni el más denso cabe (un ticket de
 * miles de líneas), el cuerpo se corta y el ticket termina con un aviso que dice cuántas líneas faltan: nunca se
 * pierde nada sin decirlo. Todo texto largo se reparte en bloques (`aLargoValido`).
 */
export function ajustarAlPresupuesto(
  encabezado: readonly BloqueTicket[],
  niveles: ReadonlyArray<() => BloqueTicket[]>,
  pie: readonly BloqueTicket[] = [],
): BloqueTicket[] {
  const arriba = aLargoValido(encabezado);
  const abajo = aLargoValido(pie);
  let cuerpo: BloqueTicket[] = [];
  for (const nivel of niveles) {
    cuerpo = aLargoValido(nivel());
    if (arriba.length + cuerpo.length + abajo.length <= PRESUPUESTO_DE_BLOQUES) {
      return [...arriba, ...cuerpo, ...abajo];
    }
  }
  const caben = Math.max(0, PRESUPUESTO_DE_BLOQUES - arriba.length - abajo.length - 1);
  const omitidos = cuerpo.length - caben;
  return [...arriba, ...cuerpo.slice(0, caben), avisoDeCorte(omitidos), ...abajo];
}
