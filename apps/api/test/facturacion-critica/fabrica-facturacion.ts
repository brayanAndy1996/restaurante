// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// Ayudantes de las pruebas protegidas P7 (envío al PSE) y P9 (aislamiento y secretos) de la historia 006, entrega 6b
// (facturación electrónica con PSE simulado). Solo usan contratos públicos: la API real con `RelojManual`,
// `PublicadorEnMemoria`, `SimuladorPse` inyectado con `crearAplicacion({ pse })`, `ColaEnMemoria` y el almacén privado
// en memoria; las empresas por `POST /plataforma/empresas`, las cajas, las series y las tasas por sus rutas, la
// configuración del PSE de cada emisor por la ruta del superadministrador, y el procesador y el barrido de envíos
// llamados a mano (en `NODE_ENV=test` nada se procesa solo, criterio 137). Para leer filas usan el cliente
// administrador de `fabrica-caja` (solo lectura); toda escritura por SQL fija antes un actor. No leen la
// implementación de la historia.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  BarridoEnviosPse,
  CargaPadron,
  EnlacesComprobante,
  ProcesadorEnviosPse,
  SimuladorPse,
  type IdDocumentoPse,
} from '../../src/modulos/facturacion';
import { EmpresasConsulta } from '../../src/modulos/plataforma';
import { AlmacenComprobantesEnMemoria, AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { ColaEnMemoria } from '../../src/nucleo/colas';
import {
  PublicadorEnMemoria,
  type EventoPublicable,
  type PublicadorEventos,
} from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import { PublicadorSocketIo } from '../../src/nucleo/tiempo-real';
import { InventarioObservador } from '../salon-critica/fabrica-p2';
import type { AppP5 } from '../impresion-critica/fabrica-p5';
import { fijarEntornoDePrueba } from '../utilidades';
import {
  abrirTurno,
  api,
  CLIENTE_RUC,
  cobrar,
  crearEscenario,
  cuentaCon,
  escribir,
  exigirEstado,
  filas,
  INICIO,
  lineaDe,
  type Cuenta,
  type EmpresaCaja,
  type Escenario,
  type Libre,
  type NombreLinea,
  type Res,
  type Sucursal,
} from '../caja-critica/fabrica-caja';

export * from '../caja-critica/fabrica-caja';
export { filasDeAuditoria, textoDeAuditoria } from '../acceso/fabrica-plataforma';

/** El padrón de ejemplo de las pruebas (`PADRON_RUC_URL=file://…`). */
export const RUTA_PADRON_EJEMPLO = resolve(__dirname, '..', 'soporte', 'padron-ejemplo.zip');

// ------------------------------------------------------------------------------------------------
// La aplicación: SimuladorPse, ColaEnMemoria y almacén privado en memoria
// ------------------------------------------------------------------------------------------------

/**
 * Anota cada evento en memoria y lo entrega también a Socket.IO (igual que `arrancarP5`, cuyo publicador doble no se
 * exporta).
 */
class PublicadorDoble implements PublicadorEventos {
  destino: PublicadorEventos | null = null;

  constructor(private readonly memoria: PublicadorEnMemoria) {}

  async publicar(evento: EventoPublicable): Promise<void> {
    this.memoria.publicar(evento);
    await this.destino?.publicar(evento);
  }
}

export interface AppFact extends AppP5 {
  /** El conector que la aplicación usa para todos los modos de los emisores. */
  pse: SimuladorPse;
  cola: ColaEnMemoria;
  almacenC: AlmacenComprobantesEnMemoria;
  /** Los servicios del worker, resueltos en la misma aplicación (mismo reloj, mismo publicador, misma cola). */
  procesador: ProcesadorEnviosPse;
  barrido: BarridoEnviosPse;
  enlaces: EnlacesComprobante;
  carga: CargaPadron;
}

async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') throw new Error('Sin puerto libre');
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return direccion.port;
}

/**
 * La API real con `RelojManual` (lunes 2 de noviembre de 2026, 10:00 en Lima), Socket.IO, el publicador en memoria, un
 * `SimuladorPse`, una `ColaEnMemoria` y un almacén privado en memoria. El pool es de 5 conexiones salvo que se pida otro.
 */
