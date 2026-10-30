import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LARGO_TEXTO_TICKET,
  MAXIMO_BYTES_TICKET,
  MAXIMO_LARGO_BASE64_TICKET,
  armarQrPuente,
  documentoTicketSchema,
  esBase64,
  leerQrPuente,
  textoSchema,
  trabajoParaImprimirSchema,
} from '../src';

// Historia 004 · 3b · ronda 3 del ataque: ningún esquema del contrato desborda la pila con un texto enorme. La
// expresión de base64 de la ronda 2 lanzaba `RangeError: Maximum call stack size exceeded` desde unos 3,35 MB y el
// simulador dejaba de imprimir en toda la sucursal.

const ID = '11111111-1111-1111-1111-111111111111';
const trabajo = (bytes: string) => ({
  id: ID,
  impresoraId: ID,
  tipo: 'COMANDA',
  creadoEn: '2026-10-30T20:15:00.000Z',
  bytes,
});

describe('MAXIMO_BYTES_TICKET y el largo del base64', () => {
  it('son 256 KB y 4 caracteres por cada 3 bytes', () => {
    expect(MAXIMO_BYTES_TICKET).toBe(262_144);
    expect(MAXIMO_LARGO_BASE64_TICKET).toBe(349_528);
    expect(Buffer.alloc(MAXIMO_BYTES_TICKET).toString('base64').length).toBe(
      MAXIMO_LARGO_BASE64_TICKET,
    );
  });
});

describe('base64 de un trabajo, sin recursión', () => {
  it('5 MB de base64 válido se rechazan por tamaño, sin RangeError', () => {
    const enorme = 'A'.repeat(5 * 1024 * 1024);
    expect(() => trabajoParaImprimirSchema.safeParse(trabajo(enorme))).not.toThrow();
    const resultado = trabajoParaImprimirSchema.safeParse(trabajo(enorme));
    expect(resultado.success).toBe(false);
  });

  it('5 MB que no son base64 (o que lo son hasta el final) tampoco lanzan', () => {
    for (const texto of [
      `${'A'.repeat(5 * 1024 * 1024)}!`,
      '=' + 'A'.repeat(5 * 1024 * 1024),
      'AAAA'.repeat(1_300_000) + 'A===',
      '\u0000'.repeat(5 * 1024 * 1024),
    ]) {
      expect(() => trabajoParaImprimirSchema.safeParse(trabajo(texto))).not.toThrow();
      expect(trabajoParaImprimirSchema.safeParse(trabajo(texto)).success).toBe(false);
    }
  });

  it('un ticket de exactamente MAXIMO_BYTES_TICKET pasa y uno de tres bytes más no (el base64 de 262 145 y 262 146 mide lo mismo que el de 262 144 con relleno)', () => {
    const justo = randomBytes(MAXIMO_BYTES_TICKET).toString('base64');
    expect(trabajoParaImprimirSchema.safeParse(trabajo(justo)).success).toBe(true);
    const demas = randomBytes(MAXIMO_BYTES_TICKET + 3).toString('base64');
    expect(trabajoParaImprimirSchema.safeParse(trabajo(demas)).success).toBe(false);
  });

  it('esBase64 acepta y rechaza igual que el base64 estándar con relleno', () => {
    for (const bien of ['', 'AAAA', 'QUI=', 'QQ==', 'QUJD', 'a+/9', 'AAAAQQ==']) {
      expect(esBase64(bien)).toBe(true);
    }
    for (const mal of [
      'A',
      'AAA',
      'AA=A',
      'A===',
      '====',
      'QQ=',
      'QQ===',
      'QU=I',
      'AAA-',
      'AA A',
      'AAA\n',
    ]) {
      expect(esBase64(mal)).toBe(false);
    }
    // Todo lo que produce Buffer es base64.
    for (let n = 0; n < 50; n += 1) {
      expect(esBase64(randomBytes(n).toString('base64'))).toBe(true);
    }
  });
});

describe('otros esquemas con textos enormes', () => {
  const cincoMb = 'a'.repeat(5 * 1024 * 1024);

  it('textoSchema y el documento del ticket rechazan 5 MB sin lanzar', () => {
    expect(textoSchema(200).safeParse(cincoMb).success).toBe(false);
    const documento = {
      version: 1,
      tipo: 'COMANDA',
      bloques: [{ tipo: 'linea', texto: cincoMb.slice(0, LARGO_TEXTO_TICKET + 1) }],
    };
    expect(documentoTicketSchema.safeParse(documento).success).toBe(false);
    const grande = { ...documento, bloques: [{ tipo: 'linea', texto: cincoMb }] };
    expect(() => documentoTicketSchema.safeParse(grande)).not.toThrow();
    expect(documentoTicketSchema.safeParse(grande).success).toBe(false);
  });

  it('leerQrPuente devuelve null con un texto de 5 MB, también con muchas barras al final', () => {
    expect(leerQrPuente(cincoMb)).toBeNull();
    expect(
      leerQrPuente(`restaurante-puente://vincular?api=http://x/${'/'.repeat(5_000_000)}&t=a`),
    ).toBeNull();
    expect(leerQrPuente(armarQrPuente('https://api.ejemplo.pe/', 'vi.a.b.c'))).toEqual({
      api: 'https://api.ejemplo.pe',
      token: 'vi.a.b.c',
    });
  });
});
