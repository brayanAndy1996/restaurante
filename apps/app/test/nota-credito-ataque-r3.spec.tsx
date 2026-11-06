// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 3)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 3 (C2 y C3), a partir de los criterios 150, 153 y 177:
// - C2 · tras un corte en el que la nota sí salió, si el comprobante releído ya muestra esa nota (cada nota de
//   `notasCredito` trae `notaId`, el `id` que la PWA mandó en `POST /notas-credito`), la PWA suelta el `id` recordado: una
//   segunda devolución legítima idéntica (mismo motivo, mismo medio y mismo monto) se manda con otro `id` y otra clave de
//   idempotencia, y sale como nota nueva (con el mismo `id` y la misma clave la API devolvería la primera nota y el otro
//   Lomo nunca se acreditaría ni se devolvería el dinero). Además, el recuerdo de intentos se borra al cerrar sesión.
// - C3 · tras un 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`, «Emitir» queda deshabilitado (o no hace ningún POST) hasta que la persona
//   revisa el comprobante; al revisarlo, la hoja se cierra (o dice que la nota ya está emitida) y ningún toque produce un
//   POST con un `id` nuevo desde ese formulario.
//
// Hoy falla así: el intento recordado vive en la memoria del módulo y no se suelta al ver la nota en el comprobante releído ni
// al cerrar sesión (la segunda devolución repite `id` e `Idempotency-Key`); y el 422 suelta el `id`, deja «Emitir» activo y el
// siguiente toque manda una nota con `id` nuevo.
import type { NotaCreditoEntrada, NotaCreditoRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { boletaAceptada, comprobanteDe, detalleDe } from './ayudas-facturacion';
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
) {
  return servidor({
    'DELETE /sesion': () => json(204),
    'GET /sesion': () =>
      json(200, sesionDeRol('SUPERVISOR', { modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] })),
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

describe('C2 · criterios 150, 153 y 177 · una segunda devolución legítima idéntica es otra nota', () => {
  it('tras un corte en el que la primera sí salió, con el comprobante releído mostrando esa nota, la segunda devolución idéntica lleva otro id y otra clave de idempotencia', async () => {
    let n = 0;
    let emitidaConId: string | null = null;
    const s = montar(
      ({ cuerpo }) => {
        n += 1;
        if (n === 1) {
          // La API sí emitió la primera, pero la respuesta nunca llegó.
          emitidaConId = (cuerpo as NotaCreditoEntrada).id;
          return new Promise<Response>(() => undefined);
        }
        return json(201, emitida(cuerpo as NotaCreditoEntrada));
      },
      () =>
        emitidaConId === null
          ? boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })
          : conLaNotaEmitida(emitidaConId),
    );
    const primera = await abrirLaHoja();
    await devolverUnLomoYEmitir(primera);
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    await userEvent.click(within(primera).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    // La persona vuelve al comprobante: se relee y ya muestra la primera nota (y un Lomo acreditado).
    primera.vista.unmount();
    renderApp(`/caja/comprobantes/${BOLETA}`);
    expect(await screen.findByText('BC01-00000003')).toBeVisible();
    // Con una nota ya emitida solo queda devolver por ítems: no hay que elegir el tipo.
    const hoja = await abrirLaHojaDe(false);
    // Ahora devuelve el OTRO Lomo, con el mismo motivo, en efectivo.
    await masDe(hoja, 'Lomo saltado');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
    await within(hoja).findByText(/Sale de tu turno en Caja 1/);
    await userEvent.click(within(hoja).getByRole('button', EMITIR));
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).lineas).toEqual(entradaDe(s, 0).lineas);
    expect(entradaDe(s, 1).motivo).toBe(entradaDe(s, 0).motivo);
    expect(entradaDe(s, 1).devolucion).toEqual(entradaDe(s, 0).devolucion);
    expect(entradaDe(s, 1).id, 'otra nota: otro id').not.toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1), 'otra nota: otra clave de idempotencia').not.toBe(claveDe(s, 0));
  });

  it('el intento recordado se borra al cerrar sesión: la misma devolución tras salir y volver a entrar lleva otro id', async () => {
    let n = 0;
    const s = montar(({ cuerpo }) =>
      ++n === 1
        ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
        : json(201, emitida(cuerpo as NotaCreditoEntrada)),
    );
    const primera = await abrirLaHoja();
    await devolverUnLomoYEmitir(primera);
    await within(primera).findByText('No se pudo emitir la nota');
    await userEvent.click(within(primera).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nota de crédito' })).toBeNull(),
    );

    // Sale de la cuenta.
    await userEvent.click(screen.getByRole('button', { name: /^Sesión de/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('heading', { name: 'Ingresa' })).toBeVisible();
    primera.vista.unmount();

    // Otra persona (o la misma) entra y hace la misma devolución.
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
    renderApp(`/caja/comprobantes/${BOLETA}`);
    const hoja = await abrirLaHojaDe();
    await devolverUnLomoYEmitir(hoja);
    await screen.findByText('Nota de crédito emitida');

    expect(posts(s)).toHaveLength(2);
    expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
    expect(claveDe(s, 1)).not.toBe(claveDe(s, 0));
  });
});

describe('C3 · criterios 153 y 177 · tras un 422 CLAVE_IDEMPOTENCIA_REUTILIZADA no se emite otra nota con un id nuevo', () => {
  it('«Emitir» no hace ningún POST hasta revisar el comprobante, y al revisarlo no sale ninguna nota más con otro id', async () => {
    let n = 0;
    const s = montar(({ cuerpo }) => {
      n += 1;
      if (n === 1) return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
      if (n === 2) {
        return json(422, { codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA', mensaje: 'ya se usó' });
      }
      return json(201, emitida(cuerpo as NotaCreditoEntrada));
    });
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findByText('No se pudo emitir la nota');
    await devolverPorYapeYEmitir(hoja);
    const revisar = await within(hoja).findByRole('button', { name: /revisar (el )?comprobante/i });
    expect(posts(s)).toHaveLength(2);

    // Un toque más en «Emitir» (si el botón sigue ahí) no manda nada: antes hay que revisar el comprobante.
    const emitir = within(hoja).queryByRole('button', EMITIR);
    if (emitir) await userEvent.click(emitir);
    await new Promise((r) => setTimeout(r, 50));
    expect(posts(s), 'ningún POST antes de revisar el comprobante').toHaveLength(2);

    // Revisar relee el comprobante y la hoja se cierra (o dice que la nota ya está emitida).
    const lecturasAntes = s.de('GET', API_BOLETA).length;
    await userEvent.click(revisar);
    await waitFor(() => expect(s.de('GET', API_BOLETA).length).toBeGreaterThan(lecturasAntes));
    const abierta = screen.queryByRole('dialog', { name: 'Nota de crédito' });
    if (abierta) {
      expect(within(abierta).getByText(/ya (está|esta) emitida/i)).toBeVisible();
      const otra = within(abierta).queryByRole('button', EMITIR);
      if (otra) await userEvent.click(otra);
    }
    await new Promise((r) => setTimeout(r, 50));

    expect(posts(s)).toHaveLength(2);
    expect(new Set(posts(s).map((p) => (p.cuerpo as NotaCreditoEntrada).id)).size).toBe(1);
    expect(screen.queryByText('Nota de crédito emitida')).toBeNull();
  });
});
