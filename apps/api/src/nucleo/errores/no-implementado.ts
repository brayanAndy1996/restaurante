/**
 * Cuerpo de las firmas que todavía no tienen lógica (la fase A de la historia 002 deja las rutas y los
 * servicios declarados; las fases siguientes los implementan). Lanza un error común, así que la API
 * responde 500 `ERROR_INTERNO` sin detalles.
 */
export function noImplementado(): never {
  throw new Error('No implementado');
}
