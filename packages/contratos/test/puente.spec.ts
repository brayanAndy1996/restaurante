import { describe, expect, it } from 'vitest';
import {
  CABECERA_HAY_MAS_TRABAJOS,
  CABECERA_PROTOCOLO_PUENTE,
  ESPACIO_PUENTE,
  MAXIMO_BYTES_RESPUESTA_TRABAJOS,
  MAXIMO_IMPRESORAS_LATIDO,
  VERSION_PROTOCOLO_PUENTE,
  armarQrPuente,
  configuracionPuenteSchema,
  eventoPuenteConfiguracionSchema,
  eventoTrabajoNuevoSchema,
  latidoEntradaSchema,
  leerQrPuente,
  resultadoTrabajoEntradaSchema,
  trabajoParaImprimirSchema,
  vincularPuenteEntradaSchema,
  vincularPuenteRespuestaSchema,
} from '../src';

// Protocolo del puente, versión 1 (historia 004, entrega 3b): formato de los datos del simulador y de la app.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const SECRETO = 'A'.repeat(43);
const TOKEN_VI = `vi.${ID_1}.${ID_2}.${SECRETO}`;

describe('constantes del protocolo', () => {
  it('es la versión 1, con su cabecera y el espacio /puente', () => {
    expect(VERSION_PROTOCOLO_PUENTE).toBe(1);
    expect(CABECERA_PROTOCOLO_PUENTE).toBe('X-Puente-Protocolo');
    expect(ESPACIO_PUENTE).toBe('/puente');
  });

  it('una respuesta de trabajos pasa de poco más de 1 MB solo por el primer trabajo de una impresora (ronda 2, F5)', () => {
    expect(MAXIMO_BYTES_RESPUESTA_TRABAJOS).toBe(1_000_000);
    expect(CABECERA_HAY_MAS_TRABAJOS).toBe('X-Puente-Hay-Mas');
    // El tope de impresoras de una sucursal es el que el latido acepta.
    expect(MAXIMO_IMPRESORAS_LATIDO).toBe(50);
  });
});

describe('el texto del QR (criterio 106)', () => {
  it('se arma y se lee de vuelta', () => {
    const qr = armarQrPuente('https://api.ejemplo.pe', TOKEN_VI);
    expect(qr).toBe(
      `restaurante-puente://vincular?api=${encodeURIComponent('https://api.ejemplo.pe')}&t=${encodeURIComponent(TOKEN_VI)}`,
    );
    expect(leerQrPuente(qr)).toEqual({ api: 'https://api.ejemplo.pe', token: TOKEN_VI });
  });

  it('lee la forma sin codificar de la especificación y quita la barra final y los espacios', () => {
    expect(
      leerQrPuente(`  restaurante-puente://vincular?api=http://localhost:3000/&t=${TOKEN_VI}\n`),
    ).toEqual({ api: 'http://localhost:3000', token: TOKEN_VI });
  });

  it('conserva la ruta base de la API', () => {
    expect(leerQrPuente(armarQrPuente('https://ejemplo.pe/api/', TOKEN_VI))?.api).toBe(
      'https://ejemplo.pe/api',
    );
  });

  it('devuelve null si no es un QR de vinculación', () => {
    for (const texto of [
      '',
      'hola',
      `https://api.ejemplo.pe/?t=${TOKEN_VI}`,
      `otro-esquema://vincular?api=https://a.pe&t=${TOKEN_VI}`,
      `restaurante-puente://otra?api=https://a.pe&t=${TOKEN_VI}`,
      `restaurante-puente://vincular?t=${TOKEN_VI}`,
      'restaurante-puente://vincular?api=https://a.pe',
      `restaurante-puente://vincular?api=&t=${TOKEN_VI}`,
      `restaurante-puente://vincular?api=https://a.pe&t=`,
      `restaurante-puente://vincular?api=no-es-url&t=${TOKEN_VI}`,
      `restaurante-puente://vincular?api=ftp://a.pe&t=${TOKEN_VI}`,
      `restaurante-puente://vincular?api=javascript:alert(1)&t=${TOKEN_VI}`,
    ]) {
      expect(leerQrPuente(texto), JSON.stringify(texto)).toBeNull();
    }
  });
});

