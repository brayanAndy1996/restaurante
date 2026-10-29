// spec: 004-salon-cocina (pruebas protegidas)
//
// P1 · Criterio 76 (reglas puras de montos de la orden): `totalVigenteLinea`, `totalOrden`, `excedeMontoMaximo`
// y `MONTO_MAXIMO` de `packages/dominio`. Un caso por cada ejemplo de la especificación (incluidos el tope
// y los `RangeError`), la exactitud decimal (sin coma flotante) y los precios de la orden de ejemplo
// calculados con `calcularLinea` de la carta (003).
import { describe, expect, it } from 'vitest';
import {
  MONTO_MAXIMO,
  calcularLinea,
  excedeMontoMaximo,
  totalOrden,
  totalVigenteLinea,
  type GrupoDeSeleccion,
  type ItemParaTotal,
  type ProductoParaLinea,
} from '../../src';

// ---------------------------------------------------------------------------------------------
// La orden de ejemplo del criterio 76
// ---------------------------------------------------------------------------------------------

const TERMINO: GrupoDeSeleccion = {
  id: 'g-termino',
  minimo: 1,
  maximo: 1,
  modificadores: [
    { id: 'm-jugoso', precioExtra: '0.00', disponible: true },
    { id: 'm-tres-cuartos', precioExtra: '0.00', disponible: true },
    { id: 'm-bien-cocido', precioExtra: '0.00', disponible: true },
  ],
};
const EXTRAS: GrupoDeSeleccion = {
  id: 'g-extras',
  minimo: 0,
  maximo: 2,
  modificadores: [
    { id: 'm-huevo', precioExtra: '2.50', disponible: true },
    { id: 'm-platano', precioExtra: '3.00', disponible: true },
    { id: 'm-queso', precioExtra: '2.00', disponible: true },
  ],
};
const LOMO: ProductoParaLinea = { precio: '28.00', grupos: [TERMINO, EXTRAS] };
const COMBO: ProductoParaLinea = {
  precio: '22.90',
  grupos: [
    {
      id: 'g-bebida',
      minimo: 1,
      maximo: 1,
      modificadores: [
        { id: 'm-chicha', precioExtra: '0.00', disponible: true },
        { id: 'm-inca-kola', precioExtra: '0.00', disponible: true },
        { id: 'm-cerveza', precioExtra: '4.50', disponible: true },
      ],
    },
    {
      id: 'g-acompanamiento',
      minimo: 1,
      maximo: 1,
      modificadores: [
        { id: 'm-papas', precioExtra: '0.00', disponible: true },
        { id: 'm-ensalada', precioExtra: '1.00', disponible: true },
      ],
    },
  ],
};
const MENU: ProductoParaLinea = {
  precio: '12.00',
  grupos: [
    {
      id: 'g-entrada',
      minimo: 1,
      maximo: 1,
      modificadores: [
        { id: 'm-papa-huancaina', precioExtra: '0.00', disponible: true },
        { id: 'm-sopa', precioExtra: '0.00', disponible: true },
      ],
    },
    {
      id: 'g-segundo',
      minimo: 1,
      maximo: 1,
      modificadores: [
        { id: 'm-aji-de-gallina', precioExtra: '0.00', disponible: true },
        { id: 'm-lomo-saltado', precioExtra: '5.00', disponible: true },
      ],
    },
  ],
};

/** Precio unitario de una línea de la carta de ejemplo, como lo guarda el ítem (`calcularLinea`, 003). */
function precioUnitarioDe(producto: ProductoParaLinea, elegidos: string[]): string {
  const resultado = calcularLinea(producto, elegidos, 1);
  if (!resultado.valido)
    throw new Error(`Selección inválida en la prueba: ${JSON.stringify(resultado)}`);
  return resultado.precioUnitario;
}

/** Lomo saltado [3/4, Huevo, Plátano] × 2. */
const LINEA_LOMO = (): ItemParaTotal => ({
  precioUnitario: precioUnitarioDe(LOMO, ['m-tres-cuartos', 'm-huevo', 'm-platano']),
  cantidad: 2,
  cantidadAnulada: 0,
});
/** Combo hamburguesa [Cerveza, Ensalada] × 3. */
const LINEA_COMBO = (): ItemParaTotal => ({
  precioUnitario: precioUnitarioDe(COMBO, ['m-cerveza', 'm-ensalada']),
  cantidad: 3,
  cantidadAnulada: 0,
});
/** Menú del día [Sopa, Lomo saltado] × 1. */
const LINEA_MENU = (): ItemParaTotal => ({
  precioUnitario: precioUnitarioDe(MENU, ['m-sopa', 'm-lomo-saltado']),
  cantidad: 1,
  cantidadAnulada: 0,
});

