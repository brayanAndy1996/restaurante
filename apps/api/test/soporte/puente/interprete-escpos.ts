import {
  PAGINAS_DE_CODIGOS,
  decodificarByte,
  type NombrePaginaDeCodigos,
} from './tablas-codificacion';

// Historia 004, T36 (infraestructura de pruebas de 3b, no protegida).
//
// Intérprete de los comandos ESC/POS que usa la nube (plan "ESC/POS"): lo comparten el emulador de impresora
// (`EmuladorEscPos`) y las pruebas del renderizador (T41). No depende de Vitest ni de la API: solo de Node.
//
// Comandos que entiende:
//   ESC @            inicia la impresora (vuelve a la página PC437, fuente A, sin negrita, tamaño 1 × 1, a la izquierda)
//   ESC t n          página de códigos (0 = PC437, 2 = PC850, 16 = WPC1252, 19 = PC858)
//   ESC E n          negrita
//   ESC ! n          modo de impresión (fuente B, negrita, doble alto, doble ancho)
//   GS ! n           tamaño del carácter (ancho y alto de 1 a 8)
//   ESC a n          alineación (0 izquierda, 1 centro, 2 derecha; también '0', '1', '2')
//   ESC M n          fuente (A o B)
//   ESC d n          imprime y avanza n líneas
//   ESC p m t1 t2    pulso de la gaveta
//   GS V m [n]       corte (0 y 48 total, 1 y 49 parcial; 65 y 66 con avance, total y parcial)
//   ESC 2, ESC 3 n, ESC J n     separación de líneas y avance en puntos (se aceptan y no cambian el texto)
//   LF               fin de línea (CR y HT se ignoran)
// Todo lo demás queda en `comandosDesconocidos` del ticket (en hexadecimal), para que una prueba falle si el
// renderizador manda un comando que la impresora no entendería.

export type AlineacionEmulada = 'izquierda' | 'centro' | 'derecha';

/** Un tramo de una línea con el mismo estilo. */
export interface SegmentoEmulado {
  texto: string;
  negrita: boolean;
  /** Multiplicador de alto (1 = normal, 2 = doble alto). */
  alto: number;
  /** Multiplicador de ancho (1 = normal, 2 = doble ancho). */
  ancho: number;
}

export interface LineaEmulada {
  /** El texto decodificado, sin relleno de la alineación. */
  texto: string;
  segmentos: SegmentoEmulado[];
  alineacion: AlineacionEmulada;
  /** Todos los caracteres de la línea están en negrita (falso si la línea está vacía). */
  negrita: boolean;
  /** Todos los caracteres tienen el alto doble o más. */
  dobleAlto: boolean;
  /** Todos los caracteres tienen el ancho doble o más. */
  dobleAncho: boolean;
  fuente: 'A' | 'B';
  /** La página de códigos con la que se decodificó. */
  codificacion: NombrePaginaDeCodigos;
}

export interface TicketEmulado {
  /** Orden de llegada al emulador, desde 1. */
  numero: number;
  /** `true` si terminó con un corte; `false` si la conexión se cerró a la mitad. */
  completo: boolean;
  lineas: LineaEmulada[];
  /** Los textos de las líneas, uno por línea, sin marcas. */
  texto: string;
  /**
   * La transcripción con marcas, una por línea: `[INICIO]`, `[PAGINA PC850]`, el texto de cada línea con sus
   * marcas delante (`[B]` negrita, `[H2]` doble alto, `[W2]` doble ancho, `[C]` centrada, `[R]` a la derecha; en ese
   * orden), `[AVANCE 4]`, `[GAVETA]`, `[CORTE PARCIAL]` o `[CORTE TOTAL]`, y `[DESCONOCIDO 1B 58]`. Una línea con
   * estilos mezclados lleva `<B>…</B>`, `<H2>…</H2>` y `<W2>…</W2>` alrededor de cada tramo.
   */
  marcado: string;
  /** La página de códigos vigente al terminar el ticket (PC437 si nunca se eligió otra). */
  codificacion: NombrePaginaDeCodigos;
  /** `true` si el ticket eligió su página de códigos con `ESC t`. */
  codificacionExplicita: boolean;
  corte: 'parcial' | 'total' | null;
  /** Líneas de avance (`ESC d`) en todo el ticket. */
  avance: number;
  pulsosGaveta: number;
  /** Los comandos que el intérprete no conoce, en hexadecimal (`1B 58`). */
  comandosDesconocidos: string[];
  /** Líneas que la impresora tuvo que partir porque el texto pasaba del ancho. */
  desbordes: number;
  /** Los bytes del ticket, tal como llegaron. */
  bytes: Uint8Array;
  recibidoEn: number;
}

