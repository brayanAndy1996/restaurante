import {
  grupoEntradaSchema,
  grupoModificarEntradaSchema,
  type GrupoRespuesta,
} from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/errores';
import {
  cambiosDelGrupo,
  entradaDeGrupo,
  falloDeGrupo,
  formularioDeGrupo,
  grupoVacio,
  hayErrores,
  listaEnFrase,
  opcionesParaEnviar,
  pluralOpciones,
  productosEnUso,
  reglaDelBorrador,
  reglaEnPalabras,
  usoEnProductos,
  validarGrupo,
  type EstadoDelGrupo,
} from '../src/modulos/carta/grupo-form';
import {
  cambiosDelProducto,
  entradaDeCreacion,
  formularioDeProducto,
  formularioVacio,
} from '../src/modulos/carta/producto-form';
import type { ProductoRespuesta } from '@restaurante/contratos';
import { ID } from './ayudas';

const G = 'c1000000-0000-4000-8000-000000000001';
const M1 = 'd1000000-0000-4000-8000-000000000001';
const M2 = 'd2000000-0000-4000-8000-000000000002';
const P = 'a1000000-0000-4000-8000-000000000001';

function grupo(parcial: Partial<GrupoRespuesta> = {}): GrupoRespuesta {
  return {
    id: G,
    nombre: 'Término de la carne',
    seleccion: 'UNICA',
    minimo: 1,
    maximo: 1,
    obligatorio: true,
    activo: true,
    modificadores: [
      { id: M1, nombre: 'Medio', precioExtra: '0.00', producto: null, orden: 1 },
      {
        id: M2,
        nombre: 'Bien cocido',
        precioExtra: '1.50',
        producto: { id: P, nombre: 'Papas' },
        orden: 2,
      },
    ],
    productos: [],
    ...parcial,
  };
}

function lleno(parcial: Partial<EstadoDelGrupo> = {}): EstadoDelGrupo {
  const base = formularioDeGrupo(grupo());
  return { ...base, ...parcial };
}

describe('reglaEnPalabras', () => {
  it('dice la regla como la dice el negocio', () => {
    const r = (seleccion: 'UNICA' | 'MULTIPLE', minimo: number, maximo: number) =>
      reglaEnPalabras({ seleccion, minimo, maximo, obligatorio: minimo >= 1 });
    expect(r('UNICA', 1, 1)).toBe('Elige 1, obligatorio');
    expect(r('UNICA', 0, 1)).toBe('Elige 1, opcional');
    expect(r('MULTIPLE', 0, 3)).toBe('Hasta 3, opcional');
    expect(r('MULTIPLE', 1, 2)).toBe('Elige de 1 a 2, obligatorio');
    expect(r('MULTIPLE', 2, 2)).toBe('Elige 2, obligatorio');
  });

  it('la regla del borrador espera números válidos y coherentes', () => {
    expect(reglaDelBorrador(lleno({ seleccion: 'UNICA', obligatorio: false }))).toBe(
      'Elige 1, opcional',
    );
    expect(reglaDelBorrador(lleno({ seleccion: 'MULTIPLE', minimo: '0', maximo: '3' }))).toBe(
      'Hasta 3, opcional',
    );
    expect(reglaDelBorrador(lleno({ seleccion: 'MULTIPLE', minimo: '0', maximo: '' }))).toBeNull();
    expect(reglaDelBorrador(lleno({ seleccion: 'MULTIPLE', minimo: '3', maximo: '2' }))).toBeNull();
  });

  it('cuenta opciones y productos en singular y plural', () => {
    expect(pluralOpciones(1)).toBe('1 opción');
    expect(pluralOpciones(4)).toBe('4 opciones');
    expect(usoEnProductos(0)).toBe('Ningún producto lo usa');
    expect(usoEnProductos(1)).toBe('Lo usa 1 producto');
    expect(usoEnProductos(3)).toBe('Lo usan 3 productos');
    expect(listaEnFrase(['A'])).toBe('A');
    expect(listaEnFrase(['A', 'B'])).toBe('A y B');
    expect(listaEnFrase(['A', 'B', 'C'])).toBe('A, B y C');
  });
});

