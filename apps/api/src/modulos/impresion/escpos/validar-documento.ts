import { documentoTicketSchema } from '@restaurante/contratos';

/** Máximo de caracteres del error de un trabajo (`trabajo_impresion.error_render` y `ultimo_error`). */
export const LARGO_ERROR_DE_TRABAJO = 200;

/** Recorta un mensaje de error al largo de la columna, con "…" si no cabe. */
export function recortarError(mensaje: string): string {
  const caracteres = Array.from(mensaje.replace(/\s+/g, ' ').trim());
  return caracteres.length <= LARGO_ERROR_DE_TRABAJO
    ? caracteres.join('')
    : `${caracteres.slice(0, LARGO_ERROR_DE_TRABAJO - 1).join('')}…`;
}

/**
 * `null` si el documento cumple `documentoTicketSchema` (y se puede armar el ticket), o el motivo, corto, si no.
 * `encolar` lo comprueba antes de guardar un trabajo (falla F1 de la ronda 1 del ataque).
 */
export function errorDeDocumento(documento: unknown): string | null {
  const resultado = documentoTicketSchema.safeParse(documento);
  if (resultado.success) return null;
  const problema = resultado.error.issues[0];
  const donde = problema === undefined || problema.path.length === 0 ? '' : ` (${problema.path.join('.')})`;
  return recortarError(`Documento inválido${donde}: ${problema?.message ?? 'sin detalle'}`);
}
