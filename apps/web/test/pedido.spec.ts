import { describe, expect, it } from 'vitest';
import { esperaEnPalabras, rechazosDeLineas } from '../lib/llamados';
import {
  PEDIDO_VACIO,
  cuerpoDelPedido,
  guardarPedido,
  leerPedido,
  mismoCuerpo,
  nuevoId,
  quitarLinea,
  type LineaPedido,
  type PedidoGuardado,
  type ProductoMesa,
} from '../lib/pedido';
import { agregarLinea, problemaDeLinea, totalDelPedido } from '../lib/reglas';

// Las reglas del pedido del modo mesa (criterios 84 y 87) sin pantalla: armar, comparar, guardar y decir los errores.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LOMO: ProductoMesa = {
  id: id(1),
  nombre: 'Lomo saltado',
  descripcion: null,
  fotoUrl: null,
  precio: '36.00',
  grupos: [
    {
      id: id(10),
      nombre: 'Extras',
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      obligatorio: false,
      modificadores: [
        { id: id(20), nombre: 'Huevo frito', precioExtra: '3.00' },
        { id: id(21), nombre: 'Arroz', precioExtra: '4.00' },
      ],
    },
  ],
};
const productos = new Map([[LOMO.id, LOMO]]);
const linea = (extra: Partial<LineaPedido> = {}): Omit<LineaPedido, 'clave'> => ({
  productoId: LOMO.id,
  modificadorIds: [],
  cantidad: 1,
  observacion: '',
  ...extra,
});

function resultado(r: ReturnType<typeof agregarLinea>): PedidoGuardado {
  if (!('pedido' in r)) throw new Error('El pedido está lleno');
  return r.pedido;
}

describe('agregarLinea', () => {
  it('suma las cantidades de una línea igual, aunque las opciones vengan en otro orden', () => {
    let p = resultado(agregarLinea(PEDIDO_VACIO, linea({ modificadorIds: [id(20), id(21)] })));
    p = resultado(agregarLinea(p, linea({ modificadorIds: [id(21), id(20)], cantidad: 2 })));
    expect(p.lineas).toHaveLength(1);
    expect(p.lineas[0]!.cantidad).toBe(3);
  });

  it('otras opciones o otras indicaciones son otra línea', () => {
    let p = resultado(agregarLinea(PEDIDO_VACIO, linea()));
    p = resultado(agregarLinea(p, linea({ modificadorIds: [id(20)] })));
    p = resultado(agregarLinea(p, linea({ observacion: 'sin cebolla' })));
    expect(p.lineas).toHaveLength(3);
  });

  it('no pasa de 20 unidades en una línea: lo que sobra es otra línea', () => {
    let p = resultado(agregarLinea(PEDIDO_VACIO, linea({ cantidad: 15 })));
    p = resultado(agregarLinea(p, linea({ cantidad: 10 })));
    expect(p.lineas.map((l) => l.cantidad)).toEqual([15, 10]);
  });

  it('no pasa de 30 líneas distintas', () => {
    let p = PEDIDO_VACIO;
    for (let i = 0; i < 30; i += 1) p = resultado(agregarLinea(p, linea({ observacion: `n${i}` })));
    expect(agregarLinea(p, linea({ observacion: 'otra' }))).toEqual({ error: 'LLENO' });
  });
});

describe('cuerpo del envío y reintento', () => {
  it('quita los espacios, omite lo vacío y no lleva claves locales', () => {
    const p = resultado(agregarLinea(PEDIDO_VACIO, linea({ observacion: '  sin ají  ' })));
    const cuerpo = cuerpoDelPedido({ ...p, nota: '   ' });
    expect(cuerpo).toEqual({
      tipo: 'PEDIDO',
      lineas: [{ productoId: LOMO.id, modificadorIds: [], cantidad: 1, observacion: 'sin ají' }],
    });
  });

  it('el mismo pedido conserva el id y uno distinto lo renueva', () => {
    const p = resultado(agregarLinea(PEDIDO_VACIO, linea()));
    const envio = { id: nuevoId(), ...cuerpoDelPedido(p) } as Parameters<typeof mismoCuerpo>[0];
    expect(mismoCuerpo(envio, cuerpoDelPedido(p))).toBe(true);
    expect(mismoCuerpo(envio, cuerpoDelPedido({ ...p, nota: 'otra' }))).toBe(false);
    expect(mismoCuerpo(envio, { tipo: 'LLAMAR_MOZO' })).toBe(false);
  });

  it('nuevoId da un UUID v4 y no se repite', () => {
    const a = nuevoId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevoId()).not.toBe(a);
  });
});

