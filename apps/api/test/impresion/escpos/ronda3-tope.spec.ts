// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de la ronda 3 del ataque (la protegida
// `impresion-critica/ataque-ronda3.spec.ts` cubre la falla de punta a punta): la sustitución acotada de caracteres,
// el tope de `MAXIMO_BYTES_TICKET` medido sobre los bytes ya adaptados y el tiempo del armado.
import {
  ANCHOS_PAPEL_MM,
  JUEGOS_CARACTERES,
  LARGO_TEXTO_TICKET,
  MAXIMO_BLOQUES_TICKET,
  MAXIMO_BYTES_TICKET,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  esIncompleto,
  renderizarTicket,
  renderizarTicketDetallado,
} from '../../../src/modulos/impresion/escpos';
import {
  MAXIMO_REEMPLAZO,
  adaptarTexto,
} from '../../../src/modulos/impresion/escpos/tablas-codificacion';

const SALAT = 'ﷺ'; // "ﷺ": 1 carácter para el esquema, 18 en NFKD

const comoTexto = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

const documentoDe = (bloques: DocumentoTicket['bloques']): DocumentoTicket => ({
  version: 1,
  tipo: 'COMANDA',
  bloques,
});

describe('sustitución acotada (criterio 123)', () => {
  it('U+FDFA se escribe como un solo "?", no como 18 caracteres, en todos los juegos', () => {
    for (const juego of JUEGOS_CARACTERES) {
      expect(adaptarTexto(SALAT, juego)).toBe('?');
      expect(adaptarTexto(SALAT.repeat(200), juego)).toBe('?'.repeat(200));
    }
  });

  it('ningún carácter da más de MAXIMO_REEMPLAZO caracteres', () => {
    // Todo el plano básico y el plano suplementario más usado: el texto adaptado nunca crece más de ese múltiplo.
    let peor = 0;
    for (let codigo = 0xa0; codigo < 0x30000; codigo += 1) {
      if (codigo >= 0xd800 && codigo <= 0xdfff) continue;
      const caracter = String.fromCodePoint(codigo);
      for (const juego of ['SIN_TILDES', 'PC850'] as const) {
        peor = Math.max(peor, Array.from(adaptarTexto(caracter, juego)).length);
      }
    }
    expect(peor).toBeLessThanOrEqual(MAXIMO_REEMPLAZO);
  });

  it('lo que ya funcionaba no cambia: ñ, tildes, ×, ¿, ¡, "…" y "€"', () => {
    expect(adaptarTexto('Ñandú áéíóú ü', 'PC850')).toBe('Ñandú áéíóú ü');
    expect(adaptarTexto('Ñandú Ají', 'SIN_TILDES')).toBe('Nandu Aji');
    expect(adaptarTexto('3 × lomo', 'PC437')).toBe('3 x lomo');
    expect(adaptarTexto('3 × lomo', 'PC850')).toBe('3 × lomo');
    expect(adaptarTexto('¿Listo? ¡Sí!', 'SIN_TILDES')).toBe('Listo? Si!');
    expect(adaptarTexto('¿Listo? ¡Sí!', 'PC850')).toBe('¿Listo? ¡Sí!');
    expect(adaptarTexto('Espera…', 'PC437')).toBe('Espera...');
    expect(adaptarTexto('10 €', 'PC437')).toBe('10 EUR');
    expect(adaptarTexto('Á', 'PC437')).toBe('A');
    expect(adaptarTexto('ǆ', 'PC437')).toBe('dz');
    expect(adaptarTexto('㎏', 'PC437')).toBe('kg');
  });
});

