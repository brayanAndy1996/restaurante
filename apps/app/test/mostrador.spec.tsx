import type {
  CajaRespuesta,
  CobroRespuesta,
  ComprobanteRespuesta,
  TurnoRespuesta,
  VentaMostradorEntrada,
  VentaMostradorRespuesta,
} from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import {
  claveDeBorrador,
  leerBorrador,
  olvidarEstadoDeEnvios,
} from '../src/modulos/salon/borrador';
import { ID, json, renderApp, servidor, type Manejador } from './ayudas';
import { cocinaDe, comandaKds } from './ayudas-cocina';
import { M_TRES_CUARTOS, P_GASEOSA, P_LOMO, cartaDeEjemplo } from './ayudas-comandero';
import { sesionDeRol, uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 79 a 85 y 115 en la interfaz (pruebas no protegidas de la pantalla del mostrador).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const TURNO = uuid(300);
const RUTA = '/caja/mostrador';
const API_VENTAS = '/ventas-mostrador';
const CLAVE = claveDeBorrador(ID.empresa, ID.usuario, 'mostrador');
const PERSONA = { id: ID.usuario, nombre: 'Marta Pérez' };

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
  localStorage.clear();
  olvidarEstadoDeEnvios();
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

function comprobante(ordenId: string, total: string, numeroLlamado: number): ComprobanteRespuesta {
  return {
    id: uuid(7000),
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 1,
    numero: 'B001-00000124',
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
    cobroId: ordenId,
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
    orden: { id: ordenId, mesas: [], mozo: null, numeroLlamado },
  };
}

/** Lo que responde la API a una venta: la misma forma que `ventaMostradorRespuestaSchema`. */
function ventaDe(entrada: VentaMostradorEntrada, numeroLlamado = 23): VentaMostradorRespuesta {
  const efectivo = entrada.pagos.find((p) => p.medio === 'EFECTIVO');
  const cobro: CobroRespuesta = {
    id: entrada.id,
    ordenId: entrada.id,
    turnoId: entrada.turnoId,
    parte: { tipo: 'TOTAL' },
    total: entrada.total,
    redondeo: entrada.redondeo,
    vuelto: efectivo?.recibido
      ? (Number(efectivo.recibido) - Number(efectivo.monto)).toFixed(2)
      : '0.00',
    pagos: entrada.pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto,
      recibido: p.recibido ?? null,
      operacion: p.operacion ?? null,
    })),
    comprobante: comprobante(entrada.id, entrada.total, numeroLlamado),
    cuenta: { estado: 'CERRADA', saldo: '0.00', version: 2 },
    impresion: 'SIN_IMPRESORA',
    trabajoId: null,
  };
  return {
    venta: { id: entrada.id, ordenId: entrada.id, numeroLlamado },
    cobro,
    envio: {
      id: entrada.id,
      ordenId: entrada.id,
      numero: 1,
      esAdicion: false,
      items: [],
      comandas: [],
    },
  };
}

/** La caja del turno, con los parámetros del emisor que la API le da (criterio 115). */
const cajaDelTurno = (
  parametros: CajaRespuesta['parametros'] = {
    regimen: 'GENERAL',
    tiposComprobante: ['BOLETA', 'FACTURA'],
  },
): CajaRespuesta => ({
  id: turno.caja.id,
  sucursalId: ID.sucursalA,
  nombre: 'Caja 1',
  activa: true,
  impresora: null,
  series: [],
  turnoAbierto: null,
  parametros,
});

function montar(
  opciones: {
    turno?: TurnoRespuesta | null;
    parametros?: CajaRespuesta['parametros'];
    carta?: () => { cuerpo: ReturnType<typeof cartaDeEjemplo>; etag: string };
    extra?: Record<string, Manejador>;
  } = {},
) {
  const estado = { carta: cartaDeEjemplo(), etag: '"carta-1"' };
  const s = servidor({
    'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'COCINA', 'CAJA'] })),
    'GET /turnos/mio': () =>
      opciones.turno === null
        ? json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay turno' })
        : json(200, opciones.turno ?? turno),
    'GET /cajas': () => json(200, [cajaDelTurno(opciones.parametros)]),
    'GET /carta/sucursal': ({ cabeceras }) =>
      cabeceras.get('If-None-Match') === estado.etag
        ? json(304)
        : json(200, estado.carta, { ETag: estado.etag }),
    ...(opciones.extra ?? {}),
  });
  return Object.assign(s, { estado });
}

