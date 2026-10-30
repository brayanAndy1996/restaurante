import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  abrirOrdenEntradaSchema,
  anularItemEntradaSchema,
  anularOrdenEntradaSchema,
  cocinaConsultaSchema,
  envioEntradaSchema,
  errorRespuestaSchema,
  estadoLineaEntradaSchema,
  eventoCocinaListoSchema,
  eventoCocinaVistoSchema,
  eventoSalonCambioSchema,
  marchaEntradaSchema,
  mesaEntradaSchema,
  mesaModificarEntradaSchema,
  moverEntradaSchema,
  ordenModificarEntradaSchema,
  precuentaEntradaSchema,
  precuentaRespuestaSchema,
  stockSalonConsultaSchema,
  unirEntradaSchema,
  zonaEntradaSchema,
  zonaModificarEntradaSchema,
} from '../src';

// Esquemas de Salón y Cocina (historia 004, entrega 3a): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('zonaEntradaSchema y zonaModificarEntradaSchema (criterios 1 y 2)', () => {
  it('acepta nombre de 1 a 40, columnas de 2 a 12 y filas de 1 a 30', () => {
    expect(zonaEntradaSchema.safeParse({ nombre: 'Salón', columnas: 2, filas: 1 }).success).toBe(
      true,
    );
    expect(
      zonaEntradaSchema.safeParse({ nombre: 'a'.repeat(40), columnas: 12, filas: 30 }).success,
    ).toBe(true);
  });

  it('rechaza los límites cruzados, los decimales y los campos desconocidos', () => {
    const malos = [
      { nombre: '', columnas: 4, filas: 4 },
      { nombre: 'a'.repeat(41), columnas: 4, filas: 4 },
      { nombre: 'Salón', columnas: 1, filas: 4 },
      { nombre: 'Salón', columnas: 13, filas: 4 },
      { nombre: 'Salón', columnas: 4, filas: 0 },
      { nombre: 'Salón', columnas: 4, filas: 31 },
      { nombre: 'Salón', columnas: 4.5, filas: 4 },
      { nombre: 'Salón', columnas: '4', filas: 4 },
      { nombre: 'Salón', columnas: 4, filas: 4, empresaId: ID_1 },
    ];
    for (const malo of malos) {
      expect(zonaEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('el PATCH exige al menos un campo y respeta los mismos límites', () => {
    expect(zonaModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(zonaModificarEntradaSchema.safeParse({ activa: false }).success).toBe(true);
    expect(zonaModificarEntradaSchema.safeParse({ columnas: 13 }).success).toBe(false);
    expect(zonaModificarEntradaSchema.safeParse({ activa: 'no' }).success).toBe(false);
  });
});

describe('mesaEntradaSchema y mesaModificarEntradaSchema (criterios 3 y 4)', () => {
  const buena = { nombre: '12', capacidad: 4, forma: 'REDONDA', columna: 1, fila: 1 };

  it('acepta una mesa válida', () => {
    expect(mesaEntradaSchema.safeParse(buena).success).toBe(true);
  });

  it('rechaza nombre, capacidad, forma o celda fuera de rango', () => {
    const malos = [
      { ...buena, nombre: '' },
      { ...buena, nombre: 'a'.repeat(21) },
      { ...buena, capacidad: 0 },
      { ...buena, capacidad: 51 },
      { ...buena, forma: 'TRIANGULAR' },
      { ...buena, columna: 0 },
      { ...buena, fila: 0 },
      { ...buena, columna: 13 },
      { ...buena, fila: 31 },
      { ...buena, extra: true },
    ];
    for (const malo of malos) {
      expect(mesaEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('el PATCH exige al menos un campo y acepta cambiar de zona', () => {
    expect(mesaModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(mesaModificarEntradaSchema.safeParse({ zonaId: ID_1, columna: 2 }).success).toBe(true);
    expect(mesaModificarEntradaSchema.safeParse({ zonaId: 'no-es-uuid' }).success).toBe(false);
  });
});

describe('abrirOrdenEntradaSchema y ordenModificarEntradaSchema (criterios 9, 10 y 13)', () => {
  it('acepta comensales de 1 a 99 y un mozoId opcional', () => {
    expect(
      abrirOrdenEntradaSchema.safeParse({ id: ID_1, mesaId: ID_2, comensales: 1 }).success,
    ).toBe(true);
    expect(
      abrirOrdenEntradaSchema.safeParse({ id: ID_1, mesaId: ID_2, comensales: 99, mozoId: ID_3 })
        .success,
    ).toBe(true);
  });

  it('rechaza comensales fuera de rango, ids que no son UUID y campos desconocidos', () => {
    for (const malo of [
      { id: ID_1, mesaId: ID_2, comensales: 0 },
      { id: ID_1, mesaId: ID_2, comensales: 100 },
      { id: ID_1, mesaId: ID_2, comensales: 2.5 },
      { id: 'x', mesaId: ID_2, comensales: 2 },
      { id: ID_1, comensales: 2 },
      { id: ID_1, mesaId: ID_2, comensales: 2, sucursalId: ID_3 },
      { id: ID_1, mesaId: ID_2, comensales: 2, creadoPorUsuarioId: ID_3 },
    ]) {
      expect(abrirOrdenEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('el PATCH de la orden solo acepta comensales de 1 a 99', () => {
    expect(ordenModificarEntradaSchema.safeParse({ comensales: 5 }).success).toBe(true);
    expect(ordenModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(ordenModificarEntradaSchema.safeParse({ comensales: 100 }).success).toBe(false);
  });
});

describe('envioEntradaSchema (criterio 15)', () => {
  const linea = { productoId: ID_2, modificadorIds: [], cantidad: 1 };

  it('aplica tiempo 1 y paraLlevar false por defecto', () => {
    const envio = envioEntradaSchema.parse({ id: ID_1, lineas: [linea] });
    expect(envio.lineas[0]).toMatchObject({ tiempo: 1, paraLlevar: false });
    expect(envio.lineas[0]?.observacion).toBeUndefined();
  });

  it('acepta de 1 a 50 líneas', () => {
    expect(envioEntradaSchema.safeParse({ id: ID_1, lineas: [] }).success).toBe(false);
    expect(
      envioEntradaSchema.safeParse({ id: ID_1, lineas: Array.from({ length: 50 }, () => linea) })
        .success,
    ).toBe(true);
    expect(
      envioEntradaSchema.safeParse({ id: ID_1, lineas: Array.from({ length: 51 }, () => linea) })
        .success,
    ).toBe(false);
  });

  it('limita la cantidad de 1 a 999, el tiempo a 1 o 2 y la observación a 140', () => {
    const rechazadas = [
      { ...linea, cantidad: 0 },
      { ...linea, cantidad: 1000 },
      { ...linea, cantidad: 1.5 },
      { ...linea, tiempo: 3 },
      { ...linea, tiempo: '1' },
      { ...linea, observacion: '' },
      { ...linea, observacion: 'a'.repeat(141) },
      { ...linea, paraLlevar: 'si' },
      { ...linea, precio: '1.00' },
    ];
    for (const mala of rechazadas) {
      expect(
        envioEntradaSchema.safeParse({ id: ID_1, lineas: [mala] }).success,
        JSON.stringify(mala),
      ).toBe(false);
    }
    for (const buena of [
      { ...linea, cantidad: 999 },
      { ...linea, tiempo: 2 },
      { ...linea, observacion: 'a'.repeat(140), paraLlevar: true },
    ]) {
      expect(
        envioEntradaSchema.safeParse({ id: ID_1, lineas: [buena] }).success,
        JSON.stringify(buena),
      ).toBe(true);
    }
  });

  it('exige modificadorIds, de hasta 30 y sin repetir (sin distinguir mayúsculas)', () => {
    const sinLista = { productoId: ID_2, cantidad: 1 };
    expect(envioEntradaSchema.safeParse({ id: ID_1, lineas: [sinLista] }).success).toBe(false);
    const ids = Array.from(
      { length: 31 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(
      envioEntradaSchema.safeParse({
        id: ID_1,
        lineas: [{ ...linea, modificadorIds: ids.slice(0, 30) }],
      }).success,
    ).toBe(true);
    expect(
      envioEntradaSchema.safeParse({ id: ID_1, lineas: [{ ...linea, modificadorIds: ids }] })
        .success,
    ).toBe(false);
    const repetido = envioEntradaSchema.safeParse({
      id: ID_1,
      lineas: [{ ...linea, modificadorIds: [ID_3, ID_3.toUpperCase()] }],
    });
    expect(repetido.success).toBe(false);
    expect(campos(repetido)).toContain('lineas.0.modificadorIds.1');
  });

  it('el id del envío es obligatorio y no admite campos desconocidos', () => {
    expect(envioEntradaSchema.safeParse({ lineas: [linea] }).success).toBe(false);
    expect(envioEntradaSchema.safeParse({ id: ID_1, lineas: [linea], ordenId: ID_2 }).success).toBe(
      false,
    );
  });
});

describe('marchaEntradaSchema (criterio 32)', () => {
  it('itemIds es opcional; si viene, no puede estar vacío ni repetir ids', () => {
    expect(marchaEntradaSchema.safeParse({ id: ID_1 }).success).toBe(true);
    expect(marchaEntradaSchema.safeParse({ id: ID_1, itemIds: [ID_2, ID_3] }).success).toBe(true);
    expect(marchaEntradaSchema.safeParse({ id: ID_1, itemIds: [] }).success).toBe(false);
    expect(marchaEntradaSchema.safeParse({ id: ID_1, itemIds: [ID_2, ID_2] }).success).toBe(false);
    expect(marchaEntradaSchema.safeParse({ itemIds: [ID_2] }).success).toBe(false);
  });
});

describe('anularItemEntradaSchema y anularOrdenEntradaSchema (criterios 35 y 42)', () => {
  const buena = { id: ID_1, cantidad: 1, motivo: 'Cliente se arrepintió', destinoStock: 'VUELVE' };

  it('acepta cantidad entera de 1 en adelante, motivo de 1 a 300 y destino VUELVE o MERMA', () => {
    expect(anularItemEntradaSchema.safeParse(buena).success).toBe(true);
    expect(anularItemEntradaSchema.safeParse({ ...buena, destinoStock: 'MERMA' }).success).toBe(
      true,
    );
    expect(anularItemEntradaSchema.safeParse({ ...buena, motivo: 'a'.repeat(300) }).success).toBe(
      true,
    );
  });

  it('rechaza cantidad 0 o decimal, motivo vacío o largo, destino desconocido y sin destino', () => {
    for (const malo of [
      { ...buena, cantidad: 0 },
      { ...buena, cantidad: 1.5 },
      { ...buena, motivo: '' },
      { ...buena, motivo: '   ' },
      { ...buena, motivo: 'a'.repeat(301) },
      { ...buena, destinoStock: 'TIRAR' },
      { id: ID_1, cantidad: 1, motivo: 'x' },
      { ...buena, autorizadoPorId: ID_2 },
    ]) {
      expect(anularItemEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('anular la orden pide motivo y destino del stock', () => {
    expect(anularOrdenEntradaSchema.safeParse({ motivo: 'x', destinoStock: 'MERMA' }).success).toBe(
      true,
    );
    expect(anularOrdenEntradaSchema.safeParse({ motivo: 'x' }).success).toBe(false);
    expect(anularOrdenEntradaSchema.safeParse({ destinoStock: 'MERMA' }).success).toBe(false);
  });
});

describe('moverEntradaSchema, unirEntradaSchema y precuentaEntradaSchema (criterios 45, 46 y 50)', () => {
  it('mover pide la mesa de destino y acepta la de origen', () => {
    expect(moverEntradaSchema.safeParse({ mesaDestinoId: ID_1 }).success).toBe(true);
    expect(moverEntradaSchema.safeParse({ mesaOrigenId: ID_2, mesaDestinoId: ID_1 }).success).toBe(
      true,
    );
    expect(moverEntradaSchema.safeParse({ mesaOrigenId: ID_2 }).success).toBe(false);
  });

  it('unir acepta de 1 a 19 mesas sin repetir', () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(unirEntradaSchema.safeParse({ mesaIds: [] }).success).toBe(false);
    expect(unirEntradaSchema.safeParse({ mesaIds: ids.slice(0, 19) }).success).toBe(true);
    expect(unirEntradaSchema.safeParse({ mesaIds: ids }).success).toBe(false);
    expect(unirEntradaSchema.safeParse({ mesaIds: [ID_1, ID_1] }).success).toBe(false);
  });

  it('la pre-cuenta solo lleva su id', () => {
    expect(precuentaEntradaSchema.safeParse({ id: ID_1 }).success).toBe(true);
    expect(precuentaEntradaSchema.safeParse({}).success).toBe(false);
    expect(precuentaEntradaSchema.safeParse({ id: ID_1, total: '1.00' }).success).toBe(false);
  });
});

describe('cocina: estadoLineaEntradaSchema y las consultas con listas de ids (criterios 56 y 58)', () => {
  it('la pantalla elige ENVIADO, EN_PREPARACION o LISTO; nunca ANULADO', () => {
    for (const estado of ['ENVIADO', 'EN_PREPARACION', 'LISTO']) {
      expect(estadoLineaEntradaSchema.safeParse({ estado }).success, estado).toBe(true);
    }
    expect(estadoLineaEntradaSchema.safeParse({ estado: 'ANULADO' }).success).toBe(false);
    expect(estadoLineaEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('estacionIds acepta ausente, texto con comas o una lista repetida', () => {
    expect(cocinaConsultaSchema.parse({})).toEqual({ estacionIds: [] });
    expect(cocinaConsultaSchema.parse({ estacionIds: `${ID_1},${ID_2}` })).toEqual({
      estacionIds: [ID_1, ID_2],
    });
    expect(cocinaConsultaSchema.parse({ estacionIds: [ID_1, ID_2] })).toEqual({
      estacionIds: [ID_1, ID_2],
    });
    expect(cocinaConsultaSchema.safeParse({ estacionIds: 'no-es-uuid' }).success).toBe(false);
  });

  it('productoIds del stock se lee igual', () => {
    expect(stockSalonConsultaSchema.parse({ productoIds: ID_1 })).toEqual({ productoIds: [ID_1] });
    expect(stockSalonConsultaSchema.safeParse({ productoIds: 'x,y' }).success).toBe(false);
  });
});

describe('eventos de Salón y Cocina (criterios 14, 31 y 60)', () => {
  it('salon.cambio lleva las mesas y la orden en la sala de la sucursal', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'sucursal', sucursalId: ID_2 },
      nombre: 'salon.cambio',
      datos: { mesaIds: [ID_3], ordenId: ID_3 },
    };
    expect(eventoSalonCambioSchema.safeParse(evento).success).toBe(true);
    expect(
      eventoSalonCambioSchema.safeParse({ ...evento, sala: { tipo: 'empresa' } }).success,
    ).toBe(false);
  });

  it('cocina.listo lleva los destinatarios', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'sucursal', sucursalId: ID_2 },
      nombre: 'cocina.listo',
      datos: {
        ordenId: ID_3,
        itemId: ID_3,
        lineaId: ID_3,
        mesas: [{ id: ID_3, nombre: '4' }],
        nombre: 'Lomo saltado',
        cantidad: 1,
        destinatarios: [ID_1, ID_2],
      },
    };
    expect(eventoCocinaListoSchema.safeParse(evento).success).toBe(true);
    expect(
      eventoCocinaListoSchema.safeParse({
        ...evento,
        datos: { ...evento.datos, destinatarios: 'x' },
      }).success,
    ).toBe(false);
  });
});

describe('cocina.visto (criterio 59)', () => {
  it('lleva solo el id de la comanda, en la sala de la sucursal', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'sucursal', sucursalId: ID_2 },
      nombre: 'cocina.visto',
      datos: { comandaId: ID_3 },
    };
    expect(eventoCocinaVistoSchema.safeParse(evento).success).toBe(true);
    expect(
      eventoCocinaVistoSchema.safeParse({ ...evento, datos: { comandaId: 'x' } }).success,
    ).toBe(false);
    expect(eventoCocinaVistoSchema.safeParse({ ...evento, datos: {} }).success).toBe(false);
  });
});

describe('códigos de error de 3a y ordenId (criterios 11, 29 y los de la tabla de errores)', () => {
  it('incluye los códigos nuevos', () => {
    for (const codigo of [
      'MESA_OCUPADA',
      'ORDEN_NO_ABIERTA',
      'ORDEN_SIN_CONSUMO',
      'ORDEN_CON_CONSUMO',
      'NADA_QUE_MARCHAR',
      'ITEM_NO_ANULABLE',
      'TRANSICION_INVALIDA',
      'MONTO_FUERA_DE_RANGO',
    ]) {
      expect(CODIGOS_ERROR as readonly string[], codigo).toContain(codigo);
    }
  });

  it('el cuerpo de error admite ordenId opcional y lo exige UUID', () => {
    const base = { codigo: 'MESA_OCUPADA', mensaje: 'La mesa ya tiene una cuenta abierta' };
    expect(errorRespuestaSchema.safeParse(base).success).toBe(true);
    expect(errorRespuestaSchema.safeParse({ ...base, ordenId: ID_1 }).success).toBe(true);
    expect(errorRespuestaSchema.safeParse({ ...base, ordenId: 'x' }).success).toBe(false);
  });
});

describe('precuentaRespuestaSchema · impresion (criterio 102)', () => {
  const base = {
    id: ID_1,
    numero: 1,
    emitidaEn: '2026-10-29T17:10:00.000Z',
    orden: {
      id: ID_2,
      mesas: [{ id: ID_3, nombre: '4' }],
      mozo: { id: ID_1, nombre: 'Ana' },
      comensales: 2,
    },
    lineas: [],
    total: '0.00',
    nota: 'x',
    trabajoId: null,
  };

  it('exige trabajoId: el id del trabajo PRECUENTA o null', () => {
    const { trabajoId: _omitido, ...sin } = base;
    void _omitido;
    expect(precuentaRespuestaSchema.safeParse({ ...sin, impresion: 'SIN_IMPRESORA' }).success).toBe(
      false,
    );
    expect(
      precuentaRespuestaSchema.safeParse({ ...base, impresion: 'EN_COLA', trabajoId: ID_1 })
        .success,
    ).toBe(true);
    expect(
      precuentaRespuestaSchema.safeParse({ ...base, impresion: 'EN_COLA', trabajoId: 'no-uuid' })
        .success,
    ).toBe(false);
  });

  it('exige impresion y acepta EN_COLA y SIN_IMPRESORA', () => {
    expect(precuentaRespuestaSchema.safeParse({ ...base, impresion: 'EN_COLA' }).success).toBe(
      true,
    );
    expect(
      precuentaRespuestaSchema.safeParse({ ...base, impresion: 'SIN_IMPRESORA' }).success,
    ).toBe(true);
    expect(precuentaRespuestaSchema.safeParse(base).success).toBe(false);
    expect(precuentaRespuestaSchema.safeParse({ ...base, impresion: 'IMPRESA' }).success).toBe(
      false,
    );
  });
});
