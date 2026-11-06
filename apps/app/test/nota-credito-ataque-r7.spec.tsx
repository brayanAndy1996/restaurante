// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 7)
//
// Ataque adversarial a la hoja de la nota de crédito, ronda 7 (criterios 153 y 177 y orden de rechazos del criterio de
// «Orden de rechazos de las escrituras»): en `POST /notas-credito` la réplica por `id` va antes del 403 de clave, y la PWA no
// trata como respuesta final del intento los rechazos que la API da antes de reconocer el `id` (400, 401, 403, 404 y 409
// `SUCURSAL_NO_ELEGIDA`): conserva el `id`. Los demás 4xx finales (422 `DEVOLUCION_INVALIDA`, etc.) siguen soltándolo.
// - El escenario de la ronda 7 (Cajero: 500 con la nota X ya emitida, cambio de motivo, 403 `AUTORIZACION_INVALIDA` en las dos
//   vueltas) con una API que respeta el orden real (réplica por `id` antes de la clave) y con el orden viejo del adversarial:
//   en ambos, todos los POST del intento llevan el mismo `id` y hay una sola nota.
// - Tras 403 `AUTORIZACION_INVALIDA`, 403 `CLAVE_REQUERIDA`, 400, 404 y 409 `SUCURSAL_NO_ELEGIDA`, el siguiente envío del
//   intento repite el `id`.
//
// Hoy falla así: `esRespuestaFinal` trata esos rechazos como finales, suelta el `id` y la siguiente nota sale con un `id` nuevo
// (con el orden viejo, dos notas por una devolución).
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

const huella = (e: NotaCreditoEntrada) =>
  JSON.stringify([
    e.comprobanteId,
    e.tipo,
    e.lineas ?? null,
    e.devolucion ?? null,
    e.cliente ?? null,
  ]);

/** La nota número `n` (0 = la primera) con el `id` de cliente del envío. */
const respuestaN = (e: NotaCreditoEntrada, n: number): NotaCreditoRespuesta => ({
  ...emitida(e),
  nota: comprobanteDe({
    id: uuid(7100 + n),
    tipo: 'NOTA_CREDITO_BOLETA',
    serie: 'BC01',
    correlativo: 3 + n,
    numero: `BC01-0000000${3 + n}`,
    estado: 'POR_ENVIAR',
    afectaA: { id: BOLETA, tipo: 'BOLETA', numero: 'B001-00000124' },
  }),
});

/**
 * Una API de notas con clave de supervisor. `ordenReal`: la réplica por `id` va antes del 403 de clave (el orden del criterio);
 * si no, el orden viejo del adversarial (la clave se mira primero). El primer POST emite la nota pero la respuesta se pierde
 * (500); el tercero llega con una autorización que ya venció en la red.
 */
function apiConClave(ordenReal: boolean) {
  const autorizaciones = new Map<string, { usada: boolean; vencida: boolean }>();
  const porIk = new Map<string, Response>();
  const notas = new Map<string, string>(); // id de cliente -> huella
  let nAutorizaciones = 0;
  let nPost = 0;
  const s = servidor({
    'POST /autorizaciones': ({ cuerpo }) => {
      const id = uuid(5000 + ++nAutorizaciones);
      autorizaciones.set(id, { usada: false, vencida: false });
      return json(201, {
        autorizacionId: id,
        accion: 'EMITIR_NOTA_CREDITO',
        objetivo: (cuerpo as { objetivo?: unknown }).objetivo,
        autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
        expiraEn: new Date(Date.now() + 120_000).toISOString(),
      });
    },
    'DELETE /sesion': () => json(204),
    'GET /sesion': () =>
      json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'COCINA', 'CAJA', 'FACTURACION'] })),
    [`GET ${API_BOLETA}`]: () => json(200, boletaAceptada({ id: BOLETA, numero: 'B001-00000124' })),
    'GET /turnos/mio': () => json(200, turno),
    'POST /notas-credito': ({ cuerpo, cabeceras }) => {
      nPost += 1;
      const e = cuerpo as NotaCreditoEntrada;
      const ik = cabeceras.get('Idempotency-Key')!;
      const clave = cabeceras.get('X-Autorizacion');
      if (porIk.has(ik)) return porIk.get(ik)!.clone();
      if (nPost === 3 && clave) autorizaciones.get(clave)!.vencida = true;
      const replica = (): Response | null => {
        if (!notas.has(e.id)) return null;
        if (notas.get(e.id) !== huella(e)) {
          return json(422, { codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA', mensaje: 'ya se usó' });
        }
        const r = json(201, respuestaN(e, 0));
        porIk.set(ik, r.clone());
        return r;
      };
      const a = clave ? autorizaciones.get(clave) : undefined;
      const claveMala = !a || a.usada || a.vencida;
      if (ordenReal) {
        const r = replica();
        if (r) return r;
      }
      if (claveMala) return json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'No vale' });
      if (!ordenReal) {
        const r = replica();
        if (r) return r;
      }
      a!.usada = true;
      notas.set(e.id, huella(e));
      // La primera se emite pero la respuesta se pierde (504 del balanceador).
      if (notas.size === 1) return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
      const r = json(201, respuestaN(e, notas.size - 1));
      porIk.set(ik, r.clone());
      return r;
    },
  });
  return { s, notas };
}