type Servidor = ReturnType<typeof montar>;
const ventas = (s: Servidor) => s.de('POST', API_VENTAS);
const entradaDe = (s: Servidor, n = 0) => ventas(s)[n]?.cuerpo as VentaMostradorEntrada;
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });
const vende = (cuerpo: unknown) => json(201, ventaDe(cuerpo as VentaMostradorEntrada));

/** Elige el Lomo con 3/4 y una Gaseosa: S/ 37.00. Queda en la pantalla de la venta. */
async function armarLaVenta() {
  await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
  const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
  await userEvent.click(within(hoja).getByRole('radio', { name: /3\/4/ }));
  await userEvent.click(within(hoja).getByRole('button', { name: /^Agregar( ·|$)/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lomo saltado' })).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
  await userEvent.click(screen.getByRole('button', { name: /^Gaseosa 1 L/ }));
  const hojaGaseosa = await screen.findByRole('dialog', { name: 'Gaseosa 1 L' });
  await userEvent.click(within(hojaGaseosa).getByRole('button', { name: /^Agregar( ·|$)/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gaseosa 1 L' })).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: /^Revisar la venta/ }));
  await screen.findByRole('heading', { name: 'La venta' });
}

describe('Mostrador: la venta (criterios 79, 80 y 115)', () => {
  it('arma la venta, cobra en efectivo con vuelto y muestra «Llamado 23» en grande', async () => {
    const s = montar({ extra: { [`POST ${API_VENTAS}`]: ({ cuerpo }) => vende(cuerpo) } });
    renderApp(RUTA);
    await armarLaVenta();
    // El total sale del dominio con la carta del comandero, sin descuentos ni cortesías (criterio 85).
    expect(screen.getByText('Total a cobrar').nextSibling).toHaveTextContent('S/ 37.00');
    expect(screen.queryByText(/Descuento/)).toBeNull();
    expect(screen.queryByText(/Cortesía/)).toBeNull();
    expect(screen.getByText('Efectivo a cobrar').nextSibling).toHaveTextContent('S/ 37.00');

    await userEvent.click(screen.getByRole('button', { name: 'S/ 50' }));
    expect(screen.getByText('Vuelto').nextSibling).toHaveTextContent('S/ 13.00');
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));

    expect(await screen.findByText('Llamado 23')).toBeVisible();
    expect(screen.getByText('Boleta · B001-00000124')).toBeVisible();
    expect(screen.getByText('Vuelto').nextSibling).toHaveTextContent('S/ 13.00');
    expect(ventas(s)).toHaveLength(1);
    const entrada = entradaDe(s);
    expect(entrada).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      turnoId: TURNO,
      lineas: [
        {
          productoId: P_LOMO,
          modificadorIds: [M_TRES_CUARTOS],
          cantidad: 1,
          tiempo: 1,
          paraLlevar: false,
        },
        { productoId: P_GASEOSA, modificadorIds: [], cantidad: 1, tiempo: 1, paraLlevar: false },
      ],
      total: '37.00',
      comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
      pagos: [{ medio: 'EFECTIVO', monto: '37.00', recibido: '50.00' }],
      redondeo: '0.00',
    });
    expect(ventas(s)[0]?.cabeceras.get('Idempotency-Key')).toBe(entrada.id);
    // La venta salió: el borrador quedó vacío y «Nueva venta» empieza de cero.
    expect(leerBorrador(CLAVE).lineas).toHaveLength(0);
    await userEvent.click(boton('Nueva venta'));
    expect(await screen.findByRole('button', { name: /^Lomo saltado/ })).toBeVisible();
    expect(screen.queryByText('Llamado 23')).toBeNull();
  });

  it('ofrece los tipos de comprobante de la caja: un emisor general, Boleta y Factura', async () => {
    montar();
    renderApp(RUTA);
    await armarLaVenta();
    const tipos = screen.getByRole('group', { name: 'Tipo de comprobante' });
    expect(within(tipos).getByRole('button', { name: 'Boleta' })).toBeVisible();
    expect(within(tipos).getByRole('button', { name: 'Factura' })).toBeVisible();
  });

  it('con un emisor Nuevo RUS solo ofrece Boleta, lo dice, y el total sale sin una tasa propia de la PWA (criterio 115)', async () => {
    const s = montar({
      parametros: { regimen: 'NUEVO_RUS', tiposComprobante: ['BOLETA'] },
      extra: { [`POST ${API_VENTAS}`]: ({ cuerpo }) => vende(cuerpo) },
    });
    renderApp(RUTA);
    await armarLaVenta();
    expect(screen.queryByRole('group', { name: 'Tipo de comprobante' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Factura' })).toBeNull();
    expect(screen.getByText(/solo emite boletas/)).toBeVisible();
    // Sin IGV de por medio, el total es el mismo: el precio ya lo incluye.
    expect(screen.getByText('Total a cobrar').nextSibling).toHaveTextContent('S/ 37.00');
    await userEvent.click(screen.getByRole('button', { name: 'S/\u00a050' }));
    await userEvent.click(boton('Cobrar y enviar · S/\u00a037.00'));
    expect(await screen.findByText('Llamado 23')).toBeVisible();
    expect(entradaDe(s)).toMatchObject({ total: '37.00', comprobante: { tipo: 'BOLETA' } });
  });

  it('mientras no llegan los datos de la caja no cobra: no adivina qué comprobantes emite', async () => {
    const s = montar({
      extra: {
        'GET /cajas': () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' }),
        [`POST ${API_VENTAS}`]: ({ cuerpo }) => vende(cuerpo),
      },
    });
    renderApp(RUTA);
    await armarLaVenta();
    expect(await screen.findByText(/No pudimos leer los comprobantes/)).toBeVisible();
    await userEvent.click(boton('Cobrar y enviar · S/\u00a037.00'));
    expect(ventas(s)).toHaveLength(0);
  });

  it('el efectivo se redondea a la décima y el Yape lleva su número de operación', async () => {
    const s = montar({ extra: { [`POST ${API_VENTAS}`]: ({ cuerpo }) => vende(cuerpo) } });
    renderApp(RUTA);
    await armarLaVenta();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otro pago' }));
    await userEvent.type(screen.getByLabelText('Monto del pago 2'), '20');
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));
    expect(ventas(s)).toHaveLength(0);
    expect(await screen.findByText('Escribe el número de operación del Yape.')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Número de operación'), 'Y-5521');
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));
    await screen.findByText('Llamado 23');
    expect(entradaDe(s)).toMatchObject({
      total: '37.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '17.00' },
        { medio: 'YAPE', monto: '20.00', operacion: 'Y-5521' },
      ],
      redondeo: '0.00',
    });
  });

  it('sin turno abierto no deja vender y lleva a Caja', async () => {
    montar({ turno: null });
    renderApp(RUTA);
    expect(await screen.findByText('Abre tu caja para vender')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir a Caja' })).toHaveAttribute('href', '/caja');
  });

  it('un Mozo no entra al mostrador', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('MOZO', { modulos: ['SALON', 'COCINA', 'CAJA'] })),
    });
    renderApp(RUTA);
    await waitFor(() => expect(screen.queryByText('Mostrador')).toBeNull());
    expect(screen.queryByRole('button', { name: /Cobrar y enviar/ })).toBeNull();
  });

  it('desde Caja, quien cobra ve el acceso al mostrador', async () => {
    montar({
      extra: {
        'GET /turnos/*/reporte': () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No hay' }),
      },
    });
    renderApp('/caja');
    const enlace = await screen.findByRole('link', { name: /Vender en el mostrador/ });
    expect(enlace).toHaveAttribute('href', '/caja/mostrador');
  });
});

