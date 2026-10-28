import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, espera } from '../src/lib/api';
import { conexion } from '../src/lib/conexion';
import { enviarSinPerder } from '../src/lib/envios';
import { ErrorApi } from '../src/lib/errores';
import { falla, json, servidor } from './ayudas';

beforeEach(() => {
  conexion.reiniciar();
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
