import {
  productoCrearEntradaSchema,
  productoModificarEntradaSchema,
  type MenuDelDiaRespuesta,
  type ProductoRespuesta,
  type SeQuita,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { diaConFecha, montoEsCero, sumarDiasAFecha } from '../src/lib/formato';
import {
  SECCIONES_HABILITADAS,
  seccionDeDisponibilidadPedida,
} from '../src/modulos/disponibilidad/disponibilidad';
import {
  copiarDeOtroDia,
  elegidasDe,
  estaSinArmar,
  hayCambiosDeMenu,
  opcionesQueFaltan,
  reglaDeTiempo,
  textoDeFaltantes,
} from '../src/modulos/disponibilidad/menu-del-dia';
import {
  AVISO_MENU_SIN_ARMAR,
  SIN_ESTACION,
  avisosDeCambioDeTipo,
  cambiarDeTipo,
  cambiosDelProducto,
  entradaDeCreacion,
  formularioDeProducto,
  formularioVacio,
  frasesDeSeQuita,
  usosDeProducto,
  validarProducto,
  type EstadoDelProducto,
} from '../src/modulos/carta/producto-form';
import { tipoEnFrase } from '../src/modulos/carta/tipos';

const FAMILIA = 'f0000000-0000-4000-8000-000000000001';
const ESTACION = 'e0000000-0000-4000-8000-000000000001';
const HAMBURGUESA = 'a0000000-0000-4000-8000-0000000000a1';
const PAPAS = 'a0000000-0000-4000-8000-0000000000a2';
const BEBIDA = 'b0000000-0000-4000-8000-000000000001';
const ENTRADA = 'b0000000-0000-4000-8000-000000000002';

function producto(parcial: Partial<ProductoRespuesta> = {}): ProductoRespuesta {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    familiaId: FAMILIA,
    precio: '28.00',
    seVendeSolo: true,
    estacionId: ESTACION,
    tipoControlStock: 'PORCIONES',
    fotoUrl: null,
    activo: true,
    orden: 1,
    descripcion: null,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    grupos: [],
    componentes: [],
    usadoEn: { combos: [], modificadores: [] },
    creadoEn: '2026-10-29T10:00:00.000Z',
    actualizadoEn: '2026-10-29T10:00:00.000Z',
    ...parcial,
  };
}

const combo = (parcial: Partial<ProductoRespuesta> = {}) =>
  producto({
    tipo: 'COMBO',
    nombre: 'Combo hamburguesa',
    precio: '22.90',
    estacionId: null,
    componentes: [{ productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 1 }],
    grupos: [{ id: BEBIDA, nombre: 'Bebida' }],
    ...parcial,
  });

const menu = (parcial: Partial<ProductoRespuesta> = {}) =>
  producto({
    tipo: 'MENU_DEL_DIA',
    nombre: 'Menú criollo',
    precio: '12.00',
    estacionId: null,
    grupos: [{ id: ENTRADA, nombre: 'Entrada' }],
    ...parcial,
  });

function lleno(parcial: Partial<EstadoDelProducto> = {}): EstadoDelProducto {
  return {
    ...formularioVacio([]),
    nombre: 'Combo hamburguesa',
    familiaId: FAMILIA,
    precio: '22.90',
    tipoControlStock: 'UNIDADES',
    ...parcial,
  };
}

describe('validar un combo o un menú del día', () => {
  it('un combo sin componentes ni grupos pide agregar algo', () => {
    const errores = validarProducto(lleno({ tipo: 'COMBO' }));
    expect(errores.componentes).toBe('Agrega al menos un componente o un grupo de opciones');
  });

  it('un combo con solo un grupo o solo un componente es válido', () => {
    const grupo = { id: BEBIDA, nombre: 'Bebida' };
    const componente = { productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 1 };
    expect(validarProducto(lleno({ tipo: 'COMBO', grupos: [grupo] }))).toEqual({});
    expect(validarProducto(lleno({ tipo: 'COMBO', componentes: [componente] }))).toEqual({});
  });

  it('un menú del día necesita al menos un grupo, aunque tenga componentes', () => {
    const componente = { productoId: PAPAS, nombre: 'Refresco', cantidad: 1 };
    const errores = validarProducto(lleno({ tipo: 'MENU_DEL_DIA', componentes: [componente] }));
    expect(errores.gruposModificadores).toMatch(/al menos un grupo/);
    expect(errores.componentes).toBeUndefined();
  });

  it('un combo siempre lleva precio, aunque "se vende solo" haya quedado apagado en el formulario', () => {
    const grupo = { id: BEBIDA, nombre: 'Bebida' };
    const errores = validarProducto(
      lleno({ tipo: 'COMBO', grupos: [grupo], seVendeSolo: false, precio: '' }),
    );
    expect(errores.precio).toBe('Escribe el precio con IGV');
  });

  it('un combo no necesita estación', () => {
    const grupo = { id: BEBIDA, nombre: 'Bebida' };
    expect(validarProducto(lleno({ tipo: 'COMBO', grupos: [grupo], estacionId: '' }))).toEqual({});
  });

  it('más de 20 componentes se rechazan con la salida', () => {
    const muchos = Array.from({ length: 21 }, (_, i) => ({
      productoId: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      nombre: `Producto ${i}`,
      cantidad: 1,
    }));
    expect(validarProducto(lleno({ tipo: 'COMBO', componentes: muchos })).componentes).toMatch(
      /hasta 20 componentes/,
    );
  });
});

