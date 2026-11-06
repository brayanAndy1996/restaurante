/**
 * Los intentos de una escritura que sobreviven a la pantalla que los hizo (la nota de crédito, historia 006, criterio
 * 153): el `id` que se mandó y la clave de idempotencia, para que un envío que se quedó sin respuesta no se convierta en
 * dos al volver a abrir la pantalla. Viven en memoria y se borran al cerrar la sesión: lo que una persona dejó a medias
 * no lo hereda la siguiente.
 */
export interface IntentoRecordado {
  huella: string;
  huellaDelCuerpo: string;
  id: string;
  clave: string;
  autorizacionId: string | null;
}

export const INTENTOS_RECORDADOS = new Map<string, IntentoRecordado>();

/** Se llama al cerrar la sesión («Salir» y «Cambiar usuario»). */
export function olvidarIntentosRecordados(): void {
  INTENTOS_RECORDADOS.clear();
}
