// Pruebas del desarrollador (no protegidas) de I-5: `TopeDeIntentos` directamente, con temporizadores falsos.
// Cubren el tope de ingresos simultáneos, el turno por nombre (orden de llegada, espera máxima, liberación
// cuando `fn` lanza) y las memorias de ráfaga (`olvidar`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import {
  TopeDeIntentos,
  claveDeCambioContrasena,
  claveDeIngresoSuperadministrador,
  claveDeIngresoUsuario,
  demasiadosALaVez,
} from '../../src/modulos/seguridad/tope-de-intentos';

/** Deja correr las continuaciones pendientes (microtareas) sin avanzar el reloj. */
const turno = () => vi.advanceTimersByTimeAsync(0);

/** Una tarea que queda esperando hasta que se llame a `terminar()`; guarda el orden en que arrancó. */
function tareaManual(arranques: string[], id: string) {
  let terminar!: () => void;
  const fn = () =>
    new Promise<string>((resolver) => {
      arranques.push(id);
      terminar = () => resolver(id);
    });
  return { fn, terminar: () => terminar() };
}

const esDemasiadosALaVez = (error: unknown) => {
  expect(error).toBeInstanceOf(ErrorAplicacion);
  expect(error).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL', reintentarEnSegundos: 1 });
  expect((error as ErrorAplicacion).getStatus()).toBe(429);
};

