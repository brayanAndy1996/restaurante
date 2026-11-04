// Historia 006 · caja, cobro y comprobantes, grupo C1 (T6) · pruebas del desarrollador (no protegidas) de los puertos que
// un módulo registra al arrancar en otro cuando la dependencia iría al revés (plan, "Dependencias"): sin registro,
// fallan cerrado en lugar de aceptar lo que no pueden comprobar.
import { describe, expect, it } from 'vitest';
import { RegistroImpresoraDeCaja } from '../../src/modulos/facturacion';
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
