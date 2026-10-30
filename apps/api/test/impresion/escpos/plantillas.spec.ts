import {
  MAXIMO_BLOQUES_TICKET,
  documentoTicketSchema,
  type AnchoPapelMm,
  type DocumentoTicket,
  type JuegoCaracteres,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  MUESTRA_DE_CARACTERES,
  TEXTO_REIMPRESION,
  conMarcas,
  documentoDeComanda,
  documentoDePrecuenta,
  documentoDePrueba,
  type ComandaParaTicket,
  type ContextoDeComanda,
  type LineaDeComanda,
  type PrecuentaParaTicket,
} from '../../../src/modulos/impresion/escpos';
import { ANCHOS, JUEGOS, columnasDe, imprimir, sinTildes, textos } from './ayudas-escpos';

// Historia 004, T41: las plantillas de comanda (criterio 124), pre-cuenta (125) y prueba (127), y las marcas de
// retraso (118) y de reimpresión (128), impresas en el intérprete ESC/POS en los dos anchos y en cada juego de
// caracteres. No es una prueba protegida.

/** Lo que debe leerse en el papel en cada juego: PC437 no tiene Á, Í, Ó, Ú ni ×; SIN_TILDES solo ASCII. */
function paraJuego(lineas: readonly string[], juego: JuegoCaracteres): string[] {
  if (juego === 'SIN_TILDES') return lineas.map(sinTildes);
  if (juego === 'PC437') {
    return lineas.map((l) =>
      l
        .replace(/Á/g, 'A')
        .replace(/Í/g, 'I')
        .replace(/Ó/g, 'O')
        .replace(/Ú/g, 'U')
        .replace(/×/g, 'x'),
    );
  }
  return [...lineas];
}

const PARES = ANCHOS.flatMap((a) => JUEGOS.map((j) => [a, j] as const));

const linea = (
  parcial: Partial<LineaDeComanda> & Pick<LineaDeComanda, 'cantidad' | 'nombre'>,
): LineaDeComanda => ({
  contexto: null,
  modificadores: [],
  observacion: null,
  paraLlevar: false,
  esperar: false,
  ...parcial,
});

const HAMBURGUESA = linea({
  cantidad: 3,
  nombre: 'Hamburguesa clásica',
  contexto: 'Combo hamburguesa',
  modificadores: ['Sin cebolla', 'Queso extra'],
  observacion: 'sin cebolla',
  paraLlevar: true,
});
const AJI = linea({ cantidad: 1, nombre: 'Ají de gallina', esperar: true });
const CONTEXTO: ContextoDeComanda = {
  mesas: ['4'],
  mozo: 'Ana Pérez',
  hora: '20:15',
  envioNumero: 2,
};

const GUIONES_58 = '-'.repeat(32);
const GUIONES_80 = '-'.repeat(48);
const regla = (ancho: AnchoPapelMm): string => (ancho === 58 ? GUIONES_58 : GUIONES_80);
/** La línea "Mozo: … hora" con la hora pegada al borde. */
const mozoYHora = (ancho: AnchoPapelMm, mozo: string, hora: string): string =>
  `Mozo: ${mozo}`.padEnd(columnasDe(ancho) - hora.length) + hora;
/** Una marca: el texto entre guiones, de lado a lado. */
const marca = (ancho: AnchoPapelMm, texto: string): string => {
  const interior = ` ${texto} `;
  const falta = columnasDe(ancho) - interior.length;
  const izquierda = Math.floor(falta / 2);
  return '-'.repeat(izquierda) + interior + '-'.repeat(falta - izquierda);
};

