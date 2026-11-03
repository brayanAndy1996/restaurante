import { afterEach, describe, expect, it, vi } from 'vitest';
import { obtenerCarta, obtenerEmpresa, obtenerMesa } from '@/lib/api-servidor';

afterEach(() => vi.unstubAllGlobals());

const CODIGO = 'abcdefghijklmnopqrstuv';

const cartaValida = {
  empresa: { nombre: 'Sabor Norteño', logoUrl: null, colorPrincipal: '#1D4A9E' },
  sucursal: {
    nombre: 'Miraflores',
    slug: 'miraflores',
    direccion: 'Av. Larco 123',
    horario: [],
    abiertaAhora: null,
  },
  familias: [],
};

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

describe('lib/api-servidor', () => {
  it('lee la carta de la API interna y la guarda 30 segundos con su etiqueta', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(json(cartaValida));
    vi.stubGlobal('fetch', fetchFalso);
    const carta = await obtenerCarta('sabor-norteno', 'Miraflores');
    expect(carta?.sucursal.nombre).toBe('Miraflores');
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit & { next?: unknown }];
    expect(url).toBe('http://api.interna/publico/cartas/sabor-norteno/Miraflores');
    expect(init.next).toEqual({ revalidate: 30, tags: ['carta:sabor-norteno:miraflores'] });
  });

  it('un 404 de la API es null (la página dice «Esta carta no está disponible»)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ codigo: 'NO_ENCONTRADO', mensaje: 'No existe' }, 404)),
    );
    await expect(obtenerEmpresa('no-existe')).resolves.toBeNull();
  });

  it('una dirección con forma imposible no llega a la API', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    await expect(obtenerCarta('../etc', 'x')).resolves.toBeNull();
    await expect(obtenerMesa('corto')).resolves.toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('la mesa nunca se guarda', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      json({
        mesa: { nombre: 'Mesa 4' },
        carta: { empresaSlug: 'sabor-norteno', sucursalSlug: 'miraflores' },
        aceptaLlamados: true,
        motivoNoAcepta: null,
        llamadoPendiente: null,
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);
    const mesa = await obtenerMesa(CODIGO);
    expect(mesa?.mesa.nombre).toBe('Mesa 4');
    expect((fetchFalso.mock.calls[0] as [string, RequestInit])[1].cache).toBe('no-store');
  });

  it('rechaza una respuesta con datos de más (esquemas estrictos)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...cartaValida, empresaId: 'x' })));
    await expect(obtenerCarta('sabor-norteno', 'miraflores')).rejects.toThrow();
  });

  it('un error de la API que no es 404 se lanza', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ codigo: 'ERROR_INTERNO' }, 500)));
    await expect(obtenerCarta('sabor-norteno', 'miraflores')).rejects.toMatchObject({
      estado: 500,
    });
  });
});
