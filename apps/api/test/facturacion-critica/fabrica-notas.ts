// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// Ayudantes de las pruebas protegidas P8 (notas de crédito) y P10 (permisos) de 6b. Solo usan contratos públicos: la API
// real de 6a (`fabrica-caja.ts`, que se importa y no se modifica) con `SimuladorPse` inyectado por `crearAplicacion({ pse })`,
// la `ColaEnMemoria`, el almacén de comprobantes en memoria y el procesador de envíos llamado a mano (en `NODE_ENV=test` nada
// se procesa solo, criterio 137), el reloj manual y el publicador en memoria. Las series de notas de crédito se configuran
// por `PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo` (criterio 149) y el modo de facturación de cada emisor, por la
// ruta del superadministrador (criterio 122). Para leer filas usan un cliente administrador (solo lectura). No leen la
// implementación de la historia.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import { ProcesadorEnviosPse } from '../../src/modulos/facturacion';
import { SimuladorPse } from '../../src/modulos/facturacion/pse';
import { AlmacenEnMemoria, AlmacenComprobantesEnMemoria } from '../../src/nucleo/archivos';
import { ColaEnMemoria } from '../../src/nucleo/colas';
import {
  PublicadorEnMemoria,
  type EventoPublicable,
  type PublicadorEventos,
} from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import { PublicadorSocketIo } from '../../src/nucleo/tiempo-real';
import { INICIO_POR_DEFECTO } from '../acceso/fabrica-plataforma';
import { InventarioObservador } from '../salon-critica/fabrica-p2';
import { fijarEntornoDePrueba } from '../utilidades';
import {
  abrirTurno,
  api,
  cobrar,
  cuentaC,
  cuentaCon,
  efectivo,
  escribir,
  exigir,
  filas,
  admin,
  type AppP5,
  type Cuenta,
  type EmpresaCaja,
  type Escenario,
  type Libre,
  type NombreLinea,
  type Res,
  yape,
} from '../caja-critica/fabrica-caja';

export { efectivo, yape };
export type { Libre, Res };

// ------------------------------------------------------------------------------------------------
// La aplicación con el simulador del PSE, la cola en memoria y el procesador a mano
// ------------------------------------------------------------------------------------------------

class PublicadorDoble implements PublicadorEventos {
  destino: PublicadorEventos | null = null;
  constructor(private readonly memoria: PublicadorEnMemoria) {}
  async publicar(evento: EventoPublicable): Promise<void> {
    this.memoria.publicar(evento);
    await this.destino?.publicar(evento);
  }
}

export interface AppNotas extends AppP5 {
  /** El conector que usan todos los emisores (`crearAplicacion({ pse })`). */
  simulador: SimuladorPse;
  /** La cola de envíos: guarda los trabajos sin procesarlos. */
  cola: ColaEnMemoria;
  almacenComprobantes: AlmacenComprobantesEnMemoria;
  /** Corre el procesador de envíos (el worker) sobre un comprobante, con el contexto de su empresa. */
  procesar(empresaId: string, comprobanteId: string): Promise<void>;
}

async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') throw new Error('Sin puerto libre');
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return direccion.port;
}

/** Como `arrancarCaja`, pero con `pse`, `colaPse` y `almacenComprobantes` inyectados. */
export async function arrancarNotas(opciones: { poolMax?: number } = {}): Promise<AppNotas> {
  const puerto = await puertoLibre();
  const url = `http://127.0.0.1:${puerto}`;
  fijarEntornoDePrueba({
    poolMax: opciones.poolMax ?? 5,
    empresaPorHeader: false,
    extra: { API_URL_PUBLICA: url },
  });
  const reloj = new RelojManual(INICIO_POR_DEFECTO);
  const publicador = new PublicadorEnMemoria();
  const doble = new PublicadorDoble(publicador);
  const almacen = new AlmacenEnMemoria();
  const inventario = new InventarioObservador(publicador);
  const simulador = new SimuladorPse();
  const cola = new ColaEnMemoria();
  const almacenComprobantes = new AlmacenComprobantesEnMemoria();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: doble,
    almacenArchivos: almacen,
    inventario,
    pse: simulador,
    colaPse: cola,
    almacenComprobantes,
    tiempoReal: { habilitado: true },
  });
  await app.listen(puerto, '127.0.0.1');
  doble.destino = app.get(PublicadorSocketIo, { strict: false });
  return {
    app,
    reloj,
    publicador,
    almacen,
    inventario,
    url,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
    simulador,
    cola,
    almacenComprobantes,
    procesar: (empresaId, comprobanteId) =>
      app.get(ProcesadorEnviosPse, { strict: false }).procesar(empresaId, comprobanteId),
  };
}

