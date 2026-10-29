import { describe, expect, it } from 'vitest';
import {
  CANALES_ORDEN,
  DESTINOS_COMANDA,
  DESTINOS_STOCK,
  ESTADOS_LINEA_KDS,
  ESTADOS_MESA,
  ESTADOS_ORDEN,
  FORMAS_MESA,
  LARGO_OBSERVACION,
  MAXIMO_LINEAS_ENVIO,
  MAXIMO_MESAS_ORDEN,
  MONTO_MAXIMO,
  ROLES_PARTE,
  TIEMPOS_SERVICIO,
  TIPOS_COMANDA,
  TIPOS_ORDEN,
} from '../../src';

// Catálogos y límites de Salón y Cocina (historia 004): lo que fijan el contrato y el modelo de datos.

describe('catálogos de Salón y Cocina', () => {
  it('coinciden con los CHECK del modelo de datos', () => {
    expect(ESTADOS_ORDEN).toEqual(['ABIERTA', 'EN_PRECUENTA', 'ANULADA', 'UNIDA', 'CERRADA']);
    expect(TIPOS_ORDEN).toEqual(['MESA', 'MOSTRADOR', 'PARA_LLEVAR', 'DELIVERY']);
    expect(CANALES_ORDEN).toEqual(['SALON', 'WEB', 'TELEFONO']);
    expect(ESTADOS_MESA).toEqual(['LIBRE', 'OCUPADA', 'EN_PRECUENTA']);
    expect(FORMAS_MESA).toEqual(['CUADRADA', 'REDONDA', 'RECTANGULAR']);
    expect(TIPOS_COMANDA).toEqual(['COMANDA', 'ADICION', 'MARCHAR', 'ANULACION']);
    expect(DESTINOS_COMANDA).toEqual(['KDS', 'IMPRESORA']);
    expect(ROLES_PARTE).toEqual(['PRODUCTO', 'COMPONENTE', 'LIGADO']);
    expect(ESTADOS_LINEA_KDS).toEqual(['ENVIADO', 'EN_PREPARACION', 'LISTO', 'ANULADO']);
    expect(DESTINOS_STOCK).toEqual(['VUELVE', 'MERMA']);
    expect(TIEMPOS_SERVICIO).toEqual([1, 2]);
  });

  it('fijan los límites del contrato', () => {
    expect(MAXIMO_LINEAS_ENVIO).toBe(50);
    expect(MAXIMO_MESAS_ORDEN).toBe(20);
    expect(LARGO_OBSERVACION).toBe(140);
  });

  it('MONTO_MAXIMO es el mayor valor de NUMERIC(10,2)', () => {
    expect(MONTO_MAXIMO).toBe('99999999.99');
  });
});
