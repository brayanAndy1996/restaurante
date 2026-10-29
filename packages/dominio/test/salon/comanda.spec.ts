// spec: 004-salon-cocina (pruebas protegidas)
//
// P2 (reglas puras de Enviar comanda) · Criterios 74 y 75: `partesDeComanda`, `partesDeStock` y
// `partesDeStockDeEnvio` sobre la carta de ejemplo de la especificación (Lomo saltado, Combo hamburguesa, Menú
// del día y Gaseosa 1 L). Cada ejemplo de los criterios, el orden de las partes y la suma por producto.
//
// La línea se describe con la forma mínima de `LineaParaPartes` (la `lineaPreparada` de 003 la cumple tal
// cual). Los ids son textos cualesquiera: este paquete no los valida.
import { describe, expect, it } from 'vitest';
import {
  partesDeComanda,
  partesDeStock,
  partesDeStockDeEnvio,
  type ComponenteDeLinea,
  type LineaParaPartes,
  type ModificadorDeLinea,
  type OpcionesDeComanda,
} from '../../src';

// ---------------------------------------------------------------------------------------------------
// La carta de ejemplo
// ---------------------------------------------------------------------------------------------------

const COCINA = 'estacion-cocina';
const BARRA = 'estacion-barra';

type Control = ComponenteDeLinea['tipoControlStock'];
type Ligado = NonNullable<ModificadorDeLinea['productoLigado']>;

const ligado = (id: string, nombre: string, estacionId: string | null, c: Control): Ligado => ({
  id,
  nombre,
  estacionId,
  tipoControlStock: c,
});

const HUEVO_FRITO = ligado('p-huevo-frito', 'Huevo frito', COCINA, 'UNIDADES');
const PLATANO_FRITO = ligado('p-platano-frito', 'Plátano frito', COCINA, 'SIN_CONTROL');
const PLATANO_FRITO_EN_BARRA = ligado('p-platano-frito', 'Plátano frito', BARRA, 'SIN_CONTROL');
const CHICHA_MORADA = ligado('p-chicha-morada', 'Chicha morada', BARRA, 'PORCIONES');
const INCA_KOLA_500 = ligado('p-inca-kola-500', 'Inca Kola 500 ml', null, 'UNIDADES');
const CERVEZA_PILSEN = ligado('p-cerveza-pilsen', 'Cerveza Pilsen', BARRA, 'UNIDADES');
const PAPAS_FRITAS = ligado('p-papas-fritas', 'Papas fritas', COCINA, 'SIN_CONTROL');
const SOPA_DE_CASA = ligado('p-sopa-de-casa', 'Sopa de casa', COCINA, 'PORCIONES');
const AJI_DE_GALLINA = ligado('p-aji-de-gallina', 'Ají de gallina', COCINA, 'PORCIONES');
const LOMO_LIGADO = ligado('p-lomo', 'Lomo saltado', COCINA, 'SIN_CONTROL');

const mod = (nombre: string, productoLigado: Ligado | null = null): ModificadorDeLinea => ({
  nombre,
  productoLigado,
});

const JUGOSO = mod('Jugoso');
const TRES_CUARTOS = mod('3/4');
const HUEVO = mod('Huevo', HUEVO_FRITO);
const PLATANO = mod('Plátano', PLATANO_FRITO);
const PLATANO_EN_BARRA = mod('Plátano', PLATANO_FRITO_EN_BARRA);
const CHICHA = mod('Chicha', CHICHA_MORADA);
const INCA_KOLA = mod('Inca Kola', INCA_KOLA_500);
const CERVEZA = mod('Cerveza', CERVEZA_PILSEN);
const PAPAS = mod('Papas', PAPAS_FRITAS);
const ENSALADA = mod('Ensalada');
const SOPA = mod('Sopa', SOPA_DE_CASA);
const AJI = mod('Ají de gallina', AJI_DE_GALLINA);
const LOMO_COMO_SEGUNDO = mod('Lomo saltado', LOMO_LIGADO);

