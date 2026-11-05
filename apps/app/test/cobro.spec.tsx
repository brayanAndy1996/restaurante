import type {
  CobroEntrada,
  CobroRespuesta,
  ComprobanteRespuesta,
  CuentaRespuesta,
  TurnoRespuesta,
} from '@restaurante/contratos';
import { calcularParte, type ParteCalculada, type ParteEntrada } from '@restaurante/dominio/caja';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { montoEnSoles } from '../src/lib/monto';
import { entradaDeCuenta } from '../src/modulos/caja/cobro';
import { claveDeBorrador } from '../src/modulos/salon/borrador';
import { ID, json, renderApp, servidor } from './ayudas';
import { detalleDeParte } from './ayudas-caja';
import { cartaDeEjemplo } from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 47 a 68, 60 y 111 a 114 en la interfaz (pruebas no protegidas de la pantalla del
// cobro). Los montos que se esperan son los de `packages/dominio` para la cuenta C de 004.

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const ORDEN = uuid(904);
const LOMO = uuid(1001);
const GASEOSA = uuid(1002);
const BOLSA = uuid(1003);
const TURNO = uuid(300);
const RUTA = `/caja/cuentas/${ORDEN}/cobrar`;
const API_COBROS = `/cuentas/${ORDEN}/cobros`;
type DetalleParte = ParteCalculada;
const PERSONA = { id: ID.usuario, nombre: 'Marta Pérez' };

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turno: TurnoRespuesta = {
  id: TURNO,
  caja: { id: uuid(101), nombre: 'Caja 1' },
  responsable: PERSONA,
  estado: 'ABIERTO',
  abiertoEn: '2026-11-05T23:02:00.000Z',
  diaOperativo: '2026-11-05',
  fondo: '200.00',
  cerradoEn: null,
  cerradoPor: null,
};

function linea(
  itemId: string,
  nombre: string,
  precio: string,
  cantidad: number,
  bruto: string,
  icbper = false,
) {
  return {
    itemId,
    nombre,
    modificadores: [],
    precioUnitario: precio,
    cantidad,
    cantidadCortesia: 0,
    cantidadFacturada: 0,
    afectacion: 'GRAVADO' as const,
    aplicaIcbper: icbper,
    bruto,
    descuento: null,
    descuentoCuenta: '0.00',
    neto: bruto,
    icbper: icbper ? '2.50' : '0.00',
  };
}

/** La cuenta C de 004: Lomo saltado × 2 (S/ 56.00), Gaseosa × 1 (S/ 9.00) y 5 bolsas con ICBPER. Total S/ 68.50. */
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
      linea(LOMO, 'Lomo saltado', '28.00', 2, '56.00'),
      linea(GASEOSA, 'Gaseosa 1 L', '9.00', 1, '9.00'),
      linea(BOLSA, 'Bolsa plástica', '0.20', 5, '1.00', true),
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

function comprobante(
  cobroId: string,
  total: string,
  extra: Partial<ComprobanteRespuesta> = {},
): ComprobanteRespuesta {
  return {
    id: uuid(7000),
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 1,
    numero: 'B001-00000001',
    formato: 'DETALLADO',
    estado: 'POR_ENVIAR',
    fechaEmision: '2026-11-05',
    emitidoEn: '2026-11-06T00:10:00.000Z',
    diaOperativo: '2026-11-05',
    emisor: { ruc: '20100070970', razonSocial: 'Cevichería Sol S.A.C.', regimen: 'GENERAL' },
    sucursal: { nombre: 'Miraflores', direccion: 'Av. Larco 123', codigoEstablecimiento: '0000' },
    cajaId: uuid(101),
    turnoId: TURNO,
    turnoResponsableId: ID.usuario,
    cobroId,
    numeroParte: 1,
    cliente: null,
    moneda: 'PEN',
    tasaIgv: '18.00',
    lineas: [],
    totales: {
      subtotal: total,
      descuentos: '0.00',
      operaciones: null,
      igv: '0.00',
      igvGratuitas: '0.00',
      icbper: '0.00',
      total,
    },
    montoEnLetras: 'SON: …',
    orden: null,
    ...extra,
  };
}

/** Lo que responde la API al cobrar, calculado a partir de la entrada. */
function respuestaDe(
  entrada: CobroEntrada,
  extra: {
    estado?: 'CERRADA' | 'ABIERTA';
    saldo?: string;
    numero?: string;
    vuelto?: string;
    trabajoId?: string;
  } = {},
): CobroRespuesta {
  const efectivo = entrada.pagos.find((p) => p.medio === 'EFECTIVO');
  return {
    id: entrada.id,
    ordenId: ORDEN,
    turnoId: entrada.turnoId,
    parte: entrada.parte,
    total: entrada.total,
    redondeo: entrada.redondeo,
    vuelto:
      extra.vuelto ??
      (efectivo?.recibido
        ? (Number(efectivo.recibido) - Number(efectivo.monto)).toFixed(2)
        : '0.00'),
    pagos: entrada.pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto,
      recibido: p.recibido ?? null,
      operacion: p.operacion ?? null,
    })),
    comprobante: comprobante(entrada.id, entrada.total, {
      numero: extra.numero ?? 'B001-00000001',
      tipo: entrada.comprobante.tipo,
    }),
    cuenta: { estado: extra.estado ?? 'CERRADA', saldo: extra.saldo ?? '0.00', version: 4 },
    impresion: extra.trabajoId ? 'EN_COLA' : 'SIN_IMPRESORA',
    trabajoId: extra.trabajoId ?? null,
  };
}

type Manejador = Parameters<typeof servidor>[0][string];

