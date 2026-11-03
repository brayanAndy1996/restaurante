import type { CartaPublica } from '@restaurante/contratos';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartaWeb } from '../componentes/CartaWeb';
import { Mesa } from '../componentes/mesa/Mesa';
import type { ProductoMesa } from '../lib/pedido';

// El modo mesa armado de punta a punta en el navegador de pruebas (criterios 82 y 84 a 87): la hoja de producto, "Tu
// pedido", el envío con el mismo `id`, el rechazo por línea, el banner de estado y el pedido que sobrevive a una
// recarga. La API es un `fetch` falso que responde como la API pública.

const CODIGO = 'Mesa4AbCdEfGhIjKlMnOpQ';
const API = 'http://api.publica';
/** "S/ 36.00": el espacio del precio es duro (\u00a0), así que se compara como espacio en blanco. */
const soles = (monto: string) => new RegExp(`S/\\s${monto.replace('.', '\\.')}`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CAUSA = id(10);
const LOMO = id(11);
const PUNTO_JUGOSO = id(30);
const PUNTO_MEDIO = id(31);
const EXTRA_HUEVO = id(32);
const EXTRA_ARROZ = id(33);
const EXTRA_AJI = id(34);

const carta: CartaPublica = {
  empresa: { nombre: 'Sabor Norteño', logoUrl: null, colorPrincipal: '#CB4D29' },
  sucursal: {
    nombre: 'Miraflores',
    slug: 'miraflores',
    direccion: 'Av. Larco 345',
    horario: [],
    abiertaAhora: null,
  },
  familias: [
    {
      id: id(1),
      nombre: 'Platos',
      productos: [
        {
          id: CAUSA,
          tipo: 'SIMPLE',
          nombre: 'Causa limeña',
          descripcion: 'Papa amarilla con pollo.',
          fotoUrl: null,
          precio: '22.00',
          grupos: [],
          componentes: [],
        },
        {
          id: LOMO,
          tipo: 'SIMPLE',
          nombre: 'Lomo saltado',
          descripcion: null,
          fotoUrl: null,
          precio: '36.00',
          grupos: [
            {
              id: id(20),
              nombre: 'Punto de la carne',
              seleccion: 'UNICA',
              minimo: 1,
              maximo: 1,
              obligatorio: true,
              modificadores: [
                { id: PUNTO_JUGOSO, nombre: 'Jugoso', precioExtra: '0.00' },
                { id: PUNTO_MEDIO, nombre: 'Término medio', precioExtra: '0.00' },
              ],
            },
            {
              id: id(21),
              nombre: 'Extras',
              seleccion: 'MULTIPLE',
              minimo: 0,
              maximo: 2,
              obligatorio: false,
              modificadores: [
                { id: EXTRA_HUEVO, nombre: 'Huevo frito', precioExtra: '3.00' },
                { id: EXTRA_ARROZ, nombre: 'Porción de arroz', precioExtra: '4.00' },
                { id: EXTRA_AJI, nombre: 'Ají molido', precioExtra: '2.00' },
              ],
            },
          ],
          componentes: [],
        },
      ],
    },
  ],
};

const productos: ProductoMesa[] = carta.familias.flatMap((f) =>
  f.productos.map(({ id, nombre, descripcion, fotoUrl, precio, grupos }) => ({
    id,
    nombre,
    descripcion,
    fotoUrl,
    precio,
    grupos,
  })),
);

// --- La API falsa ---------------------------------------------------------------------------------

interface Estado {
  /** Respuestas del `POST`, de la primera a la última; la última se repite. */
  envios: Array<Response | Error>;
  /** Estado que dice `GET …/llamados/:id`. */
  estado: string;
  /** Qué dice la disponibilidad: `null` = todo disponible. */
  agotados: string[];
}

let api: Estado;
const cuerpos: Array<{ id: string; tipo: string; lineas?: unknown[]; nota?: string }> = [];
const fetchFalso = vi.fn<typeof fetch>();

const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });

const creado = (idLlamado: string, tipo = 'PEDIDO') =>
  json(
    {
      id: idLlamado,
      tipo,
      estado: 'PENDIENTE',
      creadoEn: '2026-11-03T20:00:00.000Z',
      venceEn: '2026-11-03T20:15:00.000Z',
      lineas: [],
      total: null,
    },
    201,
  );

