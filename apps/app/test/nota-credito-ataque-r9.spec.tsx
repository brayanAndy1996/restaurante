// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 9)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 9 (criterio 177):
// (1) la hoja describe la nota emitida siempre con los datos de la nota que salió (el tipo de la nota y `nota.cambioAFactura`
//     del detalle, o la respuesta del 201), nunca con el tipo que la persona tenía elegido;
// (2) el resultado guardado se identifica por el `id` del envío, no por comprobante, y una vez que la hoja muestra «Nota de
//     crédito emitida» no vuelve al formulario por respuestas o relecturas tardías;
// (3) «Revisar el comprobante» puede mostrar la nota vista, pero mientras su envío siga vivo no habilita un envío nuevo de ese
//     comprobante (a lo más un envío vivo).
// - A y A2 · un cambio a factura hallado al releer (con y sin el 500 de la hoja 1) se muestra como cambio a factura, con el
//   aviso de la factura nueva.
// - B · una devolución emitida se muestra como devolución aunque la persona haya cambiado a «Anular» antes del 422.
// - C · tras «Revisar» con X aún vivo, una hoja nueva del mismo comprobante espera (no manda Y) hasta que X termine; y la hoja
//   que muestra la nota no vuelve al formulario por lo que llega tarde.
//
// Hoy falla así: la hoja describe la nota con el tipo que la persona tenía elegido («Anulación» en lugar de «Cambio a factura» o
// «Devolución»); y «Revisar» suelta el intento con X aún vivo, de modo que una hoja nueva manda Y.
import type {
  AutorizacionRespuesta,
  NotaCreditoEntrada,
  NotaCreditoRespuesta,
} from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { boletaAceptada, comprobanteDe, detalleDe, lineaDeComprobante } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// Cada prueba usa su propio comprobante: el intento recordado vive en la memoria del módulo y no debe pasar de una a otra.
let BOLETA = uuid(7000);
let contador = 0;
const NOTA = uuid(7100);
const FACTURA_NUEVA = uuid(7200);
const TURNO = uuid(300);
const RUC = '20100070970';
let API_BOLETA = `/facturacion/comprobantes/${BOLETA}`;
const API_NOTAS = '/notas-credito';

beforeEach(() => {
  BOLETA = uuid(7000 + ++contador);
  API_BOLETA = `/facturacion/comprobantes/${BOLETA}`;
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turno = {
  id: TURNO,
  caja: { id: uuid(101), nombre: 'Caja 1' },
  responsable: { id: ID.usuario, nombre: 'Marta Pérez' },
  estado: 'ABIERTO' as const,
  abiertoEn: '2026-11-05T23:02:00.000Z',
  diaOperativo: '2026-11-05',
  fondo: '200.00',
  cerradoEn: null,
  cerradoPor: null,
};

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

const autorizada = (): AutorizacionRespuesta => ({
  autorizacionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accion: 'EMITIR_NOTA_CREDITO',
  autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
  expiraEn: new Date(Date.now() + 120_000).toISOString(),
});

/** Lo que responde la API a una nota emitida. */
function emitida(entrada: NotaCreditoEntrada, conFactura = false): NotaCreditoRespuesta {
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
    factura: conFactura
      ? comprobanteDe({
          id: FACTURA_NUEVA,
          tipo: 'FACTURA',
          serie: 'F001',
          correlativo: 31,
          numero: 'F001-00000031',
          estado: 'POR_ENVIAR',
        })
      : null,
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
  };
}

type Manejador = Parameters<typeof servidor>[0][string];

/** La API de mentira: el Supervisor (emite sin clave) con su turno abierto, y `POST /notas-credito` a gusto de cada prueba. */
function montar(
  postNotas: Manejador,
  /** Lo que `GET` del comprobante responde ahora (cambia cuando la API emite la nota). */
  comprobante: () => unknown = () => boletaAceptada({ id: BOLETA, numero: 'B001-00000124' }),
  rol: 'SUPERVISOR' | 'CAJERO' = 'SUPERVISOR',
) {
  return servidor({
    'POST /autorizaciones': () => json(201, autorizada()),
    'DELETE /sesion': () => json(204),
    'GET /sesion': () =>
      json(200, sesionDeRol(rol, { modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] })),
    [`GET ${API_BOLETA}`]: () => json(200, comprobante()),
    [`GET /facturacion/comprobantes/${NOTA}`]: () =>
      json(200, detalleDe({ id: NOTA, tipo: 'NOTA_CREDITO_BOLETA', numero: 'BC01-00000003' })),
    [`GET /facturacion/comprobantes/${FACTURA_NUEVA}`]: () =>
      json(200, detalleDe({ id: FACTURA_NUEVA, tipo: 'FACTURA', numero: 'F001-00000031' })),
    [`GET /padron/ruc/${RUC}`]: () => json(200, padron),
    'GET /turnos/mio': () => json(200, turno),
    'GET /cajas': () =>
      json(200, [
        {
          id: uuid(101),
          sucursalId: ID.sucursalA,
          nombre: 'Caja 1',
          activa: true,
          impresora: null,
          series: [],
          turnoAbierto: {
            id: TURNO,
            responsable: turno.responsable,
            abiertoEn: turno.abiertoEn,
          },
          parametros: { regimen: 'GENERAL', tiposComprobante: ['BOLETA', 'FACTURA'] },
        },
      ]),
    [`POST ${API_NOTAS}`]: postNotas,
  });
}

