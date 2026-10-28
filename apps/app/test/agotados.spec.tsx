import type {
  CartaSucursalRespuesta,
  MenuDelDiaRespuesta,
  ProductoDeVenta,
  SesionRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol, type Rol } from '@restaurante/dominio';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeEquipo, guardarTokenDeSesion, tokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { avisosDeEnvio } from '../src/lib/envios-cancelados';
import { equipoCon, ID, json, renderApp, servidor, sesionDe, TOKEN_EQUIPO } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const E_COCINA = 'e1000000-0000-4000-8000-0000000000e1';
const E_BARRA = 'e2000000-0000-4000-8000-0000000000e2';
const F_ENTRADAS = 'f1000000-0000-4000-8000-0000000000f1';
const F_FONDOS = 'f2000000-0000-4000-8000-0000000000f2';
const F_BEBIDAS = 'f3000000-0000-4000-8000-0000000000f3';
const P_CEVICHE = 'a1000000-0000-4000-8000-0000000000a1';
const P_CAUSA = 'a2000000-0000-4000-8000-0000000000a2';
const P_LOMO = 'a3000000-0000-4000-8000-0000000000a3';
const P_CHICHA = 'a4000000-0000-4000-8000-0000000000a4';
const P_COMBO = 'a5000000-0000-4000-8000-0000000000a5';
const P_MENU = 'a6000000-0000-4000-8000-0000000000a6';
const G_TERMINO = 'b1000000-0000-4000-8000-0000000000b1';
const M_TERMINO = 'c1000000-0000-4000-8000-0000000000c1';
const RUTA = '/carta/sucursal';
const RUTA_AGOTADO = (id: string) => `/carta/sucursal/agotados/${id}`;

const sesionCocina = (): SesionRespuesta => {
  const rol: Rol = 'COCINA_BARRA';
  return sesionDe({
    esAdministrador: false,
    rol,
    permisos: permisosDeRol(rol),
    sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', rol }],
  });
};

function producto(parcial: Partial<ProductoDeVenta> & Pick<ProductoDeVenta, 'id' | 'nombre'>) {
  return {
    tipo: 'SIMPLE',
    descripcion: null,
    fotoUrl: null,
    precio: '28.00',
    seVendeSolo: true,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    estacionId: E_COCINA,
    tipoControlStock: 'SIN_CONTROL',
    agotado: null,
    vendible: true,
    motivo: null,
    grupos: [],
    componentes: [],
    ...parcial,
  } satisfies ProductoDeVenta as ProductoDeVenta;
}

const AGOTADO_HOY = {
  desde: '2026-10-29T15:00:00.000Z',
  hasta: 'FIN_DEL_DIA',
  origen: 'MANUAL',
} as const;

function vista(
  productos: Partial<Record<'entradas' | 'fondos' | 'bebidas', ProductoDeVenta[]>> = {},
) {
  const entradas = productos.entradas ?? [
    producto({ id: P_CEVICHE, nombre: 'Ceviche mixto' }),
    producto({ id: P_CAUSA, nombre: 'Causa limeña' }),
  ];
  const fondos = productos.fondos ?? [producto({ id: P_LOMO, nombre: 'Lomo saltado' })];
  const bebidas = productos.bebidas ?? [
    producto({ id: P_CHICHA, nombre: 'Chicha morada', estacionId: E_BARRA }),
  ];
  return {
    sucursalId: ID.sucursalA,
    diaOperativo: '2026-10-29',
    estaciones: [
      { id: E_COCINA, nombre: 'Cocina' },
      { id: E_BARRA, nombre: 'Barra' },
    ],
    familias: [
      { id: F_ENTRADAS, nombre: 'Entradas', productos: entradas },
      { id: F_FONDOS, nombre: 'Fondos', productos: fondos },
      { id: F_BEBIDAS, nombre: 'Bebidas', productos: bebidas },
    ].filter((f) => f.productos.length > 0),
  } satisfies CartaSucursalRespuesta;
}

type Extra = Parameters<typeof servidor>[0];

/**
 * Un servidor de la carta que se acuerda de los agotados: `GET /carta/sucursal` trae el `ETag` y 304 si
 * no cambió nada, `PUT` y `DELETE` cambian lo que el siguiente `GET` devuelve (como el de verdad). `extra`
 * reemplaza cualquier ruta (por ejemplo, para hacer fallar o demorar un `PUT`).
 */
