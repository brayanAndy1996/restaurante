import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  COLUMNAS_POR_ANCHO,
  JUEGOS_CARACTERES,
  TIPOS_TRABAJO,
  bloqueTicketSchema,
  documentoTicketSchema,
  esHostValido,
  esIpv4,
  estacionDestinoEntradaSchema,
  estadoImpresionRespuestaSchema,
  eventoImpresionEstadoSchema,
  impresionSucursalEntradaSchema,
  impresoraEntradaSchema,
  impresoraModificarEntradaSchema,
  impresoraRespuestaSchema,
  trabajoResumenSchema,
  trabajosConsultaSchema,
} from '../src';

// Esquemas de la impresión (historia 004, entrega 3b): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

const impresoraBase = {
  nombre: 'Cocina',
  conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
};

describe('códigos de error de 3b', () => {
  it('incluye VINCULACION_INVALIDA, SIN_IMPRESORA y CONFIGURACION_INCOMPLETA sin repetir códigos', () => {
    expect(CODIGOS_ERROR).toContain('VINCULACION_INVALIDA');
    expect(CODIGOS_ERROR).toContain('SIN_IMPRESORA');
    expect(CODIGOS_ERROR).toContain('CONFIGURACION_INCOMPLETA');
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });
});

describe('host de una impresora de red (criterio 103)', () => {
  it('acepta IPv4 y nombres de equipo', () => {
    for (const host of [
      '192.168.1.50',
      '10.0.0.1',
      '0.0.0.0',
      'impresora',
      'cocina.local',
      'a-b.c1',
    ]) {
      expect(esHostValido(host), host).toBe(true);
    }
    expect(esHostValido('a'.repeat(63) + '.com')).toBe(true);
    // 253 caracteres: cuatro etiquetas de 62 y una de 3 más sus puntos.
    expect(
      esHostValido(['a'.repeat(62), 'b'.repeat(62), 'c'.repeat(62), 'd'.repeat(62), 'e'].join('.')),
    ).toBe(true);
  });

  it('rechaza lo que no es IPv4 ni nombre', () => {
    for (const host of [
      '',
      '999.1.1.1',
      '256.1.1.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      '-a.com',
      'a-.com',
      'a..com',
      '.a.com',
      'a.com.',
      'a b',
      'host:9100',
      'http://host',
      'ñandú.local',
      'a/b',
      'a'.repeat(64) + '.com',
    ]) {
      expect(esHostValido(host), JSON.stringify(host)).toBe(false);
    }
    expect(
      esHostValido(['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(63), 'e'].join('.')),
    ).toBe(false);
  });

  it('esIpv4 solo acepta cuatro octetos de 0 a 255', () => {
    expect(esIpv4('255.255.255.255')).toBe(true);
    expect(esIpv4('1.2.3')).toBe(false);
    expect(esIpv4('1.2.3.256')).toBe(false);
  });
});

describe('impresoraEntradaSchema (criterio 103)', () => {
  it('acepta una impresora de red completa', () => {
    expect(impresoraEntradaSchema.parse(impresoraBase)).toEqual(impresoraBase);
  });

  it('pone los valores por defecto: puerto 9100, juego PC850, sin gaveta', () => {
    const r = impresoraEntradaSchema.parse({
      nombre: 'Caja',
      conexion: { tipo: 'RED', host: 'caja.local' },
      anchoMm: 58,
    });
    expect(r).toEqual({
      nombre: 'Caja',
      conexion: { tipo: 'RED', host: 'caja.local', puerto: 9100 },
      anchoMm: 58,
      juegoCaracteres: 'PC850',
      gaveta: false,
    });
  });

  it('acepta una impresora Bluetooth y normaliza la dirección a mayúsculas', () => {
    const r = impresoraEntradaSchema.parse({
      ...impresoraBase,
      conexion: { tipo: 'BLUETOOTH', mac: 'aa:bb:cc:dd:ee:0f' },
    });
    expect(r.conexion).toEqual({ tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:0F' });
  });

  it('acepta cada juego de caracteres y los dos anchos', () => {
    for (const juego of JUEGOS_CARACTERES) {
      for (const anchoMm of [58, 80]) {
        expect(
          impresoraEntradaSchema.safeParse({ ...impresoraBase, juegoCaracteres: juego, anchoMm })
            .success,
        ).toBe(true);
      }
    }
    expect(JUEGOS_CARACTERES).toEqual(['PC850', 'PC858', 'WPC1252', 'PC437', 'SIN_TILDES']);
    expect(COLUMNAS_POR_ANCHO).toEqual({ 58: 32, 80: 48 });
  });

  it('el nombre es de 1 a 40 caracteres sin espacios en los extremos', () => {
    expect(impresoraEntradaSchema.parse({ ...impresoraBase, nombre: '  Cocina  ' }).nombre).toBe(
      'Cocina',
    );
    expect(
      impresoraEntradaSchema.safeParse({ ...impresoraBase, nombre: 'a'.repeat(40) }).success,
    ).toBe(true);
    for (const nombre of ['', '   ', 'a'.repeat(41)]) {
      expect(campos(impresoraEntradaSchema.safeParse({ ...impresoraBase, nombre }))).toContain(
        'nombre',
      );
    }
  });

  it('rechaza puertos, anchos, juegos y conexiones inválidos', () => {
    const malos = [
      { conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 0 } },
      { conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 65536 } },
      { conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100.5 } },
      { conexion: { tipo: 'RED', host: '192.168.1.50', puerto: '9100' } },
      { conexion: { tipo: 'RED', host: '' } },
      { conexion: { tipo: 'RED', host: '999.1.1.1' } },
      { conexion: { tipo: 'RED' } },
      { conexion: { tipo: 'RED', host: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:FF' } },
      { conexion: { tipo: 'BLUETOOTH' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'AA-BB-CC-DD-EE-FF' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'GG:BB:CC:DD:EE:FF' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF', host: 'x' } },
      { conexion: { tipo: 'USB' } },
      { conexion: '192.168.1.50' },
      { anchoMm: 57 },
      { anchoMm: '80' },
      { juegoCaracteres: 'UTF8' },
      { gaveta: 'si' },
      { empresaId: ID_1 },
      { sucursalId: ID_1 },
      { activa: true },
    ];
    for (const malo of malos) {
      expect(
        impresoraEntradaSchema.safeParse({ ...impresoraBase, ...malo }).success,
        JSON.stringify(malo),
      ).toBe(false);
    }
    const sinAncho: Record<string, unknown> = { ...impresoraBase };
    delete sinAncho.anchoMm;
    expect(campos(impresoraEntradaSchema.safeParse(sinAncho))).toContain('anchoMm');
  });
});

describe('impresoraModificarEntradaSchema (criterio 104)', () => {
  it('acepta un solo campo y rechaza la lista vacía', () => {
    expect(impresoraModificarEntradaSchema.safeParse({ nombre: 'Barra' }).success).toBe(true);
    expect(impresoraModificarEntradaSchema.safeParse({ activa: false }).success).toBe(true);
    expect(impresoraModificarEntradaSchema.safeParse({ gaveta: true }).success).toBe(true);
    expect(impresoraModificarEntradaSchema.safeParse({ anchoMm: 58 }).success).toBe(true);
    expect(
      impresoraModificarEntradaSchema.safeParse({ conexion: { tipo: 'RED', host: 'x.local' } })
        .success,
    ).toBe(true);
    expect(impresoraModificarEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('no aplica los valores por defecto de la alta (un campo ausente sigue ausente)', () => {
    expect(impresoraModificarEntradaSchema.parse({ nombre: 'Barra' })).toEqual({ nombre: 'Barra' });
    expect(
      impresoraModificarEntradaSchema.parse({ conexion: { tipo: 'RED', host: 'x.local' } }),
    ).toEqual({ conexion: { tipo: 'RED', host: 'x.local', puerto: 9100 } });
  });

  it('rechaza campos desconocidos y valores inválidos', () => {
    for (const malo of [
      { nombre: '' },
      { anchoMm: 70 },
      { juegoCaracteres: 'x' },
      { activa: 'no' },
      { id: ID_1 },
      { sucursalId: ID_1 },
      { nombre: 'Barra', estado: 'LISTA' },
    ]) {
      expect(impresoraModificarEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });
});

describe('impresoraRespuestaSchema', () => {
  it('describe la impresora con su estado y pendientes', () => {
    const r = {
      id: ID_1,
      sucursalId: ID_2,
      nombre: 'Cocina',
      conexion: { tipo: 'RED', host: '192.168.1.50', puerto: 9100 },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
      activa: true,
      estado: 'DESCONOCIDO',
      estadoDesde: null,
      pendientes: 0,
    };
    expect(impresoraRespuestaSchema.parse(r)).toEqual(r);
    expect(impresoraRespuestaSchema.safeParse({ ...r, estado: 'ROTA' }).success).toBe(false);
    expect(impresoraRespuestaSchema.safeParse({ ...r, pendientes: -1 }).success).toBe(false);
  });
});

describe('estacionDestinoEntradaSchema (criterio 100)', () => {
  it('acepta KDS solo y IMPRESORA con su impresora', () => {
    expect(estacionDestinoEntradaSchema.parse({ destino: 'KDS' })).toEqual({ destino: 'KDS' });
    expect(estacionDestinoEntradaSchema.parse({ destino: 'IMPRESORA', impresoraId: ID_1 })).toEqual(
      {
        destino: 'IMPRESORA',
        impresoraId: ID_1,
      },
    );
  });

  it('rechaza lo demás', () => {
    for (const malo of [
      {},
      { destino: 'IMPRESORA' },
      { destino: 'IMPRESORA', impresoraId: 'x' },
      { destino: 'KDS', impresoraId: ID_1 },
      { destino: 'PANTALLA' },
      { destino: 'IMPRESORA', impresoraId: ID_1, otro: 1 },
      { destino: 'IMPRESORA', impresoraId: null },
    ]) {
      expect(estacionDestinoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });
});

describe('impresionSucursalEntradaSchema (criterio 102)', () => {
  it('acepta un id o null y exige el campo', () => {
    expect(impresionSucursalEntradaSchema.safeParse({ impresoraCajaId: ID_1 }).success).toBe(true);
    expect(impresionSucursalEntradaSchema.safeParse({ impresoraCajaId: null }).success).toBe(true);
    for (const malo of [
      {},
      { impresoraCajaId: 'x' },
      { impresoraCajaId: ID_1, otro: 1 },
      { impresoraCajaId: '' },
    ]) {
      expect(impresionSucursalEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });
});

describe('estadoImpresionRespuestaSchema, trabajoResumenSchema y trabajosConsultaSchema', () => {
  it('acepta un estado sin puente y uno con puente', () => {
    expect(
      estadoImpresionRespuestaSchema.safeParse({
        ahora: '2026-10-29T20:00:00.000Z',
        puente: null,
        impresoras: [],
      }).success,
    ).toBe(true);
    expect(
      estadoImpresionRespuestaSchema.safeParse({
        ahora: '2026-10-29T20:00:00.000Z',
        puente: {
          id: ID_1,
          nombre: 'Tablet',
          ultimaSenalEn: '2026-10-29T19:59:50.000Z',
          conectado: true,
        },
        impresoras: [
          {
            id: ID_2,
            nombre: 'Cocina',
            estado: 'LISTA',
            estadoDesde: '2026-10-29T19:00:00.000Z',
            pendientes: 2,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('el trabajo cubre los seis tipos y los tres estados', () => {
    expect([...TIPOS_TRABAJO]).toEqual([
      'COMANDA',
      'ADICION',
      'MARCHAR',
      'ANULACION',
      'PRECUENTA',
      'PRUEBA',
    ]);
    const base = {
      id: ID_1,
      impresora: { id: ID_2, nombre: 'Cocina' },
      mesa: '4',
      estado: 'PENDIENTE',
      intentos: 0,
      creadoEn: '2026-10-29T20:00:00.000Z',
      impresoEn: null,
      reimpresionDe: null,
      ordenId: null,
      envioNumero: null,
    };
    for (const tipo of TIPOS_TRABAJO) {
      expect(trabajoResumenSchema.safeParse({ ...base, tipo }).success).toBe(true);
    }
    // La orden (la vigente) y el número del envío de la comanda.
    expect(
      trabajoResumenSchema.safeParse({ ...base, tipo: 'ADICION', ordenId: ID_2, envioNumero: 2 })
        .success,
    ).toBe(true);
    for (const malo of [{ ordenId: 'x' }, { envioNumero: 0 }, { envioNumero: 1.5 }]) {
      expect(trabajoResumenSchema.safeParse({ ...base, tipo: 'COMANDA', ...malo }).success).toBe(
        false,
      );
    }
    const { ordenId: _o, envioNumero: _e, ...sinOrden } = base;
    void _o;
    void _e;
    expect(trabajoResumenSchema.safeParse({ ...sinOrden, tipo: 'COMANDA' }).success).toBe(false);
    expect(
      trabajoResumenSchema.safeParse({ ...base, tipo: 'COMANDA', estado: 'IMPRESO' }).success,
    ).toBe(true);
    expect(
      trabajoResumenSchema.safeParse({ ...base, tipo: 'COMANDA', estado: 'VENCIDO' }).success,
    ).toBe(true);
    expect(
      trabajoResumenSchema.safeParse({ ...base, tipo: 'COMANDA', estado: 'ROTO' }).success,
    ).toBe(false);
  });

  it('la consulta de trabajos acepta desde y estado, y nada más', () => {
    expect(trabajosConsultaSchema.safeParse({}).success).toBe(true);
    expect(
      trabajosConsultaSchema.safeParse({ desde: '2026-10-29T05:00:00.000Z', estado: 'PENDIENTE' })
        .success,
    ).toBe(true);
    expect(trabajosConsultaSchema.safeParse({ estado: 'otro' }).success).toBe(false);
    expect(trabajosConsultaSchema.safeParse({ desde: 'ayer' }).success).toBe(false);
    expect(trabajosConsultaSchema.safeParse({ sucursalId: ID_1 }).success).toBe(false);
  });

  it('la consulta acepta ordenId (la cuenta pide solo sus tickets) y solo un uuid', () => {
    expect(trabajosConsultaSchema.safeParse({ ordenId: ID_1 }).success).toBe(true);
    expect(trabajosConsultaSchema.safeParse({ ordenId: ID_1, estado: 'IMPRESO' }).success).toBe(
      true,
    );
    expect(trabajosConsultaSchema.safeParse({ ordenId: 'x' }).success).toBe(false);
  });

  it('el trabajo puede traer su último error y si no tiene ticket, sin que sea obligatorio', () => {
    const base = {
      id: ID_1,
      tipo: 'COMANDA',
      impresora: { id: ID_2, nombre: 'Cocina' },
      mesa: '4',
      estado: 'PENDIENTE',
      intentos: 0,
      creadoEn: '2026-10-29T20:00:00.000Z',
      impresoEn: null,
      reimpresionDe: null,
      ordenId: ID_1,
      envioNumero: 1,
    };
    expect(trabajoResumenSchema.safeParse(base).success).toBe(true);
    expect(
      trabajoResumenSchema.safeParse({
        ...base,
        ultimoError: 'Documento inválido (bloques.0.texto): demasiado largo',
        sinTicket: true,
      }).success,
    ).toBe(true);
    expect(trabajoResumenSchema.safeParse({ ...base, ultimoError: null }).success).toBe(true);
    expect(trabajoResumenSchema.safeParse({ ...base, sinTicket: 'si' }).success).toBe(false);
  });
});

describe('documentoTicketSchema (criterio 126)', () => {
  const documento = {
    version: 1,
    tipo: 'COMANDA',
    bloques: [
      { tipo: 'titulo', texto: 'COCINA · COMANDA' },
      { tipo: 'linea', texto: 'Mesa 4', dobleAlto: true },
      { tipo: 'regla' },
      { tipo: 'columnas', izquierda: '3 × Hamburguesa clásica', derecha: 'S/ 45.00' },
      { tipo: 'linea', texto: 'Obs: sin cebolla', sangria: 2 },
      { tipo: 'marca', texto: 'PARA LLEVAR' },
      { tipo: 'espacio', lineas: 2 },
    ],
  };

  it('acepta un documento con todos los tipos de bloque', () => {
    expect(documentoTicketSchema.parse(documento)).toEqual(documento);
  });

  it('acepta una línea en blanco pero no un documento sin bloques', () => {
    expect(
      documentoTicketSchema.safeParse({ ...documento, bloques: [{ tipo: 'linea', texto: '' }] })
        .success,
    ).toBe(true);
    expect(documentoTicketSchema.safeParse({ ...documento, bloques: [] }).success).toBe(false);
  });

  it('exige la versión 1 y un tipo de trabajo conocido', () => {
    expect(documentoTicketSchema.safeParse({ ...documento, version: 2 }).success).toBe(false);
    expect(documentoTicketSchema.safeParse({ ...documento, tipo: 'OTRO' }).success).toBe(false);
    const sinVersion: Record<string, unknown> = { ...documento };
    delete sinVersion.version;
    expect(documentoTicketSchema.safeParse(sinVersion).success).toBe(false);
  });

  it('rechaza bloques desconocidos, campos de más y valores fuera de rango', () => {
    for (const malo of [
      { tipo: 'imagen', texto: 'x' },
      { tipo: 'titulo' },
      { tipo: 'titulo', texto: 'x', negrita: true },
      { tipo: 'linea', texto: 'x', sangria: 9 },
      { tipo: 'linea', texto: 'x', sangria: -1 },
      { tipo: 'linea', texto: 'x', alinear: 'arriba' },
      { tipo: 'linea', texto: 'a'.repeat(201) },
      { tipo: 'linea', texto: 'dos\nlíneas' },
      { tipo: 'linea', texto: 'con\u0000nul' },
      { tipo: 'columnas', izquierda: 'x' },
      { tipo: 'regla', caracter: '*' },
      { tipo: 'espacio', lineas: 0 },
      { tipo: 'espacio', lineas: 11 },
    ]) {
      expect(bloqueTicketSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('limita el número de bloques', () => {
    const bloque = { tipo: 'linea', texto: 'x' };
    expect(
      documentoTicketSchema.safeParse({
        ...documento,
        bloques: Array.from({ length: 600 }, () => bloque),
      }).success,
    ).toBe(true);
    expect(
      documentoTicketSchema.safeParse({
        ...documento,
        bloques: Array.from({ length: 601 }, () => bloque),
      }).success,
    ).toBe(false);
  });
});

describe('eventoImpresionEstadoSchema (criterio 120)', () => {
  it('va a la sala de la sucursal con solo el id', () => {
    const evento = {
      empresaId: ID_1,
      sala: { tipo: 'sucursal', sucursalId: ID_2 },
      nombre: 'impresion.estado',
      datos: { sucursalId: ID_2 },
    };
    expect(eventoImpresionEstadoSchema.safeParse(evento).success).toBe(true);
    expect(eventoImpresionEstadoSchema.safeParse({ ...evento, nombre: 'otro' }).success).toBe(
      false,
    );
    expect(
      eventoImpresionEstadoSchema.safeParse({ ...evento, sala: { tipo: 'empresa' } }).success,
    ).toBe(false);
  });
});
