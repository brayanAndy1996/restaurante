import type { MenuDelDiaRespuesta, SesionRespuesta } from '@restaurante/contratos';
import { permisosDeRol, type Rol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const P_MENU = 'a5000000-0000-4000-8000-0000000000a5';
const P_OTRO_MENU = 'a6000000-0000-4000-8000-0000000000a6';
const M_HUANCAINA = 'c1000000-0000-4000-8000-000000000001';
const M_SOPA = 'c2000000-0000-4000-8000-000000000002';
const M_AJI = 'c3000000-0000-4000-8000-000000000003';
const M_LOMO = 'c4000000-0000-4000-8000-000000000004';
const G_ENTRADA = 'b1000000-0000-4000-8000-000000000001';
const G_SEGUNDO = 'b2000000-0000-4000-8000-000000000002';
const RUTA = '/carta/sucursal/menu-del-dia';
const HOY = '2026-10-29';
const AYER = '2026-10-28';
const MANANA = '2026-10-30';

function sesionDeRol(rol: Rol, administrador = false): SesionRespuesta {
  return sesionDe({
    esAdministrador: administrador,
    rol,
    permisos: permisosDeRol(rol),
    sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol }],
  });
}
const cocina = () => sesionDeRol('COCINA_BARRA');
const supervisor = () => sesionDeRol('SUPERVISOR');
const administrador = () => sesionDeRol('ADMINISTRADOR', true);

/** `elegidas` son los ids de modificador marcados; `noDisponibles`, los platos cuyo producto no está disponible. */
function menu(
  dia: string,
  elegidas: string[] = [],
  extra: { id?: string; nombre?: string; noDisponibles?: string[] } = {},
): MenuDelDiaRespuesta {
  const opcion = (id: string, nombre: string, precioExtra = '0.00') => ({
    modificadorId: id,
    nombre,
    precioExtra,
    producto: null,
    elegida: elegidas.includes(id),
    disponible: !(extra.noDisponibles ?? []).includes(id),
  });
  return {
    productoId: extra.id ?? P_MENU,
    nombre: extra.nombre ?? 'Menú criollo',
    precio: '12.00',
    dia,
    grupos: [
      {
        id: G_ENTRADA,
        nombre: 'Entrada',
        minimo: 1,
        maximo: 1,
        opciones: [opcion(M_HUANCAINA, 'Papa a la huancaína'), opcion(M_SOPA, 'Sopa del día')],
      },
      {
        id: G_SEGUNDO,
        nombre: 'Segundo',
        minimo: 1,
        maximo: 1,
        opciones: [opcion(M_AJI, 'Ají de gallina'), opcion(M_LOMO, 'Lomo saltado', '5.00')],
      },
    ],
  };
}

