import { LARGO_TEXTO_TICKET } from '@restaurante/contratos';

/**
 * Ayudas de las plantillas: dejan los textos del usuario (nombres, observaciones, motivos) en lo que acepta el
 * documento lógico (`documentoTicketSchema`): una sola línea, sin caracteres de control, sin sustitutos sueltos y
 * de hasta `LARGO_TEXTO_TICKET` caracteres.
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;
const SUSTITUTO_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Un texto apto para un bloque: sin saltos de línea ni controles, espacios juntos, recortado al máximo. */
export function limpiarTexto(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  const limpio = valor
    .replace(SUSTITUTO_SUELTO, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const caracteres = Array.from(limpio);
  return caracteres.length <= LARGO_TEXTO_TICKET
    ? limpio
    : caracteres.slice(0, LARGO_TEXTO_TICKET).join('').trimEnd();
}

const MONTO = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Un monto guardado como texto ("1234.5") con miles y al menos dos decimales ("1,234.50"). Es solo formato: no
 * redondea ni hace cuentas, así que lo que se imprime es exactamente lo guardado. Un texto que no es un monto se
 * deja como está.
 */
export function formatoMonto(monto: string): string {
  const partes = MONTO.exec(monto.trim());
  if (partes === null) return limpiarTexto(monto);
  const [, signo, entero, decimales] = partes;
  const miles = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}${miles}.${(decimales ?? '').padEnd(2, '0')}`;
}

function nombresDeMesas(nombres: readonly string[]): string[] {
  return nombres.map((n) => limpiarTexto(n).replace(/^mesa\s+/i, '')).filter((n) => n.length > 0);
}

/** "MESA 4", "MESAS 4 + 5" o "SIN MESA", a partir de los nombres de las mesas. */
export function etiquetaDeMesas(nombres: readonly string[]): string {
  return descripcionDeMesas(nombres).toUpperCase();
}

/** "Mesa 4", "Mesas 4 + 5" o "Sin mesa". */
export function descripcionDeMesas(nombres: readonly string[]): string {
  const limpios = nombresDeMesas(nombres);
  if (limpios.length === 0) return 'Sin mesa';
  return `${limpios.length === 1 ? 'Mesa' : 'Mesas'} ${limpios.join(' + ')}`;
}

/**
 * Junta textos con `separador` en las líneas necesarias para que ninguna pase de `LARGO_TEXTO_TICKET` (el máximo
 * de un bloque), sin perder ninguno. Un texto solo, que ya está limpio, nunca pasa del máximo.
 */
export function juntarEnLineas(textos: readonly string[], separador = ', '): string[] {
  const lineas: string[] = [];
  let actual = '';
  for (const texto of textos) {
    if (actual.length === 0) actual = texto;
    else if (actual.length + separador.length + texto.length <= LARGO_TEXTO_TICKET) {
      actual += separador + texto;
    } else {
      lineas.push(actual);
      actual = texto;
    }
  }
  if (actual.length > 0) lineas.push(actual);
  return lineas;
}
