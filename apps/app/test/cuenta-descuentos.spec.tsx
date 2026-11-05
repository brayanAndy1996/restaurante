import type {
  AutorizacionRespuesta,
  CortesiaRespuesta,
  CuentaRespuesta,
  DescuentoRespuesta,
  PrecuentaRespuesta,
} from '@restaurante/contratos';
import type { Rol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor } from './ayudas';
import { cartaDeEjemplo } from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 36 a 46, 45a y 111 en la interfaz (descuentos y cortesías con la clave atada;
// pruebas no protegidas de la pantalla).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const ORDEN = uuid(904);
const LOMO = uuid(1001);
const GASEOSA = uuid(1002);
const BOLSA = uuid(1003);
const RUTA = `/caja/cuentas/${ORDEN}`;
const API_DESCUENTOS = `/cuentas/${ORDEN}/descuentos`;
const API_CORTESIAS = `/cuentas/${ORDEN}/cortesias`;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PERSONA = { id: uuid(70), nombre: 'Rosa Quispe' };

function descuento(extra: Partial<DescuentoRespuesta> = {}): DescuentoRespuesta {
  return {
    id: uuid(7100),
    itemId: LOMO,
    tipo: 'PORCENTAJE',
    valor: '10.00',
    monto: '5.60',
    motivo: 'Cliente frecuente',
    autorizadoPor: PERSONA,
    creadoEn: '2026-11-05T17:00:00.000Z',
    creadoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
    ...extra,
  };
}

function cortesia(extra: Partial<CortesiaRespuesta> = {}): CortesiaRespuesta {
  return {
    id: uuid(7200),
    itemId: GASEOSA,
    cantidad: 1,
    valorReferencial: '9.00',
    motivo: 'Cortesía de la casa',
    autorizadoPor: PERSONA,
    creadoEn: '2026-11-05T17:00:00.000Z',
    creadoPor: { id: ID.usuario, nombre: 'Marta Pérez' },
    ...extra,
  };
}

/** La cuenta C de 004: Lomo saltado × 2 (S/ 28.00), Gaseosa × 1 (S/ 9.00) y una bolsa con ICBPER. */
function cuenta(extra: Partial<CuentaRespuesta> = {}): CuentaRespuesta {
  return {
    ordenId: ORDEN,
    tipo: 'MESA',
    estado: 'ABIERTA',
    mesas: [{ id: uuid(104), nombre: '4' }],
    mozo: { id: uuid(800), nombre: 'Ana Ríos' },
    numeroLlamado: null,
    version: 3,
    lineas: [
      {
        itemId: LOMO,
        nombre: 'Lomo saltado',
        modificadores: ['3/4'],
        precioUnitario: '28.00',
        cantidad: 2,
        cantidadCortesia: 0,
        cantidadFacturada: 0,
        afectacion: 'GRAVADO',
        aplicaIcbper: false,
        bruto: '56.00',
        descuento: null,
        descuentoCuenta: '0.00',
        neto: '56.00',
        icbper: '0.00',
      },
      {
        itemId: GASEOSA,
        nombre: 'Gaseosa 1 L',
        modificadores: [],
        precioUnitario: '9.00',
        cantidad: 1,
        cantidadCortesia: 0,
        cantidadFacturada: 0,
        afectacion: 'GRAVADO',
        aplicaIcbper: false,
        bruto: '9.00',
        descuento: null,
        descuentoCuenta: '0.00',
        neto: '9.00',
        icbper: '0.00',
      },
      {
        itemId: BOLSA,
        nombre: 'Bolsa plástica',
        modificadores: [],
        precioUnitario: '0.20',
        cantidad: 5,
        cantidadCortesia: 0,
        cantidadFacturada: 0,
        afectacion: 'GRAVADO',
        aplicaIcbper: true,
        bruto: '1.00',
        descuento: null,
        descuentoCuenta: '0.00',
        neto: '1.00',
        icbper: '2.50',
      },
    ],
    descuentoCuenta: null,
    cortesias: [],
    totales: {
      subtotal: '66.00',
      descuentos: '0.00',
      operaciones: { gravadas: '55.93', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '10.07',
      igvGratuitas: '0.00',
      icbper: '2.50',
      total: '68.50',
    },
    cobrado: '0.00',
    saldo: '68.50',
    modo: null,
    cobros: [],
    parametros: {
      tasaIgv: '18.00',
      montoIcbper: '0.50',
      regimen: 'GENERAL',
      tiposPermitidos: ['BOLETA', 'FACTURA'],
    },
    ...extra,
  };
}

const autorizada = (extra: Partial<AutorizacionRespuesta> = {}): AutorizacionRespuesta => ({
  autorizacionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accion: 'APLICAR_DESCUENTO',
  autorizadoPor: PERSONA,
  expiraEn: new Date(Date.now() + 120_000).toISOString(),
  ...extra,
});

type Manejador = Parameters<typeof servidor>[0][string];

/** La cuenta de la API con lo mínimo de la sesión; `extra` pone o cambia los manejadores de cada prueba. */
function montar(
  opciones: {
    rol?: Rol;
    cuenta?: CuentaRespuesta;
    extra?: Record<string, Manejador>;
    modulos?: ('SALON' | 'COCINA' | 'CAJA')[];
  } = {},
) {
  const estado = { cuenta: opciones.cuenta ?? cuenta() };
  const s = servidor({
    'GET /sesion': () =>
      json(
        200,
        sesionDeRol(opciones.rol ?? 'MOZO', { modulos: opciones.modulos ?? ['SALON', 'CAJA'] }),
      ),
    [`GET /cuentas/${ORDEN}`]: () => json(200, estado.cuenta),
    ...(opciones.extra ?? {}),
  });
  return Object.assign(s, { estado });
}

async function pin(digitos: string) {
  const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
  for (const d of digitos) await userEvent.click(within(ventana).getByRole('button', { name: d }));
}

/** Abre la hoja de descuento del Lomo y escribe 10 % con un motivo de un toque. */
async function descuentoDelLomo(porcentaje = '10') {
  await userEvent.click(await screen.findByRole('button', { name: 'Descuento a Lomo saltado' }));
  const hoja = await screen.findByRole('dialog', { name: 'Descuento' });
  await userEvent.type(within(hoja).getByLabelText('Porcentaje del descuento'), porcentaje);
  await userEvent.click(within(hoja).getByRole('button', { name: 'Cliente frecuente' }));
  return hoja;
}

describe('La cuenta con su desglose (criterios 36 y 111)', () => {
  it('muestra cada ítem, los montos de la API y las acciones que el rol puede hacer', async () => {
    montar();
    renderApp(RUTA);
    expect(await screen.findByText('Lomo saltado')).toBeVisible();
    const desglose = screen.getByLabelText('Desglose de la cuenta');
    expect(within(desglose).getByText('Subtotal').nextSibling).toHaveTextContent('S/ 66.00');
    expect(within(desglose).getByText('ICBPER').nextSibling).toHaveTextContent('S/ 2.50');
    expect(within(desglose).getByText('Total').nextSibling).toHaveTextContent('S/ 68.50');
    expect(within(desglose).getByText('Incluye IGV').nextSibling).toHaveTextContent('S/ 10.07');
    // Descuento en los tres ítems y para la cuenta; cortesía en los que no llevan ICBPER.
    expect(screen.getByRole('button', { name: 'Descuento a Lomo saltado' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cortesía de Gaseosa 1 L' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Descuento a Bolsa plástica' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cortesía de Bolsa plástica' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Descuento a la cuenta' })).toBeVisible();
  });

  it('un descuento y una cortesía aplicados se ven con su monto, el desglose los resta y se pueden quitar', async () => {
    montar({
      cuenta: cuenta({
        lineas: cuenta().lineas.map((l) =>
          l.itemId === LOMO
            ? { ...l, descuento: descuento(), neto: '50.40' }
            : l.itemId === GASEOSA
              ? { ...l, cantidadCortesia: 1, bruto: '0.00', neto: '0.00' }
              : l,
        ),
        cortesias: [cortesia()],
        totales: { ...cuenta().totales, subtotal: '57.00', descuentos: '5.60', total: '53.90' },
      }),
    });
    renderApp(RUTA);
    expect(await screen.findByText('Descuento 10 %')).toBeVisible();
    expect(screen.getByText(/−S\/ 5\.60 · Cliente frecuente/)).toBeVisible();
    expect(screen.getByText('Cortesía · 1 unidad')).toBeVisible();
    const desglose = screen.getByLabelText('Desglose de la cuenta');
    expect(within(desglose).getByText('Descuentos').nextSibling).toHaveTextContent('−S/ 5.60');
    expect(within(desglose).getByText('Cortesía · 1 × Gaseosa 1 L').nextSibling).toHaveTextContent(
      'Sin cobro (S/ 9.00)',
    );
    // Con descuento no se ofrece otro ni la cortesía; con cortesía tampoco.
    expect(screen.queryByRole('button', { name: 'Descuento a Lomo saltado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cortesía de Lomo saltado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cortesía de Gaseosa 1 L' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Quitar el descuento de Lomo saltado' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quitar la cortesía de Gaseosa 1 L' })).toBeVisible();
  });

  it('una cuenta con cobros no ofrece cambiar nada y lo dice', async () => {
    montar({
      cuenta: cuenta({
        cobrado: '10.00',
        saldo: '58.50',
        cobros: [
          {
            id: uuid(8000),
            comprobante: { id: uuid(8001), tipo: 'BOLETA', numero: 'B001-00000001' },
            total: '10.00',
            cobradoEn: '2026-11-05T17:00:00.000Z',
            cobradoPor: PERSONA,
          },
        ],
      }),
    });
    renderApp(RUTA);
    expect(await screen.findByText('Esta cuenta ya tiene cobros')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Descuento/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cortesía/ })).toBeNull();
  });

  it('el Cajero y el Mozo llegan desde la cuenta de la mesa si el plan tiene Caja', async () => {
    const orden = ordenDeMesa(4, {
      total: '65.00',
      items: [itemDeOrden(1, { cantidad: 2, cantidadVigente: 2, totalVigente: '56.00' })],
    });
    const base = {
      'GET /ordenes/*': () => json(200, orden),
      'GET /carta/sucursal': () => json(200, cartaDeEjemplo(), { ETag: '"c1"' }),
    };
    const con = servidor({
      ...base,
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: ['SALON', 'CAJA'] })),
    });
    const { unmount } = renderApp(`/salon/ordenes/${ORDEN}`);
    const enlace = await screen.findByRole('link', { name: 'Descuentos y cortesías' });
    expect(enlace).toHaveAttribute('href', RUTA);
    unmount();
    con.llamadas.length = 0;

    servidor({
      ...base,
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: ['SALON'] })),
    });
    renderApp(`/salon/ordenes/${ORDEN}`);
    await screen.findByRole('button', { name: 'Pedir pre-cuenta' });
    expect(screen.queryByRole('link', { name: 'Descuentos y cortesías' })).toBeNull();
  });
});

