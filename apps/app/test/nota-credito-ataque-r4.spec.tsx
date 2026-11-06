// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 4)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 4 (R4-1 y R4-2), a partir de los criterios 153 y 177:
// - R4-1 · con la hoja ABIERTA, tras un fallo no final (500 o 409 `CONFLICTO`) en el que la nota sí salió, cuando el comprobante
//   se relee (por ejemplo, la reconexión del socket invalida `['facturacion']`) y trae en `notasCredito` una nota con `notaId`
//   igual al `id` del intento, la hoja pasa a mostrar la nota emitida («Nota de crédito emitida» con su número, como tras un 201)
//   en vez de soltar el `id` en silencio con el aviso de error a la vista; y ningún toque posterior en «Emitir» desde ese
//   formulario manda un POST con un `id` nuevo (que sería una segunda devolución). Si la persona vuelve a tocar «Emitir» antes de
//   que llegue la relectura, se repite el mismo `id` (réplica). Con la hoja CERRADA sigue valiendo la ronda 3: el `id` se suelta
//   y la siguiente nota sale con otro `id` (regresión). Cubre al Supervisor y al Cajero (sin un nuevo pedido de PIN).
// - R4-2 · tras un 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`, «Revisar el comprobante» sigue disponible mientras la hoja esté por
//   revisar, aunque la persona toque «+» o «−» o cambie el tipo; «Emitir» sigue deshabilitado hasta revisar.
//
// Hoy falla así: la relectura suelta el `id` en silencio, la hoja sigue con el aviso de error y la selección, y el siguiente
// toque en «Emitir» manda una segunda nota con `id` nuevo; y cambiar una cantidad o el tipo borra el aviso con «Revisar el
// comprobante» mientras «Emitir» sigue deshabilitado: la persona queda sin salida salvo cerrar la hoja.
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
import { boletaAceptada, comprobanteDe, detalleDe } from './ayudas-facturacion';
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

async function pin(digitos: string) {
  const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
  for (const d of digitos) await userEvent.click(within(ventana).getByRole('button', { name: d }));
}

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
const claveDe = (s: Servidor, n: number) => posts(s)[n]!.cabeceras.get('Idempotency-Key');

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

/** El socket se reconecta (por ejemplo, tras el reinicio que causó un 5xx): se relee todo, también el comprobante. */
async function reconectarYReleer(s: Servidor) {
  const lecturas = s.de('GET', API_BOLETA).length;
  socketVigente()!.conectar();
  await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturas));
}

/** La API emite la nota con el primer POST, pero responde un fallo no final; los siguientes devuelven la nota (réplica). */
function apiQueEmiteYFalla(fallo: () => Response) {
  const estado = { emitidaConId: null as string | null };
  let n = 0;
  const s = montar(
    ({ cuerpo }) => {
      n += 1;
      if (n === 1) {
        estado.emitidaConId = (cuerpo as NotaCreditoEntrada).id;
        return fallo();
      }
      return json(201, emitida(cuerpo as NotaCreditoEntrada));
    },
    () =>
      estado.emitidaConId === null
        ? boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })
        : conLaNotaEmitida(estado.emitidaConId),
  );
  return s;
}

const falla500 = () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
const falla409 = () => json(409, { codigo: 'CONFLICTO', mensaje: 'Otra operación en curso' });

