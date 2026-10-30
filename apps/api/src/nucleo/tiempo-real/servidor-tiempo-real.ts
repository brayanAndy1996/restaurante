import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ESPACIO_PUENTE } from '@restaurante/contratos';
import { Server, type Socket } from 'socket.io';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { verificarRolDePool } from '../base-de-datos/verificar-roles';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import type { EventoPublicable } from '../eventos';
import { CANAL_DEL_ESPACIO_PWA, PoolDelAdaptador } from './adaptador-postgres';
import { OPCIONES_TIEMPO_REAL, RUTA_TIEMPO_REAL, type OpcionesTiempoReal } from './opciones';
import {
  salaDeEmpresa,
  salaDePuente,
  salaDeSesion,
  salaDeSocketIo,
  salaDeSucursal,
  type DatosDeConexion,
  type DatosDeConexionDePuente,
} from './salas';
import { VALIDADOR_DE_CONEXIONES, type ValidadorDeConexiones } from './validador-de-conexiones';
import { VALIDADOR_DE_PUENTE, type ValidadorDePuente } from './validador-de-puente';

/** Cada cuánto cada instancia revisa sus conexiones locales (criterio 66: "a más tardar en 60 segundos"). */
export const INTERVALO_DE_REVISION_MS = 60_000;

/** Los mensajes de error con los que se rechaza una conexión. */
const NO_AUTENTICADO = 'NO_AUTENTICADO';
const ERROR_INTERNO = 'ERROR_INTERNO';

/** Peso a partir del cual un evento es un error de programación (criterio 69). */
const PESO_MAXIMO_DE_EVENTO = 4096;

/**
 * Servidor de Socket.IO de la API (historia 004, criterios 64 a 71), montado sobre el servidor HTTP de Nest en
 * `/tiempo-real`, sin `@nestjs/websockets` (así la autenticación es la misma función que en HTTP).
 *
 * - **Conexión (64):** el middleware del espacio `/` valida `auth: { token, equipo? }` con el mismo código de las
 *   peticiones HTTP, sin renovar la inactividad. Si pasa, la conexión entra a las salas de su empresa
 *   (`e:<empresa>`), de su sucursal activa (`s:<empresa>:<sucursal>`) y de su sesión (`sesion:<id>`, para
 *   cerrarla); si no, se rechaza con `NO_AUTENTICADO`.
 * - **El cliente no elige nada (65):** no hay ningún `socket.on` de aplicación; lo que el cliente emita se ignora.
 * - **Cierre (66):** `desconectarSesion` (que el adaptador reparte a todas las instancias) y la revisión
 *   periódica (`revisarAhora`) de las conexiones locales.
 * - **Publicación (67):** `publicar` traduce la sala del evento a una sala que siempre lleva la empresa.
 * - **Varias instancias (68, 70):** adaptador de PostgreSQL con su propio pool y su rol sin privilegios sobre
 *   `public`; el arranque rechaza un rol privilegiado.
 * - **Espacio del puente (3b, criterio 111):** `/puente` valida `auth: { token: 'pu.…' }` con el mismo código de las
 *   peticiones HTTP del puente y mete la conexión en una sola sala, `p:<empresa>:<puente>`; al conectarse y al
 *   desconectarse actualiza la señal del puente. `desconectarPuente` cierra sus conexiones al revocarlo.
 *
 * Con el tiempo real deshabilitado, todos los métodos no hacen nada.
 */