const errorApi = (estado: number, codigo: string, extra: Record<string, unknown> = {}) =>
  json({ codigo, mensaje: 'x', ...extra }, estado);

beforeEach(() => {
  api = { envios: [], estado: 'PENDIENTE', agotados: [] };
  cuerpos.length = 0;
  fetchFalso.mockReset();
  fetchFalso.mockImplementation(async (entrada, init) => {
    const url = String(entrada);
    const metodo = init?.method ?? 'GET';
    if (url.endsWith('/disponibilidad')) {
      return json({
        vendibles: productos
          .filter((p) => !api.agotados.includes(p.id))
          .map((p) => ({ id: p.id, modificadoresNoDisponibles: [] })),
      });
    }
    if (metodo === 'POST') {
      const cuerpo = JSON.parse(String(init?.body));
      cuerpos.push(cuerpo);
      const respuesta = api.envios[Math.min(cuerpos.length - 1, api.envios.length - 1)];
      if (respuesta === undefined) return creado(cuerpo.id, cuerpo.tipo);
      if (respuesta instanceof Error) throw respuesta;
      return respuesta.clone();
    }
    if (url.includes('/llamados/')) {
      return json({
        id: url.split('/').pop(),
        tipo: 'PEDIDO',
        estado: api.estado,
        venceEn: '2026-11-03T20:15:00.000Z',
      });
    }
    // GET de la mesa
    return json({
      mesa: { nombre: 'Mesa 4' },
      carta: { empresaSlug: 'sabor-norteno', sucursalSlug: 'miraflores' },
      aceptaLlamados: true,
      motivoNoAcepta: null,
      llamadoPendiente: null,
    });
  });
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Props = Partial<React.ComponentProps<typeof Mesa>>;

function montar(props: Props = {}) {
  return render(
    <CartaWeb
      carta={carta}
      empresaSlug="sabor-norteno"
      sucursalSlug="miraflores"
      mesa="4"
      barra={
        <Mesa
          codigo={CODIGO}
          mesa="Mesa 4"
          productos={productos}
          aceptaLlamados
          llamadoPendiente={null}
          {...props}
        />
      }
    />,
  );
}

/** Los `POST` que llegaron a la API. */
const envios = () => fetchFalso.mock.calls.filter(([, init]) => init?.method === 'POST');

async function abrirProducto(usuario: ReturnType<typeof userEvent.setup>, nombre: RegExp) {
  await usuario.click(screen.getByRole('button', { name: nombre }));
  return screen.findByRole('dialog');
}

/** Agrega al pedido una causa limeña (sin opciones). */
async function agregarCausa(usuario: ReturnType<typeof userEvent.setup>) {
  const hoja = await abrirProducto(usuario, /^Causa limeña, 22 soles/);
  await usuario.click(within(hoja).getByRole('button', { name: /Agregar al pedido/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** Agrega al pedido un lomo saltado con su punto y un extra. */
async function agregarLomo(usuario: ReturnType<typeof userEvent.setup>) {
  const hoja = await abrirProducto(usuario, /^Lomo saltado, 36 soles/);
  await usuario.click(within(hoja).getByLabelText('Término medio'));
  await usuario.click(within(hoja).getByLabelText(/Huevo frito/));
  await usuario.click(within(hoja).getByRole('button', { name: /Agregar al pedido/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

async function verPedido(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: /Ver tu pedido/ }));
  return screen.findByRole('dialog', { name: 'Tu pedido' });
}

describe('hoja de producto (criterio 84)', () => {
  it('muestra cada grupo con su regla en palabras y no deja agregar hasta elegir lo obligatorio', async () => {
    const usuario = userEvent.setup();
    montar();
    const hoja = await abrirProducto(usuario, /^Lomo saltado/);
    expect(within(hoja).getByText('Punto de la carne')).toBeInTheDocument();
    expect(within(hoja).getByText('Obligatorio')).toBeInTheDocument();
    expect(within(hoja).getByText('Elige 1')).toBeInTheDocument();
    expect(within(hoja).getByText('Opcional')).toBeInTheDocument();
    expect(within(hoja).getByText('Elige hasta 2')).toBeInTheDocument();
    const agregar = within(hoja).getByRole('button', { name: /Agregar al pedido/ });
    expect(agregar).toHaveAttribute('aria-disabled', 'true');
    expect(within(hoja).getByText('Falta elegir: Punto de la carne')).toBeInTheDocument();

    await usuario.click(within(hoja).getByLabelText('Jugoso'));
    expect(agregar).toHaveAttribute('aria-disabled', 'false');
  });

  it('el precio de la línea sale de calcularLinea: base, extras y cantidad', async () => {
    const usuario = userEvent.setup();
    montar();
    const hoja = await abrirProducto(usuario, /^Lomo saltado/);
    await usuario.click(within(hoja).getByLabelText('Jugoso'));
    expect(within(hoja).getByRole('button', { name: /Agregar al pedido/ })).toHaveTextContent(
      soles('36.00'),
    );
    await usuario.click(within(hoja).getByLabelText(/Huevo frito/));
    await usuario.click(within(hoja).getByRole('button', { name: 'Agregar uno' }));
    expect(within(hoja).getByRole('button', { name: /Agregar al pedido/ })).toHaveTextContent(
      soles('78.00'),
    );
    expect(within(hoja).getByRole('button', { name: /Agregar al pedido/ })).toHaveTextContent(
      '78 soles',
    );
  });

  it('con el máximo de un grupo, las demás opciones se apagan', async () => {
    const usuario = userEvent.setup();
    montar();
    const hoja = await abrirProducto(usuario, /^Lomo saltado/);
    await usuario.click(within(hoja).getByLabelText(/Huevo frito/));
    await usuario.click(within(hoja).getByLabelText(/Porción de arroz/));
    expect(within(hoja).getByLabelText(/Ají molido/)).toBeDisabled();
  });

  it('la cantidad va de 1 a 20 y las indicaciones cuentan hasta 140', async () => {
    const usuario = userEvent.setup();
    montar();
    const hoja = await abrirProducto(usuario, /^Causa limeña/);
    const menos = within(hoja).getByRole('button', { name: 'Quitar uno' });
    expect(menos).toHaveAttribute('aria-disabled', 'true');
    for (let i = 0; i < 25; i += 1) {
      await usuario.click(within(hoja).getByRole('button', { name: 'Agregar uno' }));
    }
    expect(hoja.querySelector('output')).toHaveTextContent('20');
    await usuario.type(within(hoja).getByLabelText(/Indicaciones/), 'sin cebolla');
    expect(within(hoja).getByText('11 de 140')).toBeInTheDocument();
    expect(within(hoja).getByLabelText(/Indicaciones/)).toHaveAttribute('maxlength', '140');
  });

  it('se cierra con la X y no agrega nada', async () => {
    const usuario = userEvent.setup();
    montar();
    const hoja = await abrirProducto(usuario, /^Causa limeña/);
    await usuario.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver tu pedido/ })).toBeNull();
  });
});

describe('Tu pedido (criterio 84)', () => {
  it('lista las líneas con su total de totalOrden y deja quitar y editar', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    await agregarLomo(usuario);
    // La carta marca lo que ya está en el pedido y la barra dice cuánto es.
    expect(screen.getAllByText('1 en tu pedido')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Ver tu pedido/ })).toHaveTextContent('2 platos');
    expect(screen.getByRole('button', { name: /Ver tu pedido/ })).toHaveTextContent(soles('61.00'));

    const hoja = await verPedido(usuario);
    expect(within(hoja).getByText('1 × Causa limeña')).toBeInTheDocument();
    expect(within(hoja).getByText('1 × Lomo saltado')).toBeInTheDocument();
    expect(within(hoja).getByText('Término medio · Huevo frito')).toBeInTheDocument();
    expect(hoja.querySelector('.hoja__total')).toHaveTextContent(soles('61.00'));

    await usuario.click(within(hoja).getByRole('button', { name: /Editar Lomo saltado/ }));
    const edicion = await screen.findByRole('dialog', { name: 'Lomo saltado' });
    await usuario.click(within(edicion).getByRole('button', { name: 'Agregar uno' }));
    await usuario.click(within(edicion).getByRole('button', { name: /Guardar cambios/ }));
    const otraVez = await screen.findByRole('dialog', { name: 'Tu pedido' });
    expect(within(otraVez).getByText('2 × Lomo saltado')).toBeInTheDocument();
    expect(otraVez.querySelector('.hoja__total')).toHaveTextContent(soles('100.00'));

    await usuario.click(within(otraVez).getByRole('button', { name: /Quitar Causa limeña/ }));
    expect(within(otraVez).queryByText('1 × Causa limeña')).toBeNull();
    expect(otraVez.querySelector('.hoja__total')).toHaveTextContent(soles('78.00'));
  });

  it('el mismo plato con las mismas opciones suma su cantidad en una sola línea', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    expect(within(hoja).getByText('2 × Causa limeña')).toBeInTheDocument();
    expect(within(hoja).getAllByRole('listitem')).toHaveLength(1);
  });

  it('con el pedido vacío, "Enviar al mozo" no se puede y dice por qué', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: /Quitar Causa limeña/ }));
    expect(within(hoja).getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(hoja).getByText('Agrega al menos un plato.')).toBeInTheDocument();
  });
});

