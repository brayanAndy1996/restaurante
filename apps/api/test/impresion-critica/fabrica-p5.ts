// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de la prueba protegida P5 (impresión de la comanda, entrega 3b) de la historia 004. Solo usan
// contratos públicos: la API real con `RelojManual`, un publicador que anota los eventos en memoria y además los
// manda por Socket.IO, el `InventarioDePrueba` de 3a, las empresas dadas de alta con `POST /plataforma/empresas`,
// la carta y el salón de las fábricas protegidas de 3a, y las rutas de impresión de la tabla de endpoints de 3b
// (impresoras, destino de cada estación y vinculación del puente). Para que un ticket llegue a una impresora usan
// el `SimuladorPuente` con el texto del QR de la vinculación y el `EmuladorEscPos` de `test/soporte/puente`. Para
// contar filas usan un cliente administrador (solo lectura) con los nombres de "Cambios al modelo de datos".
// No leen la implementación de la historia.
import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:net';
import { armarQrPuente, leerQrPuente, vinculacionRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import {
  PublicadorEnMemoria,
  type EventoPublicable,
  type PublicadorEventos,
} from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import { PublicadorSocketIo } from '../../src/nucleo/tiempo-real';
import { INICIO_POR_DEFECTO } from '../acceso/fabrica-plataforma';
import { exigirEstado, llamar } from '../carta-critica/fabrica-permisos-carta';
import {
  InventarioObservador,
  type AppP2,
  type CartaEjemplo,
  type SalonDePrueba,
} from '../salon-critica/fabrica-p2';
import { ClienteTiempoReal } from '../soporte';
import { EmuladorEscPos, SimuladorPuente } from '../soporte/puente';
import { fijarEntornoDePrueba } from '../utilidades';

// ------------------------------------------------------------------------------------------------
// La aplicación: eventos en memoria y Socket.IO real al mismo tiempo
// ------------------------------------------------------------------------------------------------

/**
 * Publicador de la prueba: anota cada evento en memoria (para contar y comprobar la sala) y lo entrega también al
 * publicador de Socket.IO de la aplicación, así los puentes conectados lo reciben de verdad. Lo llaman las
 * operaciones solo después de confirmar la transacción.
 */
class PublicadorDoble implements PublicadorEventos {
  destino: PublicadorEventos | null = null;

  constructor(private readonly memoria: PublicadorEnMemoria) {}

  async publicar(evento: EventoPublicable): Promise<void> {
    this.memoria.publicar(evento);
    await this.destino?.publicar(evento);
  }
}

export interface AppP5 extends AppP2 {
  /** `http://127.0.0.1:<puerto>`: la URL de la API para el QR y para el simulador. */
  url: string;
}

/** Un puerto libre de la máquina (para fijar `API_URL_PUBLICA` antes de crear la aplicación). */
async function puertoLibre(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') throw new Error('Sin puerto libre');
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return direccion.port;
}

/**
 * Arranca la API real con `RelojManual`, `InventarioObservador` y Socket.IO habilitado, escuchando en un puerto
 * propio. El pool es de 5 conexiones: los casos concurrentes necesitan que varias peticiones avancen a la vez.
 */
export async function arrancarP5(opciones: { poolMax?: number } = {}): Promise<AppP5> {
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
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: doble,
    almacenArchivos: almacen,
    inventario,
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
  };
}

// ------------------------------------------------------------------------------------------------
// Para cerrar al terminar
// ------------------------------------------------------------------------------------------------

/** Lo que hay que cerrar al terminar (sockets, simuladores, emuladores), en orden inverso al de creación. */
export class Cierres {
  private readonly pendientes: Array<() => Promise<void> | void> = [];

  agregar(cierre: () => Promise<void> | void): void {
    this.pendientes.push(cierre);
  }

  async cerrarTodo(): Promise<void> {
    while (this.pendientes.length > 0) {
      const cierre = this.pendientes.pop()!;
      try {
        await cierre();
      } catch {
        // Seguir cerrando el resto.
      }
    }
  }
}

