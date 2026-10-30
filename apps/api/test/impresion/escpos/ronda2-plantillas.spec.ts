import {
  LARGO_TEXTO_TICKET,
  MAXIMO_BLOQUES_TICKET,
  MAXIMO_BYTES_RESPUESTA_TRABAJOS,
  documentoTicketSchema,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  conMarcas,
  documentoDeComanda,
  documentoDePrecuenta,
  esIncompleto,
  renderizarTicket,
  type ContextoDeComanda,
  type LineaDeComanda,
  type PrecuentaParaTicket,
} from '../../../src/modulos/impresion/escpos';
import { PRESUPUESTO_DE_BLOQUES } from '../../../src/modulos/impresion/escpos/plantillas/presupuesto';
import { armarColumnas } from '../../../src/modulos/impresion/escpos/ajuste';
import { imprimir } from './ayudas-escpos';

// Historia 004, 3b, ronda 2 del ataque (F1 y F2): los tickets de los máximos de entrada caben completos con el
// tope de 3000 bloques, un caso que todavía no cabe se marca "incompleto" con un aviso que remite a la app, y la
// marca de retraso no se confunde con un texto escrito por una persona. Reglas puras. No es una prueba protegida.

const compacto = (texto: string): string => texto.replace(/\s+/g, '');
const CONTEXTO: ContextoDeComanda = {
  mesas: ['4'],
  mozo: 'Ana Pérez',
  hora: '20:15',
  envioNumero: 2,
};

/** Un nombre único de `largo` caracteres (empieza con la etiqueta, sin espacios, para encontrarlo en el papel). */
const nombre = (etiqueta: string, largo: number): string =>
  etiqueta.padEnd(largo, 'x').slice(0, largo);

const parte = (p: Partial<LineaDeComanda> & Pick<LineaDeComanda, 'nombre'>): LineaDeComanda => ({
  cantidad: 1,
  contexto: null,
  modificadores: [],
  observacion: null,
  paraLlevar: false,
  esperar: false,
  ...p,
});

function exigirCompleto(doc: DocumentoTicket): void {
  expect(documentoTicketSchema.safeParse(doc).success).toBe(true);
  expect(doc.bloques.length).toBeLessThanOrEqual(PRESUPUESTO_DE_BLOQUES);
  expect(esIncompleto(doc)).toBe(false);
  const marcado = conMarcas(doc, { reimpresion: true, retraso: { horaEnvio: '20:15' } });
  expect(marcado.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET);
  expect(documentoTicketSchema.safeParse(marcado).success).toBe(true);
}

