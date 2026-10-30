import {
  MAXIMO_BLOQUES_TICKET,
  LARGO_TEXTO_TICKET,
  documentoTicketSchema,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  conMarcas,
  documentoDeComanda,
  documentoDePrecuenta,
  documentoDePrueba,
  errorDeDocumento,
  recortarError,
  type ComandaParaTicket,
  type ContextoDeComanda,
  type LineaDeComanda,
  type PrecuentaParaTicket,
} from '../../../src/modulos/impresion/escpos';
import { PRESUPUESTO_DE_BLOQUES } from '../../../src/modulos/impresion/escpos/plantillas/presupuesto';
import {
  aLargoValido,
  juntarEnLineas,
  lineasDeMesas,
  partirTexto,
} from '../../../src/modulos/impresion/escpos/plantillas/texto';
import { recortarMesa } from '../../../src/modulos/impresion/cola-impresion.service';
import { imprimir } from './ayudas-escpos';

// Historia 004, 3b, ronda 1 del ataque (F1, F2 y F7) y de la revisión: los tickets siempre caben y los textos largos
// se parten sin perder nada. Reglas puras, sin base de datos. No es una prueba protegida.

const compacto = (texto: string): string => texto.replace(/\s+/g, '');
const CONTEXTO: ContextoDeComanda = {
  mesas: ['4'],
  mozo: 'Ana Pérez',
  hora: '20:15',
  envioNumero: 2,
};

const linea = (parcial: Partial<LineaDeComanda> & Pick<LineaDeComanda, 'cantidad' | 'nombre'>) =>
  ({
    contexto: null,
    modificadores: [],
    observacion: null,
    paraLlevar: false,
    esperar: false,
    ...parcial,
  }) satisfies LineaDeComanda;

/** Cada texto del documento cabe en un bloque y el documento cumple el contrato. */
function exigirValido(doc: DocumentoTicket): void {
  const r = documentoTicketSchema.safeParse(doc);
  expect(r.success, r.success ? '' : r.error.message).toBe(true);
}

/** Admite las dos marcas del ticket sin pasar del máximo y se imprime. */
function exigirConMarcas(doc: DocumentoTicket): void {
  expect(doc.bloques.length).toBeLessThanOrEqual(PRESUPUESTO_DE_BLOQUES);
  const marcado = conMarcas(doc, { reimpresion: true, retraso: { horaEnvio: '20:15' } });
  expect(marcado.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET);
  exigirValido(marcado);
  imprimir(marcado, 58, 'PC850');
}

describe('partirTexto y juntarEnLineas', () => {
  it('un texto corto queda igual y uno largo se parte en palabras sin perder nada', () => {
    expect(partirTexto('hola')).toEqual(['hola']);
    expect(partirTexto('')).toEqual(['']);
    const texto = Array.from({ length: 120 }, (_, i) => `palabra${i}`).join(' ');
    const trozos = partirTexto(texto);
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(LARGO_TEXTO_TICKET);
    expect(trozos.join(' ')).toBe(texto);
  });

  it('sin espacios corta en el máximo y no parte un emoji', () => {
    const texto = '😀'.repeat(150);
    const trozos = partirTexto(texto);
    for (const t of trozos) {
      expect(t.length).toBeLessThanOrEqual(LARGO_TEXTO_TICKET);
      expect(t).toMatch(/^(?:😀)+$/u);
    }
    expect(trozos.join('')).toBe(texto);
    expect(partirTexto('x'.repeat(450))).toHaveLength(3);
  });

  it('juntarEnLineas reparte entre varias líneas y parte el texto que solo ya pasa del máximo', () => {
    const lineas = juntarEnLineas(['a'.repeat(150), 'b'.repeat(150), 'c'.repeat(250)]);
    for (const l of lineas) expect(l.length).toBeLessThanOrEqual(LARGO_TEXTO_TICKET);
    expect(compacto(lineas.join(''))).toBe(
      `${'a'.repeat(150)}${'b'.repeat(150)}${'c'.repeat(250)}`,
    );
  });

  it('lineasDeMesas: 20 mesas de 20 caracteres salen completas en varias líneas', () => {
    const nombres = Array.from(
      { length: 20 },
      (_, i) => `Salon ${String(i + 1).padStart(2, '0')} ${'x'.repeat(11)}`,
    );
    const lineas = lineasDeMesas(nombres, true);
    expect(lineas.length).toBeGreaterThan(1);
    for (const l of lineas) expect(l.length).toBeLessThanOrEqual(LARGO_TEXTO_TICKET);
    const plano = compacto(lineas.join(' '));
    for (const n of nombres) expect(plano).toContain(compacto(n).toUpperCase());
    expect(lineasDeMesas([], true)).toEqual(['SIN MESA']);
    expect(lineasDeMesas(['Mesa 4'], false)).toEqual(['Mesa 4']);
  });

  it('aLargoValido no toca lo corto y reparte título, línea, columnas y marca sin perder texto', () => {
    const largo = Array.from({ length: 80 }, (_, i) => `texto${i}`).join(' ');
    const bloques = aLargoValido([
      { tipo: 'titulo', texto: largo },
      { tipo: 'linea', texto: largo, negrita: true, sangria: 2 },
      { tipo: 'columnas', izquierda: largo, derecha: '10.00' },
      { tipo: 'marca', texto: largo },
      { tipo: 'regla' },
    ]);
    exigirValido({ version: 1, tipo: 'PRUEBA', bloques });
    expect(compacto(bloques.map((b) => ('texto' in b ? b.texto : '')).join(''))).toContain(
      compacto(largo),
    );
    expect(bloques.filter((b) => b.tipo === 'linea' && b.negrita === true)[1]).toMatchObject({
      sangria: 4,
    });
  });
});

