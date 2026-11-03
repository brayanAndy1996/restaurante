import { Injectable } from '@nestjs/common';
import { demasiadosLlamados } from './errores-llamados';

/** Creaciones en curso con ids distintos que se aceptan para un mismo código de mesa. */
export const MAXIMO_CREACIONES_POR_CODIGO = 5;

/** Lo que está en curso para un código de mesa. */
interface EnCursoDelCodigo {
  /** Por `id`, la huella del cuerpo de la primera petición en curso y cuántas réplicas exactas lleva. */
  ids: Map<string, { huella: string; peticiones: number }>;
  /** Peticiones en curso con un `id` que ya está en curso con otro cuerpo: cada una ocupa un lugar. */
  ajenas: number;
}

/**
 * Tope de **concurrencia** de las creaciones de llamados por código de mesa (historia 005, plan "Crear un
 * llamado"). Una ráfaga contra una sola mesa no puede ocupar todas las conexiones de la base: lo que excede el tope
 * se rechaza al instante con 429 de 1 segundo, sin tocar la base. Cuenta lo que está **en curso**, no los intentos:
 * nada dura más que una petición. Solo recorta ráfagas; los límites exactos (6 en 30 minutos por mesa, 20 en 10 por
 * conexión) son los de la base. Es por proceso: cada réplica de la API lleva el suyo.
 *
 * Una réplica (otra petición en curso con el mismo `id` **y** el mismo cuerpo) no cuenta como creación nueva y nunca
 * se rechaza: el criterio 29 manda que diez peticiones simultáneas con el mismo `id` respondan todas 201. El mismo
 * `id` con otro cuerpo no es una réplica: **cada** petición así cuenta como una creación más, de modo que una ráfaga
 * con un solo `id` y cuerpos distintos tampoco escapa del tope (esas peticiones terminan en 422, pero cada una
 * ocuparía una conexión de la base).
 */
@Injectable()
export class TopeDeCreaciones {
  private readonly enCurso = new Map<string, EnCursoDelCodigo>();

  /**
   * Reserva un lugar para crear el llamado `id` con ese cuerpo (`huellaCuerpo`: la huella de la entrada normalizada)
   * en `codigo`; devuelve cómo soltarlo. 429 si no hay lugar.
   */
  entrar(codigo: string, id: string, huellaCuerpo: string): () => void {
    const clave = id.toLowerCase();
    const estado = this.enCurso.get(codigo) ?? { ids: new Map(), ajenas: 0 };
    const propia = estado.ids.get(clave);
    // Réplica exacta de una petición en curso: no ocupa un lugar nuevo y nunca se rechaza.
    const esReplica = propia !== undefined && propia.huella === huellaCuerpo;
    // Mismo `id` en curso con otro cuerpo: ocupa su propio lugar, petición por petición.
    const esAjena = propia !== undefined && !esReplica;
    if (esReplica) {
      propia.peticiones += 1;
    } else {
      if (estado.ids.size + estado.ajenas >= MAXIMO_CREACIONES_POR_CODIGO) {
        throw demasiadosLlamados(1);
      }
      if (esAjena) estado.ajenas += 1;
      else estado.ids.set(clave, { huella: huellaCuerpo, peticiones: 1 });
    }
    this.enCurso.set(codigo, estado);
    let soltado = false;
    return () => {
      if (soltado) return;
      soltado = true;
      const actuales = this.enCurso.get(codigo);
      if (actuales === undefined) return;
      if (esAjena) {
        actuales.ajenas -= 1;
      } else {
        const entrada = actuales.ids.get(clave);
        if (entrada !== undefined && entrada.huella === huellaCuerpo) {
          entrada.peticiones -= 1;
          if (entrada.peticiones <= 0) actuales.ids.delete(clave);
        }
      }
      if (actuales.ids.size === 0 && actuales.ajenas === 0) this.enCurso.delete(codigo);
    };
  }
}