/** Convierte una preparación en una que corre una sola vez (si falla, cada uso vuelve a ver el mismo error). */
export function memorizar<T>(preparar: () => Promise<T>): () => Promise<T> {
  let promesa: Promise<T> | null = null;
  return () => (promesa ??= preparar());
}

export const esperar = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

// ------------------------------------------------------------------------------------------------
// Impresoras, destinos y puente, por las rutas de 3b
// ------------------------------------------------------------------------------------------------

export interface ImpresoraDePrueba {
  id: string;
  nombre: string;
  anchoMm: 58 | 80;
  emulador: EmuladorEscPos;
}

/** Crea el emulador de una impresora de red y la da de alta con `POST /sucursales/:id/impresoras` (exige 201). */
export async function crearImpresora(
  ctx: AppP5,
  cierres: Cierres,
  tokenAdmin: string,
  sucursalId: string,
  nombre: string,
  opciones: { anchoMm?: 58 | 80; juegoCaracteres?: string } = {},
): Promise<ImpresoraDePrueba> {
  const anchoMm = opciones.anchoMm ?? 80;
  const emulador = await EmuladorEscPos.iniciar({ anchoMm, nombre });
  cierres.agregar(() => emulador.cerrar());
  const res = await llamar(ctx, tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/impresoras`,
    cuerpo: {
      nombre,
      conexion: { tipo: 'RED', host: emulador.host, puerto: emulador.puerto },
      anchoMm,
      juegoCaracteres: opciones.juegoCaracteres ?? 'PC850',
      gaveta: false,
    },
  });
  exigirEstado(res, 201, `crear la impresora ${nombre}`);
  return { id: res.body.id as string, nombre, anchoMm, emulador };
}

export type DestinoDeEstacion = { destino: 'KDS' } | { destino: 'IMPRESORA'; impresoraId: string };

/** `PUT /sucursales/:id/estaciones-destino/:estacionId` (exige 200). */
export async function fijarDestino(
  ctx: AppP5,
  tokenAdmin: string,
  sucursalId: string,
  estacionId: string,
  destino: DestinoDeEstacion,
): Promise<void> {
  const res = await llamar(ctx, tokenAdmin, {
    metodo: 'put',
    ruta: `/sucursales/${sucursalId}/estaciones-destino/${estacionId}`,
    cuerpo: destino,
  });
  exigirEstado(res, 200, `fijar el destino de la estación ${estacionId}`);
}

/** Opciones del simulador: esperas cortas y sin pedido periódico (el aviso `trabajo.nuevo` es lo que lo mueve). */
export const OPCIONES_SIMULADOR = {
  versionApp: 'simulador-p5',
  nombreEquipo: 'Puente de prueba',
  modelo: 'Simulador',
  intervaloTrabajosMs: 600_000,
  intervaloLatidoMs: 600_000,
  esperaInicialMs: 50,
  esperaMaximaMs: 400,
  tiempoImpresoraMs: 1_500,
} as const;

/**
 * El Administrador pide un código de vinculación (`POST /sucursales/:id/vinculaciones-puente`) y el simulador
 * se vincula con el texto del QR. Si el QR no apunta a la URL donde escucha esta prueba, se rearma con la misma
 * credencial `vi.…` (la URL pública de la API es asunto de la historia del puente, no de la impresión).
 */
export async function vincularPuente(
  ctx: AppP5,
  cierres: Cierres,
  tokenAdmin: string,
  sucursalId: string,
): Promise<SimuladorPuente> {
  const res = await llamar(ctx, tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/vinculaciones-puente`,
  });
  exigirEstado(res, 201, 'pedir el código de vinculación del puente');
  const vinculacion = vinculacionRespuestaSchema.parse(res.body);
  const leido = leerQrPuente(vinculacion.qr);
  if (leido === null)
    throw new Error(`El QR de la vinculación no se puede leer: ${vinculacion.qr}`);
  const qr = leido.api === ctx.url ? vinculacion.qr : armarQrPuente(ctx.url, leido.token);
  const simulador = new SimuladorPuente({ ...OPCIONES_SIMULADOR, qr });
  await simulador.vincular();
  cierres.agregar(() => simulador.detener());
  return simulador;
}

