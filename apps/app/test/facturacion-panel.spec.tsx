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

describe('«Emitir otro» desde el detalle de un rechazado (criterio 134)', () => {
  const RUTA = `/facturacion/comprobantes/${B}`;
  const NUEVO = uuid(7010);
  const RUC = '20100070970';
  const rechazado = (extra: Partial<ComprobanteDetalle> = {}) =>
    detalleDe({
      id: B,
      tipo: 'FACTURA',
      numero: 'F001-00000030',
      estado: 'RECHAZADO',
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20512345679',
        nombre: 'Inversiones Sol S.A.C.',
        direccion: 'Jr. Los Alamos 450',
      },
      sunat: {
        codigo: '2800',
        mensaje: 'El RUC del receptor no existe',
        observaciones: [],
        hash: null,
      },
      envio: envioDe({ estado: 'TERMINADO', ultimoResultado: 'RECHAZADO' }),
      ...extra,
    });
  const emitido = (extra = {}) =>
    detalleDe({
      id: NUEVO,
      tipo: 'FACTURA',
      numero: 'F001-00000031',
      estado: 'POR_ENVIAR',
      reemplazaA: { id: B, numero: 'F001-00000030' },
      ...extra,
    });
  const respuestaDeReemision = () => ({
    comprobante: emitido(),
    impresion: 'SIN_IMPRESORA' as const,
    trabajoId: null,
  });

  it('el rechazado ofrece «Emitir otro»; un aceptado o uno ya reemplazado, no', async () => {
    montar('CAJERO', { [`GET ${RUTA}`]: () => json(200, rechazado()) });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByRole('button', { name: 'Emitir otro' })).toBeVisible();
  });

  it('un comprobante aceptado no ofrece «Emitir otro»', async () => {
    montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, rechazado({ estado: 'ACEPTADO', sunat: null })),
    });
    renderApp(`/caja/comprobantes/${B}`);
    await screen.findByText('Aceptado por SUNAT');
    expect(screen.queryByRole('button', { name: 'Emitir otro' })).toBeNull();
  });

  it('un rechazado que ya tiene reemplazo no ofrece «Emitir otro» y enlaza al nuevo', async () => {
    montar('CAJERO', {
      [`GET ${RUTA}`]: () =>
        json(200, rechazado({ reemplazadoPor: { id: NUEVO, numero: 'F001-00000031' } })),
    });
    renderApp(`/caja/comprobantes/${B}`);
    expect(await screen.findByRole('link', { name: 'F001-00000031' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Emitir otro' })).toBeNull();
  });

  it('abre el formulario con el cliente del rechazado, deja corregirlo y emite con su clave de idempotencia', async () => {
    const s = montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, rechazado()),
      [`GET /facturacion/comprobantes/${NUEVO}`]: () => json(200, emitido()),
      [`POST ${RUTA}/reemision`]: () => json(201, respuestaDeReemision()),
    });
    renderApp(`/caja/comprobantes/${B}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Emitir otro' }));
    expect(await screen.findByRole('heading', { name: 'Emitir otro comprobante' })).toBeVisible();
    // Parte de lo que tenía el rechazado.
    expect(screen.getByLabelText('RUC')).toHaveValue('20512345679');
    expect(screen.getByLabelText('Razón social')).toHaveValue('Inversiones Sol S.A.C.');
    expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Jr. Los Alamos 450');
    expect(screen.getByRole('button', { name: 'Factura', pressed: true })).toBeVisible();

    // El RUC estaba mal: se corrige y se emite.
    await userEvent.clear(screen.getByLabelText('RUC'));
    await userEvent.type(screen.getByLabelText('RUC'), RUC);
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));

    expect(await screen.findByText('Comprobante nuevo emitido')).toBeVisible();
    expect(screen.getByText('Factura F001-00000031')).toBeVisible();
    expect(screen.getByText('Sin impresora de caja')).toBeVisible();
    const pedidos = s.de('POST', `${RUTA}/reemision`);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.cuerpo).toEqual({
      tipo: 'FACTURA',
      cliente: {
        tipoDocumento: 'RUC',
        numero: RUC,
        nombre: 'Inversiones Sol S.A.C.',
        direccion: 'Jr. Los Alamos 450',
      },
    });
    expect(pedidos[0]?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('link', { name: 'Ver el comprobante nuevo' })).toHaveAttribute(
      'href',
      `/caja/comprobantes/${NUEVO}`,
    );
  });

  describe('con el padrón de RUC (criterios 140 y 176)', () => {
    const delPadron = (extra: Record<string, unknown> = {}) => ({
      ruc: RUC,
      razonSocial: 'Supermercados Peruanos S.A.',
      direccion: 'Av. Principal 123, Lima',
      estado: 'ACTIVO',
      condicion: 'HABIDO',
      activo: true,
      habido: true,
      padronAl: '2026-11-05T09:00:00.000Z',
      ...extra,
    });
    const montarConPadron = (padron: () => Response) =>
      montar('CAJERO', {
        [`GET ${RUTA}`]: () => json(200, rechazado()),
        [`GET /padron/ruc/${RUC}`]: padron,
        [`POST ${RUTA}/reemision`]: () => json(201, respuestaDeReemision()),
      });
    async function corregirElRuc() {
      renderApp(`/caja/comprobantes/${B}?emitir=1`);
      await userEvent.clear(await screen.findByLabelText('RUC'));
      await userEvent.type(screen.getByLabelText('RUC'), RUC);
    }

    it('al corregir el RUC llena la razón social y la dirección del padrón, que se pueden corregir', async () => {
      const s = montarConPadron(() => json(200, delPadron()));
      await corregirElRuc();
      await waitFor(() =>
        expect(screen.getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
      );
      expect(screen.getByLabelText('Dirección fiscal')).toHaveValue('Av. Principal 123, Lima');
      await userEvent.clear(screen.getByLabelText('Dirección fiscal'));
      await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Av. Nueva 9, Lima');
      await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
      await screen.findByText('Comprobante nuevo emitido');
      expect(s.de('POST', `${RUTA}/reemision`)[0]?.cuerpo).toEqual({
        tipo: 'FACTURA',
        cliente: {
          tipoDocumento: 'RUC',
          numero: RUC,
          nombre: 'Supermercados Peruanos S.A.',
          direccion: 'Av. Nueva 9, Lima',
        },
      });
    });

    it('con un RUC de baja no emite sin «Emitir igual»; con la marca, emite', async () => {
      const s = montarConPadron(() =>
        json(200, delPadron({ estado: 'BAJA DE OFICIO', activo: false })),
      );
      await corregirElRuc();
      expect(
        await screen.findByText(
          'Este RUC figura como BAJA DE OFICIO / HABIDO en el padrón de SUNAT del 05/11',
        ),
      ).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
      expect(await screen.findByText('Marca «Emitir igual» o corrige el RUC.')).toBeVisible();
      expect(s.de('POST', `${RUTA}/reemision`)).toHaveLength(0);

      await userEvent.click(screen.getByRole('checkbox', { name: 'Emitir igual' }));
      await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
      await screen.findByText('Comprobante nuevo emitido');
      expect(s.de('POST', `${RUTA}/reemision`)).toHaveLength(1);
    });

    it('con el padrón caído (503) lo dice y deja emitir con lo escrito', async () => {
      const s = montarConPadron(() =>
        json(503, { codigo: 'PADRON_NO_DISPONIBLE', mensaje: 'El padrón no está disponible' }),
      );
      await corregirElRuc();
      expect(await screen.findByText('No se pudo consultar el padrón')).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
      await screen.findByText('Comprobante nuevo emitido');
      expect(s.de('POST', `${RUTA}/reemision`)).toHaveLength(1);
    });
  });

  it('se puede cambiar a boleta: el cliente pasa a ser opcional y el tipo viaja corregido', async () => {
    const s = montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, rechazado()),
      [`POST ${RUTA}/reemision`]: () => json(201, respuestaDeReemision()),
    });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    await userEvent.click(await screen.findByRole('button', { name: 'Boleta' }));
    // Una boleta de S/ 68.50 no exige cliente: con los campos vacíos se emite sin él.
    await userEvent.clear(screen.getByLabelText('Número de RUC'));
    await userEvent.clear(screen.getByLabelText('Nombre del cliente'));
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
    await screen.findByText('Comprobante nuevo emitido');
    expect(s.de('POST', `${RUTA}/reemision`)[0]?.cuerpo).toEqual({ tipo: 'BOLETA' });
  });

  it('una factura sin RUC válido no se manda y dice qué corregir', async () => {
    const s = montar('CAJERO', { [`GET ${RUTA}`]: () => json(200, rechazado()) });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    await userEvent.clear(await screen.findByLabelText('RUC'));
    await userEvent.type(screen.getByLabelText('RUC'), '20512345679');
    await userEvent.clear(screen.getByLabelText('Dirección fiscal'));
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
    expect(await screen.findByText('Escribe un RUC válido de 11 dígitos')).toBeVisible();
    expect(screen.getByText('Escribe la dirección fiscal')).toBeVisible();
    expect(s.de('POST', `${RUTA}/reemision`)).toHaveLength(0);
  });

  it('con un 409 YA_REEMPLAZADO lleva al comprobante nuevo y lo explica', async () => {
    const s = montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, rechazado()),
      [`GET /facturacion/comprobantes/${NUEVO}`]: () => json(200, emitido()),
      [`POST ${RUTA}/reemision`]: () =>
        json(409, {
          codigo: 'YA_REEMPLAZADO',
          mensaje: 'Ya tiene reemplazo',
          comprobanteId: NUEVO,
        }),
    });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    await userEvent.clear(await screen.findByLabelText('RUC'));
    await userEvent.type(screen.getByLabelText('RUC'), RUC);
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));

    expect(await screen.findByRole('heading', { name: 'Factura F001-00000031' })).toBeVisible();
    expect(screen.getByText('Ya habían emitido el reemplazo')).toBeVisible();
    expect(s.de('GET', `/facturacion/comprobantes/${NUEVO}`).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'F001-00000030' })).toBeVisible();
    expect(s.de('POST', `${RUTA}/reemision`)).toHaveLength(1);
  });

  it('una nota de crédito rechazada se emite igual, sin pedir cliente', async () => {
    const s = montar('CAJERO', {
      [`GET ${RUTA}`]: () =>
        json(200, rechazado({ tipo: 'NOTA_CREDITO_BOLETA', numero: 'BC01-00000003' })),
      [`POST ${RUTA}/reemision`]: () => json(201, respuestaDeReemision()),
    });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    expect(await screen.findByText(/Se emitirá otra nota de crédito de boleta/)).toBeVisible();
    expect(screen.queryByLabelText('RUC')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Tipo de comprobante' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
    await screen.findByText('Comprobante nuevo emitido');
    expect(s.de('POST', `${RUTA}/reemision`)[0]?.cuerpo).toEqual({ tipo: 'NOTA_CREDITO_BOLETA' });
  });

  it('un emisor del Nuevo RUS solo emite boletas y lo dice', async () => {
    montar('CAJERO', {
      [`GET ${RUTA}`]: () =>
        json(
          200,
          rechazado({
            tipo: 'BOLETA',
            numero: 'B001-00000030',
            cliente: null,
            emisor: { ruc: RUC, razonSocial: 'Pollería Rus', regimen: 'NUEVO_RUS' },
          }),
        ),
    });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    expect(await screen.findByText(/solo emite boletas, por su régimen tributario/)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Tipo de comprobante' })).toBeNull();
  });

  it('si la caja no tiene serie, lo dice con la salida y el formulario sigue abierto', async () => {
    montar('CAJERO', {
      [`GET ${RUTA}`]: () => json(200, rechazado()),
      [`POST ${RUTA}/reemision`]: () =>
        json(409, { codigo: 'SIN_SERIE', mensaje: 'Sin serie activa' }),
    });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    await userEvent.clear(await screen.findByLabelText('RUC'));
    await userEvent.type(screen.getByLabelText('RUC'), RUC);
    await userEvent.click(screen.getByRole('button', { name: 'Emitir comprobante' }));
    expect(await screen.findByText(/no tiene una serie activa de ese tipo/)).toBeVisible();
    expect(screen.getByLabelText('RUC')).toHaveValue(RUC);
    expect(screen.getByRole('button', { name: 'Emitir comprobante' })).toBeEnabled();
  });

  it('«Cancelar» cierra el formulario y deja el detalle como estaba', async () => {
    montar('CAJERO', { [`GET ${RUTA}`]: () => json(200, rechazado()) });
    renderApp(`/caja/comprobantes/${B}?emitir=1`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Emitir otro comprobante' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Emitir otro' })).toBeVisible();
  });
});
