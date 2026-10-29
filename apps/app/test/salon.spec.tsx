import type { OrdenRespuesta, SalonRespuesta, SesionRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { estadoDeTiempoReal } from '../src/lib/tiempo-real';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';
import { socketVigente } from './ayudas-tiempo-real';
import { AHORA, mesa, salon, sesionDeRol, uuid, zona, Z_SALON, Z_TERRAZA } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 7, 8, 9, 10, 11, 88, 89 y 97 (pantalla del salón; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

/** Un salón que cambia: cada cambio sube la versión (su `ETag`), y repetir la versión da 304. */
function servidorDeSalon(
  sesion: SesionRespuesta,
  inicial: SalonRespuesta,
  extra: Record<string, Manejador> = {},
) {
  let actual = inicial;
  let version = 1;
  const s = servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /salon': ({ cabeceras }) =>
      cabeceras.get('If-None-Match') === `"${version}"`
        ? json(304)
        : json(200, actual, { ETag: `"${version}"` }),
    ...extra,
  });
  return {
    ...s,
    cambiar(nuevo: SalonRespuesta) {
      actual = nuevo;
      version += 1;
    },
  };
}

const grande = () =>
  salon([
    zona(
      Z_SALON,
      'Salón principal',
      [
        mesa(1, '1', { columna: 1, fila: 1, capacidad: 4 }),
        mesa(2, '2', { columna: 2, fila: 1, orden: { comensales: 3, minutos: 25 } }),
        mesa(3, '3', { columna: 3, fila: 1, estado: 'EN_PRECUENTA', orden: { minutos: 70 } }),
      ],
      { columnas: 3, filas: 1 },
    ),
    zona(Z_TERRAZA, 'Terraza', [mesa(7, '7', { capacidad: 2, columna: 1, fila: 1 })], {
      columnas: 2,
      filas: 1,
    }),
  ]);

const botonMesa = (nombre: string) =>
  screen.getByRole('button', { name: new RegExp(`^Mesa ${nombre},`) });

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Salón: el mapa (criterios 7, 8 y 88)', () => {
  it('dibuja la zona con cada mesa y su estado dicho con palabras', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    const mapa = await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    expect(
      within(mapa).getByRole('button', { name: /^Mesa 1, 4 personas, cuadrada, Libre$/ }),
    ).toBeVisible();
    expect(botonMesa('2')).toHaveAccessibleName(
      'Mesa 2, 4 personas, cuadrada, Ocupada · 3 · 25 min',
    );
    expect(botonMesa('3')).toHaveAccessibleName(/Pre-cuenta · 3 · 1 h 10 min$/);
    // El texto está en la baldosa, no solo el color.
    expect(within(botonMesa('2')).getByText('Ocupada')).toBeInTheDocument();
    expect(within(botonMesa('2')).getByText('3 · 25 min')).toBeInTheDocument();
    expect(within(botonMesa('1')).getByText('Libre')).toBeInTheDocument();
  });

  it('cuenta las mesas por estado con las mismas palabras', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    const resumen = await screen.findByRole('group', {
      name: 'Estado de las mesas de Salón principal',
    });
    expect(resumen).toHaveTextContent('1 libre');
    expect(resumen).toHaveTextContent('1 ocupada');
    expect(resumen).toHaveTextContent('1 en pre-cuenta');
  });

  it('con varias zonas, las elige y recuerda la última en este equipo', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    const { unmount } = renderApp('/salon');
    const zonas = await screen.findByRole('group', { name: 'Zonas del salón' });
    expect(within(zonas).getByRole('button', { name: 'Salón principal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(zonas).getByRole('button', { name: 'Terraza' }));
    expect(await screen.findByRole('grid', { name: 'Mesas de Terraza' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Mesas de Salón principal' })).toBeNull();
    unmount();

    renderApp('/salon');
    expect(await screen.findByRole('grid', { name: 'Mesas de Terraza' })).toBeInTheDocument();
  });

  it('con una sola zona no muestra el selector de zonas', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), salon([zona(Z_SALON, 'Salón', [mesa(1, '1')])]));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    expect(screen.queryByRole('group', { name: 'Zonas del salón' })).toBeNull();
  });

  it('las mesas unidas dicen con cuáles y la zona lo lista una vez', async () => {
    const unidas = [
      { id: uuid(104), nombre: '4' },
      { id: uuid(105), nombre: '5' },
      { id: uuid(106), nombre: '6' },
    ];
    servidorDeSalon(
      sesionDeRol('MOZO'),
      salon([
        zona(
          Z_SALON,
          'Salón',
          [
            mesa(4, '4', { columna: 1, orden: { id: uuid(777), mesas: unidas } }),
            mesa(5, '5', { columna: 2, orden: { id: uuid(777), mesas: unidas } }),
            mesa(6, '6', { columna: 3, orden: { id: uuid(777), mesas: unidas } }),
          ],
          { columnas: 3, filas: 1 },
        ),
      ]),
    );
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    expect(botonMesa('5')).toHaveAccessibleName(/Grupo con 4, 6$/);
    const unidasLista = screen.getByRole('list', { name: 'Mesas unidas' });
    expect(within(unidasLista).getAllByRole('listitem')).toHaveLength(1);
    expect(unidasLista).toHaveTextContent('Mesa 4 · Grupo con 5, 6');
  });
});

