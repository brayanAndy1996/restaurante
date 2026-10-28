import type {
  EstacionRespuesta,
  FamiliaRespuesta,
  ProductoRespuesta,
  ProductoResumen,
  SesionRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import * as imagen from '../src/lib/imagen';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

vi.mock('../src/lib/imagen', async (original) => {
  const modulo = await original<typeof import('../src/lib/imagen')>();
  return { ...modulo, reducirFoto: vi.fn() };
});

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const FAM_ENTRADAS = 'f1000000-0000-4000-8000-000000000001';
const FAM_FONDOS = 'f2000000-0000-4000-8000-000000000002';
const EST_COCINA = 'e1000000-0000-4000-8000-000000000001';
const EST_BARRA = 'e2000000-0000-4000-8000-000000000002';
const P_CEVICHE = 'a1000000-0000-4000-8000-000000000001';
const P_LOMO = 'a2000000-0000-4000-8000-000000000002';
const P_CHICHA = 'a3000000-0000-4000-8000-000000000003';
const P_AJI = 'a4000000-0000-4000-8000-000000000004';
const INSTANTE = '2026-10-29T10:00:00.000Z';

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

/** Cajero en Miraflores (activa) y Mozo en Surco. */
const cajero = (activa: 'A' | 'B' = 'A'): SesionRespuesta => {
  const rolActivo = activa === 'A' ? 'CAJERO' : 'MOZO';
  return sesionDe({
    esAdministrador: false,
    rol: rolActivo,
    permisos: permisosDeRol(rolActivo),
    sucursal:
      activa === 'A'
        ? { id: ID.sucursalA, nombre: 'Miraflores' }
        : { id: ID.sucursalB, nombre: 'Surco' },
    sucursales: [
      { id: ID.sucursalA, nombre: 'Miraflores', rol: 'CAJERO' },
      { id: ID.sucursalB, nombre: 'Surco', rol: 'MOZO' },
    ],
  });
};

const mozo = (): SesionRespuesta =>
  sesionDe({
    esAdministrador: false,
    rol: 'MOZO',
    permisos: permisosDeRol('MOZO'),
    sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol: 'MOZO' }],
  });

const familia = (id: string, nombre: string, orden: number, extra = {}): FamiliaRespuesta => ({
  id,
  nombre,
  orden,
  activa: true,
  productos: 2,
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
  ...extra,
});
const estacion = (id: string, nombre: string, extra = {}): EstacionRespuesta => ({
  id,
  nombre,
  activa: true,
  productosActivos: 0,
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
  ...extra,
});
const resumen = (id: string, nombre: string, familiaId: string, extra = {}): ProductoResumen => ({
  id,
  tipo: 'SIMPLE',
  nombre,
  familiaId,
  precio: '38.00',
  seVendeSolo: true,
  estacionId: EST_COCINA,
  tipoControlStock: 'PORCIONES',
  fotoUrl: null,
  activo: true,
  orden: 1,
  ...extra,
});
const completo = (base: ProductoResumen, extra = {}): ProductoRespuesta => ({
  ...base,
  descripcion: null,
  afectacionIgv: 'GRAVADO',
  aplicaIcbper: false,
  grupos: [],
  componentes: [],
  usadoEn: { combos: [], modificadores: [] },
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
  ...extra,
});

const FAMILIAS = [familia(FAM_ENTRADAS, 'Entradas', 1), familia(FAM_FONDOS, 'Fondos', 2)];
const ESTACIONES = [
  estacion(EST_COCINA, 'Cocina', { productosActivos: 3 }),
  estacion(EST_BARRA, 'Barra'),
];
const PRODUCTOS = [
  resumen(P_CEVICHE, 'Ceviche mixto', FAM_ENTRADAS, {
    fotoUrl: 'https://fotos.prueba/ceviche.jpg',
  }),
  resumen(P_AJI, 'Ají de gallina', FAM_ENTRADAS, {
    seVendeSolo: false,
    precio: null,
    orden: 2,
    estacionId: null,
  }),
  resumen(P_LOMO, 'Lomo saltado', FAM_FONDOS, { precio: '32.50' }),
  resumen(P_CHICHA, 'Chicha morada', FAM_FONDOS, {
    activo: false,
    orden: 2,
    estacionId: EST_BARRA,
  }),
];