describe('F1 · lo que cabe dentro de los límites de entrada sale completo', () => {
  it('el máximo de bloques es de 3000', () => {
    expect(MAXIMO_BLOQUES_TICKET).toBe(3000);
    expect(PRESUPUESTO_DE_BLOQUES).toBeLessThan(MAXIMO_BLOQUES_TICKET);
  });

  it('50 líneas de un combo de 20 componentes con nombres de 60: ninguna parte se pierde', () => {
    const lineas: LineaDeComanda[] = [];
    for (let l = 0; l < 50; l += 1) {
      for (let c = 0; c < 20; c += 1) {
        lineas.push(
          parte({ nombre: nombre(`Comp${l}x${c}`, 60), contexto: nombre(`Combo${l}`, 60) }),
        );
      }
    }
    const doc = documentoDeComanda({ tipo: 'COMANDA', estacion: 'Cocina', lineas }, CONTEXTO);
    exigirCompleto(doc);
    const papel = compacto(imprimir(doc, 58, 'PC850').texto);
    for (const l of [0, 17, 49]) {
      for (const c of [0, 9, 19]) expect(papel).toContain(nombre(`Comp${l}x${c}`, 60));
    }
  });

  it('50 líneas de un plato con 30 modificadores de 60 y observación de 140: todo sale', () => {
    const lineas = Array.from({ length: 50 }, (_, l) =>
      parte({
        nombre: nombre(`Plato${l}`, 60),
        modificadores: Array.from({ length: 30 }, (_, m) => nombre(`Mod${l}x${m}`, 60)),
        observacion: nombre(`Obs${l}`, 140),
        paraLlevar: true,
        esperar: true,
      }),
    );
    const doc = documentoDeComanda({ tipo: 'COMANDA', estacion: 'Cocina', lineas }, CONTEXTO);
    exigirCompleto(doc);
    const papel = compacto(imprimir(doc, 80, 'PC850').texto);
    for (const l of [0, 25, 49]) {
      expect(papel).toContain(nombre(`Plato${l}`, 60));
      expect(papel).toContain(nombre(`Obs${l}`, 140));
      for (const m of [0, 14, 29]) expect(papel).toContain(nombre(`Mod${l}x${m}`, 60));
    }
  });

  it('una pre-cuenta de 600 ítems con nombres de 100 sale completa, con su total', () => {
    const precuenta: PrecuentaParaTicket = {
      numero: 3,
      orden: { mesas: [{ nombre: '1' }], mozo: { nombre: 'Ana' }, comensales: 4 },
      lineas: Array.from({ length: 600 }, (_, i) => ({
        nombre: nombre(`Item${i}`, 100),
        modificadores: [],
        cantidad: 1,
        total: '10.00',
      })),
      total: '6000.00',
      nota: 'Precios con IGV incluido. No es un comprobante de pago.',
    };
    const doc = documentoDePrecuenta(precuenta, { sucursal: 'Sede', hora: '20:15' });
    exigirCompleto(doc);
    const papel = compacto(imprimir(doc, 80, 'PC850').texto);
    for (const i of [0, 299, 599]) expect(papel).toContain(nombre(`Item${i}`, 100));
    expect(papel).toContain('TOTALS/6,000.00');
  });

  it('un caso extremo que todavía no cabe termina con el aviso que remite a la app y queda marcado incompleto', () => {
    // 1000 partes de combo, cada una con 30 modificadores: más de lo que cabe incluso en su forma más densa.
    const lineas = Array.from({ length: 1000 }, (_, i) =>
      parte({
        nombre: nombre(`Parte${i}`, 60),
        contexto: nombre(`Combo${i}`, 60),
        modificadores: Array.from({ length: 30 }, (_, m) => nombre(`Mod${m}`, 60)),
      }),
    );
    const doc = documentoDeComanda({ tipo: 'COMANDA', estacion: 'Cocina', lineas }, CONTEXTO);
    expect(doc.bloques.length).toBeLessThanOrEqual(PRESUPUESTO_DE_BLOQUES);
    expect(esIncompleto(doc)).toBe(true);
    const marcado = conMarcas(doc, { reimpresion: true, retraso: { horaEnvio: '20:15' } });
    expect(esIncompleto(marcado)).toBe(true);
    expect(marcado.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET);
    const papel = imprimir(marcado, 80, 'PC850').texto;
    // El aviso puede partirse en varias líneas del papel: se compara sin espacios.
    expect(compacto(papel)).toMatch(/Ticketincompleto:faltan\d+líneas\.Revisalacuentaenlaapp\./);
    expect(papel).not.toMatch(/pantalla/i);
    // El aviso cierra el cuerpo, antes de nada más que el pie (aquí no hay).
    const ultimo = doc.bloques[doc.bloques.length - 1]!;
    expect(ultimo).toMatchObject({ tipo: 'linea', aviso: 'INCOMPLETO', negrita: true });
  });

  it('un texto parecido al aviso, escrito por una persona, no marca el ticket como incompleto', () => {
    const doc = documentoDeComanda(
      {
        tipo: 'COMANDA',
        estacion: 'Cocina',
        lineas: [
          parte({
            nombre: 'Lomo',
            modificadores: ['... Ticket incompleto: faltan 3 líneas. Revisa la cuenta en la app.'],
            observacion: 'Ticket incompleto: faltan 9 líneas',
          }),
        ],
      },
      CONTEXTO,
    );
    expect(esIncompleto(doc)).toBe(false);
  });

  it('cuesta poco armar y mandar un ticket de 3000 bloques', () => {
    const doc: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: MAXIMO_BLOQUES_TICKET }, (_, i) => ({
        tipo: 'linea' as const,
        texto: `${i} ${'palabra '.repeat(30)}`.slice(0, LARGO_TEXTO_TICKET).trim(),
      })),
    };
    const inicio = performance.now();
    const bytes = renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'PC850' });
    const ms = performance.now() - inicio;
    // Unos 590 KB de ESC/POS (780 KB en base64) en decenas de milisegundos: un solo ticket cabe en una respuesta.
    expect(bytes.length).toBeLessThan(MAXIMO_BYTES_RESPUESTA_TRABAJOS);
    expect(ms).toBeLessThan(1500);
  });
});

