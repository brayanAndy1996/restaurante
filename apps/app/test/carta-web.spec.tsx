import type { CartaWebRespuesta, SesionRespuesta } from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ErrorDeFoto } from '../src/lib/imagen';
import * as logo from '../src/modulos/administracion/carta-web/logo';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';

// spec: 005-carta-web-mesa, criterios 74 y 76 en la interfaz (pruebas no protegidas de Ajustes › Carta web).

vi.mock('../src/modulos/administracion/carta-web/logo', async (original) => ({
  ...(await original<typeof import('../src/modulos/administracion/carta-web/logo')>()),
  prepararLogo: vi.fn(),
}));

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const SITIO = 'http://localhost:3001';

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const sucursal = (
  id: string,
  nombre: string,
  extra: Partial<CartaWebRespuesta['sucursales'][number]> = {},
): CartaWebRespuesta['sucursales'][number] => ({
  sucursalId: id,
  nombre,
  slug: null,
  publicada: false,
  url: null,
  ...extra,
});

const SIN_CONFIGURAR: CartaWebRespuesta = {
  configurada: false,
  nombre: null,
  slug: null,
  colorPrincipal: '#1D4A9E',
  logoUrl: null,
  url: null,
  sucursales: [sucursal(ID.sucursalA, 'Miraflores'), sucursal(ID.sucursalB, 'Surco')],
};

const CONFIGURADA: CartaWebRespuesta = {
  configurada: true,
  nombre: 'Sabor Norteño',
  slug: 'sabor-norteno',
  colorPrincipal: '#1D4A9E',
  logoUrl: null,
  url: `${SITIO}/sabor-norteno`,
  sucursales: [
    sucursal(ID.sucursalA, 'Miraflores', {
      slug: 'miraflores',
      publicada: true,
      url: `${SITIO}/sabor-norteno/miraflores`,
    }),
    sucursal(ID.sucursalB, 'Surco'),
  ],
};

