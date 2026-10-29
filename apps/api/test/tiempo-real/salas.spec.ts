import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EventoPublicable } from '../../src/nucleo/eventos';
import { salaDeSocketIo } from '../../src/nucleo/tiempo-real';

// Historia 004, criterio 67 (T10): la sala de Socket.IO de un evento siempre lleva la empresa, y un evento que no
// se puede dirigir a una sala así no llega a nadie. No es una prueba protegida.

const evento = (
  empresaId: string,
  sala: EventoPublicable['sala'],
  nombre = 'orden.cambio',
): EventoPublicable => ({ empresaId, sala, nombre, datos: { ordenId: randomUUID() } });

describe('salaDeSocketIo', () => {
  const empresa = randomUUID();
  const sucursal = randomUUID();

  it('traduce la sala empresa y la sala sucursal, siempre con la empresa', () => {
    expect(salaDeSocketIo(evento(empresa, { tipo: 'empresa' }))).toBe(`e:${empresa}`);
    expect(salaDeSocketIo(evento(empresa, { tipo: 'sucursal', sucursalId: sucursal }))).toBe(
      `s:${empresa}:${sucursal}`,
    );
  });

  it('normaliza las ids a minúsculas', () => {
    expect(
      salaDeSocketIo(
        evento(empresa.toUpperCase(), { tipo: 'sucursal', sucursalId: sucursal.toUpperCase() }),
      ),
    ).toBe(`s:${empresa}:${sucursal}`);
  });

  it('una empresa o una sucursal que no son UUID no tienen sala (el evento no llega a nadie)', () => {
    for (const mala of ['', 'x', `${empresa}:${sucursal}`, `${empresa}\n`, '*']) {
      expect(salaDeSocketIo(evento(mala, { tipo: 'empresa' })), mala).toBeNull();
      expect(
        salaDeSocketIo(evento(empresa, { tipo: 'sucursal', sucursalId: mala })),
        mala,
      ).toBeNull();
    }
  });

  it('la sala de puente no tiene destino hasta la entrega 3b', () => {
    expect(salaDeSocketIo(evento(empresa, { tipo: 'puente', puenteId: randomUUID() }))).toBeNull();
  });
});