function montar(
  opciones: {
    cuenta?: () => CuentaRespuesta;
    turno?: TurnoRespuesta | null;
    extra?: Record<string, Manejador>;
  } = {},
) {
  const estado = { cuenta: opciones.cuenta ?? (() => cuenta()) };
  const s = servidor({
    'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'COCINA', 'CAJA'] })),
    [`GET /cuentas/${ORDEN}`]: () => json(200, estado.cuenta()),
    'GET /turnos/mio': () =>
      opciones.turno === null
        ? json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay turno' })
        : json(200, opciones.turno ?? turno),
    ...(opciones.extra ?? {}),
  });
  return Object.assign(s, { estado });
}

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });
const cobros = (s: ReturnType<typeof montar>) => s.de('POST', API_COBROS);
const entradaDe = (s: ReturnType<typeof montar>, n = 0) => cobros(s)[n]?.cuerpo as CobroEntrada;

describe('El cobro de una cuenta (criterios 47 a 52 y 111)', () => {
  it('muestra el total del dominio y cobra todo en efectivo: cuerpo exacto, Idempotency-Key igual al id y resultado', async () => {
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) =>
          json(201, respuestaDe(cuerpo as CobroEntrada, { numero: 'B001-00000124' })),
      },
    });
    renderApp(RUTA);
    expect(await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' })).toBeVisible();
    const desglose = screen.getByLabelText('Desglose de la parte');
    expect(within(desglose).getByText('Subtotal').nextSibling).toHaveTextContent('S/ 66.00');
    expect(within(desglose).getByText('ICBPER').nextSibling).toHaveTextContent('S/ 2.50');
    expect(screen.getByText('Efectivo a cobrar').nextSibling).toHaveTextContent('S/ 68.50');

    await userEvent.click(screen.getByRole('button', { name: 'S/\u00a0100' }));
    await userEvent.click(boton('Cobrar S/\u00a068.50'));

    expect(await screen.findByText('Boleta · B001-00000124')).toBeVisible();
    expect(cobros(s)).toHaveLength(1);
    const entrada = entradaDe(s);
    expect(entrada).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      turnoId: TURNO,
      version: 3,
      total: '68.50',
      parte: { tipo: 'TOTAL' },
      comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
      pagos: [{ medio: 'EFECTIVO', monto: '68.50', recibido: '100.00' }],
      redondeo: '0.00',
    });
    expect(cobros(s)[0]?.cabeceras.get('Idempotency-Key')).toBe(entrada.id);
    expect(screen.getByText('Vuelto').nextSibling).toHaveTextContent('S/ 31.50');
    expect(screen.getByText('Sin impresora de caja')).toBeVisible();
    expect(screen.getByText('Mesa 4 libre')).toBeVisible();
  });

  it('el efectivo se redondea a la décima a favor del cliente con el redondeo del dominio', async () => {
    const s = montar({
      cuenta: () =>
        cuenta({
          lineas: [linea(LOMO, 'Lomo saltado', '33.34', 1, '33.34')],
          totales: { ...cuenta().totales, subtotal: '33.34', icbper: '0.00', total: '33.34' },
          saldo: '33.34',
        }),
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a033.34' });
    expect(screen.getByText('Efectivo a cobrar').nextSibling).toHaveTextContent('S/ 33.30');
    expect(screen.getByText(/Redondeo a tu favor/)).toHaveTextContent('S/ 0.04');
    await userEvent.click(screen.getByRole('button', { name: 'S/\u00a050' }));
    expect(screen.getByText('Vuelto').nextSibling).toHaveTextContent('S/ 16.70');
    await userEvent.click(boton('Cobrar S/\u00a033.34'));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s)).toMatchObject({
      total: '33.34',
      pagos: [{ medio: 'EFECTIVO', monto: '33.30', recibido: '50.00' }],
      redondeo: '0.04',
    });
  });

  it('paga con efectivo y Yape: el Yape lleva su número de operación y el efectivo cubre el resto', async () => {
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otro pago' }));
    await userEvent.type(screen.getByLabelText('Monto del pago 2'), '20');
    // Sin número de operación, no se cobra y se dice por qué.
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    expect(cobros(s)).toHaveLength(0);
    expect(await screen.findByText('Escribe el número de operación del Yape.')).toBeVisible();

    await userEvent.type(screen.getByLabelText('Número de operación'), 'Y-5521');
    expect(screen.getByText('Efectivo a cobrar').nextSibling).toHaveTextContent('S/ 48.50');
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s).pagos).toEqual([
      { medio: 'EFECTIVO', monto: '48.50' },
      { medio: 'YAPE', monto: '20.00', operacion: 'Y-5521' },
    ]);
  });

  it('hay un solo efectivo: con efectivo ya elegido, el otro pago no lo ofrece', async () => {
    montar();
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otro pago' }));
    const segundo = screen.getByRole('group', { name: 'Medio del pago 2' });
    expect(within(segundo).queryByRole('button', { name: 'Efectivo' })).toBeNull();
    expect(within(segundo).getByRole('button', { name: 'Yape' })).toBeVisible();
  });

  it('una cuenta que ya no está abierta, o sin turno, no deja cobrar y dice qué hacer', async () => {
    montar({ turno: null });
    const { unmount } = renderApp(RUTA);
    expect(await screen.findByText('Abre tu caja para cobrar')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir a Caja' })).toHaveAttribute('href', '/caja');
    unmount();
    montar({ cuenta: () => cuenta({ estado: 'CERRADA' }) });
    renderApp(RUTA);
    expect(await screen.findByText('Esta cuenta ya no está abierta')).toBeVisible();
  });
});