describe('R4-1 · criterios 153 y 177 · con la hoja abierta, la relectura que muestra la nota ya emitida se ve en la hoja', () => {
  it.each([
    ['500', falla500],
    ['409 CONFLICTO', falla409],
  ])(
    'tras un %s en el que la nota sí salió, la reconexión del socket hace que la hoja muestre «Nota de crédito emitida» con su número, y ningún toque manda un id nuevo',
    async (_nombre, fallo) => {
      const s = apiQueEmiteYFalla(fallo);
      const hoja = await abrirLaHoja();
      await devolverUnLomoYEmitir(hoja);
      await within(hoja).findAllByRole('alert');
      expect(posts(s)).toHaveLength(1);

      await reconectarYReleer(s);
      expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
      expect(screen.getByText('BC01-00000003')).toBeVisible();

      // Si el formulario sigue a mano, un toque en «Emitir» no produce una nota con otro id.
      const emitir = screen.queryByRole('button', EMITIR);
      if (emitir) await userEvent.click(emitir);
      await new Promise((r) => setTimeout(r, 50));
      expect(new Set(ids(s)).size).toBe(1);
    },
  );

  it('si la persona vuelve a tocar «Emitir» antes de que llegue la relectura, se repite el mismo id y la misma clave de idempotencia', async () => {
    const s = apiQueEmiteYFalla(falla500);
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1)).toBe(claveDe(s, 0));
  });

  it('el Cajero: tras un 500 con la nota ya emitida, la reconexión muestra la nota y no vuelve a pedir el PIN del supervisor', async () => {
    const estado = { emitidaConId: null as string | null };
    const s = montar(
      ({ cuerpo }) => {
        estado.emitidaConId = (cuerpo as NotaCreditoEntrada).id;
        return falla500();
      },
      () =>
        estado.emitidaConId === null
          ? boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })
          : conLaNotaEmitida(estado.emitidaConId),
      'CAJERO',
    );
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await masDe(hoja, 'Lomo saltado');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');
    await within(hoja).findByText('No se pudo emitir la nota');
    expect(s.de('POST', '/autorizaciones')).toHaveLength(1);

    await reconectarYReleer(s);
    expect(await screen.findByText('Nota de crédito emitida')).toBeVisible();
    expect(screen.getByText('BC01-00000003')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull();

    const pedir = screen.queryByRole('button', { name: 'Pedir clave de supervisor' });
    if (pedir) await userEvent.click(pedir);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole('dialog', { name: 'Clave de supervisor' }),
      'ningún PIN nuevo',
    ).toBeNull();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(1);
    expect(new Set(ids(s)).size).toBe(1);
  });

  it('con la hoja cerrada se suelta el id en silencio: la siguiente nota (el otro Lomo) sale con otro id y otra clave de idempotencia', async () => {
    const s = apiQueEmiteYFalla(falla500);
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    await reconectarYReleer(s);
    expect(await screen.findByText('BC01-00000003')).toBeVisible();
    // Con una nota ya emitida solo queda devolver por ítems: no hay que elegir el tipo.
    const segunda = await abrirLaHojaDe(false);
    await masDe(segunda, 'Lomo saltado');
    await userEvent.click(within(segunda).getByRole('button', { name: 'Producto en mal estado' }));
    await within(segunda).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(segunda).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1)).not.toBe(claveDe(s, 0));
  });
});

describe('R4-2 · criterio 177 · tras un 422 CLAVE_IDEMPOTENCIA_REUTILIZADA, «Revisar el comprobante» no se pierde', () => {
  /** 500, cambio a Yape y 422: la hoja queda por revisar. */
  async function hojaPorRevisar() {
    let n = 0;
    const s = montar(() => {
      n += 1;
      return n === 1
        ? falla500()
        : json(422, { codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA', mensaje: 'ya se usó' });
    });
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await devolverPorYapeYEmitir(hoja);
    await within(hoja).findByRole('button', { name: /revisar (el )?comprobante/i });
    expect(posts(s)).toHaveLength(2);
    return { s, hoja };
  }

  const revisar = (hoja: HTMLElement) =>
    within(hoja).queryByRole('button', { name: /revisar (el )?comprobante/i });

  it.each([
    ['«+» de otra línea', 'Agregar una unidad de Gaseosa 1 L'],
    ['«−» de la línea elegida', 'Quitar una unidad de Lomo saltado'],
  ])(
    'tras tocar %s sigue «Revisar el comprobante», «Emitir» sigue deshabilitado y al revisar se cierra la hoja',
    async (_n, boton) => {
      const { s, hoja } = await hojaPorRevisar();
      await userEvent.click(within(hoja).getByRole('button', { name: boton }));
      await new Promise((r) => setTimeout(r, 50));

      expect(revisar(hoja), 'sigue «Revisar el comprobante»').not.toBeNull();
      expect(within(hoja).getByRole('button', EMITIR)).toBeDisabled();
      expect(posts(s)).toHaveLength(2);

      await userEvent.click(revisar(hoja)!);
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
      );
    },
  );

  it('tras cambiar el tipo (Anular) sigue «Revisar el comprobante» y «Emitir» sigue deshabilitado', async () => {
    const { s, hoja } = await hojaPorRevisar();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(revisar(hoja), 'sigue «Revisar el comprobante»').not.toBeNull();
    expect(within(hoja).getByRole('button', EMITIR)).toBeDisabled();
    expect(posts(s)).toHaveLength(2);
  });
});