export interface OpcionesInterprete {
  /** Columnas del papel en fuente A (32 en 58 mm, 48 en 80 mm). Por defecto 48. */
  columnas?: number;
  /** Se llama con cada ticket terminado por un corte, en orden. */
  alTicket?: (ticket: TicketEmulado) => void;
  /** Da el número del ticket siguiente (por defecto, 1, 2, 3, …). */
  siguienteNumero?: () => number;
}

type Evento =
  | { tipo: 'inicio' }
  | { tipo: 'pagina'; nombre: string }
  | { tipo: 'linea'; linea: LineaEmulada }
  | { tipo: 'avance'; n: number }
  | { tipo: 'gaveta' }
  | { tipo: 'corte'; corte: 'parcial' | 'total' }
  | { tipo: 'desconocido'; hex: string };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const COLUMNAS_POR_DEFECTO = 48;

/** Largo total de cada comando `ESC c …` que se conoce; los demás se tratan como comandos de dos bytes. */
const LARGO_DE_ESC: Readonly<Record<number, number>> = {
  0x40: 2, // @
  0x32: 2, // 2
  0x74: 3, // t
  0x45: 3, // E
  0x61: 3, // a
  0x64: 3, // d
  0x21: 3, // !
  0x4d: 3, // M
  0x33: 3, // 3
  0x4a: 3, // J
  0x70: 5, // p
};

const hex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Etiqueta de las marcas de estilo de un tramo o una línea uniforme. */
function marcasDeEstilo(negrita: boolean, alto: number, ancho: number): string {
  return `${negrita ? '[B]' : ''}${alto > 1 ? `[H${alto}]` : ''}${ancho > 1 ? `[W${ancho}]` : ''}`;
}

function etiquetasDeTramo(segmento: SegmentoEmulado): string {
  let texto = segmento.texto;
  if (segmento.ancho > 1) texto = `<W${segmento.ancho}>${texto}</W${segmento.ancho}>`;
  if (segmento.alto > 1) texto = `<H${segmento.alto}>${texto}</H${segmento.alto}>`;
  if (segmento.negrita) texto = `<B>${texto}</B>`;
  return texto;
}

function marcarLinea(linea: LineaEmulada): string {
  const alineacion =
    linea.alineacion === 'centro' ? '[C]' : linea.alineacion === 'derecha' ? '[R]' : '';
  const primero = linea.segmentos[0];
  if (primero === undefined) return alineacion;
  const uniforme = linea.segmentos.every(
    (s) => s.negrita === primero.negrita && s.alto === primero.alto && s.ancho === primero.ancho,
  );
  if (uniforme) {
    return `${marcasDeEstilo(primero.negrita, primero.alto, primero.ancho)}${alineacion}${linea.texto}`;
  }
  return `${alineacion}${linea.segmentos.map(etiquetasDeTramo).join('')}`;
}

/**
 * Intérprete de un flujo de bytes ESC/POS (una conexión). Se alimenta con `alimentar`, en trozos de cualquier
 * tamaño (un comando puede llegar partido), y entrega cada ticket terminado por un corte. `finalizar` cierra el
 * flujo y devuelve, si hay, el ticket que quedó sin cortar.
 */
export class InterpreteEscPos {
  private readonly columnas: number;
  private readonly alTicket: (ticket: TicketEmulado) => void;
  private readonly siguienteNumero: () => number;
  private contador = 0;

  private resto = new Uint8Array(0);

  // Estado de la impresora (persiste entre tickets, como en una impresora real; `ESC @` lo reinicia).
  private negrita = false;
  private alto = 1;
  private ancho = 1;
  private fuente: 'A' | 'B' = 'A';
  private alineacion: AlineacionEmulada = 'izquierda';
  private pagina: NombrePaginaDeCodigos = 'PC437';