describe('el pedido sobrevive a la recarga (criterio 84)', () => {
  it('queda en sessionStorage por código y vuelve al montar de nuevo', async () => {
    const usuario = userEvent.setup();
    const primera = montar();
    await agregarLomo(usuario);
    const guardado = JSON.parse(sessionStorage.getItem(`pedido:${CODIGO}`) ?? 'null');
    expect(guardado.lineas).toHaveLength(1);
    expect(guardado.lineas[0]).toMatchObject({
      productoId: LOMO,
      modificadorIds: [PUNTO_MEDIO, EXTRA_HUEVO],
      cantidad: 1,
    });
    primera.unmount();

    // La recarga: otra página, el mismo navegador.
    montar();
    expect(await screen.findByRole('button', { name: /Ver tu pedido/ })).toHaveTextContent(
      '1 plato',
    );
    expect(await screen.findByText('1 en tu pedido')).toBeInTheDocument();
    const hoja = await verPedido(usuario);
    expect(within(hoja).getByText('Término medio · Huevo frito')).toBeInTheDocument();
    expect(hoja.querySelector('.hoja__total')).toHaveTextContent(soles('39.00'));
  });

  it('el pedido de otra mesa no se mezcla', async () => {
    const usuario = userEvent.setup();
    const primera = montar();
    await agregarCausa(usuario);
    primera.unmount();
    montar({ codigo: 'OtraMesaAbCdEfGhIjKlMn' });
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Ver tu pedido/ })).toBeNull();
  });
});

