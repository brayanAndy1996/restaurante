import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  agotadoEntradaSchema,
  agotadoRespuestaSchema,
  ajusteSucursalEntradaSchema,
  ajusteSucursalRespuestaSchema,
  cartaSucursalRespuestaSchema,
  errorRespuestaSchema,
  estacionEntradaSchema,
  estacionModificarEntradaSchema,
  eventoCartaActualizadaSchema,
  eventoDisponibilidadSchema,
  familiaEntradaSchema,
  familiaModificarEntradaSchema,
  grupoEntradaSchema,
  grupoModificarEntradaSchema,
  lineaPreparadaSchema,
  menuDelDiaEntradaSchema,
  menuDelDiaRespuestaSchema,
  montoNoNegativoSchema,
  montoSchema,
  ordenEntradaSchema,
  productoCrearEntradaSchema,
  productoModificarEntradaSchema,
  productoRespuestaSchema,
  productoResumenSchema,
  seQuitaSchema,
  usadoEnSchema,
} from '../src';

// Esquemas de la sección "Carta" (historia 003): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';
const AHORA = '2026-11-03T12:00:00.000Z';

function campos(resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

const simple = {
  tipo: 'SIMPLE',
  nombre: 'Lomo saltado',
  familiaId: ID_1,
  precio: '28.00',
  estacionId: ID_2,
  tipoControlStock: 'PORCIONES',
} as const;

describe('montoNoNegativoSchema', () => {
  it('acepta 0 y montos con hasta 2 decimales y 8 enteros', () => {
    for (const bueno of ['0', '0.00', '0.5', '5', '5.5', '5.55', '12345678', '12345678.99']) {
      expect(montoNoNegativoSchema.safeParse(bueno).success, bueno).toBe(true);
    }
  });

  it('rechaza negativos, exponentes, espacios, más decimales y más enteros', () => {
    for (const malo of [
      '-1',
      '-0',
      '1e2',
      ' 1',
      '1 ',
      '+1',
      '1.',
      '.5',
      '1.234',
      '123456789',
      '',
    ]) {
      expect(montoNoNegativoSchema.safeParse(malo).success, malo).toBe(false);
    }
    expect(montoNoNegativoSchema.safeParse(5).success).toBe(false);
  });

  it('montoSchema sigue rechazando el 0', () => {
    expect(montoSchema.safeParse('0').success).toBe(false);
    expect(montoSchema.safeParse('0.00').success).toBe(false);
    expect(montoSchema.safeParse('0.01').success).toBe(true);
  });
});

describe('códigos de error de la carta', () => {
  it('incluye los códigos nuevos sin repetir ninguno', () => {
    for (const codigo of [
      'REFERENCIA_INVALIDA',
      'EN_USO',
      'CONFIRMACION_REQUERIDA',
      'FOTO_INVALIDA',
      'PRODUCTO_NO_VENDIBLE',
      'SELECCION_INVALIDA',
    ]) {
      expect(CODIGOS_ERROR, codigo).toContain(codigo);
    }
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });

  it('errorRespuestaSchema acepta usadoEn y seQuita como campos opcionales', () => {
    const base = { codigo: 'EN_USO', mensaje: 'Se usa en un combo' };
    expect(errorRespuestaSchema.safeParse(base).success).toBe(true);
    const usadoEn = { combos: [{ id: ID_1, nombre: 'Combo' }], modificadores: [] };
    expect(errorRespuestaSchema.safeParse({ ...base, usadoEn }).success).toBe(true);
    const seQuita = {
      estacion: { id: ID_1, nombre: 'Cocina' },
      componentes: [{ productoId: ID_2, nombre: 'Hamburguesa', cantidad: 1 }],
      opcionesDelDia: [
        { sucursalId: ID_3, sucursalNombre: 'Miraflores', dia: '2026-11-03', opciones: 4 },
      ],
    };
    expect(
      errorRespuestaSchema.safeParse({ codigo: 'CONFIRMACION_REQUERIDA', mensaje: 'x', seQuita })
        .success,
    ).toBe(true);
    expect(errorRespuestaSchema.safeParse({ ...base, usadoEn: { combos: 1 } }).success).toBe(false);
  });

  it('usadoEn y seQuita validan su forma', () => {
    expect(usadoEnSchema.safeParse({ combos: [], modificadores: [] }).success).toBe(true);
    expect(usadoEnSchema.safeParse({ combos: [] }).success).toBe(false);
    expect(
      seQuitaSchema.safeParse({ estacion: null, componentes: [], opcionesDelDia: [] }).success,
    ).toBe(true);
    expect(seQuitaSchema.safeParse({ estacion: null, componentes: [] }).success).toBe(false);
  });
});

describe('estaciones y familias', () => {
  it('el nombre de una estación tiene de 1 a 50 caracteres y se recorta', () => {
    expect(estacionEntradaSchema.parse({ nombre: '  Cocina ' })).toEqual({ nombre: 'Cocina' });
    expect(estacionEntradaSchema.safeParse({ nombre: 'a'.repeat(50) }).success).toBe(true);
    for (const malo of ['', '   ', 'a'.repeat(51), 'a\u0000b']) {
      expect(estacionEntradaSchema.safeParse({ nombre: malo }).success, malo).toBe(false);
    }
  });

  it('el nombre de una familia tiene de 1 a 60 caracteres', () => {
    expect(familiaEntradaSchema.safeParse({ nombre: 'a'.repeat(60) }).success).toBe(true);
    expect(familiaEntradaSchema.safeParse({ nombre: 'a'.repeat(61) }).success).toBe(false);
    expect(familiaEntradaSchema.safeParse({ nombre: '' }).success).toBe(false);
  });

  it('modificar exige al menos un campo', () => {
    expect(estacionModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(estacionModificarEntradaSchema.safeParse({ activa: false }).success).toBe(true);
    expect(familiaModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(familiaModificarEntradaSchema.safeParse({ nombre: 'Fondos' }).success).toBe(true);
  });

  it('rechaza campos desconocidos, empresaId y campos de trazabilidad', () => {
    for (const extra of [
      { empresaId: ID_1 },
      { creadoPorUsuarioId: ID_1 },
      { actualizadoPorUsuarioId: ID_1 },
      { otro: 1 },
    ]) {
      expect(estacionEntradaSchema.safeParse({ nombre: 'Cocina', ...extra }).success).toBe(false);
      expect(familiaEntradaSchema.safeParse({ nombre: 'Fondos', ...extra }).success).toBe(false);
      expect(familiaModificarEntradaSchema.safeParse({ nombre: 'Fondos', ...extra }).success).toBe(
        false,
      );
    }
  });

  it('el orden acepta una lista de ids (también vacía) sin repetidos ni textos que no son UUID', () => {
    expect(ordenEntradaSchema.safeParse({ ids: [] }).success).toBe(true);
    expect(ordenEntradaSchema.safeParse({ ids: [ID_1, ID_2] }).success).toBe(true);
    expect(ordenEntradaSchema.safeParse({ ids: [ID_1, ID_1] }).success).toBe(false);
    expect(ordenEntradaSchema.safeParse({ ids: [ID_1, 'x'] }).success).toBe(false);
    expect(ordenEntradaSchema.safeParse({}).success).toBe(false);
    expect(ordenEntradaSchema.safeParse({ ids: [ID_1], empresaId: ID_2 }).success).toBe(false);
  });
});

describe('productoCrearEntradaSchema', () => {
  it('aplica los valores por defecto del criterio 6', () => {
    const p = productoCrearEntradaSchema.parse(simple);
    expect(p.seVendeSolo).toBe(true);
    expect(p.afectacionIgv).toBe('GRAVADO');
    expect(p.aplicaIcbper).toBe(false);
  });

  it('el tipo de control de stock es obligatorio y sin valor por defecto', () => {
    const { tipoControlStock, ...sin } = simple;
    void tipoControlStock;
    expect(productoCrearEntradaSchema.safeParse(sin).success).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, tipoControlStock: 'RECETA' }).success,
    ).toBe(false);
  });

  it('valida largos de nombre y descripción, y el precio mayor que 0', () => {
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, nombre: 'a'.repeat(100) }).success,
    ).toBe(true);
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, nombre: 'a'.repeat(101) }).success,
    ).toBe(false);
    expect(productoCrearEntradaSchema.safeParse({ ...simple, nombre: '' }).success).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, descripcion: 'a'.repeat(500) }).success,
    ).toBe(true);
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, descripcion: 'a'.repeat(501) }).success,
    ).toBe(false);
    expect(productoCrearEntradaSchema.safeParse({ ...simple, descripcion: null }).success).toBe(
      true,
    );
    for (const malo of ['0', '0.00', '-1', '1.234', '1e2', 28]) {
      expect(
        productoCrearEntradaSchema.safeParse({ ...simple, precio: malo }).success,
        `${malo}`,
      ).toBe(false);
    }
  });

  it('SIMPLE: la estación va presente (id o null) y no lleva componentes', () => {
    const { estacionId, ...sinEstacion } = simple;
    void estacionId;
    const r = productoCrearEntradaSchema.safeParse(sinEstacion);
    expect(campos(r)).toContain('estacionId');
    expect(productoCrearEntradaSchema.safeParse({ ...simple, estacionId: null }).success).toBe(
      true,
    );
    const conComponentes = productoCrearEntradaSchema.safeParse({
      ...simple,
      componentes: [{ productoId: ID_3, cantidad: 1 }],
    });
    expect(campos(conComponentes)).toContain('componentes');
    expect(productoCrearEntradaSchema.safeParse({ ...simple, componentes: [] }).success).toBe(true);
  });

  it('SIMPLE: que se venda solo exige precio; si no, no lleva precio', () => {
    expect(
      campos(productoCrearEntradaSchema.safeParse({ ...simple, precio: undefined })),
    ).toContain('precio');
    expect(campos(productoCrearEntradaSchema.safeParse({ ...simple, precio: null }))).toContain(
      'precio',
    );
    const sinPrecio = { ...simple, seVendeSolo: false, precio: null };
    expect(productoCrearEntradaSchema.safeParse(sinPrecio).success).toBe(true);
    expect(productoCrearEntradaSchema.safeParse({ ...sinPrecio, precio: undefined }).success).toBe(
      true,
    );
    expect(
      campos(productoCrearEntradaSchema.safeParse({ ...simple, seVendeSolo: false })),
    ).toContain('precio');
  });

  it('COMBO: precio obligatorio, se vende solo, sin estación y con algo dentro', () => {
    const combo = {
      tipo: 'COMBO',
      nombre: 'Combo hamburguesa',
      familiaId: ID_1,
      precio: '22.90',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: ID_2, cantidad: 1 }],
    } as const;
    expect(productoCrearEntradaSchema.safeParse(combo).success).toBe(true);
    expect(productoCrearEntradaSchema.safeParse({ ...combo, estacionId: null }).success).toBe(true);
    expect(campos(productoCrearEntradaSchema.safeParse({ ...combo, estacionId: ID_3 }))).toContain(
      'estacionId',
    );
    expect(
      campos(productoCrearEntradaSchema.safeParse({ ...combo, seVendeSolo: false })),
    ).toContain('seVendeSolo');
    expect(campos(productoCrearEntradaSchema.safeParse({ ...combo, precio: undefined }))).toContain(
      'precio',
    );
    const vacio = productoCrearEntradaSchema.safeParse({ ...combo, componentes: [] });
    expect(vacio.success).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({
        ...combo,
        componentes: undefined,
        gruposModificadores: [ID_3],
      }).success,
    ).toBe(true);
  });

  it('MENU_DEL_DIA: como el combo, pero con al menos un grupo', () => {
    const menu = {
      tipo: 'MENU_DEL_DIA',
      nombre: 'Menú del día',
      familiaId: ID_1,
      precio: '12.00',
      tipoControlStock: 'PORCIONES',
      gruposModificadores: [ID_2, ID_3],
    } as const;
    expect(productoCrearEntradaSchema.safeParse(menu).success).toBe(true);
    const sinGrupos = productoCrearEntradaSchema.safeParse({
      ...menu,
      gruposModificadores: undefined,
      componentes: [{ productoId: ID_2, cantidad: 1 }],
    });
    expect(campos(sinGrupos)).toContain('gruposModificadores');
  });

  it('rechaza grupos y componentes repetidos y los máximos de cordura', () => {
    const combo = {
      tipo: 'COMBO',
      nombre: 'Combo',
      familiaId: ID_1,
      precio: '10.00',
      tipoControlStock: 'SIN_CONTROL',
    } as const;
    const repetidoGrupo = productoCrearEntradaSchema.safeParse({
      ...combo,
      gruposModificadores: [ID_1, ID_1],
    });
    expect(campos(repetidoGrupo)).toContain('gruposModificadores.1');
    const repetidoComponente = productoCrearEntradaSchema.safeParse({
      ...combo,
      componentes: [
        { productoId: ID_1, cantidad: 1 },
        { productoId: ID_1, cantidad: 2 },
      ],
    });
    expect(campos(repetidoComponente)).toContain('componentes.1');
    const muchosGrupos = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(
      productoCrearEntradaSchema.safeParse({ ...combo, gruposModificadores: muchosGrupos }).success,
    ).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({
        ...combo,
        gruposModificadores: muchosGrupos.slice(0, 10),
      }).success,
    ).toBe(true);
    const veintiuno = Array.from({ length: 21 }, (_, i) => ({
      productoId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      cantidad: 1,
    }));
    expect(productoCrearEntradaSchema.safeParse({ ...combo, componentes: veintiuno }).success).toBe(
      false,
    );
    expect(
      productoCrearEntradaSchema.safeParse({ ...combo, componentes: veintiuno.slice(0, 20) })
        .success,
    ).toBe(true);
  });

  it('la cantidad de un componente es un entero de 1 a 99', () => {
    const combo = {
      tipo: 'COMBO',
      nombre: 'Combo',
      familiaId: ID_1,
      precio: '10.00',
      tipoControlStock: 'SIN_CONTROL',
    } as const;
    for (const cantidad of [0, 100, 1.5, -1]) {
      expect(
        productoCrearEntradaSchema.safeParse({
          ...combo,
          componentes: [{ productoId: ID_2, cantidad }],
        }).success,
        `${cantidad}`,
      ).toBe(false);
    }
    for (const cantidad of [1, 99]) {
      expect(
        productoCrearEntradaSchema.safeParse({
          ...combo,
          componentes: [{ productoId: ID_2, cantidad }],
        }).success,
        `${cantidad}`,
      ).toBe(true);
    }
  });

  it('acepta noDisponibleEn con ids y rechaza campos desconocidos, empresaId y creadoPor*', () => {
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, noDisponibleEn: [ID_3] }).success,
    ).toBe(true);
    expect(productoCrearEntradaSchema.safeParse({ ...simple, noDisponibleEn: ['x'] }).success).toBe(
      false,
    );
    for (const extra of [
      { empresaId: ID_1 },
      { creadoPorUsuarioId: ID_1 },
      { actualizadoPorEquipoId: ID_1 },
      { fotoClave: 'x' },
      { orden: 1 },
      { activo: true },
    ]) {
      expect(productoCrearEntradaSchema.safeParse({ ...simple, ...extra }).success).toBe(false);
    }
  });

  it('el tipo, la afectación y el control de stock deben ser del catálogo', () => {
    expect(productoCrearEntradaSchema.safeParse({ ...simple, tipo: 'KIT' }).success).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({ ...simple, afectacionIgv: 'GRATUITO' }).success,
    ).toBe(false);
    expect(
      productoCrearEntradaSchema.safeParse({
        ...simple,
        afectacionIgv: 'EXONERADO',
        aplicaIcbper: true,
      }).success,
    ).toBe(true);
  });
});