/** API de mentira con memoria: guarda la configuración y la devuelve como lo haría la real. */
function api(inicial: CartaWebRespuesta, respuestas: Record<string, Manejador> = {}) {
  let carta = structuredClone(inicial);
  const conUrls = (c: CartaWebRespuesta): CartaWebRespuesta => ({
    ...c,
    url: c.slug ? `${SITIO}/${c.slug}` : null,
    sucursales: c.sucursales.map((s) => ({
      ...s,
      url: c.slug && s.slug ? `${SITIO}/${c.slug}/${s.slug}` : null,
    })),
  });
  const s = servidor({
    'GET /sesion': () => json(200, administrador()),
    'GET /carta-web': () => json(200, carta),
    'PUT /carta-web': ({ cuerpo }) => {
      const c = cuerpo as { nombre: string; slug: string; colorPrincipal: string };
      carta = conUrls({ ...carta, ...c, configurada: true });
      return json(200, carta);
    },
    'PUT /carta-web/sucursales/*': ({ cuerpo, url }) => {
      const id = url.pathname.split('/').pop();
      const c = cuerpo as { slug: string; publicada: boolean };
      carta = conUrls({
        ...carta,
        sucursales: carta.sucursales.map((x) => (x.sucursalId === id ? { ...x, ...c } : x)),
      });
      return json(
        200,
        carta.sucursales.find((x) => x.sucursalId === id),
      );
    },
    ...respuestas,
  });
  return { ...s, carta: () => carta };
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  vi.mocked(logo.prepararLogo).mockReset();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const campo = (nombre: string | RegExp) => screen.getByRole('textbox', { name: nombre });

describe('Ajustes › Carta web: configurar (criterio 74)', () => {
  it('"Carta web" es una sección de Ajustes y avisa que aún no hay nada configurado', async () => {
    api(SIN_CONFIGURAR);
    renderApp('/administracion/usuarios');
    const secciones = await screen.findByRole('group', { name: 'Secciones de Ajustes' });
    await userEvent.click(within(secciones).getByRole('button', { name: 'Carta web' }));
    expect(await screen.findByText('Aún no configuraste tu carta web')).toBeInTheDocument();
    // La pantalla se vuelve a dibujar con la sección nueva: se busca de nuevo.
    expect(
      within(screen.getByRole('group', { name: 'Secciones de Ajustes' })).getByRole('button', {
        name: 'Carta web',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Sin cambios no hay nada que guardar.
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('propone la dirección a partir del nombre, la muestra y la guarda con las sucursales publicadas', async () => {
    const s = api(SIN_CONFIGURAR);
    renderApp('/administracion/carta-web');
    await screen.findByText('Aún no configuraste tu carta web');
    await userEvent.type(campo('Nombre que ven tus clientes'), 'Sabor Norteño');
    // La dirección sigue al nombre mientras nadie la escriba a mano.
    expect(campo('Dirección de tu carta')).toHaveValue('sabor-norteno');
    expect(screen.getByText('…/sabor-norteno')).toBeInTheDocument();
    expect(screen.getByText(/Sugerida a partir de tu nombre/)).toBeInTheDocument();

    // La sucursal toma su propuesta con un toque y se publica.
    await userEvent.click(screen.getAllByRole('button', { name: 'Usar «miraflores»' })[0]!);
    expect(campo('Dirección de Miraflores')).toHaveValue('miraflores');
    await userEvent.click(screen.getByRole('switch', { name: 'Publicada: Miraflores' }));

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Cambios guardados/)).toBeInTheDocument();
    expect(s.de('PUT', '/carta-web')[0]?.cuerpo).toEqual({
      nombre: 'Sabor Norteño',
      slug: 'sabor-norteno',
      colorPrincipal: '#1D4A9E',
    });
    expect(s.de('PUT', `/carta-web/sucursales/${ID.sucursalA}`)[0]?.cuerpo).toEqual({
      slug: 'miraflores',
      publicada: true,
    });
    // La que no se tocó no se envía; la empresa va antes que las sucursales.
    expect(s.de('PUT', `/carta-web/sucursales/${ID.sucursalB}`)).toHaveLength(0);
    const orden = s.llamadas.filter((l) => l.metodo === 'PUT').map((l) => l.ruta);
    expect(orden[0]).toBe('/carta-web');
    // Ya con la dirección guardada, la vista usa el sitio real de la carta.
    expect(await screen.findByText('localhost:3001/sabor-norteno')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('si cambias la dirección avisa que el enlace anterior deja de funcionar, y no antes', async () => {
    api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const direccion = await screen.findByRole('textbox', { name: 'Dirección de tu carta' });
    expect(direccion).toHaveValue('sabor-norteno');
    expect(screen.getByText('localhost:3001/sabor-norteno')).toBeInTheDocument();
    expect(
      screen.queryByText('Si cambias la dirección, el enlace anterior deja de funcionar'),
    ).toBeNull();

    await userEvent.clear(direccion);
    await userEvent.type(direccion, 'norteno');
    expect(
      screen.getByText('Si cambias la dirección, el enlace anterior deja de funcionar'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Los QR de las mesas no cambian/)).toBeInTheDocument();
    expect(screen.getByText('localhost:3001/norteno')).toBeInTheDocument();
    // Ofrece volver a la propuesta del nombre.
    expect(screen.getByText('Propuesta según tu nombre:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Usar esta dirección' }));
    expect(direccion).toHaveValue('sabor-norteno');
    expect(
      screen.queryByText('Si cambias la dirección, el enlace anterior deja de funcionar'),
    ).toBeNull();
  });

  it('valida la dirección y el color antes de enviar, con el problema en palabras', async () => {
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const direccion = await screen.findByRole('textbox', { name: 'Dirección de tu carta' });
    await userEvent.clear(direccion);
    await userEvent.type(direccion, 'api');
    const color = campo('Color de tu marca');
    await userEvent.clear(color);
    await userEvent.type(color, '12AB');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Esa dirección está reservada. Elige otra')).toBeInTheDocument();
    expect(
      screen.getByText('Escribe el color como #RRGGBB, por ejemplo #1D4A9E'),
    ).toBeInTheDocument();
    expect(s.de('PUT', '/carta-web')).toHaveLength(0);
  });

  it('una dirección que ya usa otro restaurante se dice bajo el campo, sin decir cuál', async () => {
    const s = api(CONFIGURADA, {
      'PUT /carta-web': () =>
        json(409, { codigo: 'CONFLICTO', mensaje: 'Esa dirección ya la usa otro restaurante' }),
    });
    renderApp('/administracion/carta-web');
    const direccion = await screen.findByRole('textbox', { name: 'Dirección de tu carta' });
    await userEvent.clear(direccion);
    await userEvent.type(direccion, 'la-esquina');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('Esa dirección ya la usa otro restaurante. Elige otra'),
    ).toBeInTheDocument();
    expect(direccion).toHaveAttribute('aria-invalid', 'true');
    expect(s.de('PUT', '/carta-web')).toHaveLength(1);
    // Lo escrito sigue ahí para corregirlo.
    expect(direccion).toHaveValue('la-esquina');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('dos sucursales no pueden usar la misma dirección', async () => {
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const surco = await screen.findByRole('textbox', { name: 'Dirección de Surco' });
    await userEvent.type(surco, 'miraflores');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('La sucursal Miraflores ya usa esa dirección. Elige otra'),
    ).toBeInTheDocument();
    expect(s.de('PUT', `/carta-web/sucursales/${ID.sucursalB}`)).toHaveLength(0);
  });

  it('si una sucursal repite la dirección de otra en el servidor, el error queda en esa sucursal', async () => {
    api(CONFIGURADA, {
      'PUT /carta-web/sucursales/*': () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/administracion/carta-web');
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Dirección de Surco' }),
      'surco',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('Otra sucursal ya usa esa dirección. Elige otra'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dirección de Surco' })).toHaveValue('surco');
  });

  it('publicar una sucursal sin dirección pide escribirla', async () => {
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    await userEvent.click(await screen.findByRole('switch', { name: 'Publicada: Surco' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText('Escribe la dirección de esta sucursal para publicarla'),
    ).toBeInTheDocument();
    expect(s.de('PUT', `/carta-web/sucursales/${ID.sucursalB}`)).toHaveLength(0);
  });

  it('un error de carga se dice y se puede reintentar', async () => {
    let intento = 0;
    api(CONFIGURADA, {
      'GET /carta-web': () =>
        ++intento === 1 ? json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }) : json(200, CONFIGURADA),
    });
    renderApp('/administracion/carta-web');
    expect(await screen.findByText('No pudimos cargar la carta web')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('textbox', { name: 'Dirección de tu carta' }),
    ).toBeInTheDocument();
  });
});

describe('Ajustes › Carta web: color con muestra y aviso de contraste (criterios 74 y 89)', () => {
  it('un color claro se oscurece con el mismo cálculo de packages/dominio y lo dice', async () => {
    api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const color = await screen.findByRole('textbox', { name: 'Color de tu marca' });
    await userEvent.clear(color);
    await userEvent.type(color, 'ffd400');
    expect(color).toHaveValue('#FFD400');
    expect(
      screen.getByText('Oscurecimos un poco tu color para que se lea bien'),
    ).toBeInTheDocument();
    const { colorDeMarcaAccesible } = await import('@restaurante/dominio');
    const { fondo } = colorDeMarcaAccesible('#FFD400');
    expect(fondo).not.toBe('#FFD400');
    expect(screen.getByText(new RegExp(`En tu carta usaremos ${fondo}`))).toBeInTheDocument();
    // La muestra pinta el color que se usará, no el elegido.
    const muestra = screen.getByRole('figure', { name: 'Muestra de tu carta con este color' });
    expect(within(muestra).getByText('Sabor Norteño').parentElement).toHaveStyle({
      background: fondo,
    });
    expect(within(muestra).getByText('Color ajustado')).toBeInTheDocument();
  });

  it('un color con buen contraste lo confirma con palabras y no lo cambia', async () => {
    api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    await screen.findByRole('textbox', { name: 'Color de tu marca' });
    expect(screen.getByText(/se lee bien\./)).toBeInTheDocument();
    const muestra = screen.getByRole('figure', { name: 'Muestra de tu carta con este color' });
    expect(within(muestra).getByText('Se lee bien')).toBeInTheDocument();
    expect(within(muestra).getByText('Sabor Norteño').parentElement).toHaveStyle({
      background: '#1D4A9E',
    });
    expect(screen.queryByText('Oscurecimos un poco tu color para que se lea bien')).toBeNull();
  });

  it('guarda el color elegido en mayúsculas, aunque se oscurezca solo al mostrarlo', async () => {
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const color = await screen.findByRole('textbox', { name: 'Color de tu marca' });
    await userEvent.clear(color);
    await userEvent.type(color, '#c0392b');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(/Cambios guardados/);
    expect(s.de('PUT', '/carta-web')[0]?.cuerpo).toMatchObject({ colorPrincipal: '#C0392B' });
  });
});

describe('Ajustes › Carta web: sucursales, Publicada y Copiar enlace (criterio 74)', () => {
  it('copia el enlace guardado de una sucursal', async () => {
    api(CONFIGURADA);
    const usuario = userEvent.setup();
    renderApp('/administracion/carta-web');
    await usuario.click(await screen.findByRole('button', { name: 'Copiar enlace de Miraflores' }));
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`${SITIO}/sabor-norteno/miraflores`);
  });

  it('sin dirección guardada no hay enlace que copiar y lo explica; sin publicar lo advierte', async () => {
    api({
      ...CONFIGURADA,
      sucursales: [
        sucursal(ID.sucursalA, 'Miraflores', {
          slug: 'miraflores',
          publicada: false,
          url: `${SITIO}/sabor-norteno/miraflores`,
        }),
        sucursal(ID.sucursalB, 'Surco'),
      ],
    });
    renderApp('/administracion/carta-web');
    expect(await screen.findByRole('button', { name: 'Copiar enlace de Surco' })).toBeDisabled();
    expect(screen.getByText('Guarda la dirección para tener el enlace.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar enlace de Miraflores' })).toBeEnabled();
    expect(screen.getByText(/Todavía no está publicada/)).toBeInTheDocument();
    expect(screen.getAllByText('Sin publicar')).toHaveLength(2);
  });

  it('despublicar y guardar envía la sucursal con Publicada apagada', async () => {
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    const interruptor = await screen.findByRole('switch', { name: 'Publicada: Miraflores' });
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(interruptor);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(/Cambios guardados/);
    expect(s.de('PUT', `/carta-web/sucursales/${ID.sucursalA}`)[0]?.cuerpo).toEqual({
      slug: 'miraflores',
      publicada: false,
    });
    expect(s.de('PUT', '/carta-web')).toHaveLength(0);
  });

  it('sin conexión el cambio queda "Pendiente de envío" y sale solo al volver la red', async () => {
    let falla = true;
    const s = api(CONFIGURADA, {
      'PUT /carta-web': ({ cuerpo }) =>
        falla
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { ...CONFIGURADA, ...(cuerpo as object) }),
    });
    renderApp('/administracion/carta-web');
    const nombre = await screen.findByRole('textbox', { name: 'Nombre que ven tus clientes' });
    await userEvent.type(nombre, ' Grill');
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      falla = false;
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Cambios guardados/)).toBeInTheDocument();
    expect(s.de('PUT', '/carta-web').length).toBeGreaterThanOrEqual(2);
    const claves = new Set(
      s.de('PUT', '/carta-web').map((l) => l.cabeceras.get('Idempotency-Key')),
    );
    expect(claves.size).toBe(1);
  });
});

describe('Ajustes › Carta web: logo (criterio 74)', () => {
  const archivo = new File([new Uint8Array(30_000)], 'logo.png', { type: 'image/png' });

  it('sin configurar todavía no deja subir el logo y dice por qué', async () => {
    api(SIN_CONFIGURAR);
    renderApp('/administracion/carta-web');
    expect(await screen.findByRole('button', { name: 'Subir logo' })).toBeDisabled();
    expect(
      screen.getByText('Guarda primero el nombre y la dirección para poder subir tu logo.'),
    ).toBeInTheDocument();
  });

  it('sube el logo como binario con clave de idempotencia y lo muestra', async () => {
    const preparado = new Blob([new Uint8Array(30_000)], { type: 'image/png' });
    vi.mocked(logo.prepararLogo).mockResolvedValue(preparado);
    const s = api(CONFIGURADA, {
      'PUT /carta-web/logo': () => json(200, { logoUrl: 'https://archivos.prueba/logo.png' }),
    });
    renderApp('/administracion/carta-web');
    await userEvent.upload(await screen.findByLabelText('Elegir el logo de la carta'), archivo);
    const imagen = await screen.findByRole('img', { name: 'Logo de Sabor Norteño' });
    await waitFor(() => expect(imagen).toHaveAttribute('src', 'https://archivos.prueba/logo.png'));
    const llamada = s.de('PUT', '/carta-web/logo')[0];
    expect(llamada?.binario).toBe(preparado);
    expect(llamada?.cabeceras.get('Content-Type')).toBe('image/png');
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cambiar logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar logo' })).toBeInTheDocument();
  });

  it('un logo que ya se sabe que no sirve ni se sube', async () => {
    vi.mocked(logo.prepararLogo).mockRejectedValue(
      new ErrorDeFoto(
        'MUY_PEQUENA',
        'El logo es muy pequeño. Necesita al menos 64 píxeles de lado.',
      ),
    );
    const s = api(CONFIGURADA);
    renderApp('/administracion/carta-web');
    await userEvent.upload(await screen.findByLabelText('Elegir el logo de la carta'), archivo);
    expect(await screen.findByText(/El logo es muy pequeño/)).toBeInTheDocument();
    expect(s.de('PUT', '/carta-web/logo')).toHaveLength(0);
  });

  it('si la red se corta conserva el logo preparado y reintenta con la misma clave', async () => {
    vi.mocked(logo.prepararLogo).mockResolvedValue(archivo);
    let intento = 0;
    const s = api(CONFIGURADA, {
      'PUT /carta-web/logo': () =>
        ++intento <= 7
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { logoUrl: 'https://archivos.prueba/logo.png' }),
    });
    renderApp('/administracion/carta-web');
    await userEvent.upload(await screen.findByLabelText('Elegir el logo de la carta'), archivo);
    expect(await screen.findByText(/Tu logo sigue aquí/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Logo de Sabor Norteño' })).toHaveAttribute(
        'src',
        'https://archivos.prueba/logo.png',
      ),
    );
    const claves = new Set(
      s.de('PUT', '/carta-web/logo').map((l) => l.cabeceras.get('Idempotency-Key')),
    );
    expect(claves.size).toBe(1);
  });

  it('un logo que la API rechaza dice qué hacer y no ofrece reintentar lo mismo', async () => {
    vi.mocked(logo.prepararLogo).mockResolvedValue(archivo);
    api(CONFIGURADA, {
      'PUT /carta-web/logo': () => json(422, { codigo: 'FOTO_INVALIDA', mensaje: 'x' }),
    });
    renderApp('/administracion/carta-web');
    await userEvent.upload(await screen.findByLabelText('Elegir el logo de la carta'), archivo);
    expect(await screen.findByText(/El logo no sirve/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Subir logo' })).toBeEnabled();
  });

  it('quitar el logo pide confirmación y borra', async () => {
    const s = api(
      { ...CONFIGURADA, logoUrl: 'https://archivos.prueba/logo.png' },
      { 'DELETE /carta-web/logo': () => json(204) },
    );
    renderApp('/administracion/carta-web');
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar logo' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Quitar el logo?' });
    // Cancelar no borra nada.
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(s.de('DELETE', '/carta-web/logo')).toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar logo' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Quitar el logo?' })).getByRole('button', {
        name: 'Quitar logo',
      }),
    );
    await waitFor(() => expect(s.de('DELETE', '/carta-web/logo')).toHaveLength(1));
    expect(s.de('DELETE', '/carta-web/logo')[0]?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByText('Sin logo')).toBeInTheDocument();
  });
});