describe('entrada de creación de un combo y de un menú', () => {
  it('un combo manda tipo, precio, componentes y grupos, sin estación, y el contrato la acepta', () => {
    const entrada = entradaDeCreacion(
      lleno({
        tipo: 'COMBO',
        estacionId: ESTACION,
        seVendeSolo: false,
        componentes: [{ productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 2 }],
        grupos: [{ id: BEBIDA, nombre: 'Bebida' }],
      }),
    );
    expect(entrada).toMatchObject({
      tipo: 'COMBO',
      seVendeSolo: true,
      precio: '22.90',
      componentes: [{ productoId: HAMBURGUESA, cantidad: 2 }],
      gruposModificadores: [BEBIDA],
    });
    expect(entrada).not.toHaveProperty('estacionId');
    expect(productoCrearEntradaSchema.safeParse(entrada).success).toBe(true);
  });

  it('un menú del día manda sus grupos y el contrato la acepta', () => {
    const entrada = entradaDeCreacion(
      lleno({ tipo: 'MENU_DEL_DIA', precio: '12', grupos: [{ id: ENTRADA, nombre: 'Entrada' }] }),
    );
    expect(entrada.tipo).toBe('MENU_DEL_DIA');
    expect(entrada.precio).toBe('12.00');
    expect(productoCrearEntradaSchema.safeParse(entrada).success).toBe(true);
  });

  it('un simple no manda componentes aunque el formulario los conserve', () => {
    const entrada = entradaDeCreacion(
      lleno({
        tipo: 'SIMPLE',
        estacionId: ESTACION,
        componentes: [{ productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 1 }],
      }),
    );
    expect(entrada).not.toHaveProperty('componentes');
  });
});

describe('cambios al editar: cambio de tipo', () => {
  it('un tipo igual al guardado no es un cambio de tipo', () => {
    const original = combo();
    expect(cambiosDelProducto(original, formularioDeProducto(original))).toEqual({});
  });

  it('simple a combo manda el tipo y no manda la estación', () => {
    const original = producto();
    const estado = { ...formularioDeProducto(original), tipo: 'COMBO' as const };
    const cambios = cambiosDelProducto(original, {
      ...estado,
      grupos: [{ id: BEBIDA, nombre: 'Bebida' }],
    });
    expect(cambios).toEqual({ tipo: 'COMBO', gruposModificadores: [BEBIDA] });
    expect(productoModificarEntradaSchema.safeParse(cambios).success).toBe(true);
  });

  it('un simple que no se vendía solo, al pasar a combo, manda "se vende solo" y el precio', () => {
    const original = producto({ seVendeSolo: false, precio: null, estacionId: null });
    const cambios = cambiosDelProducto(original, {
      ...formularioDeProducto(original),
      tipo: 'COMBO',
      precio: '22.9',
      grupos: [{ id: BEBIDA, nombre: 'Bebida' }],
    });
    expect(cambios).toMatchObject({ tipo: 'COMBO', seVendeSolo: true, precio: '22.90' });
  });

  it('combo a simple manda siempre la estación, aunque sea "Ninguna" (null)', () => {
    const original = combo();
    const ninguna = cambiosDelProducto(original, {
      ...formularioDeProducto(original),
      tipo: 'SIMPLE',
      estacionId: SIN_ESTACION,
    });
    expect(ninguna).toEqual({ tipo: 'SIMPLE', estacionId: null });
    const cocina = cambiosDelProducto(original, {
      ...formularioDeProducto(original),
      tipo: 'SIMPLE',
      estacionId: ESTACION,
    });
    expect(cocina).toEqual({ tipo: 'SIMPLE', estacionId: ESTACION });
    expect(productoModificarEntradaSchema.safeParse(cocina).success).toBe(true);
  });

  it('combo a simple no manda los componentes: la API los quita', () => {
    const original = combo();
    const cambios = cambiosDelProducto(original, {
      ...formularioDeProducto(original),
      tipo: 'SIMPLE',
      estacionId: ESTACION,
    });
    expect(cambios).not.toHaveProperty('componentes');
  });

  it('menú a combo manda solo el tipo', () => {
    const original = menu();
    const cambios = cambiosDelProducto(original, {
      ...formularioDeProducto(original),
      tipo: 'COMBO',
    });
    expect(cambios).toEqual({ tipo: 'COMBO' });
  });

  it('cambiar la cantidad o los componentes de un combo manda la lista completa nueva', () => {
    const original = combo();
    const estado = formularioDeProducto(original);
    const cantidad = cambiosDelProducto(original, {
      ...estado,
      componentes: [{ productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 2 }],
    });
    expect(cantidad).toEqual({ componentes: [{ productoId: HAMBURGUESA, cantidad: 2 }] });
    const otro = cambiosDelProducto(original, {
      ...estado,
      componentes: [
        ...estado.componentes,
        { productoId: PAPAS, nombre: 'Papas del combo', cantidad: 1 },
      ],
    });
    expect(otro.componentes).toHaveLength(2);
  });
});

