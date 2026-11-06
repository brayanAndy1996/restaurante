import { inflateSync } from 'node:zlib';

/**
 * El texto de un PDF armado con `pdfkit` y fuentes estándar (WinAnsi): inflama cada flujo, toma las cadenas de los
 * operadores `TJ` y las decodifica como Windows-1252. Cada operador de texto es una línea del resultado (el texto que
 * `pdfkit` parte por kerning se vuelve a juntar). Solo sirve para las pruebas del desarrollador.
 */
export function textoDelPdf(pdf: Buffer): string {
  const bruto = pdf.toString('latin1');
  const decodificador = new TextDecoder('windows-1252');
  const lineas: string[] = [];
  const flujo = /stream\r?\n/g;
  for (let hallado = flujo.exec(bruto); hallado !== null; hallado = flujo.exec(bruto)) {
    const inicio = hallado.index + hallado[0].length;
    const fin = bruto.indexOf('endstream', inicio);
    if (fin < 0) break;
    let contenido: string;
    try {
      contenido = inflateSync(Buffer.from(bruto.slice(inicio, fin), 'latin1')).toString('latin1');
    } catch {
      continue; // una imagen o un flujo que no es de texto
    }
    if (!contenido.includes('BT')) continue;
    for (const operador of contenido.matchAll(/\[((?:<[0-9a-fA-F]*>|\s|-?[\d.]+)*)\]\s*TJ/g)) {
      const cadenas = [...operador[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((c) =>
        decodificador.decode(Buffer.from(c[1]!, 'hex')),
      );
      lineas.push(cadenas.join(''));
    }
  }
  return lineas.join('\n');
}

/** Cuántas páginas tiene el PDF (objetos `/Type /Page`, sin contar el árbol `/Pages`). */
export function paginasDelPdf(pdf: Buffer): number {
  return [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page(?![s\w])/g)].length;
}

/** Cuántas imágenes (el QR) lleva el PDF. */
export function imagenesDelPdf(pdf: Buffer): number {
  return [...pdf.toString('latin1').matchAll(/\/Subtype\s*\/Image/g)].length;
}
