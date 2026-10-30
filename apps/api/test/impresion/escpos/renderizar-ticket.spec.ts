import {
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { renderizarTicket } from '../../../src/modulos/impresion/escpos';
import { ANCHOS, JUEGOS, columnasDe, imprimir, textos } from './ayudas-escpos';

// Historia 004, T41: el renderizador de tickets (criterios 123 y 126), bloque por bloque, en los dos anchos y en
// cada juego de caracteres, interpretado con el intérprete ESC/POS de `test/soporte/puente`. No es una prueba
// protegida.

const documento = (...bloques: BloqueTicket[]): DocumentoTicket => ({
  version: VERSION_DOCUMENTO_TICKET,
  tipo: 'PRUEBA',
  bloques,
});

describe('renderizarTicket · bytes', () => {
  const doc = documento({ tipo: 'linea', texto: 'Ají' });

  it('empieza con ESC @ y la página de códigos (ESC t), y termina con ESC d 4 y GS V 66 0', () => {
    const esperada = { PC437: 0, PC850: 2, PC858: 19, WPC1252: 16, SIN_TILDES: 0 } as const;
    for (const juego of JUEGOS) {
      const bytes = renderizarTicket(doc, { anchoMm: 80, juegoCaracteres: juego });
      expect(Array.from(bytes.slice(0, 5)), juego).toEqual([
        0x1b,
        0x40,
        0x1b,
        0x74,
        esperada[juego],
      ]);
      expect(Array.from(bytes.slice(-7)), juego).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]);
    }
  });

  it('es determinista: el mismo documento y la misma impresora dan los mismos bytes', () => {
    const a = renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'PC850' });
    const b = renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'PC850' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('cambiar el ancho o el juego de caracteres cambia los bytes sin tocar el documento', () => {
    const copia = structuredClone(doc);
    const a = renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'PC850' });
    const b = renderizarTicket(doc, { anchoMm: 80, juegoCaracteres: 'WPC1252' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(doc).toEqual(copia);
  });

  it('rechaza un documento de otra versión o que no cumple el contrato', () => {
    const impresora = { anchoMm: 80, juegoCaracteres: 'PC850' } as const;
    expect(() =>
      renderizarTicket({ ...doc, version: 2 } as unknown as DocumentoTicket, impresora),
    ).toThrow(/versi/i);
    expect(() =>
      renderizarTicket({ ...doc, bloques: [] } as unknown as DocumentoTicket, impresora),
    ).toThrow(/inválido/);
    expect(() =>
      renderizarTicket(documento({ tipo: 'linea', texto: 'a\nb' } as BloqueTicket), impresora),
    ).toThrow(/inválido/);
  });

  it('rechaza un ancho o un juego de caracteres desconocidos', () => {
    expect(() => renderizarTicket(doc, { anchoMm: 70 as 58, juegoCaracteres: 'PC850' })).toThrow(
      /Ancho/,
    );
    expect(() =>
      renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'KOI8' as 'PC850' }),
    ).toThrow(/Juego/);
  });
});

