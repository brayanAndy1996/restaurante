import type {
  AutorizacionRespuesta,
  ComprobanteDetalle,
  NotaCreditoEntrada,
  NotaCreditoRespuesta,
  TurnoRespuesta,
} from '@restaurante/contratos';
import type { Rol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { boletaAceptada, comprobanteDe, detalleDe, lineaDeComprobante } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 143 a 153 y 177 en la interfaz (pruebas no protegidas de la hoja de la nota de
// crédito): lo que se autoriza es lo que se manda, la clave vuelve a pedirse sin perder lo escrito, el `id` se conserva
// hasta una respuesta final, la devolución sale del turno propio y el cambio a factura lleva el cliente.

const MODULOS = ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] as const;
const BOLETA = uuid(7000);
const NOTA = uuid(7100);
const FACTURA_NUEVA = uuid(7200);
const TURNO = uuid(300);
const RUTA = `/caja/comprobantes/${BOLETA}`;
const API_BOLETA = `/facturacion/comprobantes/${BOLETA}`;
const API_NOTAS = '/notas-credito';
const RUC = '20100070970';
const PERSONA = { id: uuid(70), nombre: 'Rosa Quispe' };

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turno: TurnoRespuesta = {
  id: TURNO,
  caja: { id: uuid(101), nombre: 'Caja 1' },
  responsable: { id: ID.usuario, nombre: 'Marta Pérez' },
  estado: 'ABIERTO',
  abiertoEn: '2026-11-05T23:02:00.000Z',
  diaOperativo: '2026-11-05',
  fondo: '200.00',
  cerradoEn: null,
  cerradoPor: null,
};

const autorizada = (extra: Partial<AutorizacionRespuesta> = {}): AutorizacionRespuesta => ({
  autorizacionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accion: 'EMITIR_NOTA_CREDITO',
  autorizadoPor: PERSONA,
  expiraEn: new Date(Date.now() + 120_000).toISOString(),
  ...extra,
});

/** Lo que responde la API a una nota emitida: la nota (y la factura de un cambio) con lo que se devolvió. */
function respuestaDe(
  entrada: NotaCreditoEntrada,
  extra: Partial<NotaCreditoRespuesta> = {},
): NotaCreditoRespuesta {
  const devolucion = entrada.devolucion ?? null;
  return {
    id: entrada.id,
    nota: comprobanteDe({
      id: NOTA,
      tipo: 'NOTA_CREDITO_BOLETA',
      serie: 'BC01',
      correlativo: 3,
      numero: 'BC01-00000003',
      estado: 'POR_ENVIAR',
      afectaA: { id: BOLETA, tipo: 'BOLETA', numero: 'B001-00000124' },
    }),
    factura: null,
    devolucion: devolucion
      ? {
          total: devolucion.pagos.reduce((s, p) => s + Number(p.monto), 0).toFixed(2),
          redondeo: devolucion.redondeo,
          pagos: devolucion.pagos.map((p) => ({
            medio: p.medio,
            monto: p.monto,
            operacion: p.operacion ?? null,
          })),
          movimientoIds: [uuid(8100)],
        }
      : null,
    impresion: 'SIN_IMPRESORA',
    trabajoIds: [],
    ...extra,
  };
}

type Manejador = Parameters<typeof servidor>[0][string];

function montar(
  opciones: {
    rol?: Rol;
    comprobante?: ComprobanteDetalle;
    turno?: TurnoRespuesta | null;
    extra?: Record<string, Manejador>;
  } = {},
) {
  const estado = {
    comprobante: opciones.comprobante ?? boletaAceptada({ id: BOLETA, numero: 'B001-00000124' }),
  };
  const s = servidor({
    'GET /sesion': () =>
      json(200, sesionDeRol(opciones.rol ?? 'CAJERO', { modulos: [...MODULOS] })),
    [`GET ${API_BOLETA}`]: () => json(200, estado.comprobante),
    [`GET /facturacion/comprobantes/${NOTA}`]: () =>
      json(200, detalleDe({ id: NOTA, tipo: 'NOTA_CREDITO_BOLETA', numero: 'BC01-00000003' })),
    [`GET /facturacion/comprobantes/${FACTURA_NUEVA}`]: () =>
      json(200, detalleDe({ id: FACTURA_NUEVA, tipo: 'FACTURA', numero: 'F001-00000031' })),
    'GET /turnos/mio': () =>
      opciones.turno === null
        ? json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay turno' })
        : json(200, opciones.turno ?? turno),
    ...(opciones.extra ?? {}),
  });
  return Object.assign(s, { estado });
}

const notas = (s: ReturnType<typeof montar>) => s.de('POST', API_NOTAS);
const cuerpoDe = (s: ReturnType<typeof montar>, n = 0) => notas(s)[n]?.cuerpo as NotaCreditoEntrada;

/** Abre la hoja desde el detalle y la devuelve. */
async function abrirLaHoja() {
  await userEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }));
  return screen.findByRole('dialog', { name: 'Nota de crédito' });
}