describe('tope de bytes por ticket (criterio 126, ronda 3)', () => {
  const lleno = (texto: string, bloques = MAXIMO_BLOQUES_TICKET): DocumentoTicket =>
    documentoDe(
      Array.from({ length: bloques }, () => ({
        tipo: 'linea' as const,
        texto: texto.repeat(LARGO_TEXTO_TICKET).slice(0, LARGO_TEXTO_TICKET),
      })),
    );

  it('3000 bloques de 200 "ﷺ" no pasan el tope en ningún ancho ni juego: salen cortados y con el aviso', () => {
    for (const anchoMm of ANCHOS_PAPEL_MM) {
      for (const juegoCaracteres of JUEGOS_CARACTERES) {
        const res = renderizarTicketDetallado(lleno(SALAT), { anchoMm, juegoCaracteres });
        expect(res.bytes.length).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);
        expect(res.bytes.length).toBeGreaterThan(MAXIMO_BYTES_TICKET - 1024);
        expect(res.recortado).toBe(true);
        expect(comoTexto(res.bytes)).toContain('Ticket incompleto: faltan');
        // Termina con el avance y el corte parcial de siempre.
        expect([...res.bytes.slice(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]);
      }
    }
  });

  it('mezclar caracteres que se expanden (… € ×) tampoco pasa el tope', () => {
    const res = renderizarTicketDetallado(lleno('…€×ﷺ㍿ﬃ'), {
      anchoMm: 58,
      juegoCaracteres: 'SIN_TILDES',
    });
    expect(res.bytes.length).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);
    expect(res.recortado).toBe(true);
  });

  it('el aviso dice cuántos bloques faltan y es el del sistema, no un texto cualquiera', () => {
    const res = renderizarTicketDetallado(lleno(SALAT), { anchoMm: 80, juegoCaracteres: 'PC850' });
    const faltan = /faltan (\d+) l/.exec(comoTexto(res.bytes));
    expect(faltan).not.toBeNull();
    const omitidos = Number(faltan![1]);
    expect(omitidos).toBeGreaterThan(0);
    expect(omitidos).toBeLessThan(MAXIMO_BLOQUES_TICKET);
    // El documento guardado no cambia: sigue sin aviso y el renderizado lo agrega solo a los bytes.
    expect(esIncompleto(lleno(SALAT))).toBe(false);
  });

  it('un ticket que cabe no se corta ni cambia: mismos bytes con y sin el detalle', () => {
    const documento = documentoDe([
      { tipo: 'titulo', texto: 'COCINA · COMANDA' },
      { tipo: 'linea', texto: '3 × Hamburguesa clásica' },
      { tipo: 'regla' },
    ]);
    const impresora = { anchoMm: 80, juegoCaracteres: 'PC850' } as const;
    const res = renderizarTicketDetallado(documento, impresora);
    expect(res.recortado).toBe(false);
    expect(comoTexto(res.bytes)).not.toContain('incompleto');
    expect([...renderizarTicket(documento, impresora)]).toEqual([...res.bytes]);
  });

  it('armar el peor ticket (3000 bloques de "ﷺ") es rápido y no usa memoria de más', () => {
    const impresora = { anchoMm: 58, juegoCaracteres: 'SIN_TILDES' } as const;
    const documento = lleno(SALAT);
    renderizarTicketDetallado(documento, impresora); // calienta
    const antes = process.memoryUsage().heapUsed;
    const inicio = performance.now();
    for (let i = 0; i < 5; i += 1) renderizarTicketDetallado(documento, impresora);
    const ms = (performance.now() - inicio) / 5;
    expect(ms).toBeLessThan(500);
    expect(process.memoryUsage().heapUsed - antes).toBeLessThan(64 * 1024 * 1024);
  });

  it('muchas líneas cortas (3000 bloques de 10 líneas en blanco) caben y no se cortan', () => {
    // Una línea en blanco es 1 byte: 30 000 líneas son unos 30 KB.
    const caben = renderizarTicketDetallado(
      documentoDe(Array.from({ length: 3000 }, () => ({ tipo: 'espacio' as const, lineas: 10 }))),
      { anchoMm: 80, juegoCaracteres: 'PC850' },
    );
    expect(caben.recortado).toBe(false);
    expect(caben.bytes.length).toBeLessThan(MAXIMO_BYTES_TICKET);
  });
});
