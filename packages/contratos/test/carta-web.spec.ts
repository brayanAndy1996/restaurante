import { describe, expect, it } from 'vitest';
import {
  cartaPublicaSchema,
  cartaWebEntradaSchema,
  cartaWebRespuestaSchema,
  cartaWebSucursalEntradaSchema,
  disponibilidadPublicaSchema,
  empresaPublicaSchema,
  productoPublicoSchema,
  qrMesaRespuestaSchema,
  qrMesasRespuestaSchema,
  slugDeRutaSchema,
  slugSchema,
} from '../src';

// Esquemas de la carta web (historia 005, criterios 1 a 9 y 18 a 23): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';
const INSTANTE = '2026-11-03T20:00:00.000Z';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('slugSchema (criterio 2)', () => {
  it.each(['sabor-norteno', 'miraflores', 'abc'])('acepta %s', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['ab', 'x'.repeat(41), 'Sabor', '-sabor', 'sabor-', 'sa--bor', 'sa bor', 'sa_bor', ''])(
    'rechaza %j',
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it('rechaza una dirección reservada con un mensaje propio', () => {
    for (const reservada of ['api', 'publico', 'carta', 'favicon']) {
      const resultado = slugSchema.safeParse(reservada);
      expect(resultado.success, reservada).toBe(false);
    }
    expect(slugSchema.safeParse('carta').error?.issues[0]?.message).toContain('reservada');
  });

  it('no pasa a minúsculas', () => {
    expect(slugSchema.safeParse('Miraflores').success).toBe(false);
  });
});

describe('slugDeRutaSchema (criterio 14)', () => {
  it('acepta la forma con mayúsculas (la API pasa a minúsculas al buscar)', () => {
    expect(slugDeRutaSchema.safeParse('Sabor-Norteno').success).toBe(true);
    expect(slugDeRutaSchema.safeParse('sabor-norteno').success).toBe(true);
  });

  it.each([
    'ab',
    'x'.repeat(41),
    'sa%20bor',
    'sa/bor',
    'sa--bor',
    '-ab',
    'ab-',
    'sa bor',
    "a'b",
    '..',
  ])('rechaza %j', (slug) => {
    expect(slugDeRutaSchema.safeParse(slug).success).toBe(false);
  });
});

describe('cartaWebEntradaSchema (criterio 2)', () => {
  const valida = { nombre: 'Sabor Norteño', slug: 'sabor-norteno', colorPrincipal: '#b3261e' };

  it('acepta una configuración válida y guarda el color en mayúsculas', () => {
    const resultado = cartaWebEntradaSchema.safeParse(valida);
    expect(resultado.success).toBe(true);
    expect(resultado.data?.colorPrincipal).toBe('#B3261E');
  });

  it('recorta el nombre y rechaza uno vacío o de más de 80 caracteres', () => {
    expect(cartaWebEntradaSchema.parse({ ...valida, nombre: '  Sabor  ' }).nombre).toBe('Sabor');
    expect(campos(cartaWebEntradaSchema.safeParse({ ...valida, nombre: '   ' }))).toEqual([
      'nombre',
    ]);
    expect(cartaWebEntradaSchema.safeParse({ ...valida, nombre: 'x'.repeat(80) }).success).toBe(
      true,
    );
    expect(cartaWebEntradaSchema.safeParse({ ...valida, nombre: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });

  it('rechaza una dirección mala o reservada con el campo en `campos`', () => {
    expect(campos(cartaWebEntradaSchema.safeParse({ ...valida, slug: 'Sabor' }))).toEqual(['slug']);
    expect(campos(cartaWebEntradaSchema.safeParse({ ...valida, slug: 'admin' }))).toEqual(['slug']);
  });

  it.each(['B3261E', '#B3261', '#B3261EE', '#GGGGGG', 'rojo', ''])(
    'rechaza el color %j',
    (color) => {
      expect(campos(cartaWebEntradaSchema.safeParse({ ...valida, colorPrincipal: color }))).toEqual(
        ['colorPrincipal'],
      );
    },
  );

  it('exige los tres campos y rechaza los desconocidos', () => {
    expect(cartaWebEntradaSchema.safeParse({ nombre: 'x', slug: 'abc' }).success).toBe(false);
    expect(cartaWebEntradaSchema.safeParse({ ...valida, empresaId: ID_1 }).success).toBe(false);
    expect(cartaWebEntradaSchema.safeParse({ ...valida, logoUrl: 'x' }).success).toBe(false);
  });
});

describe('cartaWebSucursalEntradaSchema (criterio 4)', () => {
  it('acepta slug y publicada', () => {
    expect(
      cartaWebSucursalEntradaSchema.safeParse({ slug: 'miraflores', publicada: true }).success,
    ).toBe(true);
  });

  it('exige publicada booleano, el slug válido y rechaza campos desconocidos', () => {
    expect(cartaWebSucursalEntradaSchema.safeParse({ slug: 'miraflores' }).success).toBe(false);
    expect(
      cartaWebSucursalEntradaSchema.safeParse({ slug: 'miraflores', publicada: 'si' }).success,
    ).toBe(false);
    expect(cartaWebSucursalEntradaSchema.safeParse({ slug: 'Mira', publicada: true }).success).toBe(
      false,
    );
    expect(
      cartaWebSucursalEntradaSchema.safeParse({
        slug: 'miraflores',
        publicada: true,
        sucursalId: ID_1,
      }).success,
    ).toBe(false);
  });
});

describe('cartaWebRespuestaSchema (criterio 1)', () => {
  it('acepta la respuesta sin configurar', () => {
    const sinConfigurar = {
      configurada: false,
      nombre: null,
      slug: null,
      colorPrincipal: '#1D4A9E',
      logoUrl: null,
      url: null,
      sucursales: [
        { sucursalId: ID_1, nombre: 'Miraflores', slug: null, publicada: false, url: null },
      ],
    };
    expect(cartaWebRespuestaSchema.safeParse(sinConfigurar).success).toBe(true);
  });

  it('exige UUID en el id de la sucursal', () => {
    expect(
      cartaWebRespuestaSchema.safeParse({
        configurada: true,
        nombre: 'Sabor',
        slug: 'sabor',
        colorPrincipal: '#1D4A9E',
        logoUrl: null,
        url: 'http://localhost:3001/sabor',
        sucursales: [{ sucursalId: 'x', nombre: 'A', slug: null, publicada: false, url: null }],
      }).success,
    ).toBe(false);
  });
});

describe('QR de las mesas (criterios 7 a 9)', () => {
  const codigo = 'AbCdEfGhIjKlMnOpQrStUv';

  it('acepta una hoja con mesas con y sin código', () => {
    const hoja = {
      sucursal: { id: ID_1, nombre: 'Miraflores' },
      cartaPublicada: true,
      mesas: [
        {
          mesaId: ID_2,
          zona: { id: ID_3, nombre: 'Salón principal' },
          nombre: '4',
          codigo,
          url: `http://localhost:3001/m/${codigo}`,
          generadoEn: INSTANTE,
        },
        {
          mesaId: ID_3,
          zona: { id: ID_3, nombre: 'Salón principal' },
          nombre: '12',
          codigo: null,
          url: null,
          generadoEn: null,
        },
      ],
    };
    expect(qrMesasRespuestaSchema.safeParse(hoja).success).toBe(true);
  });

  it('la respuesta de cambiar el QR exige código, URL e instante', () => {
    const base = {
      mesaId: ID_1,
      codigo,
      url: `http://localhost:3001/m/${codigo}`,
      generadoEn: INSTANTE,
    };
    expect(qrMesaRespuestaSchema.safeParse(base).success).toBe(true);
    expect(qrMesaRespuestaSchema.safeParse({ ...base, codigo: null }).success).toBe(false);
    expect(qrMesaRespuestaSchema.safeParse({ ...base, generadoEn: 'ayer' }).success).toBe(false);
  });
});

describe('respuestas públicas estrictas (criterios 18 a 23)', () => {
  const marca = { nombre: 'Sabor Norteño', logoUrl: null, colorPrincipal: '#B3261E' };
  const producto = {
    id: ID_1,
    tipo: 'COMBO' as const,
    nombre: 'Combo hamburguesa',
    descripcion: null,
    fotoUrl: null,
    precio: '28.00',
    grupos: [
      {
        id: ID_2,
        nombre: 'Bebida',
        seleccion: 'UNICA' as const,
        minimo: 1,
        maximo: 1,
        obligatorio: true,
        modificadores: [{ id: ID_3, nombre: 'Gaseosa', precioExtra: '0.00' }],
      },
    ],
    componentes: [{ nombre: 'Hamburguesa clásica', cantidad: 1 }],
  };
  const carta = {
    empresa: marca,
    sucursal: {
      nombre: 'Miraflores',
      slug: 'miraflores',
      direccion: 'Av. Larco 123',
      horario: [{ dia: 1, desde: '12:00', hasta: '23:00' }],
      abiertaAhora: true,
    },
    familias: [{ id: ID_2, nombre: 'Combos', productos: [producto] }],
  };

  it('acepta la carta completa y una sucursal sin horario', () => {
    expect(cartaPublicaSchema.safeParse(carta).success).toBe(true);
    expect(
      cartaPublicaSchema.safeParse({
        ...carta,
        sucursal: { ...carta.sucursal, horario: [], abiertaAhora: null },
      }).success,
    ).toBe(true);
  });

  it('rechaza una clave de más en cada nivel (criterio 21)', () => {
    const conDeMas = (mutar: (c: typeof carta) => void): boolean => {
      const copia = structuredClone(carta);
      mutar(copia);
      return cartaPublicaSchema.safeParse(copia).success;
    };
    const asAny = (x: unknown) => x as Record<string, unknown>;
    expect(conDeMas((c) => (asAny(c).sucursalId = ID_1))).toBe(false);
    expect(conDeMas((c) => (asAny(c.empresa).empresaId = ID_1))).toBe(false);
    expect(conDeMas((c) => (asAny(c.sucursal).establecimiento = '0001'))).toBe(false);
    expect(conDeMas((c) => (asAny(c.sucursal.horario[0]).corte = '05:00'))).toBe(false);
    expect(conDeMas((c) => (asAny(c.familias[0]).estacionId = ID_1))).toBe(false);
    for (const clave of [
      'estacionId',
      'tipoControlStock',
      'afectacionIgv',
      'aplicaIcbper',
      'agotado',
      'vendible',
      'motivo',
    ]) {
      expect(
        conDeMas((c) => (asAny(c.familias[0]!.productos[0])[clave] = 'x')),
        clave,
      ).toBe(false);
    }
    expect(
      conDeMas(
        (c) =>
          (asAny(c.familias[0]!.productos[0]!.grupos[0]!.modificadores[0])['productoId'] = ID_1),
      ),
    ).toBe(false);
    expect(
      conDeMas(
        (c) =>
          (asAny(c.familias[0]!.productos[0]!.grupos[0]!.modificadores[0])['disponible'] = true),
      ),
    ).toBe(false);
    expect(
      conDeMas((c) => (asAny(c.familias[0]!.productos[0]!.componentes[0])['productoId'] = ID_1)),
    ).toBe(false);
  });

  it('el producto exige precio (solo salen los que se venden solos)', () => {
    expect(productoPublicoSchema.safeParse({ ...producto, precio: null }).success).toBe(false);
  });

  it('empresaPublica: marca y sucursales, sin claves de más', () => {
    const base = {
      empresa: marca,
      sucursales: [{ nombre: 'Miraflores', slug: 'miraflores', direccion: 'Av. Larco 123' }],
    };
    expect(empresaPublicaSchema.safeParse(base).success).toBe(true);
    expect(
      empresaPublicaSchema.safeParse({
        ...base,
        sucursales: [{ ...base.sucursales[0], sucursalId: ID_1 }],
      }).success,
    ).toBe(false);
    expect(empresaPublicaSchema.safeParse({ ...base, empresaId: ID_1 }).success).toBe(false);
  });

  it('disponibilidadPublica: ids y modificadores no disponibles, sin claves de más', () => {
    const base = { vendibles: [{ id: ID_1, modificadoresNoDisponibles: [ID_2] }] };
    expect(disponibilidadPublicaSchema.safeParse(base).success).toBe(true);
    expect(disponibilidadPublicaSchema.safeParse({ vendibles: [] }).success).toBe(true);
    expect(
      disponibilidadPublicaSchema.safeParse({
        vendibles: [{ id: ID_1, modificadoresNoDisponibles: [], nombre: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      disponibilidadPublicaSchema.safeParse({ ...base, diaOperativo: '2026-11-03' }).success,
    ).toBe(false);
  });
});