const HAMBURGUESA: ComponenteDeLinea = {
  productoId: 'p-hamburguesa',
  nombre: 'Hamburguesa clásica',
  cantidad: 1,
  estacionId: COCINA,
  tipoControlStock: 'PORCIONES',
};
const REFRESCO: ComponenteDeLinea = {
  productoId: 'p-refresco',
  nombre: 'Refresco del día',
  cantidad: 1,
  estacionId: BARRA,
  tipoControlStock: 'PORCIONES',
};

function lomo(
  modificadores: ModificadorDeLinea[],
  cantidad: number,
  estacionId: string | null = COCINA,
): LineaParaPartes {
  return {
    productoId: 'p-lomo',
    nombre: 'Lomo saltado',
    tipo: 'SIMPLE',
    cantidad,
    estacionId,
    tipoControlStock: 'SIN_CONTROL',
    modificadores,
    componentes: [],
  };
}

function combo(
  modificadores: ModificadorDeLinea[],
  cantidad: number,
  componentes: ComponenteDeLinea[] = [HAMBURGUESA],
): LineaParaPartes {
  return {
    productoId: 'p-combo',
    nombre: 'Combo hamburguesa',
    tipo: 'COMBO',
    cantidad,
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
    modificadores,
    componentes,
  };
}

function menu(modificadores: ModificadorDeLinea[], cantidad: number): LineaParaPartes {
  return {
    productoId: 'p-menu',
    nombre: 'Menú del día',
    tipo: 'MENU_DEL_DIA',
    cantidad,
    estacionId: null,
    tipoControlStock: 'PORCIONES',
    modificadores,
    componentes: [REFRESCO],
  };
}

function gaseosa(cantidad: number): LineaParaPartes {
  return {
    productoId: 'p-gaseosa',
    nombre: 'Gaseosa 1 L',
    tipo: 'SIMPLE',
    cantidad,
    estacionId: null,
    tipoControlStock: 'UNIDADES',
    modificadores: [],
    componentes: [],
  };
}

const NORMAL: OpcionesDeComanda = { tiempo: 1, paraLlevar: false };

// ---------------------------------------------------------------------------------------------------
// Criterio 74 · partesDeComanda
// ---------------------------------------------------------------------------------------------------

