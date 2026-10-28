import type {
  GrupoRespuesta,
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
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const FAM = 'f1000000-0000-4000-8000-000000000001';
const EST = 'e1000000-0000-4000-8000-000000000001';
const P_LOMO = 'a2000000-0000-4000-8000-000000000002';
const P_CHAUFA = 'a5000000-0000-4000-8000-000000000005';
const P_INCA = 'a6000000-0000-4000-8000-000000000006';
const P_COMBO = 'a7000000-0000-4000-8000-000000000007';
const P_ANTIGUO = 'a8000000-0000-4000-8000-000000000008';
const G_TERMINO = 'c1000000-0000-4000-8000-000000000001';
const G_EXTRAS = 'c2000000-0000-4000-8000-000000000002';
const G_VIEJO = 'c3000000-0000-4000-8000-000000000003';
const G_NUEVO = 'c4000000-0000-4000-8000-000000000004';
const INSTANTE = '2026-10-29T10:00:00.000Z';

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });
const cajero = (): SesionRespuesta =>
  sesionDe({
    esAdministrador: false,
    rol: 'CAJERO',
    permisos: permisosDeRol('CAJERO'),
    sucursales: [
      { id: ID.sucursalA, nombre: 'Miraflores', rol: 'CAJERO' },
      { id: ID.sucursalB, nombre: 'Surco', rol: 'MOZO' },
    ],
  });

const grupo = (parcial: Partial<GrupoRespuesta> & Pick<GrupoRespuesta, 'id'>): GrupoRespuesta => ({
  nombre: 'Término de la carne',
  seleccion: 'UNICA',
  minimo: 1,
  maximo: 1,
  obligatorio: true,
  activo: true,
  modificadores: [
    {
      id: 'd1000000-0000-4000-8000-000000000001',
      nombre: 'Medio',
      precioExtra: '0.00',
      producto: null,
      orden: 1,
    },
    {
      id: 'd2000000-0000-4000-8000-000000000002',
      nombre: 'Bien cocido',
      precioExtra: '1.50',
      producto: { id: P_INCA, nombre: 'Inca Kola' },
      orden: 2,
    },
  ],
  productos: [],
  ...parcial,
});

const TERMINO = grupo({
  id: G_TERMINO,
  productos: [{ id: P_LOMO, nombre: 'Lomo saltado' }],
});
const EXTRAS = grupo({
  id: G_EXTRAS,
  nombre: 'Extras del plato',
  seleccion: 'MULTIPLE',
  minimo: 0,
  maximo: 3,
  obligatorio: false,
  modificadores: [
    {
      id: 'd3000000-0000-4000-8000-000000000003',
      nombre: 'Huevo frito',
      precioExtra: '2.00',
      producto: null,
      orden: 1,
    },
  ],
  productos: [
    { id: P_LOMO, nombre: 'Lomo saltado' },
    { id: P_CHAUFA, nombre: 'Chaufa' },
  ],
});
const VIEJO = grupo({
  id: G_VIEJO,
  nombre: 'Tamaño de la jarra',
  minimo: 0,
  obligatorio: false,
  activo: false,
});

const resumen = (
  id: string,
  nombre: string,
  extra: Partial<ProductoResumen> = {},
): ProductoResumen => ({
  id,
  tipo: 'SIMPLE',
  nombre,
  familiaId: FAM,
  precio: '32.50',
  seVendeSolo: true,
  estacionId: EST,
  tipoControlStock: 'PORCIONES',
  fotoUrl: null,
  activo: true,
  orden: 1,
  ...extra,
});
const PRODUCTOS = [
  resumen(P_LOMO, 'Lomo saltado'),
  resumen(P_CHAUFA, 'Chaufa'),
  resumen(P_INCA, 'Inca Kola', { seVendeSolo: false, precio: null }),
  resumen(P_COMBO, 'Combo hamburguesa', { tipo: 'COMBO', estacionId: null }),
  resumen(P_ANTIGUO, 'Plato retirado', { activo: false }),
];
const lomo = (grupos: { id: string; nombre: string }[] = []): ProductoRespuesta => ({
  ...(PRODUCTOS[0] as ProductoResumen),
  descripcion: null,
  afectacionIgv: 'GRAVADO',
  aplicaIcbper: false,
  grupos,
  componentes: [],
  usadoEn: { combos: [], modificadores: [] },
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
});
const refDe = (g: GrupoRespuesta) => ({ id: g.id, nombre: g.nombre });