describe('documentoDeComanda · COMANDA (criterio 124)', () => {
  const comanda: ComandaParaTicket = {
    tipo: 'COMANDA',
    estacion: 'Cocina',
    lineas: [HAMBURGUESA, AJI],
  };

  it.each(PARES)('%i mm, %s: el texto exacto del ticket, línea por línea', (ancho, juego) => {
    const t = imprimir(documentoDeComanda(comanda, CONTEXTO), ancho, juego);
    expect(textos(t)).toEqual(
      paraJuego(
        [
          'COCINA · COMANDA',
          'MESA 4',
          mozoYHora(ancho, 'Ana Pérez', '20:15'),
          'Envío N.º 2',
          regla(ancho),
          '3 × Hamburguesa clásica',
          '  (Combo hamburguesa)',
          '  Sin cebolla',
          '  Queso extra',
          '  Obs: sin cebolla',
          marca(ancho, 'PARA LLEVAR'),
          '',
          '1 × Ají de gallina',
          marca(ancho, 'ESPERAR'),
        ],
        juego,
      ).map((l) => (juego === 'SIN_TILDES' ? l.replace('N.o', 'N.o') : l)),
    );
  });

  it('la estación y el tipo, y la mesa, van en negrita y doble alto; el cuerpo, no', () => {
    const t = imprimir(documentoDeComanda(comanda, CONTEXTO), 80, 'PC850');
    expect(t.lineas.slice(0, 2).map((l) => [l.texto, l.negrita, l.dobleAlto])).toEqual([
      ['COCINA · COMANDA', true, true],
      ['MESA 4', true, true],
    ]);
    const cuerpo = t.lineas.slice(2);
    expect(cuerpo.some((l) => l.dobleAlto)).toBe(false);
    // Los ítems y las observaciones se destacan en negrita; el contexto y los modificadores, no.
    const negritas = new Set(cuerpo.filter((l) => l.negrita).map((l) => l.texto.trim()));
    expect(negritas.has('3 × Hamburguesa clásica')).toBe(true);
    expect(negritas.has('Obs: sin cebolla')).toBe(true);
    expect(negritas.has('(Combo hamburguesa)')).toBe(false);
    expect(negritas.has('Queso extra')).toBe(false);
  });

  it('termina con el avance y el corte parcial', () => {
    const t = imprimir(documentoDeComanda(comanda, CONTEXTO), 58, 'PC850');
    expect(t.marcado.split('\n').slice(-2)).toEqual(['[AVANCE 4]', '[CORTE PARCIAL]']);
  });

  it('el nombre de la estación sale en mayúsculas', () => {
    const t = imprimir(
      documentoDeComanda({ ...comanda, estacion: 'Barra fría' }, CONTEXTO),
      80,
      'PC850',
    );
    expect(textos(t)[0]).toBe('BARRA FRÍA · COMANDA');
  });

  it('varias mesas (cuentas unidas) y una orden sin mesa', () => {
    const unidas = imprimir(
      documentoDeComanda(comanda, { ...CONTEXTO, mesas: ['Mesa 4', '5', 'Terraza 2'] }),
      80,
      'PC850',
    );
    expect(textos(unidas)[1]).toBe('MESAS 4 + 5 + TERRAZA 2');
    const sin = imprimir(documentoDeComanda(comanda, { ...CONTEXTO, mesas: [] }), 80, 'PC850');
    expect(textos(sin)[1]).toBe('SIN MESA');
  });

  it('sin número de envío no sale la línea de envío', () => {
    const t = imprimir(
      documentoDeComanda(comanda, { ...CONTEXTO, envioNumero: null }),
      80,
      'PC850',
    );
    expect(textos(t).some((l) => l.startsWith('Envío'))).toBe(false);
    expect(textos(t)[3]).toMatch(/^-+$/);
  });

  it('un nombre largo se ajusta sin partir palabras y los modificadores quedan con sangría', () => {
    const larga = linea({
      cantidad: 12,
      nombre: 'Ensalada de quinua con palta, tomate cherry y aderezo de maracuyá',
      modificadores: ['Aderezo aparte'],
    });
    const t = imprimir(documentoDeComanda({ ...comanda, lineas: [larga] }, CONTEXTO), 58, 'PC850');
    expect(textos(t).slice(5)).toEqual([
      '12 × Ensalada de quinua con',
      'palta, tomate cherry y aderezo',
      'de maracuyá',
      '  Aderezo aparte',
    ]);
  });
});

describe('documentoDeComanda · ADICION', () => {
  it.each(PARES)('%i mm, %s: lleva ADICIÓN y el número de envío', (ancho, juego) => {
    const t = imprimir(
      documentoDeComanda(
        {
          tipo: 'ADICION',
          estacion: 'Barra',
          lineas: [linea({ cantidad: 2, nombre: 'Chicha morada' })],
        },
        { ...CONTEXTO, envioNumero: 3 },
      ),
      ancho,
      juego,
    );
    expect(textos(t)).toEqual(
      paraJuego(
        [
          'BARRA · ADICIÓN',
          'MESA 4',
          mozoYHora(ancho, 'Ana Pérez', '20:15'),
          'Envío N.º 3',
          regla(ancho),
          '2 × Chicha morada',
        ],
        juego,
      ),
    );
  });

  it('un ítem de segundo tiempo sale con ESPERAR', () => {
    const t = imprimir(
      documentoDeComanda({ tipo: 'ADICION', estacion: 'Cocina', lineas: [AJI] }, CONTEXTO),
      80,
      'PC850',
    );
    expect(textos(t).at(-1)).toBe(marca(80, 'ESPERAR'));
  });
});