  // La línea que se está armando.
  private segmentos: SegmentoEmulado[] = [];
  private columnasUsadas = 0;
  private alineacionDeLinea: AlineacionEmulada | null = null;
  private paginaDeLinea: NombrePaginaDeCodigos = 'PC437';
  private fuenteDeLinea: 'A' | 'B' = 'A';

  // El ticket que se está armando.
  private eventos: Evento[] = [];
  private bytesDelTicket: number[] = [];
  private avance = 0;
  private pulsosGaveta = 0;
  private desconocidos: string[] = [];
  private desbordes = 0;
  private paginaExplicita = false;
  private lineas: LineaEmulada[] = [];

  constructor(opciones: OpcionesInterprete = {}) {
    this.columnas = opciones.columnas ?? COLUMNAS_POR_DEFECTO;
    this.alTicket = opciones.alTicket ?? (() => undefined);
    this.siguienteNumero = opciones.siguienteNumero ?? (() => ++this.contador);
  }

  /** Procesa los bytes que llegaron; un comando incompleto espera al siguiente trozo. */
  alimentar(datos: Uint8Array): void {
    let buf: Uint8Array;
    if (this.resto.length === 0) {
      buf = datos;
    } else {
      buf = new Uint8Array(this.resto.length + datos.length);
      buf.set(this.resto, 0);
      buf.set(datos, this.resto.length);
    }
    let pos = 0;
    while (pos < buf.length) {
      const consumidos = this.comando(buf, pos);
      if (consumidos === 0) break;
      pos += consumidos;
    }
    this.resto = buf.slice(pos);
  }

  /**
   * Termina el flujo (la conexión se cerró). Devuelve el ticket que no llegó a cortarse, con `completo: false`, o
   * `null` si no había nada. Los bytes sueltos de un comando incompleto se anotan como desconocidos.
   */
  finalizar(): TicketEmulado | null {
    if (this.resto.length > 0) {
      this.bytesDelTicket.push(...this.resto);
      this.registrarDesconocido(hex(this.resto));
      this.resto = new Uint8Array(0);
    }
    this.cerrarLinea();
    const hayAlgo = this.eventos.some((e) => e.tipo !== 'inicio') || this.bytesDelTicket.length > 0;
    if (!hayAlgo) {
      this.reiniciarTicket();
      return null;
    }
    const ticket = this.armarTicket(false, null);
    this.reiniciarTicket();
    return ticket;
  }

  // ---------------------------------------------------------------------------------------------------
  // Comandos
  // ---------------------------------------------------------------------------------------------------

  /** Interpreta el comando que empieza en `pos`; devuelve cuántos bytes consumió, o 0 si faltan bytes. */
  private comando(buf: Uint8Array, pos: number): number {
    const b = buf[pos]!;
    const disponibles = buf.length - pos;
    const tomar = (n: number): number | null => {
      if (disponibles < n) return null;
      this.bytesDelTicket.push(...buf.subarray(pos, pos + n));
      return n;
    };

    if (b === ESC) {
      if (disponibles < 2) return 0;
      const c = buf[pos + 1]!;
      const largo = LARGO_DE_ESC[c] ?? 2;
      const n = tomar(largo);
      if (n === null) return 0;
      this.ejecutarEsc(c, buf.subarray(pos + 2, pos + largo));
      return n;
    }
    if (b === GS) {
      if (disponibles < 2) return 0;
      const c = buf[pos + 1]!;
      let largo = 2;
      if (c === 0x21) largo = 3;
      else if (c === 0x56) {
        if (disponibles < 3) return 0;
        const m = buf[pos + 2]!;
        largo = m === 65 || m === 66 ? 4 : 3;
      }
      const n = tomar(largo);
      if (n === null) return 0;
      this.ejecutarGs(c, buf.subarray(pos + 2, pos + largo));
      return n;
    }
    // Un byte suelto.
    this.bytesDelTicket.push(b);
    if (b === LF) {
      this.empujarLinea();
    } else if (b === 0x0d || b === 0x09 || b === 0x00) {
      // CR, HT y NUL se ignoran, como hace una impresora real.
    } else if (b < 0x20 || b === 0x7f) {
      this.registrarDesconocido(hex([b]));
    } else {
      this.agregarCaracter(decodificarByte(b, this.pagina) ?? '�');
    }
    return 1;
  }

