// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 2)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 2 (H1, media), a partir de los criterios 153 y 177:
// - el `id` de la nota se conserva hasta una respuesta final: tras un fallo no final (500 o corte de red), aunque la persona
//   cambie las líneas, la devolución (de efectivo a Yape) o el cliente y vuelva a emitir, se manda el mismo `id` (con otra
//   clave de idempotencia si el cuerpo cambió), para que la API no emita dos notas por una misma devolución;
// - si la API responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` (el mismo `id` con otra devolución), la hoja dice que la nota
//   puede ya estar emitida y ofrece revisar el comprobante (vuelve a leerlo) sin emitir otra;
// - el `id` solo se suelta tras una respuesta final (aquí, un 422 de validación): el intento siguiente es otra nota.
//
// Hoy falla así: el hook `useAjusteConClave` genera un `id` nuevo en cuanto cambia la huella (líneas, devolución o cliente)
// aunque el intento anterior terminó sin respuesta final, y el 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` solo se muestra como un
// error genérico, sin ofrecer revisar el comprobante.
import type { NotaCreditoEntrada, NotaCreditoRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { boletaAceptada, comprobanteDe, detalleDe } from './ayudas-facturacion';
import { sesionDeRol, uuid } from './ayudas-salon';

const BOLETA = uuid(7000);
const NOTA = uuid(7100);
const FACTURA_NUEVA = uuid(7200);
const TURNO = uuid(300);
const RUC = '20100070970';
const API_BOLETA = `/facturacion/comprobantes/${BOLETA}`;
const API_NOTAS = '/notas-credito';

beforeEach(() => {
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
function montar(postNotas: Manejador) {
  return servidor({
    'GET /sesion': () =>
      json(200, sesionDeRol('SUPERVISOR', { modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] })),
    [`GET ${API_BOLETA}`]: () => json(200, boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })),
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

/** Falla la primera vez como se pida y las siguientes responde 201 con la nota emitida. */
const falloYLuegoExito = (primero: Manejador): Manejador => {
  let n = 0;
  return (pedido) =>
    ++n === 1 ? primero(pedido) : json(201, emitida(pedido.cuerpo as NotaCreditoEntrada, true));
};
const error500: Manejador = () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });

const EMITIR = { name: 'Emitir nota de crédito' };

async function abrirLaHoja() {
  renderApp(`/caja/comprobantes/${BOLETA}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }));
  const hoja = await screen.findByRole('dialog', { name: 'Nota de crédito' });
  await within(hoja).findByText(/Sale de tu turno en Caja 1/);
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

describe('H1 · criterios 153 y 177 · el id de la nota se conserva hasta una respuesta final', () => {
  it('tras un 500, cambiar la devolución de efectivo a Yape manda el mismo id y otra clave de idempotencia', async () => {
    const s = montar(falloYLuegoExito(error500));
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await devolverPorYapeYEmitir(hoja);
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 0).devolucion?.pagos[0]?.medio).toBe('EFECTIVO');
    expect(entradaDe(s, 1).devolucion?.pagos[0]?.medio).toBe('YAPE');
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1)).not.toBe(claveDe(s, 0));
  });

  it('tras un corte de la red (el POST se queda sin respuesta), cerrar la hoja, volver a abrirla y cambiar la devolución a Yape manda el mismo id', async () => {
    let n = 0;
    const s = montar(({ cuerpo }) =>
      ++n === 1
        ? new Promise<Response>(() => undefined) // la respuesta nunca llega
        : json(201, emitida(cuerpo as NotaCreditoEntrada)),
    );
    let hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }));
    hoja = await screen.findByRole('dialog', { name: 'Nota de crédito' });
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
    await masDe(hoja, 'Lomo saltado');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
    await devolverPorYapeYEmitir(hoja);
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 0).devolucion?.pagos[0]?.medio).toBe('EFECTIVO');
    expect(entradaDe(s, 1).devolucion?.pagos[0]?.medio).toBe('YAPE');
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
  });

  it('tras un 500, cambiar las líneas devueltas manda el mismo id y otra clave de idempotencia', async () => {
    const s = montar(falloYLuegoExito(error500));
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await masDe(hoja, 'Lomo saltado');
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).lineas).not.toEqual(entradaDe(s, 0).lineas);
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1)).not.toBe(claveDe(s, 0));
  });

  it('tras un 500, cambiar el cliente del cambio a factura manda el mismo id', async () => {
    const s = montar(falloYLuegoExito(error500));
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a factura' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente pidió factura' }));
    await userEvent.type(within(hoja).getByLabelText('RUC'), RUC);
    await waitFor(() =>
      expect(within(hoja).getByLabelText('Razón social')).toHaveValue(
        'Supermercados Peruanos S.A.',
      ),
    );
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await within(hoja).findByText('No se pudo emitir la nota');
    await userEvent.type(within(hoja).getByLabelText('Dirección fiscal'), ' Piso 2');
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).cliente?.direccion).not.toBe(entradaDe(s, 0).cliente?.direccion);
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
  });

  it('tras una respuesta final (422 de validación), cambiar la devolución manda otro id: es otra nota', async () => {
    const s = montar(
      falloYLuegoExito(() =>
        json(422, { codigo: 'DEVOLUCION_INVALIDA', mensaje: 'Los pagos no cuadran' }),
      ),
    );
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText(/Lo que devuelves no cuadra/);
    await devolverPorYapeYEmitir(hoja);
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
  });
});

describe('H1 · criterio 153 · 422 CLAVE_IDEMPOTENCIA_REUTILIZADA: la nota puede ya estar emitida', () => {
  it('lo dice y ofrece revisar el comprobante (lo vuelve a leer), sin emitir otra nota', async () => {
    const s = montar(() =>
      json(422, {
        codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
        mensaje: 'Este id ya se usó con otra devolución',
      }),
    );
    const hoja = await abrirLaHoja();
    const lecturasAntes = s.de('GET', API_BOLETA).length;
    await devolverUnLomoYEmitir(hoja);

    expect(
      await within(hoja).findByText(
        /(puede|podría)\s+(ya\s+)?(estar|haber(se)?)\s+(ya\s+)?emitid/i,
      ),
    ).toBeVisible();
    const revisar = within(hoja).getByRole('button', { name: /revisar (el )?comprobante/i });
    await userEvent.click(revisar);
    await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturasAntes));

    // No se emitió otra nota: el único POST es el que la API rechazó.
    expect(posts(s)).toHaveLength(1);
    expect(screen.queryByText('Nota de crédito emitida')).toBeNull();
  });

  it('tras un 500 y un cambio de devolución, la API que reconoce el id responde 422 y la hoja ofrece revisar sin mandar un tercer POST', async () => {
    let n = 0;
    const s = montar(({ cuerpo }) => {
      n += 1;
      if (n === 1) return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
      // Igual que la API real: el mismo id con otra devolución es 422.
      return json(422, {
        codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA',
        mensaje: `El id ${(cuerpo as NotaCreditoEntrada).id} ya se usó con otra devolución`,
      });
    });
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await devolverPorYapeYEmitir(hoja);

    expect(
      await within(hoja).findByText(
        /(puede|podría)\s+(ya\s+)?(estar|haber(se)?)\s+(ya\s+)?emitid/i,
      ),
    ).toBeVisible();
    expect(within(hoja).getByRole('button', { name: /revisar (el )?comprobante/i })).toBeVisible();
    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
  });
});
