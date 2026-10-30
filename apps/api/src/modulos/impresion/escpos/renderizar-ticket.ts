import {
  COLUMNAS_POR_ANCHO,
  documentoTicketSchema,
  MAXIMO_BYTES_TICKET,
  VERSION_DOCUMENTO_TICKET,
  type AnchoPapelMm,
  type BloqueTicket,
  type DocumentoTicket,
  type JuegoCaracteres,
  JUEGOS_CARACTERES,
} from '@restaurante/contratos';
import { armarColumnas, centrarCon, partirEnLineas } from './ajuste';
import { avisoDeCorte, esAvisoDeCorte, omitidosPorAvisos } from './plantillas/presupuesto';
import {
  NUMERO_DE_PAGINA,
  adaptarTexto,
  codificarTexto,
  paginaDeJuego,
} from './tablas-codificacion';

/** El ticket armado y si hubo que cortarlo por `MAXIMO_BYTES_TICKET` (termina con el aviso de incompleto). */
export interface TicketRenderizado {
  bytes: Uint8Array;
  recortado: boolean;
}

/** Lo que el renderizador necesita saber de la impresora de destino (la configuración vigente al entregar). */
export interface ImpresoraParaRenderizar {
  anchoMm: AnchoPapelMm;
  juegoCaracteres: JuegoCaracteres;
}

type Alineacion = 'izquierda' | 'centro' | 'derecha';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
/** Líneas que avanza el papel antes del corte, para que el corte no pase sobre la última línea. */
const AVANCE_ANTES_DEL_CORTE = 4;
/**
 * Bytes que se dejan libres bajo `MAXIMO_BYTES_TICKET` para lo que se escribe después de cortar: el aviso de
 * incompleto (unos 75 caracteres, a lo más tres líneas de 32 columnas con sus comandos de estilo) y el avance con el
 * corte. Así un ticket cortado cabe siempre en el tope.
 */
const RESERVA_AL_CORTAR = 512;

/**
 * Escribe los comandos ESC/POS llevando el estado de la impresora (alineación, negrita, doble alto) para mandar
 * un comando solo cuando cambia. Usa únicamente: `ESC @`, `ESC t`, `ESC E`, `ESC a`, `GS !`, `LF`, `ESC d` y
 * `GS V`.
 */
class EscritorEscPos {
  private readonly bytes: number[] = [];
  private alineacion: Alineacion = 'izquierda';
  private negrita = false;
  private dobleAlto = false;
  /** Hasta dónde pueden llegar las líneas del documento; el aviso de corte puede usar la reserva. */
  private limite = MAXIMO_BYTES_TICKET - RESERVA_AL_CORTAR;

  constructor(private readonly juego: JuegoCaracteres) {}

  iniciar(): void {
    this.bytes.push(ESC, 0x40, ESC, 0x74, NUMERO_DE_PAGINA[paginaDeJuego(this.juego)]!);
    this.alineacion = 'izquierda';
    this.negrita = false;
    this.dobleAlto = false;
  }

  /** A partir de aquí las líneas pueden usar la reserva (es para el aviso de corte). */
  usarReserva(): void {
    this.limite = MAXIMO_BYTES_TICKET - AVANCE_ANTES_DEL_CORTE - 16;
  }

  /**
   * Una línea de texto (ya ajustada al ancho) con su estilo, seguida de `LF`. Devuelve `false`, sin escribir nada,
   * si la línea haría pasar el ticket de su límite de bytes.
   */
  linea(
    texto: string,
    estilo: { alineacion?: Alineacion; negrita?: boolean; dobleAlto?: boolean } = {},
  ): boolean {
    const inicio = this.bytes.length;
    const antes = { alineacion: this.alineacion, negrita: this.negrita, dobleAlto: this.dobleAlto };
    this.estilo(
      estilo.alineacion ?? 'izquierda',
      estilo.negrita ?? false,
      estilo.dobleAlto ?? false,
    );
    const codificado = codificarTexto(texto, this.juego);
    if (this.bytes.length + codificado.length + 1 > this.limite) {
      this.bytes.length = inicio;
      this.alineacion = antes.alineacion;
      this.negrita = antes.negrita;
      this.dobleAlto = antes.dobleAlto;
      return false;
    }
    for (const byte of codificado) this.bytes.push(byte);
    this.bytes.push(LF);
    return true;
  }

