import { describe, expect, it } from 'vitest';
import {
  BytesEscPos,
  InterpreteEscPos,
  interpretarEscPos,
  type NombrePaginaDeCodigos,
} from './index';

// Historia 004, T36: el intérprete de comandos ESC/POS del emulador de impresora. No es una prueba protegida.

const un = (bytes: Uint8Array, columnas?: number) => {
  const { tickets, parcial } = interpretarEscPos(bytes, columnas === undefined ? {} : { columnas });
  expect(parcial).toBeNull();
  expect(tickets).toHaveLength(1);
  return tickets[0]!;
};

describe('InterpreteEscPos · texto y página de códigos', () => {
  it('decodifica el texto de cada página de códigos con tildes, eñes y signos', () => {
    const muestra = ['Ají de gallina', 'Ñoquis', '¿Sin ají?', 'áéíóú É ñ Ñ ü ¿¡ S/ 1,234.50'];
    for (const pagina of ['PC437', 'PC850', 'PC858', 'WPC1252'] as NombrePaginaDeCodigos[]) {
      const ticket = un(BytesEscPos.ticket(muestra, pagina));
      expect(ticket.texto, pagina).toBe(muestra.join('\n'));
      expect(ticket.codificacion).toBe(pagina);
      expect(ticket.codificacionExplicita).toBe(true);
    }
  });

  it('las mayúsculas con tilde y la × existen en PC850, PC858 y WPC1252, pero no en PC437 (salvo É)', () => {
    const muestra = 'ÁÉÍÓÚ ×';
    for (const pagina of ['PC850', 'PC858', 'WPC1252'] as NombrePaginaDeCodigos[]) {
      expect(un(BytesEscPos.ticket([muestra], pagina)).texto, pagina).toBe(muestra);
    }
    // En PC437 no hay Á, Í, Ó, Ú ni ×: el renderizador tiene que sustituirlas antes de codificar.
    expect(un(BytesEscPos.ticket([muestra], 'PC437')).texto).toBe('?É??? ?');
  });

  it('PC858 trae el euro donde PC850 trae la i sin punto, y WPC1252 no es PC850', () => {
    const euro = new BytesEscPos().inicio().paginaDeCodigos('PC858').linea('€').avanzar(0).cortar();
    expect(un(euro.aBytes()).texto).toBe('€');
    // El mismo byte (0xD5) en PC850 es la i sin punto.
    const igual = new BytesEscPos().inicio().paginaDeCodigos('PC850').crudo(0xd5, 0x0a).cortar();
    expect(un(igual.aBytes()).texto).toBe('ı');
    // 0xED es 'í' en PC850 y 'í' (U+00ED) también en WPC1252, pero 0xA1 es 'í' en PC850 y '¡' en WPC1252.
    const pc850 = new BytesEscPos().inicio().paginaDeCodigos('PC850').crudo(0xa1, 0x0a).cortar();
    const win = new BytesEscPos().inicio().paginaDeCodigos('WPC1252').crudo(0xa1, 0x0a).cortar();
    expect(un(pc850.aBytes()).texto).toBe('í');
    expect(un(win.aBytes()).texto).toBe('¡');
  });

  it('sin ESC t usa PC437 y lo dice (codificacionExplicita falso); ESC @ vuelve a PC437', () => {
    const sin = un(new BytesEscPos().inicio().crudo(0x82, 0x0a).cortar().aBytes());
    expect(sin.texto).toBe('é');
    expect(sin.codificacion).toBe('PC437');
    expect(sin.codificacionExplicita).toBe(false);
    const reinicio = new BytesEscPos()
      .inicio()
      .paginaDeCodigos('PC850')
      .inicio()
      .crudo(0xa1, 0x0a)
      .cortar();
    expect(un(reinicio.aBytes()).texto).toBe('í');
  });

  it('un byte alto sin carácter en la página sale como U+FFFD', () => {
    const t = un(
      new BytesEscPos().inicio().paginaDeCodigos('WPC1252').crudo(0x81, 0x0a).cortar().aBytes(),
    );
    expect(t.texto).toBe('�');
  });
});

