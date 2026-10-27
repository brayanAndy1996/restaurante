import { sesionRespuestaSchema } from '@restaurante/contratos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarSesionDePlataforma, guardarTokenDeSesion } from '../src/lib/almacen';
import { api, configurarApi, espera, llamar, nuevaClaveDeIdempotencia } from '../src/lib/api';
import { conexion } from '../src/lib/conexion';
import { ErrorApi } from '../src/lib/errores';
import { falla, json, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

beforeEach(() => {
  conexion.reiniciar();
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  configurarApi({ alSesionInvalida: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cabeceras', () => {
  it('agrega Authorization con la sesión de empresa guardada', async () => {
    guardarTokenDeSesion(TOKEN);
    const s = servidor({ 'GET /algo': () => json(200, { ok: true }) });
    await api.get('/algo');
    expect(s.llamadas[0]?.cabeceras.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('con ámbito de plataforma usa el token del superadministrador y no el de empresa', async () => {
    guardarTokenDeSesion(TOKEN);
    guardarSesionDePlataforma({ token: 'sa.x.y', superadministrador: { id: 'a', nombre: 'Ana' } });
    const s = servidor({ 'GET /plataforma/empresas': () => json(200, []) });
    await api.get('/plataforma/empresas', { ambito: 'plataforma' });
    expect(s.llamadas[0]?.cabeceras.get('Authorization')).toBe('Bearer sa.x.y');
  });

  it('sin sesión no manda Authorization, y con sinToken tampoco aunque haya una guardada', async () => {
    const s = servidor({
      'POST /sesiones/contrasena': () =>
        json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    guardarTokenDeSesion(TOKEN);
    await api.post('/sesiones/contrasena', {}, { sinToken: true }).catch(() => undefined);
    expect(s.llamadas[0]?.cabeceras.has('Authorization')).toBe(false);
  });

  it('manda X-Equipo y X-Actividad solo cuando se piden', async () => {
    const s = servidor({ 'GET /equipo': () => json(200, {}) });
    await api.get('/equipo', { equipo: 'eq.a.b.c', segundoPlano: true });
    await api.get('/equipo');
    expect(s.llamadas[0]?.cabeceras.get('X-Equipo')).toBe('eq.a.b.c');
    expect(s.llamadas[0]?.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    expect(s.llamadas[1]?.cabeceras.has('X-Equipo')).toBe(false);
    expect(s.llamadas[1]?.cabeceras.has('X-Actividad')).toBe(false);
  });
});

describe('idempotencia y reintentos', () => {
  it('cada escritura lógica lleva su propia clave de idempotencia', async () => {
    const s = servidor({ 'POST /emisores': () => json(201, {}) });
    await api.post('/emisores', { a: 1 }, { idempotente: true });
    await api.post('/emisores', { a: 1 }, { idempotente: true });
    const [a, b] = s.llamadas.map((l) => l.cabeceras.get('Idempotency-Key'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
  });

  it('reutiliza la MISMA clave en los reintentos tras un corte de red', async () => {
    let intentos = 0;
    const s = servidor({
      'POST /emisores': () => {
        intentos++;
        if (intentos < 3) throw new TypeError('Failed to fetch');
        return json(201, { id: 'ok' });
      },
    });
    const respuesta = await api.post<{ id: string }>('/emisores', { a: 1 }, { idempotente: true });
    expect(respuesta).toEqual({ id: 'ok' });
    expect(s.llamadas).toHaveLength(3);
    const claves = new Set(s.llamadas.map((l) => l.cabeceras.get('Idempotency-Key')));
    expect(claves.size).toBe(1);
    expect([...claves][0]).toBeTruthy();
  });

  it('no manda clave si la ruta no la usa', async () => {
    const s = servidor({ 'POST /usuarios': () => json(201, {}) });
    await api.post('/usuarios', {});
    expect(s.llamadas[0]?.cabeceras.has('Idempotency-Key')).toBe(false);
  });

  it('ofrece generar una clave aunque crypto.randomUUID no exista (página sin https)', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(nuevaClaveDeIdempotencia()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });

  it('cuenta los cambios pendientes mientras reintenta y los suelta al terminar', async () => {
    const vistos: number[] = [];
    let intentos = 0;
    servidor({
      'PUT /sesion/sucursal': () => {
        intentos++;
        vistos.push(conexion.leer().pendientes);
        if (intentos < 2) throw new TypeError('Failed to fetch');
        return json(200, sesionDe());
      },
    });
    await api.put('/sesion/sucursal', {}, { esquema: sesionRespuestaSchema });
    expect(vistos).toEqual([0, 1]);
    expect(conexion.leer().pendientes).toBe(0);
    expect(conexion.leer().sinConexion).toBe(false);
  });

  it('marca sin conexión y falla con SIN_CONEXION cuando se agotan los reintentos', async () => {
    servidor({
      'GET /algo': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const error = await falla(api.get('/algo'));
    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).codigo).toBe('SIN_CONEXION');
    expect(conexion.leer().sinConexion).toBe(true);
  });

  it('respeta el máximo de reintentos que pide quien llama', async () => {
    const s = servidor({
      'POST /sesiones/contrasena': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await api.post('/sesiones/contrasena', {}, { reintentos: 2 }).catch(() => undefined);
    expect(s.llamadas).toHaveLength(3);
  });

  it('reintenta un 503, pero no un 500 en una escritura', async () => {
    let n = 0;
    const s = servidor({
      'POST /a': () =>
        ++n < 2 ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(201, {}),
      'POST /b': () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
      'GET /c': () =>
        ++n < 4 ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, {}),
    });
    await api.post('/a', {});
    expect(s.de('POST', '/a')).toHaveLength(2);
    await expect(api.post('/b', {})).rejects.toBeInstanceOf(ErrorApi);
    expect(s.de('POST', '/b')).toHaveLength(1);
    await api.get('/c');
    expect(s.de('GET', '/c')).toHaveLength(2);
  });

  it('nunca reintenta un error de negocio (4xx)', async () => {
    const s = servidor({
      'POST /usuarios': () => json(409, { codigo: 'CONFLICTO', mensaje: 'Ya existe' }),
      'POST /sesiones/contrasena': () =>
        json(429, { codigo: 'BLOQUEO_TEMPORAL', mensaje: 'Bloqueado', reintentarEnSegundos: 300 }),
    });
    const conflicto = await falla(api.post('/usuarios', {}));
    expect(conflicto.codigo).toBe('CONFLICTO');
    const bloqueo = await falla(api.post('/sesiones/contrasena', {}));
    expect(bloqueo.codigo).toBe('BLOQUEO_TEMPORAL');
    expect(bloqueo.reintentarEnSegundos).toBe(300);
    expect(s.llamadas).toHaveLength(2);
  });

  it('marca como reintentada la escritura que falló después de un corte', async () => {
    let n = 0;
    servidor({
      'POST /usuarios': () => {
        if (++n === 1) throw new TypeError('Failed to fetch');
        return json(409, { codigo: 'CONFLICTO', mensaje: 'Ya existe' });
      },
    });
    const error = await falla(api.post('/usuarios', {}));
    expect(error.reintentada).toBe(true);
  });
});

describe('respuestas', () => {
  it('devuelve undefined en un 204', async () => {
    servidor({ 'DELETE /sesion': () => json(204) });
    await expect(api.delete('/sesion')).resolves.toBeUndefined();
  });

  it('valida la respuesta con el esquema de contratos', async () => {
    servidor({ 'GET /sesion': () => json(200, { tipo: 'CONTRASENA' }) });
    const error = await falla(api.get('/sesion', { esquema: sesionRespuestaSchema }));
    expect(error.codigo).toBe('RESPUESTA_INVALIDA');
  });

  it('traduce el cuerpo de error con campos', async () => {
    servidor({
      'POST /usuarios': () =>
        json(400, {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Datos inválidos',
          campos: [{ campo: 'horario', mensaje: 'mal' }],
        }),
    });
    const error = await falla(api.post('/usuarios', {}));
    expect(error.campos).toEqual([{ campo: 'horario', mensaje: 'mal' }]);
    expect(error.estado).toBe(400);
  });

  it('un 401 NO_AUTENTICADO con credencial guardada avisa que la sesión ya no vale', async () => {
    guardarTokenDeSesion(TOKEN);
    const alSesionInvalida = vi.fn();
    configurarApi({ alSesionInvalida });
    servidor({ 'GET /sesion': () => json(401, { codigo: 'SESION_EXPIRADA', mensaje: 'x' }) });
    await api.get('/sesion').catch(() => undefined);
    expect(alSesionInvalida).toHaveBeenCalledWith('empresa', 'SESION_EXPIRADA');
  });

  it('un 401 en el ingreso (sin credencial) no cierra nada', async () => {
    const alSesionInvalida = vi.fn();
    configurarApi({ alSesionInvalida });
    servidor({
      'POST /sesiones/contrasena': () =>
        json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    await api.post('/sesiones/contrasena', {}, { sinToken: true }).catch(() => undefined);
    expect(alSesionInvalida).not.toHaveBeenCalled();
  });

  it('usa la hora del servidor (cabecera Date) para medir el desfase del reloj', async () => {
    const { ahoraDelServidor } = await import('../src/lib/api');
    const adelantado = new Date(Date.now() + 10 * 60_000).toUTCString();
    servidor({ 'GET /algo': () => json(200, {}, { Date: adelantado }) });
    await llamar('/algo');
    expect(ahoraDelServidor() - Date.now()).toBeGreaterThan(9 * 60_000);
  });
});