function carta(contenido: () => CartaSucursalRespuesta, extra: Extra = {}) {
  let version = 1;
  const agotados = new Map<string, 'FIN_DEL_DIA' | 'REACTIVAR'>();
  const conAgotados = (): CartaSucursalRespuesta => {
    const base = contenido();
    return {
      ...base,
      familias: base.familias.map((f) => ({
        ...f,
        productos: f.productos.map((p) => {
          const hasta = agotados.get(p.id);
          return hasta
            ? {
                ...p,
                agotado: { ...AGOTADO_HOY, hasta },
                vendible: false,
                motivo: 'AGOTADO' as const,
              }
            : p;
        }),
      })),
    };
  };
  const rutas: Extra = {
    'GET /sesion': () => json(200, sesionCocina()),
    [`GET ${RUTA}`]: ({ cabeceras }) =>
      cabeceras.get('If-None-Match') === `"v${version}"`
        ? json(304, undefined, { ETag: `"v${version}"` })
        : json(200, conAgotados(), { ETag: `"v${version}"` }),
    [`GET /sucursales/${ID.sucursalA}`]: () => json(200, sucursal('05:00')),
  };
  for (const id of [P_CEVICHE, P_CAUSA, P_LOMO, P_CHICHA, P_COMBO, P_MENU]) {
    rutas[`PUT ${RUTA_AGOTADO(id)}`] = ({ cuerpo }) => {
      const hasta = (cuerpo as { hasta: 'FIN_DEL_DIA' | 'REACTIVAR' }).hasta;
      agotados.set(id, hasta);
      version += 1;
      return respuestaAgotado(id, hasta);
    };
    rutas[`DELETE ${RUTA_AGOTADO(id)}`] = () => {
      agotados.delete(id);
      version += 1;
      return json(204);
    };
  }
  const s = servidor({ ...rutas, ...extra });
  return {
    ...s,
    /** Algo cambió en el servidor (otro equipo marcó un agotado, por ejemplo). */
    cambiarEtag: () => (version += 1),
    agotadoDe: (id: string) => agotados.get(id),
    marcarDesdeOtroEquipo: (id: string, hasta: 'FIN_DEL_DIA' | 'REACTIVAR' = 'FIN_DEL_DIA') => {
      agotados.set(id, hasta);
      version += 1;
    },
  };
}

function sucursal(horaCorte: string) {
  return {
    id: ID.sucursalA,
    empresaId: ID.empresa,
    emisorId: '99999999-9999-4999-8999-999999999999',
    nombre: 'Miraflores',
    codigoEstablecimiento: '0001',
    direccion: 'Av. Larco 100',
    horario: [],
    whatsapp: null,
    horaCorte,
    creadoEn: '2026-10-01T00:00:00.000Z',
    actualizadoEn: '2026-10-01T00:00:00.000Z',
  };
}

const respuestaAgotado = (id: string, hasta: 'FIN_DEL_DIA' | 'REACTIVAR' = 'FIN_DEL_DIA') =>
  json(200, {
    productoId: id,
    sucursalId: ID.sucursalA,
    desde: '2026-10-29T15:00:00.000Z',
    hasta,
    diaOperativo: '2026-10-29',
    origen: 'MANUAL',
  });

/** La hora de Lima (HH:MM) dentro de `minutos`. */
function horaDeLimaEn(minutos: number): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return f.format(new Date(Date.now() + minutos * 60_000)).replace('24:', '00:');
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const filaDe = async (nombre: string) => {
  const interruptor = await screen.findByRole('switch', { name: `Agotado: ${nombre}` });
  return interruptor.closest('.ui-fila') as HTMLElement;
};