describe('Comprobante y cliente (criterio 51)', () => {
  it('la factura exige RUC, razón social y dirección: sin ellos no cobra y marca cada campo', async () => {
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Factura' }));
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    expect(cobros(s)).toHaveLength(0);
    expect(await screen.findByText('Escribe un RUC válido de 11 dígitos')).toBeVisible();
    expect(screen.getByText('Escribe la razón social')).toBeVisible();
    expect(screen.getByText('Escribe la dirección fiscal')).toBeVisible();

    await userEvent.type(screen.getByLabelText('RUC'), '20100070970');
    await userEvent.type(screen.getByLabelText('Razón social'), 'Supermercados Peruanos S.A.');
    await userEvent.type(screen.getByLabelText('Dirección fiscal'), 'Av. Principal 123, Lima');
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    await screen.findByText(/Factura · |Boleta · /);
    expect(entradaDe(s).comprobante).toEqual({
      tipo: 'FACTURA',
      formato: 'DETALLADO',
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Supermercados Peruanos S.A.',
        direccion: 'Av. Principal 123, Lima',
      },
    });
  });

  it('una boleta de más de S/ 700 pide nombre y documento; hasta S/ 700.00 no', async () => {
    const grande = (total: string) =>
      cuenta({
        lineas: [linea(LOMO, 'Banquete', total, 1, total)],
        totales: { ...cuenta().totales, subtotal: total, icbper: '0.00', total },
        saldo: total,
      });
    montar({ cuenta: () => grande('700.01') });
    const { unmount } = renderApp(RUTA);
    await screen.findByRole('button', { name: /Cobrar S\/\s700\.01/ });
    expect(screen.getByText('Más de S/ 700: pide nombre y documento')).toBeVisible();
    expect(screen.getByLabelText('Número de DNI')).toBeVisible();
    unmount();
    montar({ cuenta: () => grande('700.00') });
    renderApp(RUTA);
    await screen.findByRole('button', { name: /Cobrar S\/\s700\.00/ });
    expect(screen.queryByText('Más de S/ 700: pide nombre y documento')).toBeNull();
    expect(screen.queryByLabelText('Número de DNI')).toBeNull();
  });
});

describe('Boleta con RUC (criterio 51, pregunta 15)', () => {
  it('la boleta ofrece DNI, carné, pasaporte y RUC; con RUC pide 11 dígitos válidos y manda el RUC sin dirección', async () => {
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(boton('Agregar datos del cliente'));
    const grupo = screen.getByRole('group', { name: 'Documento del cliente' });
    expect(
      within(grupo)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['DNI', 'Carné de extranjería', 'Pasaporte', 'RUC']);
    await userEvent.click(within(grupo).getByRole('button', { name: 'RUC' }));
    // Es boleta: el campo se llama «Número de RUC», se pide el nombre y no la dirección fiscal.
    expect(screen.queryByLabelText('Dirección fiscal')).toBeNull();
    await userEvent.type(screen.getByLabelText('Número de RUC'), '20100070971');
    await userEvent.type(
      screen.getByLabelText('Nombre del cliente'),
      'Supermercados Peruanos S.A.',
    );
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    expect(cobros(s)).toHaveLength(0);
    expect(await screen.findByText('Escribe un RUC válido de 11 dígitos')).toBeVisible();

    await userEvent.clear(screen.getByLabelText('Número de RUC'));
    await userEvent.type(screen.getByLabelText('Número de RUC'), '20100070970');
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s).comprobante).toEqual({
      tipo: 'BOLETA',
      formato: 'DETALLADO',
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Supermercados Peruanos S.A.',
      },
    });
  });

  it('una boleta de más de S/ 700 también se emite con RUC, y la factura sigue sin elegir documento', async () => {
    const grande = cuenta({
      lineas: [linea(LOMO, 'Banquete', '700.01', 1, '700.01')],
      totales: { ...cuenta().totales, subtotal: '700.01', icbper: '0.00', total: '700.01' },
      saldo: '700.01',
    });
    const s = montar({
      cuenta: () => grande,
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: /Cobrar S\/\s700\.01/ });
    await userEvent.click(boton('RUC'));
    await userEvent.type(screen.getByLabelText('Número de RUC'), '20100070970');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Banquetes del Sur S.A.C.');
    await userEvent.click(boton(/Cobrar S\/\s700\.01/));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s).comprobante.cliente).toEqual({
      tipoDocumento: 'RUC',
      numero: '20100070970',
      nombre: 'Banquetes del Sur S.A.C.',
    });
    // La factura sigue exigiendo RUC, razón social y dirección, sin elegir el documento.
  });

  it('en factura no se elige el documento: es RUC y pide dirección', async () => {
    montar();
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Factura' }));
    expect(screen.queryByRole('group', { name: 'Documento del cliente' })).toBeNull();
    expect(screen.getByLabelText('RUC')).toBeVisible();
    expect(screen.getByLabelText('Dirección fiscal')).toBeVisible();
  });
});

