// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 5)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 5, a partir de los criterios 153 y 177. Regla: el `id` recordado de
// un intento solo se suelta (a) cuando llega la respuesta final de un envío con ese mismo `id` y el intento recordado sigue
// siendo ese `id`, o (b) cuando el comprobante leído con éxito trae una nota con `notaId` igual a ese `id`. Nunca por otra cosa.
// - F1 · tras un 500 (la nota salió) y un 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`, si al tocar «Revisar el comprobante» la relectura
//   falla (500), el `id` NO se suelta: la hoja dice que no se pudo revisar y ofrece intentarlo otra vez (o se cierra conservando
//   el `id`); al reabrir y emitir la misma devolución se repite el `id` (réplica o 422), nunca uno nuevo. Si la relectura funciona
//   y muestra la nota, se suelta y la hoja muestra la nota o se cierra (regresión de la ronda 4).
// - F2 · la respuesta tardía (201) de un envío de una hoja ya cerrada (id X) no borra el intento de la hoja siguiente (id Y, en
//   vuelo); si Y recibe un 500, el reintento repite Y. Lo mismo con un error final tardío de X (p. ej. 422).
//
// Hoy falla así: «Revisar el comprobante» suelta el `id` aunque la relectura falle, y la misma devolución sale con un `id` nuevo;
// y el 201 tardío de la hoja cerrada suelta el intento de la hoja siguiente, cuyo reintento tras un 500 sale con otro `id`.
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

/** Cambia la devolución de efectivo a Yape (con su número de operación) y emite otra vez. */
async function devolverPorYapeYEmitir(hoja: HTMLElement) {
  await userEvent.click(within(hoja).getByRole('button', { name: 'Yape' }));
  await userEvent.type(within(hoja).getByLabelText('Número de operación'), 'OP-9');
  await userEvent.click(within(hoja).getByRole('button', EMITIR));
}

/** El comprobante tal como lo lee la API después de que la nota con ese `id` de cliente salió (un Lomo de dos acreditado). */
const conLaNotaEmitida = (notaId: string) => ({
  ...boletaAceptada({
    id: BOLETA,
    numero: 'B001-00000124',
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
  notasCredito: [
    {
      id: NOTA,
      notaId,
      tipo: 'DEVOLUCION',
      numero: 'BC01-00000003',
      estado: 'POR_ENVIAR',
      total: '28.00',
    },
  ],
});

const ids = (s: Servidor) => posts(s).map((p) => (p.cuerpo as NotaCreditoEntrada).id);

/** El socket se reconecta: se relee todo, también el comprobante. */
async function reconectarYReleer(s: Servidor) {
  const lecturas = s.de('GET', API_BOLETA).length;
  socketVigente()!.conectar();
  await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturas));
}

const falla500 = () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });

describe('F1 · criterios 153 y 177 · «Revisar el comprobante» con la relectura fallida no suelta el id', () => {
  /** 500 con la nota emitida, cambio a Yape y 422 (la API reconoce el id): la hoja queda por revisar. */
  async function hojaPorRevisar(lecturaDelComprobante: () => Response) {
    const estado = { emitidaConId: null as string | null, n: 0 };
    const s = montar(({ cuerpo }) => {
      const e = cuerpo as NotaCreditoEntrada;
      estado.n += 1;
      if (estado.n === 1) {
        estado.emitidaConId = e.id;
        return falla500();
      }
      if (e.id === estado.emitidaConId) {
        return json(422, { codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA', mensaje: 'ya se usó' });
      }
      return json(201, emitida(e));
    });
    const lectura = { activa: false };
    s.poner(`GET ${API_BOLETA}`, () =>
      lectura.activa
        ? lecturaDelComprobante()
        : json(200, boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })),
    );
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await devolverPorYapeYEmitir(hoja);
    const revisar = await within(hoja).findByRole('button', { name: /revisar (el )?comprobante/i });
    expect(posts(s)).toHaveLength(2);
    return { s, hoja, revisar, lectura };
  }

  it('si la relectura falla (500), el id no se suelta: la hoja avisa que no se pudo revisar o se cierra, y la misma devolución repite el id del primer envío', async () => {
    const { s, revisar, lectura } = await hojaPorRevisar(falla500);
    lectura.activa = true;
    await userEvent.click(revisar);
    await new Promise((r) => setTimeout(r, 100));

    const abierta = screen.queryByRole('dialog', { name: 'Nota de crédito' });
    if (abierta) {
      // La hoja sigue: dice que no se pudo revisar y ofrece intentarlo otra vez; nada sale con otro id mientras tanto.
      expect(within(abierta).getByText(/no se pudo revisar/i)).toBeVisible();
      expect(
        within(abierta).getByRole('button', { name: /(intentar|reintentar|revisar)/i }),
      ).toBeVisible();
      const emitir = within(abierta).queryByRole('button', EMITIR);
      if (emitir && !(emitir as HTMLButtonElement).disabled) await userEvent.click(emitir);
      await new Promise((r) => setTimeout(r, 50));
      expect(new Set(ids(s)).size).toBe(1);
      return;
    }

    // Se cerró: al reabrir y emitir la misma devolución se repite el id del primer envío.
    const segunda = await abrirLaHojaDe(true);
    await userEvent.click(within(segunda).getByRole('button', { name: 'Devolver ítems' }));
    await masDe(segunda, 'Lomo saltado');
    await userEvent.click(within(segunda).getByRole('button', { name: 'Producto en mal estado' }));
    await userEvent.click(within(segunda).getByRole('button', EMITIR));
    await waitFor(() => expect(posts(s)).toHaveLength(3));
    expect(
      entradaDe(s, 2).id,
      'la misma devolución repetida debe llevar el id del primer envío',
    ).toBe(entradaDe(s, 0).id);
  });

  it('si la relectura funciona y muestra la nota, el id se suelta y la hoja se cierra o muestra la nota (regresión)', async () => {
    let notaId: string | null = null;
    const { s, revisar, lectura } = await hojaPorRevisar(() =>
      json(200, conLaNotaEmitida(notaId!)),
    );
    notaId = entradaDe(s, 0).id;
    lectura.activa = true;
    await userEvent.click(revisar);
    await waitFor(() => {
      const abierta = screen.queryByRole('dialog', { name: 'Nota de crédito' });
      if (abierta)
        expect(
          within(abierta).getByText(/ya (está|esta) emitida|Nota de crédito emitida/i),
        ).toBeVisible();
    });

    // La nota X ya salió: devolver el otro Lomo es otra nota, con otro id.
    if (!screen.queryByText('Nota de crédito emitida')) {
      const segunda = await abrirLaHojaDe(false);
      await masDe(segunda, 'Lomo saltado');
      await userEvent.click(
        within(segunda).getByRole('button', { name: 'Producto en mal estado' }),
      );
      await within(segunda).findByText(/Sale de tu turno en Caja 1/);
      await userEvent.click(within(segunda).getByRole('button', EMITIR));
      await waitFor(() => expect(posts(s)).toHaveLength(3));
      expect(entradaDe(s, 2).id).not.toBe(entradaDe(s, 0).id);
    }
  });
});

