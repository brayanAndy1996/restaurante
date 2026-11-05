import type {
  CajaRespuesta,
  MovimientoRespuesta,
  ReporteCaja,
  SesionRespuesta,
  TurnoRespuesta,
} from '@restaurante/contratos';
import type { Modulo } from '@restaurante/dominio';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, type Manejador } from './ayudas';
import { sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 24 a 35 y 108 a 110, 116 en la interfaz (pruebas no protegidas de la pantalla de
// caja: abrir, movimientos, reporte X y cierre con conteo a ciegas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const PLAN: Modulo[] = ['SALON', 'COCINA', 'CAJA'];
const EMISOR = uuid(900);
const ABIERTO_EN = '2026-11-04T23:02:00.000Z'; // 18:02 en Lima

const caja = (n: number, nombre: string, extra: Partial<CajaRespuesta> = {}): CajaRespuesta => ({
  id: uuid(100 + n),
  sucursalId: ID.sucursalA,
  nombre,
  activa: true,
  impresora: null,
  series: [{ tipo: 'BOLETA', serie: 'B001', ultimoNumero: 0, activa: true, emisorId: EMISOR }],
  turnoAbierto: null,
  ...extra,
});

const turno = (extra: Partial<TurnoRespuesta> = {}): TurnoRespuesta => ({
  id: uuid(300),
  caja: { id: uuid(101), nombre: 'Caja 1' },
  responsable: { id: ID.usuario, nombre: 'Marta Pérez' },
  estado: 'ABIERTO',
  abiertoEn: ABIERTO_EN,
  diaOperativo: '2026-11-04',
  fondo: '200.00',
  cerradoEn: null,
  cerradoPor: null,
  ...extra,
});

const MEDIOS = ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'] as const;

function reporte(t: TurnoRespuesta, extra: Partial<ReporteCaja> = {}): ReporteCaja {
  return {
    turno: t,
    generadoEn: '2026-11-05T00:45:00.000Z',
    fondo: t.fondo,
    ventas: {
      total: '310.14',
      cantidad: 5,
      porTipo: [{ tipo: 'BOLETA', cantidad: 5, total: '310.14' }],
      porMedio: MEDIOS.map((medio) => ({
        medio,
        cantidad: medio === 'EFECTIVO' ? 2 : 1,
        monto: medio === 'EFECTIVO' ? '102.50' : '69.20',
      })),
      descuentos: '0.00',
      cortesias: '0.00',
      igv: '44.84',
      icbper: '4.00',
      redondeos: '0.04',
      vueltos: '47.50',
    },
    movimientos: { ingresos: '20.00', egresos: '15.50', lista: [] },
    esperado: MEDIOS.map((medio) => ({ medio, monto: medio === 'EFECTIVO' ? '307.00' : '69.20' })),
    ...extra,
  };
}

const movimiento = (n: number, extra: Partial<MovimientoRespuesta> = {}): MovimientoRespuesta => ({
  id: uuid(500 + n),
  tipo: 'EGRESO',
  monto: '15.50',
  motivo: 'Hielo',
  creadoEn: '2026-11-05T00:10:00.000Z',
  creadoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
  ...extra,
});

const conflicto = (codigo: string, mensaje: string, estado = 409, extra: object = {}) =>
  json(estado, { codigo, mensaje, ...extra });

interface Datos {
  sesion?: SesionRespuesta;
  turno?: TurnoRespuesta | null;
  cajas?: CajaRespuesta[];
  movimientos?: MovimientoRespuesta[];
  cierre?: Manejador;
  abrir?: Manejador;
  movimiento?: Manejador;
}

/** API de mentira con memoria: abre el turno, guarda los movimientos y entrega el X con ellos. */
function api(datos: Datos = {}, extra: Record<string, Manejador> = {}) {
  let actual = datos.turno ?? null;
  const movimientos = [...(datos.movimientos ?? [])];
  const cajas = datos.cajas ?? [caja(1, 'Caja 1'), caja(2, 'Caja 2')];
  const s = servidor({
    'GET /sesion': () => json(200, datos.sesion ?? sesionDeRol('CAJERO', { modulos: PLAN })),
    'GET /turnos/mio': () =>
      actual ? json(200, actual) : conflicto('NO_ENCONTRADO', 'No hay turno', 404),
    'GET /cajas': () => json(200, cajas),
    'POST /turnos': async (pedido) => {
      if (datos.abrir) {
        const respuesta = await datos.abrir(pedido);
        if (respuesta.status >= 400) return respuesta;
      }
      const c = pedido.cuerpo as { id: string; cajaId: string; fondo: string };
      const elegida = cajas.find((x) => x.id === c.cajaId);
      actual = turno({
        id: c.id,
        caja: { id: c.cajaId, nombre: elegida?.nombre ?? 'Caja' },
        fondo: c.fondo,
      });
      return json(201, actual);
    },
    'GET /turnos/*/reporte': () =>
      actual
        ? json(
            200,
            reporte(actual, {
              movimientos: { ingresos: '20.00', egresos: '15.50', lista: movimientos },
            }),
          )
        : conflicto('NO_ENCONTRADO', 'No existe', 404),
    'POST /turnos/*/movimientos': async (pedido) => {
      if (datos.movimiento) {
        const respuesta = await datos.movimiento(pedido);
        if (respuesta.status >= 400) return respuesta;
      }
      const c = pedido.cuerpo as {
        id: string;
        tipo: 'INGRESO' | 'EGRESO';
        monto: string;
        motivo: string;
      };
      const nuevo = movimiento(movimientos.length + 1, { ...c });
      movimientos.push(nuevo);
      return json(201, nuevo);
    },
    'POST /turnos/*/cierre': async (pedido) => {
      if (!datos.cierre) return conflicto('ERROR_INTERNO', 'Sin manejador', 500);
      const respuesta = await datos.cierre(pedido);
      if (respuesta.status < 400) actual = null;
      return respuesta;
    },
    ...extra,
  });
  return s;
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });
const campo = (nombre: string | RegExp) => screen.getByLabelText(nombre);

describe('/caja sin turno: abrir caja (criterios 24, 25 y 109)', () => {
  it('lista las cajas con su estado y no deja elegir la que otra persona tiene abierta', async () => {
    api({
      cajas: [
        caja(1, 'Caja 1'),
        caja(2, 'Caja 2', {
          turnoAbierto: {
            id: uuid(310),
            responsable: { id: uuid(31), nombre: 'Ana' },
            abiertoEn: ABIERTO_EN,
          },
        }),
      ],
    });
    renderApp('/caja');
    const grupo = await screen.findByRole('group', { name: 'Caja que vas a abrir' });
    const libre = within(grupo).getByRole('radio', { name: /Caja 1/ });
    expect(libre).toBeEnabled();
    expect(within(grupo).getByText('Libre')).toBeInTheDocument();
    const ocupada = within(grupo).getByRole('radio', { name: /Caja 2/ });
    expect(ocupada).toBeDisabled();
    expect(within(grupo).getByText(/Abierta por Ana desde las 18:02/)).toBeInTheDocument();
    // Con una sola caja libre, ya viene elegida.
    expect(libre).toBeChecked();
  });

  it('abre la caja con el fondo: manda un id propio, la clave de idempotencia, y pasa a Mi turno', async () => {
    const s = api();
    renderApp('/caja');
    await userEvent.click(await screen.findByRole('radio', { name: /Caja 2/ }));
    await userEvent.type(campo('Fondo inicial'), '200');
    await userEvent.click(boton('Abrir caja'));

    expect(await screen.findByText('Turno abierto')).toBeInTheDocument();
    const llamada = s.de('POST', '/turnos')[0];
    expect(llamada?.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cajaId: uuid(102),
      fondo: '200.00',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(screen.getByText('Caja 2')).toBeInTheDocument();
    expect(screen.getByText(/las 18:02 · Marta Pérez/)).toBeInTheDocument();
    expect(screen.getByText('S/ 200.00')).toBeInTheDocument();
  });

  it('recuerda en el equipo la caja y el último fondo, y ofrece el fondo como atajo sin escribirlo solo', async () => {
    api();
    const primera = renderApp('/caja');
    await userEvent.click(await screen.findByRole('radio', { name: /Caja 2/ }));
    await userEvent.type(campo('Fondo inicial'), '150.5');
    await userEvent.click(boton('Abrir caja'));
    await screen.findByText('Turno abierto');
    primera.unmount();

    api(); // otra sesión del mismo equipo, sin turno abierto
    renderApp('/caja');
    expect(await screen.findByRole('radio', { name: /Caja 2/ })).toBeChecked();
    expect(campo('Fondo inicial')).toHaveValue('');
    await userEvent.click(boton('Usar S/\u00a0150.50, como la última vez'));
    expect(campo('Fondo inicial')).toHaveValue('150.50');
  });

  it('pide el fondo y la caja antes de enviar: no sale ninguna llamada', async () => {
    const s = api();
    renderApp('/caja');
    await screen.findByRole('group', { name: 'Caja que vas a abrir' });
    await userEvent.click(boton('Abrir caja'));
    expect(await screen.findByText('Elige la caja que vas a abrir')).toBeInTheDocument();
    expect(
      screen.getByText('Escribe el fondo inicial. Si empiezas sin dinero, escribe 0.00'),
    ).toBeInTheDocument();
    expect(s.de('POST', '/turnos')).toHaveLength(0);
  });

  it('un fondo de cero es válido', async () => {
    const s = api({ cajas: [caja(1, 'Caja 1')] });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Fondo inicial'), '0');
    await userEvent.click(boton('Abrir caja'));
    await screen.findByText('Turno abierto');
    expect(s.de('POST', '/turnos')[0]?.cuerpo).toMatchObject({ fondo: '0.00' });
  });

  it('con la sucursal suspendida lo dice con el texto de 002 y no deja abrir', async () => {
    api({
      sesion: {
        ...sesionDeRol('ADMINISTRADOR', { modulos: PLAN }),
        avisoSuscripcion: {
          sucursales: [
            {
              sucursalId: ID.sucursalA,
              nombre: 'Miraflores',
              estado: 'SUSPENDIDA',
              vencimiento: '2026-10-01',
              suspensionDesde: '2026-10-08',
              diasRestantesGracia: null,
            },
          ],
        },
      },
    });
    renderApp('/caja');
    // El aviso de la pantalla (el banner global dice lo mismo arriba de todo).
    expect(await screen.findByText('La sucursal está suspendida')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Abrir caja' })).toBeDisabled();
  });

  it('si la API responde 403 SUCURSAL_SUSPENDIDA (el cajero no recibe el aviso), lo explica en palabras', async () => {
    api({
      cajas: [caja(1, 'Caja 1')],
      abrir: () => conflicto('SUCURSAL_SUSPENDIDA', 'Suspendida', 403),
    });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Fondo inicial'), '50');
    await userEvent.click(boton('Abrir caja'));
    expect(await screen.findByText('La sucursal está suspendida')).toBeInTheDocument();
    expect(screen.getByText(/Puedes consultar y exportar tus datos/)).toBeInTheDocument();
    expect(screen.queryByText('Turno abierto')).toBeNull();
  });

  it('si la caja ya la abrió otra persona (409 TURNO_YA_ABIERTO), avisa y vuelve a pedir la lista', async () => {
    const s = api({
      cajas: [caja(1, 'Caja 1')],
      abrir: () => conflicto('TURNO_YA_ABIERTO', 'Ya abierta', 409, { turnoId: uuid(399) }),
    });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Fondo inicial'), '50');
    await userEvent.click(boton('Abrir caja'));
    expect(await screen.findByText('No pudimos abrir la caja')).toBeInTheDocument();
    expect(
      screen.getByText(/Esa caja ya está abierta, o ya tienes otra caja abierta/),
    ).toBeInTheDocument();
    await waitFor(() => expect(s.de('GET', '/cajas').length).toBeGreaterThan(1));
  });

  it('en una sesión de soporte explica que un turno es de una persona (422 REFERENCIA_INVALIDA)', async () => {
    api({
      cajas: [caja(1, 'Caja 1')],
      abrir: () => conflicto('REFERENCIA_INVALIDA', 'Soporte', 422),
    });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Fondo inicial'), '50');
    await userEvent.click(boton('Abrir caja'));
    expect(await screen.findByText(/Un turno es de una persona/)).toBeInTheDocument();
  });

  it('si el envío se corta por la red, el id del turno se conserva al repetir (no abre dos)', async () => {
    let intentos = 0;
    const s = api({
      cajas: [caja(1, 'Caja 1')],
      abrir: () => {
        intentos += 1;
        return intentos === 1 ? conflicto('ERROR_INTERNO', 'Se cayó', 503) : json(201, turno());
      },
    });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Fondo inicial'), '200');
    await userEvent.click(boton('Abrir caja'));
    await screen.findByText('Turno abierto');
    const llamadas = s.de('POST', '/turnos');
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]?.cabeceras.get('Idempotency-Key')).toBe(
      llamadas[1]?.cabeceras.get('Idempotency-Key'),
    );
    expect(llamadas[0]?.cuerpo).toEqual(llamadas[1]?.cuerpo);
  });
});

describe('/caja sin turno: primeros pasos (pregunta 19)', () => {
  it('el Administrador ve qué falta y a dónde ir; sin cajas no hay formulario de apertura', async () => {
    api(
      { sesion: sesionDeRol('ADMINISTRADOR', { modulos: PLAN }), cajas: [] },
      {
        [`GET /sucursales/${ID.sucursalA}`]: () => json(200, { emisorId: EMISOR }),
        'GET /emisores': () =>
          json(200, [
            {
              id: EMISOR,
              empresaId: ID.empresa,
              ruc: '20600000005',
              razonSocial: 'Cevichería El Sol S.A.C.',
              regimen: 'GENERAL',
              creadoEn: '2026-10-01T10:00:00.000Z',
              actualizadoEn: '2026-10-01T10:00:00.000Z',
            },
          ]),
        [`GET /emisores/${EMISOR}/tasas-igv`]: () => json(200, []),
      },
    );
    renderApp('/caja');
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    await waitFor(() => expect(within(guia).getAllByRole('listitem')).toHaveLength(3));
    expect(within(guia).getByRole('link', { name: 'Crear una caja' })).toHaveAttribute(
      'href',
      '/administracion/cajas',
    );
    expect(within(guia).getByRole('link', { name: 'Poner la tasa de IGV' })).toHaveAttribute(
      'href',
      '/administracion/emisores',
    );
    expect(screen.getByText('Aún no hay cajas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir caja' })).toBeNull();
  });

  it('un Cajero ve la guía sin acciones y la frase de a quién pedírselo; no consulta emisores ni tasas', async () => {
    const s = api({ cajas: [caja(1, 'Caja 1', { series: [] })] });
    renderApp('/caja');
    const guia = await screen.findByRole('region', { name: /Para cobrar falta/ });
    expect(within(guia).getByText('Darle una serie de boletas o de facturas')).toBeInTheDocument();
    expect(within(guia).queryByRole('link')).toBeNull();
    expect(screen.getByText(/Pídele a tu administrador que lo configure/)).toBeInTheDocument();
    expect(s.de('GET', '/emisores')).toHaveLength(0);
    // La caja sin series se puede abrir, pero se dice que no emite.
    expect(screen.getByText(/Sin series: no emite comprobantes/)).toBeInTheDocument();
    expect(boton('Abrir caja')).toBeEnabled();
  });
});

