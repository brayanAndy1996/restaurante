import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, pedirApi, rutaCarta, rutaMesa, urlApiInterna, urlApiPublica } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function respuesta(cuerpo: unknown, estado = 200): Response {
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('lib/api', () => {
  it('usa API_URL_INTERNA en el servidor y NEXT_PUBLIC_API_URL en el navegador, sin barra final', () => {
    vi.stubEnv('API_URL_INTERNA', 'http://api:3000/');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.ejemplo.pe');
    expect(urlApiInterna()).toBe('http://api:3000');
    expect(urlApiPublica()).toBe('https://api.ejemplo.pe');
  });

  it('avisa cuando falta una variable', () => {
    vi.stubEnv('API_URL_INTERNA', '');
    expect(() => urlApiInterna()).toThrow('API_URL_INTERNA');
  });

  it('codifica las direcciones y el código en la ruta', () => {
    expect(rutaCarta('sabor-norteno', 'miraflores')).toBe(
      '/publico/cartas/sabor-norteno/miraflores',
    );
    expect(rutaMesa('a/b')).toBe('/publico/mesas/a%2Fb');
  });

  it('manda JSON y devuelve la respuesta si es 2xx', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta({ ok: true }, 201));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await pedirApi('http://api', '/x', { method: 'POST', json: { a: 1 } });
    expect(r.status).toBe(201);
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api/x');
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('un 304 no es un error (la disponibilidad no cambió)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
    await expect(pedirApi('http://api', '/x')).resolves.toHaveProperty('status', 304);
  });

  it('convierte un 4xx en ErrorApi con el código y la espera', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuesta(
            { codigo: 'DEMASIADOS_LLAMADOS', mensaje: 'Espera', reintentarEnSegundos: 90 },
            429,
          ),
        ),
    );
    const error = await pedirApi('http://api', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({
      estado: 429,
      codigo: 'DEMASIADOS_LLAMADOS',
      reintentarEnSegundos: 90,
      esDeRed: false,
    });
  });

  it('un 502 sin cuerpo JSON queda con su estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));
    const error = await pedirApi('http://api', '/x').catch((e: unknown) => e);
    expect(error).toMatchObject({ estado: 502, codigo: null });
  });

  it('una falla de red es un ErrorApi de red, para reintentar con el mismo id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await pedirApi('http://api', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).esDeRed).toBe(true);
  });
});