/** Un simulador que ya conoce su credencial `pu.…` (como la app al volver a abrirse). Hay que iniciarlo. */
export function simuladorVinculado(
  ctx: AppP5,
  cierres: Cierres,
  token: string,
  extra: Partial<ConstructorParameters<typeof SimuladorPuente>[0]> = {},
): SimuladorPuente {
  const simulador = new SimuladorPuente({
    ...OPCIONES_SIMULADOR,
    ...extra,
    api: ctx.url,
    token,
  });
  cierres.agregar(() => simulador.detener());
  return simulador;
}

/** Conecta al espacio `/puente` de Socket.IO con la credencial del puente (un cliente que solo escucha). */
export async function conectarSocketDelPuente(
  app: INestApplication,
  cierres: Cierres,
  token: string,
): Promise<ClienteTiempoReal> {
  const cliente = await ClienteTiempoReal.conectar(app, { token }, { espacio: '/puente' });
  cierres.agregar(() => cliente.cerrar());
  return cliente;
}

// ------------------------------------------------------------------------------------------------
// Una sucursal con impresión configurada
// ------------------------------------------------------------------------------------------------

export interface SucursalP5 {
  etiqueta: string;
  id: string;
  carta: CartaEjemplo;
  salon: SalonDePrueba;
  /** Administrador de la empresa (`ADMINISTRAR`, sin sucursal activa). */
  tokenAdmin: string;
  /** Quien comanda (`ATENDER_MESA`) con esta sucursal activa. */
  tokenMozo: string;
  /** Quien anula sin clave (Supervisor o Administrador) con esta sucursal activa. */
  tokenSupervisor: string;
  /** Quien marca agotado (Cocina/Barra, Supervisor o Administrador) con esta sucursal activa. */
  tokenCocina: string;
  /** La impresora de la estación Cocina (destino `IMPRESORA`). */
  cocina: ImpresoraDePrueba;
  /** El puente vinculado (sin iniciar), si se pidió. */
  puente: SimuladorPuente | null;
  /** Un cliente de Socket.IO conectado al espacio `/puente` con la credencial del puente, si se pidió. */
  socket: ClienteTiempoReal | null;
}

export interface ParametrosSucursalP5 {
  etiqueta: string;
  sucursalId: string;
  carta: CartaEjemplo;
  salon: SalonDePrueba;
  tokenAdmin: string;
  tokenMozo: string;
  tokenSupervisor: string;
  tokenCocina: string;
  /** Si es `true`, Barra se deja al KDS con un `PUT` explícito; si no, sin configurar (el KDS por defecto). */
  barraAlKdsExplicito: boolean;
  /** Vincula un puente (con el simulador y el texto del QR). */
  conPuente: boolean;
  /** Además, conecta un cliente de Socket.IO al espacio `/puente` con la credencial del puente. */
  conSocket: boolean;
}

/**
 * Deja la sucursal como la pide la prueba: una impresora de red para Cocina (su emulador) con la estación Cocina
 * apuntando a ella por `IMPRESORA`; Barra al KDS; y, si se pide, el puente vinculado y su socket.
 */