  private ejecutarEsc(c: number, params: Uint8Array): void {
    switch (c) {
      case 0x40:
        this.cerrarLinea();
        this.negrita = false;
        this.alto = 1;
        this.ancho = 1;
        this.fuente = 'A';
        this.alineacion = 'izquierda';
        this.pagina = 'PC437';
        this.eventos.push({ tipo: 'inicio' });
        return;
      case 0x74: {
        const n = params[0]!;
        const nombre = (PAGINAS_DE_CODIGOS as Record<number, NombrePaginaDeCodigos | undefined>)[n];
        if (nombre === undefined) {
          this.registrarDesconocido(`1B 74 ${hex([n])}`);
          return;
        }
        this.cerrarLinea();
        this.pagina = nombre;
        this.paginaExplicita = true;
        this.eventos.push({ tipo: 'pagina', nombre });
        return;
      }
      case 0x45:
        this.negrita = (params[0]! & 1) === 1;
        return;
      case 0x61: {
        const n = params[0]!;
        const valor = n >= 48 ? n - 48 : n;
        if (valor === 0) this.alineacion = 'izquierda';
        else if (valor === 1) this.alineacion = 'centro';
        else if (valor === 2) this.alineacion = 'derecha';
        else this.registrarDesconocido(`1B 61 ${hex([n])}`);
        return;
      }
      case 0x64:
        this.cerrarLinea();
        this.avance += params[0]!;
        this.eventos.push({ tipo: 'avance', n: params[0]! });
        return;
      case 0x21: {
        const n = params[0]!;
        this.fuente = (n & 1) === 1 ? 'B' : 'A';
        this.negrita = (n & 0x08) !== 0;
        this.alto = (n & 0x10) !== 0 ? 2 : 1;
        this.ancho = (n & 0x20) !== 0 ? 2 : 1;
        return;
      }
      case 0x4d: {
        const n = params[0]!;
        if (n === 0 || n === 48) this.fuente = 'A';
        else if (n === 1 || n === 49) this.fuente = 'B';
        else this.registrarDesconocido(`1B 4D ${hex([n])}`);
        return;
      }
      case 0x70:
        this.cerrarLinea();
        this.pulsosGaveta += 1;
        this.eventos.push({ tipo: 'gaveta' });
        return;
      case 0x32:
      case 0x33:
      case 0x4a:
        return;
      default:
        this.registrarDesconocido(`1B ${hex([c])}`);
    }
  }

  private ejecutarGs(c: number, params: Uint8Array): void {
    if (c === 0x21) {
      const n = params[0]!;
      const ancho = (n >> 4) & 0x0f;
      const alto = n & 0x0f;
      if (ancho > 7 || alto > 7) {
        this.registrarDesconocido(`1D 21 ${hex([n])}`);
        return;
      }
      this.ancho = ancho + 1;
      this.alto = alto + 1;
      return;
    }
    if (c === 0x56) {
      const m = params[0]!;
      const total = m === 0 || m === 48 || m === 65;
      const parcial = m === 1 || m === 49 || m === 66;
      if (!total && !parcial) {
        this.registrarDesconocido(`1D 56 ${hex(params)}`);
        return;
      }
      this.cerrarLinea();
      const corte = parcial ? 'parcial' : 'total';
      this.eventos.push({ tipo: 'corte', corte });
      const ticket = this.armarTicket(true, corte);
      this.reiniciarTicket();
      this.alTicket(ticket);
      return;
    }
    this.registrarDesconocido(`1D ${hex([c, ...params])}`);
  }

  // ---------------------------------------------------------------------------------------------------
  // Líneas y tickets
  // ---------------------------------------------------------------------------------------------------

  private agregarCaracter(caracter: string): void {
    const anchoDelCaracter = this.ancho;
    if (this.columnasUsadas + anchoDelCaracter > this.columnas && this.segmentos.length > 0) {
      this.desbordes += 1;
      this.cerrarLinea();
    }
    if (this.segmentos.length === 0 && this.alineacionDeLinea === null) {
      this.alineacionDeLinea = this.alineacion;
      this.paginaDeLinea = this.pagina;
      this.fuenteDeLinea = this.fuente;
    }
    const ultimo = this.segmentos[this.segmentos.length - 1];
    if (
      ultimo !== undefined &&
      ultimo.negrita === this.negrita &&
      ultimo.alto === this.alto &&
      ultimo.ancho === this.ancho
    ) {
      ultimo.texto += caracter;
    } else {
      this.segmentos.push({
        texto: caracter,
        negrita: this.negrita,
        alto: this.alto,
        ancho: this.ancho,
      });
    }
    this.columnasUsadas += anchoDelCaracter;
  }