describe('documentoDeComanda · MARCHAR', () => {
  it.each(PARES)('%i mm, %s: solo los ítems marchados, sin ESPERAR', (ancho, juego) => {
    const marchado = linea({ cantidad: 1, nombre: 'Ají de gallina', esperar: true });
    const t = imprimir(
      documentoDeComanda(
        { tipo: 'MARCHAR', estacion: 'Cocina', lineas: [marchado] },
        { ...CONTEXTO, envioNumero: null },
      ),
      ancho,
      juego,
    );
    expect(textos(t)).toEqual(
      paraJuego(
        [
          'COCINA · MARCHAR',
          'MESA 4',
          mozoYHora(ancho, 'Ana Pérez', '20:15'),
          regla(ancho),
          '1 × Ají de gallina',
        ],
        juego,
      ),
    );
  });

  it('el documento lleva el tipo del trabajo', () => {
    for (const tipo of ['COMANDA', 'ADICION', 'MARCHAR', 'ANULACION'] as const) {
      expect(documentoDeComanda({ tipo, estacion: 'Cocina', lineas: [AJI] }, CONTEXTO).tipo).toBe(
        tipo,
      );
    }
  });
});

describe('documentoDeComanda · ANULACION', () => {
  const anulacion: ComandaParaTicket = {
    tipo: 'ANULACION',
    estacion: 'Cocina',
    lineas: [linea({ cantidad: 1, nombre: 'Lomo saltado', modificadores: ['Sin ají'] })],
    motivo: 'El cliente se arrepintió del pedido',
  };

  it.each(PARES)('%i mm, %s: cantidad anulada y motivo', (ancho, juego) => {
    const t = imprimir(
      documentoDeComanda(anulacion, { ...CONTEXTO, envioNumero: null }),
      ancho,
      juego,
    );
    const lineasEsperadas =
      ancho === 80
        ? ['Motivo: El cliente se arrepintió del pedido']
        : ['Motivo: El cliente se arrepintió', 'del pedido'];
    expect(textos(t)).toEqual(
      paraJuego(
        [
          'COCINA · ANULACIÓN',
          'MESA 4',
          mozoYHora(ancho, 'Ana Pérez', '20:15'),
          ...lineasEsperadas,
          regla(ancho),
          'ANULADO 1 × Lomo saltado',
          '  Sin ají',
        ],
        juego,
      ),
    );
  });

  it('el motivo sale en negrita y no sale en los otros tipos', () => {
    const t = imprimir(documentoDeComanda(anulacion, CONTEXTO), 80, 'PC850');
    expect(t.lineas.find((l) => l.texto.startsWith('Motivo'))?.negrita).toBe(true);
    const comanda = imprimir(
      documentoDeComanda({ ...anulacion, tipo: 'COMANDA' }, CONTEXTO),
      80,
      'PC850',
    );
    expect(textos(comanda).some((l) => l.includes('Motivo'))).toBe(false);
  });
});

