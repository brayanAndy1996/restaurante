import type { EventoPublicable, PublicadorEventos } from './publicador-eventos';

/**
 * Publicador de las pruebas: guarda en orden los eventos publicados. Las pruebas lo instalan con
 * `crearAplicacion({ publicadorEventos })` y comprueban `eventos()` (nada publicado en reversiones ni en
 * operaciones que no cambian nada).
 */
export class PublicadorEnMemoria implements PublicadorEventos {
  private publicados: EventoPublicable[] = [];

  publicar(evento: EventoPublicable): void {
    // Copia profunda: lo publicado no cambia aunque quien publicó modifique el objeto después.
    this.publicados.push(structuredClone(evento));
  }

  /** Los eventos publicados hasta ahora, en orden (una copia: modificarla no cambia el publicador). */
  eventos(): EventoPublicable[] {
    return structuredClone(this.publicados);
  }

  /** Olvida los eventos publicados. */
  limpiar(): void {
    this.publicados = [];
  }
}