describe('/caja con turno: mi turno, movimientos y reporte X (criterios 28, 29 y 110)', () => {
  it('muestra la caja, desde cuándo y el fondo, y la lista de movimientos del turno, el más nuevo primero', async () => {
    api({
      turno: turno(),
      movimientos: [
        movimiento(1, {
          tipo: 'INGRESO',
          monto: '20.00',
          motivo: 'Sencillo',
          creadoEn: '2026-11-05T00:05:00.000Z',
        }),
        movimiento(2, { motivo: 'Hielo', creadoEn: '2026-11-05T00:10:00.000Z' }),
      ],
    });
    renderApp('/caja');
    expect(await screen.findByText('Caja 1')).toBeInTheDocument();
    expect(screen.getByText(/las 18:02 · Marta Pérez/)).toBeInTheDocument();
    expect(screen.getByText('S/ 200.00')).toBeInTheDocument();
    const filas = await screen.findAllByText(/^(Hielo|Sencillo)$/);
    expect(filas.map((f) => f.textContent)).toEqual(['Hielo', 'Sencillo']);
    expect(screen.getByText('-S/ 15.50'.replace('-S/', '-S/'))).toBeInTheDocument();
    expect(screen.getByText('+S/ 20.00')).toBeInTheDocument();
  });

  it('registra un egreso con monto y motivo: manda su id y la clave, limpia el formulario y recarga la lista', async () => {
    const s = api({ turno: turno() });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Monto'), '15.5');
    await userEvent.type(campo('Motivo'), 'Compra de hielo');
    await userEvent.click(boton('Registrar egreso'));

    expect(
      await screen.findByText(/Egreso de S\/ 15.50 registrado: Compra de hielo/),
    ).toBeInTheDocument();
    const llamada = s.de('POST', `/turnos/${uuid(300)}/movimientos`)[0];
    expect(llamada?.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      tipo: 'EGRESO',
      monto: '15.50',
      motivo: 'Compra de hielo',
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    expect(campo('Monto')).toHaveValue('');
    expect(campo('Motivo')).toHaveValue('');
    // La lista se vuelve a pedir y muestra el movimiento.
    expect(
      await screen.findByText('Compra de hielo', { selector: '.turno__movimiento-motivo' }),
    ).toBeInTheDocument();
  });

  it('un ingreso lleva el tipo INGRESO y el botón lo dice', async () => {
    const s = api({ turno: turno() });
    renderApp('/caja');
    await userEvent.click(await screen.findByRole('button', { name: 'Ingreso' }));
    await userEvent.type(campo('Monto'), '20');
    await userEvent.type(campo('Motivo'), 'Sencillo');
    await userEvent.click(boton('Registrar ingreso'));
    await screen.findByText(/Ingreso de S\/ 20.00 registrado/);
    expect(s.de('POST', `/turnos/${uuid(300)}/movimientos`)[0]?.cuerpo).toMatchObject({
      tipo: 'INGRESO',
      monto: '20.00',
    });
  });

  it('pide monto y motivo antes de enviar', async () => {
    const s = api({ turno: turno() });
    renderApp('/caja');
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar egreso' }));
    expect(await screen.findByText('Escribe el monto')).toBeInTheDocument();
    expect(screen.getByText(/Escribe el motivo/)).toBeInTheDocument();
    expect(s.de('POST', `/turnos/${uuid(300)}/movimientos`)).toHaveLength(0);
  });

  it('si el turno ya está cerrado (409 TURNO_CERRADO), lo dice en palabras y conserva lo escrito', async () => {
    api({
      turno: turno(),
      movimiento: () => conflicto('TURNO_CERRADO', 'Cerrado'),
    });
    renderApp('/caja');
    await userEvent.type(await screen.findByLabelText('Monto'), '15');
    await userEvent.type(campo('Motivo'), 'Hielo');
    await userEvent.click(boton('Registrar egreso'));
    expect(await screen.findByText('No pudimos registrar el movimiento')).toBeInTheDocument();
    expect(screen.getByText(/Este turno ya está cerrado/)).toBeInTheDocument();
    expect(campo('Motivo')).toHaveValue('Hielo');
  });

  it('el reporte X muestra lo vendido, lo cobrado por medio y lo que debería haber en caja', async () => {
    api({ turno: turno() });
    renderApp('/caja');
    await userEvent.click(await screen.findByRole('button', { name: 'Reporte X' }));
    const ventas = await screen.findByRole('heading', { name: 'Ventas' });
    const bloque = ventas.closest('section') as HTMLElement;
    expect(within(bloque).getAllByText('S/ 310.14')).toHaveLength(2); // el total y las boletas
    expect(within(bloque).getByText('5 comprobantes')).toBeInTheDocument();
    expect(within(bloque).getByText('S/ 44.84')).toBeInTheDocument();
    const medios = screen
      .getByRole('heading', { name: 'Cobrado por medio de pago' })
      .closest('section') as HTMLElement;
    expect(within(medios).getByText('Efectivo')).toBeInTheDocument();
    expect(within(medios).getByText('2 pagos')).toBeInTheDocument();
    const esperado = screen
      .getByRole('heading', { name: 'Lo que debería haber en caja' })
      .closest('section') as HTMLElement;
    expect(within(esperado).getByText('S/ 307.00')).toBeInTheDocument();
    // "Imprimir" todavía no existe: no se ofrece.
    expect(screen.queryByRole('button', { name: /Imprimir/ })).toBeNull();
  });

  it('"Actualizar" vuelve a pedir el X', async () => {
    const s = api({ turno: turno() });
    renderApp('/caja?ver=reporte-x');
    await screen.findByRole('heading', { name: 'Ventas' });
    const antes = s.de('GET', `/turnos/${uuid(300)}/reporte`).length;
    await userEvent.click(boton('Actualizar'));
    await waitFor(() =>
      expect(s.de('GET', `/turnos/${uuid(300)}/reporte`).length).toBeGreaterThan(antes),
    );
  });
});

describe('Cerrar caja: conteo a ciegas, diferencias y bloqueo (criterios 31 a 35 y 116)', () => {
  const llenar = async (valores: Record<string, string>) => {
    for (const [etiqueta, valor] of Object.entries(valores)) {
      await userEvent.type(campo(etiqueta), valor);
    }
  };
  const TODOS_EN_CERO = {
    Efectivo: '0',
    'Tarjeta de crédito': '0',
    'Tarjeta de débito': '0',
    Yape: '0',
    Plin: '0',
  };

  const cerrado = (
    t: TurnoRespuesta,
    conteo: ReporteCaja['cierre'] extends infer C ? C : never,
  ): ReporteCaja =>
    reporte(
      {
        ...t,
        estado: 'CERRADO',
        cerradoEn: '2026-11-05T01:00:00.000Z',
        cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
      },
      { cierre: conteo },
    );

  async function aCerrar() {
    renderApp('/caja');
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar caja' }));
    await screen.findByRole('heading', { name: 'Cuenta lo que hay en cada medio' });
  }

  it('cuenta a ciegas: pide los cinco medios y no muestra ni pide lo que debería haber', async () => {
    const s = api({ turno: turno() });
    await aCerrar();
    for (const medio of ['Efectivo', 'Tarjeta de crédito', 'Tarjeta de débito', 'Yape', 'Plin']) {
      expect(campo(medio)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/esperado|307\.00/i);
    // El X no se pide en la pantalla de cierre.
    const antes = s.de('GET', `/turnos/${uuid(300)}/reporte`).length;
    await userEvent.type(campo('Efectivo'), '295');
    expect(s.de('GET', `/turnos/${uuid(300)}/reporte`).length).toBe(antes);
    expect(document.body.textContent).not.toMatch(/esperado|307\.00/i);
  });

  it('un medio sin escribir es un error en palabras: un cero se escribe, no se supone', async () => {
    const s = api({ turno: turno() });
    await aCerrar();
    await llenar({ Efectivo: '295' });
    await userEvent.click(boton('Cerrar con Z'));
    expect(
      await screen.findByText(/Escribe lo que contaste en tarjeta de crédito/),
    ).toBeInTheDocument();
    expect(s.de('POST', `/turnos/${uuid(300)}/cierre`)).toHaveLength(0);
  });

  it('"Cerrar con Z" pide confirmación y, si todo cuadra, cierra y muestra la Z con lo esperado', async () => {
    const t = turno();
    const s = api({
      turno: t,
      cierre: () =>
        json(
          200,
          cerrado(t, {
            cerradoEn: '2026-11-05T01:00:00.000Z',
            cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
            conteo: MEDIOS.map((medio) => ({
              medio,
              esperado: '0.00',
              contado: '0.00',
              diferencia: '0.00',
              motivo: null,
            })),
          }),
        ),
    });
    await aCerrar();
    await llenar(TODOS_EN_CERO);
    await userEvent.click(boton('Cerrar con Z'));
    const dialogo = await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' });
    expect(s.de('POST', `/turnos/${uuid(300)}/cierre`)).toHaveLength(0);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar con Z' }));

    expect(await screen.findByText('Caja 1 cerrada')).toBeInTheDocument();
    const llamada = s.de('POST', `/turnos/${uuid(300)}/cierre`)[0];
    expect(llamada?.cuerpo).toEqual({
      conteo: MEDIOS.map((medio) => ({ medio, contado: '0.00' })),
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    // Cerrada la caja, sí se ve lo esperado (la Z).
    expect(screen.getByText('Conteo del cierre')).toBeInTheDocument();
    expect(screen.getAllByText('Esperado').length).toBe(5);
    // "Listo" lleva a abrir otra caja.
    await userEvent.click(boton('Listo'));
    expect(await screen.findByRole('group', { name: 'Caja que vas a abrir' })).toBeInTheDocument();
  });

  it('con diferencias pide el motivo de cada una (con atajos), sin mostrar lo esperado, y cierra con ellos', async () => {
    const t = turno();
    const cuerpos: unknown[] = [];
    const claves: (string | null)[] = [];
    api({
      turno: t,
      cierre: ({ cuerpo, cabeceras }) => {
        cuerpos.push(cuerpo);
        claves.push(cabeceras.get('Idempotency-Key'));
        const conteo = (cuerpo as { conteo: { medio: string; motivo?: string }[] }).conteo;
        if (!conteo.some((c) => c.motivo)) {
          return conflicto('DIFERENCIA_SIN_MOTIVO', 'Falta el motivo', 422, {
            campos: [{ campo: 'conteo.0.motivo', mensaje: 'Falta el motivo' }],
            diferencias: [
              { medio: 'EFECTIVO', contado: '295.00', diferencia: '-12.00' },
              { medio: 'TARJETA_CREDITO', contado: '69.20', diferencia: '0.00' },
              { medio: 'TARJETA_DEBITO', contado: '0.00', diferencia: '0.00' },
              { medio: 'YAPE', contado: '30.00', diferencia: '0.80' },
              { medio: 'PLIN', contado: '0.00', diferencia: '0.00' },
            ],
          });
        }
        return json(
          200,
          cerrado(t, {
            cerradoEn: '2026-11-05T01:00:00.000Z',
            cerradoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
            conteo: [
              {
                medio: 'EFECTIVO',
                esperado: '307.00',
                contado: '295.00',
                diferencia: '-12.00',
                motivo: 'Faltó sencillo',
              },
              {
                medio: 'TARJETA_CREDITO',
                esperado: '69.20',
                contado: '69.20',
                diferencia: '0.00',
                motivo: null,
              },
              {
                medio: 'TARJETA_DEBITO',
                esperado: '0.00',
                contado: '0.00',
                diferencia: '0.00',
                motivo: null,
              },
              {
                medio: 'YAPE',
                esperado: '29.20',
                contado: '30.00',
                diferencia: '0.80',
                motivo: 'Se cobró de más',
              },
              {
                medio: 'PLIN',
                esperado: '0.00',
                contado: '0.00',
                diferencia: '0.00',
                motivo: null,
              },
            ],
          }),
        );
      },
    });
    await aCerrar();
    await llenar({
      Efectivo: '295',
      'Tarjeta de crédito': '69.2',
      'Tarjeta de débito': '0',
      Yape: '30',
      Plin: '0',
    });
    await userEvent.click(boton('Cerrar con Z'));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
        'button',
        {
          name: 'Cerrar con Z',
        },
      ),
    );

    // Primer envío: a ciegas, sin motivos.
    expect(cuerpos).toHaveLength(1);
    expect(
      (cuerpos[0] as { conteo: { motivo?: string }[] }).conteo.every((c) => c.motivo === undefined),
    ).toBe(true);

    // Ahora sí: cada diferencia con su monto en palabras, sin el esperado.
    expect(
      await screen.findByRole('heading', { name: 'Escribe el motivo de cada diferencia' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Faltan S/ 12.00')).toBeInTheDocument();
    expect(screen.getByText('Sobran S/ 0.80')).toBeInTheDocument();
    expect(screen.getAllByText('Cuadra')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/esperado|307\.00|29\.20/i);
    // Solo los medios con diferencia piden motivo.
    expect(screen.getAllByLabelText(/Motivo de la diferencia en/)).toHaveLength(2);

    // Sin motivo no se envía.
    await userEvent.click(boton('Cerrar con Z'));
    expect(await screen.findAllByText('Escribe el motivo de esta diferencia')).toHaveLength(2);
    expect(cuerpos).toHaveLength(1);

    // Un atajo de un toque llena el motivo; el otro se escribe.
    const grupoEfectivo = screen.getByRole('group', { name: 'Motivos frecuentes: Efectivo' });
    await userEvent.click(within(grupoEfectivo).getByRole('button', { name: 'Faltó sencillo' }));
    expect(campo('Motivo de la diferencia en efectivo')).toHaveValue('Faltó sencillo');
    await userEvent.type(campo('Motivo de la diferencia en yape'), 'Se cobró de más');
    await userEvent.click(boton('Cerrar con Z'));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
        'button',
        {
          name: 'Cerrar con Z',
        },
      ),
    );

    expect(await screen.findByText('Caja 1 cerrada')).toBeInTheDocument();
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[1]).toEqual({
      conteo: [
        { medio: 'EFECTIVO', contado: '295.00', motivo: 'Faltó sencillo' },
        { medio: 'TARJETA_CREDITO', contado: '69.20' },
        { medio: 'TARJETA_DEBITO', contado: '0.00' },
        { medio: 'YAPE', contado: '30.00', motivo: 'Se cobró de más' },
        { medio: 'PLIN', contado: '0.00' },
      ],
    });
    // El cuerpo cambió: la clave de idempotencia también.
    expect(claves[1]).not.toBe(claves[0]);
    expect(await screen.findByText('Motivo: Faltó sencillo')).toBeInTheDocument();
  });

  it('repetir el mismo cuerpo repite la misma clave de idempotencia; otro cuerpo, otra', async () => {
    const claves: (string | null)[] = [];
    api({
      turno: turno(),
      cierre: ({ cabeceras }) => {
        claves.push(cabeceras.get('Idempotency-Key'));
        return conflicto('ERROR_INTERNO', 'Falló', 500);
      },
    });
    await aCerrar();
    await llenar(TODOS_EN_CERO);
    const cerrar = async () => {
      await userEvent.click(boton('Cerrar con Z'));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
          'button',
          {
            name: 'Cerrar con Z',
          },
        ),
      );
      await screen.findByText('No pudimos cerrar la caja');
    };
    await cerrar();
    await cerrar();
    expect(claves).toHaveLength(2);
    expect(claves[0]).toBe(claves[1]);
    await userEvent.clear(campo('Efectivo'));
    await userEvent.type(campo('Efectivo'), '5');
    await cerrar();
    expect(claves[2]).not.toBe(claves[1]);
  });

  it('con cuentas abiertas (409 CIERRE_BLOQUEADO) dice cuántas, lista cada una con su enlace y conserva el conteo', async () => {
    const ordenA = uuid(701);
    const ordenB = uuid(702);
    const resumen = (id: string, mesa: string, saldo: string) => ({
      ordenId: id,
      tipo: 'MESA' as const,
      mesas: [{ id: uuid(100 + Number(mesa)), nombre: mesa }],
      mozo: { id: uuid(31), nombre: 'Lucía' },
      abiertaEn: '2026-11-04T23:10:00.000Z',
      estado: 'ABIERTA' as const,
      total: saldo,
      saldo,
      modo: null,
    });
    api(
      {
        turno: turno(),
        cierre: () => conflicto('CIERRE_BLOQUEADO', 'Hay cuentas abiertas', 409, { ordenes: 2 }),
      },
      {
        'GET /cuentas': () =>
          json(200, [resumen(ordenA, '4', '69.20'), resumen(ordenB, '6', '38.00')]),
      },
    );
    await aCerrar();
    await llenar({ ...TODOS_EN_CERO, Efectivo: '295' });
    await userEvent.click(boton('Cerrar con Z'));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
        'button',
        {
          name: 'Cerrar con Z',
        },
      ),
    );

    expect(await screen.findByText('Quedan 2 cuentas abiertas')).toBeInTheDocument();
    const lista = await screen.findByRole('list', { name: 'Cuentas abiertas' });
    const enlaces = within(lista).getAllByRole('link');
    expect(enlaces.map((e) => e.getAttribute('href'))).toEqual([
      `/caja/cuentas/${ordenA}`,
      `/caja/cuentas/${ordenB}`,
    ]);
    expect(within(lista).getByText('Mesa 4')).toBeInTheDocument();
    expect(within(lista).getByText(/Lucía · S\/ 69.20/)).toBeInTheDocument();
    // Lo que se contó sigue ahí.
    expect(campo('Efectivo')).toHaveValue('295.00');
  });

  it('un turno de otra persona (409 TURNO_AJENO) se dice en palabras', async () => {
    api({
      turno: turno(),
      cierre: () => conflicto('TURNO_AJENO', 'Ajeno'),
    });
    await aCerrar();
    await llenar(TODOS_EN_CERO);
    await userEvent.click(boton('Cerrar con Z'));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
        'button',
        {
          name: 'Cerrar con Z',
        },
      ),
    );
    expect(await screen.findByText(/Este turno es de otra persona/)).toBeInTheDocument();
  });

  it('"Volver a contar" deja corregir el conteo después de ver las diferencias', async () => {
    api({
      turno: turno(),
      cierre: () =>
        conflicto('DIFERENCIA_SIN_MOTIVO', 'Falta', 422, {
          diferencias: MEDIOS.map((medio) => ({
            medio,
            contado: '0.00',
            diferencia: medio === 'EFECTIVO' ? '-5.00' : '0.00',
          })),
        }),
    });
    await aCerrar();
    await llenar(TODOS_EN_CERO);
    await userEvent.click(boton('Cerrar con Z'));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: '¿Cerrar la caja con Z?' })).getByRole(
        'button',
        {
          name: 'Cerrar con Z',
        },
      ),
    );
    await screen.findByRole('heading', { name: 'Escribe el motivo de cada diferencia' });
    await act(async () => {
      await userEvent.click(boton('Volver a contar'));
    });
    expect(
      await screen.findByRole('heading', { name: 'Cuenta lo que hay en cada medio' }),
    ).toBeInTheDocument();
    expect(campo('Efectivo')).toHaveValue('0.00');
  });
});