describe('F2 y F7 · textos largos salen completos', () => {
  it('20 mesas de 20 caracteres: el título se parte, el documento es válido y las 20 mesas están', () => {
    const mesas = Array.from(
      { length: 20 },
      (_, i) => `Salon ${String(i + 1).padStart(2, '0')} ${'y'.repeat(11)}`,
    );
    const doc = documentoDeComanda(
      { tipo: 'COMANDA', estacion: 'Cocina', lineas: [linea({ cantidad: 1, nombre: 'Ají' })] },
      { ...CONTEXTO, mesas },
    );
    exigirValido(doc);
    for (const ancho of [58, 80] as const) {
      const plano = compacto(imprimir(doc, ancho, 'PC850').texto).toUpperCase();
      for (const m of mesas) expect(plano).toContain(compacto(m).toUpperCase());
    }
  });

  it('un motivo de 300 caracteres sale completo en la anulación', () => {
    const motivo = Array.from({ length: 50 }, (_, i) => `moti${i}`)
      .join(' ')
      .slice(0, 300);
    expect(motivo).toHaveLength(300);
    const doc = documentoDeComanda(
      {
        tipo: 'ANULACION',
        estacion: 'Cocina',
        lineas: [linea({ cantidad: 1, nombre: 'Ají' })],
        motivo,
      },
      CONTEXTO,
    );
    exigirValido(doc);
    for (const ancho of [58, 80] as const) {
      expect(compacto(imprimir(doc, ancho, 'PC850').texto)).toContain(
        compacto(`Motivo: ${motivo}`),
      );
    }
  });

  it('pre-cuenta con 20 mesas, sucursal y mozo largos: válida y completa', () => {
    const mesas = Array.from({ length: 20 }, (_, i) => ({
      nombre: `Terraza ${String(i + 1).padStart(2, '0')} ${'z'.repeat(10)}`,
    }));
    const precuenta: PrecuentaParaTicket = {
      numero: 3,
      orden: { mesas, mozo: { nombre: 'M'.repeat(100) }, comensales: 8 },
      lineas: [{ nombre: 'Plato', modificadores: [], cantidad: 1, total: '10.00' }],
      total: '10.00',
      nota: 'Precios con IGV incluido. No es un comprobante de pago.',
    };
    const doc = documentoDePrecuenta(precuenta, { sucursal: 'S'.repeat(150), hora: '20:15' });
    exigirValido(doc);
    const plano = compacto(imprimir(doc, 58, 'PC850').texto);
    for (const m of mesas) expect(plano).toContain(compacto(m.nombre));
    expect(plano).toContain('S'.repeat(150));
    expect(plano).toContain('TOTALS/10.00');
  });

  it('la página de prueba sigue válida', () => {
    exigirValido(documentoDePrueba({ nombre: 'Caja', anchoMm: 58, juegoCaracteres: 'PC850' }));
  });
});

