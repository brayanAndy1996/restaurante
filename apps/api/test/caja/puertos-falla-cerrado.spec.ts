// Historia 006 · caja, cobro y comprobantes, grupo C1 (T6) · pruebas del desarrollador (no protegidas) de los puertos que
// un módulo registra al arrancar en otro cuando la dependencia iría al revés (plan, "Dependencias"): sin registro,
// fallan cerrado en lugar de aceptar lo que no pueden comprobar.
import { describe, expect, it } from 'vitest';
import { AlcanceDeReimpresion } from '../../src/modulos/impresion';
import { RegistroAlcanceDeTurnos, RegistroImpresoraDeCaja } from '../../src/modulos/facturacion';
import { RegistroDeCobros } from '../../src/modulos/pedidos';
import { UltimaEmisionDeEmisor } from '../../src/modulos/plataforma';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';

describe('UltimaEmisionDeEmisor (plataforma ← facturación)', () => {
  it('sin registro, rechaza el cambio de tasa con 409 CONFLICTO (falla cerrado)', async () => {
    const puerto = new UltimaEmisionDeEmisor();
    const error = await puerto.fecha('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorAplicacion);
    expect([(error as ErrorAplicacion).getStatus(), (error as ErrorAplicacion).codigo]).toEqual([
      409,
      'CONFLICTO',
    ]);
  });

  it('con registro, devuelve lo que responde la consulta', async () => {
    const puerto = new UltimaEmisionDeEmisor();
    puerto.registrar(async (emisorId) => (emisorId === 'con' ? '2026-11-02' : null));
    expect(await puerto.fecha('con')).toBe('2026-11-02');
    expect(await puerto.fecha('sin')).toBeNull();
  });
});

describe('RegistroImpresoraDeCaja (facturación ← caja)', () => {
  it('sin registro, reimprimir lanza un error (falla cerrado); con registro, delega', async () => {
    const registro = new RegistroImpresoraDeCaja();
    await expect(registro.deLaCaja('caja')).rejects.toThrow(/Nadie registró/);
    registro.registrar(async (cajaId) => (cajaId === 'caja' ? { id: 'imp', gaveta: true } : null));
    expect(await registro.deLaCaja('caja')).toEqual({ id: 'imp', gaveta: true });
    expect(await registro.deLaCaja('otra')).toBeNull();
  });
});

describe('RegistroDeCobros (pedidos ← caja)', () => {
  const cuenta = { lineas: [], descuentoCuenta: null, tasaIgv: null, montoIcbper: '0.50' };

  it('sin registro, rechaza todo cambio de una cuenta con cobros (falla cerrado)', async () => {
    const registro = new RegistroDeCobros();
    expect(await registro.validarCambio('orden', cuenta)).toEqual({
      permitido: false,
      codigo: 'CUENTA_COBRADA_EN_PARTE',
    });
  });

  it('con registro, delega en quien se registró', async () => {
    const registro = new RegistroDeCobros();
    registro.registrar({ validarCambio: async () => ({ permitido: true }) });
    expect(await registro.validarCambio('orden', cuenta)).toEqual({ permitido: true });
  });
});

describe('RegistroAlcanceDeTurnos (facturación ← caja)', () => {
  it('sin registro, nadie es responsable de ningún turno (un Cajero no ve nada)', async () => {
    const registro = new RegistroAlcanceDeTurnos();
    expect(await registro.responsableDe('turno')).toBeNull();
  });

  it('con registro, devuelve el responsable que dice caja', async () => {
    const registro = new RegistroAlcanceDeTurnos();
    registro.registrar(async (turnoId) => (turnoId === 'mio' ? 'usuario' : null));
    expect(await registro.responsableDe('mio')).toBe('usuario');
    expect(await registro.responsableDe('otro')).toBeNull();
  });
});

describe('AlcanceDeReimpresion (impresión ← caja y facturación)', () => {
  it('sin registro, reimprimir un documento de caja responde 403 PROHIBIDO (falla cerrado)', async () => {
    const puerto = new AlcanceDeReimpresion();
    for (const tipo of ['COMPROBANTE', 'REPORTE_X', 'REPORTE_Z'] as const) {
      const error = await puerto
        .exigir({ tipo, comprobanteId: 'c', turnoId: 't' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorAplicacion);
      expect([(error as ErrorAplicacion).getStatus(), (error as ErrorAplicacion).codigo]).toEqual([
        403,
        'PROHIBIDO',
      ]);
    }
  });

  it('con registro, llama al comprobador del tipo y deja pasar lo que no lanza', async () => {
    const puerto = new AlcanceDeReimpresion();
    const vistos: string[] = [];
    puerto.registrar(['REPORTE_X'], async (t) => {
      vistos.push(t.tipo);
    });
    await puerto.exigir({ tipo: 'REPORTE_X', comprobanteId: null, turnoId: 't' });
    expect(vistos).toEqual(['REPORTE_X']);
    const otro = await puerto
      .exigir({ tipo: 'REPORTE_Z', comprobanteId: null, turnoId: 't' })
      .catch((e: unknown) => e);
    expect(otro).toBeInstanceOf(ErrorAplicacion);
  });
});
