import {
  MAXIMO_BLOQUES_TICKET,
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import type { TipoComanda } from '@restaurante/dominio';
import { etiquetaDeMesas, juntarEnLineas, limpiarTexto } from './texto';

/**
 * Plantilla de la comanda de una estación (historia 004, criterio 124). Arma el documento lógico; los bytes los
 * arma `renderizarTicket` al entregar el trabajo, con el ancho y el juego de caracteres vigentes.
 */

/** Una línea de la comanda: lo que `comanda_linea` guarda de cada parte (criterios 22, 24 y 74). */
export interface LineaDeComanda {
  /**
   * Cantidad de la línea en esta comanda: la del envío (`COMANDA`, `ADICION`), la marchada (`MARCHAR`) o la
   * anulada (`ANULACION`).
   */
  cantidad: number;
  nombre: string;
  /** El combo o el producto del que sale la parte ("Combo hamburguesa"); `null` si no tiene. */
  contexto: string | null;
  /** Nombres de los modificadores, en el orden elegido. */
  modificadores: readonly string[];
  observacion: string | null;
  paraLlevar: boolean;
  /** La línea es de segundo tiempo y todavía no se marcha (solo se muestra en `COMANDA` y `ADICION`). */
  esperar: boolean;
}

/** La comanda: de qué estación y de qué tipo es, y sus líneas. */
export interface ComandaParaTicket {
  tipo: TipoComanda;
  /** Nombre de la estación ("Cocina"); sale en mayúsculas. */
  estacion: string;
  /** En una `MARCHAR`, solo los ítems marchados; en una `ANULACION`, solo lo anulado. */
  lineas: readonly LineaDeComanda[];
  /** El motivo de la anulación; solo lo muestra una `ANULACION`. */
  motivo?: string | null;
}

/** Lo que la comanda toma de la orden y del envío. */
export interface ContextoDeComanda {
  /** Nombres de las mesas de la cuenta (varias si se unieron); vacío en una orden sin mesa. */
  mesas: readonly string[];
  /** Nombre del mozo. */
  mozo: string;
  /** Hora del envío ya formateada en la hora local de la sucursal ("20:15"). */
  hora: string;
  /** Número de envío de la orden; `null` en una marcha o una anulación, que no son un envío. */
  envioNumero?: number | null;
}

const ETIQUETA_TIPO: Readonly<Record<TipoComanda, string>> = {
  COMANDA: 'COMANDA',
  ADICION: 'ADICIÓN',
  MARCHAR: 'MARCHAR',
  ANULACION: 'ANULACIÓN',
};

/** Con tantos bloques se juntan los modificadores en una línea y se quitan las líneas en blanco. */
const BLOQUES_PARA_COMPACTAR = MAXIMO_BLOQUES_TICKET - 20;

function bloquesDeLinea(
  linea: LineaDeComanda,
  tipo: TipoComanda,
  compacto: boolean,
): BloqueTicket[] {
  const cantidad = `${linea.cantidad} × ${limpiarTexto(linea.nombre)}`;
  const bloques: BloqueTicket[] = [
    {
      tipo: 'linea',
      texto: limpiarTexto(tipo === 'ANULACION' ? `ANULADO ${cantidad}` : cantidad),
      negrita: true,
    },
  ];
  const contexto = limpiarTexto(linea.contexto);
  if (contexto.length > 0) {
    bloques.push({ tipo: 'linea', texto: limpiarTexto(`(${contexto})`), sangria: 2 });
  }
  const modificadores = linea.modificadores.map(limpiarTexto).filter((m) => m.length > 0);
  if (compacto && modificadores.length > 0) {
    for (const texto of juntarEnLineas(modificadores)) {
      bloques.push({ tipo: 'linea', texto, sangria: 2 });
    }
  } else {
    for (const m of modificadores) bloques.push({ tipo: 'linea', texto: m, sangria: 2 });
  }
  const observacion = limpiarTexto(linea.observacion);
  if (observacion.length > 0) {
    bloques.push({
      tipo: 'linea',
      texto: limpiarTexto(`Obs: ${observacion}`),
      negrita: true,
      sangria: 2,
    });
  }
  if (linea.paraLlevar) bloques.push({ tipo: 'marca', texto: 'PARA LLEVAR' });
  if (linea.esperar && (tipo === 'COMANDA' || tipo === 'ADICION')) {
    bloques.push({ tipo: 'marca', texto: 'ESPERAR' });
  }
  return bloques;
}

function armar(
  comanda: ComandaParaTicket,
  contexto: ContextoDeComanda,
  compacto: boolean,
): BloqueTicket[] {
  const encabezado: BloqueTicket[] = [
    {
      tipo: 'titulo',
      texto: limpiarTexto(`${comanda.estacion.toUpperCase()} · ${ETIQUETA_TIPO[comanda.tipo]}`),
    },
    { tipo: 'titulo', texto: etiquetaDeMesas(contexto.mesas) },
    {
      tipo: 'columnas',
      izquierda: limpiarTexto(`Mozo: ${contexto.mozo}`),
      derecha: limpiarTexto(contexto.hora),
    },
  ];
  if (contexto.envioNumero !== undefined && contexto.envioNumero !== null) {
    encabezado.push({ tipo: 'linea', texto: `Envío N.º ${contexto.envioNumero}` });
  }
  const motivo = limpiarTexto(comanda.motivo);
  if (comanda.tipo === 'ANULACION' && motivo.length > 0) {
    encabezado.push({ tipo: 'linea', texto: limpiarTexto(`Motivo: ${motivo}`), negrita: true });
  }
  encabezado.push({ tipo: 'regla', caracter: '-' });

  const cuerpo: BloqueTicket[] = [];
  comanda.lineas.forEach((linea, i) => {
    if (i > 0 && !compacto) cuerpo.push({ tipo: 'espacio' });
    cuerpo.push(...bloquesDeLinea(linea, comanda.tipo, compacto));
  });
  return [...encabezado, ...cuerpo];
}

/**
 * El documento lógico de la comanda de una estación (criterio 124): arriba la estación y el tipo ("COCINA ·
 * COMANDA", "ADICIÓN", "MARCHAR", "ANULACIÓN") y la mesa o mesas en doble alto, luego el mozo, la hora y el número
 * de envío; por cada línea, "3 × Hamburguesa clásica", el contexto ("(Combo hamburguesa)"), los modificadores
 * con sangría, "Obs: …", y las marcas "PARA LLEVAR" y "ESPERAR". En una `ANULACION`, cada línea sale como
 * "ANULADO 1 × …" con la cantidad anulada y el "Motivo: …" arriba.
 */
export function documentoDeComanda(
  comanda: ComandaParaTicket,
  contexto: ContextoDeComanda,
): DocumentoTicket {
  let bloques = armar(comanda, contexto, false);
  if (bloques.length > BLOQUES_PARA_COMPACTAR) bloques = armar(comanda, contexto, true);
  return { version: VERSION_DOCUMENTO_TICKET, tipo: comanda.tipo, bloques };
}