describe('F1 · el ticket siempre cabe, con las marcas', () => {
  it('50 líneas de combos de 20 componentes con 30 modificadores cada una: cabe y avisa que faltan líneas', () => {
    const lineas = Array.from({ length: 1000 }, (_, i) =>
      linea({
        cantidad: 2,
        nombre: `Componente ${i + 1} de un combo con nombre bastante largo`,
        contexto: 'Combo familiar gigante de la casa',
        modificadores: Array.from({ length: 30 }, (_, j) => `Modificador número ${j + 1}`),
        observacion: 'observación larga para la cocina'.repeat(3),
        paraLlevar: true,
        esperar: true,
      }),
    );
    const doc = documentoDeComanda({ tipo: 'COMANDA', estacion: 'Cocina', lineas }, CONTEXTO);
    exigirValido(doc);
    exigirConMarcas(doc);
    // Lo que no cupo se dice en el propio ticket.
    const ultimo = doc.bloques[doc.bloques.length - 1]!;
    expect(ultimo).toMatchObject({ tipo: 'linea' });
    expect('texto' in ultimo && ultimo.texto).toMatch(/Ticket incompleto: faltan \d+ líneas/);
  });

  it('un pedido grande pero posible (250 partes con 3 modificadores) cabe completo, sin perder nada', () => {
    const lineas = Array.from({ length: 250 }, (_, i) =>
      linea({
        cantidad: 1,
        nombre: `Parte ${i + 1}`,
        contexto: 'Combo',
        modificadores: ['Sin sal', 'Bien cocido', 'Extra salsa'],
        observacion: 'rápido',
        paraLlevar: i % 2 === 0,
        esperar: i % 3 === 0,
      }),
    );
    const doc = documentoDeComanda({ tipo: 'ADICION', estacion: 'Cocina', lineas }, CONTEXTO);
    exigirConMarcas(doc);
    const plano = compacto(imprimir(doc, 58, 'PC850').texto);
    expect(plano).toContain('1×Parte250');
    expect(plano).not.toContain('Ticketincompleto');
    for (const i of [1, 125, 250]) expect(plano).toContain(`Parte${i}`);
  });

  for (const n of [600, 1500, 5000]) {
    it(`una pre-cuenta de ${n} líneas cabe con las marcas y conserva el total`, () => {
      const precuenta: PrecuentaParaTicket = {
        numero: 1,
        orden: { mesas: [{ nombre: '1' }], mozo: { nombre: 'Ana' }, comensales: 4 },
        lineas: Array.from({ length: n }, (_, i) => ({
          nombre: `Plato ${i + 1}`,
          modificadores: ['A', 'B'],
          cantidad: 1,
          total: '10.00',
        })),
        total: '169.20',
        nota: 'Precios con IGV incluido. No es un comprobante de pago.',
      };
      const doc = documentoDePrecuenta(precuenta, { sucursal: 'Sede', hora: '20:15' });
      exigirConMarcas(doc);
      const plano = compacto(imprimir(doc, 80, 'PC850').texto);
      expect(plano).toContain('TOTALS/169.20');
      expect(plano).toContain('Noesuncomprobantedepago');
    });
  }

  it('conMarcas sobre un documento que ya llena el máximo lo recorta con aviso, sin pasarse', () => {
    const lleno: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: MAXIMO_BLOQUES_TICKET }, (_, i) => ({
        tipo: 'linea' as const,
        texto: `Línea ${i}`,
      })),
    };
    const marcado = conMarcas(lleno, { reimpresion: true, retraso: { horaEnvio: '20:15' } });
    expect(marcado.bloques).toHaveLength(MAXIMO_BLOQUES_TICKET);
    exigirValido(marcado);
    const ultimo = marcado.bloques[marcado.bloques.length - 1]!;
    expect('texto' in ultimo && ultimo.texto).toMatch(/Ticket incompleto: faltan 4 líneas/);
    // Un documento que cabe no se toca.
    expect(
      conMarcas({ ...lleno, bloques: lleno.bloques.slice(0, 100) }, { reimpresion: true }).bloques,
    ).toHaveLength(102);
  });
});

describe('errorDeDocumento, recortarError y recortarMesa', () => {
  it('un documento válido no tiene error y uno inválido da un motivo corto', () => {
    const valido = documentoDePrueba({ nombre: 'Caja', anchoMm: 58, juegoCaracteres: 'PC850' });
    expect(errorDeDocumento(valido)).toBeNull();
    const largo = {
      ...valido,
      bloques: [{ tipo: 'linea', texto: 'x'.repeat(LARGO_TEXTO_TICKET + 1) }],
    };
    const error = errorDeDocumento(largo);
    expect(error).toMatch(/^Documento inválido/);
    expect(Array.from(error!).length).toBeLessThanOrEqual(200);
    expect(errorDeDocumento({ version: 2 })).toMatch(/^Documento inválido/);
    expect(errorDeDocumento(null)).toMatch(/^Documento inválido/);
  });

  it('recortarError respeta los 200 caracteres con "…"', () => {
    expect(recortarError('corto')).toBe('corto');
    const r = recortarError('e'.repeat(500));
    expect(Array.from(r)).toHaveLength(200);
    expect(r.endsWith('…')).toBe(true);
  });

  it('recortarMesa: hasta 300 caracteres tal cual, más se recorta con "…" y nulo queda nulo', () => {
    expect(recortarMesa(null)).toBeNull();
    expect(recortarMesa('')).toBe('');
    const justo = 'm'.repeat(300);
    expect(recortarMesa(justo)).toBe(justo);
    const largo = Array.from({ length: 20 }, (_, i) => `Mesa ${i} ${'q'.repeat(14)}`).join(', ');
    expect(largo.length).toBeGreaterThan(300);
    const r = recortarMesa(largo)!;
    expect(Array.from(r).length).toBeLessThanOrEqual(300);
    expect(r.endsWith('…')).toBe(true);
    expect(largo.startsWith(r.slice(0, -1))).toBe(true);
    expect(Array.from(recortarMesa('😀'.repeat(400))!)).toHaveLength(300);
  });
});

describe('las plantillas no cambian los datos que reciben', () => {
  it('comanda con textos largos', () => {
    const comanda: ComandaParaTicket = {
      tipo: 'ANULACION',
      estacion: 'Cocina',
      lineas: [linea({ cantidad: 1, nombre: 'Ají', modificadores: ['x'.repeat(250)] })],
      motivo: 'm'.repeat(300),
    };
    const copia = structuredClone(comanda);
    exigirValido(documentoDeComanda(comanda, CONTEXTO));
    expect(comanda).toEqual(copia);
  });
});
