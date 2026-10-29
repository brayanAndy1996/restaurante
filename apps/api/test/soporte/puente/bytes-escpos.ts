import {
  PAGINAS_DE_CODIGOS,
  TABLAS_ALTAS,
  type NombrePaginaDeCodigos,
} from './tablas-codificacion';

// Historia 004, T36 (infraestructura de pruebas de 3b, no protegida).
//
// Constructor de bytes ESC/POS para las pruebas del emulador y del simulador. Es independiente del renderizador de
// la API (T41): arma los comandos byte a byte, con su propia codificación inversa de las tablas del emulador.

const NUMERO_DE_PAGINA: Readonly<Record<NombrePaginaDeCodigos, number>> = Object.fromEntries(
  Object.entries(PAGINAS_DE_CODIGOS).map(([numero, nombre]) => [nombre, Number(numero)]),
) as Record<NombrePaginaDeCodigos, number>;

const INVERSAS = new Map<NombrePaginaDeCodigos, ReadonlyMap<string, number>>(
  (Object.keys(TABLAS_ALTAS) as NombrePaginaDeCodigos[]).map((pagina) => [
    pagina,
    new Map(Array.from(TABLAS_ALTAS[pagina], (caracter, i) => [caracter, 0x80 + i] as const)),
  ]),
);

/** Codifica un texto con una página de códigos; lo que no existe en ella sale como `?`. */
export function codificarTexto(texto: string, pagina: NombrePaginaDeCodigos): number[] {
  const bytes: number[] = [];
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0)!;
    if (codigo >= 0x20 && codigo <= 0x7e) bytes.push(codigo);
    else bytes.push(INVERSAS.get(pagina)?.get(caracter) ?? 0x3f);
  }
  return bytes;
}

/** Arma los bytes de uno o varios tickets, comando por comando. */
export class BytesEscPos {
  private readonly bytes: number[] = [];
  private pagina: NombrePaginaDeCodigos = 'PC437';

  /** `ESC @`. */
  inicio(): this {
    this.pagina = 'PC437';
    this.bytes.push(0x1b, 0x40);
    return this;
  }

  /** `ESC t n`. */
  paginaDeCodigos(pagina: NombrePaginaDeCodigos): this {
    this.pagina = pagina;
    this.bytes.push(0x1b, 0x74, NUMERO_DE_PAGINA[pagina]);
    return this;
  }

  /** `ESC E n`. */
  negrita(activa: boolean): this {
    this.bytes.push(0x1b, 0x45, activa ? 1 : 0);
    return this;
  }

  /** `GS ! n` con el ancho y el alto de 1 a 8. */
  tamano(ancho: number, alto: number): this {
    this.bytes.push(0x1d, 0x21, ((ancho - 1) << 4) | (alto - 1));
    return this;
  }

  /** `ESC a n`. */
  alinear(alineacion: 'izquierda' | 'centro' | 'derecha'): this {
    this.bytes.push(0x1b, 0x61, { izquierda: 0, centro: 1, derecha: 2 }[alineacion]);
    return this;
  }

  /** `ESC d n`. */
  avanzar(lineas: number): this {
    this.bytes.push(0x1b, 0x64, lineas);
    return this;
  }

  /** `ESC p 0 25 250`. */
  gaveta(): this {
    this.bytes.push(0x1b, 0x70, 0, 25, 250);
    return this;
  }

  /** `GS V 66 0` (parcial) o `GS V 65 0` (total). */
  cortar(tipo: 'parcial' | 'total' = 'parcial'): this {
    this.bytes.push(0x1d, 0x56, tipo === 'parcial' ? 66 : 65, 0);
    return this;
  }

  /** El texto codificado con la página vigente, sin salto de línea. */
  texto(texto: string): this {
    this.bytes.push(...codificarTexto(texto, this.pagina));
    return this;
  }

  /** `LF`. */
  salto(): this {
    this.bytes.push(0x0a);
    return this;
  }

  /** El texto seguido de `LF`. */
  linea(texto = ''): this {
    return this.texto(texto).salto();
  }

  /** Bytes sueltos (para armar un comando desconocido o partido en trozos). */
  crudo(...bytes: number[]): this {
    this.bytes.push(...bytes);
    return this;
  }

  /** Un ticket sencillo: inicio, página, las líneas, avance de 4 y corte parcial. */
  static ticket(lineas: readonly string[], pagina: NombrePaginaDeCodigos = 'PC850'): Uint8Array {
    const b = new BytesEscPos().inicio().paginaDeCodigos(pagina);
    for (const linea of lineas) b.linea(linea);
    return b.avanzar(4).cortar().aBytes();
  }

  aBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  /** Los bytes en base64, como viajan en `trabajoParaImprimir.bytes`. */
  aBase64(): string {
    return Buffer.from(this.bytes).toString('base64');
  }
}