/** Un servidor del menú por día: `GET ?dia=` devuelve lo de ese día (hoy si no se pide ninguno). */
function disponibilidad(
  sesion: SesionRespuesta,
  porDia: Record<string, MenuDelDiaRespuesta[]>,
  extra: Parameters<typeof servidor>[0] = {},
) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    [`GET ${RUTA}`]: ({ url }) => json(200, porDia[url.searchParams.get('dia') ?? HOY] ?? []),
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Disponibilidad en la navegación', () => {
  it('Cocina/Barra, Supervisor y Administrador ven "Disponibilidad"', async () => {
    for (const sesion of [cocina(), supervisor(), administrador()]) {
      disponibilidad(sesion, {});
      const { unmount } = renderApp('/');
      expect(await screen.findByRole('link', { name: 'Disponibilidad' })).toHaveAttribute(
        'href',
        '/disponibilidad',
      );
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('el Administrador ve "Carta" y "Disponibilidad"; Cocina/Barra solo la segunda', async () => {
    disponibilidad(administrador(), {});
    const { unmount } = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Carta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disponibilidad' })).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    disponibilidad(cocina(), {});
    renderApp('/');
    await screen.findByRole('link', { name: 'Disponibilidad' });
    expect(screen.queryByRole('link', { name: 'Carta' })).not.toBeInTheDocument();
  });

  it('el Mozo y el Cajero no ven "Disponibilidad" y la dirección los devuelve al inicio', async () => {
    for (const rol of ['MOZO', 'CAJERO'] as const) {
      const s = disponibilidad(sesionDeRol(rol), {});
      const { unmount } = renderApp('/disponibilidad');
      expect(await screen.findByRole('heading', { name: 'Hola, Marta' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Disponibilidad' })).not.toBeInTheDocument();
      expect(s.de('GET', RUTA)).toHaveLength(0);
      unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe('menú del día: lectura', () => {
  it('muestra hoy con su fecha, la sucursal, los tiempos, el recargo y el estado de cada plato', async () => {
    disponibilidad(cocina(), {
      [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI], { noDisponibles: [M_SOPA] })],
    });
    renderApp('/disponibilidad');
    expect(await screen.findByRole('status', { name: 'Cargando el menú del día' })).toBeInTheDocument();
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    expect(screen.getByText('jueves 29 de octubre')).toBeInTheDocument();
    expect(screen.getAllByText('Miraflores').length).toBeGreaterThan(0);
    expect(within(bloque).getByText('S/ 12.00')).toBeInTheDocument();
    expect(within(bloque).getByText('Armado')).toBeInTheDocument();
    const entrada = within(bloque).getByRole('group', { name: 'Entrada' });
    expect(within(entrada).getByText(/Elige 1, obligatorio · se ofrecen 1 de 2 platos/)).toBeInTheDocument();
    expect(within(entrada).getByRole('checkbox', { name: /Papa a la huancaína/ })).toBeChecked();
    const sopa = within(entrada).getByRole('checkbox', { name: /Sopa del día/ });
    expect(sopa).not.toBeChecked();
    expect(sopa.closest('label')).toHaveTextContent('No disponible hoy');
    const segundo = within(bloque).getByRole('group', { name: 'Segundo' });
    expect(within(segundo).getByRole('checkbox', { name: /Lomo saltado/ }).closest('label')).toHaveTextContent('+ S/ 5.00 de recargo');
    expect(within(segundo).getByRole('checkbox', { name: /Ají de gallina/ }).closest('label')).toHaveTextContent('Sin recargo');
    // Hoy y Mañana; "Agotados" llega en C5, así que aún no hay cambio de sección.
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mañana' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('group', { name: 'Secciones de disponibilidad' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no está armado/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar el menú de hoy' })).toBeDisabled();
  });

  it('si hoy no está armado lo dice arriba y cada tiempo dice cuántos platos faltan', async () => {
    disponibilidad(cocina(), { [HOY]: [menu(HOY, [])] });
    renderApp('/disponibilidad');
    const aviso = (await screen.findByText('El menú de hoy no está armado: no se puede vender')).closest('[role="status"]')!;
    expect(aviso).toHaveTextContent('Marca los platos que se ofrecen hoy');
    const bloque = screen.getByRole('region', { name: 'Menú criollo' });
    expect(within(bloque).getByText('Sin armar')).toBeInTheDocument();
    expect(within(bloque).getAllByText(/Elige al menos 1 plato para que se pueda vender/)).toHaveLength(2);
  });

  it('con dos menús nombra el que falta', async () => {
    disponibilidad(cocina(), {
      [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI]), menu(HOY, [], { id: P_OTRO_MENU, nombre: 'Menú ejecutivo' })],
    });
    renderApp('/disponibilidad');
    const aviso = (await screen.findByText('El menú de hoy no está armado: no se puede vender')).closest('[role="status"]')!;
    expect(aviso).toHaveTextContent('Falta armar: Menú ejecutivo.');
  });

  it('sin menús dice por qué y, a quien edita la carta, ofrece crearlo', async () => {
    disponibilidad(administrador(), { [HOY]: [] });
    renderApp('/disponibilidad');
    expect(await screen.findByText('Esta sucursal no tiene un menú del día')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear un menú del día' })).toHaveAttribute('href', '/carta/productos/nuevo');
  });

  it('sin menús, Cocina/Barra sabe a quién pedírselo y no ve botones que no puede usar', async () => {
    disponibilidad(cocina(), { [HOY]: [] });
    renderApp('/disponibilidad');
    expect(await screen.findByText(/Pide al Administrador o a un Cajero/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Crear un menú del día' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar el menú/ })).not.toBeInTheDocument();
  });

  it('si falla la carga nombra el problema y deja reintentar en la misma pantalla', async () => {
    let falla = true;
    const s = disponibilidad(cocina(), { [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])] }, {
      [`GET ${RUTA}`]: () => (falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, [menu(HOY, [M_HUANCAINA, M_AJI])])),
    });
    renderApp('/disponibilidad');
    expect(await screen.findByText('No pudimos cargar el menú del día')).toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('region', { name: 'Menú criollo' });
    expect(s.de('GET', RUTA).length).toBeGreaterThan(1);
  });

  it('sin conexión al cargar, el título dice "Sin conexión"', async () => {
    servidor({
      'GET /sesion': () => json(200, cocina()),
      [`GET ${RUTA}`]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/disponibilidad');
    await waitFor(() =>
      expect(
        screen.getAllByText('Sin conexión').some((e) => e.closest('[role="alert"]') !== null),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('menú del día: armar', () => {
  it('marcar platos y guardar manda el día y las opciones, y deja el menú armado', async () => {
    const s = disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [])] },
      {
        [`PUT ${RUTA}/${P_MENU}`]: () => json(200, menu(HOY, [M_SOPA, M_LOMO])),
      },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Sopa del día/ }));
    expect(within(bloque).getByText('Sin guardar')).toBeInTheDocument();
    expect(within(bloque).getAllByText(/Elige al menos 1 plato/)).toHaveLength(1);
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Lomo saltado/ }));
    expect(within(bloque).queryByText(/Elige al menos 1 plato/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));
    expect(await screen.findByText('El menú de hoy quedó guardado.')).toBeInTheDocument();
    const llamada = s.de('PUT', `${RUTA}/${P_MENU}`)[0];
    expect(llamada?.cuerpo).toEqual({ dia: HOY, opciones: [M_SOPA, M_LOMO] });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(within(bloque).getByText('Armado')).toBeInTheDocument();
    expect(within(bloque).queryByText('Sin guardar')).not.toBeInTheDocument();
    expect(screen.queryByText(/no está armado/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar el menú de hoy' })).toBeDisabled();
  });

  it('desmarcar todo y guardar manda una lista vacía (el menú queda sin armar)', async () => {
    const s = disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])] },
      { [`PUT ${RUTA}/${P_MENU}`]: () => json(200, menu(HOY, [])) },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Papa a la huancaína/ }));
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Ají de gallina/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));
    await waitFor(() => expect(s.de('PUT', `${RUTA}/${P_MENU}`)).toHaveLength(1));
    expect(s.de('PUT', `${RUTA}/${P_MENU}`)[0]?.cuerpo).toEqual({ dia: HOY, opciones: [] });
    expect(await screen.findByText('El menú de hoy no está armado: no se puede vender')).toBeInTheDocument();
  });

  it('"Mañana" trae el menú del día siguiente y guarda con esa fecha', async () => {
    const s = disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])], [MANANA]: [menu(MANANA, [])] },
      { [`PUT ${RUTA}/${P_MENU}`]: () => json(200, menu(MANANA, [M_SOPA, M_AJI])) },
    );
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(screen.getByRole('button', { name: 'Mañana' }));
    expect(await screen.findByText('viernes 30 de octubre')).toBeInTheDocument();
    const aviso = screen.getByText('El menú de mañana todavía no está armado').closest('[role="status"]')!;
    expect(aviso).toHaveTextContent('Puedes dejarlo listo desde hoy');
    expect(s.de('GET', RUTA).some((l) => l.cuerpo === undefined)).toBe(true);
    const bloque = screen.getByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Sopa del día/ }));
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Ají de gallina/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de mañana' }));
    await screen.findByText('El menú de mañana quedó guardado.');
    expect(s.de('PUT', `${RUTA}/${P_MENU}`)[0]?.cuerpo).toEqual({ dia: MANANA, opciones: [M_SOPA, M_AJI] });
  });

  it('lo marcado en un día no se pierde al cambiar de pestaña y se avisa', async () => {
    disponibilidad(cocina(), {
      [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])],
      [MANANA]: [menu(MANANA, [])],
    });
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Sopa del día/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Mañana' }));
    await screen.findByText('viernes 30 de octubre');
    expect(screen.getByText('Tienes cambios sin guardar en hoy')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    const hoy = await screen.findByRole('region', { name: 'Menú criollo' });
    expect(within(hoy).getByRole('checkbox', { name: /Sopa del día/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar el menú de hoy' })).toBeEnabled();
  });

  it('un error de la API se dice por menú y lo marcado sigue en pantalla', async () => {
    disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])] },
      {
        [`PUT ${RUTA}/${P_MENU}`]: () =>
          json(422, { codigo: 'REFERENCIA_INVALIDA', mensaje: 'x', campos: [{ campo: 'opciones.0', mensaje: 'x' }] }),
      },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Sopa del día/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));
    const aviso = (await screen.findByText('No pudimos guardar todo')).closest('[role="alert"]')!;
    expect(aviso).toHaveTextContent('Menú criollo: Alguna de las opciones ya no es candidata');
    expect(aviso).toHaveTextContent('Lo que marcaste sigue en pantalla');
    expect(within(bloque).getByRole('checkbox', { name: /Sopa del día/ })).toBeChecked();
  });

  it('con dos menús guarda solo el que cambió', async () => {
    const s = disponibilidad(
      cocina(),
      {
        [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI]), menu(HOY, [M_SOPA, M_LOMO], { id: P_OTRO_MENU, nombre: 'Menú ejecutivo' })],
      },
      { [`PUT ${RUTA}/${P_OTRO_MENU}`]: () => json(200, menu(HOY, [M_SOPA, M_AJI], { id: P_OTRO_MENU, nombre: 'Menú ejecutivo' })) },
    );
    renderApp('/disponibilidad');
    const ejecutivo = await screen.findByRole('region', { name: 'Menú ejecutivo' });
    await userEvent.click(within(ejecutivo).getByRole('checkbox', { name: /Lomo saltado/ }));
    await userEvent.click(within(ejecutivo).getByRole('checkbox', { name: /Ají de gallina/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));
    await screen.findByText('1 menú guardado para hoy.');
    expect(s.de('PUT', `${RUTA}/${P_MENU}`)).toHaveLength(0);
    expect(s.de('PUT', `${RUTA}/${P_OTRO_MENU}`)[0]?.cuerpo).toEqual({ dia: HOY, opciones: [M_SOPA, M_AJI] });
  });
});

