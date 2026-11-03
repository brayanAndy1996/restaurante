/**
 * Descarga el bloque que el modo mesa carga bajo demanda (hojas de producto y de pedido, y las reglas de montos con
 * `decimal.js`). Una sola vez: las llamadas siguientes devuelven la misma promesa. Si la descarga falla (sin red),
 * la próxima llamada vuelve a intentarlo.
 */
export type BloquePerezoso = typeof import('./perezoso');

let promesa: Promise<BloquePerezoso> | null = null;

export function cargarPerezoso(): Promise<BloquePerezoso> {
  if (promesa === null) {
    promesa = import('./perezoso').catch((error: unknown) => {
      promesa = null;
      throw error;
    });
  }
  return promesa;
}