describe('documentoDeComanda · textos del usuario y límites del documento', () => {
  it('saltos de línea, controles y textos larguísimos se limpian y el documento sigue siendo válido', () => {
    const sucio = linea({
      cantidad: 1,
      nombre: 'Ceviche\r\nmixto\u0000',
      observacion: `sin cebolla\n\ty con ${'mucho '.repeat(100)}`,
      modificadores: ['  Picante \t extra  ', '   '],
    });
    const doc = documentoDeComanda(
      { tipo: 'COMANDA', estacion: 'Cocina', lineas: [sucio] },
      CONTEXTO,
    );
    expect(documentoTicketSchema.safeParse(doc).success).toBe(true);
    const t = imprimir(doc, 58, 'PC850');
    expect(textos(t)).toContain('1 × Ceviche mixto');
    expect(textos(t)).toContain('  Picante extra');
    expect(textos(t).some((l) => l.includes('\n'))).toBe(false);
  });

  it('una comanda enorme (50 líneas con 30 modificadores) respeta el máximo de bloques', () => {
    const grande = Array.from({ length: 50 }, (_, i) =>
      linea({
        cantidad: 1,
        nombre: `Plato ${i + 1}`,
        contexto: 'Combo',
        modificadores: Array.from({ length: 30 }, (_, j) => `Extra ${j + 1}`),
        observacion: 'sin sal',
        paraLlevar: true,
        esperar: true,
      }),
    );
    const doc = documentoDeComanda(
      { tipo: 'COMANDA', estacion: 'Cocina', lineas: grande },
      CONTEXTO,
    );
    expect(doc.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET - 3);
    const t = imprimir(doc, 58, 'PC850');
    expect(textos(t).join(' ')).toContain('Plato 50');
    expect(textos(t).join(' ')).toContain('Extra 30');
  });

  it('no cambia los datos que recibe', () => {
    const comanda: ComandaParaTicket = {
      tipo: 'COMANDA',
      estacion: 'Cocina',
      lineas: [HAMBURGUESA],
    };
    const copia = structuredClone(comanda);
    documentoDeComanda(comanda, CONTEXTO);
    expect(comanda).toEqual(copia);
  });
});