describe('InterpreteEscPos · marcas', () => {
  it('marca negrita, doble alto, doble ancho, alineación, avance y corte', () => {
    const bytes = new BytesEscPos()
      .inicio()
      .paginaDeCodigos('PC850')
      .alinear('centro')
      .negrita(true)
      .tamano(1, 2)
      .linea('COCINA · COMANDA')
      .tamano(1, 1)
      .negrita(false)
      .alinear('izquierda')
      .linea('3 × Hamburguesa')
      .linea()
      .alinear('derecha')
      .tamano(2, 1)
      .linea('S/ 45.00')
      .avanzar(4)
      .cortar('parcial')
      .aBytes();
    const t = un(bytes);
    expect(t.marcado.split('\n')).toEqual([
      '[INICIO]',
      '[PAGINA PC850]',
      '[B][H2][C]COCINA · COMANDA',
      '3 × Hamburguesa',
      '',
      '[W2][R]S/ 45.00',
      '[AVANCE 4]',
      '[CORTE PARCIAL]',
    ]);
    expect(t.lineas[0]).toMatchObject({
      texto: 'COCINA · COMANDA',
      negrita: true,
      dobleAlto: true,
      dobleAncho: false,
      alineacion: 'centro',
    });
    expect(t.corte).toBe('parcial');
    expect(t.avance).toBe(4);
    expect(t.completo).toBe(true);
  });

  it('el corte total y el pulso de la gaveta quedan anotados', () => {
    const t = un(new BytesEscPos().inicio().linea('x').gaveta().cortar('total').aBytes());
    expect(t.corte).toBe('total');
    expect(t.pulsosGaveta).toBe(1);
    expect(t.marcado.split('\n')).toEqual(['[INICIO]', 'x', '[GAVETA]', '[CORTE TOTAL]']);
  });

  it('una línea con estilos mezclados lleva etiquetas por tramo', () => {
    const bytes = new BytesEscPos()
      .inicio()
      .texto('Total ')
      .negrita(true)
      .tamano(2, 2)
      .texto('S/ 9')
      .negrita(false)
      .tamano(1, 1)
      .texto(' fin')
      .salto()
      .cortar()
      .aBytes();
    const t = un(bytes);
    expect(t.texto).toBe('Total S/ 9 fin');
    expect(t.lineas[0]!.negrita).toBe(false);
    expect(t.marcado.split('\n')[1]).toBe('Total <B><H2><W2>S/ 9</W2></H2></B> fin');
  });

  it('ESC ! y GS ! aceptan el modo de impresión y los tamaños de 1 a 8', () => {
    const t = un(
      new BytesEscPos()
        .inicio()
        .crudo(0x1b, 0x21, 0x08 | 0x10)
        .linea('A')
        .tamano(3, 4)
        .linea('B')
        .cortar()
        .aBytes(),
    );
    expect(t.marcado.split('\n').slice(1, 3)).toEqual(['[B][H2]A', '[B][H4][W3]B']);
    expect(t.comandosDesconocidos).toEqual([]);
  });

  it('el estado persiste entre tickets de la misma conexión hasta un ESC @', () => {
    const bytes = new BytesEscPos()
      .inicio()
      .negrita(true)
      .linea('uno')
      .cortar()
      .linea('dos')
      .cortar()
      .inicio()
      .linea('tres')
      .cortar()
      .aBytes();
    const { tickets } = interpretarEscPos(bytes);
    expect(tickets.map((t) => t.lineas[0]!.negrita)).toEqual([true, true, false]);
    expect(tickets.map((t) => t.numero)).toEqual([1, 2, 3]);
  });
});