// ---------------------------------------------------------------------------------------------
// MONTO_MAXIMO
// ---------------------------------------------------------------------------------------------

describe('MONTO_MAXIMO (criterios 21 y 76)', () => {
  it('es lo que cabe en una columna NUMERIC(10,2), como texto', () => {
    expect(MONTO_MAXIMO).toBe('99999999.99');
  });
});

// ---------------------------------------------------------------------------------------------
// totalVigenteLinea
// ---------------------------------------------------------------------------------------------

describe('totalVigenteLinea (criterio 76)', () => {
  it('ejemplos de la especificación', () => {
    expect(totalVigenteLinea('28.00', 3, 1)).toBe('56.00');
    expect(totalVigenteLinea('0.10', 3, 3)).toBe('0.00');
    expect(totalVigenteLinea('19.99', 999, 0)).toBe('19970.01');
  });

  it('con 99999999.99 × 2 devuelve 199999999.98 sin acotar al tope', () => {
    expect(totalVigenteLinea('99999999.99', 2, 0)).toBe('199999999.98');
  });

  it('es precio × (cantidad − cantidadAnulada), con la cantidad anulada de cero a todas', () => {
    expect(totalVigenteLinea('33.50', 2, 0)).toBe('67.00');
    expect(totalVigenteLinea('28.40', 3, 0)).toBe('85.20');
    expect(totalVigenteLinea('28.40', 3, 1)).toBe('56.80');
    expect(totalVigenteLinea('28.40', 3, 2)).toBe('28.40');
    expect(totalVigenteLinea('28.40', 3, 3)).toBe('0.00');
    expect(totalVigenteLinea('17.00', 1, 0)).toBe('17.00');
    expect(totalVigenteLinea('17.00', 1, 1)).toBe('0.00');
    expect(totalVigenteLinea('5.00', 999, 999)).toBe('0.00');
  });

  it('devuelve siempre texto con 2 decimales, aunque el precio traiga 0, 1 o 2', () => {
    expect(totalVigenteLinea('5', 2, 0)).toBe('10.00');
    expect(totalVigenteLinea('5.5', 2, 0)).toBe('11.00');
    expect(totalVigenteLinea('5.55', 1, 0)).toBe('5.55');
    expect(totalVigenteLinea('0.00', 7, 0)).toBe('0.00');
  });

  it('es exacto con decimales que la coma flotante no representa', () => {
    // 0.1 × 3 = 0.30000000000000004 con números de coma flotante.
    expect(totalVigenteLinea('0.10', 3, 0)).toBe('0.30');
    expect(totalVigenteLinea('0.07', 100, 0)).toBe('7.00');
    expect(totalVigenteLinea('1.15', 3, 0)).toBe('3.45');
    expect(totalVigenteLinea('8.20', 3, 1)).toBe('16.40');
  });

  it('el resultado es texto, no número', () => {
    expect(typeof totalVigenteLinea('28.00', 1, 0)).toBe('string');
  });

  it('cantidadAnulada mayor que cantidad, negativa o decimal lanza RangeError', () => {
    expect(() => totalVigenteLinea('28.00', 3, 4)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 1, 2)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 3, -1)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 3, 0.5)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 3, 1.5)).toThrow(RangeError);
  });

  it('cantidad fuera de 1 a 999 o decimal lanza RangeError', () => {
    expect(() => totalVigenteLinea('28.00', 0, 0)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 1000, 0)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', -1, 0)).toThrow(RangeError);
    expect(() => totalVigenteLinea('28.00', 1.5, 0)).toThrow(RangeError);
  });

  it('los límites de la cantidad (1 y 999) se aceptan', () => {
    expect(totalVigenteLinea('1.00', 1, 0)).toBe('1.00');
    expect(totalVigenteLinea('1.00', 999, 0)).toBe('999.00');
  });

  it('un precio mal formado lanza RangeError', () => {
    const malos = [
      '',
      ' ',
      'abc',
      '-1.00',
      '+1.00',
      '1e3',
      '1.234',
      '1,00',
      '.5',
      '5.',
      ' 1.00',
      '1.00 ',
      '123456789.00',
      '28.00.00',
    ];
    for (const precio of malos) {
      expect(() => totalVigenteLinea(precio, 1, 0), `precio "${precio}"`).toThrow(RangeError);
    }
  });

  it('un precio que no es texto lanza RangeError', () => {
    expect(() => totalVigenteLinea(28 as unknown as string, 1, 0)).toThrow(RangeError);
    expect(() => totalVigenteLinea(null as unknown as string, 1, 0)).toThrow(RangeError);
    expect(() => totalVigenteLinea(undefined as unknown as string, 1, 0)).toThrow(RangeError);
  });

  it('los límites del precio (0.00 y 99999999.99) se aceptan', () => {
    expect(totalVigenteLinea('0.00', 5, 0)).toBe('0.00');
    expect(totalVigenteLinea('99999999.99', 1, 0)).toBe('99999999.99');
  });
});