describe('documentoDePrecuenta (criterios 51 y 125)', () => {
  const NOTA = 'Precios con IGV incluido. No es un comprobante de pago.';
  const precuenta: PrecuentaParaTicket = {
    numero: 2,
    orden: {
      mesas: [{ nombre: '4' }, { nombre: '5' }],
      mozo: { nombre: 'Ana Pérez' },
      comensales: 3,
    },
    lineas: [
      { nombre: 'Ají de gallina', modificadores: ['Sin ají'], cantidad: 2, total: '1234.5' },
      { nombre: 'Chicha morada', modificadores: [], cantidad: 1, total: '8.00' },
      {
        nombre: 'Hamburguesa clásica con queso, tocino y huevo frito',
        modificadores: [],
        cantidad: 3,
        total: '126.70',
      },
    ],
    total: '1369.20',
    nota: NOTA,
  };
  const contexto = { sucursal: 'Sucursal Miraflores', hora: '21:02' };

  const esperado = (ancho: AnchoPapelMm): string[] => {
    const columnas = columnasDe(ancho);
    const fila = (izquierda: string, monto: string): string =>
      izquierda.padEnd(columnas - monto.length) + monto;
    return [
      'Sucursal Miraflores',
      'PRE-CUENTA N.º 2',
      'Mesas 4 + 5',
      mozoYHora(ancho, 'Ana Pérez', '21:02'),
      'Comensales: 3',
      regla(ancho),
      fila('2 × Ají de gallina', '1,234.50'),
      '  Sin ají',
      fila('1 × Chicha morada', '8.00'),
      // Un nombre que ocupa más de una línea sale de corrido y su monto cierra el renglón (ronda 2, F1).
      ...(ancho === 58
        ? [
            '3 × Hamburguesa clásica con',
            'queso, tocino y huevo frito',
            '126.70'.padStart(columnas),
          ]
        : ['3 × Hamburguesa clásica con queso, tocino y', fila('huevo frito', '126.70')]),
      '='.repeat(columnas),
      'TOTAL S/ 1,369.20'.padStart(columnas),
      '',
      ...(ancho === 58
        ? ['Precios con IGV incluido. No es', 'un comprobante de pago.']
        : ['Precios con IGV incluido. No es un comprobante', 'de pago.']),
    ];
  };

  it.each(PARES)('%i mm, %s: el texto exacto, con los montos a la derecha', (ancho, juego) => {
    const t = imprimir(documentoDePrecuenta(precuenta, contexto), ancho, juego);
    // El total sale alineado a la derecha por la impresora (ESC a 2), sin relleno en el texto.
    const lineasEsperadas = esperado(ancho).map((l) =>
      l.startsWith(' ') && l.includes('TOTAL') ? l.trim() : l,
    );
    expect(textos(t)).toEqual(paraJuego(lineasEsperadas, juego));
  });

  it('los montos terminan en la columna del borde y el total va a la derecha y en negrita', () => {
    for (const ancho of ANCHOS) {
      const t = imprimir(documentoDePrecuenta(precuenta, contexto), ancho, 'PC850');
      const filas = t.lineas.filter(
        (l) => /\d+\.\d{2}$/.test(l.texto) && l.texto !== 'TOTAL S/ 1,369.20',
      );
      expect(filas.length).toBe(3);
      for (const f of filas) expect(f.texto.length).toBe(columnasDe(ancho));
      const total = t.lineas.find((l) => l.texto.startsWith('TOTAL'))!;
      expect(total).toMatchObject({
        texto: 'TOTAL S/ 1,369.20',
        alineacion: 'derecha',
        negrita: true,
      });
    }
  });

  it('el título es la sucursal y el número, en negrita y doble alto', () => {
    const t = imprimir(documentoDePrecuenta(precuenta, contexto), 80, 'PC850');
    expect(t.lineas.slice(0, 2).map((l) => [l.texto, l.negrita, l.dobleAlto])).toEqual([
      ['Sucursal Miraflores', true, true],
      ['PRE-CUENTA N.º 2', true, true],
    ]);
  });

  it('no desglosa el IGV ni la base imponible (decisión 5)', () => {
    for (const ancho of ANCHOS) {
      const texto = textos(
        imprimir(documentoDePrecuenta(precuenta, contexto), ancho, 'PC850'),
      ).join('\n');
      expect(texto).not.toMatch(
        /subtotal|base imponible|op\. gravad|igv\s*\(?\d|18\s*%|S\/\s*\d+\.\d+\s*IGV/i,
      );
      // La única mención del IGV es la nota.
      expect((texto.match(/IGV/g) ?? []).length).toBe(1);
    }
  });

  it('con ICBPER, la nota lleva también "El ICBPER se suma al cobrar."', () => {
    const conIcbper = { ...precuenta, nota: `${NOTA} El ICBPER se suma al cobrar.` };
    const t = imprimir(documentoDePrecuenta(conIcbper, contexto), 80, 'PC850');
    expect(textos(t).slice(-2)).toEqual([
      'Precios con IGV incluido. No es un comprobante',
      'de pago. El ICBPER se suma al cobrar.',
    ]);
  });

  it('el total del ejemplo del criterio 51 sale como "TOTAL S/ 169.20" y "TOTAL S/ 140.80"', () => {
    for (const total of ['169.20', '140.80']) {
      const t = imprimir(
        documentoDePrecuenta(
          {
            ...precuenta,
            lineas: [{ nombre: 'Combo', modificadores: [], cantidad: 1, total }],
            total,
          },
          contexto,
        ),
        58,
        'SIN_TILDES',
      );
      expect(textos(t)).toContain(`TOTAL S/ ${total}`);
    }
  });

  it('imprime los montos guardados tal cual: formato de miles sin redondear ni recalcular', () => {
    const t = imprimir(
      documentoDePrecuenta(
        {
          ...precuenta,
          lineas: [{ nombre: 'Plato', modificadores: [], cantidad: 1, total: '99999999.99' }],
          total: '99999999.99',
        },
        contexto,
      ),
      80,
      'PC850',
    );
    expect(textos(t)).toContain('TOTAL S/ 99,999,999.99');
    expect(textos(t).some((l) => l.endsWith('99,999,999.99') && l.startsWith('1 × Plato'))).toBe(
      true,
    );
  });

  it('una orden sin mesa dice "Sin mesa" y una pre-cuenta de cientos de líneas respeta el máximo de bloques', () => {
    const sinMesa = imprimir(
      documentoDePrecuenta({ ...precuenta, orden: { ...precuenta.orden, mesas: [] } }, contexto),
      80,
      'PC850',
    );
    expect(textos(sinMesa)[2]).toBe('Sin mesa');
    const con = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        nombre: `Plato ${i}`,
        modificadores: ['A', 'B'],
        cantidad: 1,
        total: '10.00',
      }));
    // 200 líneas con modificadores caben completas: cada modificador en su línea.
    const docCompleto = documentoDePrecuenta({ ...precuenta, lineas: con(200) }, contexto);
    expect(docCompleto.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET - 3);
    const completas = textos(imprimir(docCompleto, 58, 'PC850'));
    const j = completas.findIndex((l) => l.startsWith('1 × Plato 199'));
    expect(j).toBeGreaterThan(0);
    expect(completas.slice(j + 1, j + 3)).toEqual(['  A', '  B']);
    // 1200 líneas (con el máximo de 3000 bloques): los modificadores de cada producto se juntan en una línea.
    const docCompacto = documentoDePrecuenta({ ...precuenta, lineas: con(1200) }, contexto);
    expect(docCompacto.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET - 3);
    const lineas = textos(imprimir(docCompacto, 58, 'PC850'));
    const i = lineas.findIndex((l) => l.startsWith('1 × Plato 1199'));
    expect(i).toBeGreaterThan(0);
    expect(lineas[i + 1]).toBe('  A, B');
    // 1600 líneas: ni así caben los modificadores, y se omiten (los precios ya los incluyen).
    const docMinimo = documentoDePrecuenta({ ...precuenta, lineas: con(1600) }, contexto);
    expect(docMinimo.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET - 3);
    const todas = textos(imprimir(docMinimo, 58, 'PC850'));
    expect(todas.some((l) => l.startsWith('1 × Plato 1599'))).toBe(true);
    expect(todas).not.toContain('  A, B');
  });
});

