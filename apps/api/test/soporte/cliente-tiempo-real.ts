import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';

/** Lo que el cliente manda al conectarse (`auth` de Socket.IO): la sesión y, con PIN, el equipo (criterio 64). */
export interface AuthTiempoReal {
  token?: string;
  equipo?: string;
}

export interface OpcionesDeConexion {
  /** Espacio de nombres: `/` para la PWA y `/puente` para el puente (3b). Por defecto `/`. */
  espacio?: string;
}

/** Un evento recibido y todavía no consumido por `esperarEvento`. */
export interface EventoRecibido {
  nombre: string;
  datos: unknown;
}

const RUTA = '/tiempo-real';

/**
 * Cliente de Socket.IO de las pruebas (historia 004, plan "Tiempo real"): envuelve `socket.io-client`, guarda los
 * eventos que llegan para que ninguno se pierda entre un `await` y el siguiente, y ofrece `esperarEvento` y
 * `noRecibe`. No reconecta solo, así una desconexión del servidor se ve como tal.
 *
 * La aplicación tiene que estar escuchando un puerto: crearla con `crearAplicacion({ tiempoReal: { habilitado:
 * true } })` y llamar `await app.listen(0, '127.0.0.1')`.
 */
export class ClienteTiempoReal {
  private pendientes: EventoRecibido[] = [];
  private oyentes: Array<() => void> = [];
  private motivoDeDesconexion: string | null = null;

  private constructor(readonly socket: Socket) {
    socket.onAny((nombre: string, ...argumentos: unknown[]) => {
      this.pendientes.push({ nombre, datos: argumentos[0] });
      for (const oyente of [...this.oyentes]) oyente();
    });
    socket.on('disconnect', (motivo: string) => {
      this.motivoDeDesconexion = motivo;
      for (const oyente of [...this.oyentes]) oyente();
    });
  }

  /** URL base (`http://127.0.0.1:<puerto>`) de una aplicación que escucha un puerto. */
  static urlDe(app: INestApplication): string {
    const direccion = app.getHttpServer().address() as AddressInfo | string | null;
    if (direccion === null || typeof direccion === 'string') {
      throw new Error(
        "La aplicación no escucha un puerto: llama await app.listen(0, '127.0.0.1') antes de conectar un cliente",
      );
    }
    return `http://127.0.0.1:${direccion.port}`;
  }

  /**
   * Intenta conectar. Devuelve el cliente conectado, o `cliente: null` y el mensaje del error de conexión (por
   * ejemplo `NO_AUTENTICADO`) si el servidor la rechazó.
   */
  static intentarConectar(
    app: INestApplication,
    auth: AuthTiempoReal = {},
    opciones: OpcionesDeConexion = {},
  ): Promise<{ cliente: ClienteTiempoReal | null; error: string | null }> {
    const espacio = opciones.espacio ?? '/';
    const socket = io(`${ClienteTiempoReal.urlDe(app)}${espacio}`, {
      path: RUTA,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth,
    });
    const cliente = new ClienteTiempoReal(socket);
    return new Promise((resolver) => {
      socket.once('connect', () => resolver({ cliente, error: null }));
      socket.once('connect_error', (error: Error) => {
        socket.close();
        resolver({ cliente: null, error: error.message });
      });
    });
  }

  /** Conecta o lanza un `Error` con el mensaje con el que el servidor rechazó la conexión. */
  static async conectar(
    app: INestApplication,
    auth: AuthTiempoReal = {},
    opciones: OpcionesDeConexion = {},
  ): Promise<ClienteTiempoReal> {
    const { cliente, error } = await ClienteTiempoReal.intentarConectar(app, auth, opciones);
    if (cliente === null) throw new Error(error ?? 'La conexión fue rechazada');
    return cliente;
  }

  get conectado(): boolean {
    return this.socket.connected;
  }

  /** Por qué se desconectó (`io server disconnect`, `transport close`, …), o `null` si sigue conectado. */
  get motivo(): string | null {
    return this.motivoDeDesconexion;
  }

  /** Los eventos recibidos que nadie consumió todavía, en orden (de un nombre, o todos). */
  eventos(nombre?: string): EventoRecibido[] {
    const todos = structuredClone(this.pendientes);
    return nombre === undefined ? todos : todos.filter((e) => e.nombre === nombre);
  }

  /** Olvida los eventos recibidos. */
  limpiar(): void {
    this.pendientes = [];
  }

  /**
   * El primer evento de ese nombre que no se haya consumido: el que ya llegó o, si no, el que llegue en `ms`.
   * Lanza `Error` si no llega a tiempo.
   */
  esperarEvento<T = unknown>(nombre: string, ms = 2000): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      const intentar = (): boolean => {
        const i = this.pendientes.findIndex((e) => e.nombre === nombre);
        if (i === -1) return false;
        const [evento] = this.pendientes.splice(i, 1);
        limpiarTodo();
        resolver(evento?.datos as T);
        return true;
      };
      const temporizador = setTimeout(() => {
        limpiarTodo();
        rechazar(new Error(`No llegó el evento "${nombre}" en ${ms} ms`));
      }, ms);
      const oyente = () => {
        intentar();
      };
      const limpiarTodo = () => {
        clearTimeout(temporizador);
        this.oyentes = this.oyentes.filter((o) => o !== oyente);
      };
      this.oyentes.push(oyente);
      intentar();
    });
  }

  /**
   * Comprueba que no llega ningún evento de ese nombre durante `ms` (y que no había uno sin consumir). Lanza
   * `Error` si llega o si ya había llegado.
   */
  async noRecibe(nombre: string, ms = 300): Promise<void> {
    await new Promise((resolver) => setTimeout(resolver, ms));
    const llegado = this.pendientes.filter((e) => e.nombre === nombre);
    if (llegado.length > 0) {
      throw new Error(
        `Llegó el evento "${nombre}" que no debía llegar: ${JSON.stringify(llegado[0]?.datos)}`,
      );
    }
  }

  /** Espera a que el servidor desconecte este cliente; lanza `Error` si no ocurre en `ms`. */
  esperarDesconexion(ms = 2000): Promise<string> {
    return new Promise<string>((resolver, rechazar) => {
      const comprobar = (): boolean => {
        if (this.motivoDeDesconexion === null) return false;
        limpiarTodo();
        resolver(this.motivoDeDesconexion);
        return true;
      };
      const temporizador = setTimeout(() => {
        limpiarTodo();
        rechazar(new Error(`El servidor no desconectó al cliente en ${ms} ms`));
      }, ms);
      const oyente = () => {
        comprobar();
      };
      const limpiarTodo = () => {
        clearTimeout(temporizador);
        this.oyentes = this.oyentes.filter((o) => o !== oyente);
      };
      this.oyentes.push(oyente);
      comprobar();
    });
  }

  /** Emite un evento hacia el servidor (el servidor no atiende ninguno, criterio 65). */
  emitir(nombre: string, ...argumentos: unknown[]): void {
    this.socket.emit(nombre, ...argumentos);
  }

  /** Cierra la conexión. */
  cerrar(): void {
    this.socket.close();
  }
}
