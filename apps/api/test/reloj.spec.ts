import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { RELOJ, RelojManual, RelojSistema } from '../src/nucleo/reloj';
import { fijarEntornoDePrueba } from './utilidades';

describe('RelojManual', () => {
  it('empieza en el instante dado y no avanza solo', async () => {
    const reloj = new RelojManual('2026-11-02T15:00:00-05:00');
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T20:00:00.000Z');
    await new Promise((resolver) => setTimeout(resolver, 15));
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T20:00:00.000Z');
  });

  it('fijar acepta Date, texto ISO y milisegundos; avanzar mueve hacia adelante y hacia atrás', () => {
    const reloj = new RelojManual(new Date('2026-01-01T00:00:00Z'));
    reloj.fijar(new Date('2026-11-02T12:00:00Z'));
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T12:00:00.000Z');
    reloj.fijar('2026-11-03T00:00:00-05:00');
    expect(reloj.ahora().toISOString()).toBe('2026-11-03T05:00:00.000Z');
    reloj.fijar(0);
    expect(reloj.ahora().getTime()).toBe(0);
    reloj.fijar('2026-11-02T12:00:00Z');
    reloj.avanzar(15 * 60 * 1000);
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T12:15:00.000Z');
    reloj.avanzar(-60_000);
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T12:14:00.000Z');
  });

  it('devuelve un Date nuevo cada vez: modificarlo no cambia el reloj', () => {
    const reloj = new RelojManual('2026-11-02T12:00:00Z');
    reloj.ahora().setFullYear(2000);
    expect(reloj.ahora().toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('rechaza instantes y duraciones inválidos', () => {
    const reloj = new RelojManual('2026-11-02T12:00:00Z');
    expect(() => reloj.fijar('no es una fecha')).toThrow(RangeError);
    expect(() => reloj.avanzar(Number.NaN)).toThrow(RangeError);
    expect(() => new RelojManual(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('RelojSistema devuelve la hora real', () => {
    const antes = Date.now();
    const ahora = new RelojSistema().ahora().getTime();
    expect(ahora).toBeGreaterThanOrEqual(antes);
    expect(ahora).toBeLessThanOrEqual(Date.now());
  });
});

describe('crearAplicacion({ reloj })', () => {
  const abiertas: INestApplication[] = [];
  afterEach(async () => {
    while (abiertas.length) await abiertas.pop()?.close();
  });

  it('instala el reloj de la prueba como RELOJ', async () => {
    fijarEntornoDePrueba();
    const reloj = new RelojManual('2026-11-02T12:00:00Z');
    const app = await crearAplicacion({ reloj });
    abiertas.push(app);
    expect(app.get(RELOJ)).toBe(reloj);
    reloj.avanzar(1000);
    expect(app.get<RelojManual>(RELOJ).ahora().toISOString()).toBe('2026-11-02T12:00:01.000Z');
  });

  it('sin la opción usa el reloj del sistema', async () => {
    fijarEntornoDePrueba();
    const app = await crearAplicacion();
    abiertas.push(app);
    expect(app.get(RELOJ)).toBeInstanceOf(RelojSistema);
  });

  it('dos aplicaciones en el mismo proceso tienen cada una su reloj', async () => {
    fijarEntornoDePrueba();
    const a = new RelojManual('2026-01-01T00:00:00Z');
    const b = new RelojManual('2027-01-01T00:00:00Z');
    abiertas.push(await crearAplicacion({ reloj: a }), await crearAplicacion({ reloj: b }));
    expect(abiertas[0]?.get(RELOJ)).toBe(a);
    expect(abiertas[1]?.get(RELOJ)).toBe(b);
  });
});