describe('F2 · la marca de retraso no se falsifica con un texto', () => {
  const retraso = { retraso: { horaEnvio: '20:15' } };
  const textoDeRetraso = 'Impreso con retraso · enviado a las 08:00';

  for (const donde of ['modificador', 'observación', 'nombre'] as const) {
    it(`un ${donde} que empieza con "Impreso con retraso" no anula la marca real`, () => {
      const linea =
        donde === 'modificador'
          ? parte({ nombre: 'Lomo', modificadores: [textoDeRetraso] })
          : donde === 'observación'
            ? parte({ nombre: 'Lomo', observacion: textoDeRetraso })
            : parte({ nombre: textoDeRetraso });
      const doc = documentoDeComanda(
        { tipo: 'COMANDA', estacion: 'Cocina', lineas: [linea] },
        CONTEXTO,
      );
      const marcado = conMarcas(doc, retraso);
      const lineas = imprimir(marcado, 80, 'PC850').lineas.map((l) => l.texto);
      expect(lineas[0]).toBe('Impreso con retraso · enviado a las 20:15');
      // El texto de la persona sigue en su lugar.
      expect(lineas.filter((t) => t.includes('enviado a las 08:00'))).toHaveLength(1);
    });
  }

  it('aplicar la marca dos veces no la repite, aunque haya un texto parecido', () => {
    const doc = documentoDeComanda(
      {
        tipo: 'COMANDA',
        estacion: 'Cocina',
        lineas: [parte({ nombre: 'Lomo', modificadores: [textoDeRetraso] })],
      },
      CONTEXTO,
    );
    const una = conMarcas(doc, retraso);
    const dos = conMarcas(una, retraso);
    expect(dos).toEqual(una);
    expect(una.bloques.filter((b) => b.tipo === 'linea' && b.aviso === 'RETRASO')).toHaveLength(1);
  });

  it('un modificador llamado REIMPRESIÓN tampoco anula la marca de reimpresión', () => {
    const doc = documentoDeComanda(
      {
        tipo: 'COMANDA',
        estacion: 'Cocina',
        lineas: [
          parte({
            nombre: 'REIMPRESIÓN',
            modificadores: ['REIMPRESIÓN'],
            observacion: 'REIMPRESIÓN',
          }),
        ],
      },
      CONTEXTO,
    );
    const marcado = conMarcas(doc, { reimpresion: true });
    expect(imprimir(marcado, 80, 'PC850').lineas[0]!.texto).toMatch(/-+ REIMPRESIÓN -+/);
    expect(conMarcas(marcado, { reimpresion: true })).toEqual(marcado);
  });
});

describe('F1 · el monto de un nombre largo de la pre-cuenta cierra el renglón', () => {
  const izquierda = '1 × Hamburguesa clásica con queso, tocino, huevo frito y papas al hilo';

  it('con derechaAlFinal la izquierda sale seguida y el monto queda al final, pegado al borde', () => {
    for (const columnas of [32, 48]) {
      const lineas = armarColumnas(izquierda, '28.00', columnas, true);
      expect(lineas.length).toBeGreaterThan(1);
      for (const l of lineas) expect(l.length).toBeLessThanOrEqual(columnas);
      expect(lineas.slice(0, -1).some((l) => l.includes('28.00'))).toBe(false);
      expect(lineas[lineas.length - 1]!.endsWith('28.00')).toBe(true);
      expect(lineas.join(' ').replace(/\s+/g, ' ').replace(' 28.00', '')).toBe(izquierda);
    }
  });

  it('si el monto cabe junto a la última línea, la cierra; si no, va solo y alineado después', () => {
    expect(armarColumnas('1 × Plato con un nombre bastante largo', '1,234.50', 32, true)).toEqual([
      '1 × Plato con un nombre bastante',
      'largo' + ' '.repeat(32 - 5 - 8) + '1,234.50',
    ]);
    expect(armarColumnas('1 × Plato con nombre muy largo', '1,234.50', 32, true)).toEqual([
      '1 × Plato con nombre muy largo',
      ' '.repeat(32 - 8) + '1,234.50',
    ]);
  });

  it('lo que cabe en una línea sale igual que sin la marca', () => {
    expect(armarColumnas('2 × Ají de gallina', '1,234.50', 48, true)).toEqual(
      armarColumnas('2 × Ají de gallina', '1,234.50', 48),
    );
  });
});
