// spec: 003-carta (pruebas protegidas)
//
// P1 · Criterios 55, 56 y 57 (reglas puras de montos de la carta): `precioEfectivo`, `validarSeleccion`
// y `calcularLinea` de `packages/dominio`. Un caso por cada ejemplo de la especificación, el orden de los
// errores, la exactitud decimal, el precio de sucursal, `PRODUCTO_SIN_PRECIO` y los `RangeError` de
// montos y cantidades inválidos.
import { describe, expect, it } from 'vitest';
import {
  CANTIDAD_MAXIMA_LINEA,
  calcularLinea,
  precioEfectivo,
  validarSeleccion,
  type GrupoDeSeleccion,
  type ProductoParaLinea,
} from '../../src';

// ---------------------------------------------------------------------------------------------
// Datos de la especificación
// ---------------------------------------------------------------------------------------------

/** Lomo saltado (criterio 57): Término (única, obligatoria) y Extras (múltiple, 0 a 2). */
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

/** Modificador de otro producto: no está en ningún grupo del Lomo saltado. */
const DE_OTRO_PRODUCTO = 'm-de-otro-producto';

/** Combo hamburguesa (criterios 30 y 57). */
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

/** Menú del día (criterio 57). */
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

/** Una variante del Lomo saltado con el Queso agotado (`disponible: false`). */
const GRUPOS_QUESO_NO_DISPONIBLE: GrupoDeSeleccion[] = [
  TERMINO,
  {
    ...EXTRAS,
    modificadores: EXTRAS.modificadores.map((m) =>
      m.id === 'm-queso' ? { ...m, disponible: false } : m,
    ),
  },
];

const porId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

// ---------------------------------------------------------------------------------------------
// Criterio 55 · precioEfectivo
// ---------------------------------------------------------------------------------------------