// ---------------------------------------------------------------------------------------------
// totalOrden
// ---------------------------------------------------------------------------------------------

describe('totalOrden (criterio 76)', () => {
  it('los precios de la orden de ejemplo salen de la carta de ejemplo', () => {
    expect(LINEA_LOMO().precioUnitario).toBe('33.50');
    expect(LINEA_COMBO().precioUnitario).toBe('28.40');
    expect(LINEA_MENU().precioUnitario).toBe('17.00');
  });

  it('la orden de ejemplo suma 169.20', () => {
    expect(totalOrden([LINEA_LOMO(), LINEA_COMBO(), LINEA_MENU()])).toBe('169.20');
  });

  it('con un combo anulado suma 140.80', () => {
    const combo = { ...LINEA_COMBO(), cantidadAnulada: 1 };
    expect(totalOrden([LINEA_LOMO(), combo, LINEA_MENU()])).toBe('140.80');
  });

  it('con los tres combos anulados suma 84.00 y con todo anulado, 0.00', () => {
    const sinCombos = { ...LINEA_COMBO(), cantidadAnulada: 3 };
    expect(totalOrden([LINEA_LOMO(), sinCombos, LINEA_MENU()])).toBe('84.00');
    const todo = [LINEA_LOMO(), LINEA_COMBO(), LINEA_MENU()].map((i) => ({
      ...i,
      cantidadAnulada: i.cantidad,
    }));
    expect(totalOrden(todo)).toBe('0.00');
  });

  it('una orden sin ítems suma 0.00', () => {
    expect(totalOrden([])).toBe('0.00');
  });

  it('con un solo ítem es el total vigente de ese ítem', () => {
    expect(totalOrden([{ precioUnitario: '28.00', cantidad: 3, cantidadAnulada: 1 }])).toBe(
      '56.00',
    );
  });

  it('el orden de los ítems no cambia el total', () => {
    const items = [LINEA_LOMO(), LINEA_COMBO(), LINEA_MENU()];
    expect(totalOrden([...items].reverse())).toBe('169.20');
    expect(totalOrden([items[1]!, items[2]!, items[0]!])).toBe('169.20');
  });

  it('es exacto: cien ítems de 0.10 suman 10.00 y tres de 0.10 suman 0.30', () => {
    const cien = Array.from({ length: 100 }, () => ({
      precioUnitario: '0.10',
      cantidad: 1,
      cantidadAnulada: 0,
    }));
    expect(totalOrden(cien)).toBe('10.00');
    expect(
      totalOrden([
        { precioUnitario: '0.10', cantidad: 1, cantidadAnulada: 0 },
        { precioUnitario: '0.20', cantidad: 1, cantidadAnulada: 0 },
      ]),
    ).toBe('0.30');
  });

  it('con 19.99 × 999 y 0.10 × 3 suma 19970.31', () => {
    expect(
      totalOrden([
        { precioUnitario: '19.99', cantidad: 999, cantidadAnulada: 0 },
        { precioUnitario: '0.10', cantidad: 3, cantidadAnulada: 0 },
      ]),
    ).toBe('19970.31');
  });

  it('no acota: la suma puede pasar del tope y de 8 enteros', () => {
    expect(
      totalOrden([
        { precioUnitario: '99999999.99', cantidad: 2, cantidadAnulada: 0 },
        { precioUnitario: '99999999.99', cantidad: 2, cantidadAnulada: 0 },
      ]),
    ).toBe('399999999.96');
  });

  it('no modifica los ítems recibidos', () => {
    const items = [LINEA_LOMO(), LINEA_COMBO()];
    const copia = structuredClone(items);
    totalOrden(items);
    expect(items).toEqual(copia);
  });

  it('un ítem con cantidadAnulada mayor que cantidad, negativa o decimal lanza RangeError', () => {
    expect(() =>
      totalOrden([{ precioUnitario: '28.00', cantidad: 1, cantidadAnulada: 2 }]),
    ).toThrow(RangeError);
    expect(() =>
      totalOrden([{ precioUnitario: '28.00', cantidad: 3, cantidadAnulada: -1 }]),
    ).toThrow(RangeError);
    expect(() =>
      totalOrden([{ precioUnitario: '28.00', cantidad: 3, cantidadAnulada: 0.5 }]),
    ).toThrow(RangeError);
  });

  it('un ítem con cantidad fuera de 1 a 999 o decimal lanza RangeError', () => {
    for (const cantidad of [0, 1000, -2, 2.5]) {
      expect(
        () => totalOrden([{ precioUnitario: '28.00', cantidad, cantidadAnulada: 0 }]),
        `cantidad ${cantidad}`,
      ).toThrow(RangeError);
    }
  });

  it('un precio mal formado en cualquier ítem lanza RangeError', () => {
    for (const precioUnitario of ['', 'x', '-5.00', '1.234', '1e3', '123456789.00']) {
      const items = [LINEA_LOMO(), { precioUnitario, cantidad: 1, cantidadAnulada: 0 }];
      expect(() => totalOrden(items), `precio "${precioUnitario}"`).toThrow(RangeError);
    }
  });

  it('devuelve texto con 2 decimales', () => {
    const total = totalOrden([{ precioUnitario: '7', cantidad: 1, cantidadAnulada: 0 }]);
    expect(total).toBe('7.00');
    expect(typeof total).toBe('string');
  });
});

