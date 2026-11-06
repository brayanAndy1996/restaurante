import type { ComprobanteDetalle, PanelComprobantes } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { alertasDe, detalleDe, envioDe, itemDePanel } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 006-caja-cobro, criterio 174 en la interfaz (pruebas no protegidas del panel de comprobantes y su detalle).

const MODULOS = ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] as const;
const API_PANEL = '/facturacion/comprobantes';
const A = uuid(7001);
const B = uuid(7002);
const C = uuid(7003);

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CONTEOS = { POR_ENVIAR: 1, ENVIADO: 0, ACEPTADO: 7, RECHAZADO: 2, ANULADO: 1 };

function pagina(extra: Partial<PanelComprobantes> = {}): PanelComprobantes {
  return {
    conteos: CONTEOS,
    siguiente: null,
    items: [
      itemDePanel({ id: A, numero: 'B001-00000124', cliente: 'Rosa Quispe' }),
      itemDePanel({
        id: B,
        tipo: 'FACTURA',
        numero: 'F001-00000030',
        estado: 'RECHAZADO',
        alerta: 'RECHAZADO',
        total: '236.00',
        cliente: 'Inversiones Sol S.A.C.',
      }),
      itemDePanel({
        id: C,
        numero: 'B001-00000125',
        estado: 'POR_ENVIAR',
        simulado: true,
        total: '18.00',
      }),
    ],
    ...extra,
  };
}

function montar(
  rol: Parameters<typeof sesionDeRol>[0] = 'SUPERVISOR',
  extra: Record<string, Parameters<typeof servidor>[0][string]> = {},
  sesion = sesionDeRol(rol, { modulos: [...MODULOS] }),
) {
  const estado = { pagina: pagina() };
  const s = servidor({
    'GET /sesion': () => json(200, sesion),
    [`GET ${API_PANEL}`]: () => json(200, estado.pagina),
    [`GET ${API_ALERTAS}`]: () => json(200, alertasDe()),
    ...extra,
  });
  return Object.assign(s, { estado });
}
const API_ALERTAS = '/facturacion/alertas';
const consultas = (s: ReturnType<typeof montar>) => s.de('GET', API_PANEL);

/** Los parámetros de la última consulta del panel. */
async function parametrosDe(s: ReturnType<typeof montar>) {
  await waitFor(() => expect(consultas(s).length).toBeGreaterThan(0));
  const [, texto = ''] = (
    s.simulado.mock.calls.filter(([u]) => String(u).includes(API_PANEL)).at(-1)?.[0] as string
  ).split('?');
  return new URLSearchParams(texto);
}