describe('Agotados: la lista', () => {
  it('es la primera sección de Disponibilidad y lista los productos por familia con su estación', async () => {
    carta(() => vista());
    renderApp('/disponibilidad');
    const entradas = await screen.findByRole('region', { name: 'Entradas' });
    expect(within(entradas).getByText('Ceviche mixto')).toBeInTheDocument();
    expect(within(entradas).getAllByText('Cocina')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'Bebidas' })).getByText('Barra'),
    ).toBeVisible();
    const secciones = screen.getByRole('group', { name: 'Secciones de disponibilidad' });
    expect(within(secciones).getByRole('button', { name: 'Agotados' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findAllByRole('switch', { name: /^Agotado: / })).toHaveLength(4);
    for (const interruptor of screen.getAllByRole('switch')) {
      expect(interruptor).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('muestra un esqueleto mientras carga y, si falla, un error con "Reintentar"', async () => {
    let falla = true;
    const s = carta(() => vista(), {
      [`GET ${RUTA}`]: () =>
        falla ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }) : json(200, vista()),
    });
    renderApp('/disponibilidad');
    expect(
      await screen.findByRole('status', { name: 'Cargando los productos' }),
    ).toBeInTheDocument();
    const aviso = (await screen.findByText('No pudimos cargar los productos')).closest(
      '[role="alert"]',
    )!;
    expect(aviso).toBeInTheDocument();
    falla = false;
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByRole('region', { name: 'Entradas' })).toBeInTheDocument();
    expect(s.de('GET', RUTA).length).toBeGreaterThan(1);
  });

  it('una sucursal sin productos lo dice', async () => {
    carta(() => ({ ...vista(), familias: [] }));
    renderApp('/disponibilidad');
    expect(
      await screen.findByText('Esta sucursal no tiene productos en la carta'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pide al Administrador o a un Cajero/)).toBeInTheDocument();
  });

  it('pinta como agotado lo que la vista trae agotado, con palabras', async () => {
    carta(() =>
      vista({
        entradas: [
          producto({
            id: P_CEVICHE,
            nombre: 'Ceviche mixto',
            agotado: AGOTADO_HOY,
            vendible: false,
            motivo: 'AGOTADO',
          }),
          producto({
            id: P_CAUSA,
            nombre: 'Causa limeña',
            agotado: { ...AGOTADO_HOY, hasta: 'REACTIVAR' },
            vendible: false,
            motivo: 'AGOTADO',
          }),
        ],
      }),
    );
    renderApp('/disponibilidad');
    const ceviche = await filaDe('Ceviche mixto');
    expect(within(ceviche).getByText('Agotado hoy')).toBeInTheDocument();
    expect(within(ceviche).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(
      within(await filaDe('Causa limeña')).getByText('Agotado hasta que lo reactiven'),
    ).toBeInTheDocument();
  });
});

describe('Agotados: motivos de "no vendible" con palabras', () => {
  it('dice qué componente falta, qué grupo no tiene opciones y que el menú no está armado', async () => {
    carta(() =>
      vista({
        fondos: [
          producto({
            id: P_COMBO,
            nombre: 'Combo marino',
            tipo: 'COMBO',
            estacionId: null,
            vendible: false,
            motivo: 'COMPONENTE_NO_DISPONIBLE',
            componentes: [
              {
                productoId: P_CEVICHE,
                nombre: 'Ceviche mixto',
                cantidad: 1,
                estacionId: E_COCINA,
                disponible: false,
              },
              {
                productoId: P_CHICHA,
                nombre: 'Chicha morada',
                cantidad: 1,
                estacionId: E_BARRA,
                disponible: true,
              },
            ],
          }),
          producto({
            id: P_LOMO,
            nombre: 'Lomo saltado',
            vendible: false,
            motivo: 'OPCIONES_INSUFICIENTES',
            grupos: [
              {
                id: G_TERMINO,
                nombre: 'Término',
                seleccion: 'UNICA',
                minimo: 1,
                maximo: 1,
                obligatorio: true,
                modificadores: [
                  {
                    id: M_TERMINO,
                    nombre: 'Medio',
                    precioExtra: '0.00',
                    productoId: null,
                    disponible: false,
                  },
                ],
              },
            ],
          }),
          producto({
            id: P_MENU,
            nombre: 'Menú criollo',
            tipo: 'MENU_DEL_DIA',
            estacionId: null,
            vendible: false,
            motivo: 'MENU_SIN_ARMAR',
          }),
        ],
      }),
    );
    renderApp('/disponibilidad');
    const combo = await filaDe('Combo marino');
    expect(within(combo).getByText('No se puede vender')).toBeInTheDocument();
    expect(within(combo).getByText('Ceviche mixto no está disponible.')).toBeInTheDocument();
    expect(within(combo).getByText(/Combo · Cocina, Barra/)).toBeInTheDocument();
    expect(
      within(await filaDe('Lomo saltado')).getByText(
        'En «Término» hacen falta 1 opción y no hay ninguna.',
      ),
    ).toBeInTheDocument();
    const menu = await filaDe('Menú criollo');
    expect(within(menu).getByText('El menú de hoy no está armado.')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Armar el menú' })).toHaveAttribute(
      'href',
      '/disponibilidad?ver=menu',
    );
  });
});

