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

/**
 * El aviso que cierra un ticket al que no le cupo todo (último recurso, siempre visible). Remite a la app y no a la
 * pantalla: la estación de una impresora no aparece en el KDS. Lleva la marca estructural `INCOMPLETO` (la que
 * mira `esIncompleto`), que ningún texto de una persona puede tener.
 */
export function avisoDeCorte(omitidos: number): BloqueTicket {
  return {
    tipo: 'linea',
    texto: `... Ticket incompleto: faltan ${omitidos} líneas. Revisa la cuenta en la app.`,
    negrita: true,
    aviso: 'INCOMPLETO',
    omitidos,
  };
}

/** `true` si el bloque es un aviso de incompleto del sistema (la marca estructural, nunca un texto). */
export function esAvisoDeCorte(bloque: BloqueTicket): boolean {
  return bloque.tipo === 'linea' && bloque.aviso === 'INCOMPLETO';
}

/**
 * Cuántas líneas dejaron sin escribir los avisos de incompleto que ya trae el documento (el `omitidos` de cada uno,
 * un número, nunca el texto). Un aviso sin el número (un documento guardado antes de la ronda 4) cuenta 0. Lo suma el
 * aviso nuevo de quien corte después (el renderizador o `conMarcas`), para que su "faltan N" sea el total.
 */
export function omitidosPorAvisos(bloques: readonly BloqueTicket[]): number {
  let total = 0;
  for (const bloque of bloques) {
    if (bloque.tipo === 'linea' && bloque.aviso === 'INCOMPLETO') total += bloque.omitidos ?? 0;
  }
  return total;
}

/** `true` si al documento no le cupo todo y termina con el aviso de corte (se guarda como `incompleto`). */
export function esIncompleto(documento: { bloques: readonly BloqueTicket[] }): boolean {
  return documento.bloques.some(esAvisoDeCorte);
}

/**
 * Arma el documento de una plantilla para que nunca pase del presupuesto de bloques. `niveles` da el cuerpo del
 * ticket del más completo al más denso; se usa el primero que cabe junto con el encabezado y el pie (que
 * siempre salen completos: el total de una pre-cuenta no se pierde). Con 3000 bloques caben completos los
 * máximos de entrada (50 líneas de un combo de 20 componentes, 50 de un plato con 30 modificadores y observación,
 * una pre-cuenta de 600 ítems); si un caso extremo todavía no cabe, el cuerpo se corta y el ticket termina con un
 * aviso que dice cuántas líneas faltan (`esIncompleto` lo reconoce): nunca se pierde nada sin decirlo. Todo texto
 * largo se reparte en bloques (`aLargoValido`).
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
