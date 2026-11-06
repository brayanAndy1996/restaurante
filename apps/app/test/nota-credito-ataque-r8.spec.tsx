// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 8)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 8 (criterio 177): cuando termina con 201 un envío vivo que no es de
// la hoja abierta (A, de una hoja ya cerrada), esa hoja muestra «Nota de crédito emitida» con esa respuesta, sin depender de la
// relectura del comprobante; si termina con un error final, deja de esperar y queda lista. Nunca deja de esperar mostrando un
// comprobante sin la nota que ya se sabe emitida.
// - Hoja 2 en “Esperando la respuesta de la nota anterior…” por el envío A (id X) de la hoja 1 cerrada; llega el 201 de A: la
//   hoja 2 muestra la nota emitida con el número de A, no manda ningún POST y hay una sola nota; con la relectura del
//   comprobante fallando y con ella funcionando.
// - Un error final de A (422) con la hoja 2 abierta la deja lista para emitir (regresión de la ronda 6).
//
// Hoy falla así: la hoja 1 suelta X y la hoja 2 deja de esperar antes de releer; si la relectura falla, muestra el comprobante
// viejo con «Emitir» habilitado y la persona repite la devolución con un `id` nuevo: una segunda nota.
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

describe('criterio 177 · la hoja que esperaba muestra la nota que ya salió', () => {
  it.each([
    ['la relectura del comprobante falla', true],
    ['la relectura del comprobante funciona', false],
  ])(
    'con el 201 de A y %s, la hoja 2 muestra «Nota de crédito emitida» con el número de A, sin ningún POST y con una sola nota',
    async (_nombre, lecturaFalla) => {
      const { s, emitidas, retenidos, idA } = await conEnvioPendiente();
      const segunda = await abrirLaHojaDe(false);
      expect(await within(segunda).findByText(ESPERA)).toBeVisible();
      if (lecturaFalla) {
        s.poner(`GET ${API_BOLETA}`, () =>
          json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' }),
        );
      }

      emitidas.push(idA);
      retenidos.a!(json(201, emitida(entradaDe(s, 0))));
      expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
      expect(screen.getByText('BC01-00000003')).toBeVisible();
      // Nunca deja de esperar mostrando el formulario de antes: no queda ningún «Emitir» a la vista.
      expect(screen.queryByRole('button', EMITIR)).toBeNull();
      await new Promise((r) => setTimeout(r, 100));

      expect(posts(s)).toHaveLength(1);
      expect(new Set(emitidas).size).toBe(1);
    },
  );

  it('un error final de A (422) con la hoja 2 abierta la deja lista para emitir (regresión de la ronda 6)', async () => {
    const { s, retenidos, idA } = await conEnvioPendiente();
    const segunda = await abrirLaHojaDe(false);
    expect(await within(segunda).findByText(ESPERA)).toBeVisible();

    retenidos.a!(json(422, { codigo: 'DEVOLUCION_INVALIDA', mensaje: 'Los pagos no cuadran' }));
    await waitFor(() => expect(within(segunda).queryByText(ESPERA)).toBeNull());
    await userEvent.click(await within(segunda).findByRole('button', { name: 'Devolver ítems' }));
    await masDe(segunda, 'Lomo saltado');
    await userEvent.click(within(segunda).getByRole('button', { name: 'Producto en mal estado' }));
    await within(segunda).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(segunda).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).not.toBe(idA);
  });
});