describe('F2 · criterios 153 y 177 · la respuesta tardía de una hoja cerrada no borra el intento de la hoja siguiente', () => {
  /** Una boleta con 4 Lomos: quedan unidades para que la API acepte otra nota con un id nuevo. */
  const cuatroLomos = (acreditados: number, notas: string[]) => {
    const base = boletaAceptada({ id: BOLETA, numero: 'B001-00000124' });
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
        acreditados === 0
          ? []
          : [
              {
                posicion: 1,
                cantidad: acreditados,
                neto: (28 * acreditados).toFixed(2),
                base: (23.73 * acreditados).toFixed(2),
                igv: (4.27 * acreditados).toFixed(2),
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

  it.each([
    ['201', true],
    ['422 DEVOLUCION_INVALIDA', false],
  ])(
    'con el envío X de la hoja cerrada resuelto tarde con %s y Y en vuelo, si Y recibe un 500 su reintento repite el id de Y',
    async (_nombre, xSalio) => {
      const emitidas: string[] = [];
      const retenidos: Record<string, (r: Response) => void> = {};
      let n = 0;
      const s = montar(
        ({ cuerpo }) => {
          const e = cuerpo as NotaCreditoEntrada;
          n += 1;
          if (n === 1) {
            emitidas.push(e.id); // la API la emitió; la respuesta tarda (red lenta)
            return new Promise<Response>((r) => (retenidos.x = r));
          }
          if (n === 2) return new Promise<Response>((r) => (retenidos.y = r));
          if (!emitidas.includes(e.id)) emitidas.push(e.id);
          return json(201, emitida(e));
        },
        () => cuatroLomos(emitidas.length, emitidas),
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
      await devolverUnLomoYEmitir(primera); // X en vuelo
      await waitFor(() => expect(posts(s)).toHaveLength(1));
      await userEvent.click(within(primera).getByRole('button', { name: 'Cerrar' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
      );

      // El comprobante se relee y ya muestra la nota X (la hoja cerrada la suelta, regla b).
      await reconectarYReleer(s);
      expect(await screen.findByText('BC01-00000003')).toBeVisible();

      // Segunda devolución, legítima: otro Lomo, en otra hoja (con una nota ya emitida solo queda devolver por ítems).
      const segunda = await abrirLaHojaDe(false);
      await masDe(segunda, 'Lomo saltado');
      await userEvent.click(
        within(segunda).getByRole('button', { name: 'Producto en mal estado' }),
      );
      await userEvent.click(within(segunda).getByRole('button', EMITIR)); // Y en vuelo
      await waitFor(() => expect(posts(s)).toHaveLength(2));
      const idY = entradaDe(s, 1).id;
      expect(idY).not.toBe(entradaDe(s, 0).id);

      // Llega la respuesta tardía de X (hoja cerrada) y después el 500 de Y (que la API sí emitió).
      retenidos.x!(
        xSalio
          ? json(201, emitida(entradaDe(s, 0)))
          : json(422, { codigo: 'DEVOLUCION_INVALIDA', mensaje: 'Los pagos no cuadran' }),
      );
      await new Promise((r) => setTimeout(r, 100));
      emitidas.push(idY);
      retenidos.y!(falla500());
      await within(segunda).findByText('No se pudo emitir la nota');

      // La persona vuelve a tocar «Emitir» (misma devolución, sin cambiar nada).
      await userEvent.click(within(segunda).getByRole('button', EMITIR));
      await waitFor(() => expect(posts(s)).toHaveLength(3));
      expect(entradaDe(s, 2).id, 'el reintento de Y debe llevar el id de Y').toBe(idY);
    },
  );
});
