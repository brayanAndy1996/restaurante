import { randomBytes, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as ServidorHttp,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CABECERA_PROTOCOLO_PUENTE,
  ESPACIO_PUENTE,
  CABECERA_HAY_MAS_TRABAJOS,
  MAXIMO_BYTES_RESPUESTA_TRABAJOS,
  MAXIMO_TRABAJOS_POR_IMPRESORA,
  VERSION_PROTOCOLO_PUENTE,
  armarQrPuente,
  latidoEntradaSchema,
  resultadoTrabajoEntradaSchema,
  type ImpresoraDelPuente,
  type LatidoEntrada,
  type TipoTrabajo,
} from '@restaurante/contratos';
import { Server, type Socket } from 'socket.io';

// Historia 004, T36 (infraestructura de pruebas de 3b, no protegida).
//
// Una API falsa que habla el protocolo del puente (`packages/contratos/src/puente.ts`) con lo mínimo para probar al
// simulador sin la API real: vinculación de un solo uso, configuración, cola de trabajos en memoria, resultado,
// latido y el espacio `/puente` de Socket.IO. No valida permisos, no usa base de datos y no es la API: sus
// respuestas siguen el contrato, y nada más. Las pruebas de la API real (P5 y P6) usan `crearAplicacion`.

export interface TrabajoFalso {
  id: string;
  impresoraId: string;
  tipo: TipoTrabajo;
  creadoEn: string;
  bytes: string;
  estado: 'PENDIENTE' | 'IMPRESO' | 'VENCIDO';
  intentos: number;
  ultimoError: string | null;
}

export interface PeticionRecibida {
  metodo: string;
  ruta: string;
  autorizacion: string | undefined;
  protocolo: string | undefined;
  cuerpo: unknown;
}

const secreto = (): string => randomBytes(32).toString('base64url');

export class ApiFalsaDelPuente {
  readonly empresaId = randomUUID();
  readonly sucursal = { id: randomUUID(), nombre: 'Sucursal de prueba' };
  readonly puente = { id: randomUUID(), nombre: 'Tablet de prueba' };
  impresoras: ImpresoraDelPuente[] = [];
  readonly trabajos: TrabajoFalso[] = [];
  readonly peticiones: PeticionRecibida[] = [];
  readonly latidos: LatidoEntrada[] = [];
  /** Cuántos próximos `POST …/resultado` responden 500 (para perder un reporte). */
  fallosDeResultado = 0;
  /** Los ids de trabajo a los que `POST …/resultado` responde 409 (vencidos). */
  vencidos = new Set<string>();
  /** Tope de bytes ESC/POS de una respuesta de `GET …/trabajos` (como la API; las pruebas lo bajan). */
  topeDeBytes = MAXIMO_BYTES_RESPUESTA_TRABAJOS;

  private servidorHttp: ServidorHttp | null = null;
  private io: Server | null = null;
  private tokenDePuente: string | null = null;
  private vinculacion: { token: string; usada: boolean } | null = null;
  private socketsDelPuente = new Set<Socket>();
  private contadorDeConexiones = 0;

  private constructor() {}

  static async iniciar(): Promise<ApiFalsaDelPuente> {
    const api = new ApiFalsaDelPuente();
    const servidor = createServer((req, res) => {
      void api.atender(req, res);
    });
    api.servidorHttp = servidor;
    api.io = new Server(servidor, { path: '/tiempo-real', serveClient: false });
    api.io.of(ESPACIO_PUENTE).use((socket, siguiente) => {
      const token: unknown = socket.handshake.auth.token;
      if (typeof token !== 'string' || token !== api.tokenDePuente) {
        siguiente(new Error('NO_AUTENTICADO'));
        return;
      }
      siguiente();
    });
    api.io.of(ESPACIO_PUENTE).on('connection', (socket) => {
      api.contadorDeConexiones += 1;
      api.socketsDelPuente.add(socket);
      void socket.join(`p:${api.empresaId}:${api.puente.id}`);
      socket.on('disconnect', () => api.socketsDelPuente.delete(socket));
    });
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    return api;
  }

  get url(): string {
    const direccion = this.servidorHttp!.address() as AddressInfo;
    return `http://127.0.0.1:${direccion.port}`;
  }

  /** Cuántas veces se conectó un puente al socket (cada reconexión cuenta). */
  get conexionesDelSocket(): number {
    return this.contadorDeConexiones;
  }

  get sockets(): number {
    return this.socketsDelPuente.size;
  }

  get token(): string | null {
    return this.tokenDePuente;
  }

