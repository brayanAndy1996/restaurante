import { createConnection } from 'node:net';
import {
  CABECERA_HAY_MAS_TRABAJOS,
  CABECERA_PROTOCOLO_PUENTE,
  ESPACIO_PUENTE,
  IDS_IMPRESOS_RECORDADOS,
  INTERVALO_LATIDO_MS,
  INTERVALO_PEDIR_TRABAJOS_MS,
  MAXIMO_TRABAJOS_POR_IMPRESORA,
  VERSION_PROTOCOLO_PUENTE,
  configuracionPuenteSchema,
  eventoTrabajoNuevoDatosSchema,
  leerQrPuente,
  trabajoParaImprimirSchema,
  vincularPuenteRespuestaSchema,
  type ConfiguracionPuente,
  type ImpresoraDelPuente,
  type LatidoEntrada,
  type ResultadoTrabajoEntrada,
  type TipoTrabajo,
  type TrabajoParaImprimir,
  type VincularPuenteRespuesta,
} from '@restaurante/contratos';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';

// Historia 004, T36 (infraestructura de pruebas de 3b, no protegida).
//
// Simulador del puente de impresión (criterio 134): implementa el protocolo de `packages/contratos/src/puente.ts`
// igual que lo hará la app Android (entrega 3c). Vincula con el texto del QR, abre el socket del espacio
// `/puente`, pide los trabajos al conectarse, al recibir `trabajo.nuevo` y cada 30 segundos, los manda por TCP a
// cada impresora en orden, reporta el resultado, recuerda los últimos 500 ids impresos para no imprimir dos veces
// un trabajo repetido, manda el latido y reintenta con espera creciente si la impresora no responde.
//
// Solo imprime en impresoras de red (decisión 12): los trabajos de una impresora Bluetooth se dejan pendientes y no
// se reportan. No depende de Vitest ni de la API: usa `fetch`, `socket.io-client` y `net`, así que sirve a las
// pruebas, al E2E y a `pnpm puente:simular`.

/** Un fallo del protocolo: la respuesta de la API (`estado` y `codigo` del cuerpo) o un fallo de red (`estado` 0). */
export class ErrorProtocoloPuente extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string | null,
    mensaje: string,
    readonly cuerpo?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorProtocoloPuente';
  }
}

export interface OpcionesSimuladorPuente {
  /** El texto del QR de vinculación (`restaurante-puente://vincular?api=…&t=vi.…`). */
  qr?: string;
  /** La URL de la API y el token `pu.…` de un puente ya vinculado (si no se usa `qr`). */
  api?: string;
  token?: string;
  nombreEquipo?: string;
  modelo?: string;
  /** Por defecto `simulador-1.0.0`. */
  versionApp?: string;
  /** Cada cuánto pide trabajos aunque no reciba aviso. Por defecto 30 000 ms. */
  intervaloTrabajosMs?: number;
  /** Cada cuánto manda el latido. Por defecto 20 000 ms. */
  intervaloLatidoMs?: number;
  /** Primera espera tras un fallo (de una impresora o del socket); se duplica hasta la máxima. Por defecto 1 000 ms. */
  esperaInicialMs?: number;
  /** Tope de la espera creciente. Por defecto 30 000 ms. */
  esperaMaximaMs?: number;
  /** Cuánto espera a que una impresora acepte y cierre la conexión. Por defecto 3 000 ms. */
  tiempoImpresoraMs?: number;
  /** Cuántos ids impresos recuerda. Por defecto 500. */
  idsRecordados?: number;
  /** Se llama con cada mensaje de la bitácora (el script lo manda a la consola). */
  registrar?: (mensaje: string) => void;
  /** Se llama con el token `pu.…` al vincular (el script lo guarda en un archivo). */
  guardarToken?: (token: string) => void | Promise<void>;
  fetch?: typeof fetch;
}

export interface ImpresionRealizada {
  trabajoId: string;
  impresoraId: string;
  tipo: TipoTrabajo;
  /** Los bytes que se mandaron a la impresora. */
  bytes: Uint8Array;
  en: number;
}

export interface ResultadoReportado {
  trabajoId: string;
  resultado: 'IMPRESO' | 'NO_IMPRESO';
  error?: string;
  en: number;
}