describe('R7 · criterios 153 y 177 · con la clave de supervisor, el id del intento se conserva ante los 403', () => {
  it.each([
    ['la API respeta el orden real (réplica por id antes de la clave)', true],
    ['la API mira la clave antes de la réplica (orden viejo del adversarial)', false],
  ])(
    'Cajero, 500 con la nota X ya emitida y cambio de motivo: %s; todos los POST llevan el mismo id y hay una sola nota',
    async (_nombre, ordenReal) => {
      const { s, notas } = apiConClave(ordenReal);
      const hoja = await abrirLaHoja();
      await userEvent.click(within(hoja).getByRole('button', { name: 'Devolver ítems' }));
      await masDe(hoja, 'Lomo saltado');
      await userEvent.click(within(hoja).getByRole('button', { name: 'Producto en mal estado' }));
      const PEDIR = { name: 'Pedir clave de supervisor' };
      await userEvent.click(within(hoja).getByRole('button', PEDIR));
      await pin('123456');
      await within(hoja).findByText('No se pudo emitir la nota');
      expect(notas.size).toBe(1);

      // Cambia solo el motivo: el objetivo de la clave es el mismo, la clave de idempotencia es otra.
      await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente lo devolvió' }));
      await userEvent.click(within(hoja).getByRole('button', PEDIR));
      // Lo que pida la hoja hasta terminar: la clave del supervisor otra vez, o volver a tocar el botón.
      for (let i = 0; i < 8 && !screen.queryByText('Nota de crédito emitida'); i++) {
        await new Promise((r) => setTimeout(r, 150));
        if (screen.queryByRole('dialog', { name: 'Clave de supervisor' })) {
          await pin('123456');
        } else if (within(hoja).queryByText(/La clave del supervisor no sirvió/)) {
          const antes = s.de('POST', API_NOTAS).length;
          await userEvent.click(within(hoja).getByRole('button', PEDIR));
          await waitFor(() =>
            expect(
              s.de('POST', API_NOTAS).length > antes ||
                screen.queryByRole('dialog', { name: 'Clave de supervisor' }) !== null,
            ).toBe(true),
          );
        }
      }
      await screen.findByText('Nota de crédito emitida');

      const enviados = s.de('POST', API_NOTAS).map((p) => (p.cuerpo as NotaCreditoEntrada).id);
      expect(new Set(enviados).size, 'todos los envíos del intento llevan el mismo id').toBe(1);
      expect(notas.size, 'una sola nota por la devolución').toBe(1);
    },
  );
});

describe('R7 · criterios 153 y 177 · los rechazos previos al reconocimiento del id lo conservan', () => {
  const previos: Array<[string, () => Response]> = [
    [
      '403 AUTORIZACION_INVALIDA',
      () => json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'No vale' }),
    ],
    [
      '403 CLAVE_REQUERIDA',
      () => json(403, { codigo: 'CLAVE_REQUERIDA', mensaje: 'Falta la clave' }),
    ],
    [
      '400 DATOS_INVALIDOS',
      () => json(400, { codigo: 'DATOS_INVALIDOS', mensaje: 'Datos inválidos' }),
    ],
    ['404 NO_ENCONTRADO', () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No existe' })],
    [
      '409 SUCURSAL_NO_ELEGIDA',
      () => json(409, { codigo: 'SUCURSAL_NO_ELEGIDA', mensaje: 'Elige sucursal' }),
    ],
  ];
  const finales: Array<[string, () => Response]> = [
    [
      '422 DEVOLUCION_INVALIDA',
      () => json(422, { codigo: 'DEVOLUCION_INVALIDA', mensaje: 'Los pagos no cuadran' }),
    ],
    [
      '422 REFERENCIA_INVALIDA',
      () => json(422, { codigo: 'REFERENCIA_INVALIDA', mensaje: 'Referencia inválida' }),
    ],
  ];

  /** Un POST que falla como se pida la primera vez y luego emite. */
  async function conPrimerFallo(fallo: () => Response) {
    let n = 0;
    const s = montar(({ cuerpo }) =>
      ++n === 1 ? fallo() : json(201, emitida(cuerpo as NotaCreditoEntrada)),
    );
    const hoja = await abrirLaHoja();
    await devolverUnLomoYEmitir(hoja);
    await within(hoja).findAllByRole('alert');
    expect(posts(s)).toHaveLength(1);
    return { s, hoja };
  }

  it.each(previos)(
    'tras un %s, el siguiente envío del intento repite el id',
    async (_nombre, fallo) => {
      const { s, hoja } = await conPrimerFallo(fallo);
      await userEvent.click(within(hoja).getByRole('button', EMITIR));
      await screen.findByText('Nota de crédito emitida');
      expect(posts(s)).toHaveLength(2);
      expect(entradaDe(s, 1).id).toBe(entradaDe(s, 0).id);
    },
  );

  it.each(finales)(
    'tras un %s (respuesta final) el id se suelta: el siguiente intento es otra nota (regresión)',
    async (_nombre, fallo) => {
      const { s, hoja } = await conPrimerFallo(fallo);
      await userEvent.click(within(hoja).getByRole('button', EMITIR));
      await screen.findByText('Nota de crédito emitida');
      expect(posts(s)).toHaveLength(2);
      expect(entradaDe(s, 1).id).not.toBe(entradaDe(s, 0).id);
    },
  );
});
