import { describe, expect, it } from 'vitest';
import {
  errorRespuestaSchema,
  registrarEmpresaEntradaSchema,
  saludRespuestaSchema,
  sucursalConfigurarEntradaSchema,
  sucursalEntradaSchema,
  sucursalRespuestaSchema,
} from '../src';

const sucursalBase = {
  rucEmisor: '20100000009',
  nombre: 'Miraflores',
  codigoEstablecimiento: '0001',
  direccion: 'Av. Larco 123',
};

const empresaBase = {
  nombre: 'Cevichería Lima',
  emisores: [{ ruc: '20100000009', razonSocial: 'Cevichería Lima SAC', regimen: 'GENERAL' }],
  sucursales: [sucursalBase],
};

function camposConError(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('sucursalEntradaSchema', () => {
  it('aplica horaCorte 05:00 y horario vacío por defecto', () => {
    const r = sucursalEntradaSchema.parse(sucursalBase);
    expect(r.horaCorte).toBe('05:00');
    expect(r.horario).toEqual([]);
    expect(r.whatsapp).toBeUndefined();
  });

  it('respeta la horaCorte enviada', () => {
    expect(sucursalEntradaSchema.parse({ ...sucursalBase, horaCorte: '03:30' }).horaCorte).toBe(
      '03:30',
    );
  });

  it('rechaza una horaCorte mal formada (no usa el valor por defecto)', () => {
    const r = sucursalEntradaSchema.safeParse({ ...sucursalBase, horaCorte: '5am' });
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain('horaCorte');
  });

  it('rechaza código de establecimiento, whatsapp y nombres inválidos', () => {
    for (const [campo, valor] of [
      ['codigoEstablecimiento', '01'],
      ['whatsapp', '12345'],
      ['nombre', '   '],
      ['nombre', 'x'.repeat(101)],
      ['direccion', ''],
      ['rucEmisor', '20100000000'],
    ] as const) {
      const r = sucursalEntradaSchema.safeParse({ ...sucursalBase, [campo]: valor });
      expect(r.success, `${campo}=${valor}`).toBe(false);
      expect(camposConError(r)).toContain(campo);
    }
  });
});

describe('registrarEmpresaEntradaSchema', () => {
  it('acepta una entrada válida y completa los valores por defecto', () => {
    const r = registrarEmpresaEntradaSchema.parse(empresaBase);
    expect(r.sucursales[0]?.horaCorte).toBe('05:00');
  });

  it('exige al menos un emisor y una sucursal', () => {
    expect(registrarEmpresaEntradaSchema.safeParse({ ...empresaBase, emisores: [] }).success).toBe(
      false,
    );
    expect(
      registrarEmpresaEntradaSchema.safeParse({ ...empresaBase, sucursales: [] }).success,
    ).toBe(false);
  });

  it('rechaza RUC repetido en la entrada', () => {
    const emisor = empresaBase.emisores[0];
    const r = registrarEmpresaEntradaSchema.safeParse({
      ...empresaBase,
      emisores: [emisor, emisor],
    });
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain('emisores.1.ruc');
  });

  it('rechaza una sucursal que referencia un RUC que no está en la entrada', () => {
    const r = registrarEmpresaEntradaSchema.safeParse({
      ...empresaBase,
      sucursales: [{ ...sucursalBase, rucEmisor: '20600000005' }],
    });
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain('sucursales.0.rucEmisor');
  });

  it('rechaza dos sucursales del mismo emisor con el mismo código', () => {
    const r = registrarEmpresaEntradaSchema.safeParse({
      ...empresaBase,
      sucursales: [sucursalBase, { ...sucursalBase, nombre: 'San Isidro' }],
    });
    expect(r.success).toBe(false);
    expect(camposConError(r)).toContain('sucursales.1.codigoEstablecimiento');
  });

  it('permite el mismo código en emisores distintos', () => {
    const r = registrarEmpresaEntradaSchema.safeParse({
      ...empresaBase,
      emisores: [
        ...empresaBase.emisores,
        { ruc: '20600000005', razonSocial: 'Otra SAC', regimen: 'RER' },
      ],
      sucursales: [sucursalBase, { ...sucursalBase, rucEmisor: '20600000005', nombre: 'Barranco' }],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza nombres de sucursal repetidos sin distinguir mayúsculas', () => {
    const r = registrarEmpresaEntradaSchema.safeParse({
      ...empresaBase,
      sucursales: [
        sucursalBase,
        { ...sucursalBase, nombre: 'MIRAFLORES', codigoEstablecimiento: '0002' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('sucursalConfigurarEntradaSchema', () => {
  it('exige al menos un campo', () => {
    expect(sucursalConfigurarEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('no aplica valores por defecto: horaCorte ausente sigue ausente', () => {
    const r = sucursalConfigurarEntradaSchema.parse({ nombre: 'Nuevo nombre' });
    expect(r).toEqual({ nombre: 'Nuevo nombre' });
    expect('horaCorte' in r).toBe(false);
  });

  it('permite quitar el whatsapp con null pero no la horaCorte', () => {
    expect(sucursalConfigurarEntradaSchema.safeParse({ whatsapp: null }).success).toBe(true);
    expect(sucursalConfigurarEntradaSchema.safeParse({ horaCorte: null }).success).toBe(false);
  });

  it('valida cada campo', () => {
    for (const cambio of [
      { emisorId: 'no-uuid' },
      { codigoEstablecimiento: 'abc' },
      { whatsapp: '999' },
      { horaCorte: '25:00' },
      { nombre: '' },
      { horario: [{ dia: 9, desde: '10:00', hasta: '12:00' }] },
    ]) {
      expect(
        sucursalConfigurarEntradaSchema.safeParse(cambio).success,
        JSON.stringify(cambio),
      ).toBe(false);
    }
  });

  it('acepta todos los campos válidos', () => {
    const r = sucursalConfigurarEntradaSchema.safeParse({
      emisorId: crypto.randomUUID(),
      nombre: 'Centro',
      codigoEstablecimiento: '0002',
      direccion: 'Jr. de la Unión 1',
      horario: [{ dia: 1, desde: '12:00', hasta: '23:00' }],
      whatsapp: '+51987654321',
      horaCorte: '04:00',
    });
    expect(r.success).toBe(true);
  });
});

describe('respuestas', () => {
  it('sucursalRespuestaSchema valida una sucursal completa', () => {
    const r = sucursalRespuestaSchema.safeParse({
      id: crypto.randomUUID(),
      empresaId: crypto.randomUUID(),
      emisorId: crypto.randomUUID(),
      nombre: 'Miraflores',
      codigoEstablecimiento: '0001',
      direccion: 'Av. Larco 123',
      horario: [],
      whatsapp: null,
      horaCorte: '05:00',
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });

  it('saludRespuestaSchema y errorRespuestaSchema', () => {
    expect(saludRespuestaSchema.safeParse({ estado: 'ok', baseDeDatos: 'ok' }).success).toBe(true);
    expect(saludRespuestaSchema.safeParse({ estado: 'raro', baseDeDatos: 'ok' }).success).toBe(
      false,
    );
    expect(
      errorRespuestaSchema.safeParse({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'x',
        campos: [{ campo: 'nombre', mensaje: 'requerido' }],
      }).success,
    ).toBe(true);
    expect(errorRespuestaSchema.safeParse({ codigo: 'NO_ENCONTRADO', mensaje: 'x' }).success).toBe(
      true,
    );
  });
});