describe('Dividir la cuenta (criterios 64 a 68 y 113)', () => {
  it('por ítems: la parte muestra su total al momento y manda esas unidades', async () => {
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) =>
          json(201, respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo: '31.50' })),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Por ítems' }));
    expect(screen.getByText('Elige al menos una unidad para cobrar.')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Agregar una unidad de Lomo saltado' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Agregar una unidad de Gaseosa 1 L' }),
    );
    expect(await screen.findByRole('button', { name: 'Cobrar S/\u00a037.00' })).toBeVisible();
    await userEvent.click(boton('Cobrar S/\u00a037.00'));
    await screen.findByText('Falta cobrar S/ 31.50');
    expect(entradaDe(s)).toMatchObject({
      total: '37.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: LOMO, cantidad: 1 },
          { itemId: GASEOSA, cantidad: 1 },
        ],
      },
    });
    expect(screen.getByText('La mesa sigue ocupada hasta que se pague todo.')).toBeVisible();
  });

  it('en partes iguales: cada parte sale del dominio, solo por consumo, y se recuerda cuántas faltan', async () => {
    let cobradas = 0;
    const s = montar({
      cuenta: () =>
        cobradas === 0
          ? cuenta()
          : cuenta({
              version: 4,
              cobrado: '34.25',
              saldo: '34.25',
              modo: 'IGUALES',
              cobros: [
                {
                  id: lastId,
                  comprobante: { id: uuid(7000), tipo: 'BOLETA', numero: 'B001-00000124' },
                  total: '34.25',
                  cobradoEn: '2026-11-06T00:10:00.000Z',
                  cobradoPor: PERSONA,
                  detalleParte: detalleDeParte('34.25', 'IGUALES'),
                },
              ],
            }),
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => {
          const entrada = cuerpo as CobroEntrada;
          lastId = entrada.id;
          cobradas += 1;
          return json(
            201,
            respuestaDe(entrada, {
              estado: cobradas === 2 ? 'CERRADA' : 'ABIERTA',
              saldo: cobradas === 2 ? '0.00' : '34.25',
              numero: cobradas === 1 ? 'B001-00000124' : 'B001-00000125',
            }),
          );
        },
      },
    });
    let lastId = uuid(1);
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'Partes iguales' }));
    expect(await screen.findByText(/Cada parte es de S\/ 34\.25/)).toBeVisible();
    // En partes iguales el comprobante solo sale por consumo.
    expect(screen.queryByRole('button', { name: 'Detallado' })).toBeNull();
    await userEvent.click(boton(/Cobrar la parte 1 de 2/));
    await screen.findByText('Parte 1 de 2 de Mesa 4.');
    expect(entradaDe(s, 0)).toMatchObject({
      total: '34.25',
      parte: { tipo: 'IGUALES', partesRestantes: 2 },
      comprobante: { formato: 'CONSUMO' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cobrar la parte 2 de 2' }));
    const segunda = await screen.findByRole('button', { name: /Cobrar la parte 2 de 2/ });
    expect(segunda).toHaveTextContent('S/ 34.25');
    const lista = screen.getByRole('list', { name: 'Partes de la cuenta' });
    expect(within(lista).getByText('Pagada · B001-00000124')).toBeVisible();
    await userEvent.click(segunda);
    await screen.findByText('Parte 2 de 2 de Mesa 4.');
    expect(entradaDe(s, 1)).toMatchObject({
      total: '34.25',
      version: 4,
      parte: { tipo: 'IGUALES', partesRestantes: 1 },
    });
    expect(screen.getByText('Mesa 4 libre')).toBeVisible();
  });

  describe('dividir en partes: los cobros de la cuenta traen su detalle y el equipo recuerda el total de partes', () => {
    const OTRA = { id: uuid(801), nombre: 'Luis Soto' };
    const cobroDe = (n: number, detalle: DetalleParte, numero: string, por = OTRA) => ({
      id: uuid(8000 + n),
      comprobante: { id: uuid(8100 + n), tipo: 'BOLETA' as const, numero },
      total: detalle.totales.total,
      cobradoEn: '2026-11-06T00:10:00.000Z',
      cobradoPor: por,
      detalleParte: detalle,
    });
    /** La parte tal como la calcula el dominio, la misma que la API guarda con el cobro. */
    const parteDe = (
      c: CuentaRespuesta,
      anteriores: DetalleParte[],
      parte: ParteEntrada,
      formato: 'DETALLADO' | 'CONSUMO',
    ): DetalleParte => {
      const r = calcularParte(entradaDeCuenta(c), anteriores, parte, formato);
      if (!r.valida) throw new Error('Se esperaba una parte válida');
      const { valida: _valida, ...detalle } = r;
      return detalle;
    };

    const CLAVE_LOCAL = () =>
      Object.keys(localStorage).filter((k) => k.startsWith('restaurante.cobro.'));

    it('por ítems no deja nada en el equipo: la clave del cobro solo guarda el cobro en curso y la división en partes iguales', async () => {
      montar({
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) =>
            json(201, respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo: '31.50' })),
        },
      });
      renderApp(RUTA);
      await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
      await userEvent.click(screen.getByRole('button', { name: 'Por ítems' }));
      await userEvent.click(
        screen.getByRole('button', { name: 'Agregar una unidad de Lomo saltado' }),
      );
      await userEvent.click(boton('Cobrar S/\u00a028.00'));
      await screen.findByText('Falta cobrar S/ 31.50');
      expect(CLAVE_LOCAL()).toEqual([]);
    });

    it('en partes iguales el equipo recuerda en cuántas se dividió (criterios 65 y 113) y lo borra al cerrar la cuenta', async () => {
      const base = cuenta();
      const primera = parteDe(base, [], { tipo: 'IGUALES', partesRestantes: 3 }, 'CONSUMO');
      const c1 = cuenta({
        version: 4,
        cobrado: primera.totales.total,
        saldo: '45.67',
        modo: 'IGUALES',
        cobros: [cobroDe(0, primera, 'B001-00000124')],
      });
      const segunda = parteDe(c1, [primera], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');
      const c2 = cuenta({
        version: 5,
        cobrado: '45.66',
        saldo: '22.84',
        modo: 'IGUALES',
        cobros: [cobroDe(0, primera, 'B001-00000124'), cobroDe(1, segunda, 'B001-00000125')],
      });
      let hechas = 0;
      const s = montar({
        cuenta: () => (hechas === 0 ? base : hechas === 1 ? c1 : c2),
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) => {
            hechas += 1;
            return json(
              201,
              respuestaDe(cuerpo as CobroEntrada, {
                estado: hechas === 3 ? 'CERRADA' : 'ABIERTA',
                saldo: hechas === 1 ? '45.67' : hechas === 2 ? '22.84' : '0.00',
              }),
            );
          },
        },
      });
      renderApp(RUTA);
      await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
      await userEvent.click(screen.getByRole('button', { name: 'Partes iguales' }));
      await userEvent.click(screen.getByRole('button', { name: 'Agregar uno a partes' }));
      // Elegir cuántas partes ya lo guarda, aunque todavía no se cobre nada.
      const clave = CLAVE_LOCAL();
      expect(clave).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(clave[0]!) ?? '{}')).toMatchObject({
        partesTotales: 3,
      });
      await userEvent.click(await screen.findByRole('button', { name: /Cobrar la parte 1 de 3/ }));
      await screen.findByText('Parte 1 de 3 de Mesa 4.');
      await userEvent.click(screen.getByRole('button', { name: 'Cobrar la parte 2 de 3' }));
      await userEvent.click(
        await screen.findByRole('button', { name: /Cobrar la parte 2 de 3 ·/ }),
      );
      await screen.findByText('Parte 2 de 3 de Mesa 4.');
      expect(JSON.parse(localStorage.getItem(clave[0]!) ?? '{}')).toMatchObject({
        partesTotales: 3,
      });
      await userEvent.click(screen.getByRole('button', { name: 'Cobrar la parte 3 de 3' }));
      await userEvent.click(
        await screen.findByRole('button', { name: /Cobrar la parte 3 de 3 ·/ }),
      );
      await screen.findByText('Parte 3 de 3 de Mesa 4.');
      expect(entradaDe(s, 2)).toMatchObject({ parte: { tipo: 'IGUALES', partesRestantes: 1 } });
      expect(CLAVE_LOCAL()).toEqual([]);
    });

    it('si se recarga la pantalla entre partes, propone las que faltan según el total recordado y no el saldo entero', async () => {
      const base = cuenta();
      const primera = parteDe(base, [], { tipo: 'IGUALES', partesRestantes: 3 }, 'CONSUMO');
      const c1 = cuenta({
        version: 4,
        cobrado: primera.totales.total,
        saldo: '45.67',
        modo: 'IGUALES',
        cobros: [cobroDe(0, primera, 'B001-00000124')],
      });
      const esperada = parteDe(c1, [primera], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');
      let hechas = 0;
      const s = montar({
        cuenta: () => (hechas === 0 ? base : c1),
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) => {
            hechas += 1;
            return json(
              201,
              respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo: '45.67' }),
            );
          },
        },
      });
      const primeraVez = renderApp(RUTA);
      await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
      await userEvent.click(screen.getByRole('button', { name: 'Partes iguales' }));
      await userEvent.click(screen.getByRole('button', { name: 'Agregar uno a partes' }));
      await userEvent.click(await screen.findByRole('button', { name: /Cobrar la parte 1 de 3/ }));
      await screen.findByText('Parte 1 de 3 de Mesa 4.');
      // El equipo se recarga: la pantalla se arma de nuevo con lo que dice la API y lo que el equipo recordó.
      primeraVez.unmount();
      renderApp(RUTA);
      const siguiente = await screen.findByRole('button', { name: /Cobrar la parte 2 de 3/ });
      expect(siguiente).toHaveTextContent(
        (montoEnSoles(esperada.totales.total) ?? '').replace('\u00a0', ' '),
      );
      expect(screen.queryByText(/Ya se cobró 1 parte igual/)).toBeNull();
      const lista = screen.getByRole('list', { name: 'Partes de la cuenta' });
      expect(within(lista).getByText('Pagada · B001-00000124')).toBeVisible();
      expect(within(lista).getByText('Parte 3 de 3')).toBeVisible();
      await userEvent.click(siguiente);
      await screen.findByText('Parte 2 de 3 de Mesa 4.');
      expect(entradaDe(s, 1)).toMatchObject({
        total: esperada.totales.total,
        parte: { tipo: 'IGUALES', partesRestantes: 2 },
      });
    });

    it('por ítems: un cobro de otro equipo no cierra la división y la parte siguiente es la del dominio', async () => {
      const base = cuenta();
      const hecha = parteDe(
        base,
        [],
        { tipo: 'ITEMS', items: [{ itemId: LOMO, cantidad: 1 }] },
        'DETALLADO',
      );
      const conCobro = cuenta({
        version: 5,
        cobrado: hecha.totales.total,
        saldo: '40.50',
        modo: 'ITEMS',
        lineas: base.lineas.map((l) => (l.itemId === LOMO ? { ...l, cantidadFacturada: 1 } : l)),
        cobros: [cobroDe(0, hecha, 'B001-00000007')],
      });
      const esperada = parteDe(
        conCobro,
        [hecha],
        { tipo: 'ITEMS', items: [{ itemId: GASEOSA, cantidad: 1 }] },
        'DETALLADO',
      );
      const s = montar({
        cuenta: () => conCobro,
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) =>
            json(201, respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo: '31.50' })),
        },
      });
      renderApp(RUTA);
      expect(await screen.findByRole('button', { name: 'Cobrar S/\u00a040.50' })).toBeVisible();
      // Ya no hay aviso de «otro equipo» ni se degrada a «solo lo que falta».
      expect(screen.queryByText(/desde otro equipo/)).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Por ítems' }));
      await userEvent.click(
        screen.getByRole('button', { name: 'Agregar una unidad de Gaseosa 1 L' }),
      );
      const total = montoEnSoles(esperada.totales.total) ?? '';
      await userEvent.click(await screen.findByRole('button', { name: `Cobrar ${total}` }));
      await screen.findByText('Falta cobrar S/ 31.50');
      expect(entradaDe(s)).toMatchObject({
        total: esperada.totales.total,
        version: 5,
        parte: { tipo: 'ITEMS', items: [{ itemId: GASEOSA, cantidad: 1 }] },
      });
    });

    it('en partes iguales: la parte 1 se cobró en otro equipo y aquí se confirma en cuántas se dividió antes de cobrar', async () => {
      const base = cuenta();
      const primera = parteDe(base, [], { tipo: 'IGUALES', partesRestantes: 3 }, 'CONSUMO');
      const saldo = (68.5 - Number(primera.totales.total)).toFixed(2);
      const conCobro = cuenta({
        version: 4,
        cobrado: primera.totales.total,
        saldo,
        modo: 'IGUALES',
        cobros: [cobroDe(0, primera, 'B001-00000124')],
      });
      const esperada = parteDe(
        conCobro,
        [primera],
        { tipo: 'IGUALES', partesRestantes: 2 },
        'CONSUMO',
      );
      const s = montar({
        cuenta: () => conCobro,
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) =>
            json(201, respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo })),
        },
      });
      renderApp(RUTA);
      // Este equipo no sabe en cuántas partes se dividió: lo dice y pide confirmarlo; no propone cobrar el saldo entero.
      expect(await screen.findByText('Ya se cobró 1 parte igual de esta cuenta')).toBeVisible();
      expect(screen.queryByRole('button', { name: /Cobrar la parte/ })).toBeNull();
      expect(boton('Cobrar')).toBeDisabled();
      expect(screen.getByText('Confirma en cuántas partes se dividió la cuenta.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Por ítems' })).toBeNull();
      const cobradas = screen.getByRole('list', { name: 'Partes ya cobradas' });
      expect(within(cobradas).getByText('Pagada · B001-00000124')).toBeVisible();
      expect(CLAVE_LOCAL()).toEqual([]);
      // La persona dice que fueron 3 en total (el contador no parte del saldo entero: arranca en 3).
      await userEvent.click(boton('Se dividió en 3 partes'));
      const total = montoEnSoles(esperada.totales.total) ?? '';
      const boton3 = await screen.findByRole('button', { name: /Cobrar la parte 2 de 3/ });
      expect(boton3).toHaveTextContent(total.replace('\u00a0', ' '));
      expect(screen.queryByText('Ya se cobró 1 parte igual de esta cuenta')).toBeNull();
      expect(JSON.parse(localStorage.getItem(CLAVE_LOCAL()[0]!) ?? '{}')).toMatchObject({
        partesTotales: 3,
      });
      await userEvent.click(boton3);
      await screen.findByText('Parte 2 de 3 de Mesa 4.');
      expect(entradaDe(s)).toMatchObject({
        total: esperada.totales.total,
        version: 4,
        parte: { tipo: 'IGUALES', partesRestantes: 2 },
        comprobante: { formato: 'CONSUMO' },
      });
    });

    it('si otro equipo cobra una parte mientras tanto, las que faltan aquí se ajustan y no se divide de más', async () => {
      const base = cuenta();
      const primera = parteDe(base, [], { tipo: 'IGUALES', partesRestantes: 3 }, 'CONSUMO');
      const c1 = cuenta({
        version: 4,
        cobrado: primera.totales.total,
        saldo: '45.67',
        modo: 'IGUALES',
        cobros: [cobroDe(0, primera, 'B001-00000124', PERSONA)],
      });
      const segunda = parteDe(c1, [primera], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');
      // Tras el cobro de esta pantalla (parte 1), la cuenta ya trae también la parte 2 cobrada por otro equipo.
      const c2 = cuenta({
        version: 6,
        cobrado: '45.66',
        saldo: '22.84',
        modo: 'IGUALES',
        cobros: [
          cobroDe(0, primera, 'B001-00000124', PERSONA),
          cobroDe(1, segunda, 'B002-00000031'),
        ],
      });
      const ultima = parteDe(
        c2,
        [primera, segunda],
        { tipo: 'IGUALES', partesRestantes: 1 },
        'CONSUMO',
      );
      let cobrado = false;
      const s = montar({
        cuenta: () => (cobrado ? c2 : base),
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) => {
            cobrado = true;
            return json(
              201,
              respuestaDe(cuerpo as CobroEntrada, { estado: 'ABIERTA', saldo: '45.67' }),
            );
          },
        },
      });
      renderApp(RUTA);
      await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
      await userEvent.click(screen.getByRole('button', { name: 'Partes iguales' }));
      await userEvent.click(screen.getByRole('button', { name: 'Agregar uno a partes' }));
      await userEvent.click(await screen.findByRole('button', { name: /Cobrar la parte 1 de 3/ }));
      await screen.findByText('Parte 1 de 3 de Mesa 4.');
      await userEvent.click(screen.getByRole('button', { name: 'Cobrar la parte 2 de 3' }));
      // La parte 2 ya se cobró en otro equipo: lo que sigue es la 3 de 3, con lo que queda.
      const ultimaParte = await screen.findByRole('button', { name: /Cobrar la parte 3 de 3/ });
      expect(ultimaParte).toHaveTextContent(
        (montoEnSoles(ultima.totales.total) ?? '').replace('\u00a0', ' '),
      );
      await userEvent.click(ultimaParte);
      await screen.findByText('Parte 3 de 3 de Mesa 4.');
      expect(entradaDe(s, 1)).toMatchObject({
        total: ultima.totales.total,
        parte: { tipo: 'IGUALES', partesRestantes: 1 },
      });
    });
  });
});