type Servidor = ReturnType<typeof montar>;
const posts = (s: Servidor) => s.de('POST', API_NOTAS);
const entradaDe = (s: Servidor, n: number) => posts(s)[n]!.cuerpo as NotaCreditoEntrada;

const EMITIR = { name: 'Emitir nota de crédito' };

async function abrirLaHoja() {
  const vista = renderApp(`/caja/comprobantes/${BOLETA}`);
  const hoja = await abrirLaHojaDe();
  return Object.assign(hoja, { vista });
}

async function abrirLaHojaDe(esperarElTurno = true) {
  await userEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }));
  const hoja = await screen.findByRole('dialog', { name: 'Nota de crédito' });
  if (esperarElTurno) await within(hoja).findByText(/Sale de tu turno en Caja 1/);
  return hoja;
}

const masDe = (hoja: HTMLElement, linea: string) =>
  userEvent.click(within(hoja).getByRole('button', { name: `Agregar una unidad de ${linea}` }));

/** Devolver un Lomo (en efectivo, el medio por defecto) y emitir. */
async function devolverUnLomoYEmitir(hoja: HTMLElement) {
  await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
  await masDe(hoja, 'Lomo saltado');
  await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
  await userEvent.click(within(hoja).getByRole('button', EMITIR));
}

/** Una boleta con 4 Lomos y las notas ya emitidas (cada una, un Lomo acreditado). */
const cuatroLomos = (notas: string[]) => {
  const base = boletaAceptada({ id: BOLETA, numero: 'B001-00000124' });
  const n = notas.length;
  return {
    ...base,
    lineas: [
      lineaDeComprobante({
        posicion: 1,
        cantidad: 4,
        bruto: '112.00',
        neto: '112.00',
        base: '94.92',
        igv: '17.08',
      }),
      ...base.lineas.slice(1),
    ],
    acreditado:
      n === 0
        ? []
        : [
            {
              posicion: 1,
              cantidad: n,
              neto: (28 * n).toFixed(2),
              base: (23.73 * n).toFixed(2),
              igv: (4.27 * n).toFixed(2),
              bolsas: 0,
              icbper: '0.00',
            },
          ],
    notasCredito: notas.map((notaId, i) => ({
      id: uuid(7100 + i),
      notaId,
      tipo: 'DEVOLUCION',
      numero: `BC01-0000000${3 + i}`,
      estado: 'POR_ENVIAR',
      total: '28.00',
    })),
  };
};

const ESPERA = /Esperando la respuesta de la nota anterior/i;