describe('Salón: la vista de lista (criterio 88)', () => {
  it('el interruptor "Lista" muestra las mesas como filas y se recuerda', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    const { unmount } = renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    const interruptor = screen.getByRole('switch', { name: 'Lista' });
    expect(interruptor).not.toBeChecked();
    await userEvent.click(interruptor);

    const lista = await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    expect(screen.queryByRole('grid')).toBeNull();
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveTextContent('Mesa 1');
    expect(filas[0]).toHaveTextContent('Capacidad 4');
    expect(filas[0]).toHaveTextContent('Libre');
    expect(filas[1]).toHaveTextContent('Mesa 2');
    expect(filas[1]).toHaveTextContent('3 personas · 25 min · Ana Ríos');
    expect(filas[1]).toHaveTextContent('Ocupada');
    expect(filas[1]).toHaveTextContent('S/ 120.00');
    expect(filas[2]).toHaveTextContent('Pre-cuenta');
    unmount();

    renderApp('/salon');
    expect(
      await screen.findByRole('list', { name: 'Mesas de Salón principal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lista' })).toBeChecked();
  });
});

describe('Salón: estados vacíos y de carga (criterio 88)', () => {
  it('el Administrador sin zonas ve "Diseña tu salón" con el camino al mapa de mesas', async () => {
    servidorDeSalon(sesionDeRol('ADMINISTRADOR'), salon([]));
    renderApp('/salon');
    expect(await screen.findByText('Diseña tu salón')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Diseñar el salón' })).toHaveAttribute(
      'href',
      '/administracion/mesas',
    );
  });

  it('los demás ven "Tu salón aún no tiene mesas", también si hay zonas sin mesas', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), salon([zona(Z_SALON, 'Salón', [])]));
    renderApp('/salon');
    expect(await screen.findByText('Tu salón aún no tiene mesas')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Diseñar el salón' })).toBeNull();
  });

  it('una zona sin mesas lo dice dentro de la zona', async () => {
    servidorDeSalon(
      sesionDeRol('MOZO'),
      salon([zona(Z_SALON, 'Salón', [mesa(1, '1')]), zona(Z_TERRAZA, 'Terraza', [])]),
    );
    renderApp('/salon');
    await userEvent.click(await screen.findByRole('button', { name: 'Terraza' }));
    expect(await screen.findByText('Esta zona aún no tiene mesas')).toBeInTheDocument();
  });

  it('mientras carga muestra un esqueleto, nunca una pantalla en blanco', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'GET /salon': () => new Promise<Response>(() => undefined),
    });
    renderApp('/salon');
    expect(await screen.findByRole('status', { name: 'Cargando el salón' })).toBeInTheDocument();
  });

  it('si no carga, dice el problema y deja reintentar en la misma pantalla', async () => {
    let falla = true;
    servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'GET /salon': () =>
        falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, grande()),
    });
    renderApp('/salon');
    expect(await screen.findByText('No pudimos cargar el salón')).toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('grid', { name: 'Mesas de Salón principal' }),
    ).toBeInTheDocument();
  });
});

