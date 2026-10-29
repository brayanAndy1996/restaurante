import {
  usarFabricaDeSocket,
  type FabricaDeSocket,
  type OpcionesDeSocket,
  type SocketCliente,
} from '../src/lib/tiempo-real';

/**
 * Socket de mentira: no sale a la red. La prueba lo "conecta" y le hace llegar eventos del servidor con
 * `desdeElServidor`, y puede ver si la app lo cerró con `cerrado`.
 */
export class SocketFalso implements SocketCliente {
  readonly oyentes = new Map<string, ((...argumentos: unknown[]) => void)[]>();
  cerrado = false;

  constructor(
    readonly url: string,
    readonly opciones: OpcionesDeSocket,
  ) {}

  on(evento: string, oyente: (...argumentos: unknown[]) => void): this {
    this.oyentes.set(evento, [...(this.oyentes.get(evento) ?? []), oyente]);
    return this;
  }

  disconnect(): this {
    this.cerrado = true;
    return this;
  }

  /** El servidor emite `evento` con `argumentos`. Un socket cerrado ya no oye. */
  desdeElServidor(evento: string, ...argumentos: unknown[]): void {
    if (this.cerrado) return;
    (this.oyentes.get(evento) ?? []).forEach((oyente) => oyente(...argumentos));
  }

  /** La conexión quedó abierta. */
  conectar(): void {
    this.desdeElServidor('connect');
  }
}

/** Los sockets que la app abrió en esta prueba, en orden. */
export const socketsAbiertos: SocketFalso[] = [];

/** Se instala antes de cada prueba (`preparar.ts`): ninguna prueba abre un socket de verdad. */
export function instalarSocketsFalsos(): void {
  socketsAbiertos.length = 0;
  const fabrica: FabricaDeSocket = async (url, opciones) => {
    const socket = new SocketFalso(url, opciones);
    socketsAbiertos.push(socket);
    return socket;
  };
  usarFabricaDeSocket(fabrica);
}

/** El último socket abierto que sigue abierto. */
export function socketVigente(): SocketFalso | undefined {
  return [...socketsAbiertos].reverse().find((s) => !s.cerrado);
}
