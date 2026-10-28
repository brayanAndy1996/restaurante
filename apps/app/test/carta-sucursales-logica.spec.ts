import type { AjusteSucursalRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/errores';
import {
  ajusteDeBorrador,
  borradorDeSucursal,
  falloDeAjuste,
  hayCambiosDeSucursal,
  precioPropioDe,
} from '../src/modulos/carta/sucursales-form';

const fila = (extra: Partial<AjusteSucursalRespuesta> = {}): AjusteSucursalRespuesta => ({
  sucursalId: '33333333-3333-4333-8333-333333333333',
  nombre: 'Miraflores',
  precio: null,
  precioEfectivo: '25.00',
  disponible: true,
  agotado: false,
  editable: true,
  ...extra,
});

describe('precioPropioDe', () => {
  it('vacío usa el de la empresa (null)', () => {
    expect(precioPropioDe('')).toEqual({ valor: null });
    expect(precioPropioDe('   ')).toEqual({ valor: null });
  });
  it('completa a 2 decimales como texto, sin números de coma flotante', () => {
    expect(precioPropioDe('27.5')).toEqual({ valor: '27.50' });
    expect(precioPropioDe('28')).toEqual({ valor: '28.00' });
    expect(precioPropioDe('0.10')).toEqual({ valor: '0.10' });
  });
  it('rechaza 0, negativos, exponentes y más de 2 decimales', () => {
    for (const malo of ['0', '0.00', '-3', '1e3', '1.234', 'abc', '123456789']) {
      expect(precioPropioDe(malo).error).toBeDefined();
    }
  });
});

describe('ajusteDeBorrador', () => {
  it('un producto que no se vende solo nunca envía precio', () => {
    expect(ajusteDeBorrador({ precio: '30', disponible: false }, false)).toEqual({
      entrada: { precio: null, disponible: false },
    });
  });
  it('envía el precio normalizado y la disponibilidad', () => {
    expect(ajusteDeBorrador({ precio: '27.5', disponible: true }, true)).toEqual({
      entrada: { precio: '27.50', disponible: true },
    });
  });
  it('devuelve el error del precio mal escrito', () => {
    expect(ajusteDeBorrador({ precio: '0', disponible: true }, true).error).toBeDefined();
  });
});

describe('hayCambiosDeSucursal', () => {
  it('sin tocar nada no hay cambios', () => {
    expect(hayCambiosDeSucursal(fila(), borradorDeSucursal(fila()))).toBe(false);
    const propio = fila({ precio: '27.50' });
    expect(hayCambiosDeSucursal(propio, borradorDeSucursal(propio))).toBe(false);
  });
  it('compara montos como decimales: "27.5" es lo mismo que "27.50"', () => {
    expect(
      hayCambiosDeSucursal(fila({ precio: '27.50' }), { precio: '27.5', disponible: true }),
    ).toBe(false);
    expect(
      hayCambiosDeSucursal(fila({ precio: '27.50' }), { precio: '27.51', disponible: true }),
    ).toBe(true);
  });
  it('detecta poner o quitar el precio propio y cambiar la disponibilidad', () => {
    expect(hayCambiosDeSucursal(fila(), { precio: '30', disponible: true })).toBe(true);
    expect(hayCambiosDeSucursal(fila({ precio: '30.00' }), { precio: '', disponible: true })).toBe(
      true,
    );
    expect(hayCambiosDeSucursal(fila(), { precio: '', disponible: false })).toBe(true);
  });
});

describe('falloDeAjuste', () => {
  const error = (
    codigo: string,
    estado: number,
    campos: { campo: string; mensaje: string }[] = [],
  ) => new ErrorApi({ estado, codigo, mensaje: 'x', campos });

  it('403 explica la regla del Cajero y pide releer', () => {
    const f = falloDeAjuste(error('PROHIBIDO', 403));
    expect(f.mensaje).toMatch(/donde eres Cajero/);
    expect(f.releer).toBe(true);
  });
  it('404 pide releer', () => {
    expect(falloDeAjuste(error('NO_ENCONTRADO', 404)).releer).toBe(true);
  });
  it('400 en el precio lo marca en el campo', () => {
    const f = falloDeAjuste(
      error('DATOS_INVALIDOS', 400, [{ campo: 'precio', mensaje: 'Too small' }]),
    );
    expect(f.precio).toMatch(/mayor que 0/);
    expect(f.releer).toBe(false);
  });
  it('sin conexión dice que lo escrito sigue ahí', () => {
    expect(falloDeAjuste(error('SIN_CONEXION', 0)).mensaje).toMatch(/sigue aquí/);
  });
  it('un error desconocido no muestra códigos', () => {
    expect(falloDeAjuste(new Error('boom')).mensaje).toBe('Algo salió mal. Inténtalo de nuevo.');
  });
});
