import { describe, expect, it } from 'vitest';
import {
  ESTADOS_LINEA_KDS,
  ESTADOS_ORDEN,
  esEstadoLineaElegible,
  esOrdenAbierta,
  estadoDeMesa,
  transicionKdsValida,
  type EstadoLineaKds,
} from '../../src';

// Estados de Salón y Cocina (historia 004, criterios 8, 58 y 77): pruebas del desarrollador, no críticas.

describe('esOrdenAbierta (criterio 77)', () => {
  it('solo ABIERTA y EN_PRECUENTA están abiertas', () => {
    const abiertas = ESTADOS_ORDEN.filter((estado) => esOrdenAbierta(estado));
    expect(abiertas).toEqual(['ABIERTA', 'EN_PRECUENTA']);
  });
});

describe('estadoDeMesa (criterio 8)', () => {
  it('LIBRE sin orden abierta', () => {
    expect(estadoDeMesa(null)).toBe('LIBRE');
  });

  it('OCUPADA con una orden ABIERTA', () => {
    expect(estadoDeMesa('ABIERTA')).toBe('OCUPADA');
  });

  it('EN_PRECUENTA con una orden EN_PRECUENTA', () => {
    expect(estadoDeMesa('EN_PRECUENTA')).toBe('EN_PRECUENTA');
  });

  it('LIBRE si la última orden se anuló, se unió a otra o se cerró', () => {
    for (const estado of ['ANULADA', 'UNIDA', 'CERRADA'] as const) {
      expect(estadoDeMesa(estado), estado).toBe('LIBRE');
    }
  });
});

describe('transicionKdsValida (criterio 58)', () => {
  const elegibles: EstadoLineaKds[] = ['ENVIADO', 'EN_PREPARACION', 'LISTO'];

  it('se puede ir de cualquiera de los tres estados a cualquiera de los tres, también al mismo', () => {
    for (const desde of elegibles) {
      for (const hacia of elegibles) {
        expect(transicionKdsValida(desde, hacia), `${desde} -> ${hacia}`).toBe(true);
      }
    }
  });

  it('una línea ANULADO no cambia a ningún estado', () => {
    for (const hacia of ESTADOS_LINEA_KDS) {
      expect(transicionKdsValida('ANULADO', hacia), `ANULADO -> ${hacia}`).toBe(false);
    }
  });

  it('ANULADO no se elige desde la pantalla', () => {
    for (const desde of elegibles) {
      expect(transicionKdsValida(desde, 'ANULADO'), `${desde} -> ANULADO`).toBe(false);
    }
  });

  it('esEstadoLineaElegible deja pasar solo los tres estados de la pantalla', () => {
    expect(ESTADOS_LINEA_KDS.filter((estado) => esEstadoLineaElegible(estado))).toEqual(elegibles);
  });
});
