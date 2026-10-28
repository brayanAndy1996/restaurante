/**
 * Marca de las firmas de la fase A de la historia 003: la ruta o el método existe pero todavía no hace
 * nada. Cada tarea de la fase C reemplaza el `throw` por la lógica. Es un error común (no un
 * `ErrorAplicacion`), así que el filtro global lo responde como 500 `ERROR_INTERNO`.
 */
export function noImplementado(): Error {
  return new Error('No implementado');
}
