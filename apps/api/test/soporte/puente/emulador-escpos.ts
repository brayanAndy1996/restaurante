import { createServer, type Server, type Socket } from 'node:net';
import { InterpreteEscPos, type TicketEmulado } from './interprete-escpos';

// Historia 004, T36 (infraestructura de pruebas de 3b, no protegida).
//
// Emulador de una impresora de red ESC/POS (criterio 135). Es un servidor TCP que acepta los bytes, los interpreta
// con `InterpreteEscPos` y expone cada ticket recibido como texto decodificado con sus marcas. Se puede apagar y
// prender para simular una impresora que no responde. No depende de Vitest: lo usan las pruebas de la API, el
// E2E y `pnpm puente:simular`.

export interface OpcionesEmuladorEscPos {
  /** Dirección donde escucha. Por defecto `127.0.0.1`. */
  host?: string;
  /** Puerto. Por defecto 0 (uno libre; léelo en `puerto`). */
  puerto?: number;
  /** Ancho del papel: define las columnas (32 en 58 mm, 48 en 80 mm). Por defecto 80. */
  anchoMm?: 58 | 80;
  /** Columnas del papel, si no se quiere derivarlas del ancho. */
  columnas?: number;
  /** Nombre para los mensajes de error. */
  nombre?: string;
}

/** Cómo se apaga la impresora: sin escuchar (conexión rechazada) o aceptando conexiones sin leer ni responder. */
export type ModoDeApagado = 'rechazar' | 'colgar';

const COLUMNAS_POR_ANCHO = { 58: 32, 80: 48 } as const;

export class EmuladorEscPos {
  private servidor: Server | null = null;
  private readonly conexionesAbiertas = new Set<Socket>();
  private readonly todos: TicketEmulado[] = [];
  private readonly incompletos: TicketEmulado[] = [];
  private leidos = 0;
  private cuentaDeTickets = 0;
  private cuentaDeConexiones = 0;
  private cuentaDeBytes = 0;
  private modoColgado = false;
  private oyentes: Array<() => void> = [];
  private puertoActual = 0;

  private constructor(
    readonly host: string,
    private readonly puertoPedido: number,
    readonly columnas: number,
    readonly nombre: string,
  ) {}

  /** Crea el emulador y lo deja escuchando. */
  static async iniciar(opciones: OpcionesEmuladorEscPos = {}): Promise<EmuladorEscPos> {
    const columnas = opciones.columnas ?? COLUMNAS_POR_ANCHO[opciones.anchoMm ?? 80];
    const emulador = new EmuladorEscPos(
      opciones.host ?? '127.0.0.1',
      opciones.puerto ?? 0,
      columnas,
      opciones.nombre ?? 'emulador',
    );
    await emulador.prender();
    return emulador;
  }

  /** El puerto en el que escucha (el asignado, si se pidió el 0). */
  get puerto(): number {
    return this.puertoActual;
  }

  /** `true` si acepta conexiones y procesa lo que llega. */
  get encendido(): boolean {
    return this.servidor !== null && !this.modoColgado;
  }

  /** Los tickets terminados con un corte, en orden de llegada. */
  get tickets(): readonly TicketEmulado[] {
    return this.todos;
  }

  /** Los tickets que quedaron a medias porque la conexión se cerró antes del corte. */
  get parciales(): readonly TicketEmulado[] {
    return this.incompletos;
  }

  /** Conexiones aceptadas desde que se creó (una sonda de conexión también cuenta). */
  get conexiones(): number {
    return this.cuentaDeConexiones;
  }

  /** Bytes recibidos desde que se creó. */
  get bytesRecibidos(): number {
    return this.cuentaDeBytes;
  }

  ultimoTicket(): TicketEmulado | undefined {
    return this.todos[this.todos.length - 1];
  }

  /** Olvida los tickets recibidos (los contadores de conexiones y bytes siguen). */
  limpiar(): void {
    this.todos.length = 0;
    this.incompletos.length = 0;
    this.leidos = 0;
  }

  /**
   * El primer ticket que nadie haya consumido: el que ya llegó o, si no, el que llegue en `ms`. Lanza `Error` si
   * no llega a tiempo.
   */
  esperarTicket(ms = 2000): Promise<TicketEmulado> {
    return this.esperarTickets(1, ms).then((tickets) => tickets[0]!);
  }

