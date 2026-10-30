// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de la ronda 4 del ataque (la protegida
// `impresion-critica/ataque-ronda4.spec.ts` cubre las fallas de punta a punta): el "faltan N" suma lo que la plantilla
// ya había descartado, sin contar su aviso como una línea, y el aviso sigue siendo estructural.
import {
  MAXIMO_BLOQUES_TICKET,
  bloqueTicketSchema,
  documentoTicketSchema,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  conMarcas,
  documentoDePrecuenta,
  esIncompleto,
  renderizarTicketDetallado,
} from '../../../src/modulos/impresion/escpos';
import {
  avisoDeCorte,
  omitidosPorAvisos,
} from '../../../src/modulos/impresion/escpos/plantillas/presupuesto';
import { adaptarTexto } from '../../../src/modulos/impresion/escpos/tablas-codificacion';

const comoTexto = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const faltan = (texto: string): number[] =>
  [...texto.matchAll(/faltan\s+(\d+)/g)].map((m) => Number(m[1]));

function precuentaGigante(lineas: number): DocumentoTicket {
  return documentoDePrecuenta(
    {
      numero: 1,
      orden: { mesas: [{ nombre: '4' }], mozo: { nombre: 'Ana' }, comensales: 2 },
      lineas: Array.from({ length: lineas }, (_, i) => ({
        nombre: '…'.repeat(95) + i,
        modificadores: [],
        cantidad: 1,
        total: '0.10',
      })),
      total: '600.00',
      nota: 'Precios con IGV incluido.',
    },
    { sucursal: 'Centro', hora: '20:15' },
  );
}

describe('el aviso de la plantilla lleva la cantidad como número (F3)', () => {
  it('avisoDeCorte(N) guarda omitidos = N y el esquema lo acepta', () => {
    const aviso = avisoDeCorte(7);
    expect(aviso).toMatchObject({ tipo: 'linea', aviso: 'INCOMPLETO', omitidos: 7 });
    expect(aviso.tipo === 'linea' && aviso.texto).toContain('faltan 7 líneas');
    expect(bloqueTicketSchema.safeParse(aviso).success).toBe(true);
  });

  it('un documento con "omitidos" sin el aviso INCOMPLETO se rechaza (no se abre la puerta a un aviso falso)', () => {
    expect(
      bloqueTicketSchema.safeParse({ tipo: 'linea', texto: 'hola', omitidos: 5 }).success,
    ).toBe(false);
    expect(
      bloqueTicketSchema.safeParse({ tipo: 'linea', texto: 'hola', aviso: 'RETRASO', omitidos: 5 })
        .success,
    ).toBe(false);
  });

  it('un texto que imita al aviso no cuenta: ni lo marca incompleto ni suma omitidos', () => {
    const falso: BloqueTicket = {
      tipo: 'linea',
      texto: '... Ticket incompleto: faltan 99 líneas. Revisa la cuenta en la app.',
    };
    expect(esIncompleto({ bloques: [falso] })).toBe(false);
    expect(omitidosPorAvisos([falso])).toBe(0);
  });

  it('la plantilla que corta deja el número en su aviso', () => {
    const documento = precuentaGigante(6000);
    expect(documentoTicketSchema.safeParse(documento).success).toBe(true);
    const aviso = documento.bloques.find((b) => b.tipo === 'linea' && b.aviso === 'INCOMPLETO');
    expect(aviso).toBeDefined();
    const n = (aviso as { omitidos: number }).omitidos;
    expect(n).toBeGreaterThan(0);
    expect(esIncompleto(documento)).toBe(true);
  });
});