describe('InterpreteEscPos · líneas, ancho y comandos', () => {
  it('parte la línea que pasa del ancho y lo cuenta como desborde', () => {
    const t = un(new BytesEscPos().inicio().linea('a'.repeat(40)).cortar().aBytes(), 32);
    expect(t.lineas.map((l) => l.texto)).toEqual(['a'.repeat(32), 'a'.repeat(8)]);
    expect(t.desbordes).toBe(1);
  });

  it('una línea del ancho exacto no desborda; el doble ancho cuenta por dos columnas', () => {
    const exacta = un(new BytesEscPos().inicio().linea('b'.repeat(32)).cortar().aBytes(), 32);
    expect(exacta.desbordes).toBe(0);
    expect(exacta.lineas).toHaveLength(1);
    const doble = un(
      new BytesEscPos().inicio().tamano(2, 1).linea('c'.repeat(17)).cortar().aBytes(),
      32,
    );
    expect(doble.lineas.map((l) => l.texto)).toEqual(['c'.repeat(16), 'c']);
    expect(doble.desbordes).toBe(1);
  });

  it('guarda las líneas vacías y descarta CR, HT y NUL', () => {
    const t = un(
      new BytesEscPos()
        .inicio()
        .linea('a')
        .salto()
        .crudo(0x0d, 0x09, 0x00)
        .linea('b')
        .cortar()
        .aBytes(),
    );
    expect(t.lineas.map((l) => l.texto)).toEqual(['a', '', 'b']);
    expect(t.comandosDesconocidos).toEqual([]);
  });

  it('anota los comandos que no conoce, en hexadecimal, para que una prueba falle', () => {
    const t = un(
      new BytesEscPos()
        .inicio()
        .crudo(0x1b, 0x58) // ESC X
        .crudo(0x1d, 0x42, 0x01) // GS B 1: el comando es desconocido y su parámetro (01) se lee como un byte suelto
        .crudo(0x07)
        .crudo(0x1b, 0x74, 99) // ESC t con una página que no existe
        .crudo(0x1b, 0x61, 7) // ESC a con una alineación que no existe
        .crudo(0x1d, 0x56, 9) // GS V con una función que no existe
        .crudo(0x1d, 0x21, 0x88) // GS ! con un tamaño fuera de rango
        .cortar()
        .aBytes(),
    );
    expect(t.comandosDesconocidos).toEqual([
      '1B 58',
      '1D 42',
      '01',
      '07',
      '1B 74 63',
      '1B 61 07',
      '1D 56 09',
      '1D 21 88',
    ]);
    expect(t.marcado).toContain('[DESCONOCIDO 1B 58]');
  });

  it('un comando partido entre dos trozos se completa; byte por byte da lo mismo', () => {
    const bytes = BytesEscPos.ticket(['Ají', 'dos'], 'PC850');
    const completo = un(bytes);
    const tickets: ReturnType<typeof un>[] = [];
    const interprete = new InterpreteEscPos({ alTicket: (t) => tickets.push(t) });
    for (const byte of bytes) interprete.alimentar(Uint8Array.of(byte));
    expect(interprete.finalizar()).toBeNull();
    expect(tickets).toHaveLength(1);
    const { numero: _a, recibidoEn: _b, ...unoAUno } = tickets[0]!;
    const { numero: _c, recibidoEn: _d, ...entero } = completo;
    expect(unoAUno).toEqual(entero);
  });

  it('varios tickets en el mismo flujo salen separados por su corte', () => {
    const dos = new Uint8Array([
      ...BytesEscPos.ticket(['uno']),
      ...BytesEscPos.ticket(['dos', 'tres']),
    ]);
    const { tickets, parcial } = interpretarEscPos(dos);
    expect(parcial).toBeNull();
    expect(tickets.map((t) => t.texto)).toEqual(['uno', 'dos\ntres']);
    // Los bytes de cada ticket son los suyos.
    expect(Array.from(tickets[1]!.bytes)).toEqual(Array.from(BytesEscPos.ticket(['dos', 'tres'])));
  });

  it('lo que queda sin cortar sale como ticket incompleto al finalizar; un flujo vacío, nada', () => {
    const { tickets, parcial } = interpretarEscPos(
      new BytesEscPos()
        .inicio()
        .paginaDeCodigos('PC850')
        .linea('a medias')
        .texto('sin salto')
        .aBytes(),
    );
    expect(tickets).toEqual([]);
    expect(parcial).toMatchObject({ completo: false, texto: 'a medias\nsin salto', corte: null });
    expect(interpretarEscPos(new Uint8Array(0))).toEqual({ tickets: [], parcial: null });
  });

  it('un comando cortado al final del flujo queda como desconocido en el parcial', () => {
    const { parcial } = interpretarEscPos(
      new BytesEscPos().inicio().linea('x').crudo(0x1b, 0x74).aBytes(),
    );
    expect(parcial?.comandosDesconocidos).toEqual(['1B 74']);
  });
});