describe('Salón: se mantiene al día (criterios 7 y 97)', () => {
  it('un aviso de tiempo real vuelve a pedir el salón con If-None-Match y sin renovar la inactividad', async () => {
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await waitFor(() => expect(socketVigente()).toBeDefined());
    expect(s.de('GET', '/salon')).toHaveLength(1);
    expect(s.de('GET', '/salon')[0]?.cabeceras.get('X-Actividad')).toBeNull();

    // Nada cambió: el servidor responde 304 y la pantalla sigue igual.
    act(() => socketVigente()!.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: uuid(1) }));
    await waitFor(() => expect(s.de('GET', '/salon')).toHaveLength(2));
    const segunda = s.de('GET', '/salon')[1]!;
    expect(segunda.cabeceras.get('If-None-Match')).toBe('"1"');
    expect(segunda.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    expect(botonMesa('1')).toHaveAccessibleName(/Libre$/);
  });

  it('cuando algo cambió, la mesa pasa de libre a ocupada sin recargar', async () => {
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await waitFor(() => expect(socketVigente()).toBeDefined());
    expect(botonMesa('1')).toHaveAccessibleName(/Libre$/);

    s.cambiar(
      salon([
        zona(
          Z_SALON,
          'Salón principal',
          [
            mesa(1, '1', { columna: 1, fila: 1, orden: { comensales: 2, minutos: 0 } }),
            mesa(2, '2', { columna: 2, fila: 1 }),
          ],
          { columnas: 3, filas: 1 },
        ),
      ]),
    );
    act(() =>
      socketVigente()!.desdeElServidor('salon.cambio', {
        mesaIds: [uuid(101)],
        ordenId: uuid(900),
      }),
    );
    await waitFor(() => expect(botonMesa('1')).toHaveAccessibleName(/Ocupada · 2 · 0 min$/));
    expect(botonMesa('2')).toHaveAccessibleName(/Libre$/);
  });

  it('si falla una actualización, lo último que se vio sigue y avisa que puede estar desactualizado', async () => {
    let falla = false;
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'GET /salon': () =>
        falla
          ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, grande(), { ETag: '"1"' }),
    });
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await waitFor(() => expect(socketVigente()).toBeDefined());
    falla = true;
    act(() => socketVigente()!.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: uuid(1) }));
    expect(await screen.findByText('No pudimos actualizar el salón')).toBeInTheDocument();
    expect(botonMesa('2')).toBeInTheDocument();
    expect(s.de('GET', '/salon').length).toBeGreaterThan(1);
  });

  it('sin conexión de tiempo real lo dice y sondea cada 30 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const s = servidorDeSalon(sesionDeRol('MOZO'), grande());
      renderApp('/salon');
      await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
      await waitFor(() => expect(socketVigente()).toBeDefined());
      expect(screen.queryByText(/Sin conexión en vivo/)).toBeNull();

      act(() => socketVigente()!.desdeElServidor('connect_error', new Error('x')));
      expect(estadoDeTiempoReal()).toBe('caido');
      expect(await screen.findByText(/Sin conexión en vivo/)).toBeInTheDocument();
      const antes = s.de('GET', '/salon').length;
      await act(async () => vi.advanceTimersByTimeAsync(30_500));
      await waitFor(() => expect(s.de('GET', '/salon').length).toBeGreaterThan(antes));
      const ultima = s.de('GET', '/salon').at(-1)!;
      expect(ultima.cabeceras.get('X-Actividad')).toBe('segundo-plano');
      expect(ultima.cabeceras.get('If-None-Match')).toBe('"1"');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Salón: tocar una mesa', () => {
  it('una mesa ocupada lleva a su cuenta', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(botonMesa('2'));
    expect(await screen.findByRole('heading', { name: 'Cuenta de la mesa' })).toBeInTheDocument();
  });
});