export async function arrancarFact(
  opciones: {
    poolMax?: number;
    pse?: SimuladorPse;
    extraEntorno?: Record<string, string | undefined>;
  } = {},
): Promise<AppFact> {
  const puerto = await puertoLibre();
  const url = `http://127.0.0.1:${puerto}`;
  fijarEntornoDePrueba({
    poolMax: opciones.poolMax ?? 5,
    empresaPorHeader: false,
    extra: {
      API_URL_PUBLICA: url,
      PADRON_RUC_URL: pathToFileURL(RUTA_PADRON_EJEMPLO).href,
      ...opciones.extraEntorno,
    },
  });
  const reloj = new RelojManual(INICIO);
  const publicador = new PublicadorEnMemoria();
  const doble = new PublicadorDoble(publicador);
  const almacen = new AlmacenEnMemoria();
  const inventario = new InventarioObservador(publicador);
  const pse = opciones.pse ?? new SimuladorPse();
  const cola = new ColaEnMemoria();
  const almacenC = new AlmacenComprobantesEnMemoria();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: doble,
    almacenArchivos: almacen,
    inventario,
    pse,
    colaPse: cola,
    almacenComprobantes: almacenC,
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
    pse,
    cola,
    almacenC,
    procesador: app.get(ProcesadorEnviosPse, { strict: false }),
    barrido: app.get(BarridoEnviosPse, { strict: false }),
    enlaces: app.get(EnlacesComprobante, { strict: false }),
    carga: app.get(CargaPadron, { strict: false }),
  };
}

// ------------------------------------------------------------------------------------------------
// El escenario: A y B con el PSE de su primer emisor en SIMULADO
// ------------------------------------------------------------------------------------------------

export const rutaPse = (empresaId: string, emisorId: string): string =>
  `/plataforma/empresas/${empresaId}/emisores/${emisorId}/pse`;

/** `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse` con el token del superadministrador. */
export const ponerPse = (
  ctx: AppFact,
  esc: Pick<Escenario, 'sa'>,
  empresaId: string,
  emisorId: string,
  cuerpo: Libre,
): Promise<Res> => escribir(ctx, esc.sa.token, 'put', rutaPse(empresaId, emisorId), cuerpo);

/** Pone el emisor en `SIMULADO` (exige 200). */
export async function activarSimulado(
  ctx: AppFact,
  esc: Pick<Escenario, 'sa'>,
  e: EmpresaCaja,
  emisorId: string = e.emisor1,
  credencial?: Record<string, string> | null,
): Promise<Libre> {
  const res = await ponerPse(ctx, esc, e.id, emisorId, {
    modo: 'SIMULADO',
    ...(credencial !== undefined ? { credencial } : {}),
  });
  exigirEstado(res, 200, 'Poner el PSE del emisor en SIMULADO (006, criterio 122)');
  return res.body as Libre;
}

/**
 * Las empresas A y B de 6a con el PSE del primer emisor de cada una en `SIMULADO` (E1 de A, con las sucursales S1 y S3, y
 * E1 de B). Los demás emisores de A (E2 Nuevo RUS en S2 y E3 en S4) quedan **sin configuración**.
 */
export async function crearEscenarioFact(
  ctx: AppFact,
  opciones: { conPse?: boolean } = {},
): Promise<Escenario> {
  const esc = await crearEscenario(ctx);
  if (opciones.conPse !== false && !process.env.P7_SIN_PSE) {
    await activarSimulado(ctx, esc, esc.A);
    await activarSimulado(ctx, esc, esc.B);
  }
  return esc;
}

// ------------------------------------------------------------------------------------------------
// Cobros y comprobantes
// ------------------------------------------------------------------------------------------------

const turnos = new Map<string, Promise<string>>();