function carta(sesion: SesionRespuesta, extra: Parameters<typeof servidor>[0] = {}) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /carta/familias': () => json(200, FAMILIAS),
    'GET /carta/estaciones': () => json(200, ESTACIONES),
    'GET /carta/productos': () => json(200, PRODUCTOS),
    // El formulario del producto lee los grupos de modificadores (003, C3); su prueba está en carta-grupos.
    'GET /carta/grupos-modificadores': () => json(200, []),
    // La edición de un producto también lee sus sucursales (003, C2); su prueba está en carta-sucursales.
    [`GET /carta/productos/${P_CEVICHE}/sucursales`]: () => json(200, []),
    [`GET /carta/productos/${P_AJI}/sucursales`]: () => json(200, []),
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:vista-previa'),
      revokeObjectURL: vi.fn(),
    }),
  );
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('navegación a la carta', () => {
  it('el Administrador y el Cajero (con su sucursal de Cajero activa) ven "Carta"', async () => {
    carta(administrador());
    const { unmount } = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Carta' })).toHaveAttribute('href', '/carta');
    unmount();
    carta(cajero());
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Carta' })).toBeInTheDocument();
  });

  it('el Cajero con otra sucursal activa donde es Mozo no ve "Carta" y la ruta lo devuelve al inicio', async () => {
    carta(cajero('B'));
    renderApp('/carta');
    expect(await screen.findByRole('heading', { name: 'Hola, Marta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Carta' })).not.toBeInTheDocument();
  });

  it('el Mozo no ve "Carta" y no entra por la dirección', async () => {
    const s = carta(mozo());
    renderApp('/carta/productos/nuevo');
    await waitFor(() => expect(s.de('GET', '/sesion').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText('Nuevo producto')).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Carta' })).not.toBeInTheDocument();
    expect(s.de('GET', '/carta/familias')).toHaveLength(0);
  });
});

describe('lista de productos', () => {
  it('muestra un esqueleto y luego los productos agrupados por familia, con precio, estación y estado', async () => {
    carta(administrador());
    renderApp('/carta');
    expect(await screen.findByRole('status', { name: 'Cargando productos' })).toBeInTheDocument();
    const entradas = await screen.findByRole('region', { name: 'Entradas' });
    const fondos = screen.getByRole('region', { name: 'Fondos' });
    expect(within(entradas).getByRole('link', { name: /Ceviche mixto/ })).toHaveTextContent(
      'S/ 38.00 · Cocina',
    );
    const aji = within(entradas).getByRole('link', { name: /Ají de gallina/ });
    expect(aji).toHaveTextContent('Sin estación');
    expect(aji).toHaveTextContent('No se vende solo');
    expect(within(fondos).getByRole('link', { name: /Lomo saltado/ })).toHaveTextContent(
      'S/ 32.50',
    );
    // El inactivo se oculta con "Activos".
    expect(within(fondos).queryByText('Chicha morada')).not.toBeInTheDocument();
    expect(screen.getByText('4 productos · 1 inactivo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Nuevo producto/ })).toHaveAttribute(
      'href',
      '/carta/productos/nuevo',
    );
    // La miniatura se carga perezosa.
    expect(document.querySelector('img[loading="lazy"]')).toHaveAttribute(
      'src',
      'https://fotos.prueba/ceviche.jpg',
    );
  });

  it('"Ver inactivos" muestra también los inactivos, marcados con texto, y "Ocultar" los vuelve a esconder', async () => {
    carta(administrador());
    renderApp('/carta');
    await screen.findByRole('region', { name: 'Fondos' });
    await userEvent.click(screen.getByRole('button', { name: 'Ver inactivos' }));
    const fondos = screen.getByRole('region', { name: 'Fondos' });
    expect(within(fondos).getByRole('link', { name: /Chicha morada/ })).toHaveTextContent(
      'Inactivo',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar inactivos' }));
    expect(screen.queryByRole('link', { name: /Chicha morada/ })).not.toBeInTheDocument();
  });

  it('busca por nombre sin importar tildes ni mayúsculas', async () => {
    carta(administrador(), {
      'GET /carta/productos': () =>
        json(200, [
          ...PRODUCTOS,
          resumen('b1000000-0000-4000-8000-000000000001', 'Arroz chaufa', FAM_FONDOS),
          resumen('b2000000-0000-4000-8000-000000000002', 'Causa limeña', FAM_ENTRADAS),
          resumen('b3000000-0000-4000-8000-000000000003', 'Tiradito', FAM_ENTRADAS),
        ]),
    });
    renderApp('/carta');
    await userEvent.type(await screen.findByLabelText('Buscar'), 'AJI');
    expect(screen.getByRole('link', { name: /Ají de gallina/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Lomo saltado/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Buscar'));
    await userEvent.type(screen.getByLabelText('Buscar'), 'zzz');
    expect(screen.getByText('No encontramos productos')).toBeInTheDocument();
  });

  it('sin familias dice que se empieza por una familia', async () => {
    carta(administrador(), {
      'GET /carta/familias': () => json(200, []),
      'GET /carta/productos': () => json(200, []),
    });
    renderApp('/carta');
    expect(await screen.findByText('Aún no tienes productos')).toBeInTheDocument();
    expect(screen.getByText(/Crea tu primera familia y tu primer producto/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Crear una familia/ })).toHaveAttribute(
      'href',
      '/carta?ver=familias',
    );
  });

  it('con familias y sin productos ofrece crear el primero', async () => {
    carta(administrador(), { 'GET /carta/productos': () => json(200, []) });
    renderApp('/carta');
    expect(await screen.findByText('Aún no tienes productos')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nuevo producto/ }).length).toBeGreaterThan(0);
  });

  it('si falla la carga nombra el problema y deja reintentar en la misma pantalla', async () => {
    let n = 0;
    carta(administrador(), {
      'GET /carta/productos': () =>
        ++n === 1 ? json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }) : json(200, PRODUCTOS),
    });
    renderApp('/carta');
    expect(await screen.findByText('No pudimos cargar la carta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('link', { name: /Lomo saltado/ })).toBeInTheDocument();
  });

  it('ordena con subir y bajar, y guarda solo las familias que cambiaron', async () => {
    const s = carta(administrador(), {
      [`PUT /carta/familias/${FAM_ENTRADAS}/productos/orden`]: () =>
        json(200, [PRODUCTOS[1], PRODUCTOS[0]]),
    });
    renderApp('/carta');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.click(screen.getByRole('button', { name: /Ordenar/ }));
    // En el modo ordenar se ven todos, también los inactivos.
    expect(screen.getByText('Chicha morada')).toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: 'Guardar orden' });
    expect(guardar).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Bajar Ceviche mixto' }));
    expect(screen.getByRole('status')).toHaveTextContent('Ceviche mixto: posición 2 de 2');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar orden' }));
    await waitFor(() =>
      expect(s.de('PUT', `/carta/familias/${FAM_ENTRADAS}/productos/orden`)).toHaveLength(1),
    );
    expect(s.de('PUT', `/carta/familias/${FAM_ENTRADAS}/productos/orden`)[0]?.cuerpo).toEqual({
      ids: [P_AJI, P_CEVICHE],
    });
    // Como toda escritura de la carta, lleva su clave de idempotencia (lo comprueba el E2E contra la API real).
    expect(
      s
        .de('PUT', `/carta/familias/${FAM_ENTRADAS}/productos/orden`)[0]
        ?.cabeceras.get('Idempotency-Key'),
    ).toBeTruthy();
    expect(s.de('PUT', `/carta/familias/${FAM_FONDOS}/productos/orden`)).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar orden' })).toBeNull());
  });

  it('cancelar el orden no escribe nada', async () => {
    const s = carta(administrador());
    renderApp('/carta');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.click(screen.getByRole('button', { name: /Ordenar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Bajar Ceviche mixto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(0);
    expect(await screen.findByRole('region', { name: 'Entradas' })).toBeInTheDocument();
  });
});

describe('secciones: familias y estaciones', () => {
  it('el Administrador ve "Estaciones"; el Cajero no, y por la dirección cae en Productos', async () => {
    carta(administrador());
    const { unmount } = renderApp('/carta');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.getByRole('button', { name: 'Estaciones' })).toBeInTheDocument();
    unmount();

    const s = carta(cajero());
    renderApp('/carta?ver=estaciones');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.queryByRole('button', { name: 'Estaciones' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Familias' })).toBeInTheDocument();
    // Ni siquiera pide las estaciones para esa pantalla (las pide solo el formulario y la lista, que las lee).
    expect(s.de('POST', '/carta/estaciones')).toHaveLength(0);
  });

  it('familias: lista en orden, con cuántos productos y las inactivas marcadas', async () => {
    carta(administrador(), {
      'GET /carta/familias': () =>
        json(200, [
          ...FAMILIAS,
          familia('f3000000-0000-4000-8000-000000000003', 'Postres', 3, {
            activa: false,
            productos: 0,
          }),
        ]),
    });
    renderApp('/carta?ver=familias');
    const lista = await screen.findByRole('list', { name: 'Familias' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3);
    expect(within(lista).getByRole('button', { name: 'Editar Entradas' })).toHaveTextContent(
      '2 productos',
    );
    expect(within(lista).getByRole('button', { name: 'Editar Postres' })).toHaveTextContent(
      'Inactiva',
    );
    expect(screen.getByText('3 familias · 1 inactiva')).toBeInTheDocument();
  });

  it('crea una familia con clave de idempotencia y la lista se vuelve a leer', async () => {
    let creada = false;
    const s = carta(administrador(), {
      'GET /carta/familias': () =>
        json(
          200,
          creada
            ? [...FAMILIAS, familia('f3000000-0000-4000-8000-000000000003', 'Postres', 3)]
            : FAMILIAS,
        ),
      'POST /carta/familias': () => {
        creada = true;
        return json(201, familia('f3000000-0000-4000-8000-000000000003', 'Postres', 3));
      },
    });
    renderApp('/carta?ver=familias');
    await screen.findByRole('list', { name: 'Familias' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar familia' }));
    await userEvent.type(screen.getByLabelText('Nombre de la familia'), '  Postres ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear familia' }));
    await screen.findByRole('button', { name: 'Editar Postres' });
    const llamada = s.de('POST', '/carta/familias')[0];
    expect(llamada?.cuerpo).toEqual({ nombre: 'Postres' });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('crear una familia sin red queda "Pendiente de envío" y sale sola con la misma clave al volver', async () => {
    let sinRed = true;
    let esperas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++esperas === 7) await compuerta;
    });
    const s = carta(administrador(), {
      'POST /carta/familias': () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(201, familia('f3000000-0000-4000-8000-000000000003', 'Postres', 3));
      },
    });
    renderApp('/carta?ver=familias');
    await screen.findByText('Entradas');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar familia' }));
    await userEvent.type(screen.getByLabelText('Nombre de la familia'), 'Postres');
    await userEvent.click(screen.getByRole('button', { name: 'Crear familia' }));
    const aviso = (await screen.findAllByText('Pendiente de envío'))[0]!.closest(
      '[role="status"]',
    )!;
    expect(aviso).toHaveTextContent('Tus cambios se enviarán solos');
    expect(screen.getByLabelText('Nombre de la familia')).toHaveValue('Postres');
    sinRed = false;
    liberar();
    await waitFor(() => expect(screen.queryByText('Pendiente de envío')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByLabelText('Nombre de la familia')).not.toBeInTheDocument(),
    );
    expect(
      new Set(s.de('POST', '/carta/familias').map((l) => l.cabeceras.get('Idempotency-Key'))).size,
    ).toBe(1);
  });

  it('con el navegador sin red (navigator.onLine en falso y evento offline) no se queda en "Guardando…": queda "Pendiente de envío" y sale solo al volver (evento online) con la misma clave', async () => {
    const enLinea = vi.spyOn(navigator, 'onLine', 'get');
    try {
      let sinRed = true;
      let esperas = 0;
      let liberar!: () => void;
      const compuerta = new Promise<void>((resolver) => (liberar = resolver));
      vi.spyOn(espera, 'dormir').mockImplementation(async () => {
        if (++esperas === 7) await compuerta;
      });
      const s = carta(administrador(), {
        'POST /carta/familias': () => {
          if (sinRed) throw new TypeError('Failed to fetch');
          return json(201, familia('f3000000-0000-4000-8000-000000000003', 'Postres', 3));
        },
      });
      renderApp('/carta?ver=familias');
      await screen.findByText('Entradas');
      await userEvent.click(screen.getByRole('button', { name: 'Agregar familia' }));
      await userEvent.type(screen.getByLabelText('Nombre de la familia'), 'Postres');
      // Se corta el wifi con la pantalla ya abierta (TanStack empieza a oír `offline` al montarse).
      enLinea.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      await userEvent.click(screen.getByRole('button', { name: 'Crear familia' }));
      // La escritura sale aunque el navegador diga que no hay red (TanStack no la pausa) y queda pendiente.
      const aviso = (await screen.findAllByText('Pendiente de envío'))[0]!.closest(
        '[role="status"]',
      )!;
      expect(aviso).toHaveTextContent('Tus cambios se enviarán solos');
      expect(s.de('POST', '/carta/familias').length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Nombre de la familia')).toHaveValue('Postres');

      // Vuelve la red: sale sola, con la misma clave, y la pantalla se limpia.
      sinRed = false;
      enLinea.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
      liberar();
      await waitFor(() => expect(screen.queryByText('Pendiente de envío')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.queryByLabelText('Nombre de la familia')).not.toBeInTheDocument(),
      );
      expect(
        new Set(s.de('POST', '/carta/familias').map((l) => l.cabeceras.get('Idempotency-Key')))
          .size,
      ).toBe(1);
    } finally {
      enLinea.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    }
  });

  it('un nombre repetido se dice en el campo y lo escrito se conserva', async () => {
    carta(administrador(), {
      'POST /carta/familias': () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/carta?ver=familias');
    await screen.findByRole('list', { name: 'Familias' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar familia' }));
    await userEvent.type(screen.getByLabelText('Nombre de la familia'), 'Entradas');
    await userEvent.click(screen.getByRole('button', { name: 'Crear familia' }));
    expect(
      await screen.findByText('Ya tienes una familia con ese nombre. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la familia')).toHaveValue('Entradas');
  });

  it('una familia con productos activos no se puede desactivar y dice por qué; sin ellos, sí', async () => {
    const s = carta(administrador(), {
      'GET /carta/familias': () =>
        json(200, [
          familia(FAM_ENTRADAS, 'Entradas', 1),
          familia(FAM_FONDOS, 'Fondos', 2, { productos: 0 }),
        ]),
      [`PATCH /carta/familias/${FAM_FONDOS}`]: () =>
        json(200, familia(FAM_FONDOS, 'Fondos', 2, { activa: false, productos: 0 })),
    });
    renderApp('/carta?ver=familias');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Entradas' }));
    expect(screen.getByText(/tiene 2 productos activos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar familia' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Editar Fondos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar familia' }));
    await waitFor(() => expect(s.de('PATCH', `/carta/familias/${FAM_FONDOS}`)).toHaveLength(1));
    expect(s.de('PATCH', `/carta/familias/${FAM_FONDOS}`)[0]?.cuerpo).toEqual({ activa: false });
  });

  it('si la API responde EN_USO (otro la usó antes), lo explica con palabras', async () => {
    carta(administrador(), {
      'GET /carta/familias': () => json(200, [familia(FAM_FONDOS, 'Fondos', 2, { productos: 0 })]),
      [`PATCH /carta/familias/${FAM_FONDOS}`]: () => json(409, { codigo: 'EN_USO', mensaje: 'x' }),
    });
    renderApp('/carta?ver=familias');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Fondos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar familia' }));
    expect(await screen.findByText(/Pásalos a otra familia o desactívalos/)).toBeInTheDocument();
  });

  it('renombra una familia y reordena', async () => {
    const s = carta(administrador(), {
      [`PATCH /carta/familias/${FAM_ENTRADAS}`]: () =>
        json(200, familia(FAM_ENTRADAS, 'Para empezar', 1)),
      'PUT /carta/familias/orden': () => json(200, [FAMILIAS[1], FAMILIAS[0]]),
    });
    renderApp('/carta?ver=familias');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Entradas' }));
    await userEvent.clear(screen.getByLabelText('Nombre de la familia'));
    await userEvent.type(screen.getByLabelText('Nombre de la familia'), 'Para empezar');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(s.de('PATCH', `/carta/familias/${FAM_ENTRADAS}`)).toHaveLength(1));
    expect(s.de('PATCH', `/carta/familias/${FAM_ENTRADAS}`)[0]?.cuerpo).toEqual({
      nombre: 'Para empezar',
    });

    await userEvent.click(await screen.findByRole('button', { name: /Ordenar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Subir Fondos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar orden' }));
    await waitFor(() => expect(s.de('PUT', '/carta/familias/orden')).toHaveLength(1));
    expect(s.de('PUT', '/carta/familias/orden')[0]?.cuerpo).toEqual({
      ids: [FAM_FONDOS, FAM_ENTRADAS],
    });
  });

  it('estaciones: el Administrador las crea; una usada por productos explica cómo desactivarla', async () => {
    const s = carta(administrador(), {
      'POST /carta/estaciones': () =>
        json(201, estacion('e3000000-0000-4000-8000-000000000003', 'Parrilla')),
    });
    renderApp('/carta?ver=estaciones');
    const lista = await screen.findByRole('list', { name: 'Estaciones' });
    expect(within(lista).getByRole('button', { name: 'Editar Cocina' })).toHaveTextContent(
      '3 productos',
    );
    await userEvent.click(within(lista).getByRole('button', { name: 'Editar Cocina' }));
    expect(
      screen.getByText(
        'Esta estación la usan 3 productos. Cámbialos de estación antes de desactivarla.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar estación' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Agregar estación' }));
    await userEvent.type(screen.getByLabelText('Nombre de la estación'), 'Parrilla');
    await userEvent.click(screen.getByRole('button', { name: 'Crear estación' }));
    await waitFor(() => expect(s.de('POST', '/carta/estaciones')).toHaveLength(1));
    expect(s.de('POST', '/carta/estaciones')[0]?.cuerpo).toEqual({ nombre: 'Parrilla' });
  });

  it('sin estaciones ni familias, cada sección dice qué falta y cómo empezar', async () => {
    carta(administrador(), {
      'GET /carta/estaciones': () => json(200, []),
      'GET /carta/familias': () => json(200, []),
    });
    const { unmount } = renderApp('/carta?ver=estaciones');
    expect(await screen.findByText('Aún no hay estaciones')).toBeInTheDocument();
    unmount();
    renderApp('/carta?ver=familias');
    expect(await screen.findByText('Aún no hay familias')).toBeInTheDocument();
  });
});

describe('formulario de producto: alta', () => {
  it('no deja crear sin lo mínimo, lo dice campo por campo y no envía nada', async () => {
    const s = carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(screen.getByText('Escribe el nombre del producto')).toBeInTheDocument();
    expect(screen.getByText('Elige la familia del producto')).toBeInTheDocument();
    expect(screen.getByText('Escribe el precio con IGV')).toBeInTheDocument();
    expect(screen.getByText(/Elige la estación, o "Ninguna"/)).toBeInTheDocument();
    expect(screen.getByText('Elige cómo se controla el stock')).toBeInTheDocument();
    expect(s.de('POST', '/carta/productos')).toHaveLength(0);
  });

  it('nace como producto simple que se vende solo, gravado y con "Ninguna" entre las estaciones', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    expect(screen.getByText('Simple')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Se vende solo' })).toBeChecked();
    const estaciones = within(screen.getByLabelText('Estación')).getAllByRole('option');
    expect(estaciones.map((o) => o.textContent)).toEqual([
      'Elige una estación',
      'Ninguna (no va a cocina ni a barra)',
      'Cocina',
      'Barra',
    ]);
    expect(screen.getByRole('button', { name: /Datos tributarios/ })).toHaveTextContent(
      'Gravado con IGV · sin ICBPER',
    );
    // Las tres formas de controlar el stock, cada una con su ayuda, sin ninguna elegida.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByText(/Cargas cuántas porciones salen hoy/)).toBeInTheDocument();
  });

  it('con "Se vende solo" apagado no pide ni envía precio', async () => {
    const s = carta(administrador(), {
      'POST /carta/productos': ({ cuerpo }) =>
        json(
          201,
          completo(
            resumen(P_AJI, 'Ají del menú', FAM_FONDOS, { seVendeSolo: false, precio: null }),
            { cuerpo },
          ),
        ),
      [`GET /carta/productos/${P_AJI}`]: () =>
        json(
          200,
          completo(
            resumen(P_AJI, 'Ají del menú', FAM_FONDOS, { seVendeSolo: false, precio: null }),
          ),
        ),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.click(screen.getByRole('switch', { name: 'Se vende solo' }));
    expect(screen.queryByLabelText('Precio con IGV')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ají del menú');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM_FONDOS);
    await userEvent.selectOptions(screen.getByLabelText('Estación'), 'ninguna');
    await userEvent.click(screen.getByRole('radio', { name: /Sin control/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(() => expect(s.de('POST', '/carta/productos')).toHaveLength(1));
    expect(s.de('POST', '/carta/productos')[0]?.cuerpo).toEqual({
      tipo: 'SIMPLE',
      nombre: 'Ají del menú',
      familiaId: FAM_FONDOS,
      seVendeSolo: false,
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: null,
      tipoControlStock: 'SIN_CONTROL',
    });
  });

  it('crea el producto con clave de idempotencia y pasa a su edición, para agregar la foto', async () => {
    const creado = completo(resumen(P_CEVICHE, 'Ceviche mixto', FAM_ENTRADAS));
    const s = carta(administrador(), {
      'POST /carta/productos': () => json(201, creado),
      [`GET /carta/productos/${P_CEVICHE}`]: () => json(200, creado),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre'), '  Ceviche mixto ');
    await userEvent.type(screen.getByLabelText('Descripción (opcional)'), 'Pesca del día');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM_ENTRADAS);
    await userEvent.type(screen.getByLabelText('Precio con IGV'), '38');
    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST_COCINA);
    await userEvent.click(screen.getByRole('radio', { name: /Por porciones/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(await screen.findByText('Producto creado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar o elegir foto' })).toBeInTheDocument();
    const llamada = s.de('POST', '/carta/productos')[0];
    expect(llamada?.cuerpo).toEqual({
      tipo: 'SIMPLE',
      nombre: 'Ceviche mixto',
      descripcion: 'Pesca del día',
      familiaId: FAM_ENTRADAS,
      seVendeSolo: true,
      precio: '38.00',
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      estacionId: EST_COCINA,
      tipoControlStock: 'PORCIONES',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('un nombre repetido se dice en su campo y todo lo escrito se conserva', async () => {
    carta(administrador(), {
      'POST /carta/productos': () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ceviche mixto');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM_ENTRADAS);
    await userEvent.type(screen.getByLabelText('Precio con IGV'), '38.5');
    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST_COCINA);
    await userEvent.click(screen.getByRole('radio', { name: /Por unidades/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(
      await screen.findByText('Ya tienes un producto con ese nombre. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ceviche mixto');
    expect(screen.getByLabelText('Precio con IGV')).toHaveValue('38.50');
    expect(screen.getByRole('radio', { name: /Por unidades/ })).toBeChecked();
  });

  it('sin familias activas avisa y lleva a crear una', async () => {
    carta(administrador(), { 'GET /carta/familias': () => json(200, []) });
    renderApp('/carta/productos/nuevo');
    expect(await screen.findByText('Primero crea una familia')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear una familia' })).toHaveAttribute(
      'href',
      '/carta?ver=familias',
    );
  });

  it('"Datos tributarios" está plegado, se abre y cambia el resumen', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    const plegable = screen.getByRole('button', { name: /Datos tributarios/ });
    expect(plegable).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Afectación al IGV')).not.toBeVisible();
    await userEvent.click(plegable);
    await userEvent.selectOptions(screen.getByLabelText('Afectación al IGV'), 'EXONERADO');
    await userEvent.click(screen.getByRole('switch', { name: 'Aplica ICBPER' }));
    expect(plegable).toHaveTextContent('Exonerado · con ICBPER');
  });

  it('"Disponible en": el Administrador decide en todas; el Cajero, solo donde es Cajero (las otras quedan marcadas y bloqueadas)', async () => {
    const creado = completo(resumen(P_CEVICHE, 'Ceviche mixto', FAM_ENTRADAS));
    const s = carta(cajero(), {
      'POST /carta/productos': () => json(201, creado),
      [`GET /carta/productos/${P_CEVICHE}`]: () => json(200, creado),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Disponible en' });
    const miraflores = screen.getByRole('checkbox', { name: /Miraflores/ });
    const surco = screen.getByRole('checkbox', { name: /Surco/ });
    expect(miraflores).toBeEnabled();
    expect(miraflores).toBeChecked();
    expect(surco).toBeDisabled();
    expect(surco).toBeChecked();
    expect(surco).toHaveAccessibleDescription(
      'Solo lo cambia el Administrador o un Cajero de esta sucursal.',
    );

    await userEvent.click(miraflores);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ceviche mixto');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM_ENTRADAS);
    await userEvent.type(screen.getByLabelText('Precio con IGV'), '38');
    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST_COCINA);
    await userEvent.click(screen.getByRole('radio', { name: /Por porciones/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(() => expect(s.de('POST', '/carta/productos')).toHaveLength(1));
    // Solo la sucursal que el Cajero desmarcó; la bloqueada nunca viaja como "no disponible".
    expect(s.de('POST', '/carta/productos')[0]?.cuerpo).toMatchObject({
      noDisponibleEn: [ID.sucursalA],
    });
  });

  it('el Administrador puede desmarcar cualquier sucursal', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Disponible en' });
    expect(screen.getByRole('checkbox', { name: /Miraflores/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Surco/ })).toBeEnabled();
  });

  it('si el Cajero igual recibe 403 por una sucursal, lo dice sin perder el formulario', async () => {
    carta(cajero(), {
      'POST /carta/productos': () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ceviche mixto');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM_ENTRADAS);
    await userEvent.type(screen.getByLabelText('Precio con IGV'), '38');
    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST_COCINA);
    await userEvent.click(screen.getByRole('radio', { name: /Por porciones/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText('No pudimos guardar')).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: '' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ceviche mixto');
  });
});

describe('formulario de producto: edición', () => {
  const ceviche = completo(PRODUCTOS[0] as ProductoResumen, { descripcion: 'Pesca del día' });
  const ruta = `/carta/productos/${P_CEVICHE}`;

  it('carga el producto, y "Guardar cambios" espera a que haya algo que guardar', async () => {
    carta(administrador(), { [`GET ${ruta}`]: () => json(200, ceviche) });
    renderApp(ruta);
    expect(await screen.findByRole('status', { name: 'Cargando producto' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Ceviche mixto');
    expect(screen.getByLabelText('Descripción (opcional)')).toHaveValue('Pesca del día');
    expect(screen.getByLabelText('Precio con IGV')).toHaveValue('38.00');
    expect(screen.getByLabelText('Estación')).toHaveValue(EST_COCINA);
    expect(screen.getByRole('radio', { name: /Por porciones/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    // En la edición no se pregunta dónde nace disponible: eso es del alta.
    expect(screen.queryByRole('heading', { name: 'Disponible en' })).not.toBeInTheDocument();
  });

  it('guarda solo lo que cambió', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PATCH ${ruta}`]: () => json(200, { ...ceviche, precio: '40.00' }),
    });
    renderApp(ruta);
    const precio = await screen.findByLabelText('Precio con IGV');
    await userEvent.clear(precio);
    await userEvent.type(precio, '40');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ precio: '40.00' });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('si se corta la conexión al guardar, reintenta con la misma operación y no pierde lo escrito', async () => {
    let intentos = 0;
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PATCH ${ruta}`]: () =>
        ++intentos < 3
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { ...ceviche, nombre: 'Ceviche clásico' }),
    });
    renderApp(ruta);
    const nombre = await screen.findByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Ceviche clásico');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', ruta)).toHaveLength(3);
  });

  it('desactivar pide confirmación y dice qué pasará; reactivar no', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PATCH ${ruta}`]: ({ cuerpo }) =>
        json(200, { ...ceviche, activo: (cuerpo as { activo: boolean }).activo }),
    });
    renderApp(ruta);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar producto' }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/carta de todas las sucursales/)).toBeInTheDocument();
    expect(s.de('PATCH', ruta)).toHaveLength(0);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Desactivar producto' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(1));
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ activo: false });
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar producto' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(2));
    expect(s.de('PATCH', ruta)[1]?.cuerpo).toEqual({ activo: true });
  });

  it('un producto que no se vende solo y no se usa en nada lo dice en "Usado en"', async () => {
    const aji = completo(PRODUCTOS[1] as ProductoResumen);
    carta(administrador(), { [`GET /carta/productos/${P_AJI}`]: () => json(200, aji) });
    renderApp(`/carta/productos/${P_AJI}`);
    expect(await screen.findByRole('heading', { name: 'Usado en' })).toBeInTheDocument();
    expect(screen.getByText(/Nada todavía/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Precio con IGV')).not.toBeInTheDocument();
  });

  it('un producto que no existe lo dice y no deja editar', async () => {
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    });
    renderApp(ruta);
    expect(await screen.findByText('No encontramos este producto')).toBeInTheDocument();
  });
});

describe('foto del producto', () => {
  const ceviche = completo(PRODUCTOS[0] as ProductoResumen, { fotoUrl: null });
  const ruta = `/carta/productos/${P_CEVICHE}`;
  const archivo = new File([new Uint8Array(4_000_000)], 'ceviche.heic', { type: 'image/heic' });
  const reducida = new Blob([new Uint8Array(230_000)], { type: 'image/jpeg' });

  beforeEach(() => {
    vi.mocked(imagen.reducirFoto).mockReset();
    vi.mocked(imagen.reducirFoto).mockResolvedValue(reducida);
  });

  async function elegirFoto() {
    await userEvent.upload(await screen.findByLabelText('Elegir foto de Ceviche mixto'), archivo);
  }

  it('reduce la foto, la sube como binario JPEG y muestra la nueva', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PUT ${ruta}/foto`]: () => json(200, { fotoUrl: 'https://fotos.prueba/nueva.jpg' }),
    });
    renderApp(ruta);
    await elegirFoto();
    const imagenNueva = await screen.findByRole('img', { name: 'Foto de Ceviche mixto' });
    await waitFor(() =>
      expect(imagenNueva).toHaveAttribute('src', 'https://fotos.prueba/nueva.jpg'),
    );
    expect(imagen.reducirFoto).toHaveBeenCalledWith(archivo);
    const llamada = s.de('PUT', `${ruta}/foto`)[0];
    expect(llamada?.binario).toBe(reducida);
    expect(llamada?.cabeceras.get('Content-Type')).toBe('image/jpeg');
    expect(llamada?.cabeceras.get('Authorization')).toContain('Bearer');
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
  });

  it('si la red se corta, conserva la imagen ya reducida y reintenta sin volver a elegirla', async () => {
    let intento = 0;
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PUT ${ruta}/foto`]: () =>
        ++intento === 1
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { fotoUrl: 'https://fotos.prueba/nueva.jpg' }),
    });
    // Sin reintentos automáticos en esta prueba: el corte llega hasta la pantalla.
    vi.spyOn(espera, 'dormir').mockResolvedValue();
    renderApp(ruta);
    await elegirFoto();
    // El cliente de la API ya reintentó solo y la segunda vez salió bien.
    await waitFor(() => expect(s.de('PUT', `${ruta}/foto`).length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole('img', { name: 'Foto de Ceviche mixto' })).toHaveAttribute(
      'src',
      'https://fotos.prueba/nueva.jpg',
    );
    expect(imagen.reducirFoto).toHaveBeenCalledTimes(1);
    // Todos los envíos llevaron la misma imagen.
    expect(new Set(s.de('PUT', `${ruta}/foto`).map((l) => l.binario)).size).toBe(1);
  });

  it('si el corte dura más que los reintentos, ofrece "Reintentar" con la vista previa a la vista', async () => {
    let enLinea = false;
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PUT ${ruta}/foto`]: () =>
        enLinea
          ? json(200, { fotoUrl: 'https://fotos.prueba/nueva.jpg' })
          : json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    renderApp(ruta);
    await elegirFoto();
    expect(await screen.findByText(/Tu foto sigue aquí/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto de Ceviche mixto' })).toHaveAttribute(
      'src',
      'blob:vista-previa',
    );
    const intentos = s.de('PUT', `${ruta}/foto`).length;
    enLinea = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Foto de Ceviche mixto' })).toHaveAttribute(
        'src',
        'https://fotos.prueba/nueva.jpg',
      ),
    );
    expect(s.de('PUT', `${ruta}/foto`).length).toBe(intentos + 1);
    expect(imagen.reducirFoto).toHaveBeenCalledTimes(1);
    // "Reintentar" repite la misma escritura: la misma clave de idempotencia en todos los envíos.
    expect(
      new Set(s.de('PUT', `${ruta}/foto`).map((l) => l.cabeceras.get('Idempotency-Key'))).size,
    ).toBe(1);
  });

  it('una foto que la API rechaza dice qué hacer y no ofrece reintentar lo mismo', async () => {
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, ceviche),
      [`PUT ${ruta}/foto`]: () => json(422, { codigo: 'FOTO_INVALIDA', mensaje: 'x' }),
    });
    renderApp(ruta);
    await elegirFoto();
    expect(await screen.findByText(/usa una en JPEG, PNG o WebP/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar o elegir foto' })).toBeEnabled();
  });

  it('una foto que ya se sabe que no sirve (muy pequeña) ni se sube', async () => {
    vi.mocked(imagen.reducirFoto).mockRejectedValue(
      new imagen.ErrorDeFoto(
        'MUY_PEQUENA',
        'La foto es muy pequeña. Necesita al menos 200 píxeles de lado.',
      ),
    );
    const s = carta(administrador(), { [`GET ${ruta}`]: () => json(200, ceviche) });
    renderApp(ruta);
    await elegirFoto();
    expect(await screen.findByText(/La foto es muy pequeña/)).toBeInTheDocument();
    expect(s.de('PUT', `${ruta}/foto`)).toHaveLength(0);
  });

  it('quitar la foto pide confirmación y borra', async () => {
    const conFoto = { ...ceviche, fotoUrl: 'https://fotos.prueba/ceviche.jpg' };
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, conFoto),
      [`DELETE ${ruta}/foto`]: () => json(204),
    });
    renderApp(ruta);
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar foto' }));
    const hoja = await screen.findByRole('dialog');
    expect(s.de('DELETE', `${ruta}/foto`)).toHaveLength(0);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Quitar foto' }));
    await waitFor(() => expect(s.de('DELETE', `${ruta}/foto`)).toHaveLength(1));
    expect(s.de('DELETE', `${ruta}/foto`)[0]?.cabeceras.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Foto de Ceviche mixto' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Tomar o elegir foto' })).toBeInTheDocument();
  });
});