describe('documentoDePrueba (criterio 127)', () => {
  const impresora = (anchoMm: AnchoPapelMm, juegoCaracteres: JuegoCaracteres) => ({
    nombre: 'Cocina',
    anchoMm,
    juegoCaracteres,
  });

  it('la muestra es la del criterio 127', () => {
    expect(MUESTRA_DE_CARACTERES).toBe('áéíóú ÁÉÍÓÚ ñ Ñ ü ¿¡ S/ 1,234.50');
  });

  it.each(PARES)('%i mm, %s: nombre, ancho, juego, regla y muestra', (ancho, juego) => {
    const t = imprimir(documentoDePrueba(impresora(ancho, juego)), ancho, juego);
    const muestra: Record<JuegoCaracteres, string> = {
      PC850: MUESTRA_DE_CARACTERES,
      PC858: MUESTRA_DE_CARACTERES,
      WPC1252: MUESTRA_DE_CARACTERES,
      PC437: 'áéíóú AÉIOU ñ Ñ ü ¿¡ S/ 1,234.50',
      SIN_TILDES: 'aeiou AEIOU n N u S/ 1,234.50',
    };
    expect(textos(t)).toEqual([
      juego === 'SIN_TILDES' || juego === 'PC437' ? 'PAGINA DE PRUEBA' : 'PÁGINA DE PRUEBA',
      'Impresora: Cocina',
      `Ancho: ${ancho} mm (${columnasDe(ancho)} columnas)`,
      `Juego de caracteres: ${juego}`,
      '='.repeat(columnasDe(ancho)),
      muestra[juego],
      '='.repeat(columnasDe(ancho)),
    ]);
  });

  it('la regla mide 32 columnas en 58 mm y 48 en 80 mm, aunque el papel cambie después', () => {
    const doc = documentoDePrueba(impresora(58, 'PC850'));
    expect(textos(imprimir(doc, 58, 'PC850'))[4]).toHaveLength(32);
    expect(textos(imprimir(doc, 80, 'PC850'))[4]).toHaveLength(48);
  });

  it('en cada juego de caracteres el emulador decodifica la muestra con tildes, eñes y signos', () => {
    for (const juego of ['PC437', 'PC850', 'PC858', 'WPC1252'] as const) {
      const t = imprimir(documentoDePrueba(impresora(80, juego)), 80, juego);
      expect(textos(t)[5], juego).toContain('ñ Ñ ü ¿¡ S/ 1,234.50');
    }
  });
});