describe('criterio 55 · precioEfectivo', () => {
  it.each([
    ['25.00', null, '25.00'],
    ['25.00', '27.50', '27.50'],
    ['25', '19.9', '19.90'],
  ] as const)('(%s, %s) devuelve %s', (empresa, sucursal, esperado) => {
    expect(precioEfectivo(empresa, sucursal)).toBe(esperado);
  });

  it('(null, null) devuelve null: un producto que no se vende solo no tiene precio', () => {
    expect(precioEfectivo(null, null)).toBeNull();
  });

  it('con precio de empresa en un solo decimal o entero, el resultado lleva siempre 2 decimales', () => {
    expect(precioEfectivo('7', null)).toBe('7.00');
    expect(precioEfectivo('7.5', null)).toBe('7.50');
    expect(precioEfectivo('99999999.99', null)).toBe('99999999.99');
  });

  it('un precio de sucursal igual al de la empresa se devuelve tal cual', () => {
    expect(precioEfectivo('25.00', '25.00')).toBe('25.00');
  });

  const INVALIDOS: [string, unknown][] = [
    ['un número de JavaScript', 25],
    ['un número de JavaScript con decimales', 19.9],
    ['un negativo', '-1.00'],
    ['un negativo cero', '-0'],
    ['un exponente', '1e2'],
    ['un hexadecimal', '0x10'],
    ['más de 2 decimales', '1.234'],
    ['más de 8 enteros', '123456789.00'],
    ['un signo más', '+25.00'],
    ['espacios en los extremos', ' 25.00 '],
    ['un salto de línea', '25.00\n'],
    ['un texto vacío', ''],
    ['sin enteros', '.5'],
    ['sin decimales tras el punto', '25.'],
    ['una coma decimal', '25,00'],
    ['texto cualquiera', 'abc'],
    ['NaN como texto', 'NaN'],
    ['Infinity como texto', 'Infinity'],
  ];

  it.each(INVALIDOS)('un precio de empresa inválido (%s) lanza RangeError', (_nombre, monto) => {
    expect(() => precioEfectivo(monto as string, null)).toThrow(RangeError);
  });

  it.each(INVALIDOS)('un precio de sucursal inválido (%s) lanza RangeError', (_nombre, monto) => {
    expect(() => precioEfectivo('25.00', monto as string)).toThrow(RangeError);
  });

  it('el límite de 8 enteros: 99999999.99 vale y 100000000.00 lanza RangeError', () => {
    expect(precioEfectivo('99999999.99', null)).toBe('99999999.99');
    expect(() => precioEfectivo('100000000.00', null)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 56 · validarSeleccion
// ---------------------------------------------------------------------------------------------

describe('criterio 56 · validarSeleccion (Lomo saltado)', () => {
  const grupos = [TERMINO, EXTRAS];

  it('[3/4] es válido', () => {
    expect(validarSeleccion(grupos, ['m-tres-cuartos'])).toEqual({ valido: true });
  });

  it('[3/4, Huevo, Plátano] es válido', () => {
    expect(validarSeleccion(grupos, ['m-tres-cuartos', 'm-huevo', 'm-platano'])).toEqual({
      valido: true,
    });
  });

  it('[] da MENOS_DEL_MINIMO del Término (mínimo 1, elegidos 0)', () => {
    expect(validarSeleccion(grupos, [])).toEqual({
      valido: false,
      errores: [{ codigo: 'MENOS_DEL_MINIMO', grupoId: 'g-termino', minimo: 1, elegidos: 0 }],
    });
  });

  it('[Jugoso, 3/4] da MAS_DEL_MAXIMO del Término (máximo 1, elegidos 2)', () => {
    expect(validarSeleccion(grupos, ['m-jugoso', 'm-tres-cuartos'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-termino', maximo: 1, elegidos: 2 }],
    });
  });

  it('[3/4, Huevo, Plátano, Queso] da MAS_DEL_MAXIMO de Extras (máximo 2, elegidos 3)', () => {
    expect(validarSeleccion(grupos, ['m-tres-cuartos', 'm-huevo', 'm-platano', 'm-queso'])).toEqual(
      {
        valido: false,
        errores: [{ codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-extras', maximo: 2, elegidos: 3 }],
      },
    );
  });

  it('[3/4, Huevo, Huevo] da MODIFICADOR_REPETIDO de Huevo y nada más', () => {
    expect(validarSeleccion(grupos, ['m-tres-cuartos', 'm-huevo', 'm-huevo'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'm-huevo' }],
    });
  });

  it('un modificador repetido cuenta una sola vez para el máximo', () => {
    // Término con un solo 3/4 repetido: el repetido es el único error; no hay MAS_DEL_MAXIMO.
    const resultado = validarSeleccion(grupos, ['m-tres-cuartos', 'm-tres-cuartos']);
    expect(resultado).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'm-tres-cuartos' }],
    });
  });

  it('un modificador repetido cuenta una sola vez para el mínimo (no basta repetir para llegar a él)', () => {
    // Extras con mínimo 2: Huevo dos veces cuenta una, así que faltan opciones.
    const conMinimo: GrupoDeSeleccion[] = [{ ...EXTRAS, minimo: 2 }];
    expect(validarSeleccion(conMinimo, ['m-huevo', 'm-huevo'])).toEqual({
      valido: false,
      errores: [
        { codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'm-huevo' },
        { codigo: 'MENOS_DEL_MINIMO', grupoId: 'g-extras', minimo: 2, elegidos: 1 },
      ],
    });
  });

  it('[3/4, X] con X de otro producto da MODIFICADOR_DESCONOCIDO de X', () => {
    expect(validarSeleccion(grupos, ['m-tres-cuartos', DE_OTRO_PRODUCTO])).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: DE_OTRO_PRODUCTO }],
    });
  });

  it('[3/4, Queso] con Queso no disponible da MODIFICADOR_NO_DISPONIBLE de Queso', () => {
    expect(validarSeleccion(GRUPOS_QUESO_NO_DISPONIBLE, ['m-tres-cuartos', 'm-queso'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'm-queso' }],
    });
  });

  it('un grupo sin modificadores con mínimo 0 y [] es válido', () => {
    const vacio: GrupoDeSeleccion = { id: 'g-vacio', minimo: 0, maximo: 1, modificadores: [] };
    expect(validarSeleccion([vacio], [])).toEqual({ valido: true });
  });

  it('sin grupos y sin elegidos es válido; sin grupos, cualquier elegido es desconocido', () => {
    expect(validarSeleccion([], [])).toEqual({ valido: true });
    expect(validarSeleccion([], ['m-huevo'])).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: 'm-huevo' }],
    });
  });

  it('el resultado de validez no depende del orden de los grupos ni del de los elegidos', () => {
    const elegidos = ['m-huevo', 'm-platano', 'm-tres-cuartos'];
    expect(validarSeleccion([EXTRAS, TERMINO], elegidos)).toEqual({ valido: true });
    expect(validarSeleccion([TERMINO, EXTRAS], [...elegidos].reverse())).toEqual({ valido: true });
  });

  describe('orden de los errores', () => {
    it('primero los de cada elegido en el orden recibido, luego los de cada grupo', () => {
      // Término sin elección (MENOS_DEL_MINIMO) y tres problemas de elegidos en este orden.
      const resultado = validarSeleccion(GRUPOS_QUESO_NO_DISPONIBLE, [
        DE_OTRO_PRODUCTO,
        'm-queso',
        'm-huevo',
        'm-huevo',
      ]);
      expect(resultado).toEqual({
        valido: false,
        errores: [
          { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: DE_OTRO_PRODUCTO },
          { codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'm-queso' },
          { codigo: 'MODIFICADOR_REPETIDO', modificadorId: 'm-huevo' },
          { codigo: 'MENOS_DEL_MINIMO', grupoId: 'g-termino', minimo: 1, elegidos: 0 },
        ],
      });
    });

    it('los errores de elegido siguen el orden recibido: cambiar el orden cambia el de los errores', () => {
      const a = validarSeleccion(GRUPOS_QUESO_NO_DISPONIBLE, [
        'm-tres-cuartos',
        'm-queso',
        DE_OTRO_PRODUCTO,
      ]);
      const b = validarSeleccion(GRUPOS_QUESO_NO_DISPONIBLE, [
        'm-tres-cuartos',
        DE_OTRO_PRODUCTO,
        'm-queso',
      ]);
      expect(a).toEqual({
        valido: false,
        errores: [
          { codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'm-queso' },
          { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: DE_OTRO_PRODUCTO },
        ],
      });
      expect(b).toEqual({
        valido: false,
        errores: [
          { codigo: 'MODIFICADOR_DESCONOCIDO', modificadorId: DE_OTRO_PRODUCTO },
          { codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'm-queso' },
        ],
      });
    });

    it('los errores de grupo siguen el orden de `grupos`, no el de la elección', () => {
      // Término con dos (máximo 1) y Extras con tres (máximo 2): los dos grupos fallan.
      const elegidos = ['m-jugoso', 'm-tres-cuartos', 'm-huevo', 'm-platano', 'm-queso'];
      const terminoPrimero = validarSeleccion([TERMINO, EXTRAS], elegidos);
      const extrasPrimero = validarSeleccion([EXTRAS, TERMINO], elegidos);
      const ordenTermino = [
        { codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-termino', maximo: 1, elegidos: 2 },
        { codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-extras', maximo: 2, elegidos: 3 },
      ];
      expect(terminoPrimero).toEqual({ valido: false, errores: ordenTermino });
      expect(extrasPrimero).toEqual({ valido: false, errores: [...ordenTermino].reverse() });
    });

    it('un mínimo no alcanzado en un grupo y un máximo superado en otro salen en el orden de los grupos', () => {
      // Elige solo Extras de más: Término sin elegir (mínimo) y Extras pasado (máximo).
      const elegidos = ['m-huevo', 'm-platano', 'm-queso'];
      expect(validarSeleccion([TERMINO, EXTRAS], elegidos)).toEqual({
        valido: false,
        errores: [
          { codigo: 'MENOS_DEL_MINIMO', grupoId: 'g-termino', minimo: 1, elegidos: 0 },
          { codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-extras', maximo: 2, elegidos: 3 },
        ],
      });
    });
  });

  it('no modifica sus argumentos', () => {
    const gruposCopia = structuredClone([TERMINO, EXTRAS]);
    const elegidos = ['m-jugoso', 'm-tres-cuartos', 'm-huevo', 'm-huevo'];
    const elegidosCopia = [...elegidos];
    validarSeleccion([TERMINO, EXTRAS], elegidos);
    expect([TERMINO, EXTRAS]).toEqual(gruposCopia);
    expect(elegidos).toEqual(elegidosCopia);
  });
});

// ---------------------------------------------------------------------------------------------
// Criterio 57 · calcularLinea
// ---------------------------------------------------------------------------------------------

describe('criterio 57 · calcularLinea: ejemplos de la especificación', () => {
  it('Lomo saltado [3/4, Huevo, Plátano] × 2 → "33.50" y "67.00"', () => {
    const r = calcularLinea(LOMO, ['m-tres-cuartos', 'm-huevo', 'm-platano'], 2);
    expect(r).toMatchObject({ valido: true, precioUnitario: '33.50', total: '67.00' });
    if (!r.valido) throw new Error('esperaba una línea válida');
    expect([...r.modificadores].sort(porId)).toEqual(
      [
        { id: 'm-tres-cuartos', precioExtra: '0.00' },
        { id: 'm-huevo', precioExtra: '2.50' },
        { id: 'm-platano', precioExtra: '3.00' },
      ].sort(porId),
    );
  });

  it('Combo hamburguesa [Cerveza, Ensalada] × 3 → "28.40" y "85.20"', () => {
    expect(calcularLinea(COMBO, ['m-cerveza', 'm-ensalada'], 3)).toMatchObject({
      valido: true,
      precioUnitario: '28.40',
      total: '85.20',
    });
  });

  it('Combo hamburguesa [Chicha, Papas] × 1 → "22.90" y "22.90"', () => {
    expect(calcularLinea(COMBO, ['m-chicha', 'm-papas'], 1)).toMatchObject({
      valido: true,
      precioUnitario: '22.90',
      total: '22.90',
    });
  });

  it('Menú del día [Sopa, Lomo saltado] × 1 → "17.00" y "17.00"', () => {
    expect(calcularLinea(MENU, ['m-sopa', 'm-lomo-saltado'], 1)).toMatchObject({
      valido: true,
      precioUnitario: '17.00',
      total: '17.00',
    });
  });

  it('el resultado válido lleva solo lo que el contrato dice (sin errores)', () => {
    const r = calcularLinea(LOMO, ['m-tres-cuartos'], 1);
    expect(Object.keys(r).sort()).toEqual(['modificadores', 'precioUnitario', 'total', 'valido']);
  });

  it('una línea sin modificadores elegidos devuelve la lista vacía y el precio del producto', () => {
    const sinGrupos: ProductoParaLinea = { precio: '15.50', grupos: [] };
    expect(calcularLinea(sinGrupos, [], 2)).toEqual({
      valido: true,
      precioUnitario: '15.50',
      total: '31.00',
      modificadores: [],
    });
  });
});

describe('criterio 57 · calcularLinea: exactitud decimal', () => {
  it('"0.10" con un extra "0.20" × 3 da "0.30" y "0.90" (nunca 0.30000000000000004)', () => {
    const producto: ProductoParaLinea = {
      precio: '0.10',
      grupos: [
        {
          id: 'g',
          minimo: 0,
          maximo: 1,
          modificadores: [{ id: 'm-extra', precioExtra: '0.20', disponible: true }],
        },
      ],
    };
    const r = calcularLinea(producto, ['m-extra'], 3);
    expect(r).toMatchObject({ valido: true, precioUnitario: '0.30', total: '0.90' });
  });

  it('"19.99" con extras "0.01" y "0.01" × 999 da "20.01" y "19989.99"', () => {
    const producto: ProductoParaLinea = {
      precio: '19.99',
      grupos: [
        {
          id: 'g',
          minimo: 0,
          maximo: 2,
          modificadores: [
            { id: 'm-a', precioExtra: '0.01', disponible: true },
            { id: 'm-b', precioExtra: '0.01', disponible: true },
          ],
        },
      ],
    };
    expect(calcularLinea(producto, ['m-a', 'm-b'], 999)).toMatchObject({
      valido: true,
      precioUnitario: '20.01',
      total: '19989.99',
    });
  });

  it('suma muchos extras con decimales que en coma flotante no son exactos', () => {
    // 0.1 + 0.2 + 0.3 en coma flotante da 0.6000000000000001.
    const producto: ProductoParaLinea = {
      precio: '0.10',
      grupos: [
        {
          id: 'g',
          minimo: 0,
          maximo: 3,
          modificadores: [
            { id: 'm-1', precioExtra: '0.10', disponible: true },
            { id: 'm-2', precioExtra: '0.20', disponible: true },
            { id: 'm-3', precioExtra: '0.30', disponible: true },
          ],
        },
      ],
    };
    expect(calcularLinea(producto, ['m-1', 'm-2', 'm-3'], 7)).toMatchObject({
      valido: true,
      precioUnitario: '0.70',
      total: '4.90',
    });
  });

  it('los extras de "0.00" y el precio con un solo decimal se devuelven con 2 decimales', () => {
    const producto: ProductoParaLinea = { precio: '10.5', grupos: [TERMINO] };
    expect(calcularLinea(producto, ['m-jugoso'], 2)).toMatchObject({
      valido: true,
      precioUnitario: '10.50',
      total: '21.00',
    });
  });
});

describe('criterio 57 · calcularLinea: precio de sucursal', () => {
  it('el mismo Lomo saltado con precio efectivo "30.00" y [3/4] × 1 da "30.00"', () => {
    const lomoDeSucursal: ProductoParaLinea = { precio: '30.00', grupos: [TERMINO, EXTRAS] };
    expect(calcularLinea(lomoDeSucursal, ['m-tres-cuartos'], 1)).toMatchObject({
      valido: true,
      precioUnitario: '30.00',
      total: '30.00',
    });
  });

  it('el precio efectivo de `precioEfectivo` es el que entra en la línea', () => {
    const precio = precioEfectivo('28.00', '30.00');
    expect(
      calcularLinea({ precio, grupos: [TERMINO, EXTRAS] }, ['m-tres-cuartos', 'm-huevo'], 2),
    ).toMatchObject({ valido: true, precioUnitario: '32.50', total: '65.00' });
  });
});

describe('criterio 57 · calcularLinea: selección inválida y sin precio', () => {
  it('una selección inválida da { valido: false } con los errores de validarSeleccion y sin precios', () => {
    const r = calcularLinea(LOMO, ['m-jugoso', 'm-tres-cuartos'], 2);
    expect(r).toEqual({
      valido: false,
      errores: [{ codigo: 'MAS_DEL_MAXIMO', grupoId: 'g-termino', maximo: 1, elegidos: 2 }],
    });
    expect(r).not.toHaveProperty('precioUnitario');
    expect(r).not.toHaveProperty('total');
    expect(r).not.toHaveProperty('modificadores');
  });

  it.each([
    ['[]', [] as string[]],
    ['[3/4, Huevo, Huevo]', ['m-tres-cuartos', 'm-huevo', 'm-huevo']],
    ['[3/4, X desconocido]', ['m-tres-cuartos', DE_OTRO_PRODUCTO]],
  ])('los errores de calcularLinea con %s son los de validarSeleccion', (_n, elegidos) => {
    const validacion = validarSeleccion(LOMO.grupos, elegidos);
    expect(validacion.valido).toBe(false);
    if (validacion.valido) return;
    expect(calcularLinea(LOMO, elegidos, 1)).toEqual({
      valido: false,
      errores: validacion.errores,
    });
  });

  it('un modificador no disponible se rechaza también en el cálculo', () => {
    const producto: ProductoParaLinea = {
      precio: '28.00',
      grupos: GRUPOS_QUESO_NO_DISPONIBLE,
    };
    expect(calcularLinea(producto, ['m-tres-cuartos', 'm-queso'], 1)).toEqual({
      valido: false,
      errores: [{ codigo: 'MODIFICADOR_NO_DISPONIBLE', modificadorId: 'm-queso' }],
    });
  });

  it('un producto con precio null (no se vende solo) da PRODUCTO_SIN_PRECIO', () => {
    const sinPrecio: ProductoParaLinea = { precio: null, grupos: [TERMINO] };
    const r = calcularLinea(sinPrecio, ['m-tres-cuartos'], 1);
    expect(r).toEqual({ valido: false, errores: [{ codigo: 'PRODUCTO_SIN_PRECIO' }] });
    expect(r).not.toHaveProperty('precioUnitario');
    expect(r).not.toHaveProperty('total');
  });

  it('un producto con precio null y sin grupos también da PRODUCTO_SIN_PRECIO', () => {
    expect(calcularLinea({ precio: null, grupos: [] }, [], 1)).toEqual({
      valido: false,
      errores: [{ codigo: 'PRODUCTO_SIN_PRECIO' }],
    });
  });
});

describe('criterio 57 · calcularLinea: cantidad', () => {
  it('acepta los extremos 1 y 999', () => {
    expect(calcularLinea(LOMO, ['m-tres-cuartos'], 1)).toMatchObject({
      valido: true,
      total: '28.00',
    });
    expect(calcularLinea(LOMO, ['m-tres-cuartos'], 999)).toMatchObject({
      valido: true,
      total: '27972.00',
    });
    expect(CANTIDAD_MAXIMA_LINEA).toBe(999);
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['1000', 1000],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['un texto "2"', '2'],
    ['null', null],
  ])('una cantidad %s lanza RangeError', (_nombre, cantidad) => {
    expect(() => calcularLinea(LOMO, ['m-tres-cuartos'], cantidad as number)).toThrow(RangeError);
  });
});

describe('criterio 57 · calcularLinea: montos inválidos', () => {
  const INVALIDOS: [string, unknown][] = [
    ['un número de JavaScript', 28],
    ['un negativo', '-1.00'],
    ['un exponente', '1e2'],
    ['un hexadecimal', '0x10'],
    ['más de 2 decimales', '28.001'],
    ['más de 8 enteros', '123456789.00'],
    ['espacios', ' 28.00'],
    ['un signo más', '+28.00'],
    ['un texto vacío', ''],
    ['texto cualquiera', 'abc'],
  ];

  it.each(INVALIDOS)('un precio de producto inválido (%s) lanza RangeError', (_n, precio) => {
    const producto = { precio: precio as string, grupos: [TERMINO] };
    expect(() => calcularLinea(producto, ['m-tres-cuartos'], 1)).toThrow(RangeError);
  });

  it.each(INVALIDOS)('un precio extra inválido (%s) lanza RangeError', (_n, extra) => {
    const producto: ProductoParaLinea = {
      precio: '28.00',
      grupos: [
        {
          id: 'g',
          minimo: 1,
          maximo: 1,
          modificadores: [{ id: 'm-malo', precioExtra: extra as string, disponible: true }],
        },
      ],
    };
    expect(() => calcularLinea(producto, ['m-malo'], 1)).toThrow(RangeError);
  });

  it('el precio extra "0.00" (admite 0) y el precio con 8 enteros son válidos', () => {
    const producto: ProductoParaLinea = { precio: '99999999.99', grupos: [TERMINO] };
    expect(calcularLinea(producto, ['m-jugoso'], 1)).toMatchObject({
      valido: true,
      precioUnitario: '99999999.99',
      total: '99999999.99',
    });
  });
});