@Injectable()
export class ServidorTiempoReal implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ServidorTiempoReal.name);
  private io: Server | null = null;
  private pool: PoolDelAdaptador | null = null;
  private temporizador: NodeJS.Timeout | null = null;
  private revision: Promise<void> | null = null;

  constructor(
    @Inject(HttpAdapterHost) private readonly anfitrion: HttpAdapterHost,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(OPCIONES_TIEMPO_REAL) private readonly opciones: OpcionesTiempoReal,
    @Inject(VALIDADOR_DE_CONEXIONES) private readonly validador: ValidadorDeConexiones,
    @Optional()
    @Inject(VALIDADOR_DE_PUENTE)
    private readonly validadorDePuente: ValidadorDePuente | null = null,
  ) {}

  /** `true` si la API sirve Socket.IO. */
  get habilitado(): boolean {
    return this.opciones.habilitado;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.opciones.habilitado) return;
    const url = this.entorno.DATABASE_TIEMPO_REAL_URL;
    if (url === undefined) {
      throw new Error(
        'DATABASE_TIEMPO_REAL_URL es obligatoria con el tiempo real habilitado (TIEMPO_REAL=habilitado): ' +
          'es la conexión del adaptador de Socket.IO, con el rol restaurante_tiempo_real',
      );
    }
    const pool = new PoolDelAdaptador(url);
    try {
      // El rol del adaptador no puede saltarse la RLS (criterio 70), igual que el de la API.
      await verificarRolDePool(pool.pool, 'DATABASE_TIEMPO_REAL_URL');
    } catch (error) {
      await pool.cerrar();
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
    this.pool = pool;

    const servidorHttp = this.anfitrion.httpAdapter.getHttpServer();
    const io = new Server(servidorHttp, {
      path: RUTA_TIEMPO_REAL,
      serveClient: false,
      // Los clientes no mandan nada útil: un paquete grande se corta.
      maxHttpBufferSize: 4096,
      cors: { origin: this.entorno.ORIGENES_PERMITIDOS, credentials: false },
      adapter: pool.crearAdaptador(),
    });
    io.use((socket, siguiente) => {
      void this.autenticar(socket, siguiente);
    });
    io.on('connection', (socket) => this.alConectar(socket));
    // Espacio del puente de impresión (3b, criterio 111): solo entra un `pu.…` de un puente activo.
    const espacioPuente = io.of(ESPACIO_PUENTE);
    espacioPuente.use((socket, siguiente) => {
      void this.autenticarPuente(socket, siguiente);
    });
    espacioPuente.on('connection', (socket) => this.alConectarPuente(socket));
    this.io = io;
    // Listo para recibir lo que publiquen las otras instancias antes de que `app.init()` termine.
    await pool.esperarEscucha(CANAL_DEL_ESPACIO_PWA);

    this.temporizador = setInterval(() => {
      void this.revisarAhora();
    }, INTERVALO_DE_REVISION_MS);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.temporizador !== null) clearInterval(this.temporizador);
    this.temporizador = null;
    const io = this.io;
    const pool = this.pool;
    this.io = null;
    this.pool = null;
    // `close` desconecta a los clientes, cierra el motor y el adaptador; no espera a que termine el servidor HTTP.
    if (io !== null) await io.close();
    if (pool !== null) await pool.cerrar();
  }

  /** Middleware del espacio `/` (criterio 64). */
  private async autenticar(socket: Socket, siguiente: (error?: Error) => void): Promise<void> {
    const auth: unknown = socket.handshake.auth;
    const datos =
      typeof auth === 'object' && auth !== null ? (auth as Record<string, unknown>) : {};
    const token = typeof datos.token === 'string' ? datos.token : undefined;
    const equipo = typeof datos.equipo === 'string' ? datos.equipo : undefined;
    try {
      const sesion = await this.validador.validar(token, equipo, { renovar: false });
      const conexion: DatosDeConexion = {
        empresaId: sesion.empresaId,
        sesionId: sesion.sesionId,
        sucursalId: sesion.sucursalId,
      };
      socket.data = conexion;
      siguiente();
    } catch (error) {
      if (error instanceof ErrorAplicacion) {
        siguiente(new Error(NO_AUTENTICADO));
        return;
      }
      // Un fallo de la base no es una sesión inválida: la PWA reintenta en lugar de cerrar la sesión.
      this.logger.error(
        'No se pudo validar una conexión de tiempo real',
        error instanceof Error ? error.stack : String(error),
      );
      siguiente(new Error(ERROR_INTERNO));
    }
  }

  /** Middleware del espacio `/puente` (criterio 111): rechaza con `NO_AUTENTICADO` todo lo que no sea un `pu.…` vivo. */
  private async autenticarPuente(
    socket: Socket,
    siguiente: (error?: Error) => void,
  ): Promise<void> {
    const validador = this.validadorDePuente;
    if (validador === null) {
      siguiente(new Error(NO_AUTENTICADO));
      return;
    }
    const auth: unknown = socket.handshake.auth;
    const datos =
      typeof auth === 'object' && auth !== null ? (auth as Record<string, unknown>) : {};
    const token = typeof datos.token === 'string' ? datos.token : undefined;
    try {
      const puente = await validador.validar(token);
      const conexion: DatosDeConexionDePuente = {
        empresaId: puente.empresaId,
        puenteId: puente.puenteId,
        sucursalId: puente.sucursalId,
      };
      socket.data = conexion;
      siguiente();
    } catch (error) {
      if (error instanceof ErrorAplicacion) {
        siguiente(new Error(NO_AUTENTICADO));
        return;
      }
      this.logger.error(
        'No se pudo validar una conexión del puente de impresión',
        error instanceof Error ? error.stack : String(error),
      );
      siguiente(new Error(ERROR_INTERNO));
    }
  }

  /**
   * Una conexión del puente entra a su única sala (el servidor es el único que la asigna, criterio 65) y deja su
   * señal al conectarse y al desconectarse (criterio 111).
   */
  private alConectarPuente(socket: Socket): void {
    const conexion = socket.data as DatosDeConexionDePuente;
    const puente = {
      empresaId: conexion.empresaId,
      puenteId: conexion.puenteId,
      sucursalId: conexion.sucursalId,
    };
    socket.join(salaDePuente(conexion.empresaId, conexion.puenteId));
    const registrar = (cuando: 'conectar' | 'desconectar') => {
      const validador = this.validadorDePuente;
      if (validador === null) return;
      const tarea =
        cuando === 'conectar' ? validador.alConectar(puente) : validador.alDesconectar(puente);
      tarea.catch((error: unknown) => {
        this.logger.error(
          `No se pudo registrar la señal del puente al ${cuando}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    };
    registrar('conectar');
    socket.on('disconnect', () => registrar('desconectar'));
    let avisado = false;
    socket.onAny((evento: string) => {
      if (avisado) return;
      avisado = true;
      this.logger.warn(
        `Un puente emitió ${JSON.stringify(String(evento).slice(0, 60))} y se ignoró`,
      );
    });
  }

  /** Una conexión autenticada entra a sus salas; el servidor es el único que las asigna (criterio 65). */
  private alConectar(socket: Socket): void {
    const { empresaId, sesionId, sucursalId } = socket.data as DatosDeConexion;
    const salas = [salaDeEmpresa(empresaId), salaDeSesion(sesionId)];
    if (sucursalId !== null) salas.push(salaDeSucursal(empresaId, sucursalId));
    socket.join(salas);
    // Lo que el cliente emita no hace nada: ni salas, ni respuesta, ni acuse. Solo se avisa una vez.
    let avisado = false;
    socket.onAny((evento: string) => {
      if (avisado) return;
      avisado = true;
      this.logger.warn(
        `Un cliente emitió ${JSON.stringify(String(evento).slice(0, 60))} y se ignoró`,
      );
    });
  }

  /**
   * Publica un evento en la sala de su empresa, de su sucursal o de su puente (criterio 67). El evento que no se
   * puede dirigir a una sala que lleve la empresa no llega a nadie. Es síncrono: el adaptador reparte el aviso a
   * las otras instancias sin que quien publica espere.
   */
  publicar(evento: EventoPublicable): void {
    if (this.io === null) return;
    const sala = salaDeSocketIo(evento);
    if (sala === null) {
      this.logger.warn(
        `Se descartó el evento "${evento.nombre}": su empresa o su sala no son válidas`,
      );
      return;
    }
    try {
      const peso = Buffer.byteLength(JSON.stringify(evento.datos));
      if (peso >= PESO_MAXIMO_DE_EVENTO) {
        this.logger.warn(
          `El evento "${evento.nombre}" pesa ${peso} bytes (el límite es ${PESO_MAXIMO_DE_EVENTO})`,
        );
      }
      const espacio = evento.sala.tipo === 'puente' ? this.io.of(ESPACIO_PUENTE) : this.io;
      espacio.to(sala).emit(evento.nombre, evento.datos);
    } catch (error) {
      this.logger.error(
        `No se pudo publicar el evento "${evento.nombre}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Desconecta las conexiones de una sesión (cierre de sesión, cambio de sucursal, revocación; criterio 66). */
  async desconectarSesion(sesionId: string): Promise<void> {
    await this.desconectarSesiones([sesionId]);
  }

  /** Desconecta las conexiones de varias sesiones, en esta instancia y, por el adaptador, en las demás. */
  async desconectarSesiones(sesionIds: readonly string[]): Promise<void> {
    const io = this.io;
    if (io === null) return;
    for (const sesionId of sesionIds) {
      try {
        io.in(salaDeSesion(sesionId)).disconnectSockets(true);
      } catch (error) {
        this.logger.error(
          'No se pudo desconectar una sesión',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Desconecta las conexiones de un puente de impresión (al revocarlo o reemplazarlo, criterio 108), en esta
   * instancia y, por el adaptador, en las demás. Solo toca la sala de ese puente de esa empresa.
   */
  async desconectarPuente(empresaId: string, puenteId: string): Promise<void> {
    const io = this.io;
    if (io === null) return;
    try {
      io.of(ESPACIO_PUENTE).in(salaDePuente(empresaId, puenteId)).disconnectSockets(true);
    } catch (error) {
      this.logger.error(
        'No se pudo desconectar un puente',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Revisa ahora las conexiones locales y desconecta las de las sesiones vencidas o cerradas (criterio 66); la
   * revisión periódica de cada 60 s llama a lo mismo, y las pruebas la llaman directamente. Agrupa las
   * conexiones por empresa y hace una consulta por empresa. Si ya hay una revisión en curso, espera a esa.
   */
  revisarAhora(): Promise<void> {
    if (this.io === null) return Promise.resolve();
    if (this.revision !== null) return this.revision;
    const revision = this.revisar().finally(() => {
      this.revision = null;
    });
    this.revision = revision;
    return revision;
  }

  private async revisar(): Promise<void> {
    const io = this.io;
    if (io === null) return;
    const porEmpresa = new Map<string, Map<string, Socket[]>>();
    for (const socket of io.sockets.sockets.values()) {
      const { empresaId, sesionId } = socket.data as Partial<DatosDeConexion>;
      if (empresaId === undefined || sesionId === undefined) continue;
      const sesiones = porEmpresa.get(empresaId) ?? new Map<string, Socket[]>();
      sesiones.set(sesionId, [...(sesiones.get(sesionId) ?? []), socket]);
      porEmpresa.set(empresaId, sesiones);
    }
    for (const [empresaId, sesiones] of porEmpresa) {
      try {
        const vigentes = await this.validador.siguenValidas(empresaId, [...sesiones.keys()]);
        for (const [sesionId, sockets] of sesiones) {
          if (vigentes.has(sesionId)) continue;
          for (const socket of sockets) socket.disconnect(true);
        }
      } catch (error) {
        this.logger.error(
          'No se pudieron revisar las sesiones conectadas de una empresa',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