describe('Quién ve la caja (criterio 108)', () => {
  it('un Supervisor entra a /caja', async () => {
    api({ sesion: sesionDeRol('SUPERVISOR', { modulos: PLAN }) });
    renderApp('/caja');
    expect(await screen.findByRole('group', { name: 'Caja que vas a abrir' })).toBeInTheDocument();
  });

  it('un Mozo no abre /caja: lo devuelve al Salón', async () => {
    const s = api({ sesion: sesionDeRol('MOZO', { modulos: PLAN }) });
    renderApp('/caja');
    expect(await screen.findByRole('heading', { name: 'Salón', level: 1 })).toBeInTheDocument();
    expect(s.de('GET', '/turnos/mio')).toHaveLength(0);
  });

  it('un plan sin módulo de Caja no la ofrece', async () => {
    api({ sesion: sesionDeRol('CAJERO', { modulos: ['SALON', 'COCINA'] }) });
    renderApp('/caja');
    expect(await screen.findByRole('heading', { name: 'Salón', level: 1 })).toBeInTheDocument();
  });

  it('el módulo de la caja se pide sin sucursal activa con un aviso claro', async () => {
    api({
      sesion: {
        ...sesionDeRol('ADMINISTRADOR', { modulos: PLAN }),
        sucursal: null,
      },
    });
    renderApp('/caja');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Caja que vas a abrir' })).toBeNull(),
    );
  });
});