  /** Crea un código de vinculación de un solo uso y devuelve el texto del QR. */
  nuevoQr(): { qr: string; token: string } {
    const token = `vi.${this.empresaId}.${randomUUID()}.${secreto()}`;
    this.vinculacion = { token, usada: false };
    return { qr: armarQrPuente(this.url, token), token };
  }

  /** Agrega una impresora de red y devuelve su configuración. */
  agregarImpresoraDeRed(
    host: string,
    puerto: number,
    nombre = `Impresora ${this.impresoras.length + 1}`,
  ): ImpresoraDelPuente {
    const impresora: ImpresoraDelPuente = {
      id: randomUUID(),
      nombre,
      conexion: { tipo: 'RED', host, puerto },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
    };
    this.impresoras.push(impresora);
    return impresora;
  }

  agregarImpresoraBluetooth(mac = 'AA:BB:CC:DD:EE:FF'): ImpresoraDelPuente {
    const impresora: ImpresoraDelPuente = {
      id: randomUUID(),
      nombre: 'Bluetooth',
      conexion: { tipo: 'BLUETOOTH', mac },
      anchoMm: 58,
      juegoCaracteres: 'PC850',
      gaveta: false,
    };
    this.impresoras.push(impresora);
    return impresora;
  }

  /** Encola un trabajo y, si se pide, avisa al puente conectado con `trabajo.nuevo`. */
  encolar(
    impresoraId: string,
    bytes: Uint8Array,
    opciones: { tipo?: TipoTrabajo; avisar?: boolean; id?: string } = {},
  ): TrabajoFalso {
    const trabajo: TrabajoFalso = {
      id: opciones.id ?? randomUUID(),
      impresoraId,
      tipo: opciones.tipo ?? 'COMANDA',
      creadoEn: new Date().toISOString(),
      bytes: Buffer.from(bytes).toString('base64'),
      estado: 'PENDIENTE',
      intentos: 0,
      ultimoError: null,
    };
    this.trabajos.push(trabajo);
    if (opciones.avisar !== false) this.avisar('trabajo.nuevo', { trabajoId: trabajo.id });
    return trabajo;
  }

  /** Publica un evento en la sala del puente. */
  avisar(nombre: string, datos: unknown): void {
    this.io?.of(ESPACIO_PUENTE).to(`p:${this.empresaId}:${this.puente.id}`).emit(nombre, datos);
  }

  /** Avisa que cambió la configuración. */
  avisarConfiguracion(): void {
    this.avisar('puente.configuracion', {});
  }

  /** Corta los sockets del puente sin revocarlo (el puente debe reconectar). */
  cortarSockets(): void {
    for (const socket of [...this.socketsDelPuente]) socket.disconnect(true);
  }

  /** Revoca el puente: su token deja de servir y se cierran sus sockets. */
  revocar(): void {
    this.tokenDePuente = null;
    this.cortarSockets();
  }

  peticionesA(metodo: string, ruta: string | RegExp): PeticionRecibida[] {
    return this.peticiones.filter(
      (p) =>
        p.metodo === metodo && (typeof ruta === 'string' ? p.ruta === ruta : ruta.test(p.ruta)),
    );
  }

  async cerrar(): Promise<void> {
    const io = this.io;
    const servidor = this.servidorHttp;
    this.io = null;
    this.servidorHttp = null;
    if (io !== null) await io.close();
    if (servidor?.listening === true)
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
  }

  // ---------------------------------------------------------------------------------------------------