describe('menú del día: repetir las de ayer', () => {
  it('pide el día anterior, marca las mismas opciones y deja guardar (no guarda solo)', async () => {
    const s = disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [])], [AYER]: [menu(AYER, [M_SOPA, M_LOMO])] },
      { [`PUT ${RUTA}/${P_MENU}`]: () => json(200, menu(HOY, [M_SOPA, M_LOMO])) },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    expect(screen.getByRole('button', { name: 'Guardar el menú de hoy' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Repetir las de ayer' }));
    const copiado = (await screen.findByText('Copiado')).closest('[role="status"]')!;
    expect(copiado).toHaveTextContent('Copiamos las opciones de ayer. Revísalas y toca «Guardar».');
    expect(within(bloque).getByRole('checkbox', { name: /Sopa del día/ })).toBeChecked();
    expect(within(bloque).getByRole('checkbox', { name: /Lomo saltado/ })).toBeChecked();
    expect(s.de('GET', RUTA).some((l) => l.cabeceras !== undefined)).toBe(true);
    expect(s.de('PUT', `${RUTA}/${P_MENU}`)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));
    await screen.findByText('El menú de hoy quedó guardado.');
    expect(s.de('PUT', `${RUTA}/${P_MENU}`)[0]?.cuerpo).toEqual({ dia: HOY, opciones: [M_SOPA, M_LOMO] });
  });

  it('si ayer no había nada armado, lo dice y no marca nada', async () => {
    disponibilidad(cocina(), { [HOY]: [menu(HOY, [])], [AYER]: [menu(AYER, [])] });
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(screen.getByRole('button', { name: 'Repetir las de ayer' }));
    expect(await screen.findByText(/Ayer no había opciones armadas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar el menú de hoy' })).toBeDisabled();
  });

  it('en "Mañana" el botón copia las de hoy', async () => {
    disponibilidad(cocina(), {
      [HOY]: [menu(HOY, [M_HUANCAINA, M_AJI])],
      [MANANA]: [menu(MANANA, [])],
    });
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(screen.getByRole('button', { name: 'Mañana' }));
    await screen.findByText('viernes 30 de octubre');
    await userEvent.click(screen.getByRole('button', { name: 'Repetir las de hoy' }));
    expect(await screen.findByText(/Copiamos las opciones de hoy/)).toBeInTheDocument();
    const bloque = screen.getByRole('region', { name: 'Menú criollo' });
    expect(within(bloque).getByRole('checkbox', { name: /Papa a la huancaína/ })).toBeChecked();
  });

  it('si no se puede traer el día anterior, lo dice y no toca lo marcado', async () => {
    disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [])] },
      {
        [`GET ${RUTA}`]: ({ url }) =>
          url.searchParams.get('dia') === AYER
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
            : json(200, [menu(HOY, [])]),
      },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Sopa del día/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Repetir las de ayer' }));
    expect(await screen.findByText('No pudimos copiar')).toBeInTheDocument();
    expect(within(bloque).getByRole('checkbox', { name: /Sopa del día/ })).toBeChecked();
  });
});