  /** Cierra la línea en curso (un `LF`, un comando que imprime o el fin del flujo). Una línea vacía cuenta solo con `LF`. */
  private cerrarLinea(): void {
    if (this.segmentos.length === 0) return;
    this.empujarLinea();
  }

  private empujarLinea(): void {
    const segmentos = this.segmentos;
    if (this.alineacionDeLinea === null) {
      // Línea vacía: toma el estado vigente.
      this.alineacionDeLinea = this.alineacion;
      this.paginaDeLinea = this.pagina;
      this.fuenteDeLinea = this.fuente;
    }
    const linea: LineaEmulada = {
      texto: segmentos.map((s) => s.texto).join(''),
      segmentos,
      alineacion: this.alineacionDeLinea,
      negrita: segmentos.length > 0 && segmentos.every((s) => s.negrita),
      dobleAlto: segmentos.length > 0 && segmentos.every((s) => s.alto >= 2),
      dobleAncho: segmentos.length > 0 && segmentos.every((s) => s.ancho >= 2),
      fuente: this.fuenteDeLinea,
      codificacion: this.paginaDeLinea,
    };
    this.lineas.push(linea);
    this.eventos.push({ tipo: 'linea', linea });
    this.segmentos = [];
    this.columnasUsadas = 0;
    this.alineacionDeLinea = null;
  }

  private registrarDesconocido(texto: string): void {
    this.desconocidos.push(texto);
    this.eventos.push({ tipo: 'desconocido', hex: texto });
  }

  private armarTicket(completo: boolean, corte: 'parcial' | 'total' | null): TicketEmulado {
    const marcas = this.eventos.map((e) => {
      switch (e.tipo) {
        case 'inicio':
          return '[INICIO]';
        case 'pagina':
          return `[PAGINA ${e.nombre}]`;
        case 'linea':
          return marcarLinea(e.linea);
        case 'avance':
          return `[AVANCE ${e.n}]`;
        case 'gaveta':
          return '[GAVETA]';
        case 'corte':
          return e.corte === 'parcial' ? '[CORTE PARCIAL]' : '[CORTE TOTAL]';
        case 'desconocido':
          return `[DESCONOCIDO ${e.hex}]`;
      }
    });
    return {
      numero: this.siguienteNumero(),
      completo,
      lineas: this.lineas,
      texto: this.lineas.map((l) => l.texto).join('\n'),
      marcado: marcas.join('\n'),
      codificacion: this.pagina,
      codificacionExplicita: this.paginaExplicita,
      corte,
      avance: this.avance,
      pulsosGaveta: this.pulsosGaveta,
      comandosDesconocidos: [...this.desconocidos],
      desbordes: this.desbordes,
      bytes: Uint8Array.from(this.bytesDelTicket),
      recibidoEn: Date.now(),
    };
  }

  private reiniciarTicket(): void {
    this.eventos = [];
    this.bytesDelTicket = [];
    this.avance = 0;
    this.pulsosGaveta = 0;
    this.desconocidos = [];
    this.desbordes = 0;
    this.paginaExplicita = false;
    this.lineas = [];
    this.segmentos = [];
    this.columnasUsadas = 0;
    this.alineacionDeLinea = null;
  }
}

/**
 * Interpreta bytes ESC/POS completos: los tickets cortados y, si quedó uno sin cortar, el parcial. Sirve a las
 * pruebas del renderizador, que no necesitan un servidor TCP.
 */
export function interpretarEscPos(
  bytes: Uint8Array,
  opciones: Omit<OpcionesInterprete, 'alTicket'> = {},
): { tickets: TicketEmulado[]; parcial: TicketEmulado | null } {
  const tickets: TicketEmulado[] = [];
  const interprete = new InterpreteEscPos({ ...opciones, alTicket: (t) => tickets.push(t) });
  interprete.alimentar(bytes);
  return { tickets, parcial: interprete.finalizar() };
}