/** Un turno abierto y compartido por archivo para una persona en una caja (se abre al primer uso). */
export function turnoDe(
  ctx: AppFact,
  e: EmpresaCaja,
  persona: string,
  sucursal: Sucursal,
  caja: 'caja1' | 'caja2' | 'caja3',
): Promise<string> {
  const clave = `${e.id}:${persona}:${sucursal}:${caja}`;
  let promesa = turnos.get(clave);
  if (!promesa) {
    promesa = (async () => {
      const cajas = await e.cajas();
      return abrirTurno(ctx, e.token[persona]!, cajas[sucursal]![caja]);
    })();
    turnos.set(clave, promesa);
  }
  return promesa;
}

export interface Cobrado {
  comprobanteId: string;
  cobroId: string;
  ordenId: string;
  turnoId: string;
  cuenta: Cuenta;
  respuesta: Libre;
}

export interface OpcionesCobroLomo {
  token?: string;
  turnoId: string;
  sucursal?: Sucursal;
  tipo?: 'BOLETA' | 'FACTURA';
  cliente?: Libre;
  /** Líneas de la cuenta; por defecto un Lomo (`"28.00"`). */
  lineas?: Array<[NombreLinea, number]>;
  total?: string;
  id?: string;
}

/** Abre una mesa con un Lomo y lo cobra en efectivo (exige 201). */
export async function cobrarLomo(
  ctx: AppFact,
  e: EmpresaCaja,
  o: OpcionesCobroLomo,
): Promise<Cobrado> {
  const sucursal = o.sucursal ?? 'S1';
  const cuenta = await cuentaCon(ctx, e, sucursal, o.lineas ?? [['lomo', 1]]);
  const respuesta = await cobrar(ctx, o.token ?? e.token.cajero!, cuenta, {
    turnoId: o.turnoId,
    total: o.total ?? '28.00',
    ...(o.tipo ? { tipo: o.tipo } : {}),
    ...(o.cliente ? { cliente: o.cliente } : {}),
    ...(o.id ? { id: o.id } : {}),
  });
  return {
    comprobanteId: (respuesta.comprobante as Libre).id as string,
    cobroId: respuesta.id as string,
    ordenId: cuenta.ordenId,
    turnoId: o.turnoId,
    cuenta,
    respuesta,
  };
}

/** Una factura con el cliente RUC de los ejemplos. */
export const cobrarFactura = (
  ctx: AppFact,
  e: EmpresaCaja,
  o: OpcionesCobroLomo,
): Promise<Cobrado> =>
  cobrarLomo(ctx, e, { ...o, tipo: 'FACTURA', cliente: o.cliente ?? CLIENTE_RUC });

/** El cuerpo de una venta de mostrador de un Lomo, pagada en efectivo. */
export function cuerpoMostrador(e: EmpresaCaja, turnoId: string): Libre {
  return {
    id: randomUUID(),
    turnoId,
    lineas: [lineaDe(e.carta, 'lomo', 1)],
    total: '28.00',
    comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
    pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
    redondeo: '0.00',
  };
}

/** Una venta de mostrador de un Lomo (exige 201); devuelve el id del comprobante. */
export async function venderMostrador(
  ctx: AppFact,
  e: EmpresaCaja,
  turnoId: string,
  token: string = e.token.cajero!,
): Promise<string> {
  const res = await escribir(ctx, token, 'post', '/ventas-mostrador', cuerpoMostrador(e, turnoId));
  exigirEstado(res, 201, 'Venta de mostrador (006, criterio 79)');
  return (res.body.cobro.comprobante as Libre).id as string;
}

/** Fila de `comprobante` leída como administrador. */
export async function comprobanteFila(id: string): Promise<Libre> {
  const r = await filas('SELECT * FROM comprobante WHERE id = $1', [id]);
  if (r.length === 0) throw new Error(`No existe el comprobante ${id}`);
  return r[0]!;
}

/** El identificador del documento ante el PSE (criterio 128): RUC del emisor, tipo SUNAT, serie y número. */
export async function idPse(comprobanteId: string): Promise<IdDocumentoPse> {
  const c = await comprobanteFila(comprobanteId);
  const tipoSunat = c.tipo === 'FACTURA' ? '01' : c.tipo === 'BOLETA' ? '03' : '07';
  return {
    rucEmisor: (c.emisor as { ruc: string }).ruc,
    tipoSunat,
    serie: c.serie as string,
    numero: Number(c.numero),
  };
}

