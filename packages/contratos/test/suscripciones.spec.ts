import { describe, expect, it } from 'vitest';
import {
  altaEmpresaEntradaSchema,
  emisorCrearEntradaSchema,
  emisorPlataformaEntradaSchema,
  pagoEntradaSchema,
  planCrearEntradaSchema,
  planModificarEntradaSchema,
  soporteEntradaSchema,
  sucursalCrearEntradaSchema,
  sucursalEntradaSchema,
  sucursalPlataformaEntradaSchema,
  suscripcionAltaEntradaSchema,
  suscripcionModificarEntradaSchema,
} from '../src';

// Esquemas de suscripciones, planes y alta por HTTP (historia 002, criterios 63 a 65, 69, 73 a 75).

const ID_1 = '11111111-1111-1111-1111-111111111111';

const sucursalBase = {
  rucEmisor: '20100000009',
  nombre: 'Miraflores',
  codigoEstablecimiento: '0001',
  direccion: 'Av. Larco 123',
};

const emisorBase = { ruc: '20100000009', razonSocial: 'Cevichería Lima SAC', regimen: 'GENERAL' };

const altaBase = {
  nombre: 'Cevichería Lima',
  emisores: [emisorBase],
  sucursales: [sucursalBase],
  administrador: {
    nombre: 'Ana Quispe',
    nombreUsuario: 'ana.quispe',
    contrasenaTemporal: 'temporal-123',
  },
  motivo: 'Alta de cliente nuevo',
};