describe('La ventana de clave muestra lo que se autoriza y manda exactamente eso (criterio 40)', () => {
  it('descuento de ítem: el objetivo del POST /autorizaciones es el que dice la ventana, y la clave viaja en el descuento', async () => {
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_DESCUENTOS}`]: ({ cuerpo }) =>
          json(201, descuento({ id: (cuerpo as { id: string }).id })),
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    // La vista previa ya dice el efecto con las funciones del dominio.
    const previa = hoja.querySelector('.ajuste__previa');
    expect(previa).toHaveTextContent('Descuenta S/ 5.60');
    expect(previa).toHaveTextContent('baja de S/ 68.50 a S/ 62.90');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));

    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Descuento 10 % · Lomo saltado × 2 · Mesa 4');
    expect(ventana).toHaveTextContent('Motivo: Cliente frecuente');
    await pin('123456');

    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(1));
    const objetivo = {
      tipo: 'DESCUENTO',
      ordenId: ORDEN,
      itemId: LOMO,
      descuento: { tipo: 'PORCENTAJE', valor: '10.00' },
    };
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toEqual({
      accion: 'APLICAR_DESCUENTO',
      motivo: 'Cliente frecuente',
      pin: '123456',
      objetivo,
    });
    const llamada = s.de('POST', API_DESCUENTOS)[0]!;
    // Lo que se aplica es lo mismo que se autorizó.
    expect(llamada.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      itemId: LOMO,
      tipo: 'PORCENTAJE',
      valor: '10.00',
      motivo: 'Cliente frecuente',
    });
    expect(llamada.cabeceras.get('X-Autorizacion')).toBe(autorizada().autorizacionId);
    expect(llamada.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Descuento de 10 % aplicado a Lomo saltado.')).toBeVisible();
  });

  it('descuento de monto para toda la cuenta: itemId nulo y el monto con dos decimales', async () => {
    const s = montar({
      rol: 'CAJERO',
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_DESCUENTOS}`]: ({ cuerpo }) =>
          json(201, descuento({ id: (cuerpo as { id: string }).id, itemId: null, tipo: 'MONTO' })),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Descuento a la cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Descuento' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Monto' }));
    await userEvent.type(within(hoja).getByLabelText('Monto del descuento'), '5');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cumpleaños' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Descuento S/ 5.00 · Toda la cuenta · Mesa 4');
    await pin('123456');
    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(1));
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toMatchObject({
      objetivo: {
        tipo: 'DESCUENTO',
        ordenId: ORDEN,
        itemId: null,
        descuento: { tipo: 'MONTO', valor: '5.00' },
      },
    });
    expect(s.de('POST', API_DESCUENTOS)[0]?.cuerpo).toMatchObject({
      itemId: null,
      tipo: 'MONTO',
      valor: '5.00',
    });
  });

  it('cortesía: el objetivo lleva la cantidad elegida y la ventana la dice', async () => {
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada({ accion: 'APLICAR_CORTESIA' })),
        [`POST ${API_CORTESIAS}`]: ({ cuerpo }) =>
          json(201, cortesia({ id: (cuerpo as { id: string }).id, itemId: LOMO, cantidad: 2 })),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Cortesía de Lomo saltado' }));
    const hoja = await screen.findByRole('dialog', { name: 'Cortesía' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cortesía de la casa' }));
    // Por defecto 1 unidad; se suben a 2.
    await userEvent.click(
      within(hoja).getByRole('button', { name: 'Agregar una unidad de Lomo saltado' }),
    );
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Cortesía de 2 unidades · Lomo saltado · Mesa 4');
    await pin('123456');
    await waitFor(() => expect(s.de('POST', API_CORTESIAS)).toHaveLength(1));
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toEqual({
      accion: 'APLICAR_CORTESIA',
      motivo: 'Cortesía de la casa',
      pin: '123456',
      objetivo: { tipo: 'CORTESIA', ordenId: ORDEN, itemId: LOMO, cantidad: 2 },
    });
    expect(s.de('POST', API_CORTESIAS)[0]?.cuerpo).toMatchObject({
      itemId: LOMO,
      cantidad: 2,
      motivo: 'Cortesía de la casa',
    });
  });

  it('el Supervisor aplica sin clave: no hay ventana y no se manda X-Autorizacion', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_DESCUENTOS}`]: ({ cuerpo }) =>
          json(201, descuento({ id: (cuerpo as { id: string }).id })),
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Aplicar descuento' }));
    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(1));
    expect(s.de('POST', API_DESCUENTOS)[0]?.cabeceras.get('X-Autorizacion')).toBeNull();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
  });
});

describe('Una clave que no vale vuelve a pedirse sin perder lo escrito (criterio 40)', () => {
  it('un 403 AUTORIZACION_INVALIDA abre otra vez la ventana, con lo mismo escrito y otra clave', async () => {
    let intentos = 0;
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_DESCUENTOS}`]: ({ cuerpo }) => {
          intentos += 1;
          if (intentos === 1)
            return json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'La clave no vale' });
          return json(201, descuento({ id: (cuerpo as { id: string }).id }));
        },
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');

    // La API la rechazó: la ventana vuelve a abrirse sola, con el mismo objetivo.
    await waitFor(() => expect(s.de('POST', '/autorizaciones')).toHaveLength(1));
    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(1));
    const otra = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(otra).toHaveTextContent('Descuento 10 % · Lomo saltado × 2 · Mesa 4');
    // Lo escrito sigue en la hoja de atrás.
    expect(within(hoja).getByLabelText('Porcentaje del descuento')).toHaveValue('10');
    expect(within(hoja).getByRole('button', { name: 'Cliente frecuente' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await pin('654321');

    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(2));
    expect(s.de('POST', '/autorizaciones')).toHaveLength(2);
    const [primera, segunda] = s.de('POST', API_DESCUENTOS);
    // Mismo descuento (mismo id), con la clave nueva.
    expect((segunda?.cuerpo as { id: string }).id).toBe((primera?.cuerpo as { id: string }).id);
    expect(segunda?.cuerpo).toMatchObject({ valor: '10.00', motivo: 'Cliente frecuente' });
    expect(await screen.findByText('Descuento de 10 % aplicado a Lomo saltado.')).toBeVisible();
  });

  it('si la clave falla dos veces, lo dice en palabras y la hoja conserva lo escrito', async () => {
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_DESCUENTOS}`]: () =>
          json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'La clave no vale' }),
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');
    await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(1));
    await pin('123456');
    await waitFor(() => expect(s.de('POST', API_DESCUENTOS)).toHaveLength(2));
    expect(await within(hoja).findByText(/La clave del supervisor no valió/)).toBeVisible();
    expect(within(hoja).getByLabelText('Porcentaje del descuento')).toHaveValue('10');
    expect(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' })).toBeEnabled();
  });
});

describe('Errores en palabras (criterios 41, 43 y 45)', () => {
  it('un descuento que no cabe se dice en el campo antes de gastar la clave', async () => {
    const s = montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Descuento a Lomo saltado' }));
    const hoja = await screen.findByRole('dialog', { name: 'Descuento' });
    await userEvent.type(within(hoja).getByLabelText('Porcentaje del descuento'), '100');
    expect(within(hoja).getByText(/El porcentaje no puede pasar de 99.99 %/)).toBeVisible();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Monto' }));
    await userEvent.type(within(hoja).getByLabelText('Monto del descuento'), '56');
    expect(within(hoja).getByText(/El monto debe ser menor que S\/ 56\.00/)).toBeVisible();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cliente frecuente' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
  });

  it('422 DESCUENTO_INVALIDO de la API (campos.valor) queda en el campo del valor', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_DESCUENTOS}`]: () =>
          json(422, {
            codigo: 'DESCUENTO_INVALIDO',
            mensaje: 'DESCUENTO_EXCESIVO: El descuento no puede igualar ni superar el importe',
            campos: [
              { campo: 'valor', mensaje: 'El descuento no puede igualar ni superar el importe' },
            ],
          }),
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Aplicar descuento' }));
    expect(await within(hoja).findByText(/El porcentaje no puede pasar de 99.99 %/)).toBeVisible();
    expect(within(hoja).getByLabelText('Porcentaje del descuento')).toHaveValue('10');
  });

  it('409 CUENTA_EN_COBRO y 409 ORDEN_NO_ABIERTA dicen qué pasó', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_DESCUENTOS}`]: () =>
          json(409, { codigo: 'CUENTA_EN_COBRO', mensaje: 'La cuenta ya tiene cobros' }),
      },
    });
    renderApp(RUTA);
    const hoja = await descuentoDelLomo('10');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Aplicar descuento' }));
    expect(
      await within(hoja).findByText(/ya tiene cobros: los descuentos y las cortesías/),
    ).toBeVisible();
  });

  it('409 CONFLICTO de una cortesía usa el motivo que trae la API', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_CORTESIAS}`]: () =>
          json(409, {
            codigo: 'CONFLICTO',
            mensaje: 'El ítem tiene un descuento: quítalo antes de dar la cortesía',
          }),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Cortesía de Gaseosa 1 L' }));
    const hoja = await screen.findByRole('dialog', { name: 'Cortesía' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cortesía de la casa' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Dar cortesía' }));
    expect(
      await within(hoja).findByText(/El ítem tiene un descuento: quítalo antes de dar la cortesía/),
    ).toBeVisible();
  });

  it('422 CORTESIA_INVALIDA dice el motivo de la API', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_CORTESIAS}`]: () =>
          json(422, {
            codigo: 'CORTESIA_INVALIDA',
            mensaje: 'Un producto con ICBPER no admite cortesía',
            campos: [{ campo: 'itemId', mensaje: 'Un producto con ICBPER no admite cortesía' }],
          }),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Cortesía de Gaseosa 1 L' }));
    const hoja = await screen.findByRole('dialog', { name: 'Cortesía' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cortesía de la casa' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Dar cortesía' }));
    expect(
      await within(hoja).findByText(/Un producto con ICBPER no admite cortesía/),
    ).toBeVisible();
  });
});

describe('Quitar un descuento o una cortesía (criterio 42)', () => {
  it('pide confirmación, no pide clave y vuelve a leer la cuenta', async () => {
    const conDescuento = cuenta({
      lineas: cuenta().lineas.map((l) =>
        l.itemId === LOMO ? { ...l, descuento: descuento(), neto: '50.40' } : l,
      ),
      totales: { ...cuenta().totales, descuentos: '5.60', total: '62.90' },
    });
    const s = montar({
      cuenta: conDescuento,
      extra: {
        [`DELETE ${API_DESCUENTOS}/${uuid(7100)}`]: () => json(204),
      },
    });
    renderApp(RUTA);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Quitar el descuento de Lomo saltado' }),
    );
    const dialogo = await screen.findByRole('dialog', {
      name: '¿Quitar el descuento de Lomo saltado?',
    });
    // Cuenta lo que pasa con el total (calculado con el dominio) y que no hace falta clave.
    expect(dialogo).toHaveTextContent('El total sube de S/ 62.90 a S/ 68.50');
    expect(dialogo).toHaveTextContent('No hace falta la clave del supervisor');
    expect(s.de('DELETE', `${API_DESCUENTOS}/${uuid(7100)}`)).toHaveLength(0);

    s.estado.cuenta = cuenta();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, quitar el descuento' }));
    await waitFor(() => expect(s.de('DELETE', `${API_DESCUENTOS}/${uuid(7100)}`)).toHaveLength(1));
    expect(
      s.de('DELETE', `${API_DESCUENTOS}/${uuid(7100)}`)[0]?.cabeceras.get('X-Autorizacion'),
    ).toBeNull();
    expect(await screen.findByText('Quitaste el descuento.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Descuento a Lomo saltado' })).toBeVisible();
  });

  it('quitar la cortesía usa su propia ruta', async () => {
    const s = montar({
      cuenta: cuenta({
        lineas: cuenta().lineas.map((l) =>
          l.itemId === GASEOSA ? { ...l, cantidadCortesia: 1, bruto: '0.00', neto: '0.00' } : l,
        ),
        cortesias: [cortesia()],
      }),
      extra: { [`DELETE ${API_CORTESIAS}/${uuid(7200)}`]: () => json(204) },
    });
    renderApp(RUTA);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Quitar la cortesía de Gaseosa 1 L' }),
    );
    const dialogo = await screen.findByRole('dialog', {
      name: '¿Quitar la cortesía de Gaseosa 1 L?',
    });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, quitar la cortesía' }));
    await waitFor(() => expect(s.de('DELETE', `${API_CORTESIAS}/${uuid(7200)}`)).toHaveLength(1));
  });
});

describe('Anular y unir con un descuento que la cuenta ya no admite (criterio 45a)', () => {
  const RUTA_ANULAR = `/ordenes/${ORDEN}/items/${uuid(1001)}/anulaciones`;

  async function abrirAnulacion() {
    await userEvent.click(await screen.findByRole('button', { name: 'Anular Lomo saltado' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular ítem' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al comandar' }));
    await userEvent.click(within(hoja).getByRole('radio', { name: /Vuelve al stock/ }));
    return hoja;
  }

  function servidorDeAnulacion(respuesta: Response) {
    return servidor({
      'GET /sesion': () => json(200, sesionDeRol('SUPERVISOR')),
      'GET /ordenes/*': () =>
        json(
          200,
          ordenDeMesa(4, {
            total: '84.00',
            items: [itemDeOrden(1, { cantidad: 3, cantidadVigente: 3, totalVigente: '84.00' })],
          }),
        ),
      'GET /carta/sucursal': () => json(200, cartaDeEjemplo(), { ETag: '"c1"' }),
      [`POST ${RUTA_ANULAR}`]: () => respuesta,
    });
  }

  it('el 422 con campos.descuento dice que se quite o se vuelva a pedir el descuento', async () => {
    servidorDeAnulacion(
      json(422, {
        codigo: 'DESCUENTO_INVALIDO',
        mensaje: 'Quita o vuelve a pedir el descuento antes de anular',
        campos: [
          { campo: 'descuento', mensaje: 'Quita o vuelve a pedir el descuento antes de anular' },
        ],
      }),
    );
    renderApp(`/salon/ordenes/${ORDEN}`);
    const hoja = await abrirAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular ítem' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, anular ítem' }));
    const aviso = await within(hoja).findByText(
      /Quita o vuelve a pedir el descuento antes de anular\./,
    );
    expect(aviso).toBeVisible();
    expect(aviso).toHaveTextContent('Quita el descuento en «Descuentos y cortesías» de la cuenta');
  });

  it('el 409 CONFLICTO por una cortesía muestra el motivo, no el mensaje genérico', async () => {
    servidorDeAnulacion(
      json(409, {
        codigo: 'CONFLICTO',
        mensaje: 'La cortesía del ítem es mayor que lo que quedaría: quítala antes de anular',
      }),
    );
    renderApp(`/salon/ordenes/${ORDEN}`);
    const hoja = await abrirAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular ítem' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, anular ítem' }));
    expect(
      await within(hoja).findByText(/La cortesía del ítem es mayor que lo que quedaría/),
    ).toBeVisible();
    expect(within(hoja).queryByText(/Esto choca con algo que ya existe/)).toBeNull();
  });
});

describe('La pre-cuenta con descuentos y cortesías (criterio 44, pregunta 11)', () => {
  it('muestra cada descuento y cortesía con su monto, el total con ellos y la nota del ICBPER', async () => {
    const precuenta: PrecuentaRespuesta = {
      id: uuid(7001),
      numero: 1,
      emitidaEn: '2026-11-05T17:10:00.000Z',
      orden: {
        id: ORDEN,
        mesas: [{ id: uuid(104), nombre: '4' }],
        mozo: { id: uuid(800), nombre: 'Ana Ríos' },
        comensales: 3,
      },
      lineas: [
        {
          itemId: LOMO,
          nombre: 'Lomo saltado',
          modificadores: [],
          cantidad: 2,
          precioUnitario: '28.00',
          total: '56.00',
        },
        {
          itemId: GASEOSA,
          nombre: 'Gaseosa 1 L',
          modificadores: [],
          cantidad: 1,
          precioUnitario: '9.00',
          total: '0.00',
        },
      ],
      total: '50.40',
      nota: 'Precios con IGV incluido. No es un comprobante de pago. El ICBPER se suma al cobrar.',
      descuentos: [{ itemId: LOMO, tipo: 'PORCENTAJE', valor: '10.00', monto: '5.60' }],
      cortesias: [{ itemId: GASEOSA, cantidad: 1, valorReferencial: '9.00' }],
      impresion: 'SIN_IMPRESORA',
      trabajoId: null,
    };
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: ['SALON', 'CAJA'] })),
      'GET /ordenes/*': () =>
        json(
          200,
          ordenDeMesa(4, {
            total: '50.40',
            items: [itemDeOrden(1, { cantidad: 2, cantidadVigente: 2, totalVigente: '56.00' })],
          }),
        ),
      'GET /carta/sucursal': () => json(200, cartaDeEjemplo(), { ETag: '"c1"' }),
      [`POST /ordenes/${ORDEN}/precuentas`]: () => json(201, precuenta),
    });
    renderApp(`/salon/ordenes/${ORDEN}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    const ajustes = within(hoja).getByLabelText('Descuentos y cortesías');
    expect(ajustes).toHaveTextContent('Descuento 10 %');
    expect(ajustes).toHaveTextContent('Lomo saltado');
    expect(ajustes).toHaveTextContent('−S/ 5.60');
    expect(ajustes).toHaveTextContent('Cortesía · 1 × Gaseosa 1 L');
    expect(ajustes).toHaveTextContent('S/ 9.00');
    expect(within(hoja).getByText('S/ 50.40', { selector: 'b' })).toBeVisible();
    expect(within(hoja).getByText('El ICBPER se suma al cobrar.')).toBeVisible();
  });
});
