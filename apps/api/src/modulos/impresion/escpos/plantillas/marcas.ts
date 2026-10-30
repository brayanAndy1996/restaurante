import {
  MAXIMO_BLOQUES_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import { avisoDeCorte, esAvisoDeCorte, omitidosPorAvisos } from './presupuesto';
import { limpiarTexto } from './texto';

/** El texto de la marca de una reimpresión (criterio 128). */
export const TEXTO_REIMPRESION = 'REIMPRESIÓN';
/** El comienzo del aviso de un ticket impreso con retraso (criterio 118). */
export const TEXTO_RETRASO = 'Impreso con retraso';

export interface MarcasDeTicket {
  /**
   * El trabajo se entrega más de 2 minutos después de crearse (criterio 118): el ticket lleva arriba "Impreso con
   * retraso · enviado a las 20:15". `horaEnvio` es la hora de creación del trabajo ya formateada en la hora local
   * de la sucursal.
   */
  retraso?: { horaEnvio: string } | null;
  /** El trabajo es una reimpresión (criterio 128): el ticket lleva arriba la marca "REIMPRESIÓN". */
  reimpresion?: boolean;
}

/**
 * Una copia del documento con las marcas pedidas arriba (primero "REIMPRESIÓN", luego "Impreso con retraso") y
 * una línea en blanco. No cambia el documento recibido, y una marca que el documento ya tiene no se repite
 * (reimprimir una reimpresión no acumula marcas). Sin marcas pedidas, devuelve una copia igual.
 */
export function conMarcas(documento: DocumentoTicket, marcas: MarcasDeTicket): DocumentoTicket {
  const nuevos: BloqueTicket[] = [];
  const yaTiene = (cumple: (b: BloqueTicket) => boolean): boolean => documento.bloques.some(cumple);
  if (
    marcas.reimpresion === true &&
    !yaTiene((b) => b.tipo === 'marca' && b.texto === TEXTO_REIMPRESION)
  ) {
    nuevos.push({ tipo: 'marca', texto: TEXTO_REIMPRESION });
  }
  if (
    marcas.retraso !== undefined &&
    marcas.retraso !== null &&
    // Se reconoce por la marca estructural del bloque, nunca por su texto: un modificador o una observación que
    // empiece con "Impreso con retraso" no debe anular el aviso (ronda 2 del ataque, F2).
    !yaTiene((b) => b.tipo === 'linea' && b.aviso === 'RETRASO')
  ) {
    const hora = limpiarTexto(marcas.retraso.horaEnvio);
    nuevos.push({
      tipo: 'linea',
      texto: limpiarTexto(
        hora.length > 0 ? `${TEXTO_RETRASO} · enviado a las ${hora}` : TEXTO_RETRASO,
      ),
      negrita: true,
      alinear: 'centro',
      aviso: 'RETRASO',
    });
  }
  if (nuevos.length === 0) return { ...documento, bloques: [...documento.bloques] };
  nuevos.push({ tipo: 'espacio' });
  // Las plantillas dejan lugar para las marcas. Un documento guardado antes de eso, o armado por otro camino, que
  // llegue al máximo pierde su cola, y se dice en el propio ticket: el trabajo se entrega igual.
  const exceso = nuevos.length + documento.bloques.length - MAXIMO_BLOQUES_TICKET;
  if (exceso <= 0) return { ...documento, bloques: [...nuevos, ...documento.bloques] };
  const conservados = documento.bloques.slice(0, documento.bloques.length - exceso - 1);
  const perdidos = documento.bloques.slice(conservados.length).filter((b) => !esAvisoDeCorte(b));
  return {
    ...documento,
    // "Faltan N": lo que se pierde ahora (sin contar un aviso de la plantilla como una línea) más lo que los avisos
    // del documento ya habían descartado (ronda 4, F3).
    bloques: [
      ...nuevos,
      ...conservados,
      avisoDeCorte(perdidos.length + omitidosPorAvisos(documento.bloques)),
    ],
  };
}