describe('cambiar de tipo en el formulario', () => {
  it('al pasar a simple un producto que no lo era, la estación se pide de nuevo (no queda en "Ninguna")', () => {
    const original = combo();
    const estado = formularioDeProducto(original);
    expect(estado.estacionId).toBe(SIN_ESTACION);
    expect(cambiarDeTipo(estado, 'SIMPLE', original).estacionId).toBe('');
  });

  it('volver al tipo guardado recupera su estación', () => {
    const original = producto();
    const estado = formularioDeProducto(original);
    const combo2 = cambiarDeTipo(estado, 'COMBO', original);
    expect(combo2.tipo).toBe('COMBO');
    expect(cambiarDeTipo(combo2, 'SIMPLE', original).estacionId).toBe(ESTACION);
  });

  it('conserva lo escrito: nombre, precio, componentes y grupos', () => {
    const original = combo();
    const estado = formularioDeProducto(original);
    const siguiente = cambiarDeTipo(estado, 'SIMPLE', original);
    expect(siguiente.nombre).toBe(estado.nombre);
    expect(siguiente.precio).toBe(estado.precio);
    expect(siguiente.componentes).toEqual(estado.componentes);
    expect(siguiente.grupos).toEqual(estado.grupos);
  });

  it('en el alta no toca la estación', () => {
    const estado = lleno({ estacionId: ESTACION });
    expect(cambiarDeTipo(estado, 'COMBO').estacionId).toBe(ESTACION);
  });
});

describe('avisos antes de guardar un cambio de tipo', () => {
  it('sin cambio de tipo no hay avisos', () => {
    expect(avisosDeCambioDeTipo(combo(), 'COMBO', null)).toEqual([]);
  });

  it('simple a combo dice qué estación se quita', () => {
    const avisos = avisosDeCambioDeTipo(producto(), 'COMBO', 'Cocina');
    expect(avisos.join(' ')).toMatch(/Se quitará la estación Cocina/);
    expect(avisos.join(' ')).not.toMatch(/no se podrá vender/);
  });

  it('pasar a menú del día avisa que no se podrá vender hasta armarlo en cada sucursal', () => {
    expect(avisosDeCambioDeTipo(combo(), 'MENU_DEL_DIA', null)).toContain(AVISO_MENU_SIN_ARMAR);
    expect(avisosDeCambioDeTipo(producto(), 'MENU_DEL_DIA', 'Cocina')).toContain(
      AVISO_MENU_SIN_ARMAR,
    );
    expect(AVISO_MENU_SIN_ARMAR).toMatch(/No se podrá vender hasta armar/);
  });

  it('combo a simple avisa de los componentes y pide la estación', () => {
    const avisos = avisosDeCambioDeTipo(
      combo({
        componentes: [
          { productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 1 },
          { productoId: PAPAS, nombre: 'Papas', cantidad: 2 },
        ],
      }),
      'SIMPLE',
      null,
    );
    expect(avisos[0]).toBe('Se quitarán sus 2 componentes.');
    expect(avisos).toContain('Elige la estación donde se prepara.');
  });

  it('menú a otro tipo avisa que se borran las opciones del día de todas las sucursales', () => {
    expect(avisosDeCambioDeTipo(menu(), 'COMBO', null).join(' ')).toMatch(
      /opciones del día ya armadas en todas las sucursales/,
    );
    expect(avisosDeCambioDeTipo(menu(), 'SIMPLE', null).join(' ')).toMatch(
      /opciones del día ya armadas/,
    );
  });
});

