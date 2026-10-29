import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearMotorReal } from '../src/modulos/cocina/sonido';

// spec: 004-salon-cocina, criterio 96 (aviso sonoro del KDS; el navegador exige un toque antes de sonar).

/** Un `AudioContext` de mentira que empieza suspendido, como el de un navegador sin toque previo. */
function instalarAudioFalso() {
  const notas: number[] = [];
  class AudioFalso {
    static instancias = 0;
    state: 'suspended' | 'running' = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() {
      AudioFalso.instancias += 1;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const oscilador = {
        type: 'sine',
        frequency: { value: 0 },
        connect: (siguiente: unknown) => siguiente,
        start: () => notas.push(oscilador.frequency.value),
        stop: () => undefined,
      };
      return oscilador;
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
        connect: (siguiente: unknown) => siguiente,
      };
    }
  }
  vi.stubGlobal('AudioContext', AudioFalso);
  Object.defineProperty(window, 'AudioContext', { value: AudioFalso, configurable: true });
  return { notas, AudioFalso };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'AudioContext');
});

describe('motor de sonido del KDS', () => {
  it('no suena hasta que una persona toca la pantalla', async () => {
    const { notas } = instalarAudioFalso();
    const motor = crearMotorReal();
    expect(motor.listo()).toBe(false);
    expect(motor.avisar()).toBe(false);
    expect(notas).toEqual([]);

    // El primer toque crea el contexto y lo despierta.
    motor.desbloquear();
    await Promise.resolve();
    expect(motor.listo()).toBe(true);
    expect(motor.avisar()).toBe(true);
    // Dos notas, la segunda más aguda.
    expect(notas).toHaveLength(2);
    expect(notas[1]).toBeGreaterThan(notas[0] ?? Infinity);
  });

  it('usa un solo contexto aunque se toque muchas veces', async () => {
    const { AudioFalso } = instalarAudioFalso();
    const motor = crearMotorReal();
    motor.desbloquear();
    motor.desbloquear();
    motor.desbloquear();
    await Promise.resolve();
    expect(AudioFalso.instancias).toBe(1);
  });

  it('sin audio en el navegador, no falla ni suena', () => {
    const motor = crearMotorReal();
    expect(motor.desbloquear()).toBe(false);
    expect(motor.avisar()).toBe(false);
  });
});