describe('productoModificarEntradaSchema', () => {
  it('exige al menos un campo distinto de confirmarPerdida', () => {
    expect(productoModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(productoModificarEntradaSchema.safeParse({ confirmarPerdida: true }).success).toBe(
      false,
    );
    expect(
      productoModificarEntradaSchema.safeParse({ confirmarPerdida: true, activo: false }).success,
    ).toBe(true);
  });

  it('admite tipo, confirmarPerdida y desactivar', () => {
    const r = productoModificarEntradaSchema.parse({
      tipo: 'COMBO',
      estacionId: null,
      precio: '25.00',
      confirmarPerdida: true,
    });
    expect(r.tipo).toBe('COMBO');
    expect(r.confirmarPerdida).toBe(true);
    expect(productoModificarEntradaSchema.safeParse({ tipo: 'KIT' }).success).toBe(false);
  });

  it('no aplica valores por defecto: solo lo enviado', () => {
    expect(productoModificarEntradaSchema.parse({ nombre: 'Otro' })).toEqual({ nombre: 'Otro' });
  });

  it('no admite noDisponibleEn, empresaId ni campos de trazabilidad', () => {
    for (const extra of [
      { noDisponibleEn: [ID_1] },
      { empresaId: ID_1 },
      { creadoPorUsuarioId: ID_1 },
      { actualizadoPorUsuarioId: ID_1 },
    ]) {
      expect(productoModificarEntradaSchema.safeParse({ nombre: 'x', ...extra }).success).toBe(
        false,
      );
    }
  });

  it('rechaza listas repetidas y valida los montos', () => {
    expect(
      campos(productoModificarEntradaSchema.safeParse({ gruposModificadores: [ID_1, ID_1] })),
    ).toContain('gruposModificadores.1');
    expect(
      campos(
        productoModificarEntradaSchema.safeParse({
          componentes: [
            { productoId: ID_1, cantidad: 1 },
            { productoId: ID_1, cantidad: 1 },
          ],
        }),
      ),
    ).toContain('componentes.1');
    expect(productoModificarEntradaSchema.safeParse({ precio: '0' }).success).toBe(false);
    expect(productoModificarEntradaSchema.safeParse({ precio: null }).success).toBe(true);
    expect(
      productoModificarEntradaSchema.safeParse({ gruposModificadores: [], componentes: [] })
        .success,
    ).toBe(true);
  });
});

describe('ajusteSucursalEntradaSchema', () => {
  it('precio mayor que 0 o null, y disponible obligatorio', () => {
    expect(
      ajusteSucursalEntradaSchema.safeParse({ precio: '27.50', disponible: false }).success,
    ).toBe(true);
    expect(ajusteSucursalEntradaSchema.safeParse({ precio: null, disponible: true }).success).toBe(
      true,
    );
    expect(ajusteSucursalEntradaSchema.safeParse({ precio: '0', disponible: true }).success).toBe(
      false,
    );
    expect(ajusteSucursalEntradaSchema.safeParse({ precio: '1', disponible: 'si' }).success).toBe(
      false,
    );
    expect(ajusteSucursalEntradaSchema.safeParse({ disponible: true }).success).toBe(false);
    expect(ajusteSucursalEntradaSchema.safeParse({ precio: null }).success).toBe(false);
    expect(
      ajusteSucursalEntradaSchema.safeParse({ precio: null, disponible: true, sucursalId: ID_1 })
        .success,
    ).toBe(false);
  });

  it('la respuesta lleva editable', () => {
    const fila = {
      sucursalId: ID_1,
      nombre: 'Miraflores',
      precio: null,
      precioEfectivo: '25.00',
      disponible: true,
      agotado: false,
      editable: false,
    };
    expect(ajusteSucursalRespuestaSchema.safeParse(fila).success).toBe(true);
    const { editable, ...sin } = fila;
    void editable;
    expect(ajusteSucursalRespuestaSchema.safeParse(sin).success).toBe(false);
  });
});

describe('grupoEntradaSchema', () => {
  const opciones = [
    { nombre: 'Jugoso' },
    { nombre: '3/4', precioExtra: '0.00' },
    { nombre: 'Bien cocido', productoId: ID_1 },
  ];

  it('UNICA lleva obligatorio y no minimo ni maximo', () => {
    const r = grupoEntradaSchema.parse({
      nombre: 'Término',
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: opciones,
    });
    expect(r.seleccion).toBe('UNICA');
    expect(r.modificadores[0]).toEqual({ nombre: 'Jugoso', precioExtra: '0.00', productoId: null });
    expect(
      grupoEntradaSchema.safeParse({
        nombre: 'Término',
        seleccion: 'UNICA',
        obligatorio: false,
        minimo: 0,
        modificadores: opciones,
      }).success,
    ).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({
        nombre: 'Término',
        seleccion: 'UNICA',
        maximo: 1,
        modificadores: opciones,
      }).success,
    ).toBe(false);
  });

  it('MULTIPLE lleva minimo y maximo y no obligatorio', () => {
    const base = { nombre: 'Extras', seleccion: 'MULTIPLE', modificadores: opciones } as const;
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 0, maximo: 2 }).success).toBe(true);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 1, maximo: 3 }).success).toBe(true);
    expect(grupoEntradaSchema.safeParse({ ...base, maximo: 2 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 0 }).success).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({ ...base, minimo: 0, maximo: 2, obligatorio: true }).success,
    ).toBe(false);
  });

  it('MULTIPLE: 0 <= minimo <= maximo, 1 <= maximo <= 50 y minimo no mayor que las opciones', () => {
    const base = { nombre: 'Extras', seleccion: 'MULTIPLE', modificadores: opciones } as const;
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 3, maximo: 2 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: -1, maximo: 2 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 0, maximo: 0 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 0, maximo: 51 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 1.5, maximo: 2 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 4, maximo: 5 }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, minimo: 3, maximo: 5 }).success).toBe(true);
  });

  it('una selección que no es UNICA ni MULTIPLE se rechaza', () => {
    expect(
      grupoEntradaSchema.safeParse({
        nombre: 'x',
        seleccion: 'VARIAS',
        obligatorio: true,
        modificadores: opciones,
      }).success,
    ).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({ nombre: 'x', obligatorio: true, modificadores: opciones })
        .success,
    ).toBe(false);
  });

  it('el precio extra admite 0 y no admite negativos, exponentes ni más decimales', () => {
    const grupo = (precioExtra: unknown) => ({
      nombre: 'Bebida',
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [{ nombre: 'Chicha', precioExtra }],
    });
    for (const bueno of ['0', '0.00', '4.5', '4.50']) {
      expect(grupoEntradaSchema.safeParse(grupo(bueno)).success, bueno).toBe(true);
    }
    for (const malo of ['-1', '-0.01', '1e2', '4.555', 4.5, ' 4']) {
      expect(grupoEntradaSchema.safeParse(grupo(malo)).success, `${malo}`).toBe(false);
    }
  });

  it('de 1 a 50 modificadores, con nombres de 1 a 60 y sin repetir (sin distinguir mayúsculas)', () => {
    const grupo = (modificadores: unknown) => ({
      nombre: 'Bebida',
      seleccion: 'UNICA',
      obligatorio: false,
      modificadores,
    });
    expect(grupoEntradaSchema.safeParse(grupo([])).success).toBe(false);
    const cincuenta = Array.from({ length: 50 }, (_, i) => ({ nombre: `Opción ${i}` }));
    expect(grupoEntradaSchema.safeParse(grupo(cincuenta)).success).toBe(true);
    expect(grupoEntradaSchema.safeParse(grupo([...cincuenta, { nombre: 'Otra' }])).success).toBe(
      false,
    );
    expect(grupoEntradaSchema.safeParse(grupo([{ nombre: 'a'.repeat(61) }])).success).toBe(false);
    expect(grupoEntradaSchema.safeParse(grupo([{ nombre: '' }])).success).toBe(false);
    const repetidos = grupoEntradaSchema.safeParse(
      grupo([{ nombre: 'Chicha' }, { nombre: 'CHICHA' }]),
    );
    expect(campos(repetidos)).toContain('modificadores.1');
    const idsRepetidos = grupoEntradaSchema.safeParse(
      grupo([
        { id: ID_1, nombre: 'Uno' },
        { id: ID_1, nombre: 'Dos' },
      ]),
    );
    expect(idsRepetidos.success).toBe(false);
  });

  it('valida el nombre del grupo, los ids y los campos desconocidos', () => {
    const base = {
      nombre: 'Bebida',
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [{ nombre: 'Chicha' }],
    } as const;
    expect(grupoEntradaSchema.safeParse({ ...base, nombre: 'a'.repeat(60) }).success).toBe(true);
    expect(grupoEntradaSchema.safeParse({ ...base, nombre: 'a'.repeat(61) }).success).toBe(false);
    expect(grupoEntradaSchema.safeParse({ ...base, nombre: ' ' }).success).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({ ...base, modificadores: [{ nombre: 'x', productoId: 'no' }] })
        .success,
    ).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({ ...base, modificadores: [{ nombre: 'x', productoId: null }] })
        .success,
    ).toBe(true);
    for (const extra of [{ empresaId: ID_1 }, { creadoPorUsuarioId: ID_1 }, { activo: true }]) {
      expect(grupoEntradaSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(
      grupoEntradaSchema.safeParse({ ...base, modificadores: [{ nombre: 'x', empresaId: ID_1 }] })
        .success,
    ).toBe(false);
    expect(
      grupoEntradaSchema.safeParse({ ...base, modificadores: [{ nombre: 'x', orden: 1 }] }).success,
    ).toBe(false);
  });
});

