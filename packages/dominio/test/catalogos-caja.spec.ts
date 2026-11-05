import { describe, expect, it } from 'vitest';
import {
  CORRELATIVO_MAXIMO,
  ESTADOS_COMPROBANTE,
  ESTADOS_TURNO,
  FORMATOS_COMPROBANTE,
  MAXIMO_CAJAS_SUCURSAL,
  MAXIMO_ITEMS_PARTE,
  MAXIMO_PAGOS_COBRO,
  MAXIMO_PARTES_IGUALES,
  MEDIOS_PAGO,
  MODOS_COBRO,
  MONEDA_COMPROBANTE,
  MONTOS_ICBPER,
  MONTO_BOLETA_SIN_DOCUMENTO,
  SEGUNDOS_PULSO_GAVETA,
  TASA_IGV_MAXIMA,
  TASA_IGV_MINIMA,
  TIPOS_COMPROBANTE,
  TIPOS_DESCUENTO,
  TIPOS_DOCUMENTO_CLIENTE,
  TIPOS_MOVIMIENTO_CAJA,
  TIPOS_PARTE,
} from '../src';
import * as entradaCaja from '../src/caja';
import * as indice from '../src';

// Catálogos y límites de caja (historia 006, entrega 6a, criterios 8 a 22 y plan): las constantes que comparten la
// API, los contratos y las pantallas. Las reglas llevan sus propias pruebas (fase B, `test/caja/`).

describe('catálogos de caja', () => {
  it('medios de pago, en el orden de los reportes', () => {
    expect([...MEDIOS_PAGO]).toEqual([
      'EFECTIVO',
      'TARJETA_CREDITO',
      'TARJETA_DEBITO',
      'YAPE',
      'PLIN',
    ]);
  });

  it('comprobantes: tipos de 6a, formatos, documentos del cliente y estados', () => {
    expect([...TIPOS_COMPROBANTE]).toEqual(['BOLETA', 'FACTURA']);
    expect([...FORMATOS_COMPROBANTE]).toEqual(['DETALLADO', 'CONSUMO']);
    expect([...TIPOS_DOCUMENTO_CLIENTE]).toEqual(['DNI', 'CE', 'PASAPORTE', 'RUC']);
    expect([...ESTADOS_COMPROBANTE]).toEqual([
      'POR_ENVIAR',
      'ENVIADO',
      'ACEPTADO',
      'RECHAZADO',
      'ANULADO',
    ]);
    expect(MONEDA_COMPROBANTE).toBe('PEN');
  });

  it('descuentos, partes, modos de cobro, turno y movimientos', () => {
    expect([...TIPOS_DESCUENTO]).toEqual(['PORCENTAJE', 'MONTO']);
    expect([...TIPOS_PARTE]).toEqual(['TOTAL', 'ITEMS', 'IGUALES']);
    expect([...MODOS_COBRO]).toEqual(['ITEMS', 'IGUALES']);
    expect([...ESTADOS_TURNO]).toEqual(['ABIERTO', 'CERRADO']);
    expect([...TIPOS_MOVIMIENTO_CAJA]).toEqual(['INGRESO', 'EGRESO']);
  });

  it('límites', () => {
    expect(MONTO_BOLETA_SIN_DOCUMENTO).toBe('700.00');
    expect(MAXIMO_CAJAS_SUCURSAL).toBe(10);
    expect(MAXIMO_PAGOS_COBRO).toBe(10);
    expect(MAXIMO_PARTES_IGUALES).toBe(50);
    expect(MAXIMO_ITEMS_PARTE).toBe(200);
    expect(SEGUNDOS_PULSO_GAVETA).toBe(120);
    expect(CORRELATIVO_MAXIMO).toBe(99_999_999);
    expect(TASA_IGV_MINIMA).toBe('0.01');
    expect(TASA_IGV_MAXIMA).toBe('30.00');
  });

  it('el ICBPER por bolsa: 0.50 desde 2023-01-01 (pregunta 5), en orden de fecha', () => {
    expect(MONTOS_ICBPER).toEqual([{ desde: '2023-01-01', monto: '0.50' }]);
    const fechas = MONTOS_ICBPER.map((v) => v.desde);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it('la entrada @restaurante/dominio/caja y el índice exponen lo mismo', () => {
    for (const nombre of [
      'MEDIOS_PAGO',
      'MONTOS_ICBPER',
      'desglosar',
      'calcularCuenta',
      'validarDescuento',
      'repartirPorMayorResto',
      'tasaIgvVigente',
      'montoIcbperVigente',
      'calcularParte',
      'cambioDeCuentaPermitido',
      'validarPagos',
      'redondeoEfectivo',
      'esperadoDelTurno',
      'diferenciasDelArqueo',
      'montoEnLetras',
      'tiposDeComprobantePermitidos',
    ]) {
      expect(entradaCaja, nombre).toHaveProperty(nombre);
      expect(indice, nombre).toHaveProperty(nombre);
    }
  });
});