// ------------------------------------------------------------------------------------------------
// Series de notas de crédito y modo de facturación de los emisores
// ------------------------------------------------------------------------------------------------

export type TipoNota = 'NOTA_CREDITO_BOLETA' | 'NOTA_CREDITO_FACTURA';

export const ponerSerieNota = (
  ctx: AppP5,
  token: string,
  sucursalId: string,
  cajaId: string,
  tipo: TipoNota,
  serie: string,
  primerNumero?: number,
): Promise<Res> =>
  api(ctx, token, 'put', `/sucursales/${sucursalId}/cajas/${cajaId}/series/${tipo}`, {
    serie,
    ...(primerNumero !== undefined ? { primerNumero } : {}),
  });

/** `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse` con el token del superadministrador (criterio 122). */
export const configurarPse = (
  ctx: AppP5,
  tokenSuperadmin: string,
  empresaId: string,
  emisorId: string,
  cuerpo: Libre = { modo: 'SIMULADO' },
): Promise<Res> =>
  api(
    ctx,
    tokenSuperadmin,
    'put',
    `/plataforma/empresas/${empresaId}/emisores/${emisorId}/pse`,
    cuerpo,
  );

/**
 * Las series de notas de crédito por empresa, sucursal y caja (las de A son distintas por sucursal porque S1 y S3 comparten
 * emisor: la serie es única por emisor y tipo). Las cajas 1 y 2 tienen serie de notas de boletas y de facturas; la caja 3,
 * solo la de boletas (para probar `SIN_SERIE`).
 */
export const SERIES_NOTA = {
  A: {
    S1: { caja1: ['BC01', 'FC01'], caja2: ['BC02', 'FC02'], caja3: ['BC03', null] },
    S2: { caja1: ['BC21', null], caja2: ['BC22', null], caja3: ['BC23', null] },
    S3: { caja1: ['BC31', 'FC31'], caja2: ['BC32', 'FC32'], caja3: ['BC33', null] },
  },
  B: {
    S1: { caja1: ['BC11', 'FC11'], caja2: ['BC12', 'FC12'], caja3: ['BC13', null] },
  },
} as const;

const preparadas = new WeakMap<object, Promise<void>>();

/**
 * Deja listas las dos empresas para las notas de crédito (una sola vez por escenario): las series de notas de crédito de
 * cada caja y la facturación de los emisores en `SIMULADO`. Si falla, cada llamada vuelve a ver el mismo error.
 */
