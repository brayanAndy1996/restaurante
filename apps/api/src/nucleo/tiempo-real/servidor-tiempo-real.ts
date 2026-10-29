import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Server } from 'socket.io';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { noImplementado } from '../errores/no-implementado';
import { OPCIONES_TIEMPO_REAL, RUTA_TIEMPO_REAL, type OpcionesTiempoReal } from './opciones';

/**
 * Servidor de Socket.IO de la API (historia 004, criterios 64 a 71), montado sobre el servidor HTTP de Nest en
 * `/tiempo-real`, sin `@nestjs/websockets`.
 *
 * Fase A: el servidor existe pero rechaza toda conexión con `Error('No implementado')`; la autenticación, las
 * salas, el adaptador de PostgreSQL y la revisión de sesiones llegan con la tarea T10.
 */
@Injectable()
export class ServidorTiempoReal implements OnApplicationBootstrap, OnModuleDestroy {
  private io: Server | null = null;

  constructor(
    @Inject(HttpAdapterHost) private readonly anfitrion: HttpAdapterHost,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(OPCIONES_TIEMPO_REAL) private readonly opciones: OpcionesTiempoReal,
  ) {}

  /** `true` si la API sirve Socket.IO. */
  get habilitado(): boolean {
    return this.opciones.habilitado;
  }

  onApplicationBootstrap(): void {
    if (!this.opciones.habilitado) return;
    const servidorHttp = this.anfitrion.httpAdapter.getHttpServer();
    this.io = new Server(servidorHttp, {
      path: RUTA_TIEMPO_REAL,
      serveClient: false,
      // Los clientes no mandan nada útil: un paquete grande se corta.
      maxHttpBufferSize: 4096,
      cors: { origin: this.entorno.ORIGENES_PERMITIDOS, credentials: false },
    });
    this.io.use((_socket, siguiente) => siguiente(noImplementado()));
  }

  async onModuleDestroy(): Promise<void> {
    const io = this.io;
    this.io = null;
    // `close` desconecta a los clientes y cierra el motor; no espera al cierre del servidor HTTP.
    if (io !== null) await io.close();
  }

  /** Desconecta las conexiones de una sesión (cierre de sesión, cambio de sucursal, revocación; criterio 66). */
  desconectarSesion(sesionId: string): Promise<void> {
    void sesionId;
    return Promise.reject(noImplementado());
  }

  /**
   * Revisa ahora las conexiones locales y desconecta las de las sesiones vencidas (criterio 66); la revisión
   * periódica de cada 60 s llama a lo mismo, y las pruebas la llaman directamente.
   */
  revisarAhora(): Promise<void> {
    return Promise.reject(noImplementado());
  }
}