describe('Pendiente de envío en el menú del día (criterio 78)', () => {
  it('sin conexión al guardar, el menú queda "Pendiente de envío", lo marcado sigue ahí y sale solo con la misma clave', async () => {
    let sinRed = true;
    let llamadasDeEspera = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++llamadasDeEspera === 7) await compuerta;
    });
    const s = disponibilidad(
      cocina(),
      { [HOY]: [menu(HOY, [])] },
      {
        [`PUT ${RUTA}/${P_MENU}`]: () => {
          if (sinRed) throw new TypeError('Failed to fetch');
          return json(200, menu(HOY, [M_HUANCAINA, M_AJI]));
        },
      },
    );
    renderApp('/disponibilidad');
    const bloque = await screen.findByRole('region', { name: 'Menú criollo' });
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Papa a la huancaína/ }));
    await userEvent.click(within(bloque).getByRole('checkbox', { name: /Ají de gallina/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el menú de hoy' }));

    expect(await within(bloque).findByText('Pendiente de envío')).toBeInTheDocument();
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();
    expect(within(bloque).getByRole('checkbox', { name: /Papa a la huancaína/ })).toBeChecked();

    sinRed = false;
    liberar();
    expect(await screen.findByText('El menú de hoy quedó guardado.')).toBeInTheDocument();
    expect(within(bloque).queryByText('Pendiente de envío')).not.toBeInTheDocument();
    const claves = new Set(s.de('PUT', `${RUTA}/${P_MENU}`).map((l) => l.cabeceras.get('Idempotency-Key')));
    expect(claves.size).toBe(1);
    expect(s.de('PUT', `${RUTA}/${P_MENU}`).length).toBeGreaterThan(2);
  });
});
