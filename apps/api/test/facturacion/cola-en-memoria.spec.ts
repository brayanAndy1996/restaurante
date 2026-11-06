import { describe, expect, it } from 'vitest';
import { ColaEnMemoria } from '../../src/nucleo/colas';

// Pruebas del desarrollador (no protegidas) de la cola en memoria (historia 006, criterios 124 y 137).

const A = { empresaId: '11111111-1111-1111-1111-111111111111', comprobanteId: 'c1' };
const B = { empresaId: '22222222-2222-2222-2222-222222222222', comprobanteId: 'c2' };

describe('ColaEnMemoria', () => {
  it('guarda los trabajos en orden sin procesarlos y con solo la empresa y el comprobante', async () => {
    const cola = new ColaEnMemoria();
    await cola.encolar(A);
    await cola.encolar(B);
    expect(cola.pendientes()).toEqual([
      { ...A, startAfter: null },
      { ...B, startAfter: null },
    ]);
    expect(Object.keys(cola.pendientes()[0] ?? {}).sort()).toEqual([
      'comprobanteId',
      'empresaId',
      'startAfter',
    ]);
  });

  it('no deduplica: el procesador es quien garantiza un solo envío por comprobante', async () => {
    const cola = new ColaEnMemoria();
    for (let i = 0; i < 10; i += 1) await cola.encolar(A);
    expect(cola.pendientes()).toHaveLength(10);
  });

  it('procesarPendientes entrega los vencidos en orden y deja los que esperan', async () => {
    const cola = new ColaEnMemoria();
    const ahora = new Date('2026-11-06T15:00:00.000Z');
    await cola.encolar(A);
    await cola.encolar(B, { startAfter: new Date('2026-11-06T15:01:00.000Z') });
    const vistos: string[] = [];
    const n = await cola.procesarPendientes((t) => {
      vistos.push(t.comprobanteId);
      return Promise.resolve();
    }, ahora);
    expect(n).toBe(1);
    expect(vistos).toEqual(['c1']);
    expect(cola.pendientes().map((t) => t.comprobanteId)).toEqual(['c2']);
    const m = await cola.procesarPendientes((t) => {
      vistos.push(t.comprobanteId);
      return Promise.resolve();
    }, new Date('2026-11-06T15:01:00.000Z'));
    expect(m).toBe(1);
    expect(vistos).toEqual(['c1', 'c2']);
    expect(cola.pendientes()).toEqual([]);
  });

  it('un procesador que encola otro trabajo vencido lo recibe en la misma pasada', async () => {
    const cola = new ColaEnMemoria();
    await cola.encolar(A);
    const vistos: string[] = [];
    await cola.procesarPendientes(async (t) => {
      vistos.push(t.comprobanteId);
      if (t.comprobanteId === 'c1') await cola.encolar(B);
    });
    expect(vistos).toEqual(['c1', 'c2']);
  });

  it('fallarProximosEncolados hace fallar el encolado esas veces sin guardar nada', async () => {
    const cola = new ColaEnMemoria();
    cola.fallarProximosEncolados(1);
    await expect(cola.encolar(A)).rejects.toThrow(/fallo de encolado/);
    expect(cola.pendientes()).toEqual([]);
    await cola.encolar(A);
    expect(cola.pendientes()).toHaveLength(1);
  });

  it('trabajar guarda el procesador pero nunca lo llama solo', async () => {
    const cola = new ColaEnMemoria();
    let llamadas = 0;
    await cola.trabajar(() => {
      llamadas += 1;
      return Promise.resolve();
    });
    await cola.encolar(A);
    expect(llamadas).toBe(0);
    await cola.procesarPendientes(cola.procesador()!);
    expect(llamadas).toBe(1);
    await cola.detener();
    expect(cola.procesador()).toBeNull();
  });
});
