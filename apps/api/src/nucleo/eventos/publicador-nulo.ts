import type { EventoPublicable, PublicadorEventos } from './publicador-eventos';

/** Publicador por defecto hasta la sección 3: descarta los eventos. */
export class PublicadorNulo implements PublicadorEventos {
  publicar(evento: EventoPublicable): void {
    void evento;
  }
}