describe('criterio 74 · partesDeComanda: los ejemplos de la especificación', () => {
  it('Lomo saltado [3/4, Huevo] × 2: una parte PRODUCTO en Cocina (Huevo frito es de Cocina: no hay parte aparte)', () => {
    expect(partesDeComanda(lomo([TRES_CUARTOS, HUEVO], 2), NORMAL)).toEqual([
      {
        estacionId: COCINA,
        rol: 'PRODUCTO',
        productoId: 'p-lomo',
        nombre: 'Lomo saltado',
        cantidad: 2,
        modificadores: ['3/4', 'Huevo'],
        contexto: null,
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
    ]);
  });

  it('el mismo con Plátano frito en Barra y [Jugoso, Plátano]: Cocina PRODUCTO y Barra LIGADO "Plátano frito" × 2 (contexto "Lomo saltado")', () => {
    expect(partesDeComanda(lomo([JUGOSO, PLATANO_EN_BARRA], 2), NORMAL)).toEqual([
      {
        estacionId: COCINA,
        rol: 'PRODUCTO',
        productoId: 'p-lomo',
        nombre: 'Lomo saltado',
        cantidad: 2,
        modificadores: ['Jugoso', 'Plátano'],
        contexto: null,
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
      {
        estacionId: BARRA,
        rol: 'LIGADO',
        productoId: 'p-platano-frito',
        nombre: 'Plátano frito',
        cantidad: 2,
        modificadores: [],
        contexto: 'Lomo saltado',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
    ]);
  });

  it('Combo hamburguesa [Cerveza, Ensalada] × 3: Cocina COMPONENTE "Hamburguesa clásica" × 3 ["Ensalada"] y Barra LIGADO "Cerveza Pilsen" × 3', () => {
    expect(partesDeComanda(combo([CERVEZA, ENSALADA], 3), NORMAL)).toEqual([
      {
        estacionId: COCINA,
        rol: 'COMPONENTE',
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 3,
        modificadores: ['Ensalada'],
        contexto: 'Combo hamburguesa',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
      {
        estacionId: BARRA,
        rol: 'LIGADO',
        productoId: 'p-cerveza-pilsen',
        nombre: 'Cerveza Pilsen',
        cantidad: 3,
        modificadores: [],
        contexto: 'Combo hamburguesa',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
    ]);
  });

  it('Combo hamburguesa [Inca Kola, Papas] × 1: Cocina COMPONENTE "Hamburguesa clásica" × 1 [] y Cocina LIGADO "Papas fritas" × 1 (Inca Kola no tiene estación)', () => {
    expect(partesDeComanda(combo([INCA_KOLA, PAPAS], 1), NORMAL)).toEqual([
      {
        estacionId: COCINA,
        rol: 'COMPONENTE',
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 1,
        modificadores: [],
        contexto: 'Combo hamburguesa',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
      {
        estacionId: COCINA,
        rol: 'LIGADO',
        productoId: 'p-papas-fritas',
        nombre: 'Papas fritas',
        cantidad: 1,
        modificadores: [],
        contexto: 'Combo hamburguesa',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
    ]);
  });

  it('Menú del día [Sopa, Ají de gallina] × 2: Barra COMPONENTE "Refresco del día" × 2, Cocina LIGADO "Sopa de casa" × 2 y Cocina LIGADO "Ají de gallina" × 2', () => {
    expect(partesDeComanda(menu([SOPA, AJI], 2), NORMAL)).toEqual([
      {
        estacionId: BARRA,
        rol: 'COMPONENTE',
        productoId: 'p-refresco',
        nombre: 'Refresco del día',
        cantidad: 2,
        modificadores: [],
        contexto: 'Menú del día',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
      {
        estacionId: COCINA,
        rol: 'LIGADO',
        productoId: 'p-sopa-de-casa',
        nombre: 'Sopa de casa',
        cantidad: 2,
        modificadores: [],
        contexto: 'Menú del día',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
      {
        estacionId: COCINA,
        rol: 'LIGADO',
        productoId: 'p-aji-de-gallina',
        nombre: 'Ají de gallina',
        cantidad: 2,
        modificadores: [],
        contexto: 'Menú del día',
        observacion: null,
        tiempo: 1,
        paraLlevar: false,
      },
    ]);
  });

  it('Gaseosa 1 L × 1 (sin estación): ninguna parte', () => {
    expect(partesDeComanda(gaseosa(1), NORMAL)).toEqual([]);
  });
});

describe('criterio 74 · partesDeComanda: producto simple', () => {
  it('con estación E, un ligado de la misma estación no genera una parte aparte', () => {
    const partes = partesDeComanda(lomo([TRES_CUARTOS, HUEVO, PLATANO], 1), NORMAL);
    expect(partes).toHaveLength(1);
    expect(partes[0]).toMatchObject({ rol: 'PRODUCTO', estacionId: COCINA });
  });

  it('con estación E, cada ligado de otra estación (no nula) genera una parte LIGADO, en el orden de los modificadores', () => {
    const partes = partesDeComanda(lomo([CHICHA, HUEVO, CERVEZA], 3), NORMAL);
    expect(partes.map((p) => [p.estacionId, p.rol, p.nombre, p.cantidad])).toEqual([
      [COCINA, 'PRODUCTO', 'Lomo saltado', 3],
      [BARRA, 'LIGADO', 'Chicha morada', 3],
      [BARRA, 'LIGADO', 'Cerveza Pilsen', 3],
    ]);
    // La parte PRODUCTO lleva todos los modificadores elegidos; las LIGADO, ninguno y el producto como contexto.
    expect(partes[0]!.modificadores).toEqual(['Chicha', 'Huevo', 'Cerveza']);
    expect(partes[1]).toMatchObject({ modificadores: [], contexto: 'Lomo saltado' });
    expect(partes[2]).toMatchObject({ modificadores: [], contexto: 'Lomo saltado' });
  });

  it('un ligado sin estación no genera parte', () => {
    const partes = partesDeComanda(lomo([INCA_KOLA], 1), NORMAL);
    expect(partes.map((p) => p.rol)).toEqual(['PRODUCTO']);
  });

  it('sin estación: solo las partes LIGADO de sus productos ligados con estación', () => {
    const sinEstacion = lomo([CHICHA, INCA_KOLA, HUEVO], 2, null);
    const partes = partesDeComanda(sinEstacion, NORMAL);
    expect(partes.map((p) => [p.estacionId, p.rol, p.nombre, p.cantidad, p.contexto])).toEqual([
      [BARRA, 'LIGADO', 'Chicha morada', 2, 'Lomo saltado'],
      [COCINA, 'LIGADO', 'Huevo frito', 2, 'Lomo saltado'],
    ]);
  });

  it('sin estación y sin ligados con estación: ninguna parte', () => {
    expect(partesDeComanda(lomo([INCA_KOLA, ENSALADA], 1, null), NORMAL)).toEqual([]);
  });
});

describe('criterio 74 · partesDeComanda: combo y menú del día', () => {
  it('cada componente con estación es una parte COMPONENTE con la cantidad del componente × la de la línea', () => {
    const doble: ComponenteDeLinea = { ...HAMBURGUESA, cantidad: 2 };
    const partes = partesDeComanda(combo([ENSALADA], 3, [doble, REFRESCO]), NORMAL);
    expect(partes.map((p) => [p.estacionId, p.rol, p.nombre, p.cantidad, p.modificadores])).toEqual(
      [
        [COCINA, 'COMPONENTE', 'Hamburguesa clásica', 6, ['Ensalada']],
        [BARRA, 'COMPONENTE', 'Refresco del día', 3, ['Ensalada']],
      ],
    );
  });

  it('un componente sin estación no genera parte', () => {
    const sinEstacion: ComponenteDeLinea = { ...HAMBURGUESA, estacionId: null };
    const partes = partesDeComanda(combo([], 1, [sinEstacion, REFRESCO]), NORMAL);
    expect(partes.map((p) => p.nombre)).toEqual(['Refresco del día']);
  });

  it('los componentes van antes que los ligados, aunque el ligado se haya elegido primero', () => {
    const partes = partesDeComanda(combo([CERVEZA, PAPAS], 1), NORMAL);
    expect(partes.map((p) => [p.rol, p.nombre])).toEqual([
      ['COMPONENTE', 'Hamburguesa clásica'],
      ['LIGADO', 'Cerveza Pilsen'],
      ['LIGADO', 'Papas fritas'],
    ]);
  });

  it('con varios componentes, los modificadores sin ligado acompañan a cada uno', () => {
    const partes = partesDeComanda(combo([ENSALADA, CHICHA], 1, [HAMBURGUESA, REFRESCO]), NORMAL);
    const componentes = partes.filter((p) => p.rol === 'COMPONENTE');
    expect(componentes.map((p) => p.modificadores)).toEqual([['Ensalada'], ['Ensalada']]);
    const ligados = partes.filter((p) => p.rol === 'LIGADO');
    expect(ligados.map((p) => [p.nombre, p.modificadores])).toEqual([['Chicha morada', []]]);
  });

  it('sin partes COMPONENTE, los modificadores sin ligado van en cada parte LIGADO', () => {
    const sinEstacion: ComponenteDeLinea = { ...HAMBURGUESA, estacionId: null };
    const partes = partesDeComanda(combo([CERVEZA, ENSALADA, PAPAS], 2, [sinEstacion]), NORMAL);
    expect(partes.map((p) => [p.estacionId, p.rol, p.nombre, p.cantidad, p.modificadores])).toEqual(
      [
        [BARRA, 'LIGADO', 'Cerveza Pilsen', 2, ['Ensalada']],
        [COCINA, 'LIGADO', 'Papas fritas', 2, ['Ensalada']],
      ],
    );
    expect(partes.every((p) => p.contexto === 'Combo hamburguesa')).toBe(true);
  });

  it('un combo cuyas partes no tienen estación no genera ninguna', () => {
    const sinEstacion: ComponenteDeLinea = { ...HAMBURGUESA, estacionId: null };
    expect(partesDeComanda(combo([INCA_KOLA, ENSALADA], 1, [sinEstacion]), NORMAL)).toEqual([]);
  });

  it('el menú del día no genera parte para el producto mismo', () => {
    const partes = partesDeComanda(menu([SOPA, LOMO_COMO_SEGUNDO], 1), NORMAL);
    expect(partes.map((p) => p.nombre)).toEqual([
      'Refresco del día',
      'Sopa de casa',
      'Lomo saltado',
    ]);
    expect(partes.every((p) => p.productoId !== 'p-menu')).toBe(true);
  });
});

describe('criterio 74 · partesDeComanda: observación, tiempo y para llevar', () => {
  const OPCIONES: OpcionesDeComanda = { observacion: 'sin cebolla', tiempo: 2, paraLlevar: true };

  it('se copian en todas las partes', () => {
    const partes = partesDeComanda(combo([CERVEZA, ENSALADA], 3), OPCIONES);
    expect(partes).toHaveLength(2);
    for (const p of partes) {
      expect(p).toMatchObject({ observacion: 'sin cebolla', tiempo: 2, paraLlevar: true });
    }
  });

  it('también en las partes LIGADO de un producto simple', () => {
    const partes = partesDeComanda(lomo([CHICHA], 1), OPCIONES);
    expect(partes).toHaveLength(2);
    for (const p of partes) {
      expect(p).toMatchObject({ observacion: 'sin cebolla', tiempo: 2, paraLlevar: true });
    }
  });

  it('sin observación, las partes la llevan en null', () => {
    for (const opciones of [
      NORMAL,
      { ...NORMAL, observacion: null },
      { ...NORMAL, observacion: undefined },
    ]) {
      const partes = partesDeComanda(lomo([], 1), opciones);
      expect(partes[0]!.observacion).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Criterio 75 · partesDeStock y partesDeStockDeEnvio
// ---------------------------------------------------------------------------------------------------

describe('criterio 75 · partesDeStock: los ejemplos de la especificación', () => {
  it('Lomo saltado [3/4, Huevo] × 2 → [Huevo frito 2 UNIDADES]', () => {
    expect(partesDeStock(lomo([TRES_CUARTOS, HUEVO], 2))).toEqual([
      {
        productoId: 'p-huevo-frito',
        nombre: 'Huevo frito',
        cantidad: 2,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });

  it('Combo hamburguesa [Cerveza, Ensalada] × 3 → [Hamburguesa clásica 3 PORCIONES, Cerveza Pilsen 3 UNIDADES]', () => {
    expect(partesDeStock(combo([CERVEZA, ENSALADA], 3))).toEqual([
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 3,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-cerveza-pilsen',
        nombre: 'Cerveza Pilsen',
        cantidad: 3,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });

  it('Menú del día [Sopa, Ají de gallina] × 2 → [Menú del día 2, Refresco del día 2, Sopa de casa 2, Ají de gallina 2] (todos PORCIONES)', () => {
    expect(partesDeStock(menu([SOPA, AJI], 2))).toEqual([
      { productoId: 'p-menu', nombre: 'Menú del día', cantidad: 2, tipoControlStock: 'PORCIONES' },
      {
        productoId: 'p-refresco',
        nombre: 'Refresco del día',
        cantidad: 2,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-sopa-de-casa',
        nombre: 'Sopa de casa',
        cantidad: 2,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-aji-de-gallina',
        nombre: 'Ají de gallina',
        cantidad: 2,
        tipoControlStock: 'PORCIONES',
      },
    ]);
  });

  it('Combo hamburguesa [Cerveza, Ensalada] × 3 con cantidad 1 → [Hamburguesa clásica 1, Cerveza Pilsen 1]', () => {
    expect(partesDeStock(combo([CERVEZA, ENSALADA], 3), 1)).toEqual([
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 1,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-cerveza-pilsen',
        nombre: 'Cerveza Pilsen',
        cantidad: 1,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });
});

describe('criterio 75 · partesDeStock: reglas', () => {
  it('el producto mismo cuenta si tiene control de stock', () => {
    expect(partesDeStock(gaseosa(4))).toEqual([
      { productoId: 'p-gaseosa', nombre: 'Gaseosa 1 L', cantidad: 4, tipoControlStock: 'UNIDADES' },
    ]);
  });

  it('omite lo que no tiene control de stock (SIN_CONTROL): el producto, los ligados y los componentes', () => {
    // Lomo (SIN_CONTROL) con Plátano frito (SIN_CONTROL) y sin otro ligado con control.
    expect(partesDeStock(lomo([TRES_CUARTOS, PLATANO], 5))).toEqual([]);
    const sinControl: ComponenteDeLinea = { ...HAMBURGUESA, tipoControlStock: 'SIN_CONTROL' };
    expect(partesDeStock(combo([PAPAS], 2, [sinControl]))).toEqual([]);
  });

  it('el componente cuenta su cantidad × la de la línea, y la cantidad dada reemplaza la de la línea', () => {
    const doble: ComponenteDeLinea = { ...HAMBURGUESA, cantidad: 2 };
    expect(partesDeStock(combo([], 3, [doble]))).toEqual([
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 6,
        tipoControlStock: 'PORCIONES',
      },
    ]);
    expect(partesDeStock(combo([], 3, [doble]), 2)).toEqual([
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 4,
        tipoControlStock: 'PORCIONES',
      },
    ]);
  });

  it('suma por producto cuando un mismo producto sale de varios lugares', () => {
    const cervezaComoComponente: ComponenteDeLinea = {
      productoId: 'p-cerveza-pilsen',
      nombre: 'Cerveza Pilsen',
      cantidad: 2,
      estacionId: BARRA,
      tipoControlStock: 'UNIDADES',
    };
    expect(partesDeStock(combo([CERVEZA], 3, [cervezaComoComponente]))).toEqual([
      {
        productoId: 'p-cerveza-pilsen',
        nombre: 'Cerveza Pilsen',
        cantidad: 9,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });

  it('acepta la cantidad igual a la de la línea', () => {
    expect(partesDeStock(gaseosa(3), 3)).toEqual([
      { productoId: 'p-gaseosa', nombre: 'Gaseosa 1 L', cantidad: 3, tipoControlStock: 'UNIDADES' },
    ]);
  });

  it.each([
    ['0', 0],
    ['negativa', -1],
    ['decimal', 1.5],
    ['mayor que la de la línea', 4],
  ])('la cantidad %s lanza RangeError', (_nombre, cantidad) => {
    expect(() => partesDeStock(combo([CERVEZA, ENSALADA], 3), cantidad)).toThrow(RangeError);
  });
});

describe('criterio 75 · partesDeStockDeEnvio', () => {
  it('Combo [Inca Kola, Papas] × 1 y Combo [Inca Kola, Ensalada] × 2 en un envío → [Hamburguesa clásica 3, Inca Kola 500 ml 3]', () => {
    expect(
      partesDeStockDeEnvio([combo([INCA_KOLA, PAPAS], 1), combo([INCA_KOLA, ENSALADA], 2)]),
    ).toEqual([
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 3,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-inca-kola-500',
        nombre: 'Inca Kola 500 ml',
        cantidad: 3,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });

  it('suma por producto entre líneas distintas, en el orden en que cada producto aparece', () => {
    const envio = [
      lomo([TRES_CUARTOS, HUEVO], 2),
      combo([CERVEZA, ENSALADA], 3),
      gaseosa(2),
      lomo([JUGOSO, HUEVO], 1),
    ];
    expect(partesDeStockDeEnvio(envio)).toEqual([
      {
        productoId: 'p-huevo-frito',
        nombre: 'Huevo frito',
        cantidad: 3,
        tipoControlStock: 'UNIDADES',
      },
      {
        productoId: 'p-hamburguesa',
        nombre: 'Hamburguesa clásica',
        cantidad: 3,
        tipoControlStock: 'PORCIONES',
      },
      {
        productoId: 'p-cerveza-pilsen',
        nombre: 'Cerveza Pilsen',
        cantidad: 3,
        tipoControlStock: 'UNIDADES',
      },
      { productoId: 'p-gaseosa', nombre: 'Gaseosa 1 L', cantidad: 2, tipoControlStock: 'UNIDADES' },
    ]);
  });

  it('un envío sin nada con control de stock da una lista vacía', () => {
    expect(partesDeStockDeEnvio([lomo([JUGOSO], 1), combo([PAPAS], 1, [])])).toEqual([]);
    expect(partesDeStockDeEnvio([])).toEqual([]);
  });
});