  finalizar(): Uint8Array {
    this.estilo('izquierda', false, false);
    this.bytes.push(ESC, 0x64, AVANCE_ANTES_DEL_CORTE, GS, 0x56, 66, 0);
    return Uint8Array.from(this.bytes);
  }

  private estilo(alineacion: Alineacion, negrita: boolean, dobleAlto: boolean): void {
    if (alineacion !== this.alineacion) {
      this.bytes.push(ESC, 0x61, { izquierda: 0, centro: 1, derecha: 2 }[alineacion]);
      this.alineacion = alineacion;
    }
    if (negrita !== this.negrita) {
      this.bytes.push(ESC, 0x45, negrita ? 1 : 0);
      this.negrita = negrita;
    }
    if (dobleAlto !== this.dobleAlto) {
      this.bytes.push(GS, 0x21, dobleAlto ? 0x01 : 0x00);
      this.dobleAlto = dobleAlto;
    }
  }
}

/**
 * Escribe un bloque del documento con el ancho y el juego de caracteres de la impresora. Todo se mide sobre el
 * texto ya adaptado al juego (`adaptarTexto`), que es el que sale por el papel. Devuelve `false` si el ticket llegó
 * a su tope de bytes antes de escribirlo entero.
 */
function escribirBloque(
  escritor: EscritorEscPos,
  bloque: BloqueTicket,
  columnas: number,
  juego: JuegoCaracteres,
): boolean {
  const adaptar = (texto: string): string => adaptarTexto(texto, juego);
  switch (bloque.tipo) {
    case 'titulo':
      for (const l of partirEnLineas(adaptar(bloque.texto), columnas)) {
        const cabe = escritor.linea(l, {
          alineacion: bloque.alinear ?? 'centro',
          negrita: true,
          dobleAlto: true,
        });
        if (!cabe) return false;
      }
      return true;
    case 'linea': {
      const alineacion = bloque.alinear ?? 'izquierda';
      // La sangría solo corre el texto alineado a la izquierda; en los otros casos lo alinea la impresora.
      const sangria = alineacion === 'izquierda' ? Math.min(bloque.sangria ?? 0, columnas - 1) : 0;
      const prefijo = ' '.repeat(sangria);
      for (const l of partirEnLineas(adaptar(bloque.texto), columnas - sangria)) {
        const cabe = escritor.linea(l.length === 0 ? '' : prefijo + l, {
          alineacion,
          negrita: bloque.negrita,
          dobleAlto: bloque.dobleAlto,
        });
        if (!cabe) return false;
      }
      return true;
    }
    case 'columnas':
      for (const l of armarColumnas(
        adaptar(bloque.izquierda),
        adaptar(bloque.derecha),
        columnas,
        bloque.derechaAlFinal === true,
      )) {
        if (!escritor.linea(l, { negrita: bloque.negrita, dobleAlto: bloque.dobleAlto })) {
          return false;
        }
      }
      return true;
    case 'marca': {
      // Un aviso en negrita entre guiones, de lado a lado: "------ PARA LLEVAR ------".
      const interior = partirEnLineas(adaptar(bloque.texto), Math.max(1, columnas - 4));
      for (const l of interior) {
        if (!escritor.linea(centrarCon(` ${l} `, columnas, '-'), { negrita: true })) return false;
      }
      return true;
    }
    case 'regla':
      return escritor.linea((bloque.caracter ?? '-').repeat(columnas));
    case 'espacio':
      for (let i = 0; i < (bloque.lineas ?? 1); i += 1) {
        if (!escritor.linea('')) return false;
      }
      return true;
  }
}