describe('validarGrupo', () => {
  it('un grupo nuevo vacío pide el nombre y al menos una opción', () => {
    const errores = validarGrupo(grupoVacio());
    expect(errores.nombre).toBe('Escribe el nombre del grupo');
    expect(errores.opciones).toMatch(/Agrega al menos una opción/);
    expect(hayErrores(errores)).toBe(true);
  });

  it('las filas en blanco no cuentan; una fila a medias se marca', () => {
    const estado = grupoVacio();
    const [a, b] = estado.opciones;
    estado.nombre = 'Salsas';
    estado.opciones = [
      { ...a!, nombre: 'Ají' },
      { ...b!, precioExtra: '2' },
    ];
    const errores = validarGrupo(estado);
    expect(errores.opciones).toBeUndefined();
    expect(errores.porOpcion[a!.clave]).toBeUndefined();
    expect(errores.porOpcion[b!.clave]?.nombre).toBe('Escribe el nombre de la opción');
    expect(
      opcionesParaEnviar({
        ...estado,
        opciones: [
          { ...a!, nombre: 'Ají' },
          { ...b!, precioExtra: '' },
        ],
      }),
    ).toHaveLength(1);
  });

  it('rechaza nombres repetidos en el grupo sin distinguir mayúsculas', () => {
    const estado = lleno();
    estado.opciones = estado.opciones.map((o) => ({
      ...o,
      nombre: o.id === M2 ? 'MEDIO' : o.nombre,
    }));
    const errores = validarGrupo(estado);
    expect(errores.porOpcion[estado.opciones[1]!.clave]?.nombre).toMatch(/Ya hay una opción/);
  });

  it('el precio extra admite 0 y vacío, y rechaza negativos, exponentes y más de 2 decimales', () => {
    const conPrecio = (precioExtra: string) => {
      const estado = lleno();
      estado.opciones = [{ ...estado.opciones[0]!, precioExtra }];
      return validarGrupo(estado).porOpcion[estado.opciones[0]!.clave]?.precioExtra;
    };
    expect(conPrecio('0')).toBeUndefined();
    expect(conPrecio('0.00')).toBeUndefined();
    expect(conPrecio('')).toBeUndefined();
    expect(conPrecio('2.5')).toBeUndefined();
    for (const malo of ['-1', '1e2', '1.234', 'abc']) expect(conPrecio(malo)).toBeDefined();
  });

  it('con varias, valida mínimo y máximo (criterio 25)', () => {
    const base = lleno({ seleccion: 'MULTIPLE' });
    expect(validarGrupo({ ...base, minimo: '0', maximo: '2' }).minimo).toBeUndefined();
    expect(validarGrupo({ ...base, minimo: '', maximo: '2' }).minimo).toBeDefined();
    expect(validarGrupo({ ...base, minimo: '0', maximo: '' }).maximo).toBeDefined();
    expect(validarGrupo({ ...base, minimo: '0', maximo: '0' }).maximo).toBeDefined();
    expect(validarGrupo({ ...base, minimo: '0', maximo: '51' }).maximo).toBeDefined();
    expect(validarGrupo({ ...base, minimo: '3', maximo: '2' }).minimo).toMatch(
      /mayor que el máximo/,
    );
    // Dos opciones: un mínimo de 3 no se puede cumplir.
    expect(validarGrupo({ ...base, minimo: '3', maximo: '5' }).minimo).toMatch(
      /opciones que agregaste \(2\)/,
    );
  });
});

describe('entradaDeGrupo', () => {
  it('una sola respuesta: lo que envía lo acepta el esquema del contrato', () => {
    const estado = lleno({ nombre: '  Término ', obligatorio: true });
    const entrada = entradaDeGrupo(estado);
    expect(entrada).toMatchObject({ nombre: 'Término', seleccion: 'UNICA', obligatorio: true });
    expect(() => grupoEntradaSchema.parse(entrada)).not.toThrow();
  });

  it('varias: manda mínimo y máximo como números y el precio extra como texto con 2 decimales', () => {
    const estado = lleno({ seleccion: 'MULTIPLE', minimo: '0', maximo: '2' });
    estado.opciones = [
      { clave: 'a', nombre: 'Huevo', precioExtra: '2.5', productoId: '' },
      { clave: 'b', nombre: 'Palta', precioExtra: '', productoId: P },
      { clave: 'c', nombre: '', precioExtra: '', productoId: '' },
    ];
    const entrada = entradaDeGrupo(estado);
    expect(entrada).toEqual({
      nombre: 'Término de la carne',
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      modificadores: [
        { nombre: 'Huevo', precioExtra: '2.50', productoId: null },
        { nombre: 'Palta', precioExtra: '0.00', productoId: P },
      ],
    });
    expect(() => grupoEntradaSchema.parse(entrada)).not.toThrow();
  });
});