describe('El id del cobro y los errores (criterios 54, 55, 57 y 114)', () => {
  it('«Reintentar» repite el mismo id hasta una respuesta final', async () => {
    let intentos = 0;
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => {
          intentos += 1;
          return intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, respuestaDe(cuerpo as CobroEntrada));
        },
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    expect(await screen.findByText(/no sabemos si el cobro se hizo/)).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: /Reintentar el cobro/ }));
    await screen.findByText(/Boleta · /);
    expect(cobros(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
    expect(cobros(s)[1]?.cabeceras.get('Idempotency-Key')).toBe(entradaDe(s, 0).id);
  });

  it('con una respuesta final (422) suelta el id: el siguiente intento es otro cobro', async () => {
    let intentos = 0;
    const s = montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => {
          intentos += 1;
          return intentos === 1
            ? json(409, { codigo: 'SIN_SERIE', mensaje: 'Sin serie' })
            : json(201, respuestaDe(cuerpo as CobroEntrada));
        },
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    expect(await screen.findByText(/Ajustes › Cajas/)).toBeVisible();
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
  });

  it('CUENTA_CAMBIO: recarga la cuenta, muestra el total nuevo, conserva los pagos y deja confirmar', async () => {
    let agregado = false;
    const s = montar({
      cuenta: () =>
        agregado
          ? cuenta({
              version: 4,
              lineas: [
                linea(LOMO, 'Lomo saltado', '28.00', 2, '56.00'),
                linea(GASEOSA, 'Gaseosa 1 L', '9.00', 2, '18.00'),
                linea(BOLSA, 'Bolsa plástica', '0.20', 5, '1.00', true),
              ],
              totales: { ...cuenta().totales, subtotal: '75.00', total: '77.50' },
              saldo: '77.50',
            })
          : cuenta(),
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) => {
          const entrada = cuerpo as CobroEntrada;
          if (entrada.version === 3) {
            agregado = true;
            return json(409, { codigo: 'CUENTA_CAMBIO', mensaje: 'Cambió', version: 4 });
          }
          return json(201, respuestaDe(entrada));
        },
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(screen.getByRole('button', { name: 'S/\u00a0100' }));
    await userEvent.click(boton('Cobrar S/\u00a068.50'));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('La cuenta cambió');
    expect(aviso).toHaveTextContent('Lo que escribiste sigue aquí');
    expect(await screen.findByRole('button', { name: 'Cobrar S/\u00a077.50' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('El total ahora es S/ 77.50');
    // Los pagos escritos siguen: lo recibido, y el efectivo ya con el total nuevo.
    expect(screen.getByLabelText('Recibido')).toHaveValue('100.00');
    expect(screen.getByText('Efectivo a cobrar').nextSibling).toHaveTextContent('S/ 77.50');

    await userEvent.click(boton('Cobrar S/\u00a077.50'));
    await screen.findByText(/Boleta · /);
    expect(entradaDe(s, 1)).toMatchObject({
      version: 4,
      total: '77.50',
      pagos: [{ medio: 'EFECTIVO', monto: '77.50', recibido: '100.00' }],
    });
  });

  it('ORDEN_NO_ABIERTA de una cuenta unida lleva a la principal', async () => {
    const principal = uuid(905);
    montar({
      extra: {
        [`POST ${API_COBROS}`]: () =>
          json(409, { codigo: 'ORDEN_NO_ABIERTA', mensaje: 'Unida', ordenId: principal }),
      },
    });
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    const enlace = await screen.findByRole('link', { name: 'Ir a la cuenta principal' });
    expect(enlace).toHaveAttribute('href', `/caja/cuentas/${principal}/cobrar`);
  });
});

describe('Ítems sin enviar en este equipo (criterio 60)', () => {
  it('avisa antes de cobrar si el equipo tiene un borrador de esta cuenta', async () => {
    localStorage.setItem(
      claveDeBorrador(ID.empresa, ID.usuario, ORDEN),
      JSON.stringify({
        lineas: [
          {
            clave: 'l1',
            productoId: uuid(5),
            nombre: 'Chicha',
            modificadores: [],
            cantidad: 1,
            observacion: '',
            tiempo: 1,
            paraLlevar: false,
            precioUnitario: '8.00',
          },
        ],
        envioId: null,
      }),
    );
    montar();
    renderApp(RUTA);
    expect(await screen.findByText('Hay ítems sin enviar en este equipo')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir a la cuenta de la mesa' })).toHaveAttribute(
      'href',
      `/salon/ordenes/${ORDEN}`,
    );
  });

  it('sin borrador no hay aviso', async () => {
    montar();
    renderApp(RUTA);
    await screen.findByRole('button', { name: 'Cobrar S/\u00a068.50' });
    expect(screen.queryByText('Hay ítems sin enviar en este equipo')).toBeNull();
  });
});

describe('Entradas al cobro (criterio 111)', () => {
  it('la cuenta de la caja lleva «Cobrar» con el saldo y abre el cobro', async () => {
    montar();
    renderApp(`/caja/cuentas/${ORDEN}`);
    const enlace = await screen.findByRole('link', { name: /Cobrar S\/\s68\.50/ });
    expect(enlace).toHaveAttribute('href', RUTA);
  });

  it('la cuenta de la mesa lleva «Cobrar» para el Cajero con el plan de Caja, y no para el Mozo', async () => {
    const orden = ordenDeMesa(4, {
      total: '65.00',
      items: [itemDeOrden(1, { cantidad: 2, cantidadVigente: 2, totalVigente: '56.00' })],
    });
    const base = {
      'GET /ordenes/*': () => json(200, orden),
      'GET /carta/sucursal': () => json(200, cartaDeEjemplo(), { ETag: '"c1"' }),
    };
    servidor({
      ...base,
      'GET /sesion': () =>
        json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'COCINA', 'CAJA'] })),
    });
    const { unmount } = renderApp(`/salon/ordenes/${ORDEN}`);
    const enlace = await screen.findByRole('link', { name: 'Cobrar' });
    expect(enlace).toHaveAttribute('href', RUTA);
    unmount();
    servidor({
      ...base,
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: ['SALON', 'CAJA'] })),
    });
    renderApp(`/salon/ordenes/${ORDEN}`);
    await screen.findByRole('button', { name: 'Pedir pre-cuenta' });
    expect(screen.queryByRole('link', { name: 'Cobrar' })).toBeNull();
  });
});

