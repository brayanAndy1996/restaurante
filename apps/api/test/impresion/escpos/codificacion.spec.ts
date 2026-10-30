import { describe, expect, it } from 'vitest';
import {
  NUMERO_DE_PAGINA,
  adaptarTexto,
  codificarTexto,
  paginaDeJuego,
} from '../../../src/modulos/impresion/escpos/tablas-codificacion';
import { PAGINAS_DE_CODIGOS, decodificarByte } from '../../soporte/puente/tablas-codificacion';
import { JUEGOS, PAGINA_ESPERADA } from './ayudas-escpos';

// Historia 004, T41: las tablas de codificación del renderizador contra las de decodificación del emulador
// (generadas aparte), y la transliteración. No es una prueba protegida.

const decodificar = (bytes: number[], juego: (typeof JUEGOS)[number]): string => {
  const pagina = PAGINA_ESPERADA[juego] as Parameters<typeof decodificarByte>[1];
  return bytes.map((b) => decodificarByte(b, pagina) ?? '\u0000').join('');
};

describe('páginas de códigos (ESC t)', () => {
  it('los números de página son los de Epson y los mismos que entiende el emulador', () => {
    expect(NUMERO_DE_PAGINA).toEqual({ PC437: 0, PC850: 2, PC858: 19, WPC1252: 16 });
    for (const [numero, nombre] of Object.entries(PAGINAS_DE_CODIGOS)) {
      expect(NUMERO_DE_PAGINA[nombre]).toBe(Number(numero));
    }
  });

  it('SIN_TILDES usa PC437 y cada juego con tildes, su propia página', () => {
    expect(paginaDeJuego('SIN_TILDES')).toBe('PC437');
    for (const juego of ['PC437', 'PC850', 'PC858', 'WPC1252'] as const) {
      expect(paginaDeJuego(juego)).toBe(juego);
    }
  });
});

describe('codificación contra la decodificación independiente del emulador', () => {
  it('todo carácter que acepta cada página sale como el mismo carácter al decodificarlo', () => {
    for (const juego of JUEGOS.filter((j) => j !== 'SIN_TILDES')) {
      const pagina = PAGINA_ESPERADA[juego] as Parameters<typeof decodificarByte>[1];
      let aceptados = 0;
      for (let byte = 0x80; byte <= 0xff; byte += 1) {
        const caracter = decodificarByte(byte, pagina)!;
        if (caracter === '�') continue;
        const adaptado = adaptarTexto(caracter, juego);
        // Lo que está en la página no se sustituye, y se codifica en el mismo byte.
        expect(adaptado, `${juego} 0x${byte.toString(16)}`).toBe(caracter);
        expect(codificarTexto(adaptado, juego), `${juego} 0x${byte.toString(16)}`).toEqual([byte]);
        aceptados += 1;
      }
      expect(aceptados).toBeGreaterThanOrEqual(123);
    }
  });

  it('el ASCII imprimible pasa tal cual en todos los juegos', () => {
    const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join(
      '',
    );
    for (const juego of JUEGOS) {
      expect(adaptarTexto(ascii, juego)).toBe(ascii);
      expect(decodificar(codificarTexto(ascii, juego), juego)).toBe(ascii);
    }
  });

  it('"Ají de gallina", "Ñoquis" y "¿Sin ají?" ida y vuelta en las cuatro páginas', () => {
    for (const juego of ['PC437', 'PC850', 'PC858', 'WPC1252'] as const) {
      for (const texto of ['Ají de gallina', 'Ñoquis', '¿Sin ají?', 'áéíóú ñ Ñ ü ¿¡ S/ 1,234.50']) {
        expect(decodificar(codificarTexto(adaptarTexto(texto, juego), juego), juego), juego).toBe(
          texto,
        );
      }
    }
  });
});

describe('transliteración', () => {
  it('SIN_TILDES: "Ají" → "Aji", "Ñ" → "N", "¿" → ""', () => {
    expect(adaptarTexto('Ají de gallina', 'SIN_TILDES')).toBe('Aji de gallina');
    expect(adaptarTexto('Ñoquis', 'SIN_TILDES')).toBe('Noquis');
    expect(adaptarTexto('ñ Ñ ü Ü', 'SIN_TILDES')).toBe('n N u U');
    expect(adaptarTexto('¿Sin ají?', 'SIN_TILDES')).toBe('Sin aji?');
    expect(adaptarTexto('¡Listo!', 'SIN_TILDES')).toBe('Listo!');
    expect(adaptarTexto('áéíóú ÁÉÍÓÚ', 'SIN_TILDES')).toBe('aeiou AEIOU');
    expect(adaptarTexto('3 × 2 · N.º 4', 'SIN_TILDES')).toBe('3 x 2 - N.o 4');
  });

  it('SIN_TILDES nunca deja un byte alto', () => {
    const texto = 'Ají ñ Ñ ü ÁÉÍÓÚ ¿¡ × · € ß æ ø “x” – — … 日本 😀 \u0007';
    const bytes = codificarTexto(adaptarTexto(texto, 'SIN_TILDES'), 'SIN_TILDES');
    expect(bytes.every((b) => b >= 0x20 && b <= 0x7e)).toBe(true);
  });

  it('PC437 no tiene Á, Í, Ó, Ú ni ×: los sustituye antes de codificar, y conserva lo que sí tiene', () => {
    expect(adaptarTexto('ÁÉÍÓÚ × ñ Ñ ü ¿¡ ·', 'PC437')).toBe('AÉIOU x ñ Ñ ü ¿¡ ·');
    expect(adaptarTexto('Ángel Íñigo Óscar Úrsula', 'PC437')).toBe('Angel Iñigo Oscar Ursula');
  });

  it('PC850, PC858 y WPC1252 conservan las mayúsculas con tilde y la ×', () => {
    for (const juego of ['PC850', 'PC858', 'WPC1252'] as const) {
      expect(adaptarTexto('ÁÉÍÓÚ ×', juego), juego).toBe('ÁÉÍÓÚ ×');
    }
  });

  it('el euro existe en PC858 y WPC1252 y se escribe EUR en las demás páginas', () => {
    expect(adaptarTexto('€', 'PC858')).toBe('€');
    expect(adaptarTexto('€', 'WPC1252')).toBe('€');
    expect(adaptarTexto('€', 'PC850')).toBe('EUR');
    expect(adaptarTexto('€', 'PC437')).toBe('EUR');
  });

  it('lo que no tiene equivalente sale como "?" y los controles como espacio', () => {
    expect(adaptarTexto('日本', 'PC850')).toBe('??');
    expect(adaptarTexto('😀', 'PC850')).toBe('?');
    expect(adaptarTexto('a\tb\u0007c', 'PC850')).toBe('a b c');
    expect(adaptarTexto('\ud800', 'PC850')).toBe('?');
  });

  it('las letras sueltas con su tilde aparte (NFD) se juntan antes de codificar', () => {
    expect(adaptarTexto('Ají', 'PC850')).toBe('Ají');
    expect(adaptarTexto('Ñ', 'PC850')).toBe('Ñ');
  });

  it('un byte sin carácter en la página (huecos de Windows-1252) no se genera nunca', () => {
    // 0x81, 0x8D, 0x8F, 0x90 y 0x9D no existen en Windows-1252.
    const bytes = codificarTexto(
      adaptarTexto('\u0081\u008d\u008f\u0090\u009d', 'WPC1252'),
      'WPC1252',
    );
    expect(bytes.every((b) => b === 0x20)).toBe(true);
  });
});