describe('Agotados: filtros', () => {
  it('"Solo agotados" deja los agotados y cuenta cuántos hay', async () => {
    carta(() =>
      vista({
        entradas: [
          producto({
            id: P_CEVICHE,
            nombre: 'Ceviche mixto',
            agotado: AGOTADO_HOY,
            vendible: false,
            motivo: 'AGOTADO',
          }),
          producto({ id: P_CAUSA, nombre: 'Causa limeña' }),
        ],
      }),
    );
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Solo agotados' }));
    expect(screen.getByText('Ceviche mixto')).toBeInTheDocument();
    expect(screen.queryByText('Causa limeña')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Fondos' })).not.toBeInTheDocument();
    expect(screen.getByText('1 de 4 productos · 1 agotado')).toBeInTheDocument();
  });

  it('sin agotados dice que todo se puede vender y deja volver a ver todos', async () => {
    carta(() => vista());
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.click(screen.getByRole('button', { name: 'Solo agotados' }));
    expect(screen.getByText('No hay productos agotados')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver todos los productos' }));
    expect(screen.getByRole('region', { name: 'Entradas' })).toBeInTheDocument();
  });

  it('el filtro por estación se recuerda en este equipo y un almacenamiento bloqueado no rompe nada', async () => {
    carta(() => vista());
    const { unmount } = renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Barra' }));
    expect(screen.getByText('Chicha morada')).toBeInTheDocument();
    expect(screen.queryByText('Ceviche mixto')).not.toBeInTheDocument();
    expect(localStorage.getItem(`restaurante.disponibilidad.estacion.${ID.empresa}`)).toBe(E_BARRA);
    unmount();

    // Al volver a entrar, la estación sigue elegida.
    renderApp('/disponibilidad');
    await screen.findByText('Chicha morada');
    expect(screen.getByRole('button', { name: 'Barra' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Ceviche mixto')).not.toBeInTheDocument();
  });

  it('con el almacenamiento bloqueado el filtro funciona sin recordarse', async () => {
    // Solo el almacenamiento del equipo (`localStorage`): la sesión vive en `sessionStorage` y debe seguir.
    const leer = Storage.prototype.getItem;
    const escribir = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      clave: string,
    ) {
      if (this === localStorage) throw new DOMException('bloqueado', 'SecurityError');
      return leer.call(this, clave);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      clave: string,
      valor: string,
    ) {
      if (this === localStorage) throw new DOMException('lleno', 'QuotaExceededError');
      escribir.call(this, clave, valor);
    });
    carta(() => vista());
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.click(screen.getByRole('button', { name: 'Barra' }));
    expect(screen.getByText('Chicha morada')).toBeInTheDocument();
    expect(screen.queryByText('Ceviche mixto')).not.toBeInTheDocument();
  });

  it('una estación recordada que ya no existe se ignora', async () => {
    localStorage.setItem(
      `restaurante.disponibilidad.estacion.${ID.empresa}`,
      'e9000000-0000-4000-8000-0000000000e9',
    );
    carta(() => vista());
    renderApp('/disponibilidad');
    expect(await screen.findByText('Ceviche mixto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('un combo cuenta en las estaciones de sus componentes', async () => {
    carta(() =>
      vista({
        fondos: [
          producto({
            id: P_COMBO,
            nombre: 'Combo marino',
            tipo: 'COMBO',
            estacionId: null,
            componentes: [
              {
                productoId: P_CHICHA,
                nombre: 'Chicha morada',
                cantidad: 1,
                estacionId: E_BARRA,
                disponible: true,
              },
            ],
          }),
        ],
      }),
    );
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.click(screen.getByRole('button', { name: 'Barra' }));
    expect(screen.getByText('Combo marino')).toBeInTheDocument();
    expect(screen.queryByText('Lomo saltado')).not.toBeInTheDocument();
  });

  it('la búsqueda aparece con muchos productos y filtra sin importar tildes ni mayúsculas', async () => {
    const muchos = Array.from({ length: 9 }, (_, i) =>
      producto({
        id: `a9000000-0000-4000-8000-00000000000${i}`,
        nombre: i === 3 ? 'Ají de gallina' : `Plato ${i}`,
      }),
    );
    carta(() => vista({ entradas: muchos }));
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'AJI');
    expect(screen.getByText('Ají de gallina')).toBeInTheDocument();
    expect(screen.queryByText('Plato 1')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'zzz');
    expect(screen.getByText('No encontramos productos')).toBeInTheDocument();
  });

  it('con pocos productos no hay búsqueda', async () => {
    carta(() => vista());
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('Agotados: marcar y reactivar', () => {
  it('marcar abre la hoja con "Solo por hoy" elegido; al confirmar la fila cambia al instante y se puede deshacer', async () => {
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    const s = carta(() => vista(), {
      [`PUT ${RUTA_AGOTADO(P_CEVICHE)}`]: async () => {
        await compuerta;
        s.marcarDesdeOtroEquipo(P_CEVICHE);
        return respuestaAgotado(P_CEVICHE);
      },
    });
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));

    const hoja = await screen.findByRole('dialog', { name: 'Marcar «Ceviche mixto» como agotado' });
    expect(within(hoja).getByRole('radio', { name: /Solo por hoy/ })).toBeChecked();
    expect(within(hoja).getByText(/Vuelve solo a las 05:00/)).toBeInTheDocument();
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(0);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Marcar como agotado' }));

    // Al instante, antes de que el servidor responda.
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(fila).getByText('Agotado hoy')).toBeInTheDocument();
    const aviso = screen.getByText('Ceviche mixto está agotado').closest('[role="status"]')!;
    expect(within(aviso as HTMLElement).getByRole('button', { name: 'Deshacer' })).toBeEnabled();

    liberar();
    await waitFor(() => expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(1));
    const put = s.de('PUT', RUTA_AGOTADO(P_CEVICHE))[0]!;
    expect(put.cuerpo).toEqual({ hasta: 'FIN_DEL_DIA' });
    expect(put.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('"Hasta que lo reactive" manda ese valor', async () => {
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    await userEvent.click(within(await filaDe('Causa limeña')).getByRole('switch'));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('radio', { name: /Hasta que lo reactive/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Marcar como agotado' }));
    expect(
      within(await filaDe('Causa limeña')).getByText('Agotado hasta que lo reactiven'),
    ).toBeInTheDocument();
    await waitFor(() => expect(s.de('PUT', RUTA_AGOTADO(P_CAUSA))).toHaveLength(1));
    expect(s.de('PUT', RUTA_AGOTADO(P_CAUSA))[0]?.cuerpo).toEqual({ hasta: 'REACTIVAR' });
  });

  it('cancelar la hoja no cambia nada ni manda nada', async () => {
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(s.llamadas.filter((l) => l.metodo === 'PUT')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });

  it('"Deshacer" reactiva el producto', async () => {
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Marcar como agotado',
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
    await waitFor(() => expect(s.de('DELETE', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(1));
    // Primero se marca y recién después se reactiva: el orden de las escrituras se respeta.
    const orden = s.llamadas.filter((l) => l.ruta === RUTA_AGOTADO(P_CEVICHE)).map((l) => l.metodo);
    expect(orden).toEqual(['PUT', 'DELETE']);
    expect(
      s.de('DELETE', RUTA_AGOTADO(P_CEVICHE))[0]?.cabeceras.get('Idempotency-Key'),
    ).toBeTruthy();
  });

  it('el aviso "Deshacer" se va solo a los 5 segundos', async () => {
    carta(() => vista());
    renderApp('/disponibilidad');
    await userEvent.click(within(await filaDe('Ceviche mixto')).getByRole('switch'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Marcar como agotado',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument(),
      { timeout: 6500 },
    );
  }, 12_000);

  it('apagar el interruptor de un agotado lo reactiva al instante, sin hoja, y se puede deshacer', async () => {
    const s = carta(() => vista());
    s.marcarDesdeOtroEquipo(P_CEVICHE);
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(fila).getByRole('switch'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(within(fila).queryByText('Agotado hoy')).not.toBeInTheDocument();
    expect(screen.getByText('Ceviche mixto vuelve a estar disponible')).toBeInTheDocument();
    await waitFor(() => expect(s.de('DELETE', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(1));

    // Deshacer vuelve a marcar con la misma duración que tenía.
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(1));
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))[0]?.cuerpo).toEqual({ hasta: 'FIN_DEL_DIA' });
  });

  it('la hoja avisa qué combos dejarán de venderse', async () => {
    carta(() =>
      vista({
        fondos: [
          producto({
            id: P_COMBO,
            nombre: 'Combo marino',
            tipo: 'COMBO',
            estacionId: null,
            componentes: [
              {
                productoId: P_CEVICHE,
                nombre: 'Ceviche mixto',
                cantidad: 1,
                estacionId: E_COCINA,
                disponible: true,
              },
            ],
          }),
        ],
      }),
    );
    renderApp('/disponibilidad');
    await userEvent.click(within(await filaDe('Ceviche mixto')).getByRole('switch'));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/Dejará de poder venderse: Combo marino/)).toBeInTheDocument();
  });

  it('si el servidor rechaza el cambio, la fila vuelve a como estaba y se dice por qué', async () => {
    carta(() => vista(), {
      [`PUT ${RUTA_AGOTADO(P_CEVICHE)}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Marcar como agotado',
      }),
    );
    const aviso = (await screen.findByText('No pudimos guardar el cambio')).closest(
      '[role="alert"]',
    )!;
    expect(aviso).toHaveTextContent(
      'Ceviche mixto: No tienes permiso para marcar agotados en esta sucursal. Lo dejamos como estaba.',
    );
    await waitFor(() =>
      expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'false'),
    );
    expect(within(fila).queryByText('Agotado hoy')).not.toBeInTheDocument();
  });

  it('sin conexión el cambio se ve, queda "Pendiente de envío" y sale solo con la misma clave', async () => {
    let sinRed = true;
    let llamadasDeEspera = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++llamadasDeEspera === 7) await compuerta;
    });
    const s = carta(() => vista(), {
      [`PUT ${RUTA_AGOTADO(P_CEVICHE)}`]: () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        s.marcarDesdeOtroEquipo(P_CEVICHE);
        return respuestaAgotado(P_CEVICHE);
      },
    });
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Marcar como agotado',
      }),
    );
    expect(await within(fila).findByText('Pendiente de envío')).toBeInTheDocument();
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();

    sinRed = false;
    liberar();
    await waitFor(() =>
      expect(within(fila).queryByText('Pendiente de envío')).not.toBeInTheDocument(),
    );
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    const claves = new Set(
      s.de('PUT', RUTA_AGOTADO(P_CEVICHE)).map((l) => l.cabeceras.get('Idempotency-Key')),
    );
    expect(claves.size).toBe(1);
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE)).length).toBeGreaterThan(2);
  });
});

describe('Agotados: un cambio pendiente no sale con otra sesión (trazabilidad de autor)', () => {
  /** Cocina/Barra con dos sucursales: la barra de la sesión deja cambiar de una a otra. */
  const sesionConDosSucursales = (activa: 'A' | 'B' = 'A') =>
    sesionDe({
      ...sesionCocina(),
      sucursal:
        activa === 'A'
          ? { id: ID.sucursalA, nombre: 'Miraflores' }
          : { id: ID.sucursalB, nombre: 'Surco' },
      sucursales: [
        { id: ID.sucursalA, nombre: 'Miraflores', rol: 'COCINA_BARRA' },
        { id: ID.sucursalB, nombre: 'Surco', rol: 'COCINA_BARRA' },
      ],
    });

  /** Sin red hasta la espera larga del envío (la 7.ª): ahí la prueba cambia la sesión y luego la libera. */
  function conEnvioPendiente(extra: Record<string, () => Response> = {}) {
    let rondas = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++rondas === 7) await compuerta;
    });
    const s = carta(() => vista(), {
      'GET /sesion': () => json(200, sesionConDosSucursales()),
      [`PUT ${RUTA_AGOTADO(P_CEVICHE)}`]: () => {
        throw new TypeError('Failed to fetch');
      },
      ...extra,
    });
    return { s, liberar };
  }

  async function marcarCevicheSinRed() {
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    await userEvent.click(within(fila).getByRole('switch'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Marcar como agotado',
      }),
    );
    expect(await within(fila).findByText('Pendiente de envío')).toBeInTheDocument();
    return fila;
  }

  it('si cambia de sucursal mientras espera, no se envía y la pantalla lo dice', async () => {
    const { s, liberar } = conEnvioPendiente({
      'PUT /sesion/sucursal': () => json(200, sesionConDosSucursales('B')),
    });
    const fila = await marcarCevicheSinRed();
    const antes = s.de('PUT', RUTA_AGOTADO(P_CEVICHE)).length;

    await userEvent.click(screen.getByRole('button', { name: /Miraflores/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Elige tu sucursal' });
    await userEvent.click(within(hoja).getByRole('button', { name: /Surco/ }));
    await waitFor(() => expect(s.de('PUT', '/sesion/sucursal')).toHaveLength(1));
    liberar();

    const aviso = (await screen.findByText('No pudimos guardar el cambio')).closest(
      '[role="alert"]',
    )!;
    expect(aviso).toHaveTextContent(
      'Ceviche mixto: No se envió: cambiaste de sucursal. Lo dejamos como estaba.',
    );
    // No salió ni un intento más, y la pantalla sigue ahí: no hace falta el aviso global.
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(antes);
    expect(avisosDeEnvio.leer()).toBeNull();
    expect(within(fila).queryByText('Pendiente de envío')).not.toBeInTheDocument();
  });

  it('si la persona cambia de usuario mientras espera, no se envía y el aviso global lo dice en la pantalla de PIN', async () => {
    guardarTokenDeEquipo(ID.empresa, TOKEN_EQUIPO);
    const { s, liberar } = conEnvioPendiente({
      'DELETE /sesion': () => json(204),
      'GET /equipo': () =>
        json(
          200,
          equipoCon([{ nombre: 'Marta Pérez' }, { usuarioId: ID.otro, nombre: 'Lucía Torres' }]),
        ),
    });
    await marcarCevicheSinRed();
    const antes = s.de('PUT', RUTA_AGOTADO(P_CEVICHE)).length;

    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar usuario' }));
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
    liberar();

    const aviso = await screen.findByRole('dialog', {
      name: 'No se envió: cambiaste de usuario.',
    });
    expect(aviso).toHaveTextContent('Hay que volver a hacer ese cambio.');
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(antes);
    await userEvent.click(within(aviso as HTMLElement).getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(avisosDeEnvio.leer()).toBeNull();
  });

  it('si la sesión se cierra (Salir) mientras espera, el aviso global dice que no se envió', async () => {
    const { s, liberar } = conEnvioPendiente({ 'DELETE /sesion': () => json(204) });
    await marcarCevicheSinRed();
    const antes = s.de('PUT', RUTA_AGOTADO(P_CEVICHE)).length;

    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Marta Pérez' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeInTheDocument();
    liberar();

    expect(await screen.findByText('No se envió: se cerró la sesión.')).toBeInTheDocument();
    expect(s.de('PUT', RUTA_AGOTADO(P_CEVICHE))).toHaveLength(antes);
  });
});

describe('Agotados: actualización', () => {
  it('al volver a la pestaña pide la vista con If-None-Match y en segundo plano; con 304 no cambia nada', async () => {
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    const primera = s.de('GET', RUTA)[0]!;
    expect(primera.cabeceras.get('If-None-Match')).toBeNull();
    expect(primera.cabeceras.get('X-Actividad')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(s.de('GET', RUTA)).toHaveLength(2));
    const segunda = s.de('GET', RUTA)[1]!;
    expect(segunda.cabeceras.get('If-None-Match')).toBe('"v1"');
    expect(segunda.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    expect(screen.getByRole('region', { name: 'Entradas' })).toBeInTheDocument();
  });

  it('cuando otro equipo marca un agotado, la siguiente consulta lo trae', async () => {
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    const fila = await filaDe('Ceviche mixto');
    expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    s.marcarDesdeOtroEquipo(P_CEVICHE);
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(within(fila).getByRole('switch')).toHaveAttribute('aria-checked', 'true'),
    );
    expect(within(fila).getByText('Agotado hoy')).toBeInTheDocument();
    expect(s.de('GET', RUTA)[1]?.cabeceras.get('If-None-Match')).toBe('"v1"');
  });

  it('refresca cada 15 segundos', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const s = carta(() => vista());
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(s.de('GET', RUTA)).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(s.de('GET', RUTA)).toHaveLength(2));
    expect(s.de('GET', RUTA)[1]?.cabeceras.get('X-Actividad')).toBe('segundo-plano');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(s.de('GET', RUTA)).toHaveLength(3));
  });

  it('si la actualización falla, deja la lista que ya tenía y avisa que puede estar vieja', async () => {
    let cae = false;
    const s = carta(() => vista(), {
      [`GET ${RUTA}`]: () =>
        cae
          ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' })
          : json(200, vista(), { ETag: '"v1"' }),
    });
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    cae = true;
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    const aviso = (await screen.findByText('No pudimos actualizar la lista')).closest(
      '[role="status"]',
    )!;
    expect(aviso).toHaveTextContent('Lo que ves puede estar desactualizado');
    expect(screen.getByRole('region', { name: 'Entradas' })).toBeInTheDocument();
    expect(s.de('GET', RUTA).length).toBeGreaterThan(1);
  });
});

describe('Agotados: cerca de la hora de corte', () => {
  const conAgotadoPorHoy = () =>
    vista({
      entradas: [
        producto({
          id: P_CEVICHE,
          nombre: 'Ceviche mixto',
          agotado: AGOTADO_HOY,
          vendible: false,
          motivo: 'AGOTADO',
        }),
      ],
    });

  it('a menos de una hora avisa que los agotados "solo por hoy" vuelven', async () => {
    const corte = horaDeLimaEn(30);
    carta(conAgotadoPorHoy, {
      [`GET /sucursales/${ID.sucursalA}`]: () => json(200, sucursal(corte)),
    });
    renderApp('/disponibilidad');
    const aviso = (await screen.findByText(`A las ${corte} empieza otro día`)).closest(
      '[role="status"]',
    )!;
    expect(aviso).toHaveTextContent('«Ceviche mixto» volverá a estar disponible');
    expect(aviso).toHaveTextContent('Hasta que lo reactive');
  });

  it('lejos de la hora de corte, o sin agotados de "solo por hoy", no avisa', async () => {
    carta(conAgotadoPorHoy, {
      [`GET /sucursales/${ID.sucursalA}`]: () => json(200, sucursal(horaDeLimaEn(240))),
    });
    const { unmount } = renderApp('/disponibilidad');
    await filaDe('Ceviche mixto');
    expect(screen.queryByText(/empieza otro día/)).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    carta(() => vista(), {
      [`GET /sucursales/${ID.sucursalA}`]: () => json(200, sucursal(horaDeLimaEn(30))),
    });
    renderApp('/disponibilidad');
    await screen.findByRole('region', { name: 'Entradas' });
    expect(screen.queryByText(/empieza otro día/)).not.toBeInTheDocument();
  });

  it('si no llega la hora de corte, la hoja habla del siguiente día y no se rompe nada', async () => {
    carta(() => vista(), {
      [`GET /sucursales/${ID.sucursalA}`]: () =>
        json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    renderApp('/disponibilidad');
    await userEvent.click(within(await filaDe('Ceviche mixto')).getByRole('switch'));
    const hoja = await screen.findByRole('dialog');
    expect(
      within(hoja).getByText('Vuelve solo cuando empieza el siguiente día de la sucursal.'),
    ).toBeInTheDocument();
  });
});

describe('Menú del día: por qué un plato no está disponible', () => {
  const HOY = '2026-10-29';
  const M_HUANCAINA = 'd1000000-0000-4000-8000-0000000000d1';
  const menu: MenuDelDiaRespuesta = {
    productoId: P_MENU,
    nombre: 'Menú criollo',
    precio: '12.00',
    dia: HOY,
    grupos: [
      {
        id: G_TERMINO,
        nombre: 'Entrada',
        minimo: 1,
        maximo: 1,
        opciones: [
          {
            modificadorId: M_HUANCAINA,
            nombre: 'Ceviche de la casa',
            precioExtra: '0.00',
            producto: { id: P_CEVICHE, nombre: 'Ceviche mixto' },
            elegida: true,
            disponible: false,
          },
        ],
      },
    ],
  };

  it('dice el motivo del producto ligado en lugar de "No disponible hoy"', async () => {
    carta(
      () =>
        vista({
          entradas: [
            producto({
              id: P_CEVICHE,
              nombre: 'Ceviche mixto',
              agotado: AGOTADO_HOY,
              vendible: false,
              motivo: 'AGOTADO',
            }),
          ],
        }),
      { 'GET /carta/sucursal/menu-del-dia': () => json(200, [menu]) },
    );
    renderApp('/disponibilidad?ver=menu');
    const caja = await screen.findByRole('checkbox', { name: /Ceviche de la casa/ });
    await waitFor(() => expect(caja.closest('label')).toHaveTextContent('Agotado hoy'));
    expect(caja.closest('label')).not.toHaveTextContent('No disponible hoy');
  });

  it('si el producto ya no está en la vista de la sucursal, lo dice; si la vista no llega, queda el texto de siempre', async () => {
    carta(() => vista({ entradas: [producto({ id: P_CAUSA, nombre: 'Causa limeña' })] }), {
      'GET /carta/sucursal/menu-del-dia': () => json(200, [menu]),
    });
    const { unmount } = renderApp('/disponibilidad?ver=menu');
    const caja = await screen.findByRole('checkbox', { name: /Ceviche de la casa/ });
    await waitFor(() =>
      expect(caja.closest('label')).toHaveTextContent('No está en la carta de esta sucursal'),
    );
    unmount();
    vi.unstubAllGlobals();

    carta(() => vista(), {
      'GET /carta/sucursal/menu-del-dia': () => json(200, [menu]),
      [`GET ${RUTA}`]: () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    });
    renderApp('/disponibilidad?ver=menu');
    const otra = await screen.findByRole('checkbox', { name: /Ceviche de la casa/ });
    expect(otra.closest('label')).toHaveTextContent('No disponible hoy');
  });
});