export const envioDe = async (comprobanteId: string): Promise<Libre | undefined> =>
  (await filas('SELECT * FROM envio_pse WHERE comprobante_id = $1', [comprobanteId]))[0];

export const intentosDe = (comprobanteId: string): Promise<Libre[]> =>
  filas('SELECT * FROM intento_pse WHERE comprobante_id = $1 ORDER BY numero', [comprobanteId]);

export async function estadoDe(comprobanteId: string): Promise<string> {
  return (await comprobanteFila(comprobanteId)).estado as string;
}

// ------------------------------------------------------------------------------------------------
// El worker a mano
// ------------------------------------------------------------------------------------------------

/**
 * Entrega al procesador, en orden, los trabajos vencidos de la cola en memoria **que sean de las empresas dadas**
 * (los de otras empresas del mismo servidor de pruebas se descartan sin procesarlos). Devuelve cuántos procesó.
 */
export async function procesarCola(ctx: AppFact, empresas: string[]): Promise<number> {
  let procesados = 0;
  await ctx.cola.procesarPendientes(async (trabajo) => {
    if (!empresas.includes(trabajo.empresaId)) return;
    procesados += 1;
    await ctx.procesador.procesar(trabajo.empresaId, trabajo.comprobanteId);
  }, ctx.reloj.ahora());
  return procesados;
}

/** Procesa a mano el envío de un comprobante de una empresa (el trabajo `envio-pse`). */
export const procesar = (ctx: AppFact, empresaId: string, comprobanteId: string): Promise<void> =>
  ctx.procesador.procesar(empresaId, comprobanteId);

/**
 * Limita el barrido a las empresas dadas: la lista de ids la da `EmpresasConsulta.ids()` (criterio 126), que aquí se
 * reemplaza, así el barrido de una prueba no toca los envíos de las empresas de otros archivos que corren en paralelo
 * contra la misma base. Devuelve cómo restaurarlo.
 */
export function limitarBarrido(ctx: AppFact, empresas: string[]): () => void {
  const consulta = ctx.app.get(EmpresasConsulta, { strict: false });
  const espia = vi.spyOn(consulta, 'ids').mockImplementation(() => Promise.resolve([...empresas]));
  return () => espia.mockRestore();
}

/** Mueve el reloj de la API y abre de nuevo las sesiones de las empresas dadas (las anteriores expiraron). */
export async function avanzar(
  ctx: AppFact,
  milisegundos: number,
  ...empresas: EmpresaCaja[]
): Promise<void> {
  ctx.reloj.avanzar(milisegundos);
  for (const e of empresas) await e.refrescarSesiones();
}

/** Lo que dice el reloj en un texto ISO. */
export const ahoraIso = (ctx: AppFact): string => ctx.reloj.ahora().toISOString();

// ------------------------------------------------------------------------------------------------
// Registros capturados
// ------------------------------------------------------------------------------------------------

export interface RegistrosCapturados {
  /** Cada llamada al registro de Nest, con su nivel, como texto. */
  lineas(): string[];
  /** Todo lo registrado como un solo texto. */
  texto(): string;
  /** Las llamadas de un nivel. */
  deNivel(nivel: string): string[];
  restaurar(): void;
}

const NIVELES = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

function aTexto(valor: unknown): string {
  if (valor instanceof Error) return `${valor.name}: ${valor.message}\n${valor.stack ?? ''}`;
  if (typeof valor === 'string') return valor;
  try {
    return JSON.stringify(valor, (_k, v) =>
      v instanceof Error ? { nombre: v.name, mensaje: v.message, pila: v.stack } : v,
    );
  } catch {
    return String(valor);
  }
}