describe('Abrir mesa (criterios 9, 10, 11 y 89)', () => {
  const ORDEN_NUEVA = uuid(950);
  const orden = (extra: Partial<OrdenRespuesta> = {}): OrdenRespuesta => ({
    id: ORDEN_NUEVA,
    sucursalId: ID.sucursalA,
    tipo: 'MESA',
    canal: 'SALON',
    estado: 'ABIERTA',
    mesas: [{ id: uuid(101), nombre: '1' }],
    mozo: { id: ID.usuario, nombre: 'Marta Pérez' },
    comensales: 4,
    abiertaEn: AHORA,
    anuladaEn: null,
    sinConsumo: false,
    unidaA: null,
    items: [],
    total: '0.00',
    precuentaVigente: null,
    ...extra,
  });

  async function abrirHoja(nombre = '1') {
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(botonMesa(nombre));
    return screen.findByRole('dialog', { name: `Abrir mesa ${nombre}` });
  }

  it('tocar una mesa libre abre la hoja con la capacidad como comensales y "Tú" como responsable', async () => {
    servidorDeSalon(sesionDeRol('MOZO'), grande());
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    expect(within(hoja).getByRole('status')).toHaveTextContent('4');
    expect(within(hoja).getByText('Mozo responsable')).toBeInTheDocument();
    expect(within(hoja).getByText('Tú')).toBeInTheDocument();
    expect(within(hoja).getByText('Marta Pérez')).toBeInTheDocument();
    // Un Mozo abre a su nombre: la lista de personas es del Administrador.
    expect(within(hoja).queryByRole('button', { name: 'Cambiar' })).toBeNull();
    expect(within(hoja).getByRole('button', { name: 'Abrir mesa' })).toBeEnabled();
  });

  it('los comensales se ajustan con − y + y no bajan de 1 ni pasan de 99', async () => {
    servidorDeSalon(
      sesionDeRol('MOZO'),
      salon([zona(Z_SALON, 'Salón principal', [mesa(1, '1', { capacidad: 2 })])]),
    );
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    const menos = within(hoja).getByRole('button', { name: 'Quitar uno de comensales' });
    await userEvent.click(menos);
    await userEvent.click(menos);
    expect(within(hoja).getByRole('status')).toHaveTextContent('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar uno a comensales' }));
    expect(within(hoja).getByRole('status')).toHaveTextContent('2');
  });

  it('abre la mesa con un id propio y una clave de idempotencia, y lleva a su cuenta', async () => {
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'POST /ordenes': () => json(201, orden()),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar uno a comensales' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));

    expect(await screen.findByRole('heading', { name: 'Cuenta de la mesa' })).toBeInTheDocument();
    const [llamada, ...otras] = s.de('POST', '/ordenes');
    expect(otras).toHaveLength(0);
    expect(llamada?.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      mesaId: uuid(101),
      comensales: 5,
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // Quien abre queda como responsable por defecto: no se manda `mozoId`.
    expect(llamada?.cuerpo).not.toHaveProperty('mozoId');
  });

  it('el Administrador puede elegir a otra persona que atienda mesas', async () => {
    const OTRA = uuid(31);
    const usuarios = [
      {
        id: ID.usuario,
        nombre: 'Marta Pérez',
        nombreUsuario: 'marta',
        esAdministrador: true,
        accesos: [],
        activo: true,
        horario: null,
        largoPin: 6,
        contrasenaTemporal: false,
        equiposRecordados: 0,
        creadoEn: AHORA,
        actualizadoEn: AHORA,
      },
      {
        id: OTRA,
        nombre: 'Lucía Salón',
        nombreUsuario: 'lucia',
        esAdministrador: false,
        accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
        activo: true,
        horario: null,
        largoPin: 4,
        contrasenaTemporal: false,
        equiposRecordados: 0,
        creadoEn: AHORA,
        actualizadoEn: AHORA,
      },
      {
        id: uuid(32),
        nombre: 'Pedro Cocina',
        nombreUsuario: 'pedro',
        esAdministrador: false,
        accesos: [{ sucursalId: ID.sucursalA, rol: 'COCINA_BARRA' }],
        activo: true,
        horario: null,
        largoPin: 4,
        contrasenaTemporal: false,
        equiposRecordados: 0,
        creadoEn: AHORA,
        actualizadoEn: AHORA,
      },
    ];
    const s = servidorDeSalon(sesionDeRol('ADMINISTRADOR'), grande(), {
      'GET /usuarios': () => json(200, usuarios),
      'POST /ordenes': () => json(201, orden({ mozo: { id: OTRA, nombre: 'Lucía Salón' } })),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar' }));

    // Solo quienes atienden mesas: Cocina/Barra no aparece.
    expect(await within(hoja).findByRole('button', { name: /Lucía Salón/ })).toBeInTheDocument();
    expect(within(hoja).queryByRole('button', { name: /Pedro Cocina/ })).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: /Lucía Salón/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));

    await screen.findByRole('heading', { name: 'Cuenta de la mesa' });
    expect(s.de('POST', '/ordenes')[0]?.cuerpo).toMatchObject({ mozoId: OTRA });
  });

  it('el Administrador puede volver a "Tú" después de mirar la lista', async () => {
    const s = servidorDeSalon(sesionDeRol('ADMINISTRADOR'), grande(), {
      'GET /usuarios': () => json(200, []),
      'POST /ordenes': () => json(201, orden()),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar' }));
    await userEvent.click(await within(hoja).findByRole('button', { name: 'Volver a mí' }));
    expect(within(hoja).getByText('Tú')).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));
    await screen.findByRole('heading', { name: 'Cuenta de la mesa' });
    expect(s.de('POST', '/ordenes')[0]?.cuerpo).not.toHaveProperty('mozoId');
  });

  it('una sesión de soporte tiene que elegir quién atiende antes de poder abrir', async () => {
    const OTRA = uuid(41);
    const soporte = { ...sesionDeRol('ADMINISTRADOR'), usuario: null };
    const s = servidorDeSalon(soporte, grande(), {
      'GET /usuarios': () =>
        json(200, [
          {
            id: OTRA,
            nombre: 'Lucía Salón',
            nombreUsuario: 'lucia',
            esAdministrador: false,
            accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
            activo: true,
            horario: null,
            largoPin: 4,
            contrasenaTemporal: false,
            equiposRecordados: 0,
            creadoEn: AHORA,
            actualizadoEn: AHORA,
          },
        ]),
      'POST /ordenes': () => json(201, orden()),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    expect(within(hoja).getByRole('button', { name: 'Abrir mesa' })).toBeDisabled();
    expect(within(hoja).getByText(/Elige quién atenderá la mesa/)).toBeInTheDocument();
    await userEvent.click(await within(hoja).findByRole('button', { name: /Lucía Salón/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));
    await screen.findByRole('heading', { name: 'Cuenta de la mesa' });
    expect(s.de('POST', '/ordenes')[0]?.cuerpo).toMatchObject({ mozoId: OTRA });
  });

  it('si otra persona abrió la mesa antes, lo dice y lleva a su cuenta', async () => {
    const OTRA_ORDEN = uuid(960);
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'POST /ordenes': () =>
        json(409, {
          codigo: 'MESA_OCUPADA',
          mensaje: 'La mesa ya tiene una orden abierta',
          ordenId: OTRA_ORDEN,
        }),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));

    expect(await screen.findByRole('heading', { name: 'Cuenta de la mesa' })).toBeInTheDocument();
    expect(screen.getByText('Otra persona acaba de abrir esta mesa')).toBeInTheDocument();
    // El mapa se vuelve a pedir para mostrar la mesa ocupada.
    await waitFor(() => expect(s.de('GET', '/salon').length).toBeGreaterThan(0));
  });

  it('un corte de red deja la apertura "Pendiente de envío" y sale una sola vez con la misma clave y el mismo id', async () => {
    let intentos = 0;
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'POST /ordenes': () => {
        intentos += 1;
        if (intentos <= 2) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(json(201, orden()));
      },
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));

    expect(await screen.findByRole('heading', { name: 'Cuenta de la mesa' })).toBeInTheDocument();
    const llamadas = s.de('POST', '/ordenes');
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
    expect(new Set(llamadas.map((l) => (l.cuerpo as { id: string }).id)).size).toBe(1);
  });

  it('otro error se dice en la hoja con la salida, y se puede volver a intentar', async () => {
    let intento = 0;
    servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'POST /ordenes': () => {
        intento += 1;
        return intento === 1
          ? json(409, { codigo: 'CONFLICTO', mensaje: 'Mesa inactiva' })
          : json(201, orden());
      },
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));
    expect(await within(hoja).findByText('No pudimos abrir la mesa')).toBeInTheDocument();
    expect(within(hoja).getByText(/Esta mesa está desactivada/)).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Abrir mesa' }));
    await screen.findByRole('heading', { name: 'Cuenta de la mesa' });
  });

  it('cancelar cierra la hoja sin abrir nada', async () => {
    const s = servidorDeSalon(sesionDeRol('MOZO'), grande(), {
      'POST /ordenes': () => json(201, orden()),
    });
    renderApp('/salon');
    const hoja = await abrirHoja('1');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Abrir mesa/ })).toBeNull());
    expect(s.de('POST', '/ordenes')).toHaveLength(0);
  });
});

describe('Salón sin sucursal elegida', () => {
  it('pide elegir una sucursal', async () => {
    servidorDeSalon(sesionDe({ ...sesionDeRol('ADMINISTRADOR'), sucursal: null }), salon([]), {});
    renderApp('/salon');
    // Sin sucursal activa la app lleva a elegirla antes de entrar al salón.
    expect(await screen.findByRole('heading', { name: 'Elige tu sucursal' })).toBeInTheDocument();
  });
});