/** La hoja 1 manda A (id X) y queda sin respuesta; se cierra. Devuelve la API y cómo resolver A. */
async function conEnvioPendiente() {
  const emitidas: string[] = [];
  const retenidos: { a?: (r: Response) => void } = {};
  let n = 0;
  const s = montar(
    ({ cuerpo }) => {
      const e = cuerpo as NotaCreditoEntrada;
      n += 1;
      if (n === 1) return new Promise<Response>((r) => (retenidos.a = r)); // A: la respuesta tarda
      if (!emitidas.includes(e.id)) emitidas.push(e.id);
      return json(201, emitida(e));
    },
    () => cuatroLomos(emitidas),
  );
  for (let i = 0; i < 4; i++) {
    s.poner(`GET /facturacion/comprobantes/${uuid(7100 + i)}`, () =>
      json(
        200,
        detalleDe({
          id: uuid(7100 + i),
          tipo: 'NOTA_CREDITO_BOLETA',
          numero: `BC01-0000000${3 + i}`,
        }),
      ),
    );
  }
  const primera = await abrirLaHoja();
  await devolverUnLomoYEmitir(primera);
  await waitFor(() => expect(posts(s)).toHaveLength(1));
  await userEvent.click(within(primera).getByRole('button', { name: 'Cerrar' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull());
  return { s, emitidas, retenidos, idA: entradaDe(s, 0).id };
}

async function reconectarYReleer(s: Servidor) {
  const lecturas = s.de('GET', API_BOLETA).length;
  socketVigente()!.conectar();
  await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturas));
}

type NotaVista = { notaId: string; tipo: 'ANULACION' | 'DEVOLUCION' };

/** El comprobante con las notas ya emitidas (con el tipo con que la API las emitió). */
const conNotas = (notas: NotaVista[]) => ({
  ...cuatroLomos([]),
  notasCredito: notas.map((n, i) => ({
    id: uuid(7100 + i),
    notaId: n.notaId,
    tipo: n.tipo,
    numero: `BC01-0000000${3 + i}`,
    estado: 'POR_ENVIAR',
    total: '28.00',
  })),
});

/** `GET` del detalle de la primera nota emitida, con su tipo y si fue un cambio a factura. */
const detalleDeLaNota = (tipo: 'ANULACION' | 'DEVOLUCION', cambioAFactura: boolean) => () =>
  json(
    200,
    detalleDe({
      id: uuid(7100),
      tipo: 'NOTA_CREDITO_BOLETA',
      numero: 'BC01-00000003',
      nota: { tipo, motivo: 'Motivo de la nota', cambioAFactura },
    } as never),
  );

/** Hoja 1: un cambio a factura que queda en vuelo (A) y se cierra; hoja 2 abierta, esperándolo. */
async function cambioAFacturaEnVuelo() {
  const notas: NotaVista[] = [];
  const retenidos: { a?: (r: Response) => void } = {};
  const s = montar(
    () => new Promise<Response>((r) => (retenidos.a = r)),
    () => conNotas(notas),
  );
  s.poner(`GET /facturacion/comprobantes/${uuid(7100)}`, detalleDeLaNota('ANULACION', true));
  const hoja = await abrirLaHoja();
  await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a factura' }));
  await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente pidió factura' }));
  await userEvent.type(within(hoja).getByLabelText('RUC'), RUC);
  await waitFor(() =>
    expect(within(hoja).getByLabelText('Razón social')).toHaveValue('Supermercados Peruanos S.A.'),
  );
  await userEvent.click(within(hoja).getByRole('button', EMITIR));
  await waitFor(() => expect(posts(s)).toHaveLength(1));
  await userEvent.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull());
  const segunda = await abrirLaHojaDe(false);
  expect(await within(segunda).findByText(ESPERA)).toBeVisible();
  // La API emitió el cambio a factura (la nota de tipo ANULACION con `cambioAFactura`).
  notas.push({ notaId: entradaDe(s, 0).id, tipo: 'ANULACION' });
  return { s, retenidos, segunda };
}