/**
 * Arma los bytes ESC/POS de un ticket (historia 004, criterios 123 a 126): `ESC @`, la página de códigos del
 * juego de caracteres (`ESC t`), el texto codificado en ese juego (con `SIN_TILDES`, transliterado), 32 columnas
 * en 58 mm y 48 en 80 mm, negrita y doble alto en los títulos, avance y corte parcial (`GS V`).
 *
 * **Tope de bytes (ronda 3 del ataque, criterio 126).** Un ticket nunca pasa de `MAXIMO_BYTES_TICKET`, medido sobre
 * los bytes ya adaptados al juego de caracteres. Si el documento no cabe, se escribe hasta donde cabe, se cierra con
 * el aviso "Ticket incompleto: faltan N líneas…" (el mismo de las plantillas) y `recortado` es `true`. N es lo que
 * el renderizador dejó sin escribir más lo que la plantilla ya había descartado (el `omitidos` de su aviso
 * estructural); el aviso de la plantilla no se cuenta como una línea (ronda 4, F3). El trabajo del renderizador queda acotado en tiempo y memoria: deja de adaptar y de
 * codificar texto en cuanto llega al tope.
 *
 * El documento se valida con `documentoTicketSchema`: uno inválido o de una versión desconocida lanza `Error`.
 * Es una función pura y determinista: el mismo documento y la misma impresora dan siempre los mismos bytes.
 */
export function renderizarTicketDetallado(
  documento: DocumentoTicket,
  impresora: ImpresoraParaRenderizar,
): TicketRenderizado {
  if ((documento as { version?: unknown }).version !== VERSION_DOCUMENTO_TICKET) {
    throw new Error(
      `Versión de documento de ticket desconocida: ${String((documento as { version?: unknown }).version)}`,
    );
  }
  const valido = documentoTicketSchema.safeParse(documento);
  if (!valido.success) {
    throw new Error(`Documento de ticket inválido: ${valido.error.message}`);
  }
  const columnas = COLUMNAS_POR_ANCHO[impresora.anchoMm];
  if (columnas === undefined) throw new Error(`Ancho de papel no soportado: ${impresora.anchoMm}`);
  if (!JUEGOS_CARACTERES.includes(impresora.juegoCaracteres)) {
    throw new Error(`Juego de caracteres no soportado: ${impresora.juegoCaracteres}`);
  }

  const escritor = new EscritorEscPos(impresora.juegoCaracteres);
  escritor.iniciar();
  const bloques = valido.data.bloques;
  let recortado = false;
  for (let i = 0; i < bloques.length; i += 1) {
    if (escribirBloque(escritor, bloques[i]!, columnas, impresora.juegoCaracteres)) continue;
    // No cupo: el bloque en curso y los que siguen se omiten, y el ticket lo dice.
    recortado = true;
    escritor.usarReserva();
    // "Faltan N": lo que el renderizador dejó sin escribir (sin contar el aviso de una plantilla, que no es una
    // línea de la cuenta) más lo que los avisos de la plantilla ya habían descartado (su `omitidos`, un número).
    const sinEscribir = bloques.slice(i).filter((b) => !esAvisoDeCorte(b)).length;
    escribirBloque(
      escritor,
      avisoDeCorte(sinEscribir + omitidosPorAvisos(bloques)),
      columnas,
      impresora.juegoCaracteres,
    );
    break;
  }
  return { bytes: escritor.finalizar(), recortado };
}

/** Los bytes de un ticket (ver `renderizarTicketDetallado`, que además dice si hubo que cortarlo). */
export function renderizarTicket(
  documento: DocumentoTicket,
  impresora: ImpresoraParaRenderizar,
): Uint8Array {
  return renderizarTicketDetallado(documento, impresora).bytes;
}