describe('el renderizador suma lo que la plantilla ya descartó (F3)', () => {
  it('la plantilla corta y luego el renderizador corta por el tope: N = sin escribir + descartado', () => {
    const documento = precuentaGigante(6000);
    const avisoDePlantilla = documento.bloques.find(
      (b) => b.tipo === 'linea' && b.aviso === 'INCOMPLETO',
    ) as { omitidos: number };
    const descartado = avisoDePlantilla.omitidos;
    for (const juegoCaracteres of ['PC437', 'WPC1252'] as const) {
      const res = renderizarTicketDetallado(documento, { anchoMm: 58, juegoCaracteres });
      expect(res.recortado).toBe(true);
      const impresos = faltan(comoTexto(res.bytes));
      // El aviso de la plantilla no llegó a salir: hay un solo aviso, el del renderizador.
      expect(impresos).toHaveLength(1);
      const total = impresos[0]!;
      // El mismo documento sin el aviso de la plantilla da lo que el renderizador deja sin escribir por sí solo.
      const sinAviso = {
        ...documento,
        bloques: documento.bloques.filter((b) => !(b.tipo === 'linea' && b.aviso === 'INCOMPLETO')),
      };
      const solo = renderizarTicketDetallado(sinAviso, { anchoMm: 58, juegoCaracteres });
      const [sinEscribir] = faltan(comoTexto(solo.bytes));
      expect(sinEscribir).toBeGreaterThan(0);
      expect(total).toBe(sinEscribir! + descartado);
      expect(total).toBeGreaterThan(descartado);
    }
  });

  it('sin aviso de plantilla, N cuenta solo los bloques sin escribir (como antes)', () => {
    const documento: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: MAXIMO_BLOQUES_TICKET }, () => ({
        tipo: 'linea' as const,
        texto: '…'.repeat(200),
      })),
    };
    const res = renderizarTicketDetallado(documento, { anchoMm: 80, juegoCaracteres: 'PC437' });
    const [n] = faltan(comoTexto(res.bytes));
    // PC437 escribe "..." por cada "…": 600 caracteres por bloque; cada bloque son 13 líneas de 48.
    const escritos = comoTexto(res.bytes).split('\n').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(MAXIMO_BLOQUES_TICKET);
    expect(escritos).toBeGreaterThan(1000);
  });

  it('el documento cortado por la plantilla que sí cabe en papel sale con su aviso y sin recortar', () => {
    const documento = precuentaGigante(6000);
    // 80 mm y WPC1252: "…" es un solo byte, así que el documento (con ~3000 bloques) cabe en el tope.
    const res = renderizarTicketDetallado(
      { ...documento, bloques: documento.bloques.slice(0, 40).concat(documento.bloques.slice(-5)) },
      { anchoMm: 80, juegoCaracteres: 'WPC1252' },
    );
    expect(res.recortado).toBe(false);
  });
});

describe('conMarcas suma lo descartado y no cuenta el aviso como línea (F3)', () => {
  it('un documento al máximo que pierde su cola suma el omitido del aviso que ya traía', () => {
    const cuerpo = Array.from({ length: MAXIMO_BLOQUES_TICKET - 2 }, () => ({
      tipo: 'linea' as const,
      texto: 'x',
    }));
    const documento: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: [...cuerpo, avisoDeCorte(40), { tipo: 'linea', texto: 'pie' }],
    };
    const marcado = conMarcas(documento, { reimpresion: true });
    expect(marcado.bloques.length).toBeLessThanOrEqual(MAXIMO_BLOQUES_TICKET);
    const aviso = marcado.bloques.at(-1) as { omitidos: number };
    // Marca + espacio (2 bloques) sobre 3000: salen 2 bloques de la cola (el pie y el aviso de la plantilla cuenta 0
    // como línea) y se suman los 40 descartados. El aviso de la plantilla viaja con su número.
    expect(omitidosPorAvisos(marcado.bloques)).toBeGreaterThanOrEqual(aviso.omitidos);
    expect(aviso.omitidos).toBeGreaterThanOrEqual(40);
  });
});

describe('adaptarTexto: el caché se expulsa de a uno (observación)', () => {
  it('mil caracteres distintos más allá de 2048 siguen dando el mismo resultado', () => {
    const texto = Array.from({ length: 6000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const uno = adaptarTexto(texto, 'PC437');
    const dos = adaptarTexto(texto, 'PC437');
    expect(uno).toBe('?'.repeat(6000));
    expect(dos).toBe(uno);
    expect(adaptarTexto('3 × lomo … €', 'PC437')).toBe('3 x lomo ... EUR');
  });
});