export function prepararNotas(ctx: AppP5, esc: Escenario): Promise<void> {
  let p = preparadas.get(esc);
  if (!p) {
    p = (async () => {
      for (const [clave, e] of [
        ['A', esc.A],
        ['B', esc.B],
      ] as const) {
        const cajas = await e.cajas();
        const tabla = SERIES_NOTA[clave] as Record<
          string,
          Record<string, readonly (string | null)[]>
        >;
        for (const [sucursal, porCaja] of Object.entries(tabla)) {
          const cajasDe = cajas[sucursal as 'S1' | 'S2' | 'S3'];
          if (!cajasDe) continue;
          for (const [nombreCaja, [boleta, factura]] of Object.entries(porCaja)) {
            const cajaId = cajasDe[nombreCaja as 'caja1' | 'caja2' | 'caja3'];
            const sucursalId = e.sucursalId(sucursal as 'S1' | 'S2' | 'S3');
            if (boleta) {
              exigir(
                await ponerSerieNota(
                  ctx,
                  e.token.admin!,
                  sucursalId,
                  cajaId,
                  'NOTA_CREDITO_BOLETA',
                  boleta,
                ),
                200,
                `Serie de notas de crédito de boletas ${boleta} (006, criterio 149)`,
              );
            }
            if (factura) {
              exigir(
                await ponerSerieNota(
                  ctx,
                  e.token.admin!,
                  sucursalId,
                  cajaId,
                  'NOTA_CREDITO_FACTURA',
                  factura,
                ),
                200,
                `Serie de notas de crédito de facturas ${factura} (006, criterio 149)`,
              );
            }
          }
        }
        for (const emisor of [e.emisor1, e.emisor2]) {
          if (emisor) {
            exigir(
              await configurarPse(ctx, esc.sa.token, e.id, emisor),
              200,
              'Configurar el PSE SIMULADO del emisor (006, criterio 122)',
            );
          }
        }
      }
    })();
    preparadas.set(esc, p);
  }
  return p;
}

// ------------------------------------------------------------------------------------------------
// Turnos, boletas y facturas aceptadas
// ------------------------------------------------------------------------------------------------

/** El turno abierto de esa caja o uno nuevo (solo hay uno abierto por caja y por persona, criterio 26). */
export async function turnoAbiertoDe(
  ctx: AppP5,
  token: string,
  cajaId: string,
  fondo = '200.00',
): Promise<string> {
  const abierto = await filas(`SELECT id FROM turno WHERE caja_id = $1 AND estado = 'ABIERTO'`, [
    cajaId,
  ]);
  if (abierto[0]) return abierto[0].id as string;
  return abrirTurno(ctx, token, cajaId, fondo);
}

export const estadoDe = async (comprobanteId: string): Promise<string> =>
  (await filas('SELECT estado FROM comprobante WHERE id = $1', [comprobanteId]))[0]?.estado;

/**
 * Corre el procesador de envíos sobre el comprobante (con el simulador sin reglas) y exige que quede `ACEPTADO`: las notas
 * de crédito solo se emiten sobre un comprobante aceptado (criterio 146).
 */
export async function aceptar(ctx: AppNotas, e: EmpresaCaja, comprobanteId: string): Promise<void> {
  await ctx.procesar(e.id, comprobanteId);
  const estado = await estadoDe(comprobanteId);
  if (estado !== 'ACEPTADO') {
    throw new Error(
      `El comprobante ${comprobanteId} debía quedar ACEPTADO tras el worker y está ${estado}`,
    );
  }
}

export interface Emitido {
  /** El cuerpo de la respuesta del cobro. */
  cobro: Libre;
  comprobanteId: string;
  numero: string;
  turnoId: string;
  cajaId: string;
  cuenta: Cuenta;
  token: string;
}

export interface OpcionesEmision {
  sucursal?: 'S1' | 'S2' | 'S3';
  caja?: 'caja1' | 'caja2' | 'caja3';
  /** La persona que cobra: la clave de `e.token`. */
  quien?: string;
  lineas?: Array<[NombreLinea, number]>;
  total?: string;
  tipo?: 'BOLETA' | 'FACTURA';
  formato?: 'DETALLADO' | 'CONSUMO';
  cliente?: Libre;
  pagos?: Libre[];
  /** Si es `false`, se deja `POR_ENVIAR` (sin correr el worker). */
  aceptado?: boolean;
}