// ---------------------------------------------------------------------------------------------
// excedeMontoMaximo
// ---------------------------------------------------------------------------------------------

describe('excedeMontoMaximo (criterios 21 y 76)', () => {
  it('el tope exacto no se excede', () => {
    expect(excedeMontoMaximo('99999999.99')).toBe(false);
    expect(excedeMontoMaximo(MONTO_MAXIMO)).toBe(false);
  });

  it('un centavo más sí', () => {
    expect(excedeMontoMaximo('100000000.00')).toBe(true);
    expect(excedeMontoMaximo('100000000.01')).toBe(true);
  });

  it('montos por debajo del tope no lo exceden', () => {
    expect(excedeMontoMaximo('0.00')).toBe(false);
    expect(excedeMontoMaximo('99999999.98')).toBe(false);
    expect(excedeMontoMaximo('99999999.00')).toBe(false);
    expect(excedeMontoMaximo('19970.01')).toBe(false);
  });

  it('acepta los totales de hasta 12 enteros que da totalOrden', () => {
    expect(excedeMontoMaximo('199999999.98')).toBe(true);
    expect(excedeMontoMaximo('399999999.96')).toBe(true);
    expect(excedeMontoMaximo('999999999999.99')).toBe(true);
  });

  it('el ejemplo del criterio 21: 99999999.00 × 2 excede, × 1 no', () => {
    expect(excedeMontoMaximo(totalVigenteLinea('99999999.00', 2, 0))).toBe(true);
    expect(excedeMontoMaximo(totalVigenteLinea('99999999.00', 1, 0))).toBe(false);
  });

  it('el ejemplo del criterio 76: 99999999.99 × 2 excede y × 1 no', () => {
    expect(excedeMontoMaximo(totalVigenteLinea('99999999.99', 2, 0))).toBe(true);
    expect(excedeMontoMaximo(totalVigenteLinea('99999999.99', 1, 0))).toBe(false);
  });

  it('con el total de la orden: justo en el tope no excede, un centavo más sí', () => {
    const joya = { precioUnitario: '99999999.00', cantidad: 1, cantidadAnulada: 0 };
    expect(excedeMontoMaximo(totalOrden([joya, { ...joya, precioUnitario: '0.99' }]))).toBe(false);
    expect(excedeMontoMaximo(totalOrden([joya, { ...joya, precioUnitario: '1.00' }]))).toBe(true);
  });

  it('un monto mal formado lanza RangeError', () => {
    for (const monto of ['', 'abc', '-1.00', '1e3', '1.234', '1,00', ' 1.00']) {
      expect(() => excedeMontoMaximo(monto), `monto "${monto}"`).toThrow(RangeError);
    }
    expect(() => excedeMontoMaximo(5 as unknown as string)).toThrow(RangeError);
  });
});