  private responder(
    res: ServerResponse,
    estado: number,
    cuerpo?: unknown,
    cabeceras: Record<string, string> = {},
  ): void {
    if (cuerpo === undefined) {
      res.writeHead(estado, cabeceras).end();
      return;
    }
    res
      .writeHead(estado, { 'Content-Type': 'application/json', ...cabeceras })
      .end(JSON.stringify(cuerpo));
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const trozos: Buffer[] = [];
    for await (const trozo of req) trozos.push(trozo as Buffer);
    const texto = Buffer.concat(trozos).toString('utf8');
    const cuerpo: unknown = texto === '' ? undefined : JSON.parse(texto);
    const ruta = (req.url ?? '').split('?')[0]!;
    const metodo = req.method ?? 'GET';
    const autorizacion = req.headers.authorization;
    const protocolo = req.headers[CABECERA_PROTOCOLO_PUENTE.toLowerCase()] as string | undefined;
    this.peticiones.push({ metodo, ruta, autorizacion, protocolo, cuerpo });

    if (protocolo !== String(VERSION_PROTOCOLO_PUENTE)) {
      this.responder(res, 400, {
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Falta la versión del protocolo',
      });
      return;
    }
    const bearer = autorizacion?.startsWith('Bearer ') === true ? autorizacion.slice(7) : undefined;

    if (metodo === 'POST' && ruta === '/puente/vinculacion') {
      const v = this.vinculacion;
      if (v === null || v.usada || bearer !== v.token) {
        this.responder(res, 401, { codigo: 'VINCULACION_INVALIDA', mensaje: 'El código no sirve' });
        return;
      }
      v.usada = true;
      this.tokenDePuente = `pu.${this.empresaId}.${this.puente.id}.${secreto()}`;
      this.responder(res, 201, {
        token: this.tokenDePuente,
        puente: this.puente,
        sucursal: this.sucursal,
        configuracion: this.configuracion(),
      });
      return;
    }

    if (this.tokenDePuente === null || bearer !== this.tokenDePuente) {
      this.responder(res, 401, { codigo: 'NO_AUTENTICADO', mensaje: 'Se requiere autenticación' });
      return;
    }
    if (metodo === 'GET' && ruta === '/puente/configuracion') {
      this.responder(res, 200, this.configuracion());
      return;
    }
    if (metodo === 'GET' && ruta === '/puente/trabajos') {
      // Como la API: hasta MAXIMO_TRABAJOS_POR_IMPRESORA por impresora, en orden de creación, y hasta `topeDeBytes`
      // en total (al menos uno por impresora; si el siguiente de una impresora no cabe, esa impresora espera).
      const porImpresora = new Map<string, number>();
      const cerradas = new Set<string>();
      const lote: Array<Omit<TrabajoFalso, 'estado' | 'intentos' | 'ultimoError'>> = [];
      let bytes = 0;
      let hayMas = false;
      for (const t of this.trabajos) {
        if (t.estado !== 'PENDIENTE') continue;
        const cuenta = (porImpresora.get(t.impresoraId) ?? 0) + 1;
        porImpresora.set(t.impresoraId, cuenta);
        if (cuenta > MAXIMO_TRABAJOS_POR_IMPRESORA) continue;
        const largo = Buffer.from(t.bytes, 'base64').length;
        const yaTiene = lote.some((l) => l.impresoraId === t.impresoraId);
        if (cerradas.has(t.impresoraId) || (yaTiene && bytes + largo > this.topeDeBytes)) {
          cerradas.add(t.impresoraId);
          hayMas = true;
          continue;
        }
        bytes += largo;
        lote.push({
          id: t.id,
          impresoraId: t.impresoraId,
          tipo: t.tipo,
          creadoEn: t.creadoEn,
          bytes: t.bytes,
        });
      }
      this.responder(res, 200, lote, hayMas ? { [CABECERA_HAY_MAS_TRABAJOS]: '1' } : {});
      return;
    }
    const resultado = /^\/puente\/trabajos\/([^/]+)\/resultado$/.exec(ruta);
    if (metodo === 'POST' && resultado !== null) {
      const trabajo = this.trabajos.find((t) => t.id === resultado[1]);
      const entrada = resultadoTrabajoEntradaSchema.safeParse(cuerpo);
      if (!entrada.success) {
        this.responder(res, 400, { codigo: 'DATOS_INVALIDOS', mensaje: 'Resultado inválido' });
        return;
      }
      if (trabajo === undefined) {
        this.responder(res, 404, { codigo: 'NO_ENCONTRADO', mensaje: 'No existe' });
        return;
      }
      if (this.vencidos.has(trabajo.id)) {
        this.responder(res, 409, { codigo: 'TRANSICION_INVALIDA', mensaje: 'Venció' });
        return;
      }
      if (this.fallosDeResultado > 0) {
        this.fallosDeResultado -= 1;
        this.responder(res, 500, { codigo: 'ERROR_INTERNO', mensaje: 'Falla simulada' });
        return;
      }
      if (entrada.data.resultado === 'IMPRESO') {
        trabajo.estado = 'IMPRESO';
      } else {
        trabajo.intentos += 1;
        trabajo.ultimoError = entrada.data.error;
      }
      this.responder(res, 200, {});
      return;
    }
    if (metodo === 'POST' && ruta === '/puente/latido') {
      const entrada = latidoEntradaSchema.safeParse(cuerpo);
      if (!entrada.success) {
        this.responder(res, 400, { codigo: 'DATOS_INVALIDOS', mensaje: 'Latido inválido' });
        return;
      }
      this.latidos.push(entrada.data);
      this.responder(res, 204);
      return;
    }
    this.responder(res, 404, { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta desconocida' });
  }

  private configuracion() {
    return { puente: this.puente, sucursal: this.sucursal, impresoras: this.impresoras };
  }
}