  /** Los próximos `n` tickets sin consumir, esperando hasta `ms` a que lleguen todos. */
  esperarTickets(n: number, ms = 2000): Promise<TicketEmulado[]> {
    return new Promise<TicketEmulado[]>((resolver, rechazar) => {
      const intentar = (): boolean => {
        if (this.todos.length - this.leidos < n) return false;
        const lote = this.todos.slice(this.leidos, this.leidos + n);
        this.leidos += n;
        limpiarTodo();
        resolver(lote);
        return true;
      };
      const temporizador = setTimeout(() => {
        limpiarTodo();
        rechazar(
          new Error(
            `${this.nombre}: llegaron ${this.todos.length - this.leidos} de ${n} tickets esperados en ${ms} ms`,
          ),
        );
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

  /** Comprueba que no llega ningún ticket durante `ms` (y que no había uno sin consumir). */
  async noRecibe(ms = 300): Promise<void> {
    await new Promise((resolver) => setTimeout(resolver, ms));
    const sinConsumir = this.todos.length - this.leidos;
    if (sinConsumir > 0) {
      throw new Error(
        `${this.nombre}: llegó un ticket que no debía llegar:\n${this.todos[this.leidos]?.marcado}`,
      );
    }
  }

  /**
   * Apaga la impresora. `rechazar` (por defecto) deja de escuchar y corta las conexiones: quien se conecta recibe
   * `ECONNREFUSED`. `colgar` sigue aceptando conexiones pero no lee ni responde: quien imprime se queda esperando.
   * Los tickets ya recibidos se conservan.
   */
  async apagar(modo: ModoDeApagado = 'rechazar'): Promise<void> {
    if (modo === 'colgar') {
      this.modoColgado = true;
      for (const conexion of this.conexionesAbiertas) conexion.pause();
      return;
    }
    this.modoColgado = false;
    const servidor = this.servidor;
    if (servidor === null) return;
    this.servidor = null;
    const cerrado = new Promise<void>((resolver) => servidor.close(() => resolver()));
    for (const conexion of [...this.conexionesAbiertas]) conexion.destroy();
    await cerrado;
  }

  /** Vuelve a escuchar en el mismo puerto (o retoma lo que dejó pendiente si estaba colgada). */
  async prender(): Promise<void> {
    if (this.modoColgado) {
      this.modoColgado = false;
      for (const conexion of this.conexionesAbiertas) conexion.resume();
      return;
    }
    if (this.servidor !== null) return;
    const servidor = createServer((conexion) => this.alConectar(conexion));
    servidor.on('error', () => undefined);
    await new Promise<void>((resolver, rechazar) => {
      servidor.once('error', rechazar);
      servidor.listen(
        this.puertoActual === 0 ? this.puertoPedido : this.puertoActual,
        this.host,
        () => {
          servidor.off('error', rechazar);
          resolver();
        },
      );
    });
    const direccion = servidor.address();
    if (direccion === null || typeof direccion === 'string') {
      throw new Error(`${this.nombre}: no se pudo leer el puerto del emulador`);
    }
    this.puertoActual = direccion.port;
    this.servidor = servidor;
  }

  /** Apaga y suelta todo. Llamar al terminar la prueba. */
  async cerrar(): Promise<void> {
    this.modoColgado = false;
    for (const conexion of this.conexionesAbiertas) conexion.resume();
    await this.apagar('rechazar');
  }

  private alConectar(conexion: Socket): void {
    this.cuentaDeConexiones += 1;
    this.conexionesAbiertas.add(conexion);
    const interprete = new InterpreteEscPos({
      columnas: this.columnas,
      siguienteNumero: () => ++this.cuentaDeTickets,
      alTicket: (ticket) => {
        this.todos.push(ticket);
        this.avisar();
      },
    });
    let finalizado = false;
    const finalizar = () => {
      if (finalizado) return;
      finalizado = true;
      const parcial = interprete.finalizar();
      if (parcial !== null) {
        this.incompletos.push(parcial);
        this.avisar();
      }
    };
    if (this.modoColgado) conexion.pause();
    conexion.on('data', (datos: Buffer) => {
      this.cuentaDeBytes += datos.length;
      interprete.alimentar(datos);
    });
    // Como una impresora de red: al recibir el cierre del otro lado, cierra el suyo.
    conexion.on('end', () => {
      finalizar();
      conexion.end();
    });
    conexion.on('error', () => {
      finalizar();
    });
    conexion.on('close', () => {
      finalizar();
      this.conexionesAbiertas.delete(conexion);
    });
  }

  private avisar(): void {
    for (const oyente of [...this.oyentes]) oyente();
  }
}