/** Captura todo lo que la aplicación registra con el `Logger` de Nest (en cualquier nivel, de instancia o estático). */
export function capturarRegistros(): RegistrosCapturados {
  const registro: Array<{ nivel: string; texto: string }> = [];
  const espias = NIVELES.flatMap((nivel) => {
    const anotar = (...args: unknown[]) => {
      registro.push({ nivel, texto: args.map(aTexto).join(' ') });
    };
    return [
      vi.spyOn(Logger.prototype, nivel).mockImplementation(anotar),
      vi.spyOn(Logger, nivel).mockImplementation(anotar),
    ];
  });
  return {
    lineas: () => registro.map((r) => `${r.nivel} ${r.texto}`),
    texto: () => registro.map((r) => `${r.nivel} ${r.texto}`).join('\n'),
    deNivel: (nivel) => registro.filter((r) => r.nivel === nivel).map((r) => r.texto),
    restaurar: () => {
      for (const espia of espias) espia.mockRestore();
    },
  };
}

/** Los eventos publicados de un nombre (copias). */
export const eventosPublicados = (ctx: AppFact, nombre: string): EventoPublicable[] =>
  ctx.publicador.eventos().filter((ev) => ev.nombre === nombre);

// ------------------------------------------------------------------------------------------------
// Series de notas de crédito, anulaciones y plazos
// ------------------------------------------------------------------------------------------------

const seriesDeNotasPuestas = new Map<string, Promise<void>>();

/**
 * Pone las series de notas de crédito de las cajas 1 y 2 de las sucursales S1 y S3 que existan (criterio 149): `BN01`/`FN01` y
 * `BN02`/`FN02` en S1 y `BN31`/`FN31` y `BN32`/`FN32` en S3. Se hace una sola vez por empresa y archivo.
 */
export function seriesDeNotas(ctx: AppFact, e: EmpresaCaja): Promise<void> {
  let promesa = seriesDeNotasPuestas.get(e.id);
  if (!promesa) {
    promesa = (async () => {
      const cajas = await e.cajas();
      const t = e.token.admin!;
      const poner = async (sucursalId: string, cajaId: string, tipo: string, serie: string) =>
        exigirEstado(
          await api(ctx, t, 'put', `/sucursales/${sucursalId}/cajas/${cajaId}/series/${tipo}`, {
            serie,
          }),
          200,
          `Serie ${serie} de ${tipo} (006, criterio 149)`,
        );
      for (const [sucursal, nombre] of [
        ['S1', ['01', '02']],
        ['S3', ['31', '32']],
      ] as const) {
        const c = cajas[sucursal];
        if (!c) continue;
        await poner(e.sucursalId(sucursal), c.caja1, 'NOTA_CREDITO_BOLETA', `BN${nombre[0]}`);
        await poner(e.sucursalId(sucursal), c.caja1, 'NOTA_CREDITO_FACTURA', `FN${nombre[0]}`);
        await poner(e.sucursalId(sucursal), c.caja2, 'NOTA_CREDITO_BOLETA', `BN${nombre[1]}`);
        await poner(e.sucursalId(sucursal), c.caja2, 'NOTA_CREDITO_FACTURA', `FN${nombre[1]}`);
      }
    })();
    seriesDeNotasPuestas.set(e.id, promesa);
  }
  return promesa;
}

/** `POST /notas-credito` de tipo `ANULACION` (sin devolución) con el token dado. */
export function anularComprobante(
  ctx: AppFact,
  token: string,
  comprobanteId: string,
  total: string,
  motivo = 'Error al digitar la venta',
): Promise<Res> {
  return escribir(ctx, token, 'post', '/notas-credito', {
    id: randomUUID(),
    comprobanteId,
    tipo: 'ANULACION',
    motivo,
    total,
  });
}

/**
 * El último milisegundo, hora de Lima, de `fecha` (`AAAA-MM-DD`) más `dias` días (criterio 130): el plazo de envío. Se
 * calcula aquí, aparte de la implementación, para que las pruebas no dependan de ella.
 */
export function finDelDiaLima(fecha: string | Date, dias: number): Date {
  const texto = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : fecha;
  const [a, m, d] = texto.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias, 23 + 5, 59, 59, 999));
}

/** `comprobante.fecha_emision` como `AAAA-MM-DD`. */
export async function fechaEmisionDe(comprobanteId: string): Promise<string> {
  const r = await filas('SELECT fecha_emision::text AS f FROM comprobante WHERE id = $1', [
    comprobanteId,
  ]);
  return r[0]!.f as string;
}