describe('almacenamiento por código', () => {
  it('guarda y lee el pedido de cada mesa por separado y borra el vacío', () => {
    const p = resultado(agregarLinea(PEDIDO_VACIO, linea()));
    guardarPedido('mesa-a', p);
    expect(leerPedido('mesa-a').lineas).toHaveLength(1);
    expect(leerPedido('mesa-b')).toEqual(PEDIDO_VACIO);
    guardarPedido('mesa-a', quitarLinea(p, p.lineas[0]!.clave));
    expect(sessionStorage.getItem('pedido:mesa-a')).toBeNull();
  });

  it('un dato roto en el almacenamiento no rompe la página', () => {
    sessionStorage.setItem('pedido:x', '{no es json');
    expect(leerPedido('x')).toEqual(PEDIDO_VACIO);
    sessionStorage.setItem('pedido:x', JSON.stringify({ lineas: [{ clave: 1 }, 'x'] }));
    expect(leerPedido('x').lineas).toEqual([]);
  });
});

describe('problemaDeLinea', () => {
  const base = { clave: 'c', ...linea({ modificadorIds: [id(20)] }) };
  const disponibles = new Map([[LOMO.id, new Set<string>()]]);

  it('una línea bien armada no tiene problema', () => {
    expect(problemaDeLinea(base, LOMO, disponibles, undefined)).toBeNull();
    expect(problemaDeLinea(base, LOMO, null, undefined)).toBeNull();
  });

  it('un plato que ya no está en la carta ya no se vende', () => {
    expect(problemaDeLinea(base, undefined, disponibles, undefined)).toBe('Ya no se vende');
  });

  it('un plato que salió de la disponibilidad se agotó', () => {
    expect(problemaDeLinea(base, LOMO, new Map(), undefined)).toBe('Se agotó');
  });

  it('una opción que se agotó dice cuál', () => {
    const sin = new Map([[LOMO.id, new Set([id(20)])]]);
    expect(problemaDeLinea(base, LOMO, sin, undefined)).toBe('Huevo frito ya no está disponible');
  });

  it('lo que rechazó la API se conserva hasta editar la línea', () => {
    expect(problemaDeLinea(base, LOMO, disponibles, 'Se agotó')).toBe('Se agotó');
  });

  it('una selección que ya no vale pide editar el plato', () => {
    const tres = { ...base, modificadorIds: [id(20), id(21), id(99)] };
    expect(problemaDeLinea(tres, LOMO, disponibles, undefined)).toMatch(/Edítalo/);
  });
});

describe('totalDelPedido', () => {
  it('suma con totalOrden solo lo que se puede enviar', () => {
    const lineas = [
      { clave: 'a', ...linea({ modificadorIds: [id(20)], cantidad: 2 }) },
      { clave: 'b', ...linea({ cantidad: 1 }) },
    ];
    expect(totalDelPedido(lineas, productos, () => false)).toBe('114.00');
    expect(totalDelPedido(lineas, productos, (l) => l.clave === 'b')).toBe('78.00');
    expect(totalDelPedido([], productos, () => false)).toBe('0.00');
  });
});

describe('lo que se le dice al cliente', () => {
  it('la espera se dice como una persona', () => {
    expect(esperaEnPalabras(1)).toBe('1 segundo');
    expect(esperaEnPalabras(45)).toBe('45 segundos');
    expect(esperaEnPalabras(60)).toBe('1 minuto');
    expect(esperaEnPalabras(61)).toBe('2 minutos');
    expect(esperaEnPalabras(null)).toBe('un momento');
  });

  it('los 422 por línea se traducen sin mostrar códigos', () => {
    const cuerpo = {
      campos: [
        { campo: 'lineas.0', mensaje: 'AGOTADO' },
        { campo: 'lineas.2', mensaje: `MODIFICADOR_NO_DISPONIBLE: ${id(20)}` },
        { campo: 'lineas.3', mensaje: 'PRODUCTO_NO_EXISTE' },
        { campo: 'lineas.4', mensaje: 'MENOS_DEL_MINIMO (grupos.x)' },
        { campo: 'otro', mensaje: 'AGOTADO' },
      ],
    };
    const r = rechazosDeLineas(cuerpo, (opcion) => (opcion === id(20) ? 'Huevo frito' : undefined));
    expect([...r]).toEqual([
      [0, 'Se agotó'],
      [2, 'Huevo frito ya no está disponible'],
      [3, 'Ya no se vende'],
      [4, 'Cambiaron las opciones de este plato. Edítalo'],
    ]);
  });
});