describe.each(ANCHOS)('renderizarTicket · %i mm', (ancho) => {
  const columnas = columnasDe(ancho);

  describe.each(JUEGOS)('juego %s', (juego) => {
    it('titulo: negrita, doble alto y centrado por defecto', () => {
      const t = imprimir(
        documento(
          { tipo: 'titulo', texto: 'Ají de gallina' },
          { tipo: 'titulo', texto: 'Izquierda', alinear: 'izquierda' },
        ),
        ancho,
        juego,
      );
      const [a, b] = t.lineas;
      expect(a).toMatchObject({ negrita: true, dobleAlto: true, alineacion: 'centro' });
      expect(b).toMatchObject({ negrita: true, dobleAlto: true, alineacion: 'izquierda' });
      expect(a!.texto).toBe(juego === 'SIN_TILDES' ? 'Aji de gallina' : 'Ají de gallina');
    });

    it('linea: alineación, negrita, doble alto y sangría', () => {
      const t = imprimir(
        documento(
          { tipo: 'linea', texto: 'Normal' },
          { tipo: 'linea', texto: 'Centro', alinear: 'centro' },
          { tipo: 'linea', texto: 'Derecha', alinear: 'derecha', negrita: true },
          { tipo: 'linea', texto: 'Alta', dobleAlto: true },
          { tipo: 'linea', texto: 'Sangrada', sangria: 4 },
        ),
        ancho,
        juego,
      );
      expect(t.lineas.map((l) => [l.texto, l.alineacion, l.negrita, l.dobleAlto])).toEqual([
        ['Normal', 'izquierda', false, false],
        ['Centro', 'centro', false, false],
        ['Derecha', 'derecha', true, false],
        ['Alta', 'izquierda', false, true],
        ['    Sangrada', 'izquierda', false, false],
      ]);
    });

    it('linea: ajusta al ancho sin partir palabras', () => {
      const texto = 'Hamburguesa clásica con queso extra, tocino crocante y huevo frito';
      const t = imprimir(documento({ tipo: 'linea', texto }), ancho, juego);
      const lineas = textos(t);
      expect(lineas.length).toBeGreaterThan(1);
      for (const l of lineas) {
        expect(l.length).toBeLessThanOrEqual(columnas);
        expect(l).toBe(l.trim());
      }
      // Las palabras se conservan enteras y en orden.
      const original = lineas.join(' ').split(' ');
      expect(original.length).toBe(texto.split(' ').length);
      // Cada línea está llena hasta donde la siguiente palabra ya no cabe.
      lineas.slice(0, -1).forEach((l, i) => {
        const siguiente = lineas[i + 1]!.split(' ')[0]!;
        expect(l.length + 1 + siguiente.length, `línea ${i + 1}`).toBeGreaterThan(columnas);
      });
    });

    it('linea: la sangría reduce el ancho disponible y sangra cada línea', () => {
      const texto = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce';
      const t = imprimir(documento({ tipo: 'linea', texto, sangria: 8 }), ancho, juego);
      for (const l of textos(t)) {
        expect(l.startsWith('        ')).toBe(true);
        expect(l.length).toBeLessThanOrEqual(columnas);
      }
    });

    it('linea: una palabra más larga que el papel se corta en trozos', () => {
      const palabra = 'A'.repeat(columnas * 2 + 5);
      const t = imprimir(documento({ tipo: 'linea', texto: `x ${palabra} y` }), ancho, juego);
      expect(textos(t).join('').replaceAll(' ', '')).toBe(`x${palabra}y`);
      expect(textos(t).every((l) => l.length <= columnas)).toBe(true);
    });

    it('linea: un texto vacío es una línea en blanco', () => {
      const t = imprimir(
        documento(
          { tipo: 'linea', texto: 'a' },
          { tipo: 'linea', texto: '' },
          { tipo: 'linea', texto: 'b' },
        ),
        ancho,
        juego,
      );
      expect(textos(t)).toEqual(['a', '', 'b']);
    });

    it('columnas: la derecha queda pegada al borde y la izquierda a su lado', () => {
      const t = imprimir(
        documento(
          { tipo: 'columnas', izquierda: '2 × Ají de gallina', derecha: '1,234.50' },
          { tipo: 'columnas', izquierda: '1 × Chicha morada', derecha: '8.00' },
          { tipo: 'columnas', izquierda: '', derecha: '169.20' },
          { tipo: 'columnas', izquierda: 'Solo izquierda', derecha: '' },
        ),
        ancho,
        juego,
      );
      const [a, b, c, d] = textos(t);
      const x = juego === 'SIN_TILDES' || juego === 'PC437' ? 'x' : '×';
      const aji = juego === 'SIN_TILDES' ? 'Aji' : 'Ají';
      for (const [linea, derecha] of [
        [a, '1,234.50'],
        [b, '8.00'],
        [c, '169.20'],
      ] as const) {
        expect(linea!.length).toBe(columnas);
        expect(linea!.endsWith(derecha)).toBe(true);
      }
      expect(a!.startsWith(`2 ${x} ${aji} de gallina`)).toBe(true);
      expect(b!.startsWith(`1 ${x} Chicha morada`)).toBe(true);
      expect(c!.trim()).toBe('169.20');
      expect(d).toBe('Solo izquierda');
      // Los montos terminan todos en la misma columna.
      expect(new Set([a!, b!, c!].map((l) => l.trimEnd().length)).size).toBe(1);
    });

    it('columnas: si no caben juntas, la izquierda continúa en las líneas siguientes', () => {
      const izquierda = '1 × Hamburguesa clásica con queso, tocino, huevo frito y papas al hilo';
      const t = imprimir(
        documento({ tipo: 'columnas', izquierda, derecha: '28.00' }),
        ancho,
        juego,
      );
      const lineas = textos(t);
      expect(lineas.length).toBeGreaterThan(1);
      expect(lineas[0]!.length).toBe(columnas);
      expect(lineas[0]!.endsWith('28.00')).toBe(true);
      for (const l of lineas.slice(1)) expect(l).not.toMatch(/28\.00/);
      const junto = lineas.map((l) => l.replace(/\s*28\.00$/, '')).join(' ');
      expect(junto.split(' ').filter(Boolean).length).toBe(izquierda.split(' ').length);
    });

    it('columnas: una derecha que no deja lugar va sola, alineada, después de la izquierda', () => {
      const derecha = 'Z'.repeat(columnas - 2);
      const t = imprimir(
        documento({ tipo: 'columnas', izquierda: 'Total', derecha }),
        ancho,
        juego,
      );
      expect(textos(t)).toEqual(['Total', `  ${derecha}`]);
    });

    it('columnas: negrita y doble alto valen para toda la línea', () => {
      const t = imprimir(
        documento({
          tipo: 'columnas',
          izquierda: 'TOTAL',
          derecha: '169.20',
          negrita: true,
          dobleAlto: true,
        }),
        ancho,
        juego,
      );
      expect(t.lineas[0]).toMatchObject({ negrita: true, dobleAlto: true });
    });

    it('marca: aviso en negrita entre guiones, de lado a lado', () => {
      const t = imprimir(
        documento(
          { tipo: 'marca', texto: 'PARA LLEVAR' },
          { tipo: 'marca', texto: 'REIMPRESIÓN' },
          { tipo: 'marca', texto: 'UNA MARCA MUY LARGA QUE NO CABE EN UNA SOLA LÍNEA DEL PAPEL' },
        ),
        ancho,
        juego,
      );
      const [a, b, ...resto] = t.lineas;
      expect(a!.texto).toMatch(/^-+ PARA LLEVAR -+$/);
      expect(a!.texto.length).toBe(columnas);
      expect(a!.negrita).toBe(true);
      expect(b!.texto).toMatch(
        juego === 'SIN_TILDES' || juego === 'PC437' ? /^-+ REIMPRESION -+$/ : /^-+ REIMPRESIÓN -+$/,
      );
      expect(resto.length).toBeGreaterThan(1);
      for (const l of resto) {
        expect(l.texto.length).toBe(columnas);
        expect(l.texto).toMatch(/^-+ .+ -+$/);
      }
    });

    it('regla: de todo el ancho, con "-" por defecto o "="', () => {
      const t = imprimir(
        documento({ tipo: 'regla' }, { tipo: 'regla', caracter: '=' }),
        ancho,
        juego,
      );
      expect(textos(t)).toEqual(['-'.repeat(columnas), '='.repeat(columnas)]);
    });

    it('espacio: líneas en blanco', () => {
      const t = imprimir(
        documento(
          { tipo: 'linea', texto: 'a' },
          { tipo: 'espacio' },
          { tipo: 'espacio', lineas: 3 },
          { tipo: 'linea', texto: 'b' },
        ),
        ancho,
        juego,
      );
      expect(textos(t)).toEqual(['a', '', '', '', '', 'b']);
    });

    it('el estilo de un bloque no se pega al siguiente', () => {
      const t = imprimir(
        documento(
          { tipo: 'titulo', texto: 'T' },
          { tipo: 'linea', texto: 'normal' },
          { tipo: 'linea', texto: 'derecha', alinear: 'derecha', negrita: true },
          { tipo: 'linea', texto: 'normal otra vez' },
        ),
        ancho,
        juego,
      );
      expect(t.lineas[1]).toMatchObject({
        negrita: false,
        dobleAlto: false,
        alineacion: 'izquierda',
      });
      expect(t.lineas[3]).toMatchObject({
        negrita: false,
        dobleAlto: false,
        alineacion: 'izquierda',
      });
    });
  });
});

describe('renderizarTicket · texto de ejemplo en cada juego de caracteres', () => {
  const MUESTRA = ['Ají de gallina', 'Ñoquis', '¿Sin ají?'];
  const ESPERADO: Record<(typeof JUEGOS)[number], string[]> = {
    PC437: ['Ají de gallina', 'Ñoquis', '¿Sin ají?'],
    PC850: ['Ají de gallina', 'Ñoquis', '¿Sin ají?'],
    PC858: ['Ají de gallina', 'Ñoquis', '¿Sin ají?'],
    WPC1252: ['Ají de gallina', 'Ñoquis', '¿Sin ají?'],
    SIN_TILDES: ['Aji de gallina', 'Noquis', 'Sin aji?'],
  };

  it.each(ANCHOS.flatMap((a) => JUEGOS.map((j) => [a, j] as const)))(
    '%i mm, %s: el emulador decodifica exactamente el texto esperado, línea por línea',
    (ancho, juego) => {
      const t = imprimir(
        documento(...MUESTRA.map((texto): BloqueTicket => ({ tipo: 'linea', texto }))),
        ancho,
        juego,
      );
      expect(textos(t)).toEqual(ESPERADO[juego]);
    },
  );
});
