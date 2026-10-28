import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, espera } from '../src/lib/api';
import { conexion } from '../src/lib/conexion';
import { borrarTokenDeSesion, guardarTokenDeSesion, tokenDeSesion } from '../src/lib/almacen';
import { EnvioCancelado, enviarSinPerder, instalarAvisoAlSalir } from '../src/lib/envios';
import { avisosDeEnvio } from '../src/lib/envios-cancelados';
import { ErrorApi } from '../src/lib/errores';
import {
  avisarCambioDeIdentidad,
  configurarIdentidad,
  identidadActual,
} from '../src/lib/identidad';
import { falla, json, servidor } from './ayudas';

// Sesión de la prueba: el token vive en `sessionStorage` (como en la app) y la sucursal activa en una variable.
const TOKEN_MARTA =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.marta';
const TOKEN_LUCIA =
  'se.11111111-1111-4111-8111-111111111111.55555555-5555-4555-8555-555555555555.lucia';
const SUC_A = '33333333-3333-4333-8333-333333333333';
const SUC_B = '44444444-4444-4444-8444-444444444444';
let sucursalActiva: string | null = SUC_A;

beforeEach(() => {
  conexion.reiniciar();
  avisosDeEnvio.descartar();
  guardarTokenDeSesion(TOKEN_MARTA);
  sucursalActiva = SUC_A;
  configurarIdentidad(() => ({ token: tokenDeSesion(), sucursalId: sucursalActiva }));
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  avisosDeEnvio.descartar();
  configurarIdentidad(() => ({ token: tokenDeSesion(), sucursalId: null }));
});

const enviarAlgo = () =>
  enviarSinPerder((extra) => api.post<{ id: string }>('/cosas', { a: 1 }, { ...extra }));

describe('api.ts: aviso del primer reintento', () => {
  it('avisa una sola vez cuando la llamada empieza a reintentarse, no si sale a la primera', async () => {
    const alReintentar = vi.fn();
    let intentos = 0;
    servidor({
      'PUT /a': () => json(200, {}),
      'PUT /b': () => {
        intentos++;
        if (intentos < 4) throw new TypeError('Failed to fetch');
        return json(200, {});
      },
    });
    await api.put('/a', {}, { alReintentar });
    expect(alReintentar).not.toHaveBeenCalled();
    await api.put('/b', {}, { alReintentar });
    expect(alReintentar).toHaveBeenCalledTimes(1);
  });

  it('un 503 de paso también cuenta como reintento', async () => {
    const alReintentar = vi.fn();
    let intentos = 0;
    servidor({
      'PUT /c': () =>
        ++intentos < 2 ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, {}),
    });
    await api.put('/c', {}, { alReintentar });
    expect(alReintentar).toHaveBeenCalledTimes(1);
  });
});