describe('enviar al mozo y reintento con el mismo id (criterios 86 y 87)', () => {
  it('manda el pedido, lo vacía con el 201 y muestra "Avisamos al mozo"', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarLomo(usuario);
    const hoja = await verPedido(usuario);
    await usuario.type(within(hoja).getByLabelText(/Nota para el mozo/), 'Somos 4');
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));

    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(screen.getByText('Puedes seguir viendo la carta.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toMatchObject({
      tipo: 'PEDIDO',
      nota: 'Somos 4',
      lineas: [{ productoId: LOMO, modificadorIds: [PUNTO_MEDIO, EXTRA_HUEVO], cantidad: 1 }],
    });
    expect(cuerpos[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    // El pedido se vacía y los tres envíos quedan apagados.
    expect(screen.queryByRole('button', { name: /Ver tu pedido/ })).toBeNull();
    expect(sessionStorage.getItem(`pedido:${CODIGO}`)).toBeNull();
    expect(screen.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: /Pedir la cuenta/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sin red dice "Sin conexión" y reintenta con el mismo id hasta que llega', async () => {
    api.envios = [new TypeError('Failed to fetch'), new TypeError('Failed to fetch')];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));

    expect(await within(hoja).findByText('Sin conexión')).toBeInTheDocument();
    expect(within(hoja).getByText(/Lo enviaremos cuando vuelva/)).toBeInTheDocument();
    expect(within(hoja).getByRole('button', { name: 'Enviando…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // 1 s y 2 s de espera entre intentos (con la red de vuelta en el tercero).
    api.envios = [
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
      creado('ignorado'),
    ];
    expect(await screen.findByText('Avisamos al mozo', {}, { timeout: 6000 })).toBeInTheDocument();
    expect(cuerpos.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(cuerpos.map((c) => c.id));
    expect(ids.size).toBe(1);
  }, 15000);

  it('una recarga con el envío a medias lo reanuda con el mismo id', async () => {
    api.envios = [new TypeError('Failed to fetch')];
    const usuario = userEvent.setup();
    const primera = montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    await within(hoja).findByText('Sin conexión');
    const idOriginal = cuerpos[0]!.id;
    primera.unmount();

    api.envios = [];
    montar();
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(cuerpos.at(-1)!.id).toBe(idOriginal);
  });

  it('"Cancelar el envío" deja de reintentar y conserva el pedido', async () => {
    api.envios = [new TypeError('Failed to fetch')];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    await within(hoja).findByText('Sin conexión');
    await usuario.click(within(hoja).getByRole('button', { name: 'Cancelar el envío' }));
    expect(within(hoja).getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(within(hoja).getByText('1 × Causa limeña')).toBeInTheDocument();
  });

  it('un error del servidor se reintenta con el mismo id y, si sigue, pide pulsar otra vez', async () => {
    api.envios = [errorApi(503, 'ERROR_INTERNO')];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    expect(
      await within(hoja).findByText(/Inténtalo otra vez en un momento/, {}, { timeout: 12000 }),
    ).toBeInTheDocument();
    expect(within(hoja).getByRole('alert')).toHaveTextContent('No pudimos enviar tu pedido');
    expect(new Set(cuerpos.map((c) => c.id)).size).toBe(1);
    const idDelIntento = cuerpos[0]!.id;
    const intentos = cuerpos.length;

    // Al pulsar otra vez con el mismo pedido se conserva el id.
    api.envios = [creado('x')];
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(cuerpos[intentos]!.id).toBe(idDelIntento);
  }, 20000);
});

describe('rechazos en palabras (criterios 85 y 86)', () => {
  it('un 422 marca la línea rechazada con "Se agotó", apaga el envío y renueva el id al reenviar', async () => {
    api.envios = [
      errorApi(422, 'PRODUCTO_NO_VENDIBLE', {
        campos: [{ campo: 'lineas.1', mensaje: 'AGOTADO' }],
      }),
    ];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    await agregarLomo(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No pudimos enviar tu pedido');
    expect(within(hoja).getByRole('alert')).toHaveTextContent('Quita lo que está marcado');
    const lomo = within(hoja).getByText('1 × Lomo saltado').closest('li')!;
    expect(within(lomo).getByText('Se agotó')).toBeInTheDocument();
    const causa = within(hoja).getByText('1 × Causa limeña').closest('li')!;
    expect(within(causa).queryByText('Se agotó')).toBeNull();
    expect(within(hoja).getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(hoja).getByText('Quita lo que se agotó para poder enviar.')).toBeInTheDocument();
    // El total ya no cuenta lo que no se puede enviar.
    expect(hoja.querySelector('.hoja__total')).toHaveTextContent(soles('22.00'));

    // Es una respuesta final: al quitar la línea y volver a enviar, el id es otro.
    await usuario.click(within(hoja).getByRole('button', { name: /Quitar Lomo saltado/ }));
    api.envios = [creado('x')];
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[1]!.id).not.toBe(cuerpos[0]!.id);
    expect(cuerpos[1]!.lineas).toHaveLength(1);
  });

  it('una opción que se agotó dice cuál ("Huevo frito ya no está disponible")', async () => {
    api.envios = [
      errorApi(422, 'SELECCION_INVALIDA', {
        campos: [{ campo: 'lineas.0', mensaje: `MODIFICADOR_NO_DISPONIBLE: ${EXTRA_HUEVO}` }],
      }),
    ];
    const usuario = userEvent.setup();
    montar();
    await agregarLomo(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    expect(await within(hoja).findByText('Huevo frito ya no está disponible')).toBeInTheDocument();
  });

  it('una línea cuyo plato se agotó en la carta se marca sin enviar nada y no deja enviar', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    api.agotados = [CAUSA];
    // La isla de disponibilidad avisa (cada 15 s con la página visible, al volver a la pestaña).
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('carta:disponibilidad', {
          detail: { vendibles: [{ id: LOMO, modificadoresNoDisponibles: [] }] },
        }),
      );
    });
    const hoja = await verPedido(usuario);
    expect(within(hoja).getByText('Se agotó')).toBeInTheDocument();
    expect(within(hoja).getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(envios()).toHaveLength(0);
    await usuario.click(within(hoja).getByRole('button', { name: /Quitar Causa limeña/ }));
  });

  it.each([
    [
      'FUERA_DE_HORARIO',
      409,
      {},
      'El local está cerrado ahora',
      'Por ahora no recibimos pedidos desde la mesa. Habla con el mozo.',
    ],
    [
      'LLAMADO_PENDIENTE',
      409,
      {},
      'Ya avisamos al mozo',
      'En cuanto te atienda podrás enviar otro pedido o volver a llamarlo.',
    ],
    [
      'DEMASIADOS_LLAMADOS',
      429,
      { reintentarEnSegundos: 120 },
      'Enviaste varios avisos seguidos',
      'Espera 2 minutos para volver a enviar, o habla con el mozo.',
    ],
    [
      'DEMASIADOS_LLAMADOS',
      429,
      { reintentarEnSegundos: 45 },
      'Enviaste varios avisos seguidos',
      'Espera 45 segundos para volver a enviar, o habla con el mozo.',
    ],
  ])('%s (%i) se dice en palabras, sin código', async (codigo, estado, extra, titulo, texto) => {
    api.envios = [errorApi(estado, codigo, extra)];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    const aviso = await within(hoja).findByRole('alert');
    expect(aviso).toHaveTextContent(titulo);
    expect(aviso).toHaveTextContent(texto);
    expect(aviso).not.toHaveTextContent(codigo);
    // Fue una respuesta final: nada queda reintentando y el pedido sigue ahí.
    expect(within(hoja).getByText('1 × Causa limeña')).toBeInTheDocument();
  });

  it('un código de mesa que ya no existe lo dice sin mostrar el 404', async () => {
    api.envios = [errorApi(404, 'NO_ENCONTRADO')];
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    expect(await within(hoja).findByRole('alert')).toHaveTextContent(
      'Esta mesa ya no está disponible',
    );
  });
});

describe('estado del llamado (criterio 86)', () => {
  /** Solo se simula `setInterval`: así `waitFor` y la descarga de los bloques siguen con el reloj real. */
  const relojDeConsulta = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const pasar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  async function enviarPedido(usuario: ReturnType<typeof userEvent.setup>) {
    await agregarCausa(usuario);
    const hoja = await verPedido(usuario);
    await usuario.click(within(hoja).getByRole('button', { name: 'Enviar al mozo' }));
    await screen.findByText('Avisamos al mozo');
  }

  it('consulta cada 10 segundos y dice cada estado con palabras', async () => {
    relojDeConsulta();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    montar();
    await enviarPedido(usuario);
    const consultas = () => fetchFalso.mock.calls.filter(([u]) => String(u).includes('/llamados/'));
    const iniciales = consultas().length;

    await pasar(9_000);
    expect(consultas()).toHaveLength(iniciales);
    api.estado = 'ATENDIDO';
    await pasar(1_000);
    expect(await screen.findByText('El mozo viene a tu mesa')).toBeInTheDocument();
    expect(String(consultas().at(-1)![0])).toBe(
      `${API}/publico/mesas/${CODIGO}/llamados/${cuerpos[0]!.id}`,
    );
    // Atendido: se puede enviar otro.
    expect(screen.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    // Un pedido atendido todavía puede pasar a la cuenta.
    api.estado = 'PASADO_A_CUENTA';
    await pasar(10_000);
    expect(await screen.findByText('El mozo tomó tu pedido')).toBeInTheDocument();
    // Ya es final: deja de preguntar.
    const total = consultas().length;
    await pasar(30_000);
    expect(consultas()).toHaveLength(total);

    await usuario.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText('El mozo tomó tu pedido')).toBeNull();
  });

  it.each([
    ['DESCARTADO', 'No pudimos atender este pedido', 'Habla con el mozo.'],
    ['VENCIDO', 'Nadie respondió a tiempo', 'Llama al mozo o vuelve a enviarlo.'],
  ])(
    '%s se dice con palabras, con "Entendido", y vuelven los envíos',
    async (estado, titulo, texto) => {
      relojDeConsulta();
      const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      montar();
      await enviarPedido(usuario);
      api.estado = estado;
      await pasar(10_000);
      expect(await screen.findByText(titulo)).toBeInTheDocument();
      expect(screen.getByText(texto)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Pedir la cuenta/ })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
      await usuario.click(screen.getByRole('button', { name: 'Entendido' }));
      expect(screen.queryByText(titulo)).toBeNull();
    },
  );

  it('el estado sobrevive a una recarga mientras la pestaña siga abierta', async () => {
    relojDeConsulta();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const primera = montar();
    await enviarPedido(usuario);
    primera.unmount();
    montar();
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    api.estado = 'ATENDIDO';
    await pasar(10_000);
    expect(await screen.findByText('El mozo viene a tu mesa')).toBeInTheDocument();
  });

  it('un llamado pendiente de la mesa (sin id en este navegador) apaga los envíos y se libera solo', async () => {
    relojDeConsulta();
    let pendiente = true;
    const original = fetchFalso.getMockImplementation()!;
    fetchFalso.mockImplementation(async (entrada, init) => {
      const url = String(entrada);
      if (url === `${API}/publico/mesas/${CODIGO}`) {
        return json({
          mesa: { nombre: 'Mesa 4' },
          carta: { empresaSlug: 'sabor-norteno', sucursalSlug: 'miraflores' },
          aceptaLlamados: true,
          motivoNoAcepta: null,
          llamadoPendiente: pendiente
            ? { tipo: 'LLAMAR_MOZO', venceEn: '2026-11-03T20:15:00.000Z' }
            : null,
        });
      }
      return original(entrada, init);
    });
    montar({ llamadoPendiente: { tipo: 'LLAMAR_MOZO', venceEn: '2026-11-03T20:15:00.000Z' } });
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    pendiente = false;
    await pasar(10_000);
    await waitFor(() => expect(screen.queryByText('Avisamos al mozo')).toBeNull());
    expect(screen.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('con un llamado pendiente, "Enviar al mozo" está apagado y dice por qué', async () => {
    relojDeConsulta();
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    montar();
    await enviarPedido(usuario);
    await agregarLomo(usuario);
    const hoja = await verPedido(usuario);
    expect(within(hoja).getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      within(hoja).getByText('Ya avisamos al mozo. Podrás enviar otro cuando te atiendan.'),
    ).toBeInTheDocument();
  });
});

describe('llamar al mozo y pedir la cuenta (criterio 85)', () => {
  it('piden confirmación y mandan el llamado sin líneas', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.click(screen.getByRole('button', { name: /Llamar al mozo/ }));
    const hoja = await screen.findByRole('dialog', { name: '¿Llamamos al mozo a tu mesa?' });
    expect(within(hoja).getByText(/El mozo recibirá un aviso en la Mesa 4/)).toBeInTheDocument();
    // "Ahora no" no manda nada.
    await usuario.click(within(hoja).getByRole('button', { name: 'Ahora no' }));
    expect(envios()).toHaveLength(0);

    await usuario.click(screen.getByRole('button', { name: /Llamar al mozo/ }));
    await usuario.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, llamar al mozo' }),
    );
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toMatchObject({ tipo: 'LLAMAR_MOZO' });
    expect(cuerpos[0]).not.toHaveProperty('lineas');
  });

  it('pedir la cuenta manda PEDIR_CUENTA y no toca el pedido que se está armando', async () => {
    const usuario = userEvent.setup();
    montar();
    await agregarCausa(usuario);
    await usuario.click(screen.getByRole('button', { name: /Pedir la cuenta/ }));
    const hoja = await screen.findByRole('dialog', { name: '¿Pedimos la cuenta?' });
    await usuario.click(within(hoja).getByRole('button', { name: 'Sí, pedir la cuenta' }));
    expect(await screen.findByText('Avisamos al mozo')).toBeInTheDocument();
    expect(cuerpos[0]).toMatchObject({ tipo: 'PEDIR_CUENTA' });
    expect(screen.getByRole('button', { name: /Ver tu pedido/ })).toHaveTextContent('1 plato');
  });

  it('fuera de horario, los envíos están apagados y la barra lo dice', async () => {
    const original = fetchFalso.getMockImplementation()!;
    fetchFalso.mockImplementation(async (entrada, init) =>
      String(entrada) === `${API}/publico/mesas/${CODIGO}`
        ? json({
            mesa: { nombre: 'Mesa 4' },
            carta: { empresaSlug: 'sabor-norteno', sucursalSlug: 'miraflores' },
            aceptaLlamados: false,
            motivoNoAcepta: 'FUERA_DE_HORARIO',
            llamadoPendiente: null,
          })
        : original(entrada, init),
    );
    montar({ aceptaLlamados: false });
    expect(await screen.findByText('El local está cerrado ahora')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: /Pedir la cuenta/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