describe('lo que dice la API, en palabras', () => {
  const seQuita: SeQuita = {
    estacion: { id: ESTACION, nombre: 'Cocina' },
    componentes: [
      { productoId: HAMBURGUESA, nombre: 'Hamburguesa clásica', cantidad: 1 },
      { productoId: PAPAS, nombre: 'Papas', cantidad: 2 },
    ],
    opcionesDelDia: [
      { sucursalId: 's1', sucursalNombre: 'Miraflores', dia: '2026-10-29', opciones: 4 },
      { sucursalId: 's2', sucursalNombre: 'Surco', dia: '2026-10-30', opciones: 1 },
    ],
  };

  it('lista la estación, los componentes con su cantidad y las opciones del día por sucursal', () => {
    expect(frasesDeSeQuita(seQuita)).toEqual([
      'Se quitará la estación Cocina.',
      'Se quitarán los componentes: Hamburguesa clásica × 1, Papas × 2.',
      'Se borrarán las opciones del menú del jueves 29 de octubre en Miraflores (4).',
      'Se borrará la opción del menú del viernes 30 de octubre en Surco (1).',
    ]);
  });

  it('con un solo componente habla en singular', () => {
    expect(
      frasesDeSeQuita({
        estacion: null,
        componentes: [{ productoId: PAPAS, nombre: 'Papas', cantidad: 3 }],
        opcionesDelDia: [],
      }),
    ).toEqual(['Se quitará el componente: Papas × 3.']);
  });

  it('lo que no se quita no aparece', () => {
    expect(frasesDeSeQuita({ estacion: null, componentes: [], opcionesDelDia: [] })).toEqual([]);
  });

  it('dónde se usa un producto: combos y grupos con su opción', () => {
    expect(
      usosDeProducto({
        combos: [{ id: 'c1', nombre: 'Combo hamburguesa' }],
        modificadores: [
          { id: 'm1', nombre: 'Inca Kola', grupoId: 'g1', grupoNombre: 'Bebida del combo' },
        ],
      }),
    ).toEqual({ combos: ['Combo hamburguesa'], opciones: ['Bebida del combo › Inca Kola'] });
  });

  it('el tipo dicho en medio de una frase', () => {
    expect(tipoEnFrase('SIMPLE')).toBe('simple');
    expect(tipoEnFrase('COMBO')).toBe('combo');
    expect(tipoEnFrase('MENU_DEL_DIA')).toBe('menú del día');
  });
});