/** Cobra una cuenta (por defecto la cuenta C de `"69.20"`) y corre el worker para dejar el comprobante `ACEPTADO`. */
export async function emitirAceptado(
  ctx: AppNotas,
  e: EmpresaCaja,
  o: OpcionesEmision = {},
): Promise<Emitido> {
  const sucursal = o.sucursal ?? 'S1';
  const nombreCaja = o.caja ?? 'caja1';
  const quien = o.quien ?? 'cajero';
  const token = e.token[quien]!;
  const cajaId = (await e.cajas())[sucursal]![nombreCaja];
  const turnoId = await turnoAbiertoDe(ctx, token, cajaId);
  const cuenta = o.lineas
    ? await cuentaCon(ctx, e, sucursal, o.lineas)
    : await cuentaC(ctx, e, sucursal);
  const total = o.total ?? '69.20';
  const cobro = await cobrar(ctx, token, cuenta, {
    turnoId,
    total,
    tipo: o.tipo ?? 'BOLETA',
    ...(o.formato ? { formato: o.formato } : {}),
    ...(o.cliente ? { cliente: o.cliente } : {}),
    ...(o.pagos ? { pagos: o.pagos } : { pagos: [efectivo(total)] }),
  });
  const comprobanteId = (cobro.comprobante as Libre).id as string;
  if (o.aceptado !== false) await aceptar(ctx, e, comprobanteId);
  return {
    cobro,
    comprobanteId,
    numero: (cobro.comprobante as Libre).numero as string,
    turnoId,
    cajaId,
    cuenta,
    token,
  };
}

// ------------------------------------------------------------------------------------------------
// La nota de crédito
// ------------------------------------------------------------------------------------------------

export interface PagoNota {
  medio: string;
  monto: string;
  operacion?: string;
}

export interface OpcionesNota {
  id?: string;
  comprobanteId: string;
  tipo: 'ANULACION' | 'DEVOLUCION' | 'CAMBIO_A_FACTURA';
  motivo?: string;
  total: string;
  lineas?: Array<{ posicion: number; cantidad: number }>;
  devolucion?: { turnoId: string; pagos: PagoNota[]; redondeo: string } | null;
  cliente?: Libre;
}

/** El cuerpo de `POST /notas-credito` (criterio 144). */
export function cuerpoNota(o: OpcionesNota): Libre {
  return {
    id: o.id ?? randomUUID(),
    comprobanteId: o.comprobanteId,
    tipo: o.tipo,
    motivo: o.motivo ?? 'Error al cobrar',
    total: o.total,
    ...(o.lineas ? { lineas: o.lineas } : {}),
    ...(o.devolucion !== undefined ? { devolucion: o.devolucion } : {}),
    ...(o.cliente ? { cliente: o.cliente } : {}),
  };
}

/** `POST /notas-credito` con IK propia (o la dada) y la autorización de supervisor, si se da. */
export const notaCrudo = (
  ctx: AppP5,
  token: string | undefined,
  cuerpo: unknown,
  extra: { ik?: string; autorizacion?: string } = {},
): Promise<Res> =>
  escribir(ctx, token, 'post', '/notas-credito', cuerpo, {
    ...(extra.ik ? { 'Idempotency-Key': extra.ik } : {}),
    ...(extra.autorizacion ? { 'X-Autorizacion': extra.autorizacion } : {}),
  });

/** Emite la nota (exige 201) y devuelve el cuerpo de la respuesta (`notaCreditoRespuesta`). */
export async function emitirNota(
  ctx: AppP5,
  token: string,
  o: OpcionesNota,
  extra: { ik?: string; autorizacion?: string } = {},
): Promise<Libre> {
  const res = await notaCrudo(ctx, token, cuerpoNota(o), extra);
  exigir(res, 201, 'Emitir la nota de crédito (006, criterio 144)');
  return res.body as Libre;
}

/** El objetivo de la autorización de una nota (criterio 145). */
export const objetivoNota = (
  comprobanteId: string,
  tipoNota: 'ANULACION' | 'DEVOLUCION' | 'CAMBIO_A_FACTURA',
  total: string,
  devuelto = '0.00',
): Libre => ({ tipo: 'NOTA_CREDITO', comprobanteId, tipoNota, total, devuelto });

