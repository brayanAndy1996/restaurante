import {
  COLUMNAS_POR_ANCHO,
  documentoTicketSchema,
  VERSION_DOCUMENTO_TICKET,
  type AnchoPapelMm,
  type BloqueTicket,
  type DocumentoTicket,
  type JuegoCaracteres,
  JUEGOS_CARACTERES,
} from '@restaurante/contratos';
import { armarColumnas, centrarCon, partirEnLineas } from './ajuste';
import {
  NUMERO_DE_PAGINA,
  adaptarTexto,
  codificarTexto,
  paginaDeJuego,
} from './tablas-codificacion';

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
 * Escribe los comandos ESC/POS llevando el estado de la impresora (alineación, negrita, doble alto) para mandar
 * un comando solo cuando cambia. Usa únicamente: `ESC @`, `ESC t`, `ESC E`, `ESC a`, `GS !`, `LF`, `ESC d` y
 * `GS V`.
 */
class EscritorEscPos {
  private readonly bytes: number[] = [];
  private alineacion: Alineacion = 'izquierda';
  private negrita = false;
  private dobleAlto = false;

  constructor(private readonly juego: JuegoCaracteres) {}

  iniciar(): void {
    this.bytes.push(ESC, 0x40, ESC, 0x74, NUMERO_DE_PAGINA[paginaDeJuego(this.juego)]!);
    this.alineacion = 'izquierda';
    this.negrita = false;
    this.dobleAlto = false;
  }

  /** Una línea de texto (ya ajustada al ancho) con su estilo, seguida de `LF`. */
  linea(
    texto: string,
    estilo: { alineacion?: Alineacion; negrita?: boolean; dobleAlto?: boolean } = {},
  ): void {
    this.estilo(
      estilo.alineacion ?? 'izquierda',
      estilo.negrita ?? false,
      estilo.dobleAlto ?? false,
    );
    this.bytes.push(...codificarTexto(texto, this.juego), LF);
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

/** Escribe un bloque del documento con el ancho y el juego de caracteres de la impresora. */
function escribirBloque(
  escritor: EscritorEscPos,
  bloque: BloqueTicket,
  columnas: number,
  juego: JuegoCaracteres,
): void {
  const adaptar = (texto: string): string => adaptarTexto(texto, juego);
  switch (bloque.tipo) {
    case 'titulo':
      for (const l of partirEnLineas(adaptar(bloque.texto), columnas)) {
        escritor.linea(l, {
          alineacion: bloque.alinear ?? 'centro',
          negrita: true,
          dobleAlto: true,
        });
      }
      return;
    case 'linea': {
      const alineacion = bloque.alinear ?? 'izquierda';
      // La sangría solo corre el texto alineado a la izquierda; en los otros casos lo alinea la impresora.
      const sangria = alineacion === 'izquierda' ? Math.min(bloque.sangria ?? 0, columnas - 1) : 0;
      const prefijo = ' '.repeat(sangria);
      for (const l of partirEnLineas(adaptar(bloque.texto), columnas - sangria)) {
        escritor.linea(l.length === 0 ? '' : prefijo + l, {
          alineacion,
          negrita: bloque.negrita,
          dobleAlto: bloque.dobleAlto,
        });
      }
      return;
    }
    case 'columnas':
      for (const l of armarColumnas(
        adaptar(bloque.izquierda),
        adaptar(bloque.derecha),
        columnas,
        bloque.derechaAlFinal === true,
      )) {
        escritor.linea(l, { negrita: bloque.negrita, dobleAlto: bloque.dobleAlto });
      }
      return;
    case 'marca': {
      // Un aviso en negrita entre guiones, de lado a lado: "------ PARA LLEVAR ------".
      const interior = partirEnLineas(adaptar(bloque.texto), Math.max(1, columnas - 4));
      for (const l of interior) {
        escritor.linea(centrarCon(` ${l} `, columnas, '-'), { negrita: true });
      }
      return;
    }
    case 'regla':
      escritor.linea((bloque.caracter ?? '-').repeat(columnas));
      return;
    case 'espacio':
      for (let i = 0; i < (bloque.lineas ?? 1); i += 1) escritor.linea('');
      return;
  }
}

/**
 * Arma los bytes ESC/POS de un ticket (historia 004, criterios 123 a 126): `ESC @`, la página de códigos del
 * juego de caracteres (`ESC t`), el texto codificado en ese juego (con `SIN_TILDES`, transliterado), 32 columnas
 * en 58 mm y 48 en 80 mm, negrita y doble alto en los títulos, avance y corte parcial (`GS V`).
 *
 * El documento se valida con `documentoTicketSchema`: uno inválido o de una versión desconocida lanza `Error`.
 * Es una función pura y determinista: el mismo documento y la misma impresora dan siempre los mismos bytes.
 */
export function renderizarTicket(
  documento: DocumentoTicket,
  impresora: ImpresoraParaRenderizar,
): Uint8Array {
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
  for (const bloque of valido.data.bloques) {
    escribirBloque(escritor, bloque, columnas, impresora.juegoCaracteres);
  }
  return escritor.finalizar();
}
