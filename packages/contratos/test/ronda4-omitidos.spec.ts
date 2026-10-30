import { describe, expect, it } from 'vitest';
import { MAXIMO_OMITIDOS_TICKET, bloqueTicketSchema, documentoTicketSchema } from '../src';

// Historia 004 · 3b · ronda 4 del ataque, F3: el aviso estructural INCOMPLETO lleva la cantidad de líneas omitidas
// como número, y solo ese aviso puede llevarla.

describe('omitidos del aviso INCOMPLETO', () => {
  const aviso = (extra: object) => ({ tipo: 'linea', texto: 'Ticket incompleto', ...extra });

  it('se acepta con aviso INCOMPLETO, entero y dentro del máximo', () => {
    expect(bloqueTicketSchema.safeParse(aviso({ aviso: 'INCOMPLETO', omitidos: 0 })).success).toBe(
      true,
    );
    expect(
      bloqueTicketSchema.safeParse(aviso({ aviso: 'INCOMPLETO', omitidos: MAXIMO_OMITIDOS_TICKET }))
        .success,
    ).toBe(true);
  });

  it('se rechaza sin aviso, con otro aviso, negativo, decimal o enorme', () => {
    for (const malo of [
      aviso({ omitidos: 3 }),
      aviso({ aviso: 'RETRASO', omitidos: 3 }),
      aviso({ aviso: 'INCOMPLETO', omitidos: -1 }),
      aviso({ aviso: 'INCOMPLETO', omitidos: 1.5 }),
      aviso({ aviso: 'INCOMPLETO', omitidos: MAXIMO_OMITIDOS_TICKET + 1 }),
      aviso({ aviso: 'INCOMPLETO', omitidos: '3' }),
    ]) {
      expect(bloqueTicketSchema.safeParse(malo).success).toBe(false);
    }
  });

  it('un documento sin "omitidos" (guardado antes de la ronda 4) sigue siendo válido', () => {
    const documento = {
      version: 1,
      tipo: 'COMANDA',
      bloques: [aviso({ aviso: 'INCOMPLETO' })],
    };
    expect(documentoTicketSchema.safeParse(documento).success).toBe(true);
  });
});