async function pin(digitos: string) {
  const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
  for (const d of digitos) await userEvent.click(within(ventana).getByRole('button', { name: d }));
}

const masDe = (hoja: HTMLElement, linea: string) =>
  userEvent.click(within(hoja).getByRole('button', { name: `Agregar una unidad de ${linea}` }));

/** Una devolución de 1 Lomo con el motivo de un toque: lista para emitir. */
async function devolverUnLomo(hoja: HTMLElement) {
  await masDe(hoja, 'Lomo saltado');
  await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
}

describe('Quién ve «Nota de crédito» y cuándo (criterios 143, 146, 169 y 177)', () => {
  it('el Cajero, el Supervisor y el Administrador la ven en un comprobante aceptado', async () => {
    for (const rol of ['CAJERO', 'SUPERVISOR', 'ADMINISTRADOR'] as const) {
      montar({ rol });
      const { unmount } = renderApp(RUTA);
      expect(await screen.findByRole('button', { name: 'Nota de crédito' })).toBeVisible();
      unmount();
    }
  });

  it('un comprobante rechazado, anulado, por enviar o que es una nota no la ofrece', async () => {
    for (const comprobante of [
      boletaAceptada({ id: BOLETA, estado: 'RECHAZADO' }),
      boletaAceptada({ id: BOLETA, estado: 'ANULADO' }),
      boletaAceptada({ id: BOLETA, estado: 'POR_ENVIAR' }),
      boletaAceptada({ id: BOLETA, tipo: 'NOTA_CREDITO_BOLETA' }),
    ]) {
      montar({ comprobante });
      const { unmount } = renderApp(RUTA);
      await screen.findByText('Datos');
      expect(screen.queryByRole('button', { name: 'Nota de crédito' })).toBeNull();
      unmount();
    }
  });

  it('un comprobante que no es de los turnos del Cajero (403) no abre nada', async () => {
    montar({
      extra: {
        [`GET ${API_BOLETA}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'No es tuyo' }),
      },
    });
    renderApp(RUTA);
    expect(await screen.findByText('Este comprobante no es de tus turnos.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Nota de crédito' })).toBeNull();
  });

  it('con todo lo devolvible ya devuelto no queda nada que ofrecer', async () => {
    montar({
      comprobante: boletaAceptada({
        id: BOLETA,
        notasCredito: [
          {
            id: uuid(7101),
            tipo: 'DEVOLUCION',
            numero: 'BC01-00000001',
            estado: 'ACEPTADO',
            total: '66.20',
          },
        ],
        acreditado: [
          {
            posicion: 1,
            cantidad: 2,
            neto: '56.00',
            base: '47.46',
            igv: '8.54',
            bolsas: 0,
            icbper: '0.00',
          },
          {
            posicion: 2,
            cantidad: 1,
            neto: '9.00',
            base: '7.63',
            igv: '1.37',
            bolsas: 0,
            icbper: '0.00',
          },
          {
            posicion: 3,
            cantidad: 2,
            neto: '0.20',
            base: '0.17',
            igv: '0.03',
            bolsas: 2,
            icbper: '1.00',
          },
        ],
      }),
    });
    renderApp(RUTA);
    await screen.findByText('Datos');
    expect(screen.queryByRole('button', { name: 'Nota de crédito' })).toBeNull();
  });
});

describe('Los tipos y las líneas (criterios 143, 147, 148 y 177)', () => {
  it('ofrece Anular, Devolver ítems y Cambiar a factura, y la anulación acredita todo el comprobante', async () => {
    montar({ rol: 'SUPERVISOR' });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    const tipos = within(hoja).getByRole('group', { name: 'Qué quieres hacer' });
    expect(within(tipos).getByRole('button', { name: 'Anular', pressed: true })).toBeVisible();
    expect(within(tipos).getByRole('button', { name: 'Devolver ítems' })).toBeVisible();
    expect(within(tipos).getByRole('button', { name: 'Cambiar a factura' })).toBeVisible();
    expect(
      within(hoja).getByText('Se anula el comprobante completo, con todas sus líneas.'),
    ).toBeVisible();
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 66.20');
    expect(within(hoja).queryByRole('list', { name: 'Líneas del comprobante' })).toBeNull();
  });

  it('devolver ítems: − y + hasta lo que falta, el total sale de calcularNotaCredito y la cortesía no se devuelve', async () => {
    montar({
      rol: 'SUPERVISOR',
      comprobante: boletaAceptada({
        id: BOLETA,
        notasCredito: [
          {
            id: uuid(7101),
            tipo: 'DEVOLUCION',
            numero: 'BC01-00000001',
            estado: 'ACEPTADO',
            total: '28.00',
          },
        ],
        acreditado: [
          {
            posicion: 1,
            cantidad: 1,
            neto: '28.00',
            base: '23.73',
            igv: '4.27',
            bolsas: 0,
            icbper: '0.00',
          },
        ],
      }),
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    // Con una nota que cuenta, solo se devuelve lo que queda.
    expect(within(hoja).queryByRole('group', { name: 'Qué quieres hacer' })).toBeNull();
    expect(
      within(hoja).getByText(
        'Este comprobante ya tiene notas de crédito: lo que queda se devuelve por ítems.',
      ),
    ).toBeVisible();
    const lista = within(hoja).getByRole('list', { name: 'Líneas del comprobante' });
    expect(within(lista).getByText('Cobraste 2 · ya devuelto 1 · faltan 1')).toBeVisible();
    expect(within(lista).getByText('Cortesía: no se devuelve')).toBeVisible();
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('—');
    expect(within(hoja).getByText('Elige al menos una unidad para devolver.')).toBeVisible();
    expect(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' })).toBeDisabled();

    // Sube hasta lo que falta del Lomo (1) y no pasa de ahí.
    await masDe(hoja, 'Lomo saltado');
    await masDe(hoja, 'Lomo saltado');
    expect(within(hoja).getByRole('group', { name: 'Cantidad de Lomo saltado' })).toHaveTextContent(
      '× 1',
    );
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 28.00');
    // La última unidad que falta cierra la base y el IGV del original.
    expect(within(hoja).getByText(/Incluye IGV S\/ 4\.27/)).toBeVisible();

    expect(within(hoja).getByText(/· 1 unidad$/)).toBeVisible();
    // Una bolsa: S/ 0.10 más su ICBPER de S/ 0.50.
    await masDe(hoja, 'Bolsa plástica');
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 28.60');
    expect(within(hoja).getByText(/· 2 unidades$/)).toBeVisible();
    await userEvent.click(
      within(hoja).getByRole('button', { name: 'Quitar una unidad de Lomo saltado' }),
    );
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 0.60');
  });

  it('una factura no ofrece cambiar a factura, ni un emisor del Nuevo RUS', async () => {
    montar({ rol: 'SUPERVISOR', comprobante: boletaAceptada({ id: BOLETA, tipo: 'FACTURA' }) });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    const tipos = within(hoja).getByRole('group', { name: 'Qué quieres hacer' });
    expect(within(tipos).queryByRole('button', { name: 'Cambiar a factura' })).toBeNull();
    expect(within(tipos).getByRole('button', { name: 'Anular' })).toBeVisible();
  });
});

describe('La ventana de clave muestra lo que se autoriza y manda exactamente eso (criterio 145)', () => {
  it('devolución: el objetivo de POST /autorizaciones es el de la ventana, la nota lo repite y la clave viaja en X-Autorizacion', async () => {
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await devolverUnLomo(hoja);
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 28.00');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));

    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent(
      'Nota de crédito · Devolución · B001-00000124 · S/ 28.00 · devuelve S/ 28.00 en efectivo',
    );
    expect(ventana).toHaveTextContent('Motivo: Producto en mal estado');
    await pin('123456');

    await waitFor(() => expect(notas(s)).toHaveLength(1));
    const objetivo = {
      tipo: 'NOTA_CREDITO',
      comprobanteId: BOLETA,
      tipoNota: 'DEVOLUCION',
      total: '28.00',
      devuelto: '28.00',
    };
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toEqual({
      accion: 'EMITIR_NOTA_CREDITO',
      motivo: 'Producto en mal estado',
      pin: '123456',
      objetivo,
    });
    const llamada = notas(s)[0]!;
    // Lo que se emite es lo que se autorizó: el mismo total y lo devuelto es la suma de los pagos.
    expect(llamada.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      comprobanteId: BOLETA,
      tipo: 'DEVOLUCION',
      motivo: 'Producto en mal estado',
      total: '28.00',
      lineas: [{ posicion: 1, cantidad: 1 }],
      devolucion: {
        turnoId: TURNO,
        pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
        redondeo: '0.00',
      },
    });
    expect(llamada.cabeceras.get('X-Autorizacion')).toBe(autorizada().autorizacionId);
    expect(llamada.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    // El resultado: la nota con su estado en vivo y lo devuelto por medio.
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText('Devolución de boleta B001-00000124.')).toBeVisible();
    expect(screen.getByText('BC01-00000003')).toBeVisible();
    expect(await screen.findByText('Enviando a SUNAT…')).toBeVisible();
    const devuelto = screen.getByLabelText('Lo que se devolvió');
    expect(within(devuelto).getByText('Devuelto en efectivo').nextSibling).toHaveTextContent(
      'S/ 28.00',
    );
    expect(screen.getByText('Sin impresora de caja')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver la nota de crédito' })).toHaveAttribute(
      'href',
      `/caja/comprobantes/${NOTA}`,
    );
  });

  it('una anulación sin turno: «Sin devolución», devuelto «0.00» en el objetivo y devolucion: null en el cuerpo', async () => {
    const s = montar({
      turno: null,
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    expect(
      await within(hoja).findByText('Sin devolución: no tienes la caja abierta'),
    ).toBeVisible();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent(
      'Nota de crédito · Anulación · B001-00000124 · S/ 66.20 · sin devolución',
    );
    await pin('123456');
    await waitFor(() => expect(notas(s)).toHaveLength(1));
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toMatchObject({
      objetivo: {
        tipo: 'NOTA_CREDITO',
        comprobanteId: BOLETA,
        tipoNota: 'ANULACION',
        total: '66.20',
        devuelto: '0.00',
      },
    });
    expect(cuerpoDe(s)).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      comprobanteId: BOLETA,
      tipo: 'ANULACION',
      motivo: 'Error al cobrar',
      total: '66.20',
      devolucion: null,
    });
    expect(await screen.findByText('Ninguna')).toBeVisible();
  });

  it('el Supervisor emite sin clave', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    expect(within(hoja).queryByText('Hace falta la clave de un supervisor')).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
    expect(notas(s)[0]?.cabeceras.get('X-Autorizacion')).toBeNull();
  });

  it('cerrar la ventana de la clave no manda nada y deja lo escrito', async () => {
    const s = montar();
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await devolverUnLomo(hoja);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    await userEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull(),
    );
    expect(notas(s)).toHaveLength(0);
    expect(within(hoja).getByLabelText('Motivo')).toHaveValue('Producto en mal estado');
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 28.00');
  });

  it('un 403 AUTORIZACION_INVALIDA vuelve a pedir la clave sin perder lo escrito, con el mismo id', async () => {
    let intentos = 0;
    let autorizaciones = 0;
    const s = montar({
      extra: {
        'POST /autorizaciones': () =>
          json(
            201,
            autorizada({
              autorizacionId: `dddddddd-dddd-4ddd-8ddd-dddddddddd0${++autorizaciones}`,
            }),
          ),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'La clave ya no vale' })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await devolverUnLomo(hoja);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');

    // La API dijo que la clave no valía: se pide otra vez, con lo mismo de antes en la hoja.
    await waitFor(() => expect(notas(s)).toHaveLength(1));
    const otra = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(otra).toHaveTextContent(
      'Nota de crédito · Devolución · B001-00000124 · S/ 28.00 · devuelve S/ 28.00 en efectivo',
    );
    expect(await screen.findByText('Falta una clave nueva')).toBeVisible();
    expect(within(hoja).getByLabelText('Motivo')).toHaveValue('Producto en mal estado');
    expect(within(hoja).getByRole('group', { name: 'Cantidad de Lomo saltado' })).toHaveTextContent(
      '× 1',
    );
    await pin('654321');

    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(2);
    expect(notas(s)).toHaveLength(2);
    // Es la misma nota: el mismo id, con la clave nueva.
    expect(cuerpoDe(s, 1).id).toBe(cuerpoDe(s, 0).id);
    expect(notas(s)[0]?.cabeceras.get('X-Autorizacion')).toBe(
      'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    );
    expect(notas(s)[1]?.cabeceras.get('X-Autorizacion')).toBe(
      'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    );
  });
});

describe('La devolución desde el turno propio (criterios 21 y 150)', () => {
  it('una anulación de S/ 33.34 devuelta en efectivo: S/ 33.30 y redondeo S/ 0.04 a la vista', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      comprobante: boletaAceptada({
        id: BOLETA,
        numero: 'B001-00000124',
        lineas: [
          lineaDeComprobante({
            descripcion: 'Ceviche mixto',
            precioUnitario: '33.34',
            bruto: '33.34',
            neto: '33.34',
            base: '28.25',
            igv: '5.09',
          }),
        ],
        totales: {
          subtotal: '33.34',
          descuentos: '0.00',
          operaciones: {
            gravadas: '28.25',
            exoneradas: '0.00',
            inafectas: '0.00',
            gratuitas: '0.00',
          },
          igv: '5.09',
          igvGratuitas: '0.00',
          icbper: '0.00',
          total: '33.34',
        },
      }),
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    expect(await within(hoja).findByText('Efectivo a devolver')).toBeVisible();
    expect(within(hoja).getByText('Efectivo a devolver').nextSibling).toHaveTextContent('S/ 33.30');
    expect(
      within(hoja)
        .getByText(/Redondeo:/)
        .closest('p'),
    ).toHaveTextContent('Redondeo: S/ 0.04. El efectivo se devuelve a la décima de sol.');
    // Devolver no da vuelto: no hay «Recibido» ni billetes.
    expect(within(hoja).queryByLabelText('Recibido')).toBeNull();
    expect(within(hoja).queryByRole('button', { name: 'Exacto' })).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s).devolucion).toEqual({
      turnoId: TURNO,
      pagos: [{ medio: 'EFECTIVO', monto: '33.30' }],
      redondeo: '0.04',
    });
    expect(cuerpoDe(s).total).toBe('33.34');
  });

  it('varios medios: el efectivo cubre el resto, el Yape lleva su número de operación y el objetivo suma lo devuelto', async () => {
    const s = montar({
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await devolverUnLomo(hoja);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver por otro medio' }));
    // El segundo pago es Yape; se devuelven S/ 10.00 por ahí y el resto en efectivo.
    await userEvent.type(within(hoja).getByLabelText('Monto del pago 2'), '10');
    await userEvent.type(within(hoja).getByLabelText('Número de operación'), 'OP-123');
    expect(within(hoja).getByText('Efectivo a devolver').nextSibling).toHaveTextContent('S/ 18.00');

    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('devuelve S/ 28.00 en efectivo y Yape');
    await pin('123456');
    await waitFor(() => expect(notas(s)).toHaveLength(1));
    expect(cuerpoDe(s).devolucion).toEqual({
      turnoId: TURNO,
      pagos: [
        { medio: 'EFECTIVO', monto: '18.00' },
        { medio: 'YAPE', monto: '10.00', operacion: 'OP-123' },
      ],
      redondeo: '0.00',
    });
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toMatchObject({
      objetivo: { total: '28.00', devuelto: '28.00' },
    });
  });

  it('un Yape sin número de operación no se manda y lo dice', async () => {
    const s = montar({ rol: 'SUPERVISOR' });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Yape' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await within(hoja).findByText('Escribe el número de operación del Yape.')).toBeVisible();
    expect(notas(s)).toHaveLength(0);
  });

  it('«Sin devolución» con turno abierto emite la nota sin mover dinero de la caja', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Sin devolución' }));
    expect(within(hoja).getByText('La nota se emite sin mover dinero de tu caja.')).toBeVisible();
    expect(within(hoja).queryByText('Cómo devuelves')).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s).devolucion).toBeNull();
  });
});

describe('El motivo es obligatorio', () => {
  it('sin motivo no se pide la clave ni se manda, y lo marca', async () => {
    const s = montar({ rol: 'SUPERVISOR' });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await within(hoja).findByText('Elige o escribe el motivo')).toBeVisible();
    expect(notas(s)).toHaveLength(0);
    // Un motivo escrito a mano también vale.
    await userEvent.type(within(hoja).getByLabelText('Motivo'), 'El cliente se equivocó de local');
    expect(within(hoja).queryByText('Elige o escribe el motivo')).toBeNull();
  });
});

describe('El id se conserva hasta una respuesta final (criterio 153)', () => {
  it('tras un 500 el siguiente toque repite el mismo id y la misma clave de idempotencia; al salir la nota, la siguiente es otra', async () => {
    let intentos = 0;
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await within(hoja).findByText('No se pudo emitir la nota')).toBeVisible();
    // La hoja sigue con lo escrito.
    expect(within(hoja).getByLabelText('Motivo')).toHaveValue('Error al cobrar');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(notas(s)).toHaveLength(2);
    expect(cuerpoDe(s, 1).id).toBe(cuerpoDe(s, 0).id);
    expect(notas(s)[1]?.cabeceras.get('Idempotency-Key')).toBe(
      notas(s)[0]?.cabeceras.get('Idempotency-Key'),
    );
  });

  it('cerrar la hoja y abrirla de nuevo con la nota aún sin respuesta repite el mismo id', async () => {
    let intentos = 0;
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    let hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s, 1).id).toBe(cuerpoDe(s, 0).id);
  });

  it('tras una respuesta final de la API (422) el id se suelta: el siguiente intento es otra nota', async () => {
    let intentos = 0;
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(422, { codigo: 'DEVOLUCION_INVALIDA', mensaje: 'Los pagos no cuadran' })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(
      await within(hoja).findByText(
        'Lo que devuelves no cuadra con el total de la nota. Revisa los montos y el redondeo del efectivo.',
      ),
    ).toBeVisible();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s, 1).id).not.toBe(cuerpoDe(s, 0).id);
  });

  it('el mismo cuerpo con otro motivo conserva el id pero no la clave de idempotencia', async () => {
    let intentos = 0;
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cobro duplicado' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s, 1).id).toBe(cuerpoDe(s, 0).id);
    expect(cuerpoDe(s, 1).motivo).toBe('Cobro duplicado');
    expect(notas(s)[1]?.cabeceras.get('Idempotency-Key')).not.toBe(
      notas(s)[0]?.cabeceras.get('Idempotency-Key'),
    );
  });
});

describe('Cuando la API dice que lo que se vio cambió (criterios 144 y 148)', () => {
  it('409 NOTA_CREDITO_CAMBIO: lee de nuevo el comprobante, dice el total nuevo y conserva lo escrito', async () => {
    let intentos = 0;
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          ++intentos === 1
            ? json(409, {
                codigo: 'NOTA_CREDITO_CAMBIO',
                mensaje: 'El total de la nota cambió',
                campos: [{ campo: 'total', mensaje: 'El total ahora es S/ 28.00' }],
              })
            : json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await masDe(hoja, 'Lomo saltado');
    await masDe(hoja, 'Lomo saltado');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
    expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 56.00');

    // Mientras tanto otra caja devolvió un Lomo: queda 1.
    s.estado.comprobante = boletaAceptada({
      id: BOLETA,
      numero: 'B001-00000124',
      notasCredito: [
        {
          id: uuid(7101),
          tipo: 'DEVOLUCION',
          numero: 'BC01-00000001',
          estado: 'POR_ENVIAR',
          total: '28.00',
        },
      ],
      acreditado: [
        {
          posicion: 1,
          cantidad: 1,
          neto: '28.00',
          base: '23.73',
          igv: '4.27',
          bolsas: 0,
          icbper: '0.00',
        },
      ],
    });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));

    expect(await within(hoja).findByText('El total de la nota cambió')).toBeVisible();
    expect(within(hoja).getByText(/El total ahora es S\/ 28\.00\./)).toBeVisible();
    expect(within(hoja).getByText(/Lo que escribiste sigue aquí/)).toBeVisible();
    // El comprobante se volvió a leer y la nota se recalcula con lo que queda.
    await waitFor(() =>
      expect(within(hoja).getByLabelText('Total de la nota')).toHaveTextContent('S/ 28.00'),
    );
    expect(within(hoja).getByLabelText('Motivo')).toHaveValue('Producto en mal estado');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(cuerpoDe(s, 1).total).toBe('28.00');
    expect(cuerpoDe(s, 1).lineas).toEqual([{ posicion: 1, cantidad: 1 }]);
  });

  it('422 NADA_QUE_ACREDITAR: lo dice, vuelve a leer el comprobante y deja elegir otra vez', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: () =>
          json(422, {
            codigo: 'NADA_QUE_ACREDITAR',
            mensaje: 'A esa línea ya no le queda nada por acreditar',
          }),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await devolverUnLomo(hoja);
    const lecturasAntes = s.de('GET', API_BOLETA).length;
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(
      await within(hoja).findByText(/A esa línea ya no le queda nada por acreditar/),
    ).toBeVisible();
    await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturasAntes));
    expect(within(hoja).getByRole('group', { name: 'Cantidad de Lomo saltado' })).toBeVisible();
  });

  it('409 SIN_SERIE: manda al Administrador a Ajustes › Cajas', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: () =>
          json(409, { codigo: 'SIN_SERIE', mensaje: 'La caja no tiene serie de notas de crédito' }),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await within(hoja).findByText(/no tiene serie de notas de crédito/)).toBeVisible();
    expect(within(hoja).getByText(/Ajustes › Cajas/)).toBeVisible();
  });
});

describe('Cambio de boleta por factura (criterios 143, 151 y 176)', () => {
  const padron = {
    ruc: RUC,
    razonSocial: 'Supermercados Peruanos S.A.',
    direccion: 'Av. Principal 123, Lima',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    activo: true,
    habido: true,
    padronAl: '2026-11-05T09:00:00.000Z',
  };

  it('pide el RUC, autocompleta con el padrón y manda el cliente sin líneas ni devolución', async () => {
    const s = montar({
      extra: {
        [`GET /padron/ruc/${RUC}`]: () => json(200, padron),
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) =>
          json(
            201,
            respuestaDe(cuerpo as NotaCreditoEntrada, {
              factura: comprobanteDe({
                id: FACTURA_NUEVA,
                tipo: 'FACTURA',
                serie: 'F001',
                correlativo: 31,
                numero: 'F001-00000031',
                estado: 'POR_ENVIAR',
              }),
            }),
          ),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a factura' }));
    expect(within(hoja).getByText(/No se devuelve dinero/)).toBeVisible();
    // Un cambio no devuelve dinero: no hay sección de devolución.
    expect(within(hoja).queryByText('Devolución del dinero')).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente pidió factura' }));

    // Sin RUC no se manda.
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    expect(await within(hoja).findByText('Escribe un RUC válido de 11 dígitos')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull();

    await userEvent.type(within(hoja).getByLabelText('RUC'), RUC);
    await waitFor(() =>
      expect(within(hoja).getByLabelText('Razón social')).toHaveValue(
        'Supermercados Peruanos S.A.',
      ),
    );
    expect(within(hoja).getByLabelText('Dirección fiscal')).toHaveValue('Av. Principal 123, Lima');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent(
      'Nota de crédito · Cambio a factura · B001-00000124 · S/ 66.20 · sin devolución',
    );
    await pin('123456');
    await waitFor(() => expect(notas(s)).toHaveLength(1));
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toMatchObject({
      objetivo: { tipoNota: 'CAMBIO_A_FACTURA', total: '66.20', devuelto: '0.00' },
    });
    expect(cuerpoDe(s)).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      comprobanteId: BOLETA,
      tipo: 'CAMBIO_A_FACTURA',
      motivo: 'El cliente pidió factura',
      total: '66.20',
      cliente: {
        tipoDocumento: 'RUC',
        numero: RUC,
        nombre: 'Supermercados Peruanos S.A.',
        direccion: 'Av. Principal 123, Lima',
      },
    });
    // El resultado trae la nota y la factura nueva, cada una con su estado en vivo.
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText('Cambio a factura de boleta B001-00000124.')).toBeVisible();
    expect(screen.getByText('BC01-00000003')).toBeVisible();
    expect(screen.getByText('F001-00000031')).toBeVisible();
  });

  it('un RUC de baja pide «Emitir igual» antes de mandar', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`GET /padron/ruc/${RUC}`]: () =>
          json(200, {
            ...padron,
            estado: 'BAJA DE OFICIO',
            condicion: 'NO HABIDO',
            activo: false,
            habido: false,
          }),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a factura' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente pidió factura' }));
    await userEvent.type(within(hoja).getByLabelText('RUC'), RUC);
    await within(hoja).findByRole('checkbox', { name: 'Emitir igual' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(notas(s)).toHaveLength(0);
    await userEvent.click(within(hoja).getByRole('checkbox', { name: 'Emitir igual' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    expect(notas(s)).toHaveLength(1);
  });
});

describe('El resultado (criterio 173)', () => {
  it('«Listo» cierra la hoja y el detalle se pone al día con la nota nueva', async () => {
    const s = montar({
      rol: 'SUPERVISOR',
      extra: {
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    const lecturasAntes = s.de('GET', API_BOLETA).length;
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    await screen.findByText('Nota de crédito emitida');
    await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturasAntes));
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );
  });

  it('una nota rechazada por SUNAT se dice con el motivo', async () => {
    montar({
      rol: 'SUPERVISOR',
      extra: {
        [`GET /facturacion/comprobantes/${NOTA}`]: () =>
          json(
            200,
            detalleDe({
              id: NOTA,
              tipo: 'NOTA_CREDITO_BOLETA',
              numero: 'BC01-00000003',
              estado: 'RECHAZADO',
              sunat: {
                codigo: '2800',
                mensaje: 'El documento afectado no existe',
                observaciones: [],
                hash: null,
              },
            }),
          ),
        [`POST ${API_NOTAS}`]: ({ cuerpo }) => json(201, respuestaDe(cuerpo as NotaCreditoEntrada)),
      },
    });
    renderApp(RUTA);
    const hoja = await abrirLaHoja();
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Error al cobrar' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await screen.findByText('Rechazado: El documento afectado no existe')).toBeVisible();
  });
});