describe('vincularPuenteEntradaSchema (criterio 107)', () => {
  it('exige la versión de la app y acepta el nombre y el modelo', () => {
    expect(vincularPuenteEntradaSchema.safeParse({ versionApp: '1.0.0' }).success).toBe(true);
    expect(
      vincularPuenteEntradaSchema.safeParse({
        nombreEquipo: 'Tablet de cocina',
        modelo: 'Samsung SM-T295',
        versionApp: '1.0.0',
      }).success,
    ).toBe(true);
  });

  it('rechaza lo que falta, lo vacío, lo largo y los campos desconocidos', () => {
    for (const malo of [
      {},
      { versionApp: '' },
      { versionApp: 'a'.repeat(31) },
      { versionApp: '1.0.0', nombreEquipo: '' },
      { versionApp: '1.0.0', nombreEquipo: 'a'.repeat(61) },
      { versionApp: '1.0.0', modelo: 'a'.repeat(61) },
      { versionApp: '1.0.0', sucursalId: ID_1 },
      { versionApp: 1 },
    ]) {
      expect(vincularPuenteEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('configuración y respuesta de vincular (criterios 107 y 110)', () => {
  const configuracion = {
    puente: { id: ID_1, nombre: 'Tablet' },
    sucursal: { id: ID_2, nombre: 'Miraflores' },
    impresoras: [
      {
        id: ID_1,
        nombre: 'Cocina',
        conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100 },
        anchoMm: 80,
        juegoCaracteres: 'PC850',
        gaveta: false,
      },
      {
        id: ID_2,
        nombre: 'Caja',
        conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
        anchoMm: 58,
        juegoCaracteres: 'SIN_TILDES',
        gaveta: true,
      },
    ],
  };

  it('acepta la configuración con impresoras de red y Bluetooth', () => {
    expect(configuracionPuenteSchema.parse(configuracion)).toEqual(configuracion);
    expect(configuracionPuenteSchema.safeParse({ ...configuracion, impresoras: [] }).success).toBe(
      true,
    );
  });

  it('la respuesta de vincular lleva el token pu., el puente, la sucursal y la configuración', () => {
    const respuesta = {
      token: `pu.${ID_1}.${ID_2}.${SECRETO}`,
      puente: configuracion.puente,
      sucursal: configuracion.sucursal,
      configuracion,
    };
    expect(vincularPuenteRespuestaSchema.parse(respuesta)).toEqual(respuesta);
    expect(vincularPuenteRespuestaSchema.safeParse({ ...respuesta, token: '' }).success).toBe(
      false,
    );
    const sinConfiguracion: Record<string, unknown> = { ...respuesta };
    delete sinConfiguracion.configuracion;
    expect(vincularPuenteRespuestaSchema.safeParse(sinConfiguracion).success).toBe(false);
  });
});

describe('trabajoParaImprimirSchema (criterio 113)', () => {
  const trabajo = {
    id: ID_1,
    impresoraId: ID_2,
    tipo: 'COMANDA',
    creadoEn: '2026-10-29T20:15:00.000Z',
    bytes: Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x00]).toString('base64'),
  };

  it('acepta bytes en base64, también vacíos', () => {
    expect(trabajoParaImprimirSchema.safeParse(trabajo).success).toBe(true);
    expect(trabajoParaImprimirSchema.safeParse({ ...trabajo, bytes: '' }).success).toBe(true);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(
        trabajoParaImprimirSchema.safeParse({
          ...trabajo,
          bytes: Buffer.alloc(n, 7).toString('base64'),
        }).success,
      ).toBe(true);
    }
  });

  it('rechaza bytes que no son base64, tipos desconocidos y fechas inválidas', () => {
    for (const malo of [
      { bytes: 'no es base64!' },
      { bytes: 'QUJD=' },
      { bytes: 'QUJ' },
      { tipo: 'FACTURA' },
      { creadoEn: 'ayer' },
      { id: 'x' },
    ]) {
      expect(
        trabajoParaImprimirSchema.safeParse({ ...trabajo, ...malo }).success,
        JSON.stringify(malo),
      ).toBe(false);
    }
  });
});

describe('resultadoTrabajoEntradaSchema (criterio 115)', () => {
  it('IMPRESO va solo y NO_IMPRESO lleva el error', () => {
    expect(resultadoTrabajoEntradaSchema.safeParse({ resultado: 'IMPRESO' }).success).toBe(true);
    expect(
      resultadoTrabajoEntradaSchema.safeParse({
        resultado: 'NO_IMPRESO',
        error: 'La impresora no responde',
      }).success,
    ).toBe(true);
    expect(
      resultadoTrabajoEntradaSchema.safeParse({ resultado: 'NO_IMPRESO', error: 'a'.repeat(200) })
        .success,
    ).toBe(true);
  });

  it('rechaza el error ausente, vacío o de más de 200, y el error en IMPRESO', () => {
    for (const malo of [
      { resultado: 'NO_IMPRESO' },
      { resultado: 'NO_IMPRESO', error: '' },
      { resultado: 'NO_IMPRESO', error: 'a'.repeat(201) },
      { resultado: 'IMPRESO', error: 'x' },
      { resultado: 'TAL_VEZ' },
      {},
      { resultado: 'IMPRESO', trabajoId: ID_1 },
    ]) {
      expect(resultadoTrabajoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });
});

describe('latidoEntradaSchema (criterio 120)', () => {
  it('acepta la lista vacía y cada estado reportable', () => {
    expect(latidoEntradaSchema.safeParse({ versionApp: '1.0.0', impresoras: [] }).success).toBe(
      true,
    );
    expect(
      latidoEntradaSchema.safeParse({
        versionApp: '1.0.0',
        impresoras: [
          { id: ID_1, estado: 'LISTA' },
          { id: ID_2, estado: 'NO_RESPONDE', error: 'Tiempo agotado' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rechaza DESCONOCIDO, la versión ausente, ids inválidos y campos de más', () => {
    for (const malo of [
      { impresoras: [] },
      { versionApp: '1.0.0' },
      { versionApp: '1.0.0', impresoras: [{ id: ID_1, estado: 'DESCONOCIDO' }] },
      { versionApp: '1.0.0', impresoras: [{ id: 'x', estado: 'LISTA' }] },
      { versionApp: '1.0.0', impresoras: [{ id: ID_1, estado: 'LISTA', nombre: 'x' }] },
      { versionApp: '1.0.0', impresoras: [{ id: ID_1, estado: 'LISTA', error: 'a'.repeat(201) }] },
      { versionApp: '1.0.0', impresoras: [], sucursalId: ID_1 },
    ]) {
      expect(latidoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('limita las impresoras a 50', () => {
    const una = { id: ID_1, estado: 'LISTA' };
    expect(
      latidoEntradaSchema.safeParse({
        versionApp: '1',
        impresoras: Array.from({ length: 50 }, () => una),
      }).success,
    ).toBe(true);
    expect(
      latidoEntradaSchema.safeParse({
        versionApp: '1',
        impresoras: Array.from({ length: 51 }, () => una),
      }).success,
    ).toBe(false);
  });
});

describe('eventos del puente (criterios 110 y 112)', () => {
  it('trabajo.nuevo lleva solo el id del trabajo a la sala del puente', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'puente', puenteId: ID_2 },
      nombre: 'trabajo.nuevo',
      datos: { trabajoId: ID_1 },
    };
    expect(eventoTrabajoNuevoSchema.safeParse(evento).success).toBe(true);
    expect(eventoTrabajoNuevoSchema.safeParse({ ...evento, datos: {} }).success).toBe(false);
    expect(
      eventoTrabajoNuevoSchema.safeParse({
        ...evento,
        sala: { tipo: 'sucursal', sucursalId: ID_2 },
      }).success,
    ).toBe(false);
  });

  it('puente.configuracion va sin datos', () => {
    expect(
      eventoPuenteConfiguracionSchema.safeParse({
        empresaId: ID_1,
        sala: { tipo: 'puente', puenteId: ID_2 },
        nombre: 'puente.configuracion',
        datos: {},
      }).success,
    ).toBe(true);
  });
});