describe('suscripcion en sucursalEntradaSchema', () => {
  it('sigue aceptando a quien no la envía y acepta planId y vencimiento opcionales', () => {
    expect(sucursalEntradaSchema.safeParse(sucursalBase).success).toBe(true);
    expect(sucursalEntradaSchema.safeParse({ ...sucursalBase, suscripcion: {} }).success).toBe(
      true,
    );
    expect(
      sucursalEntradaSchema.safeParse({
        ...sucursalBase,
        suscripcion: { planId: ID_1, vencimiento: '2026-12-31' },
      }).success,
    ).toBe(true);
  });

  it('rechaza un vencimiento inexistente, un plan que no es UUID y campos desconocidos', () => {
    for (const mala of [{ vencimiento: '2026-02-30' }, { planId: 'basico' }, { diasGracia: 3 }]) {
      expect(suscripcionAltaEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(
        false,
      );
    }
  });
});

describe('altaEmpresaEntradaSchema (criterio 63)', () => {
  it('acepta el alta con administrador y motivo, y suscripción opcional por sucursal', () => {
    expect(altaEmpresaEntradaSchema.safeParse(altaBase).success).toBe(true);
    expect(
      altaEmpresaEntradaSchema.safeParse({
        ...altaBase,
        sucursales: [{ ...sucursalBase, suscripcion: { vencimiento: '2027-01-15' } }],
      }).success,
    ).toBe(true);
  });

  it('exige administrador y motivo', () => {
    for (const campo of ['administrador', 'motivo']) {
      const sin: Record<string, unknown> = { ...altaBase };
      delete sin[campo];
      expect(altaEmpresaEntradaSchema.safeParse(sin).success, campo).toBe(false);
    }
  });

  it('valida el administrador: usuario, contraseña temporal y campos propios', () => {
    for (const malo of [
      { ...altaBase.administrador, nombreUsuario: 'a b' },
      { ...altaBase.administrador, contrasenaTemporal: 'corta' },
      { ...altaBase.administrador, pin: '123456' },
    ]) {
      expect(
        altaEmpresaEntradaSchema.safeParse({ ...altaBase, administrador: malo }).success,
        JSON.stringify(malo),
      ).toBe(false);
    }
  });

  it('es estricta en todos los niveles (ni empresaId ni creadoPor*)', () => {
    for (const entrada of [
      { ...altaBase, empresaId: ID_1 },
      { ...altaBase, creadoPorSistema: 'x' },
      { ...altaBase, emisores: [{ ...emisorBase, empresaId: ID_1 }] },
      { ...altaBase, sucursales: [{ ...sucursalBase, creadoPorUsuarioId: ID_1 }] },
      { ...altaBase, administrador: { ...altaBase.administrador, empresaId: ID_1 } },
    ]) {
      expect(altaEmpresaEntradaSchema.safeParse(entrada).success, JSON.stringify(entrada)).toBe(
        false,
      );
    }
  });

  it('mantiene las comprobaciones de coherencia del alta de 001', () => {
    const r = altaEmpresaEntradaSchema.safeParse({
      ...altaBase,
      sucursales: [{ ...sucursalBase, rucEmisor: '20600000005' }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('sucursales.0.rucEmisor');
  });
});

describe('entradas de emisores y sucursales por HTTP (criterios 64 y 70)', () => {
  it('el Administrador no puede enviar suscripcion ni campos desconocidos', () => {
    expect(sucursalCrearEntradaSchema.safeParse(sucursalBase).success).toBe(true);
    expect(
      sucursalCrearEntradaSchema.safeParse({
        ...sucursalBase,
        suscripcion: { vencimiento: '2030-01-01' },
      }).success,
    ).toBe(false);
    expect(sucursalCrearEntradaSchema.safeParse({ ...sucursalBase, empresaId: ID_1 }).success).toBe(
      false,
    );
    expect(emisorCrearEntradaSchema.safeParse(emisorBase).success).toBe(true);
    expect(emisorCrearEntradaSchema.safeParse({ ...emisorBase, empresaId: ID_1 }).success).toBe(
      false,
    );
  });

  it('las de plataforma exigen motivo y aceptan suscripcion en la sucursal', () => {
    expect(
      emisorPlataformaEntradaSchema.safeParse({ ...emisorBase, motivo: 'Nuevo RUC' }).success,
    ).toBe(true);
    expect(emisorPlataformaEntradaSchema.safeParse(emisorBase).success).toBe(false);
    expect(
      sucursalPlataformaEntradaSchema.safeParse({
        ...sucursalBase,
        suscripcion: { planId: ID_1 },
        motivo: 'Nueva sede',
      }).success,
    ).toBe(true);
    expect(sucursalPlataformaEntradaSchema.safeParse(sucursalBase).success).toBe(false);
    expect(
      sucursalPlataformaEntradaSchema.safeParse({ ...sucursalBase, motivo: 'x', empresaId: ID_1 })
        .success,
    ).toBe(false);
  });

  it('soporteEntrada exige motivo (no vacío) y acepta sucursalId opcional', () => {
    expect(soporteEntradaSchema.safeParse({ motivo: 'Ayuda con la carta' }).success).toBe(true);
    expect(soporteEntradaSchema.safeParse({ motivo: 'x', sucursalId: ID_1 }).success).toBe(true);
    expect(soporteEntradaSchema.safeParse({ motivo: '   ' }).success).toBe(false);
    expect(soporteEntradaSchema.safeParse({}).success).toBe(false);
    expect(soporteEntradaSchema.safeParse({ motivo: 'x', sucursalId: 'no' }).success).toBe(false);
  });
});

describe('pagoEntradaSchema (criterio 73)', () => {
  const pago = {
    monto: '150.50',
    fechaPago: '2026-11-10',
    medio: 'YAPE',
    vencimientoNuevo: '2026-12-10',
    motivo: 'Pago de noviembre',
  };

  it('acepta un pago completo, con referencia opcional', () => {
    expect(pagoEntradaSchema.safeParse(pago).success).toBe(true);
    expect(pagoEntradaSchema.safeParse({ ...pago, referencia: 'Op. 123456' }).success).toBe(true);
  });

  it('rechaza monto inválido, fechas inexistentes, medio desconocido y falta de motivo', () => {
    for (const malo of [
      { ...pago, monto: '0' },
      { ...pago, monto: '10.999' },
      { ...pago, monto: 150 },
      { ...pago, fechaPago: '2026-02-30' },
      { ...pago, vencimientoNuevo: 'mañana' },
      { ...pago, medio: 'CHEQUE' },
      { ...pago, motivo: '' },
      { ...pago, empresaId: ID_1 },
      { ...pago, creadoPorSuperadministradorId: ID_1 },
    ]) {
      expect(pagoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('planes y suscripciones (criterios 74 y 75)', () => {
  const plan = {
    codigo: 'PREMIUM',
    nombre: 'Premium',
    precioMensual: '99.90',
    cuotaComprobantesMes: 500,
    precioExcedente: '0.0500',
    diasGracia: 10,
    modulos: ['SALON', 'CAJA', 'FACTURACION'],
    porDefecto: false,
    activo: true,
    motivo: 'Plan nuevo',
  };

  it('acepta un plan con precios y cuota, o sin ellos (null o ausentes)', () => {
    expect(planCrearEntradaSchema.safeParse(plan).success).toBe(true);
    expect(
      planCrearEntradaSchema.safeParse({
        ...plan,
        precioMensual: null,
        cuotaComprobantesMes: null,
        precioExcedente: null,
      }).success,
    ).toBe(true);
    const minimo: Record<string, unknown> = { ...plan };
    for (const campo of ['precioMensual', 'cuotaComprobantesMes', 'precioExcedente'])
      delete minimo[campo];
    expect(planCrearEntradaSchema.safeParse(minimo).success).toBe(true);
  });

  it('rechaza días de gracia fuera de 0 a 60, módulos fuera del catálogo y precios mal formados', () => {
    for (const malo of [
      { ...plan, diasGracia: -1 },
      { ...plan, diasGracia: 61 },
      { ...plan, diasGracia: 1.5 },
      { ...plan, modulos: ['SALON', 'NAVE_ESPACIAL'] },
      { ...plan, precioMensual: '99.999' },
      { ...plan, cuotaComprobantesMes: -1 },
      { ...plan, motivo: '' },
      { ...plan, empresaId: ID_1 },
    ]) {
      expect(planCrearEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('la modificación acepta un subconjunto pero exige el motivo', () => {
    expect(
      planModificarEntradaSchema.safeParse({ nombre: 'Nuevo', motivo: 'Renombrar' }).success,
    ).toBe(true);
    expect(planModificarEntradaSchema.safeParse({ activo: false, motivo: 'Baja' }).success).toBe(
      true,
    );
    expect(planModificarEntradaSchema.safeParse({ nombre: 'Nuevo' }).success).toBe(false);
    expect(
      planModificarEntradaSchema.safeParse({ nombre: 'N', motivo: 'm', creadoPorSistema: 'x' })
        .success,
    ).toBe(false);
  });

  it('suscripcionModificarEntrada exige plan o vencimiento, y motivo', () => {
    expect(
      suscripcionModificarEntradaSchema.safeParse({ planId: ID_1, motivo: 'Cambio de plan' })
        .success,
    ).toBe(true);
    expect(
      suscripcionModificarEntradaSchema.safeParse({
        vencimiento: '2027-01-31',
        motivo: 'Corrección',
      }).success,
    ).toBe(true);
    expect(
      suscripcionModificarEntradaSchema.safeParse({ motivo: 'Nada que cambiar' }).success,
    ).toBe(false);
    expect(suscripcionModificarEntradaSchema.safeParse({ planId: ID_1 }).success).toBe(false);
    expect(
      suscripcionModificarEntradaSchema.safeParse({ vencimiento: '2027-02-30', motivo: 'x' })
        .success,
    ).toBe(false);
  });
});