describe('cambiosDelGrupo', () => {
  it('sin tocar nada no hay cambios', () => {
    expect(cambiosDelGrupo(grupo(), formularioDeGrupo(grupo()))).toEqual({});
  });

  it('manda solo el nombre si solo cambió el nombre', () => {
    expect(cambiosDelGrupo(grupo(), lleno({ nombre: 'Punto' }))).toEqual({ nombre: 'Punto' });
  });

  it('"2.5" y "2.50" son el mismo precio: no es un cambio', () => {
    const original = grupo({
      modificadores: [{ id: M1, nombre: 'Huevo', precioExtra: '2.50', producto: null, orden: 1 }],
    });
    const estado = formularioDeGrupo(original);
    estado.opciones = [{ ...estado.opciones[0]!, precioExtra: '2.5' }];
    expect(cambiosDelGrupo(original, estado)).toEqual({});
  });

  it('cambiar obligatorio de una sola respuesta manda solo `obligatorio`', () => {
    const cambios = cambiosDelGrupo(grupo(), lleno({ obligatorio: false }));
    expect(cambios).toEqual({ obligatorio: false });
    expect(() => grupoModificarEntradaSchema.parse(cambios)).not.toThrow();
  });

  it('pasar de una sola a varias manda la selección con su mínimo y su máximo', () => {
    const cambios = cambiosDelGrupo(
      grupo(),
      lleno({ seleccion: 'MULTIPLE', minimo: '0', maximo: '2' }),
    );
    expect(cambios).toEqual({ seleccion: 'MULTIPLE', minimo: 0, maximo: 2 });
    expect(() => grupoModificarEntradaSchema.parse(cambios)).not.toThrow();
  });

  it('pasar de varias a una sola manda `obligatorio` y ningún mínimo ni máximo', () => {
    const original = grupo({ seleccion: 'MULTIPLE', minimo: 0, maximo: 3, obligatorio: false });
    const cambios = cambiosDelGrupo(original, {
      ...formularioDeGrupo(original),
      seleccion: 'UNICA',
      obligatorio: true,
    });
    expect(cambios).toEqual({ seleccion: 'UNICA', obligatorio: true });
    expect(() => grupoModificarEntradaSchema.parse(cambios)).not.toThrow();
  });

  it('cambiar el máximo de varias manda mínimo y máximo juntos', () => {
    const original = grupo({ seleccion: 'MULTIPLE', minimo: 0, maximo: 3, obligatorio: false });
    expect(cambiosDelGrupo(original, { ...formularioDeGrupo(original), maximo: '4' })).toEqual({
      minimo: 0,
      maximo: 4,
    });
  });

  it('reordenar, quitar o agregar una opción manda la lista completa con los ids de las que ya existían', () => {
    const original = grupo();
    const base = formularioDeGrupo(original);
    const [a, b] = base.opciones;
    const reordenado = cambiosDelGrupo(original, { ...base, opciones: [b!, a!] });
    expect(reordenado.modificadores?.map((m) => m.id)).toEqual([M2, M1]);
    const quitado = cambiosDelGrupo(original, { ...base, opciones: [a!] });
    expect(quitado.modificadores).toHaveLength(1);
    const agregado = cambiosDelGrupo(original, {
      ...base,
      opciones: [
        ...base.opciones,
        { clave: 'n', nombre: 'Jugoso', precioExtra: '', productoId: '' },
      ],
    });
    expect(agregado.modificadores?.[2]).toEqual({
      nombre: 'Jugoso',
      precioExtra: '0.00',
      productoId: null,
    });
    expect(() => grupoModificarEntradaSchema.parse(agregado)).not.toThrow();
  });

  it('cambiar el producto ligado cuenta como cambio', () => {
    const original = grupo();
    const base = formularioDeGrupo(original);
    const opciones = base.opciones.map((o) => (o.id === M2 ? { ...o, productoId: '' } : o));
    expect(
      cambiosDelGrupo(original, { ...base, opciones }).modificadores?.[1]?.productoId,
    ).toBeNull();
  });
});