describe('Mostrador: el id de la venta y los rechazos (criterios 80 y 83)', () => {
  it('un corte conserva el id: reintentar manda la misma venta, y tras recargar también', async () => {
    let intento = 0;
    const s = montar({
      extra: {
        [`POST ${API_VENTAS}`]: ({ cuerpo }) => {
          intento += 1;
          return intento === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Se cayó' })
            : vende(cuerpo);
        },
      },
    });
    const { unmount } = renderApp(RUTA);
    await armarLaVenta();
    await userEvent.click(screen.getByRole('button', { name: 'S/ 50' }));
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));
    expect(await screen.findByText('No sabemos si la venta quedó')).toBeVisible();
    expect(ventas(s)).toHaveLength(1);
    // Las líneas quedan bloqueadas y el botón dice «Reintentar la venta».
    expect(screen.queryByRole('button', { name: /^Quitar/ })).toBeNull();

    // Se recarga la pantalla: la venta sigue ahí, con el mismo cuerpo.
    unmount();
    olvidarEstadoDeEnvios();
    renderApp(RUTA);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reintentar la venta · S/ 37.00' }),
    );
    expect(await screen.findByText('Llamado 23')).toBeVisible();
    expect(ventas(s)).toHaveLength(2);
    expect(entradaDe(s, 1)).toEqual(entradaDe(s, 0));
    expect(ventas(s)[1]?.cabeceras.get('Idempotency-Key')).toBe(entradaDe(s, 0).id);
    expect(leerBorrador(CLAVE).envioId).toBeNull();
  });

  it('un plato agotado no deja nada: marca la línea, conserva todo y suelta el id', async () => {
    let intento = 0;
    const s = montar({
      extra: {
        [`POST ${API_VENTAS}`]: ({ cuerpo }) => {
          intento += 1;
          return intento === 1
            ? json(422, {
                codigo: 'PRODUCTO_NO_VENDIBLE',
                mensaje: 'Un producto no se puede vender',
                campos: [{ campo: 'lineas.1', mensaje: 'AGOTADO' }],
              })
            : vende(cuerpo);
        },
      },
    });
    renderApp(RUTA);
    await armarLaVenta();
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));

    expect(await screen.findByText('No se cobró ni se envió nada')).toBeVisible();
    expect(screen.getByText('No pasó:').parentElement).toHaveTextContent('Agotado');
    expect(screen.queryByText('Llamado 23')).toBeNull();
    // Las líneas siguen, se pueden quitar, y la próxima venta lleva otro id.
    expect(leerBorrador(CLAVE).lineas).toHaveLength(2);
    expect(leerBorrador(CLAVE).envioId).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Quitar 1 × Gaseosa 1 L/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^Cobrar y enviar/ }));
    await screen.findByText('Llamado 23');
    expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
    expect(entradaDe(s, 1).lineas).toHaveLength(1);
  });

  it('un turno cerrado dice qué hacer y no pierde la venta', async () => {
    montar({
      extra: {
        [`POST ${API_VENTAS}`]: () =>
          json(409, { codigo: 'TURNO_CERRADO', mensaje: 'El turno está cerrado' }),
      },
    });
    renderApp(RUTA);
    await armarLaVenta();
    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));
    expect(await screen.findByText(/Tu turno ya está cerrado/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ir a Caja' })).toBeVisible();
    expect(leerBorrador(CLAVE).lineas).toHaveLength(2);
  });
});