describe('conMarcas (criterios 118 y 128)', () => {
  const base: DocumentoTicket = documentoDeComanda(
    { tipo: 'COMANDA', estacion: 'Cocina', lineas: [AJI] },
    CONTEXTO,
  );

  it('sin marcas, el mismo contenido', () => {
    expect(conMarcas(base, {})).toEqual(base);
    expect(conMarcas(base, { reimpresion: false, retraso: null })).toEqual(base);
  });

  it('no cambia el documento recibido', () => {
    const copia = structuredClone(base);
    conMarcas(base, { reimpresion: true, retraso: { horaEnvio: '20:15' } });
    expect(base).toEqual(copia);
  });

  it.each(PARES)(
    '%i mm, %s: "Impreso con retraso · enviado a las 20:15" arriba',
    (ancho, juego) => {
      const t = imprimir(conMarcas(base, { retraso: { horaEnvio: '20:15' } }), ancho, juego);
      const aviso = 'Impreso con retraso · enviado a las 20:15';
      const arriba = ancho === 80 ? [aviso] : ['Impreso con retraso · enviado a', 'las 20:15'];
      expect(textos(t).slice(0, arriba.length + 1)).toEqual(paraJuego([...arriba, ''], juego));
      for (const l of t.lineas.slice(0, arriba.length)) {
        expect(l).toMatchObject({ negrita: true, alineacion: 'centro' });
      }
      // Lo demás es el ticket de siempre.
      expect(textos(t).slice(arriba.length + 1)).toEqual(textos(imprimir(base, ancho, juego)));
    },
  );

  it.each(PARES)('%i mm, %s: "REIMPRESIÓN" arriba', (ancho, juego) => {
    const t = imprimir(conMarcas(base, { reimpresion: true }), ancho, juego);
    expect(textos(t).slice(0, 2)).toEqual(paraJuego([marca(ancho, TEXTO_REIMPRESION), ''], juego));
    expect(t.lineas[0]!.negrita).toBe(true);
    expect(textos(t).slice(2)).toEqual(textos(imprimir(base, ancho, juego)));
  });

  it('las dos marcas: primero REIMPRESIÓN y luego el retraso, con una sola línea en blanco', () => {
    const t = imprimir(
      conMarcas(base, { reimpresion: true, retraso: { horaEnvio: '20:15' } }),
      80,
      'PC850',
    );
    expect(textos(t).slice(0, 3)).toEqual([
      marca(80, 'REIMPRESIÓN'),
      'Impreso con retraso · enviado a las 20:15',
      '',
    ]);
    expect(textos(t)[3]).toBe('COCINA · COMANDA');
  });

  it('la reimpresión de una reimpresión no acumula marcas', () => {
    const una = conMarcas(base, { reimpresion: true });
    const dos = conMarcas(una, { reimpresion: true });
    expect(dos).toEqual(una);
    const retrasada = conMarcas(una, { retraso: { horaEnvio: '20:15' } });
    expect(conMarcas(retrasada, { retraso: { horaEnvio: '20:15' }, reimpresion: true })).toEqual(
      retrasada,
    );
  });

  it('sirve con cualquier plantilla y deja un documento válido', () => {
    const prueba = documentoDePrueba({ nombre: 'Caja', anchoMm: 80, juegoCaracteres: 'PC850' });
    const marcado = conMarcas(prueba, { reimpresion: true, retraso: { horaEnvio: '' } });
    expect(documentoTicketSchema.safeParse(marcado).success).toBe(true);
    expect(marcado.tipo).toBe('PRUEBA');
    expect(textos(imprimir(marcado, 58, 'PC850'))[1]).toBe('Impreso con retraso');
  });
});

describe('todas las plantillas en todos los anchos y juegos de caracteres', () => {
  it('no desbordan, no usan comandos desconocidos y cortan al final', () => {
    const documentos: DocumentoTicket[] = [
      ...(['COMANDA', 'ADICION', 'MARCHAR', 'ANULACION'] as const).map((tipo) =>
        documentoDeComanda(
          {
            tipo,
            estacion: 'Cocina caliente',
            lineas: [HAMBURGUESA, AJI],
            motivo: 'Se cayó al piso y no se puede servir',
          },
          {
            ...CONTEXTO,
            mesas: ['Terraza 10', 'Terraza 11', 'Terraza 12'],
            mozo: 'Juan Carlos Rodríguez Quispe',
          },
        ),
      ),
      documentoDePrecuenta(
        {
          numero: 12,
          orden: { mesas: [{ nombre: '4' }], mozo: { nombre: 'Ana' }, comensales: 12 },
          lineas: [
            {
              nombre: 'Parrilla familiar para compartir con papas',
              modificadores: ['Término medio'],
              cantidad: 10,
              total: '12345678.90',
            },
          ],
          total: '12345678.90',
          nota: 'Precios con IGV incluido. No es un comprobante de pago. El ICBPER se suma al cobrar.',
        },
        { sucursal: 'Sucursal Av. Larco con Calle Los Pinos, Miraflores', hora: '23:59' },
      ),
      documentoDePrueba({
        nombre: 'Impresora de la cocina principal',
        anchoMm: 58,
        juegoCaracteres: 'PC850',
      }),
    ];
    for (const doc of documentos) {
      for (const [ancho, juego] of PARES) {
        imprimir(
          conMarcas(doc, { reimpresion: true, retraso: { horaEnvio: '23:59' } }),
          ancho,
          juego,
        );
        imprimir(doc, ancho, juego);
      }
    }
  });
});