describe('enviarSinPerder', () => {
  it('si sale a la primera no avisa de nada y manda una clave de idempotencia', async () => {
    const alCambiar = vi.fn();
    const s = servidor({ 'POST /cosas': () => json(201, { id: 'ok' }) });
    const respuesta = await enviarSinPerder(
      (extra) => api.post<{ id: string }>('/cosas', { a: 1 }, { ...extra }),
      { alCambiar },
    );
    expect(respuesta).toEqual({ id: 'ok' });
    expect(alCambiar).not.toHaveBeenCalled();
    expect(s.llamadas[0]?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un corte corto lo resuelve api.ts con la misma clave, pero ya queda "pendiente" mientras tanto', async () => {
    const estados: boolean[] = [];
    let intentos = 0;
    const s = servidor({
      'POST /cosas': () => {
        intentos++;
        if (intentos < 3) throw new TypeError('Failed to fetch');
        return json(201, { id: 'ok' });
      },
    });
    await enviarSinPerder((extra) => api.post<{ id: string }>('/cosas', { a: 1 }, { ...extra }), {
      alCambiar: (p) => estados.push(p),
    });
    expect(estados).toEqual([true, false]);
    expect(new Set(s.llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('si api.ts se rinde, sigue esperando la red y reenvía con LA MISMA clave hasta que sale', async () => {
    let sinRed = true;
    const s = servidor({
      'POST /cosas': () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(201, { id: 'ok' });
      },
    });
    const esperas: number[] = [];
    let rondas = 0;
    vi.spyOn(espera, 'dormir').mockImplementation(async (ms) => {
      esperas.push(ms);
      // Cuenta también las esperas cortas de api.ts: la red vuelve en el tercer intento de este envío.
      if (++rondas === 10) sinRed = false;
    });
    const estados: boolean[] = [];
    const respuesta = await enviarSinPerder(
      (extra) => api.post<{ id: string }>('/cosas', { a: 1 }, { ...extra }),
      { alCambiar: (p) => estados.push(p) },
    );
    expect(respuesta).toEqual({ id: 'ok' });
    expect(estados).toEqual([true, false]);
    expect(s.llamadas.length).toBeGreaterThan(7);
    expect(new Set(s.llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
    // Después de los reintentos de api.ts, las esperas largas crecen: 15 s, 30 s y luego 60 s.
    expect(esperas).toContain(15_000);
    expect(esperas).toContain(30_000);
  });

  it('mientras espera cuenta el cambio como pendiente una sola vez y lo suelta al terminar', async () => {
    let sinRed = true;
    const cuentas: number[] = [];
    servidor({
      'POST /cosas': () => {
        cuentas.push(conexion.leer().pendientes);
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(201, { id: 'ok' });
      },
    });
    let rondas = 0;
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      // Durante la espera larga (fuera de api.ts) el cambio sigue contado, pero no doblemente.
      if (++rondas === 1) cuentas.push(-conexion.leer().pendientes);
      if (rondas === 2) sinRed = false;
    });
    await enviarAlgo();
    expect(conexion.leer().pendientes).toBe(0);
    // Dentro de cada intento, como mucho 1 (el de api.ts); nunca 2.
    expect(Math.max(...cuentas.filter((c) => c >= 0))).toBeLessThanOrEqual(1);
    expect(cuentas).toContain(-1);
  });

  it('un error de negocio (4xx) no se reintenta: termina con ese error y sin "pendiente"', async () => {
    const estados: boolean[] = [];
    const s = servidor({
      'POST /cosas': () => json(409, { codigo: 'CONFLICTO', mensaje: 'Ya existe' }),
    });
    const error = await falla(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), {
        alCambiar: (p) => estados.push(p),
      }),
    );
    expect(error.codigo).toBe('CONFLICTO');
    expect(s.llamadas).toHaveLength(1);
    expect(estados).toEqual([]);
  });

  it('un 500 del servidor tampoco se reintenta en una escritura', async () => {
    const s = servidor({
      'POST /cosas': () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    const error = await falla(enviarAlgo());
    expect(error.codigo).toBe('ERROR_INTERNO');
    expect(s.llamadas).toHaveLength(1);
  });

  it('si la red no vuelve nunca, se rinde con "sin conexión" y suelta lo pendiente', async () => {
    const estados: boolean[] = [];
    servidor({
      'POST /cosas': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const error = await falla(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), {
        alCambiar: (p) => estados.push(p),
      }),
    );
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.sinConexion).toBe(true);
    expect(estados).toEqual([true, false]);
    expect(conexion.leer().pendientes).toBe(0);
  });

  it('cerrar la sesión (cancelar la espera) corta el envío', async () => {
    const control = new AbortController();
    servidor({
      'POST /cosas': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      control.abort();
    });
    await expect(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), {
        senal: control.signal,
      }),
    ).rejects.toBeDefined();
    expect(conexion.leer().pendientes).toBe(0);
  });
});

/**
 * Un servidor sin red hasta que se abra, y una espera larga (la primera de `enviarSinPerder`, después de que
 * `api.ts` agotó sus reintentos) donde la prueba cambia la sesión. Devuelve cómo leer lo que salió.
 */
function conRedCaidaHastaLaEspera(alEsperar: () => void) {
  const s = servidor({
    'POST /cosas': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  let rondas = 0;
  vi.spyOn(espera, 'dormir').mockImplementation(async () => {
    // Las 6 primeras son los reintentos cortos de api.ts; la 7.ª es la espera larga de este envío.
    if (++rondas === 7) alEsperar();
  });
  return s;
}

describe('enviarSinPerder: atado a la sesión que lo originó (trazabilidad de autor)', () => {
  it('si entra otra persona mientras espera, el envío se cancela y no sale con la sesión nueva', async () => {
    const s = conRedCaidaHastaLaEspera(() => {
      guardarTokenDeSesion(TOKEN_LUCIA);
      avisarCambioDeIdentidad();
    });
    const antes = s.llamadas.length;
    const error = await falla(enviarAlgo());
    expect(error).toBeInstanceOf(EnvioCancelado);
    expect((error as EnvioCancelado).motivo).toBe('usuario');
    expect(error.codigo).toBe('ENVIO_CANCELADO');
    expect(error.message).toBe('No se envió: cambiaste de usuario.');
    // Ninguna petición salió con el token de Lucía: todas las que hubo eran de Marta.
    expect(s.llamadas.length).toBeGreaterThan(antes);
    expect(
      s.llamadas.every((l) => l.cabeceras.get('Authorization') === `Bearer ${TOKEN_MARTA}`),
    ).toBe(true);
    expect(conexion.leer().pendientes).toBe(0);
  });

  it('si se cierra la sesión mientras espera, se cancela con "se cerró la sesión"', async () => {
    const s = conRedCaidaHastaLaEspera(() => {
      borrarTokenDeSesion();
      avisarCambioDeIdentidad();
    });
    const error = await falla(enviarAlgo());
    expect((error as EnvioCancelado).motivo).toBe('cierre');
    expect(error.message).toBe('No se envió: se cerró la sesión.');
    expect(
      s.llamadas.every((l) => l.cabeceras.get('Authorization') === `Bearer ${TOKEN_MARTA}`),
    ).toBe(true);
  });

  it('"Cambiar usuario" cierra la sesión pero se dice como lo que es', async () => {
    conRedCaidaHastaLaEspera(() => {
      borrarTokenDeSesion();
      avisarCambioDeIdentidad('usuario');
    });
    const error = await falla(enviarAlgo());
    expect(error.message).toBe('No se envió: cambiaste de usuario.');
  });

  it('si cambia la sucursal activa con la misma sesión, tampoco sale: caería en otra sucursal', async () => {
    const s = conRedCaidaHastaLaEspera(() => {
      sucursalActiva = SUC_B;
      avisarCambioDeIdentidad();
    });
    const error = await falla(enviarAlgo());
    expect((error as EnvioCancelado).motivo).toBe('sucursal');
    expect(error.message).toBe('No se envió: cambiaste de sucursal.');
    const salidas = s.llamadas.length;
    // Pasa el tiempo y vuelve la red: no se manda nada más.
    s.poner('POST /cosas', () => json(201, { id: 'ok' }));
    await Promise.resolve();
    expect(s.llamadas).toHaveLength(salidas);
  });

  it('aunque nadie avise del cambio, la comprobación antes de cada intento lo detiene', async () => {
    const s = conRedCaidaHastaLaEspera(() => {
      sucursalActiva = SUC_B; // sin avisarCambioDeIdentidad()
    });
    s.poner('POST /cosas', () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await falla(enviarAlgo());
    expect((error as EnvioCancelado).motivo).toBe('sucursal');
    // Se detuvo antes del intento siguiente a la espera larga: el último intento fue el de antes.
    expect(s.llamadas).toHaveLength(7);
  });

  it('el cambio durante los reintentos cortos de api.ts también corta el intento en vuelo', async () => {
    let rondas = 0;
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++rondas === 2) {
        sucursalActiva = SUC_B;
        avisarCambioDeIdentidad();
      }
    });
    const s = servidor({
      'POST /cosas': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const error = await falla(enviarAlgo());
    expect((error as EnvioCancelado).motivo).toBe('sucursal');
    // Dos intentos de api.ts y se acabó: no llegó a los 7 de siempre.
    expect(s.llamadas.length).toBeLessThanOrEqual(3);
  });

  it('un envío encolado antes lleva la identidad de cuando se pidió, no la de cuando le toca salir', async () => {
    const origen = identidadActual();
    guardarTokenDeSesion(TOKEN_LUCIA);
    const s = servidor({ 'POST /cosas': () => json(201, { id: 'ok' }) });
    const error = await falla(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), { identidad: origen }),
    );
    expect((error as EnvioCancelado).motivo).toBe('usuario');
    expect(s.llamadas).toHaveLength(0);
  });

  it('un aviso de sesión sin cambio real (se vuelve a leer la misma) no cancela nada', async () => {
    let sinRed = true;
    const s = servidor({
      'POST /cosas': () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(201, { id: 'ok' });
      },
    });
    let rondas = 0;
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++rondas === 7) {
        avisarCambioDeIdentidad();
        sinRed = false;
      }
    });
    await expect(enviarAlgo()).resolves.toEqual({ id: 'ok' });
    expect(
      s.llamadas.every((l) => l.cabeceras.get('Authorization') === `Bearer ${TOKEN_MARTA}`),
    ).toBe(true);
    expect(avisosDeEnvio.leer()).toBeNull();
  });

  it('un cierre o cambio de persona deja un aviso global; juntos se cuentan', async () => {
    conRedCaidaHastaLaEspera(() => {
      borrarTokenDeSesion();
      avisarCambioDeIdentidad('usuario');
    });
    await falla(enviarAlgo());
    expect(avisosDeEnvio.leer()).toEqual({ motivo: 'usuario', cantidad: 1 });
    // Otro envío que ya nace sin la sesión con la que se pidió.
    const origen = { token: TOKEN_MARTA, sucursalId: SUC_A };
    await falla(
      enviarSinPerder((extra) => api.post('/cosas', {}, { ...extra }), { identidad: origen }),
    );
    expect(avisosDeEnvio.leer()).toEqual({ motivo: 'cierre', cantidad: 1 });
  });

  it('un cambio de sucursal solo deja aviso global si la pantalla ya no está; si está, lo muestra ella', async () => {
    conRedCaidaHastaLaEspera(() => {
      sucursalActiva = SUC_B;
      avisarCambioDeIdentidad();
    });
    await falla(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), {
        pantallaViva: () => true,
      }),
    );
    expect(avisosDeEnvio.leer()).toBeNull();

    sucursalActiva = SUC_A;
    conRedCaidaHastaLaEspera(() => {
      sucursalActiva = SUC_B;
      avisarCambioDeIdentidad();
    });
    await falla(
      enviarSinPerder((extra) => api.post('/cosas', { a: 1 }, { ...extra }), {
        pantallaViva: () => false,
      }),
    );
    expect(avisosDeEnvio.leer()).toEqual({ motivo: 'sucursal', cantidad: 1 });
  });
});

describe('aviso antes de salir con envíos pendientes', () => {
  function intentarSalir(): boolean {
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
  }

  it('sin envíos pendientes deja salir; con alguno esperando la red, pide confirmar', () => {
    const quitar = instalarAvisoAlSalir();
    expect(intentarSalir()).toBe(false);
    conexion.pendienteMas();
    expect(intentarSalir()).toBe(true);
    conexion.pendienteMenos();
    expect(intentarSalir()).toBe(false);
    quitar();
    conexion.pendienteMas();
    expect(intentarSalir()).toBe(false);
  });
});
