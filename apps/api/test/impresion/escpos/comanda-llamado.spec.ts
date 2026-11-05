import { documentoTicketSchema } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { documentoDeComanda } from '../../../src/modulos/impresion/escpos';

// Historia 006, T18 (criterio 82): la comanda de una venta de mostrador lleva "LLAMADO 23" en doble alto en lugar de la
// mesa y no trae el mozo. No es una prueba protegida.

const comanda = {
  tipo: 'COMANDA' as const,
  estacion: 'Cocina',
  lineas: [
    {
      cantidad: 2,
      nombre: 'Lomo saltado',
      contexto: null,
      modificadores: [],
      observacion: null,
      paraLlevar: false,
      esperar: false,
    },
  ],
};

describe('plantilla de la comanda · número de llamado', () => {
  it('lleva "LLAMADO 23" como título y no la mesa ni el mozo', () => {
    const doc = documentoDeComanda(comanda, {
      mesas: [],
      mozo: '',
      hora: '20:15',
      envioNumero: 1,
      numeroLlamado: 23,
    });
    expect(documentoTicketSchema.safeParse(doc).success).toBe(true);
    const titulos = doc.bloques.flatMap((b) => (b.tipo === 'titulo' ? [b.texto] : []));
    expect(titulos).toEqual(['COCINA · COMANDA', 'LLAMADO 23']);
    const textos = JSON.stringify(doc.bloques);
    expect(textos).not.toContain('SIN MESA');
    expect(textos).not.toContain('Mozo:');
  });

  it('sin número de llamado sigue mostrando la mesa y el mozo', () => {
    const doc = documentoDeComanda(comanda, {
      mesas: ['Mesa 4'],
      mozo: 'Luis',
      hora: '20:15',
      envioNumero: 1,
    });
    const titulos = doc.bloques.flatMap((b) => (b.tipo === 'titulo' ? [b.texto] : []));
    expect(titulos).toEqual(['COCINA · COMANDA', 'MESA 4']);
    expect(JSON.stringify(doc.bloques)).toContain('Mozo: Luis');
  });
});