describe('El panel de comprobantes (criterio 174)', () => {
  it('lista los comprobantes con su estado, total y alertas, y los conteos como segmentos', async () => {
    montar();
    renderApp('/caja/comprobantes');
    const lista = await screen.findByRole('list', { name: 'Comprobantes' });
    const filas = within(lista).getAllByRole('link');
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveAccessibleName('Boleta B001-00000124, Aceptado, S/\u00a068.50');
    expect(
      within(filas[1]!).getByText('Factura · Inversiones Sol S.A.C.', { exact: false }),
    ).toBeVisible();
    expect(within(filas[1]!).getByText('Falta emitir otro')).toBeVisible();
    expect(within(filas[2]!).getByText('Simulado')).toBeVisible();

    const estados = screen.getByRole('group', { name: 'Estado del comprobante' });
    expect(within(estados).getByRole('button', { name: 'Todos (11)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(estados).getByRole('button', { name: 'Rechazado (2)' })).toBeVisible();
    expect(within(estados).getByRole('button', { name: 'Aceptado (7)' })).toBeVisible();
  });

  it('elegir un estado vuelve a pedir la lista con ese estado', async () => {
    const s = montar();
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    s.estado.pagina = pagina({ items: [pagina().items[1]!] });
    await userEvent.click(screen.getByRole('button', { name: 'Rechazado (2)' }));
    await waitFor(async () => expect((await parametrosDe(s)).get('estado')).toBe('RECHAZADO'));
    expect(await screen.findAllByRole('link', { name: /F001-00000030/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Rechazado (2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('el enlace del aviso de alertas llega con el filtro «Con alerta» puesto', async () => {
    const s = montar();
    renderApp('/caja/comprobantes?alerta=1');
    await screen.findByRole('list', { name: 'Comprobantes' });
    expect((await parametrosDe(s)).get('alerta')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /Solo con alerta/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Quitar filtros' })).toBeVisible();
  });

  it('buscar por número manda el texto después de una pequeña espera', async () => {
    const s = montar();
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    await userEvent.type(
      screen.getByRole('searchbox', { name: /Buscar por número o documento/ }),
      'B001-124',
    );
    await waitFor(async () => expect((await parametrosDe(s)).get('texto')).toBe('B001-124'));
    // Una sola consulta con el texto completo: no una por cada letra.
    const conTexto = s.simulado.mock.calls.filter(([u]) => String(u).includes('texto='));
    expect(conTexto).toHaveLength(1);
  });

  it('pide el tipo y el rango de fechas elegidos', async () => {
    const s = montar();
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    await userEvent.click(screen.getByRole('button', { name: /Más filtros/ }));
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'FACTURA');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2026-11-05');
    await waitFor(async () => {
      const p = await parametrosDe(s);
      expect(p.get('tipo')).toBe('FACTURA');
      expect(p.get('desde')).toBe('2026-11-01');
      expect(p.get('hasta')).toBe('2026-11-05');
    });
  });

  it('un rango de más de 93 días lo dice y no pregunta a la API', async () => {
    const s = montar();
    renderApp('/caja/comprobantes?desde=2026-06-01&hasta=2026-11-05');
    expect(await screen.findByText('Elige un rango de hasta 93 días.')).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(consultas(s)).toHaveLength(0);
  });

  it('«Ver más» pide la página siguiente con su cursor y junta las listas', async () => {
    const s = montar('SUPERVISOR');
    s.estado.pagina = pagina({ siguiente: 'cursor-2', items: [pagina().items[0]!] });
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    s.estado.pagina = pagina({ siguiente: null, items: [pagina().items[1]!] });
    await userEvent.click(screen.getByRole('button', { name: 'Ver más comprobantes' }));
    expect(await screen.findByRole('link', { name: /F001-00000030/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /B001-00000124/ })).toBeVisible();
    expect((await parametrosDe(s)).get('cursor')).toBe('cursor-2');
    expect(screen.queryByRole('button', { name: 'Ver más comprobantes' })).toBeNull();
  });

  it('sin resultados lo dice y sin filtros habla de los últimos 7 días', async () => {
    const s = montar();
    s.estado.pagina = pagina({
      items: [],
      conteos: { POR_ENVIAR: 0, ENVIADO: 0, ACEPTADO: 0, RECHAZADO: 0, ANULADO: 0 },
    });
    renderApp('/caja/comprobantes');
    expect(await screen.findByText('No se emitió ninguno en los últimos 7 días.')).toBeVisible();
  });

  it('si no carga, lo dice con «Reintentar»', async () => {
    const s = montar();
    s.poner(`GET ${API_PANEL}`, () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' }));
    renderApp('/caja/comprobantes');
    expect(await screen.findByText('No pudimos cargar los comprobantes')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  it('el evento comprobante.estado actualiza la lista', async () => {
    const s = montar();
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    expect(screen.queryByRole('link', { name: /B001-00000125, Aceptado/ })).toBeNull();
    s.estado.pagina = pagina({
      items: [
        pagina().items[0]!,
        pagina().items[1]!,
        itemDePanel({
          id: C,
          numero: 'B001-00000125',
          estado: 'ACEPTADO',
          simulado: true,
          total: '18.00',
        }),
      ],
    });
    act(() =>
      socketVigente()?.desdeElServidor('comprobante.estado', {
        comprobanteId: C,
        estado: 'ACEPTADO',
        sucursalId: ID.sucursalA,
      }),
    );
    expect(await screen.findByRole('link', { name: /B001-00000125, Aceptado/ })).toBeVisible();
  });
});

describe('Quién entra al panel y desde dónde', () => {
  it('el Cajero entra a Caja › Comprobantes y no tiene filtro de sucursal', async () => {
    montar('CAJERO');
    renderApp('/caja/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    await userEvent.click(screen.getByRole('button', { name: /Más filtros/ }));
    expect(screen.queryByLabelText('Sucursal')).toBeNull();
  });

  it('el Mozo no entra: vuelve al inicio', async () => {
    const s = montar('MOZO');
    renderApp('/caja/comprobantes');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Comprobantes' })).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(consultas(s)).toHaveLength(0);
  });

  it('sin el módulo de Facturación en el plan no entra nadie', async () => {
    const s = montar('SUPERVISOR', {}, sesionDeRol('SUPERVISOR', { modulos: ['SALON', 'CAJA'] }));
    renderApp('/caja/comprobantes');
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByRole('list', { name: 'Comprobantes' })).toBeNull();
    expect(consultas(s)).toHaveLength(0);
  });

  it('el Administrador lo encuentra en Ajustes › Comprobantes y filtra por sucursal', async () => {
    const s = montar(
      'ADMINISTRADOR',
      {},
      {
        ...sesionDeRol('ADMINISTRADOR', { modulos: [...MODULOS] }),
        sucursales: [
          { id: ID.sucursalA, nombre: 'Miraflores', rol: 'ADMINISTRADOR' },
          { id: ID.sucursalB, nombre: 'Surco', rol: 'ADMINISTRADOR' },
        ],
      },
    );
    renderApp('/administracion/comprobantes');
    await screen.findByRole('list', { name: 'Comprobantes' });
    expect(screen.getByRole('button', { name: 'Comprobantes', pressed: true })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Más filtros/ }));
    await userEvent.selectOptions(screen.getByLabelText('Sucursal'), ID.sucursalB);
    await waitFor(async () => expect((await parametrosDe(s)).get('sucursalId')).toBe(ID.sucursalB));
  });

  it('«Comprobantes» solo está en Ajustes si el plan incluye Facturación', async () => {
    montar('ADMINISTRADOR', {}, sesionDeRol('ADMINISTRADOR', { modulos: ['SALON', 'CAJA'] }));
    renderApp('/administracion/usuarios');
    await screen.findByRole('group', { name: 'Secciones de Ajustes' });
    expect(screen.queryByRole('button', { name: 'Comprobantes' })).toBeNull();
  });

  it('desde Caja, con o sin turno, hay un enlace a Comprobantes', async () => {
    montar('SUPERVISOR', {
      'GET /turnos/mio': () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay turno' }),
      'GET /cajas': () => json(200, []),
    });
    renderApp('/caja');
    expect(await screen.findByRole('link', { name: 'Comprobantes' })).toHaveAttribute(
      'href',
      '/caja/comprobantes',
    );
  });
});

describe('El detalle de un comprobante (criterio 174)', () => {
  const RUTA = `/facturacion/comprobantes/${B}`;
  const rechazado = (extra: Partial<ComprobanteDetalle> = {}) =>
    detalleDe({
      id: B,
      tipo: 'FACTURA',
      numero: 'F001-00000030',
      estado: 'RECHAZADO',
      serie: 'F001',
      correlativo: 30,
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Inversiones Sol S.A.C.',
        direccion: null,
      },
      sunat: {
        codigo: '2800',
        mensaje: 'El RUC del receptor no existe',
        observaciones: [{ codigo: '4252', mensaje: 'El domicilio fiscal no coincide' }],
        hash: null,
      },
      marcas: {
        enviadoEn: '2026-11-06T00:11:00.000Z',
        aceptadoEn: null,
        rechazadoEn: '2026-11-06T00:12:00.000Z',
        anuladoEn: null,
      },
      envio: envioDe({
        estado: 'TERMINADO',
        intentos: 2,
        proximoIntentoEn: null,
        ultimoResultado: 'RECHAZADO',
      }),
      intentos: [
        {
          numero: 2,
          operacion: 'CONSULTAR',
          iniciadoEn: '2026-11-06T00:12:00.000Z',
          terminadoEn: '2026-11-06T00:12:01.000Z',
          resultado: 'RECHAZADO',
          codigo: '2800',
          mensaje: 'El RUC del receptor no existe',
        },
        {
          numero: 1,
          operacion: 'EMITIR',
          iniciadoEn: '2026-11-06T00:11:00.000Z',
          terminadoEn: '2026-11-06T00:11:02.000Z',
          resultado: 'ERROR_TRANSPORTE',
          codigo: null,
          mensaje: null,
        },
      ],
      ...extra,
    });

  it('muestra el motivo del rechazo, las observaciones, el envío y cada intento', async () => {
    montar('SUPERVISOR', { [`GET ${RUTA}`]: () => json(200, rechazado()) });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByText('Rechazado: El RUC del receptor no existe')).toBeVisible();
    const sunat = screen.getByRole('region', { name: 'Respuesta de SUNAT' });
    expect(within(sunat).getByText('2800')).toBeVisible();
    expect(within(sunat).getByText('4252: El domicilio fiscal no coincide')).toBeVisible();
    const envio = screen.getByRole('region', { name: 'Envío' });
    expect(within(envio).getByText('Terminado')).toBeVisible();
    const intentos = within(envio).getByRole('list', { name: 'Intentos de envío' });
    expect(within(intentos).getAllByRole('listitem')).toHaveLength(2);
    expect(within(intentos).getByText('No hubo conexión')).toBeVisible();
    expect(within(intentos).getByText(/Consulta ·/)).toBeVisible();
    // Terminado: ya no se reintenta.
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
  });

  it('«Reintentar el envío» manda el reintento con su clave de idempotencia y lo confirma', async () => {
    const estado = {
      detalle: rechazado({
        estado: 'POR_ENVIAR',
        sunat: null,
        marcas: undefined,
        intentos: [],
        envio: envioDe({
          estado: 'DETENIDO',
          intentos: 6,
          ultimoResultado: 'ERROR_TRANSPORTE',
          ultimoError: 'Sin conexión con el PSE',
        }),
      }),
    };
    const s = montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, estado.detalle),
      [`POST ${RUTA}/reintento`]: () => json(202, envioDe({ estado: 'PENDIENTE', intentos: 6 })),
    });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByText('El envío a SUNAT se detuvo')).toBeVisible();
    expect(screen.getByText('Sin conexión con el PSE')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar el envío' }));
    expect(await screen.findByText('Pedimos reintentar el envío')).toBeVisible();
    const pedidos = s.de('POST', `${RUTA}/reintento`);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('si el envío ya terminó (409), lo dice y vuelve a leer el comprobante', async () => {
    const estado = { pedido: false };
    const s = montar('SUPERVISOR', {
      [`GET ${RUTA}`]: () =>
        json(
          200,
          estado.pedido
            ? rechazado({
                estado: 'ACEPTADO',
                sunat: null,
                envio: envioDe({ estado: 'TERMINADO' }),
              })
            : rechazado({
                estado: 'ENVIADO',
                sunat: null,
                envio: envioDe({ estado: 'ESPERANDO_RESPUESTA' }),
              }),
        ),
      [`POST ${RUTA}/reintento`]: () => {
        estado.pedido = true;
        return json(409, { codigo: 'ENVIO_TERMINADO', mensaje: 'El envío ya terminó' });
      },
    });
    renderApp(`/caja/comprobantes/${B}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar el envío' }));
    expect(
      await screen.findByText('Este comprobante ya tiene su respuesta. Actualizamos su estado.'),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reintentar el envío' })).toBeNull(),
    );
    expect(await screen.findByText('Aceptado por SUNAT')).toBeVisible();
    expect(s.de('POST', `${RUTA}/reintento`)).toHaveLength(1);
  });

  it('el evento comprobante.estado cambia el estado del detalle sin recargar', async () => {
    const estado = {
      detalle: rechazado({
        estado: 'ENVIADO',
        sunat: null,
        envio: envioDe({ estado: 'ESPERANDO_RESPUESTA' }),
      }),
    };
    montar('SUPERVISOR', { [`GET ${RUTA}`]: () => json(200, estado.detalle) });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByText('Enviando a SUNAT…')).toBeVisible();
    estado.detalle = rechazado({
      estado: 'ACEPTADO',
      sunat: null,
      envio: envioDe({ estado: 'TERMINADO' }),
    });
    act(() =>
      socketVigente()?.desdeElServidor('comprobante.estado', {
        comprobanteId: B,
        estado: 'ACEPTADO',
        sucursalId: ID.sucursalA,
      }),
    );
    expect(await screen.findByText('Aceptado por SUNAT')).toBeVisible();
  });

  it('enlaza el comprobante que lo reemplaza y vuelve al panel con los filtros', async () => {
    montar('SUPERVISOR', {
      [`GET ${RUTA}`]: () =>
        json(200, rechazado({ reemplazadoPor: { id: C, numero: 'F001-00000031' } })),
    });
    renderApp({ pathname: `/caja/comprobantes/${B}`, state: { volver: '?estado=RECHAZADO' } });
    const enlace = await screen.findByRole('link', { name: 'F001-00000031' });
    expect(enlace).toHaveAttribute('href', `/caja/comprobantes/${C}`);
    expect(screen.getByRole('link', { name: 'Volver a Comprobantes' })).toHaveAttribute(
      'href',
      '/caja/comprobantes?estado=RECHAZADO',
    );
  });

  it('un comprobante de otro turno dice que no es de tus turnos', async () => {
    montar('CAJERO', { [`GET ${RUTA}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'No' }) });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByText('Este comprobante no es de tus turnos.')).toBeVisible();
  });
});