describe('falloDeGrupo', () => {
  const error = (codigo: string, extra: Partial<ConstructorParameters<typeof ErrorApi>[0]> = {}) =>
    new ErrorApi({ estado: 400, codigo, mensaje: 'x', ...extra });

  it('un nombre repetido se dice en el campo', () => {
    const f = falloDeGrupo(error('CONFLICTO', { estado: 409 }), lleno(), 'crear');
    expect(f.errores.nombre).toBe('Ya tienes un grupo con ese nombre. Usa otro.');
    expect(f.mensaje).toBeNull();
  });

  it('un alta que se reintentó por un corte avisa que pudo haberse creado', () => {
    const f = falloDeGrupo(
      error('CONFLICTO', { estado: 409, reintentada: true }),
      lleno(),
      'crear',
    );
    expect(f.mensaje).toMatch(/es posible que el grupo ya se haya creado/);
    expect(f.errores.nombre).toBeUndefined();
  });

  it('los errores de una opción vuelven a su fila aunque haya filas en blanco antes', () => {
    const estado = grupoVacio();
    const [a, b] = estado.opciones;
    estado.opciones = [a!, { ...b!, nombre: 'Ají' }];
    const f = falloDeGrupo(
      error('REFERENCIA_INVALIDA', {
        estado: 422,
        campos: [{ campo: 'modificadores.0.productoId', mensaje: 'x' }],
      }),
      estado,
      'crear',
    );
    expect(f.errores.porOpcion[b!.clave]?.producto).toMatch(/ya no está disponible/);
    expect(f.errores.porOpcion[a!.clave]).toBeUndefined();
  });

  it('un error de datos del servidor se lleva a su campo', () => {
    const f = falloDeGrupo(
      error('DATOS_INVALIDOS', {
        campos: [
          { campo: 'maximo', mensaje: 'El máximo es 50' },
          { campo: 'nombre', mensaje: 'Too small' },
        ],
      }),
      lleno({ seleccion: 'MULTIPLE' }),
      'editar',
    );
    expect(f.errores.maximo).toBe('El máximo es 50');
    expect(f.errores.nombre).toBe('Revisa este dato');
  });
});

describe('productosEnUso', () => {
  it('junta los productos de usadoEn y los que ya se conocían, sin repetir', () => {
    const e = new ErrorApi({
      estado: 409,
      codigo: 'EN_USO',
      mensaje: 'x',
      usadoEn: { combos: [{ id: P, nombre: 'Lomo' }], modificadores: [] },
    });
    expect(
      productosEnUso(e, {
        productos: [
          { id: P, nombre: 'Lomo' },
          { id: ID.otro, nombre: 'Chaufa' },
        ],
      }),
    ).toEqual([
      { id: P, nombre: 'Lomo' },
      { id: ID.otro, nombre: 'Chaufa' },
    ]);
  });

  it('sin usadoEn, usa lo que ya se conocía', () => {
    const e = new ErrorApi({ estado: 409, codigo: 'EN_USO', mensaje: 'x' });
    expect(productosEnUso(e, { productos: [{ id: P, nombre: 'Lomo' }] })).toEqual([
      { id: P, nombre: 'Lomo' },
    ]);
  });
});

describe('grupos en el formulario del producto', () => {
  const producto = (grupos: { id: string; nombre: string }[]): ProductoRespuesta => ({
    id: P,
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    familiaId: 'f0000000-0000-4000-8000-000000000001',
    precio: '32.50',
    seVendeSolo: true,
    estacionId: null,
    tipoControlStock: 'PORCIONES',
    fotoUrl: null,
    activo: true,
    orden: 1,
    descripcion: null,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    grupos,
    componentes: [],
    usadoEn: { combos: [], modificadores: [] },
    creadoEn: '2026-10-29T10:00:00.000Z',
    actualizadoEn: '2026-10-29T10:00:00.000Z',
  });

  it('el formulario toma los grupos del producto, en su orden', () => {
    const e = formularioDeProducto(producto([{ id: G, nombre: 'Término' }]));
    expect(e.grupos).toEqual([{ id: G, nombre: 'Término' }]);
    expect(formularioVacio([]).grupos).toEqual([]);
  });

  it('el alta manda los ids de los grupos en orden, y nada si no hay', () => {
    const base = {
      ...formularioVacio([]),
      nombre: 'Lomo',
      familiaId: 'f0000000-0000-4000-8000-000000000001',
      precio: '32.5',
      estacionId: 'ninguna',
      tipoControlStock: 'PORCIONES' as const,
    };
    expect(entradaDeCreacion(base)).not.toHaveProperty('gruposModificadores');
    const con = entradaDeCreacion({
      ...base,
      grupos: [
        { id: 'c2000000-0000-4000-8000-000000000002', nombre: 'B' },
        { id: G, nombre: 'A' },
      ],
    });
    expect(con.gruposModificadores).toEqual(['c2000000-0000-4000-8000-000000000002', G]);
  });

  it('la edición manda la lista de grupos solo si cambió (el orden cuenta)', () => {
    const otro = 'c2000000-0000-4000-8000-000000000002';
    const original = producto([
      { id: G, nombre: 'A' },
      { id: otro, nombre: 'B' },
    ]);
    const estado = formularioDeProducto(original);
    expect(cambiosDelProducto(original, estado)).toEqual({});
    expect(
      cambiosDelProducto(original, { ...estado, grupos: [...estado.grupos].reverse() }),
    ).toEqual({ gruposModificadores: [otro, G] });
    expect(cambiosDelProducto(original, { ...estado, grupos: [] })).toEqual({
      gruposModificadores: [],
    });
  });
});