describe('La impresión del comprobante (criterios 90, 96 y 114)', () => {
  const TRABAJO = uuid(960);
  const API_IMPRESION = `/comprobantes/${uuid(7000)}/impresiones`;
  const trabajos = () =>
    json(
      200,
      [TRABAJO, uuid(961)].map((id) => ({
        id,
        tipo: 'COMPROBANTE',
        impresora: { id: uuid(60), nombre: 'Epson de caja' },
        mesa: '4',
        estado: 'PENDIENTE',
        intentos: 0,
        creadoEn: '2026-11-05T00:10:00.000Z',
        impresoEn: null,
        reimpresionDe: null,
        ordenId: ORDEN,
        envioNumero: null,
      })),
    );

  async function cobrarEnEfectivo(s: ReturnType<typeof montar>) {
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'S/\u00a0100' }));
    await userEvent.click(boton('Cobrar S/\u00a068.50'));
    await screen.findByText('Boleta · B001-00000001');
    return s;
  }

  const montarConImpresora = (extra: Record<string, Manejador> = {}) =>
    montar({
      extra: {
        [`POST ${API_COBROS}`]: ({ cuerpo }) =>
          json(201, respuestaDe(cuerpo as CobroEntrada, { trabajoId: TRABAJO })),
        'GET /impresion/trabajos': trabajos,
        ...extra,
      },
    });

  it('dice «Imprimiendo en <impresora>» cuando el ticket quedó en cola', async () => {
    await cobrarEnEfectivo(montarConImpresora());
    expect(await screen.findByText('Imprimiendo en Epson de caja')).toBeVisible();
    expect(screen.queryByText('Sin impresora de caja')).toBeNull();
  });

  it('sin impresora de caja lo dice, con la salida para quien no administra', async () => {
    await cobrarEnEfectivo(
      montar({
        extra: {
          [`POST ${API_COBROS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as CobroEntrada)),
        },
      }),
    );
    expect(screen.getByText('Sin impresora de caja')).toBeVisible();
    expect(screen.getByText('El Administrador puede elegirla en Ajustes › Cajas.')).toBeVisible();
    // El cobro ya está hecho: «Imprimir otra vez» sigue ofrecido.
    expect(boton('Imprimir otra vez')).toBeEnabled();
  });

  it('«Imprimir otra vez» pide una copia del comprobante con su clave de idempotencia y la dice', async () => {
    const s = montarConImpresora({
      [`POST ${API_IMPRESION}`]: () => json(201, { trabajoId: uuid(961), impresion: 'EN_COLA' }),
    });
    await cobrarEnEfectivo(s);
    await userEvent.click(boton('Imprimir otra vez'));
    expect(await screen.findByText('Imprimiendo otra copia en Epson de caja')).toBeVisible();
    const llamada = s.de('POST', API_IMPRESION)[0];
    expect(llamada?.cuerpo).toBeUndefined();
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/\S/);
    // Otra copia es una impresión nueva: lleva otra clave.
    await userEvent.click(boton('Imprimir otra vez'));
    await waitFor(() => expect(s.de('POST', API_IMPRESION)).toHaveLength(2));
    expect(s.de('POST', API_IMPRESION)[1]?.cabeceras.get('Idempotency-Key')).not.toBe(
      llamada?.cabeceras.get('Idempotency-Key'),
    );
  });

  it('si la caja ya no tiene impresora (409) lo dice en palabras y no pierde el resultado del cobro', async () => {
    const s = montarConImpresora({
      [`POST ${API_IMPRESION}`]: () =>
        json(409, { codigo: 'SIN_IMPRESORA', mensaje: 'La caja no tiene impresora' }),
    });
    await cobrarEnEfectivo(s);
    await userEvent.click(boton('Imprimir otra vez'));
    expect(await screen.findByText('No pudimos imprimir otra vez')).toBeVisible();
    expect(screen.getByText(/Esta caja no tiene impresora/)).toBeVisible();
    expect(screen.getByText('Boleta · B001-00000001')).toBeVisible();
    expect(screen.getByText('Mesa 4 libre')).toBeVisible();
  });

  it('reintentar tras un fallo usa la misma clave: si la primera sí llegó, no sale otra copia', async () => {
    let intento = 0;
    const s = montarConImpresora({
      [`POST ${API_IMPRESION}`]: () => {
        intento += 1;
        return intento === 1
          ? json(403, { codigo: 'PROHIBIDO', mensaje: 'No' })
          : json(201, { trabajoId: uuid(961), impresion: 'EN_COLA' });
      },
    });
    await cobrarEnEfectivo(s);
    await userEvent.click(boton('Imprimir otra vez'));
    expect(await screen.findByText(/Solo quien cobró en este turno/)).toBeVisible();
    await userEvent.click(boton('Imprimir otra vez'));
    await screen.findByText(/Imprimiendo otra copia/);
    const llamadas = s.de('POST', API_IMPRESION);
    expect(llamadas[1]?.cabeceras.get('Idempotency-Key')).toBe(
      llamadas[0]?.cabeceras.get('Idempotency-Key'),
    );
  });
});