export async function prepararSucursalP5(
  ctx: AppP5,
  cierres: Cierres,
  p: ParametrosSucursalP5,
): Promise<SucursalP5> {
  const cocina = await crearImpresora(
    ctx,
    cierres,
    p.tokenAdmin,
    p.sucursalId,
    `Cocina ${p.etiqueta}`,
  );
  await fijarDestino(ctx, p.tokenAdmin, p.sucursalId, p.carta.cocinaId, {
    destino: 'IMPRESORA',
    impresoraId: cocina.id,
  });
  if (p.barraAlKdsExplicito) {
    await fijarDestino(ctx, p.tokenAdmin, p.sucursalId, p.carta.barraId, { destino: 'KDS' });
  }
  const puente = p.conPuente
    ? await vincularPuente(ctx, cierres, p.tokenAdmin, p.sucursalId)
    : null;
  const socket =
    puente !== null && p.conSocket
      ? await conectarSocketDelPuente(ctx.app, cierres, puente.token!)
      : null;
  return {
    etiqueta: p.etiqueta,
    id: p.sucursalId,
    carta: p.carta,
    salon: p.salon,
    tokenAdmin: p.tokenAdmin,
    tokenMozo: p.tokenMozo,
    tokenSupervisor: p.tokenSupervisor,
    tokenCocina: p.tokenCocina,
    cocina,
    puente,
    socket,
  };
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

export interface TrabajoBd {
  id: string;
  sucursal_id: string;
  impresora_id: string;
  tipo: string;
  comanda_id: string | null;
  reimpresion_de_id: string | null;
  estado: 'PENDIENTE' | 'IMPRESO';
  intentos: number;
  impreso_en: Date | null;
  creado_en: Date;
}

const COLUMNAS_TRABAJO = `id, sucursal_id, impresora_id, tipo, comanda_id, reimpresion_de_id, estado,
  intentos, impreso_en, creado_en`;

/** Los trabajos de impresión de las comandas dadas, en el orden en que se crearon. */
export async function trabajosDeComandas(
  admin: Client,
  comandaIds: readonly string[],
): Promise<TrabajoBd[]> {
  const { rows } = await admin.query<TrabajoBd>(
    `SELECT ${COLUMNAS_TRABAJO} FROM trabajo_impresion
      WHERE comanda_id = ANY($1::uuid[]) ORDER BY creado_en, id`,
    [comandaIds],
  );
  return rows;
}

/** Los trabajos de impresión de una sucursal, en el orden en que se crearon. */
export async function trabajosDeSucursal(admin: Client, sucursalId: string): Promise<TrabajoBd[]> {
  const { rows } = await admin.query<TrabajoBd>(
    `SELECT ${COLUMNAS_TRABAJO} FROM trabajo_impresion
      WHERE sucursal_id = $1 ORDER BY creado_en, id`,
    [sucursalId],
  );
  return rows;
}

/** Cuántos trabajos tiene una sucursal. */
export async function contarTrabajos(admin: Client, sucursalId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM trabajo_impresion WHERE sucursal_id = $1`,
    [sucursalId],
  );
  return rows[0]!.n;
}

/** El `destino` y la estación de cada comanda de una orden, con su tipo. */
export interface ComandaBd {
  id: string;
  estacion_id: string;
  tipo: 'COMANDA' | 'ADICION' | 'MARCHAR' | 'ANULACION';
  destino: 'KDS' | 'IMPRESORA';
}

export async function comandasBd(admin: Client, ordenId: string): Promise<ComandaBd[]> {
  const { rows } = await admin.query<ComandaBd>(
    `SELECT id, estacion_id, tipo, destino FROM comanda WHERE orden_id = $1 ORDER BY creado_en, id`,
    [ordenId],
  );
  return rows;
}

// ------------------------------------------------------------------------------------------------
// Eventos publicados
// ------------------------------------------------------------------------------------------------

/** Los avisos `trabajo.nuevo` anotados en memoria, en el orden en que se publicaron. */
export function avisosDeTrabajo(ctx: AppP5): EventoPublicable[] {
  return ctx.publicador.eventos().filter((e) => e.nombre === 'trabajo.nuevo');
}

/** Espera hasta `ms` a que se cumpla la condición (consulta cada 20 ms). */
export async function esperarHasta(
  condicion: () => boolean | Promise<boolean>,
  ms = 2000,
  descripcion = 'la condición',
): Promise<void> {
  const limite = Date.now() + ms;
  while (!(await condicion())) {
    if (Date.now() >= limite) throw new Error(`No ocurrió ${descripcion} en ${ms} ms`);
    await esperar(20);
  }
}