describe('Mostrador: el precio cambió (criterio 84)', () => {
  it('muestra el total nuevo y deja confirmar sin perder líneas ni pagos', async () => {
    let intento = 0;
    const s = montar({
      extra: {
        [`POST ${API_VENTAS}`]: ({ cuerpo }) => {
          intento += 1;
          return intento === 1
            ? json(409, {
                codigo: 'CUENTA_CAMBIO',
                mensaje: 'Los precios cambiaron',
                campos: [{ campo: 'total', mensaje: 'El total ahora es S/ 38.00' }],
              })
            : vende(cuerpo);
        },
      },
    });
    renderApp(RUTA);
    await armarLaVenta();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar otro pago' }));
    await userEvent.type(screen.getByLabelText('Monto del pago 2'), '20');
    await userEvent.type(screen.getByLabelText('Número de operación'), 'Y-5521');
    // Mientras tanto, la gaseosa sube a S/ 10.00 en la carta.
    s.estado.carta = cartaDeEjemplo();
    const gaseosa = s.estado.carta.familias
      .flatMap((f) => f.productos)
      .find((p) => p.id === P_GASEOSA);
    if (gaseosa) gaseosa.precio = '10.00';
    s.estado.etag = '"carta-2"';

    await userEvent.click(boton('Cobrar y enviar · S/ 37.00'));
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText('Cambió un precio')).toBeVisible();
    expect(alerta).toHaveTextContent('El total ahora es S/ 38.00');
    // El botón ya dice el total nuevo, con los productos y los pagos intactos.
    expect(await screen.findByRole('button', { name: 'Cobrar y enviar · S/ 38.00' })).toBeVisible();
    expect(leerBorrador(CLAVE).lineas).toHaveLength(2);
    expect(screen.getByLabelText('Monto del pago 2')).toHaveValue('20.00');
    expect(screen.getByLabelText('Número de operación')).toHaveValue('Y-5521');

    await userEvent.click(boton('Cobrar y enviar · S/ 38.00'));
    await screen.findByText('Llamado 23');
    expect(entradaDe(s, 1)).toMatchObject({
      total: '38.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '18.00' },
        { medio: 'YAPE', monto: '20.00', operacion: 'Y-5521' },
      ],
    });
  });
});