function carta(sesion: SesionRespuesta, extra: Parameters<typeof servidor>[0] = {}) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /carta/familias': () =>
      json(200, [
        {
          id: FAM,
          nombre: 'Fondos',
          orden: 1,
          activa: true,
          productos: 4,
          creadoEn: INSTANTE,
          actualizadoEn: INSTANTE,
        },
      ]),
    'GET /carta/estaciones': () =>
      json(200, [
        {
          id: EST,
          nombre: 'Cocina',
          activa: true,
          productosActivos: 3,
          creadoEn: INSTANTE,
          actualizadoEn: INSTANTE,
        },
      ]),
    'GET /carta/productos': () => json(200, PRODUCTOS),
    'GET /carta/grupos-modificadores': () => json(200, [EXTRAS, TERMINO, VIEJO]),
    [`GET /carta/productos/${P_LOMO}/sucursales`]: () => json(200, []),
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

describe('segmento "Modificadores": lista', () => {
  it('el Administrador y el Cajero ven el segmento; "Estaciones" solo el Administrador', async () => {
    carta(administrador());
    const { unmount } = renderApp('/carta?ver=modificadores');
    expect(await screen.findByRole('button', { name: 'Modificadores' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Estaciones' })).toBeInTheDocument();
    unmount();
    carta(cajero());
    renderApp('/carta?ver=modificadores');
    expect(await screen.findByRole('button', { name: 'Modificadores' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estaciones' })).not.toBeInTheDocument();
  });

  it('muestra un esqueleto y luego cada grupo con su regla en palabras y cuántos productos lo usan', async () => {
    carta(administrador());
    renderApp('/carta?ver=modificadores');
    expect(
      await screen.findByRole('status', { name: 'Cargando modificadores' }),
    ).toBeInTheDocument();
    const lista = await screen.findByRole('list', { name: 'Grupos de modificadores' });
    const filas = within(lista).getAllByRole('listitem');
    // El inactivo no sale hasta pedirlo.
    expect(filas).toHaveLength(2);
    expect(within(filas[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      `/carta/grupos/${G_EXTRAS}`,
    );
    expect(filas[0]).toHaveTextContent('Extras del plato');
    expect(filas[0]).toHaveTextContent('Hasta 3, opcional');
    expect(filas[0]).toHaveTextContent('Lo usan 2 productos');
    expect(filas[1]).toHaveTextContent('Elige 1, obligatorio');
    expect(filas[1]).toHaveTextContent('2 opciones');
    expect(filas[1]).toHaveTextContent('Lo usa 1 producto');
    expect(screen.getByText('3 grupos · 1 inactivo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo grupo' })).toHaveAttribute(
      'href',
      '/carta/grupos/nuevo',
    );
  });

  it('"Ver inactivos" muestra también los inactivos, marcados con texto', async () => {
    carta(administrador(), {
      'GET /carta/grupos-modificadores': () => json(200, [TERMINO, VIEJO]),
    });
    renderApp('/carta?ver=modificadores');
    await screen.findByRole('list', { name: 'Grupos de modificadores' });
    expect(screen.queryByText('Tamaño de la jarra')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver inactivos' }));
    const fila = screen.getByText('Tamaño de la jarra').closest('li');
    expect(fila).toHaveTextContent('Inactivo');
  });

  it('sin grupos dice qué es un grupo y ofrece crear el primero', async () => {
    carta(administrador(), { 'GET /carta/grupos-modificadores': () => json(200, []) });
    renderApp('/carta?ver=modificadores');
    expect(await screen.findByText('Aún no hay grupos de modificadores')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Nuevo grupo' })[0]).toHaveAttribute(
      'href',
      '/carta/grupos/nuevo',
    );
  });

  it('si falla la carga lo dice y deja reintentar en la misma pantalla', async () => {
    let falla = true;
    carta(administrador(), {
      'GET /carta/grupos-modificadores': () =>
        falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, [TERMINO]),
    });
    renderApp('/carta?ver=modificadores');
    expect(await screen.findByText('No pudimos cargar los modificadores')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo grupo' })).not.toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Término de la carne')).toBeInTheDocument();
  });

  it('sin conexión al cargar, el título dice "Sin conexión"', async () => {
    carta(administrador(), {
      'GET /carta/grupos-modificadores': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderApp('/carta?ver=modificadores');
    const aviso = (await screen.findByText(/No hay conexión con el servidor/)).closest(
      '[role="alert"]',
    );
    expect(aviso).toHaveTextContent('Sin conexión');
  });
});

describe('formulario de grupo: alta', () => {
  it('no deja crear sin lo mínimo, lo dice campo por campo y no envía nada', async () => {
    const s = carta(administrador());
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
    expect(await screen.findByText('Escribe el nombre del grupo')).toBeInTheDocument();
    expect(screen.getByText(/Agrega al menos una opción/)).toBeInTheDocument();
    expect(s.de('POST', '/carta/grupos-modificadores')).toHaveLength(0);
  });

  it('nace como una sola respuesta opcional y dice la regla mientras se escribe', async () => {
    carta(administrador());
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    expect(screen.getByRole('radio', { name: /Una sola/ })).toBeChecked();
    expect(screen.getByText('Elige 1, opcional')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Obligatorio' }));
    expect(screen.getByText('Elige 1, obligatorio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Varias/ }));
    expect(screen.getByText('Completa el mínimo y el máximo')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Máximo'), '3');
    expect(screen.getByText('Hasta 3, opcional')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Mínimo'));
    await userEvent.type(screen.getByLabelText('Mínimo'), '1');
    expect(screen.getByText('Elige de 1 a 3, obligatorio')).toBeInTheDocument();
  });

  it('solo se pueden ligar productos simples y activos', async () => {
    carta(administrador());
    renderApp('/carta/grupos/nuevo');
    const selector = await screen.findByLabelText('Producto ligado de la opción 1');
    await waitFor(() => expect(selector).toBeEnabled());
    const nombres = within(selector)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(nombres).toEqual(['Ninguno', 'Chaufa', 'Inca Kola', 'Lomo saltado']);
  });

  it('crea el grupo con clave de idempotencia, precio extra con 2 decimales y producto ligado, y pasa a su pantalla', async () => {
    const creado = grupo({
      id: G_NUEVO,
      nombre: 'Extras',
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      obligatorio: false,
      modificadores: [
        {
          id: 'd5000000-0000-4000-8000-000000000005',
          nombre: 'Huevo',
          precioExtra: '2.50',
          producto: null,
          orden: 1,
        },
        {
          id: 'd6000000-0000-4000-8000-000000000006',
          nombre: 'Gaseosa',
          precioExtra: '0.00',
          producto: { id: P_INCA, nombre: 'Inca Kola' },
          orden: 2,
        },
      ],
    });
    const s = carta(administrador(), {
      'POST /carta/grupos-modificadores': () => json(201, creado),
      [`GET /carta/grupos-modificadores/${G_NUEVO}`]: () => json(200, creado),
    });
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), '  Extras ');
    await userEvent.click(screen.getByRole('radio', { name: /Varias/ }));
    await userEvent.type(screen.getByLabelText('Máximo'), '2');
    await userEvent.type(screen.getByLabelText('Nombre de la opción 1'), 'Huevo');
    await userEvent.type(screen.getByLabelText('Precio extra de la opción 1'), '2.5');
    await userEvent.type(screen.getByLabelText('Nombre de la opción 2'), 'Gaseosa');
    const selector = screen.getByLabelText('Producto ligado de la opción 2');
    await waitFor(() => expect(selector).toBeEnabled());
    await userEvent.selectOptions(selector, P_INCA);
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));

    expect(await screen.findByText('Grupo creado')).toBeInTheDocument();
    const llamada = s.de('POST', '/carta/grupos-modificadores')[0];
    expect(llamada?.cuerpo).toEqual({
      nombre: 'Extras',
      seleccion: 'MULTIPLE',
      minimo: 0,
      maximo: 2,
      modificadores: [
        { nombre: 'Huevo', precioExtra: '2.50', productoId: null },
        { nombre: 'Gaseosa', precioExtra: '0.00', productoId: P_INCA },
      ],
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('un nombre repetido se dice en su campo y todo lo escrito se conserva', async () => {
    carta(administrador(), {
      'POST /carta/grupos-modificadores': () => json(409, { codigo: 'CONFLICTO', mensaje: 'x' }),
    });
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), 'Término de la carne');
    await userEvent.type(screen.getByLabelText('Nombre de la opción 1'), 'Medio');
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
    expect(
      await screen.findByText('Ya tienes un grupo con ese nombre. Usa otro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del grupo')).toHaveValue('Término de la carne');
    expect(screen.getByLabelText('Nombre de la opción 1')).toHaveValue('Medio');
  });

  it('agrega, ordena y quita opciones; Enter pasa a la siguiente y no envía el formulario', async () => {
    const s = carta(administrador());
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre de la opción 1'), 'Uno{Enter}');
    expect(screen.getByLabelText('Nombre de la opción 2')).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Nombre de la opción 2'), 'Dos{Enter}');
    // Es la última y tiene nombre: Enter agrega otra y le da el foco.
    expect(await screen.findByLabelText('Nombre de la opción 3')).toHaveFocus();
    expect(s.de('POST', '/carta/grupos-modificadores')).toHaveLength(0);
    expect(screen.getByText('3 de 50')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Bajar la opción 1' }));
    expect(screen.getByLabelText('Nombre de la opción 1')).toHaveValue('Dos');
    expect(screen.getByLabelText('Nombre de la opción 2')).toHaveValue('Uno');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la opción 1' }));
    expect(screen.getByLabelText('Nombre de la opción 1')).toHaveValue('Uno');
    expect(screen.getByText('2 de 50')).toBeInTheDocument();
  });

  it('un mínimo que no se puede cumplir se dice antes de enviar', async () => {
    const s = carta(administrador());
    renderApp('/carta/grupos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), 'Salsas');
    await userEvent.click(screen.getByRole('radio', { name: /Varias/ }));
    await userEvent.clear(screen.getByLabelText('Mínimo'));
    await userEvent.type(screen.getByLabelText('Mínimo'), '3');
    await userEvent.type(screen.getByLabelText('Máximo'), '3');
    await userEvent.type(screen.getByLabelText('Nombre de la opción 1'), 'Ají');
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
    expect(await screen.findByText(/opciones que agregaste \(1\)/)).toBeInTheDocument();
    expect(s.de('POST', '/carta/grupos-modificadores')).toHaveLength(0);
  });
});

describe('formulario de grupo: edición', () => {
  const ruta = `/carta/grupos-modificadores/${G_EXTRAS}`;

  it('carga el grupo y avisa que cambiarlo cambia todos los productos que lo usan', async () => {
    carta(administrador(), { [`GET ${ruta}`]: () => json(200, EXTRAS) });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    expect(await screen.findByRole('status', { name: 'Cargando el grupo' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Nombre del grupo')).toHaveValue('Extras del plato');
    const aviso = screen.getByText('Lo usan 2 productos').closest('[role="status"]');
    expect(aviso).toHaveTextContent('cambia en todos esos productos: Lomo saltado y Chaufa');
    expect(screen.getByRole('radio', { name: /Varias/ })).toBeChecked();
    expect(screen.getByLabelText('Máximo')).toHaveValue('3');
    expect(screen.getByLabelText('Precio extra de la opción 1')).toHaveValue('2.00');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('guarda solo lo que cambió', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, EXTRAS),
      [`PATCH ${ruta}`]: () => json(200, { ...EXTRAS, nombre: 'Extras' }),
    });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    const nombre = await screen.findByLabelText('Nombre del grupo');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Extras');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ nombre: 'Extras' });
    expect(screen.getByText(/Ya valen para los 2 productos que lo usan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('quitar una opción manda la lista nueva completa, con los ids de las que se quedan', async () => {
    const s = carta(administrador(), {
      [`GET /carta/grupos-modificadores/${G_TERMINO}`]: () => json(200, TERMINO),
      [`PATCH /carta/grupos-modificadores/${G_TERMINO}`]: () => json(200, TERMINO),
    });
    renderApp(`/carta/grupos/${G_TERMINO}`);
    await screen.findByLabelText('Nombre del grupo');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la opción 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(s.de('PATCH', `/carta/grupos-modificadores/${G_TERMINO}`)).toHaveLength(1),
    );
    expect(s.de('PATCH', `/carta/grupos-modificadores/${G_TERMINO}`)[0]?.cuerpo).toEqual({
      modificadores: [
        {
          id: 'd1000000-0000-4000-8000-000000000001',
          nombre: 'Medio',
          precioExtra: '0.00',
          productoId: null,
        },
      ],
    });
  });

  it('un grupo que no existe lo dice y no deja editar', async () => {
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    expect(await screen.findByText('No encontramos este grupo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre del grupo')).not.toBeInTheDocument();
  });

  it('desactivar un grupo sin productos pide confirmación y se puede reactivar', async () => {
    const libre = { ...EXTRAS, productos: [] };
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, libre),
      [`PATCH ${ruta}`]: ({ cuerpo }) =>
        json(200, { ...libre, activo: (cuerpo as { activo: boolean }).activo }),
    });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar grupo' }));
    const hoja = await screen.findByRole('dialog');
    expect(s.de('PATCH', ruta)).toHaveLength(0);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Desactivar grupo' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(1));
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ activo: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivar grupo' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(2));
    expect(s.de('PATCH', ruta)[1]?.cuerpo).toEqual({ activo: true });
  });

  it('desactivar un grupo en uso: la API responde EN_USO y se explica con los productos, con enlace a cada uno', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, EXTRAS),
      [`PATCH ${ruta}`]: () =>
        json(409, {
          codigo: 'EN_USO',
          mensaje: 'x',
          usadoEn: {
            combos: [{ id: P_LOMO, nombre: 'Lomo saltado' }],
            modificadores: [],
          },
        }),
    });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar grupo' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar grupo' }),
    );
    const aviso = (await screen.findByText('No se puede desactivar este grupo')).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(aviso).toHaveTextContent('Lo usan estos productos: Lomo saltado y Chaufa');
    expect(aviso).toHaveTextContent('Quítalo de cada uno y vuelve a intentar');
    expect(within(aviso).getByRole('link', { name: 'Lomo saltado' })).toHaveAttribute(
      'href',
      `/carta/productos/${P_LOMO}`,
    );
    expect(within(aviso).getByRole('link', { name: 'Chaufa' })).toBeInTheDocument();
    expect(s.de('PATCH', ruta)).toHaveLength(1);
  });

  it('sin conexión al guardar reintenta y no pierde lo escrito', async () => {
    let intentos = 0;
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, EXTRAS),
      [`PATCH ${ruta}`]: () =>
        ++intentos < 3
          ? json(503, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, { ...EXTRAS, nombre: 'Extras nuevos' }),
    });
    renderApp(`/carta/grupos/${G_EXTRAS}`);
    const nombre = await screen.findByLabelText('Nombre del grupo');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Extras nuevos');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', ruta)).toHaveLength(3);
  });
});

describe('modificadores dentro del producto', () => {
  const ruta = `/carta/productos/${P_LOMO}`;

  it('muestra los grupos del producto con su regla y cuántos otros productos los usan', async () => {
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, lomo([refDe(TERMINO), refDe(EXTRAS)])),
    });
    renderApp(ruta);
    const lista = await screen.findByRole('list', { name: 'Grupos de este producto' });
    // Los nombres salen con el producto; la regla y el uso, cuando llega la lista de grupos.
    await screen.findByText(/Elige 1, obligatorio/);
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Término de la carne');
    expect(filas[0]).toHaveTextContent('Elige 1, obligatorio · 2 opciones');
    expect(filas[0]).not.toHaveTextContent('También lo');
    expect(filas[1]).toHaveTextContent('Hasta 3, opcional');
    expect(filas[1]).toHaveTextContent('También lo usa 1 producto más');
  });

  it('sin grupos lo dice; al elegir, solo ofrece los activos que aún no tiene', async () => {
    carta(administrador(), { [`GET ${ruta}`]: () => json(200, lomo([refDe(TERMINO)])) });
    renderApp(ruta);
    await screen.findByRole('list', { name: 'Grupos de este producto' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    const ofrecidos = await screen.findByRole('list', { name: 'Grupos que puedes agregar' });
    expect(within(ofrecidos).getAllByRole('listitem')).toHaveLength(1);
    expect(within(ofrecidos).getByText('Extras del plato')).toBeInTheDocument();
    expect(within(ofrecidos).queryByText('Tamaño de la jarra')).not.toBeInTheDocument();
  });

  it('agrega un grupo y lo guarda con el producto, en orden', async () => {
    const original = lomo([refDe(TERMINO)]);
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, original),
      [`PATCH ${ruta}`]: () => json(200, { ...original, grupos: [refDe(TERMINO), refDe(EXTRAS)] }),
    });
    renderApp(ruta);
    await screen.findByRole('list', { name: 'Grupos de este producto' });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Extras del plato' }));
    expect(screen.getByText(/«Extras del plato» agregado/)).toBeInTheDocument();
    expect(s.de('PATCH', ruta)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ gruposModificadores: [G_TERMINO, G_EXTRAS] });
  });

  it('ordena con subir y bajar, y quita un grupo sin borrarlo', async () => {
    const original = lomo([refDe(TERMINO), refDe(EXTRAS)]);
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, original),
      [`PATCH ${ruta}`]: ({ cuerpo }) =>
        json(200, {
          ...original,
          grupos: (cuerpo as { gruposModificadores: string[] }).gruposModificadores.map((id) =>
            refDe(id === G_TERMINO ? TERMINO : EXTRAS),
          ),
        }),
    });
    renderApp(ruta);
    await screen.findByRole('list', { name: 'Grupos de este producto' });
    await userEvent.click(screen.getByRole('button', { name: 'Bajar Término de la carne' }));
    const lista = screen.getByRole('list', { name: 'Grupos de este producto' });
    expect(within(lista).getAllByRole('listitem')[0]).toHaveTextContent('Extras del plato');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(1));
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ gruposModificadores: [G_EXTRAS, G_TERMINO] });

    await userEvent.click(await screen.findByRole('button', { name: 'Quitar Extras del plato' }));
    expect(screen.getByText(/El grupo sigue existiendo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(2));
    expect(s.de('PATCH', ruta)[1]?.cuerpo).toEqual({ gruposModificadores: [G_TERMINO] });
    expect(s.de('PATCH', '/carta/grupos-modificadores')).toHaveLength(0);
  });

  it('crea un grupo sin salir del producto: queda agregado y se guarda con el producto', async () => {
    const nuevo = grupo({
      id: G_NUEVO,
      nombre: 'Guarnición',
      minimo: 0,
      obligatorio: false,
      modificadores: [
        {
          id: 'd7000000-0000-4000-8000-000000000007',
          nombre: 'Yuca',
          precioExtra: '0.00',
          producto: null,
          orden: 1,
        },
      ],
    });
    const original = lomo([]);
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, original),
      'POST /carta/grupos-modificadores': () => json(201, nuevo),
      [`PATCH ${ruta}`]: () => json(200, { ...original, grupos: [refDe(nuevo)] }),
    });
    renderApp(ruta);
    await screen.findByText('Este producto no tiene grupos. Agrega uno o crea uno nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Crear un grupo nuevo' }));
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), 'Guarnición');
    await userEvent.type(screen.getByLabelText('Nombre de la opción 1'), 'Yuca');
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
    expect(await screen.findByText(/creado y agregado a este producto/)).toBeInTheDocument();
    // Sigue en el producto, con el grupo en su lista.
    expect(screen.getByLabelText('Nombre')).toHaveValue('Lomo saltado');
    expect(
      within(screen.getByRole('list', { name: 'Grupos de este producto' })).getByText('Guarnición'),
    ).toBeInTheDocument();
    expect(
      s.de('POST', '/carta/grupos-modificadores')[0]?.cabeceras.get('Idempotency-Key'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(s.de('PATCH', ruta)).toHaveLength(1));
    expect(s.de('PATCH', ruta)[0]?.cuerpo).toEqual({ gruposModificadores: [G_NUEVO] });
  });

  it('edita un grupo sin salir del producto, con el aviso de que cambia todos los productos que lo usan', async () => {
    const s = carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, lomo([refDe(EXTRAS)])),
      [`PATCH /carta/grupos-modificadores/${G_EXTRAS}`]: () =>
        json(200, { ...EXTRAS, nombre: 'Extras' }),
    });
    renderApp(ruta);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Editar grupo Extras del plato' }),
    );
    const aviso = (await screen.findByText('Lo usan 2 productos')).closest('[role="status"]');
    expect(aviso).toHaveTextContent('Si lo cambias, cambia en todos esos productos');
    const nombre = screen.getByLabelText('Nombre del grupo');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Extras');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar grupo' }));
    expect(
      await screen.findByText(/Grupo «Extras» guardado. Ya vale para sus 2 productos/),
    ).toBeInTheDocument();
    expect(s.de('PATCH', `/carta/grupos-modificadores/${G_EXTRAS}`)[0]?.cuerpo).toEqual({
      nombre: 'Extras',
    });
    // El producto no tiene nada que guardar: el grupo ya se guardó por su lado.
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(s.de('PATCH', ruta)).toHaveLength(0);
  });

  it('un producto admite hasta 10 grupos y lo dice', async () => {
    const muchos = Array.from({ length: 10 }, (_, i) =>
      grupo({ id: `c9000000-0000-4000-8000-00000000000${i}`, nombre: `Grupo ${i}` }),
    );
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, lomo(muchos.map(refDe))),
      'GET /carta/grupos-modificadores': () => json(200, muchos),
    });
    renderApp(ruta);
    await screen.findByRole('list', { name: 'Grupos de este producto' });
    expect(screen.getByText(/hasta 10 grupos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar un grupo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Crear un grupo nuevo' })).toBeDisabled();
  });

  it('si no cargan los grupos lo dice y deja reintentar, sin bloquear el resto del producto', async () => {
    let falla = true;
    carta(administrador(), {
      [`GET ${ruta}`]: () => json(200, lomo([])),
      'GET /carta/grupos-modificadores': () =>
        falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, [EXTRAS]),
    });
    renderApp(ruta);
    expect(await screen.findByText('No pudimos cargar tus grupos')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Lomo saltado');
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.queryByText('No pudimos cargar tus grupos')).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    expect(
      await screen.findByRole('button', { name: 'Agregar Extras del plato' }),
    ).toBeInTheDocument();
  });

  it('un producto nuevo manda los grupos elegidos al crearse', async () => {
    const creado = { ...lomo([refDe(TERMINO)]), id: P_CHAUFA };
    const s = carta(administrador(), {
      'POST /carta/productos': () => json(201, creado),
      [`GET /carta/productos/${P_CHAUFA}`]: () => json(200, creado),
      [`GET /carta/productos/${P_CHAUFA}/sucursales`]: () => json(200, []),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Lomo saltado');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM);
    await userEvent.type(screen.getByLabelText('Precio con IGV'), '32.5');
    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST);
    await userEvent.click(screen.getByRole('radio', { name: /Por porciones/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar un grupo' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Agregar Término de la carne' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    await screen.findByText('Producto creado');
    expect(s.de('POST', '/carta/productos')[0]?.cuerpo).toMatchObject({
      gruposModificadores: [G_TERMINO],
    });
  });
});