export interface EntradaDeBitacora {
  en: number;
  tipo: string;
  detalle?: unknown;
}

export type EstadoDelSimulador = 'nuevo' | 'vinculado' | 'iniciado' | 'detenido' | 'revocado';

const ESPERA_POR_DEFECTO_MS = 5_000;
const TIEMPO_HTTP_MS = 10_000;

/** Manda los bytes a una impresora de red y espera a que cierre la conexión (como una impresora que recibió todo). */
function enviarAImpresora(
  host: string,
  puerto: number,
  bytes: Uint8Array,
  tiempoMs: number,
): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const socket = createConnection({ host, port: puerto });
    let terminado = false;
    const terminar = (error?: Error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      socket.destroy();
      if (error === undefined) resolver();
      else rechazar(error);
    };
    const temporizador = setTimeout(() => {
      terminar(new Error(`La impresora ${host}:${puerto} no respondió en ${tiempoMs} ms`));
    }, tiempoMs);
    socket.once('connect', () => socket.end(Buffer.from(bytes)));
    socket.once('error', (error) => terminar(new Error(`${host}:${puerto}: ${error.message}`)));
    socket.once('close', (huboError) => {
      terminar(
        huboError ? new Error(`${host}:${puerto}: la conexión se cerró con error`) : undefined,
      );
    });
  });
}

/** Comprueba que la impresora acepta una conexión (sin mandar nada). */
function sondearImpresora(host: string, puerto: number, tiempoMs: number): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const socket = createConnection({ host, port: puerto });
    let terminado = false;
    const terminar = (error?: Error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      socket.destroy();
      if (error === undefined) resolver();
      else rechazar(error);
    };
    const temporizador = setTimeout(() => {
      terminar(new Error(`La impresora ${host}:${puerto} no respondió en ${tiempoMs} ms`));
    }, tiempoMs);
    socket.once('connect', () => terminar());
    socket.once('error', (error) => terminar(new Error(`${host}:${puerto}: ${error.message}`)));
  });
}

const textoDeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const recortar = (texto: string, largo: number): string =>
  texto.length <= largo ? texto : `${texto.slice(0, largo - 1)}…`;

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export class SimuladorPuente {
  /** Lo que se mandó a las impresoras, en orden. */
  readonly impresiones: ImpresionRealizada[] = [];
  /** Los resultados que la API aceptó, en orden. */
  readonly resultados: ResultadoReportado[] = [];
  /** Los resultados que la API rechazó con 404 o 409 (trabajo ajeno o vencido). */
  readonly rechazados: Array<ResultadoReportado & { estado: number }> = [];
  /** Los trabajos repetidos que no se volvieron a imprimir porque ya estaban en la memoria de ids. */
  readonly omitidos: string[] = [];
  /** Los latidos que la API aceptó, en orden. */
  readonly latidos: LatidoEntrada[] = [];
  /** Todo lo que pasó, en orden. */
  readonly bitacora: EntradaDeBitacora[] = [];
  /** Cuántas veces pidió trabajos (con éxito o sin él). */
  peticionesDeTrabajos = 0;

  private api: string | null;
  private tokenActual: string | null;
  private configuracionActual: ConfiguracionPuente | null = null;
  private datosDelPuente: VincularPuenteRespuesta['puente'] | null = null;
  private datosDeLaSucursal: VincularPuenteRespuesta['sucursal'] | null = null;
  private estadoActual: EstadoDelSimulador = 'nuevo';
  private socket: Socket | null = null;
  private ultimoErrorDelSocket: string | null = null;

  private temporizadorTrabajos: NodeJS.Timeout | null = null;
  private temporizadorLatido: NodeJS.Timeout | null = null;
  private temporizadorDeSocket: NodeJS.Timeout | null = null;
  private readonly temporizadoresDeReintento = new Set<NodeJS.Timeout>();

  private ciclo: Promise<void> | null = null;
  private repetirCiclo = false;
  private latiendo: Promise<void> | null = null;
  private repetirLatido = false;

  private readonly idsImpresos = new Set<string>();
  private readonly ordenDeIds: string[] = [];
  private readonly fallos = new Map<string, { cantidad: number; hasta: number }>();
  private readonly estadosDeImpresoras = new Map<string, { estado: string; error?: string }>();
  private ultimoReportado = new Map<string, string>();

  private readonly intervaloTrabajosMs: number;
  private readonly intervaloLatidoMs: number;
  private readonly esperaInicialMs: number;
  private readonly esperaMaximaMs: number;
  private readonly tiempoImpresoraMs: number;
  private readonly idsRecordados: number;
  private readonly versionApp: string;
  private readonly peticion: typeof fetch;

  constructor(private readonly opciones: OpcionesSimuladorPuente = {}) {
    this.api = opciones.api?.replace(/\/+$/, '') ?? null;
    this.tokenActual = opciones.token ?? null;
    this.intervaloTrabajosMs = opciones.intervaloTrabajosMs ?? INTERVALO_PEDIR_TRABAJOS_MS;
    this.intervaloLatidoMs = opciones.intervaloLatidoMs ?? INTERVALO_LATIDO_MS;
    this.esperaInicialMs = opciones.esperaInicialMs ?? 1_000;
    this.esperaMaximaMs = opciones.esperaMaximaMs ?? 30_000;
    this.tiempoImpresoraMs = opciones.tiempoImpresoraMs ?? 3_000;
    this.idsRecordados = opciones.idsRecordados ?? IDS_IMPRESOS_RECORDADOS;
    this.versionApp = opciones.versionApp ?? 'simulador-1.0.0';
    this.peticion = opciones.fetch ?? fetch;
    if (this.tokenActual !== null) this.estadoActual = 'vinculado';
  }

  /** Crea el simulador, lo vincula con el QR (o con el token dado) y lo inicia. */
  static async iniciar(opciones: OpcionesSimuladorPuente): Promise<SimuladorPuente> {
    const simulador = new SimuladorPuente(opciones);
    if (simulador.tokenActual === null) await simulador.vincular();
    await simulador.iniciar();
    return simulador;
  }

  // ---------------------------------------------------------------------------------------------------
  // Estado visible
  // ---------------------------------------------------------------------------------------------------

  get estado(): EstadoDelSimulador {
    return this.estadoActual;
  }

  /** El token `pu.…` del puente, una vez vinculado. */
  get token(): string | null {
    return this.tokenActual;
  }

  /** La URL de la API (la del QR o la de las opciones). */
  get urlApi(): string | null {
    return this.api;
  }

  get configuracion(): ConfiguracionPuente | null {
    return this.configuracionActual;
  }

  get puente(): VincularPuenteRespuesta['puente'] | null {
    return this.datosDelPuente;
  }

  get sucursal(): VincularPuenteRespuesta['sucursal'] | null {
    return this.datosDeLaSucursal;
  }

  /** `true` si el socket del espacio `/puente` está conectado. */
  get conectado(): boolean {
    return this.socket?.connected === true;
  }

  /** `true` si la API revocó el puente (401 o `NO_AUTENTICADO` en el socket): se detuvo y no vuelve a intentar. */
  get revocado(): boolean {
    return this.estadoActual === 'revocado';
  }

  /** El motivo del último rechazo del socket (por ejemplo `No implementado` o `NO_AUTENTICADO`). */
  get errorDelSocket(): string | null {
    return this.ultimoErrorDelSocket;
  }

  /** Los ids de trabajos impresos que recuerda, del más viejo al más nuevo. */
  get idsRecordadosActuales(): readonly string[] {
    return this.ordenDeIds;
  }

  /** Los ids de los trabajos que la API aceptó como `IMPRESO`, en orden. */
  get impresos(): string[] {
    return this.resultados.filter((r) => r.resultado === 'IMPRESO').map((r) => r.trabajoId);
  }

  // ---------------------------------------------------------------------------------------------------
  // Vincular e iniciar
  // ---------------------------------------------------------------------------------------------------

  /**
   * `POST /puente/vinculacion` con el código `vi.…` del QR. Guarda el token `pu.…`, la configuración y los datos
   * del puente. Lanza `ErrorProtocoloPuente` si la API rechaza el código.
   */
  async vincular(): Promise<VincularPuenteRespuesta> {
    const qr = leerQrPuente(this.opciones.qr ?? '');
    if (qr === null) {
      throw new ErrorProtocoloPuente(
        0,
        'QR_INVALIDO',
        'El texto no es un QR de vinculación del puente',
      );
    }
    this.api = qr.api;
    const cuerpo = await this.http(
      'POST',
      '/puente/vinculacion',
      {
        ...(this.opciones.nombreEquipo !== undefined && {
          nombreEquipo: this.opciones.nombreEquipo,
        }),
        ...(this.opciones.modelo !== undefined && { modelo: this.opciones.modelo }),
        versionApp: this.versionApp,
      },
      qr.token,
    );
    const respuesta = this.leer(vincularPuenteRespuestaSchema, cuerpo, 'la vinculación');
    this.tokenActual = respuesta.token;
    this.configuracionActual = respuesta.configuracion;
    this.datosDelPuente = respuesta.puente;
    this.datosDeLaSucursal = respuesta.sucursal;
    if (this.estadoActual === 'nuevo') this.estadoActual = 'vinculado';
    this.anotar('vinculado', { puenteId: respuesta.puente.id, sucursalId: respuesta.sucursal.id });
    await this.opciones.guardarToken?.(respuesta.token);
    return respuesta;
  }

  /**
   * Abre el socket del espacio `/puente`, arranca el pedido periódico de trabajos y el latido, y espera a que el
   * socket se conecte (hasta `tiempoMs`, 5 s por defecto; con `esperarConexion: false` no espera). Si la conexión
   * no se logra, lo detiene y lanza un `Error` con el motivo (por ejemplo `No implementado`).
   */
  async iniciar(opciones: { esperarConexion?: boolean; tiempoMs?: number } = {}): Promise<void> {
    if (this.tokenActual === null || this.api === null) {
      throw new Error('El simulador no está vinculado: llama vincular() o pasa api y token');
    }
    if (this.estadoActual === 'iniciado') return;
    if (this.configuracionActual === null) await this.refrescarConfiguracion();
    this.estadoActual = 'iniciado';
    this.crearSocket();
    this.temporizadorTrabajos = setInterval(() => {
      void this.pedirTrabajosAhora().catch(() => undefined);
    }, this.intervaloTrabajosMs);
    this.temporizadorLatido = setInterval(() => {
      void this.latirAhora().catch(() => undefined);
    }, this.intervaloLatidoMs);
    if (opciones.esperarConexion === false) return;
    const tiempoMs = opciones.tiempoMs ?? ESPERA_POR_DEFECTO_MS;
    try {
      await this.esperarHasta(
        () => this.conectado || this.revocado,
        tiempoMs,
        'que el socket del puente se conecte',
      );
    } catch {
      const motivo = this.ultimoErrorDelSocket ?? 'sin respuesta';
      await this.detener();
      throw new Error(`El puente no pudo conectar el socket del espacio /puente: ${motivo}`);
    }
    if (this.revocado) throw new Error('El puente fue revocado');
  }

  /** Detiene los temporizadores y cierra el socket. Espera a que termine lo que estaba haciendo. */
  async detener(): Promise<void> {
    if (this.estadoActual !== 'revocado') this.estadoActual = 'detenido';
    this.pararTodo();
    await Promise.allSettled([this.ciclo, this.latiendo]);
    this.anotar('detenido');
  }

  /** Simula una caída de red del socket (el puente intenta reconectar solo, con espera creciente). */
  desconectarSocket(): void {
    this.socket?.io.engine?.close();
  }

  // ---------------------------------------------------------------------------------------------------
  // Trabajos
  // ---------------------------------------------------------------------------------------------------

  /**
   * Pide los trabajos pendientes y los imprime en orden. Si ya hay un ciclo en curso, se junta con él (hace otra
   * vuelta al terminar). Se resuelve cuando termina el ciclo.
   */
  pedirTrabajosAhora(): Promise<void> {
    if (this.ciclo !== null) {
      this.repetirCiclo = true;
      return this.ciclo;
    }
    const ciclo = (async () => {
      try {
        do {
          this.repetirCiclo = false;
          await this.vueltaDeTrabajos();
        } while (this.repetirCiclo && this.puedeTrabajar());
      } finally {
        this.ciclo = null;
      }
    })();
    this.ciclo = ciclo;
    return ciclo;
  }

  private puedeTrabajar(): boolean {
    return (
      this.tokenActual !== null &&
      this.estadoActual !== 'revocado' &&
      this.estadoActual !== 'detenido'
    );
  }

  private async vueltaDeTrabajos(): Promise<void> {
    if (!this.puedeTrabajar()) return;
    let lote: TrabajoParaImprimir[];
    let avance: number;
    const api = { hayMas: false };
    do {
      try {
        this.peticionesDeTrabajos += 1;
        // La API avisa con una cabecera que algo no entró por el tope de bytes de la respuesta.
        api.hayMas = false;
        const cuerpo = await this.http('GET', '/puente/trabajos', undefined, undefined, (r) => {
          api.hayMas = r.headers.get(CABECERA_HAY_MAS_TRABAJOS) === '1';
        });
        lote = this.leer(z.array(trabajoParaImprimirSchema), cuerpo, 'los trabajos');
      } catch (error) {
        this.anotar('error-trabajos', textoDeError(error));
        return;
      }
      this.anotar(
        'trabajos',
        lote.map((t) => t.id),
      );
      avance = await this.procesarLote(lote);
    } while ((api.hayMas || hayMasPorPedir(lote)) && avance > 0 && this.puedeTrabajar());
  }

  /** Imprime el lote en el orden recibido; devuelve cuántos trabajos quedaron resueltos (impresos u omitidos). */
  private async procesarLote(lote: readonly TrabajoParaImprimir[]): Promise<number> {
    const bloqueadas = new Set<string>();
    let resueltos = 0;
    for (const trabajo of lote) {
      if (!this.puedeTrabajar()) break;
      if (this.idsImpresos.has(trabajo.id)) {
        // Ya salió: solo falta que la API lo sepa (el resultado anterior pudo perderse).
        this.omitidos.push(trabajo.id);
        this.anotar('omitido', trabajo.id);
        await this.reportar(trabajo, { resultado: 'IMPRESO' });
        resueltos += 1;
        continue;
      }
      let impresora = this.impresoraDe(trabajo.impresoraId);
      if (impresora === undefined) {
        await this.refrescarConfiguracion().catch(() => undefined);
        impresora = this.impresoraDe(trabajo.impresoraId);
      }
      if (impresora === undefined) {
        this.anotar('impresora-desconocida', trabajo.impresoraId);
        continue;
      }
      if (impresora.conexion.tipo !== 'RED') {
        // Bluetooth llega con la app 3c (decisión 12): el trabajo queda pendiente.
        this.anotar('bluetooth-no-soportado', trabajo.id);
        continue;
      }
      if (bloqueadas.has(impresora.id)) continue;
      const espera = this.fallos.get(impresora.id);
      if (espera !== undefined && Date.now() < espera.hasta) {
        bloqueadas.add(impresora.id);
        continue;
      }
      const bytes = Buffer.from(trabajo.bytes, 'base64');
      try {
        await enviarAImpresora(
          impresora.conexion.host,
          impresora.conexion.puerto,
          bytes,
          this.tiempoImpresoraMs,
        );
      } catch (error) {
        bloqueadas.add(impresora.id);
        const mensaje = textoDeError(error);
        const cantidad = this.fallos.get(impresora.id)?.cantidad ?? 0;
        const demora = Math.min(this.esperaInicialMs * 2 ** cantidad, this.esperaMaximaMs);
        this.fallos.set(impresora.id, { cantidad: cantidad + 1, hasta: Date.now() + demora });
        this.programarReintento(demora);
        this.fijarEstadoDeImpresora(impresora.id, 'NO_RESPONDE', mensaje);
        this.anotar('impresora-no-responde', { impresoraId: impresora.id, mensaje, demora });
        await this.reportar(trabajo, { resultado: 'NO_IMPRESO', error: recortar(mensaje, 200) });
        continue;
      }
      this.recordarId(trabajo.id);
      this.impresiones.push({
        trabajoId: trabajo.id,
        impresoraId: impresora.id,
        tipo: trabajo.tipo,
        bytes: Uint8Array.from(bytes),
        en: Date.now(),
      });
      this.fallos.delete(impresora.id);
      this.fijarEstadoDeImpresora(impresora.id, 'LISTA');
      this.anotar('impreso', trabajo.id);
      await this.reportar(trabajo, { resultado: 'IMPRESO' });
      resueltos += 1;
    }
    return resueltos;
  }

  private recordarId(id: string): void {
    this.idsImpresos.add(id);
    this.ordenDeIds.push(id);
    while (this.ordenDeIds.length > this.idsRecordados) {
      const viejo = this.ordenDeIds.shift()!;
      this.idsImpresos.delete(viejo);
    }
  }

  private async reportar(
    trabajo: TrabajoParaImprimir,
    entrada: ResultadoTrabajoEntrada,
  ): Promise<void> {
    const reporte: ResultadoReportado = {
      trabajoId: trabajo.id,
      resultado: entrada.resultado,
      ...(entrada.resultado === 'NO_IMPRESO' && { error: entrada.error }),
      en: Date.now(),
    };
    try {
      await this.http('POST', `/puente/trabajos/${trabajo.id}/resultado`, entrada);
      this.resultados.push(reporte);
    } catch (error) {
      if (error instanceof ErrorProtocoloPuente && (error.estado === 404 || error.estado === 409)) {
        this.rechazados.push({ ...reporte, estado: error.estado });
        this.anotar('resultado-rechazado', { trabajoId: trabajo.id, estado: error.estado });
        return;
      }
      // Sin red o con error del servidor: el id sigue recordado y el próximo ciclo lo vuelve a reportar.
      this.anotar('error-resultado', { trabajoId: trabajo.id, mensaje: textoDeError(error) });
    }
  }

  private impresoraDe(id: string): ImpresoraDelPuente | undefined {
    return this.configuracionActual?.impresoras.find((i) => i.id === id);
  }

  private programarReintento(demoraMs: number): void {
    const temporizador = setTimeout(() => {
      this.temporizadoresDeReintento.delete(temporizador);
      void this.pedirTrabajosAhora().catch(() => undefined);
    }, demoraMs + 1);
    this.temporizadoresDeReintento.add(temporizador);
  }

  // ---------------------------------------------------------------------------------------------------
  // Configuración y latido
  // ---------------------------------------------------------------------------------------------------

  /** `GET /puente/configuracion`. */
  async refrescarConfiguracion(): Promise<ConfiguracionPuente> {
    const cuerpo = await this.http('GET', '/puente/configuracion');
    const configuracion = this.leer(configuracionPuenteSchema, cuerpo, 'la configuración');
    this.configuracionActual = configuracion;
    this.datosDelPuente = configuracion.puente;
    this.datosDeLaSucursal = configuracion.sucursal;
    this.anotar(
      'configuracion',
      configuracion.impresoras.map((i) => i.id),
    );
    return configuracion;
  }

  /**
   * `POST /puente/latido`: comprueba cada impresora de red de la configuración (una conexión sin datos) y manda
   * su estado. Si ya hay un latido en curso, se junta con él.
   */
  latirAhora(): Promise<void> {
    if (this.latiendo !== null) {
      this.repetirLatido = true;
      return this.latiendo;
    }
    const latido = (async () => {
      try {
        do {
          this.repetirLatido = false;
          await this.enviarLatido();
        } while (this.repetirLatido && this.puedeTrabajar());
      } finally {
        this.latiendo = null;
      }
    })();
    this.latiendo = latido;
    return latido;
  }

  private async enviarLatido(): Promise<void> {
    if (!this.puedeTrabajar()) return;
    const impresoras: LatidoEntrada['impresoras'] = [];
    const reportado = new Map<string, string>();
    for (const impresora of this.configuracionActual?.impresoras ?? []) {
      if (impresora.conexion.tipo !== 'RED') continue;
      try {
        await sondearImpresora(
          impresora.conexion.host,
          impresora.conexion.puerto,
          this.tiempoImpresoraMs,
        );
        this.estadosDeImpresoras.set(impresora.id, { estado: 'LISTA' });
      } catch (error) {
        this.estadosDeImpresoras.set(impresora.id, {
          estado: 'NO_RESPONDE',
          error: recortar(textoDeError(error), 200),
        });
      }
      const actual = this.estadosDeImpresoras.get(impresora.id)!;
      reportado.set(impresora.id, actual.estado);
      impresoras.push({
        id: impresora.id,
        estado: actual.estado as 'LISTA' | 'NO_RESPONDE',
        ...(actual.error !== undefined &&
          actual.estado === 'NO_RESPONDE' && { error: actual.error }),
      });
    }
    const latido: LatidoEntrada = { versionApp: this.versionApp, impresoras };
    try {
      await this.http('POST', '/puente/latido', latido);
      this.ultimoReportado = reportado;
      this.latidos.push(structuredClone(latido));
    } catch (error) {
      this.anotar('error-latido', textoDeError(error));
    }
  }

  /** Anota el estado de una impresora y, si cambió respecto a lo último que la API supo, manda un latido ya. */
  private fijarEstadoDeImpresora(
    id: string,
    estado: 'LISTA' | 'NO_RESPONDE',
    error?: string,
  ): void {
    this.estadosDeImpresoras.set(id, {
      estado,
      ...(error !== undefined && { error: recortar(error, 200) }),
    });
    if (this.latiendo === null && this.ultimoReportado.get(id) !== estado) {
      void this.latirAhora().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Socket
  // ---------------------------------------------------------------------------------------------------

  private crearSocket(): void {
    const socket = io(`${this.api}${ESPACIO_PUENTE}`, {
      path: '/tiempo-real',
      transports: ['websocket'],
      auth: { token: this.tokenActual },
      forceNew: true,
      reconnection: true,
      reconnectionDelay: this.esperaInicialMs,
      reconnectionDelayMax: this.esperaMaximaMs,
    });
    this.socket = socket;
    this.ultimoErrorDelSocket = null;
    socket.on('connect', () => {
      this.ultimoErrorDelSocket = null;
      this.anotar('conectado');
      void this.alConectar();
    });
    socket.on('disconnect', (motivo) => {
      this.anotar('desconectado', motivo);
      if (!socket.active) this.programarReconexionDelSocket(socket);
    });
    socket.on('connect_error', (error) => {
      this.ultimoErrorDelSocket = error.message;
      this.anotar('error-socket', error.message);
      if (error.message === 'NO_AUTENTICADO') {
        this.marcarRevocado('socket');
        return;
      }
      // Un rechazo del servidor (middleware) no reconecta solo.
      if (!socket.active) this.programarReconexionDelSocket(socket);
    });
    socket.on('trabajo.nuevo', (datos: unknown) => {
      const evento = eventoTrabajoNuevoDatosSchema.safeParse(datos);
      this.anotar('trabajo.nuevo', evento.success ? evento.data.trabajoId : 'datos inválidos');
      void this.pedirTrabajosAhora().catch(() => undefined);
    });
    socket.on('puente.configuracion', () => {
      this.anotar('puente.configuracion');
      void this.refrescarConfiguracion().catch(() => undefined);
    });
  }

  private fallosDelSocket = 0;

  private programarReconexionDelSocket(socket: Socket): void {
    if (this.temporizadorDeSocket !== null || this.socket !== socket) return;
    const demora = Math.min(this.esperaInicialMs * 2 ** this.fallosDelSocket, this.esperaMaximaMs);
    this.fallosDelSocket += 1;
    this.temporizadorDeSocket = setTimeout(() => {
      this.temporizadorDeSocket = null;
      if (this.socket === socket && this.estadoActual === 'iniciado' && !socket.connected) {
        socket.connect();
      }
    }, demora);
  }

  private async alConectar(): Promise<void> {
    this.fallosDelSocket = 0;
    try {
      await this.refrescarConfiguracion();
    } catch (error) {
      this.anotar('error-configuracion', textoDeError(error));
    }
    void this.pedirTrabajosAhora().catch(() => undefined);
    void this.latirAhora().catch(() => undefined);
  }

  private marcarRevocado(origen: string): void {
    if (this.estadoActual === 'revocado') return;
    this.estadoActual = 'revocado';
    this.anotar('revocado', origen);
    this.pararTodo();
  }

  private pararTodo(): void {
    if (this.temporizadorTrabajos !== null) clearInterval(this.temporizadorTrabajos);
    if (this.temporizadorLatido !== null) clearInterval(this.temporizadorLatido);
    if (this.temporizadorDeSocket !== null) clearTimeout(this.temporizadorDeSocket);
    this.temporizadorTrabajos = null;
    this.temporizadorLatido = null;
    this.temporizadorDeSocket = null;
    for (const temporizador of this.temporizadoresDeReintento) clearTimeout(temporizador);
    this.temporizadoresDeReintento.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.close();
  }

  // ---------------------------------------------------------------------------------------------------
  // Esperas para las pruebas
  // ---------------------------------------------------------------------------------------------------

  /** Espera a que `condicion` sea verdadera (consulta cada 10 ms); lanza `Error` si no ocurre en `ms`. */
  async esperarHasta(
    condicion: () => boolean,
    ms = 2000,
    descripcion = 'la condición',
  ): Promise<void> {
    const limite = Date.now() + ms;
    while (!condicion()) {
      if (Date.now() >= limite) throw new Error(`No ocurrió ${descripcion} en ${ms} ms`);
      await pausa(10);
    }
  }

  /** Espera a que la API haya aceptado `n` resultados `IMPRESO` (en total desde que se creó el simulador). */
  async esperarImpresos(n: number, ms = 2000): Promise<string[]> {
    await this.esperarHasta(
      () => this.impresos.length >= n,
      ms,
      `${n} trabajos impresos y reportados`,
    );
    return this.impresos;
  }

  // ---------------------------------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------------------------------

  /** Llama a la API con el protocolo del puente. Un 401 con la credencial del puente lo da por revocado. */
  private async http(
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo?: unknown,
    tokenDeVinculacion?: string,
    alRecibir?: (respuesta: Response) => void,
  ): Promise<unknown> {
    const esVinculacion = tokenDeVinculacion !== undefined;
    const token = tokenDeVinculacion ?? this.tokenActual;
    if (this.api === null || token === null) {
      throw new ErrorProtocoloPuente(0, 'SIN_CREDENCIAL', 'El simulador no está vinculado');
    }
    let respuesta: Response;
    try {
      respuesta = await this.peticion(`${this.api}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          [CABECERA_PROTOCOLO_PUENTE]: String(VERSION_PROTOCOLO_PUENTE),
          ...(cuerpo !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(cuerpo !== undefined && { body: JSON.stringify(cuerpo) }),
        signal: AbortSignal.timeout(TIEMPO_HTTP_MS),
      });
    } catch (error) {
      throw new ErrorProtocoloPuente(0, 'SIN_RED', `${metodo} ${ruta}: ${textoDeError(error)}`);
    }
    alRecibir?.(respuesta);
    const texto = await respuesta.text();
    let datos: unknown = texto === '' ? undefined : texto;
    if (texto !== '') {
      try {
        datos = JSON.parse(texto);
      } catch {
        datos = texto;
      }
    }
    if (!respuesta.ok) {
      const codigo =
        typeof datos === 'object' && datos !== null && 'codigo' in datos
          ? String((datos as { codigo: unknown }).codigo)
          : null;
      const mensaje =
        typeof datos === 'object' && datos !== null && 'mensaje' in datos
          ? String((datos as { mensaje: unknown }).mensaje)
          : `${metodo} ${ruta} respondió ${respuesta.status}`;
      if (respuesta.status === 401 && !esVinculacion) this.marcarRevocado('http');
      throw new ErrorProtocoloPuente(respuesta.status, codigo, mensaje, datos);
    }
    return datos;
  }

  private leer<T>(esquema: z.ZodType<T>, cuerpo: unknown, que: string): T {
    const resultado = esquema.safeParse(cuerpo);
    if (!resultado.success) {
      throw new ErrorProtocoloPuente(
        0,
        'RESPUESTA_INVALIDA',
        `La API respondió ${que} con un formato que el protocolo 1 no reconoce: ${resultado.error.message}`,
        cuerpo,
      );
    }
    return resultado.data;
  }

  private anotar(tipo: string, detalle?: unknown): void {
    this.bitacora.push({ en: Date.now(), tipo, ...(detalle !== undefined && { detalle }) });
    this.opciones.registrar?.(
      detalle === undefined
        ? tipo
        : `${tipo} ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`,
    );
  }
}

/** Si el lote llenó el cupo de alguna impresora, la API puede tener más trabajos suyos esperando. */
function hayMasPorPedir(lote: readonly TrabajoParaImprimir[]): boolean {
  const porImpresora = new Map<string, number>();
  for (const trabajo of lote) {
    porImpresora.set(trabajo.impresoraId, (porImpresora.get(trabajo.impresoraId) ?? 0) + 1);
  }
  return [...porImpresora.values()].some((n) => n >= MAXIMO_TRABAJOS_POR_IMPRESORA);
}