describe('El KDS con una venta de mostrador (criterio 82)', () => {
  it('dice «Llamado 23» en lugar de la mesa y no pide mozo', async () => {
    const base = comandaKds(1);
    const comanda = {
      ...base,
      orden: { id: base.orden.id, mesas: [], mozo: null, comensales: 1, numeroLlamado: 23 },
    };
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('COCINA_BARRA')),
      'GET /cocina/comandas': () => json(200, cocinaDe([comanda]), { ETag: '"1"' }),
    });
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /Llamado 23/ });
    expect(within(tarjeta).getByRole('heading', { name: 'Llamado 23' })).toBeVisible();
    expect(tarjeta).not.toHaveTextContent('Sin mesa');
    expect(tarjeta).not.toHaveTextContent('comensal');
    expect(tarjeta).toHaveTextContent('Cocina');
    await act(async () => {});
  });

  it('una comanda de mesa sigue diciendo la mesa, el mozo y los comensales', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('COCINA_BARRA')),
      'GET /cocina/comandas': () => json(200, cocinaDe([comandaKds(4)]), { ETag: '"1"' }),
    });
    renderApp('/cocina');
    const tarjeta = await screen.findByRole('article', { name: /Mesa 4/ });
    expect(tarjeta).toHaveTextContent('Ana Ríos · 3 comensales · Cocina');
  });
});

describe('Mostrador: tableta', () => {
  it('la carta y la venta se ven juntas y «Cobrar y enviar» está siempre al alcance', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((consulta: string) =>
      ({
        matches: true,
        media: consulta,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      const s = montar({ extra: { [`POST ${API_VENTAS}`]: ({ cuerpo }) => vende(cuerpo) } });
      renderApp(RUTA);
      expect(await screen.findByRole('list', { name: 'Productos de Fondos' })).toBeVisible();
      expect(screen.getByRole('region', { name: 'La venta' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
      await userEvent.click(screen.getByRole('button', { name: /^Gaseosa 1 L/ }));
      const hoja = await screen.findByRole('dialog', { name: 'Gaseosa 1 L' });
      await userEvent.click(within(hoja).getByRole('button', { name: /^Agregar( ·|$)/ }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Cobrar y enviar · S/ 9.00' }),
      );
      expect(await screen.findByText('Llamado 23')).toBeVisible();
      expect(ventas(s)).toHaveLength(1);
    } finally {
      window.matchMedia = original;
    }
  });
});