/** `POST /autorizaciones` para `EMITIR_NOTA_CREDITO` con el PIN del supervisor (exige 201). */
export async function autorizarNota(
  ctx: AppP5,
  token: string,
  pin: string,
  objetivo?: Libre,
  accion = 'EMITIR_NOTA_CREDITO',
): Promise<{ autorizacionId: string; expiraEn: string }> {
  const res = await api(ctx, token, 'post', '/autorizaciones', {
    accion,
    motivo: 'Autoriza el supervisor',
    pin,
    ...(objetivo ? { objetivo } : {}),
  });
  exigir(res, 201, `POST /autorizaciones (${accion})`);
  return res.body as { autorizacionId: string; expiraEn: string };
}

/** `GET /comprobantes/:id` (exige 200). */
export async function comprobanteDe(ctx: AppP5, token: string, id: string): Promise<Libre> {
  const res = await api(ctx, token, 'get', `/comprobantes/${id}`);
  exigir(res, 200, 'GET /comprobantes/:id (006, criterio 77)');
  return res.body as Libre;
}

// ------------------------------------------------------------------------------------------------
// Lectura de filas
// ------------------------------------------------------------------------------------------------

export const notasDelOriginal = (originalId: string) =>
  filas('SELECT * FROM comprobante WHERE afecta_a_id = $1 ORDER BY emitido_en, numero', [
    originalId,
  ]);

export const egresosDe = (notaId: string) =>
  filas('SELECT * FROM movimiento_caja WHERE comprobante_id = $1 ORDER BY medio, monto', [notaId]);

export const filaDeNota = async (notaId: string): Promise<Libre | undefined> =>
  (await filas('SELECT * FROM nota_credito WHERE comprobante_id = $1', [notaId]))[0];

export const envioDe = async (comprobanteId: string): Promise<Libre | undefined> =>
  (await filas('SELECT * FROM envio_pse WHERE comprobante_id = $1', [comprobanteId]))[0];

export const trabajosDeComprobante = (comprobanteId: string) =>
  filas(`SELECT * FROM trabajo_impresion WHERE comprobante_id = $1 ORDER BY creado_en, id`, [
    comprobanteId,
  ]);

export const contarFilas = async (sql: string, p: unknown[] = []): Promise<number> =>
  Number((await filas(`SELECT count(*)::text AS n FROM (${sql}) q`, p))[0]?.n ?? 0);

export const formatoNumero = (serie: string, correlativo: number): string =>
  `${serie}-${String(correlativo).padStart(8, '0')}`;

/** El consumo de comprobantes de la sucursal (cuota, criterio 155): Σ de `consumo_comprobantes.emitidos`. */
export async function consumoDeComprobantes(sucursalId: string): Promise<number> {
  const r = await filas(
    'SELECT coalesce(sum(emitidos), 0)::text AS n FROM consumo_comprobantes WHERE sucursal_id = $1',
    [sucursalId],
  );
  return Number(r[0]?.n ?? 0);
}

// ------------------------------------------------------------------------------------------------
// Fallas inyectadas por la base
// ------------------------------------------------------------------------------------------------

/**
 * Hace fallar el `INSERT` del trabajo de impresión del ticket de una nota de crédito sobre `originalId` (el último paso antes
 * de confirmar, después de numerar): un disparador temporal creado como administrador. Devuelve cómo quitarlo.
 */
export async function fallarElTicketDeLaNota(originalId: string): Promise<() => Promise<void>> {
  const nombre = `fallo_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const c = await admin();
  await c.query(`
    CREATE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.tipo = 'COMPROBANTE'
         AND EXISTS (SELECT 1 FROM comprobante k WHERE k.id = NEW.comprobante_id AND k.afecta_a_id = '${originalId}') THEN
        RAISE EXCEPTION 'falla inyectada por la prueba';
      END IF;
      RETURN NEW;
    END $f$`);
  await c.query(
    `CREATE TRIGGER ${nombre} BEFORE INSERT ON trabajo_impresion FOR EACH ROW EXECUTE FUNCTION ${nombre}()`,
  );
  return async () => {
    await c.query(`DROP TRIGGER IF EXISTS ${nombre} ON trabajo_impresion`);
    await c.query(`DROP FUNCTION IF EXISTS ${nombre}()`);
  };
}