describe('fechas sin zonas horarias', () => {
  it('suma y resta días de calendario, también entre meses y años', () => {
    expect(sumarDiasAFecha('2026-10-29', 1)).toBe('2026-10-30');
    expect(sumarDiasAFecha('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDiasAFecha('2026-11-01', -1)).toBe('2026-10-31');
    expect(sumarDiasAFecha('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDiasAFecha('2028-02-28', 1)).toBe('2028-02-29');
    expect(sumarDiasAFecha('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('dice el día de la semana y la fecha', () => {
    expect(diaConFecha('2026-10-29')).toBe('jueves 29 de octubre');
    expect(diaConFecha('2026-11-01')).toBe('domingo 1 de noviembre');
  });

  it('una fecha que no es una fecha se deja como está', () => {
    expect(diaConFecha('mañana')).toBe('mañana');
    expect(sumarDiasAFecha('mañana', 1)).toBe('mañana');
  });

  it('reconoce el cero sin pasar por números de coma flotante', () => {
    expect(montoEsCero('0')).toBe(true);
    expect(montoEsCero('0.00')).toBe(true);
    expect(montoEsCero('4.50')).toBe(false);
    expect(montoEsCero('x')).toBe(false);
  });
});

function elMenu(opciones: Record<string, [string, boolean, boolean][]>): MenuDelDiaRespuesta {
  return {
    productoId: 'a0000000-0000-4000-8000-0000000000f1',
    nombre: 'Menú criollo',
    precio: '12.00',
    dia: '2026-10-29',
    grupos: Object.entries(opciones).map(([nombre, lista], i) => ({
      id: `b0000000-0000-4000-8000-00000000000${i + 1}`,
      nombre,
      minimo: 1,
      maximo: 1,
      opciones: lista.map(([id, elegida, disponible]) => ({
        modificadorId: id,
        nombre: id,
        precioExtra: '0.00',
        producto: null,
        elegida,
        disponible,
      })),
    })),
  };
}

describe('menú del día: lo marcado frente a lo guardado', () => {
  const guardado = elMenu({
    Entrada: [
      ['huancaina', true, true],
      ['sopa', false, true],
    ],
    Segundo: [['aji', true, true]],
  });

  it('las elegidas son las guardadas', () => {
    expect([...elegidasDe(guardado)].sort()).toEqual(['aji', 'huancaina']);
  });

  it('marcar o desmarcar es un cambio; volver a lo guardado, no', () => {
    expect(hayCambiosDeMenu(guardado, new Set(['aji', 'huancaina']))).toBe(false);
    expect(hayCambiosDeMenu(guardado, new Set(['aji', 'huancaina', 'sopa']))).toBe(true);
    expect(hayCambiosDeMenu(guardado, new Set(['aji']))).toBe(true);
  });

  it('un menú sin ninguna elegida está sin armar', () => {
    expect(estaSinArmar(guardado)).toBe(false);
    expect(estaSinArmar(elMenu({ Entrada: [['sopa', false, true]] }))).toBe(true);
  });

  it('a un grupo obligatorio le faltan platos disponibles marcados para llegar a su mínimo', () => {
    const grupo = guardado.grupos[0]!;
    expect(opcionesQueFaltan(grupo, new Set(['huancaina']))).toBe(0);
    expect(opcionesQueFaltan(grupo, new Set())).toBe(1);
    // Un plato no disponible marcado no cuenta (criterio 59, OPCIONES_INSUFICIENTES).
    const noDisponible = elMenu({ Entrada: [['sopa', true, false]] }).grupos[0]!;
    expect(opcionesQueFaltan(noDisponible, new Set(['sopa']))).toBe(1);
  });

  it('dice lo que falta en palabras', () => {
    expect(textoDeFaltantes(1)).toBe('Elige al menos 1 plato');
    expect(textoDeFaltantes(2)).toBe('Elige al menos 2 platos');
  });

  it('la regla del tiempo se dice como en la carta', () => {
    expect(reglaDeTiempo({ minimo: 1, maximo: 1 })).toBe('Elige 1, obligatorio');
    expect(reglaDeTiempo({ minimo: 0, maximo: 1 })).toBe('Elige 1, opcional');
    expect(reglaDeTiempo({ minimo: 0, maximo: 3 })).toBe('Hasta 3, opcional');
  });
});

describe('menú del día: repetir las de otro día', () => {
  const hoy = elMenu({
    Entrada: [
      ['huancaina', false, true],
      ['sopa', false, true],
    ],
    Segundo: [['aji', false, true]],
  });

  it('copia solo lo que sigue siendo candidato', () => {
    const ayer = elMenu({
      Entrada: [
        ['sopa', true, true],
        ['ya-no-existe', true, true],
      ],
      Segundo: [['aji', true, true]],
    });
    expect([...copiarDeOtroDia(hoy, ayer)].sort()).toEqual(['aji', 'sopa']);
  });

  it('un candidato nuevo no se marca por sí solo', () => {
    const ayer = elMenu({ Entrada: [['sopa', true, true]] });
    expect(copiarDeOtroDia(hoy, ayer).has('huancaina')).toBe(false);
  });

  it('si el otro día no tenía el menú o no armó nada, no copia nada', () => {
    expect(copiarDeOtroDia(hoy, undefined).size).toBe(0);
    expect(copiarDeOtroDia(hoy, elMenu({ Entrada: [['sopa', false, true]] })).size).toBe(0);
  });
});

describe('secciones de Disponibilidad', () => {
  it('hoy solo está construido el menú del día; Agotados llega en C5', () => {
    expect(SECCIONES_HABILITADAS.map((s) => s.valor)).toEqual(['menu']);
  });

  it('una sección desconocida o aún no construida cae en la primera habilitada', () => {
    expect(seccionDeDisponibilidadPedida(null)).toBe('menu');
    expect(seccionDeDisponibilidadPedida('agotados')).toBe('menu');
    expect(seccionDeDisponibilidadPedida('menu')).toBe('menu');
    expect(seccionDeDisponibilidadPedida('otra')).toBe('menu');
  });
});