describe('grupoModificarEntradaSchema', () => {
  it('exige al menos un campo', () => {
    expect(grupoModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(grupoModificarEntradaSchema.safeParse({ activo: false }).success).toBe(true);
    expect(grupoModificarEntradaSchema.safeParse({ nombre: 'Otro' }).success).toBe(true);
  });

  it('con seleccion UNICA pide obligatorio y rechaza minimo y maximo', () => {
    expect(grupoModificarEntradaSchema.safeParse({ seleccion: 'UNICA' }).success).toBe(false);
    expect(
      grupoModificarEntradaSchema.safeParse({ seleccion: 'UNICA', obligatorio: false }).success,
    ).toBe(true);
    expect(
      grupoModificarEntradaSchema.safeParse({ seleccion: 'UNICA', obligatorio: true, minimo: 1 })
        .success,
    ).toBe(false);
  });

  it('con seleccion MULTIPLE pide minimo y maximo y rechaza obligatorio', () => {
    expect(
      grupoModificarEntradaSchema.safeParse({ seleccion: 'MULTIPLE', maximo: 2 }).success,
    ).toBe(false);
    expect(
      grupoModificarEntradaSchema.safeParse({ seleccion: 'MULTIPLE', minimo: 0, maximo: 2 })
        .success,
    ).toBe(true);
    expect(
      grupoModificarEntradaSchema.safeParse({
        seleccion: 'MULTIPLE',
        minimo: 0,
        maximo: 2,
        obligatorio: true,
      }).success,
    ).toBe(false);
    expect(
      grupoModificarEntradaSchema.safeParse({ seleccion: 'MULTIPLE', minimo: 3, maximo: 2 })
        .success,
    ).toBe(false);
  });

  it('valida la lista nueva de modificadores', () => {
    expect(grupoModificarEntradaSchema.safeParse({ modificadores: [] }).success).toBe(false);
    expect(
      grupoModificarEntradaSchema.safeParse({
        modificadores: [{ id: ID_1, nombre: 'Chicha', precioExtra: '1.00' }, { nombre: 'Nueva' }],
      }).success,
    ).toBe(true);
    expect(
      grupoModificarEntradaSchema.safeParse({
        seleccion: 'MULTIPLE',
        minimo: 3,
        maximo: 3,
        modificadores: [{ nombre: 'a' }, { nombre: 'b' }],
      }).success,
    ).toBe(false);
    expect(grupoModificarEntradaSchema.safeParse({ nombre: 'x', empresaId: ID_1 }).success).toBe(
      false,
    );
  });
});

describe('menú del día y agotados', () => {
  it('menuDelDiaEntrada: día opcional con fecha real y opciones sin repetir (puede ir vacía)', () => {
    expect(menuDelDiaEntradaSchema.safeParse({ opciones: [] }).success).toBe(true);
    expect(
      menuDelDiaEntradaSchema.safeParse({ dia: '2026-11-04', opciones: [ID_1, ID_2] }).success,
    ).toBe(true);
    expect(menuDelDiaEntradaSchema.safeParse({ dia: '2026-02-30', opciones: [] }).success).toBe(
      false,
    );
    expect(menuDelDiaEntradaSchema.safeParse({ dia: '04/11/2026', opciones: [] }).success).toBe(
      false,
    );
    expect(menuDelDiaEntradaSchema.safeParse({ opciones: [ID_1, ID_1] }).success).toBe(false);
    expect(menuDelDiaEntradaSchema.safeParse({}).success).toBe(false);
    expect(menuDelDiaEntradaSchema.safeParse({ opciones: [], sucursalId: ID_1 }).success).toBe(
      false,
    );
  });

  it('agotadoEntrada: hasta es FIN_DEL_DIA por defecto o REACTIVAR', () => {
    expect(agotadoEntradaSchema.parse({})).toEqual({ hasta: 'FIN_DEL_DIA' });
    expect(agotadoEntradaSchema.parse({ hasta: 'REACTIVAR' })).toEqual({ hasta: 'REACTIVAR' });
    expect(agotadoEntradaSchema.safeParse({ hasta: 'MAÑANA' }).success).toBe(false);
    expect(agotadoEntradaSchema.safeParse({ sucursalId: ID_1 }).success).toBe(false);
    expect(agotadoEntradaSchema.safeParse({ origen: 'SIN_STOCK' }).success).toBe(false);
  });

  it('agotadoRespuesta y menuDelDiaRespuesta aceptan su forma', () => {
    expect(
      agotadoRespuestaSchema.safeParse({
        productoId: ID_1,
        sucursalId: ID_2,
        desde: AHORA,
        hasta: 'FIN_DEL_DIA',
        diaOperativo: '2026-11-03',
        origen: 'MANUAL',
      }).success,
    ).toBe(true);
    expect(
      menuDelDiaRespuestaSchema.safeParse({
        productoId: ID_1,
        nombre: 'Menú del día',
        precio: '12.00',
        dia: '2026-11-03',
        grupos: [
          {
            id: ID_2,
            nombre: 'Entrada',
            minimo: 1,
            maximo: 1,
            opciones: [
              {
                modificadorId: ID_3,
                nombre: 'Sopa',
                precioExtra: '0.00',
                producto: { id: ID_1, nombre: 'Sopa criolla' },
                elegida: true,
                disponible: true,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('respuestas de producto, vista y línea preparada', () => {
  const resumen = {
    id: ID_1,
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    familiaId: ID_2,
    precio: '28.00',
    seVendeSolo: true,
    estacionId: null,
    tipoControlStock: 'PORCIONES',
    fotoUrl: null,
    activo: true,
    orden: 1,
  };

  it('productoResumen y productoRespuesta', () => {
    expect(productoResumenSchema.safeParse(resumen).success).toBe(true);
    expect(productoResumenSchema.safeParse({ ...resumen, tipo: 'KIT' }).success).toBe(false);
    expect(
      productoRespuestaSchema.safeParse({
        ...resumen,
        descripcion: null,
        afectacionIgv: 'GRAVADO',
        aplicaIcbper: false,
        grupos: [{ id: ID_3, nombre: 'Término' }],
        componentes: [],
        usadoEn: { combos: [], modificadores: [] },
        creadoEn: AHORA,
        actualizadoEn: AHORA,
      }).success,
    ).toBe(true);
  });

  it('cartaSucursalRespuesta acepta un producto de venta completo', () => {
    const producto = {
      id: ID_1,
      tipo: 'COMBO',
      nombre: 'Combo hamburguesa',
      descripcion: null,
      fotoUrl: 'https://archivos.ejemplo.pe/carta/x.jpg',
      precio: '22.90',
      seVendeSolo: true,
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: null,
      tipoControlStock: 'SIN_CONTROL',
      agotado: { desde: AHORA, hasta: 'FIN_DEL_DIA', origen: 'MANUAL' },
      vendible: false,
      motivo: 'AGOTADO',
      grupos: [
        {
          id: ID_2,
          nombre: 'Bebida',
          seleccion: 'UNICA',
          minimo: 1,
          maximo: 1,
          obligatorio: true,
          modificadores: [
            { id: ID_3, nombre: 'Chicha', precioExtra: '0.00', productoId: null, disponible: true },
          ],
        },
      ],
      componentes: [
        {
          productoId: ID_3,
          nombre: 'Hamburguesa',
          cantidad: 1,
          estacionId: ID_2,
          disponible: false,
        },
      ],
    };
    const vista = {
      sucursalId: ID_1,
      diaOperativo: '2026-11-03',
      estaciones: [{ id: ID_2, nombre: 'Cocina' }],
      familias: [{ id: ID_3, nombre: 'Combos', productos: [producto] }],
    };
    expect(cartaSucursalRespuestaSchema.safeParse(vista).success).toBe(true);
    const sinMotivo = {
      ...vista,
      familias: [{ ...vista.familias[0]!, productos: [{ ...producto, motivo: 'X' }] }],
    };
    expect(cartaSucursalRespuestaSchema.safeParse(sinMotivo).success).toBe(false);
  });

  it('lineaPreparada limita la cantidad a 1..999 y trae los montos como texto', () => {
    const linea = {
      productoId: ID_1,
      nombre: 'Lomo saltado',
      tipo: 'SIMPLE',
      cantidad: 2,
      precioUnitario: '33.50',
      total: '67.00',
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: ID_2,
      tipoControlStock: 'PORCIONES',
      modificadores: [
        {
          id: ID_3,
          nombre: 'Huevo',
          grupoId: ID_2,
          grupoNombre: 'Extras',
          precioExtra: '2.50',
          productoLigado: {
            id: ID_1,
            nombre: 'Huevo frito',
            estacionId: null,
            tipoControlStock: 'UNIDADES',
          },
        },
      ],
      componentes: [],
    };
    expect(lineaPreparadaSchema.safeParse(linea).success).toBe(true);
    expect(lineaPreparadaSchema.safeParse({ ...linea, cantidad: 999 }).success).toBe(true);
    expect(lineaPreparadaSchema.safeParse({ ...linea, cantidad: 1000 }).success).toBe(false);
    expect(lineaPreparadaSchema.safeParse({ ...linea, cantidad: 0 }).success).toBe(false);
    expect(lineaPreparadaSchema.safeParse({ ...linea, total: 67 }).success).toBe(false);
  });
});

describe('eventos', () => {
  it('carta.disponibilidad va en la sala de una sucursal', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'sucursal', sucursalId: ID_2 },
      nombre: 'carta.disponibilidad',
      datos: {
        sucursalId: ID_2,
        productoId: ID_3,
        agotado: true,
        hasta: 'REACTIVAR',
        origen: 'MANUAL',
      },
    };
    expect(eventoDisponibilidadSchema.safeParse(evento).success).toBe(true);
    expect(
      eventoDisponibilidadSchema.safeParse({
        ...evento,
        datos: { ...evento.datos, agotado: false, hasta: null, origen: null },
      }).success,
    ).toBe(true);
    expect(
      eventoDisponibilidadSchema.safeParse({ ...evento, sala: { tipo: 'empresa' } }).success,
    ).toBe(false);
    expect(
      eventoDisponibilidadSchema.safeParse({ ...evento, nombre: 'carta.actualizada' }).success,
    ).toBe(false);
    const { empresaId, ...sinEmpresa } = evento;
    void empresaId;
    expect(eventoDisponibilidadSchema.safeParse(sinEmpresa).success).toBe(false);
  });

  it('carta.actualizada va en la sala de la empresa o de una sucursal, con sucursalId o null', () => {
    const base = { empresaId: ID_1, nombre: 'carta.actualizada' } as const;
    expect(
      eventoCartaActualizadaSchema.safeParse({
        ...base,
        sala: { tipo: 'empresa' },
        datos: { sucursalId: null },
      }).success,
    ).toBe(true);
    expect(
      eventoCartaActualizadaSchema.safeParse({
        ...base,
        sala: { tipo: 'sucursal', sucursalId: ID_2 },
        datos: { sucursalId: ID_2 },
      }).success,
    ).toBe(true);
    expect(
      eventoCartaActualizadaSchema.safeParse({
        ...base,
        sala: { tipo: 'empresa' },
        datos: {},
      }).success,
    ).toBe(false);
  });
});
