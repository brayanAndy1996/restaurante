import type { BloqueTicket, DocumentoTicket } from '@restaurante/contratos';
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
    !yaTiene((b) => b.tipo === 'linea' && b.texto.startsWith(TEXTO_RETRASO))
  ) {
    const hora = limpiarTexto(marcas.retraso.horaEnvio);
    nuevos.push({
      tipo: 'linea',
      texto: limpiarTexto(
        hora.length > 0 ? `${TEXTO_RETRASO} · enviado a las ${hora}` : TEXTO_RETRASO,
      ),
      negrita: true,
      alinear: 'centro',
    });
  }
  if (nuevos.length > 0) nuevos.push({ tipo: 'espacio' });
  return { ...documento, bloques: [...nuevos, ...documento.bloques] };
}
