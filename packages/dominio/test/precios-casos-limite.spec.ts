// Historia 003, tarea T6 · casos límite de `precios.ts` que complementan a las pruebas protegidas de
// `test/carta/precios.spec.ts` (no protegidas, del desarrollador): repetidos más de dos veces, el orden entre
// la cantidad, el precio y la selección, y que el módulo no toque la configuración global de `decimal.js`.
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  calcularLinea,
  precioEfectivo,
  validarSeleccion,
  type GrupoDeSeleccion,
  type ProductoParaLinea,
} from '../src';

const GRUPO: GrupoDeSeleccion = {
  id: 'g',
  minimo: 0,
  maximo: 2,
  modificadores: [
    { id: 'a', precioExtra: '1.10', disponible: true },
    { id: 'b', precioExtra: '2.20', disponible: true },
    { id: 'c', precioExtra: '0.00', disponible: false },
  ],
};

describe('validarSeleccion · repetidos y desconocidos', () => {
  it('un modificador repetido tres veces da un solo error de repetido', () => {
    expect(validarSeleccion([GRUPO], ['a', 'a', 'a'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'a' }],
    });
  });

  it('un desconocido repetido es desconocido la primera vez y repetido después, sin contar para ningún grupo', () => {
    expect(validarSeleccion([GRUPO], ['x', 'x'])).toEqual({
      valido: false,
      errores: [
        { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: 'x' },
        { codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'x' },
      ],
    });
  });

  it('un no disponible cuenta para el máximo del grupo (no se esquiva eligiéndolo)', () => {
    expect(validarSeleccion([GRUPO], ['a', 'b', 'c'])).toEqual({
      valido: false,
      errores: [
        { codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'c' },
        { codigo: 'MAS_DEL_MAXIMO', grupoId: 'g', maximo: 2, elegidos: 3 },
      ],
    });
  });

  it('un modificador que está en dos grupos pertenece al primero', () => {
    const otro: GrupoDeSeleccion = {
      id: 'h',
      minimo: 1,
      maximo: 1,
      modificadores: [{ id: 'a', precioExtra: '0.00', disponible: true }],
    };
    expect(validarSeleccion([GRUPO, otro], ['a'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MENOS_DEL_MINIMO', grupoId: 'h', minimo: 1, elegidos: 0 }],
    });
  });
});

describe('calcularLinea · orden de las comprobaciones', () => {
  const producto: ProductoParaLinea = { precio: '10.00', grupos: [GRUPO] };

  it('la cantidad inválida lanza antes que cualquier otro resultado', () => {
    expect(() => calcularLinea({ precio: null, grupos: [] }, [], 0)).toThrow(RangeError);
    expect(() => calcularLinea(producto, ['x'], 1000)).toThrow(RangeError);
  });

  it('un precio inválido lanza aunque la selección también lo sea', () => {
    expect(() => calcularLinea({ precio: '1e2', grupos: [GRUPO] }, ['x'], 1)).toThrow(RangeError);
    expect(() =>
      calcularLinea({ precio: undefined as unknown as null, grupos: [] }, [], 1),
    ).toThrow(RangeError);
  });

  it('el precio extra inválido de un modificador no elegido también lanza (dato corrupto)', () => {
    const corrupto: ProductoParaLinea = {
      precio: '10.00',
      grupos: [{ ...GRUPO, modificadores: [{ id: 'a', precioExtra: '1.123', disponible: true }] }],
    };
    expect(() => calcularLinea(corrupto, [], 1)).toThrow(RangeError);
  });

  it('sin precio gana sobre una selección inválida: el producto no se puede vender', () => {
    expect(calcularLinea({ precio: null, grupos: [GRUPO] }, ['x'], 1)).toEqual({
      valido: false,
      errores: [{ codigo: 'PRODUCTO_SIN_PRECIO' }],
    });
  });

  it('devuelve los modificadores en el orden recibido, con 2 decimales', () => {
    expect(calcularLinea(producto, ['b', 'a'], 2)).toEqual({
      valido: true,
      precioUnitario: '13.30',
      total: '26.60',
      modificadores: [
        { id: 'b', precioExtra: '2.20' },
        { id: 'a', precioExtra: '1.10' },
      ],
    });
  });

  it('el mayor monto posible no pierde precisión', () => {
    const enorme: ProductoParaLinea = { precio: '99999999.99', grupos: [] };
    expect(calcularLinea(enorme, [], 999)).toMatchObject({
      precioUnitario: '99999999.99',
      total: '99899999990.01',
    });
  });
});

describe('configuración de decimal.js', () => {
  it('no cambia la precisión ni el redondeo del Decimal global', () => {
    const antes = { precision: Decimal.precision, rounding: Decimal.rounding };
    precioEfectivo('1.5', null);
    calcularLinea({ precio: '1.00', grupos: [] }, [], 3);
    expect({ precision: Decimal.precision, rounding: Decimal.rounding }).toEqual(antes);
  });

  it('un Decimal global con otra precisión no altera los resultados', () => {
    const original = Decimal.precision;
    Decimal.set({ precision: 3 });
    try {
      expect(calcularLinea({ precio: '19.99', grupos: [] }, [], 999)).toMatchObject({
        total: '19970.01',
      });
    } finally {
      Decimal.set({ precision: original });
    }
  });
});
