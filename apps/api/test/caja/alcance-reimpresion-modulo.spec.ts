// Historia 006 · caja, cobro y comprobantes · prueba del desarrollador (no protegida) de la revisión T26 (M2): la
// reimpresión de 004 de un trabajo COMPROBANTE, REPORTE_X o REPORTE_Z exige además el módulo del plan de la sucursal
// activa (FACTURACION para el comprobante, CAJA para los reportes), como las rutas propias de esos documentos. Los
// comprobadores se prueban con el plan de la sucursal simulado; el recorrido completo con la base está en
// `caja-critica/ataque-ronda1.spec.ts` (F3).
import { describe, expect, it, vi } from 'vitest';
import type { Modulo } from '@restaurante/dominio';
import { AlcanceDeReimpresionDeReportes } from '../../src/modulos/caja/alcance-de-reimpresion-de-reportes';
import { AlcanceDeReimpresionDeComprobantes } from '../../src/modulos/facturacion/alcance-de-reimpresion-de-comprobantes';
import { AlcanceDeReimpresion } from '../../src/modulos/impresion';
import { ejecutarConPrincipal, type Principal } from '../../src/nucleo/principal';

const SUCURSAL = '11111111-1111-4111-8111-111111111111';
const principal = { sucursalId: SUCURSAL } as unknown as Principal;

function armar(modulos: Modulo[]) {
  const alcance = new AlcanceDeReimpresion();
  const exigirComprobante = vi.fn(async () => undefined);
  const exigirTurno = vi.fn(async () => undefined);
  const suscripciones = { modulosDeSucursal: vi.fn(async () => modulos) };
  new AlcanceDeReimpresionDeComprobantes(
    alcance,
    { exigirReimpresion: exigirComprobante } as never,
    suscripciones as never,
  ).onModuleInit();
  new AlcanceDeReimpresionDeReportes(
    alcance,
    { exigirReimpresion: exigirTurno } as never,
    suscripciones as never,
  ).onModuleInit();
  const reimprimir = (tipo: 'COMPROBANTE' | 'REPORTE_X' | 'REPORTE_Z') =>
    ejecutarConPrincipal(principal, () =>
      alcance.exigir({
        tipo,
        comprobanteId: tipo === 'COMPROBANTE' ? 'c1' : null,
        turnoId: tipo === 'COMPROBANTE' ? null : 't1',
      }),
    );
  return { reimprimir, exigirComprobante, exigirTurno, suscripciones };
}

describe('M2 · la reimpresión de 004 exige el módulo del plan', () => {
  it.each([
    ['COMPROBANTE', ['CAJA']],
    ['REPORTE_X', ['FACTURACION']],
    ['REPORTE_Z', ['FACTURACION']],
  ] as const)(
    '%s sin su módulo: 403 MODULO_NO_INCLUIDO y no se comprueba nada más',
    async (tipo, modulos) => {
      const { reimprimir, exigirComprobante, exigirTurno } = armar([...modulos] as Modulo[]);
      await expect(reimprimir(tipo)).rejects.toMatchObject({
        status: 403,
        codigo: 'MODULO_NO_INCLUIDO',
      });
      expect(exigirComprobante).not.toHaveBeenCalled();
      expect(exigirTurno).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['COMPROBANTE', ['FACTURACION']],
    ['REPORTE_X', ['CAJA']],
    ['REPORTE_Z', ['CAJA']],
  ] as const)('%s con su módulo pasa al permiso y alcance propios', async (tipo, modulos) => {
    const { reimprimir, exigirComprobante, exigirTurno } = armar([...modulos] as Modulo[]);
    await reimprimir(tipo);
    expect(exigirComprobante.mock.calls.length + exigirTurno.mock.calls.length).toBe(1);
  });
});