let tope: TopeDeIntentos;
beforeEach(() => {
  vi.useFakeTimers();
  tope = new TopeDeIntentos();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('claves de los topes', () => {
  it('cada tipo de cuenta tiene su prefijo, así un nombre de empresa y uno de plataforma no comparten tope', () => {
    expect(claveDeIngresoUsuario('ana')).toBe('contrasena:ana');
    expect(claveDeIngresoSuperadministrador('ana')).toBe('superadministrador:ana');
    expect(claveDeCambioContrasena('u1')).toBe('cambio-contrasena:u1');
    expect(
      new Set([claveDeIngresoUsuario('ana'), claveDeIngresoSuperadministrador('ana')]).size,
    ).toBe(2);
  });

  it('demasiadosALaVez es 429 BLOQUEO_TEMPORAL de 1 s', () => {
    esDemasiadosALaVez(demasiadosALaVez());
  });
});

describe('TopeDeIntentos.entrar: ingresos simultáneos por nombre', () => {
  it('acepta 10 a la vez y rechaza el 11.º con 429 de 1 s', () => {
    const lugares = Array.from({ length: 10 }, () => tope.entrar('contrasena:ana'));
    expect(() => tope.entrar('contrasena:ana')).toThrow(ErrorAplicacion);
    try {
      tope.entrar('contrasena:ana');
    } catch (error) {
      esDemasiadosALaVez(error);
    }
    // Otro nombre tiene su propio tope.
    expect(() => tope.entrar('contrasena:beto')).not.toThrow();
    lugares[0]!.soltar();
    expect(() => tope.entrar('contrasena:ana')).not.toThrow();
  });

  it('soltar es idempotente: soltar dos veces libera un solo lugar', () => {
    const lugares = Array.from({ length: 10 }, () => tope.entrar('contrasena:ana'));
    lugares[0]!.soltar();
    lugares[0]!.soltar();
    lugares[0]!.soltar();
    tope.entrar('contrasena:ana'); // ocupa el lugar liberado
    expect(() => tope.entrar('contrasena:ana')).toThrow(ErrorAplicacion); // no hay un segundo hueco
  });

  it('una ráfaga empieza con el tercer ingreso simultáneo y termina al soltar', () => {
    expect(tope.entrar('k').enRafaga).toBe(false);
    expect(tope.entrar('k').enRafaga).toBe(false);
    const tercero = tope.entrar('k');
    expect(tercero.enRafaga).toBe(true);
    tercero.soltar();
    expect(tope.entrar('k').enRafaga).toBe(true); // vuelve a haber 3 en curso
  });
});

describe('TopeDeIntentos.conTurno: un ingreso a la vez por nombre', () => {
  it('sin competencia corre al instante y devuelve el resultado de fn', async () => {
    await expect(tope.conTurno('k', async () => 42)).resolves.toBe(42);
  });

  it('el turno pasa en orden de llegada', async () => {
    const arranques: string[] = [];
    const a = tareaManual(arranques, 'a');
    const b = tareaManual(arranques, 'b');
    const c = tareaManual(arranques, 'c');
    const pa = tope.conTurno('k', a.fn);
    const pb = tope.conTurno('k', b.fn);
    const pc = tope.conTurno('k', c.fn);
    await turno();
    expect(arranques).toEqual(['a']);
    a.terminar();
    await turno();
    expect(arranques).toEqual(['a', 'b']);
    b.terminar();
    await turno();
    expect(arranques).toEqual(['a', 'b', 'c']);
    c.terminar();
    await expect(Promise.all([pa, pb, pc])).resolves.toEqual(['a', 'b', 'c']);
  });

  it('nombres distintos no se esperan entre sí', async () => {
    const arranques: string[] = [];
    const a = tareaManual(arranques, 'a');
    const b = tareaManual(arranques, 'b');
    const pa = tope.conTurno('k1', a.fn);
    const pb = tope.conTurno('k2', b.fn);
    await turno();
    expect(arranques).toEqual(['a', 'b']);
    a.terminar();
    b.terminar();
    await Promise.all([pa, pb]);
  });

  it('el turno se libera cuando fn lanza: el siguiente corre y el error llega a quien lo causó', async () => {
    const arranques: string[] = [];
    const siguiente = tareaManual(arranques, 'siguiente');
    const falla = tope.conTurno('k', async () => {
      arranques.push('falla');
      throw new Error('fn falló');
    });
    const ps = tope.conTurno('k', siguiente.fn);
    const rechazo = expect(falla).rejects.toThrow('fn falló');
    await turno();
    await rechazo;
    expect(arranques).toEqual(['falla', 'siguiente']);
    siguiente.terminar();
    await expect(ps).resolves.toBe('siguiente');
    // Y la clave quedó libre: un nuevo ingreso corre al instante.
    await expect(tope.conTurno('k', async () => 'libre')).resolves.toBe('libre');
  });

  it('espera como máximo 5 s: pasado el plazo responde 429 de 1 s sin ejecutar fn y sin trabar a los demás', async () => {
    const arranques: string[] = [];
    const dueño = tareaManual(arranques, 'dueño');
    const pd = tope.conTurno('k', dueño.fn);
    const impaciente = vi.fn(async () => 'no debe correr');
    const pi = tope.conTurno('k', impaciente);
    const resultadoImpaciente = pi.then(
      () => undefined,
      (error: unknown) => error,
    );
    const ultimo = tareaManual(arranques, 'ultimo');
    await vi.advanceTimersByTimeAsync(4_999);
    const pu = tope.conTurno('k', ultimo.fn); // llega a los 4,999 s: tiene su propio plazo de 5 s
    let resuelto = false;
    void resultadoImpaciente.then(() => {
      resuelto = true;
    });
    await turno();
    expect(resuelto).toBe(false); // a 4,999 s todavía espera
    await vi.advanceTimersByTimeAsync(1);
    esDemasiadosALaVez(await resultadoImpaciente);
    expect(impaciente).not.toHaveBeenCalled();
    // El rechazado salió de la cola: al terminar el dueño, el turno pasa al que sigue.
    dueño.terminar();
    await turno();
    expect(arranques).toEqual(['dueño', 'ultimo']);
    ultimo.terminar();
    await Promise.all([pd, pu]);
  });

  it('quien recibe el turno antes del plazo cancela su temporizador (no queda ningún temporizador vivo)', async () => {
    const arranques: string[] = [];
    const a = tareaManual(arranques, 'a');
    const b = tareaManual(arranques, 'b');
    const pa = tope.conTurno('k', a.fn);
    const pb = tope.conTurno('k', b.fn);
    await turno();
    a.terminar();
    await turno();
    b.terminar();
    await Promise.all([pa, pb]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TopeDeIntentos: memorias de ráfaga y olvidar', () => {
  const ahora = new Date('2026-11-02T10:00:00-05:00');

  it('recordarSinCuenta se consulta mientras no pasen 2 s y se olvida después', () => {
    expect(tope.esSinCuentaReciente('k')).toBe(false);
    tope.recordarSinCuenta('k');
    expect(tope.esSinCuentaReciente('k')).toBe(true);
    vi.advanceTimersByTime(1_999);
    expect(tope.esSinCuentaReciente('k')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tope.esSinCuentaReciente('k')).toBe(false);
  });

  it('bloqueoReciente devuelve el fin del bloqueo solo mientras sea vigente a la hora de la API y no pasen 2 s', () => {
    const hasta = new Date(ahora.getTime() + 60_000);
    expect(tope.bloqueoReciente('k', ahora)).toBeNull();
    tope.recordarBloqueo('k', hasta);
    expect(tope.bloqueoReciente('k', ahora)).toEqual(hasta);
    // El reloj de la API ya pasó el fin del bloqueo: no se aplica aunque la memoria siga viva.
    expect(tope.bloqueoReciente('k', new Date(hasta.getTime()))).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(tope.bloqueoReciente('k', ahora)).toBeNull();
  });

  it('olvidar borra las dos memorias de esa clave y deja las de las demás', () => {
    const hasta = new Date(ahora.getTime() + 60_000);
    tope.recordarSinCuenta('ana');
    tope.recordarBloqueo('ana', hasta);
    tope.recordarSinCuenta('beto');
    tope.recordarBloqueo('beto', hasta);
    tope.olvidar('ana');
    expect(tope.esSinCuentaReciente('ana')).toBe(false);
    expect(tope.bloqueoReciente('ana', ahora)).toBeNull();
    expect(tope.esSinCuentaReciente('beto')).toBe(true);
    expect(tope.bloqueoReciente('beto', ahora)).toEqual(hasta);
  });

  it('olvidar una clave que no se recuerda no falla', () => {
    expect(() => tope.olvidar('nadie')).not.toThrow();
  });

  it('las memorias están acotadas: al pasar de 1000 claves se olvida la más antigua', () => {
    for (let i = 0; i <= 1_000; i++) tope.recordarSinCuenta(`k${i}`);
    expect(tope.esSinCuentaReciente('k0')).toBe(false);
    expect(tope.esSinCuentaReciente('k1')).toBe(true);
    expect(tope.esSinCuentaReciente('k1000')).toBe(true);
  });
});
