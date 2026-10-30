import {
  COLUMNAS_POR_ANCHO,
  JUEGOS_CARACTERES,
  documentoTicketSchema,
  type AnchoPapelMm,
  type DocumentoTicket,
  type JuegoCaracteres,
} from '@restaurante/contratos';
import { expect } from 'vitest';
import { renderizarTicket } from '../../../src/modulos/impresion/escpos';
import { interpretarEscPos, type TicketEmulado } from '../../soporte/puente/interprete-escpos';

// Historia 004, T41 (pruebas del renderizador de tickets, no protegidas).
//
// Ayudas para imprimir un documento lógico en el intérprete ESC/POS de `test/soporte/puente` (independiente de
// las tablas y del escritor del renderizador) y comprobar lo que no debe fallar nunca en ningún ancho ni juego.

export const ANCHOS: readonly AnchoPapelMm[] = [58, 80];
export const JUEGOS: readonly JuegoCaracteres[] = JUEGOS_CARACTERES;

/** La página de códigos del emulador que debe quedar elegida para cada juego (`SIN_TILDES` usa PC437). */
export const PAGINA_ESPERADA: Readonly<Record<JuegoCaracteres, string>> = {
  PC437: 'PC437',
  PC850: 'PC850',
  PC858: 'PC858',
  WPC1252: 'WPC1252',
  SIN_TILDES: 'PC437',
};

export const columnasDe = (ancho: AnchoPapelMm): number => COLUMNAS_POR_ANCHO[ancho];

/**
 * Renderiza el documento y lo interpreta con las columnas del papel. Comprueba lo común: un solo ticket completo
 * y cortado, sin comandos desconocidos, sin líneas que la impresora tenga que partir, con la página de códigos
 * elegida y el documento válido contra el contrato.
 */
export function imprimir(
  documento: DocumentoTicket,
  anchoMm: AnchoPapelMm,
  juegoCaracteres: JuegoCaracteres,
): TicketEmulado {
  expect(
    documentoTicketSchema.safeParse(documento).success,
    'el documento cumple el contrato',
  ).toBe(true);
  const bytes = renderizarTicket(documento, { anchoMm, juegoCaracteres });
  expect(bytes).toBeInstanceOf(Uint8Array);
  const columnas = columnasDe(anchoMm);
  const { tickets, parcial } = interpretarEscPos(bytes, { columnas });
  expect(parcial, 'no queda nada sin cortar').toBeNull();
  expect(tickets).toHaveLength(1);
  const ticket = tickets[0]!;
  expect(ticket.comandosDesconocidos, 'comandos que la impresora no entiende').toEqual([]);
  expect(ticket.desbordes, 'líneas que pasan del ancho').toBe(0);
  expect(ticket.completo).toBe(true);
  expect(ticket.corte).toBe('parcial');
  expect(ticket.avance).toBe(4);
  expect(ticket.pulsosGaveta).toBe(0);
  expect(ticket.codificacionExplicita).toBe(true);
  expect(ticket.codificacion).toBe(PAGINA_ESPERADA[juegoCaracteres]);
  for (const linea of ticket.lineas) {
    expect(linea.texto.length, `"${linea.texto}" cabe en ${columnas} columnas`).toBeLessThanOrEqual(
      columnas,
    );
    expect(linea.fuente).toBe('A');
    expect(linea.codificacion).toBe(PAGINA_ESPERADA[juegoCaracteres]);
  }
  if (juegoCaracteres === 'SIN_TILDES') {
    expect(ticket.texto, 'SIN_TILDES solo escribe ASCII').toMatch(/^[\n -~]*$/);
  }
  expect(ticket.texto).not.toContain('�');
  return ticket;
}

/** Los textos de las líneas del ticket. */
export const textos = (ticket: TicketEmulado): string[] => ticket.lineas.map((l) => l.texto);

/** Escribe el texto sin tildes, como lo deja `SIN_TILDES`, para comparar. */
export const sinTildes = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡]/g, '')
    .replace(/×/g, 'x')
    .replace(/·/g, '-')
    .replace(/º/g, 'o');