describe('criterio 177 · la hoja describe la nota que salió, no la que la persona tenía elegida', () => {
  it('A · un cambio a factura hallado al releer tras el 500 de la hoja 1 se muestra como cambio a factura, con el aviso de la factura nueva', async () => {
    const { s, retenidos } = await cambioAFacturaEnVuelo();
    retenidos.a!(json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' }));
    await reconectarYReleer(s);
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText(/Cambio a factura de boleta B001-00000124/)).toBeVisible();
    expect(screen.getByText(/La factura nueva está en Comprobantes/)).toBeVisible();
  });

  it('A2 · un cambio a factura hallado al releer, sin respuesta aún de la hoja 1, se muestra como cambio a factura, con el aviso de la factura nueva', async () => {
    const { s } = await cambioAFacturaEnVuelo();
    await reconectarYReleer(s);
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText(/Cambio a factura de boleta B001-00000124/)).toBeVisible();
    expect(screen.getByText(/La factura nueva está en Comprobantes/)).toBeVisible();
  });

  it('B · una devolución que salió se muestra como devolución aunque la persona haya cambiado a «Anular» antes del 422', async () => {
    const notas: NotaVista[] = [];
    let n = 0;
    const s = montar(
      ({ cuerpo }) => {
        n += 1;
        if (n === 1) {
          notas.push({ notaId: (cuerpo as NotaCreditoEntrada).id, tipo: 'DEVOLUCION' });
          return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
        }
        return json(422, { codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA', mensaje: 'Otro cuerpo' });
      },
      () => conNotas(notas),
    );
    s.poner(`GET /facturacion/comprobantes/${uuid(7100)}`, detalleDeLaNota('DEVOLUCION', false));
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular' }));
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await within(hoja).findByText('Revisa el comprobante antes de emitir otra');
    expect(posts(s)).toHaveLength(2);

    await reconectarYReleer(s);
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText(/Devolución de boleta B001-00000124/)).toBeVisible();
    expect(screen.queryByText(/Anulación de boleta/)).toBeNull();
  });
});

describe('criterio 177 · a lo más un envío vivo, y la hoja que muestra la nota no vuelve al formulario', () => {
  it('C · tras «Revisar el comprobante» con X aún vivo, una hoja nueva del mismo comprobante espera y no manda Y hasta que X termine', async () => {
    const emitidas: string[] = [];
    const retenidos: ((r: Response) => void)[] = [];
    const s = montar(
      () => new Promise<Response>((r) => retenidos.push(r)),
      () => cuatroLomos(emitidas),
    );
    for (let i = 0; i < 4; i++) {
      s.poner(`GET /facturacion/comprobantes/${uuid(7100 + i)}`, () =>
        json(
          200,
          detalleDe({
            id: uuid(7100 + i),
            tipo: 'NOTA_CREDITO_BOLETA',
            numero: `BC01-0000000${3 + i}`,
          }),
        ),
      );
    }
    const hoja1 = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja1);
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    const idX = entradaDe(s, 0).id;
    await userEvent.click(within(hoja1).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );
    emitidas.push(idX); // la API ya emitió X; su respuesta sigue sin llegar

    const hoja2 = await abrirLaHojaDe(false);
    await within(hoja2).findByText(ESPERA);
    await userEvent.click(
      within(hoja2).getByRole('button', { name: /revisar (el )?comprobante/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    // El comprobante revisado ya muestra la nota X, pero su envío sigue vivo: la hoja nueva espera.
    const hoja3 = await abrirLaHojaDe(false);
    expect(await within(hoja3).findByText(ESPERA)).toBeVisible();
    const emitir = within(hoja3).queryByRole('button', EMITIR);
    if (emitir) expect(emitir).toBeDisabled();
    expect(posts(s), 'ningún envío nuevo mientras X siga vivo').toHaveLength(1);

    // X termina: la hoja muestra la nota.
    retenidos[0]!(json(201, emitida(entradaDe(s, 0))));
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(posts(s)).toHaveLength(1);
  });

  it('C2 · la hoja que muestra la nota emitida no vuelve al formulario por una relectura o un aviso tardío', async () => {
    const { s, emitidas, retenidos, idA } = await conEnvioPendiente();
    const segunda = await abrirLaHojaDe(false);
    expect(await within(segunda).findByText(ESPERA)).toBeVisible();
    emitidas.push(idA);
    retenidos.a!(json(201, emitida(entradaDe(s, 0))));
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();

    await reconectarYReleer(s);
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText('Nota de crédito emitida')).not.toBeNull();
    expect(screen.queryByRole('button', EMITIR)).toBeNull();
    expect(posts(s)).toHaveLength(1);
  });
});
