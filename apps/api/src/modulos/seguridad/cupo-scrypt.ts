import { Injectable } from '@nestjs/common';
import { availableParallelism } from 'node:os';
import { demasiadosALaVez } from './tope-de-intentos';

/**
 * Grupo del scrypt falso de los nombres que no tienen cuenta (inexistentes) en `/sesiones/contrasena`: no se
 * sabe de qué empresa son. Se reparte como una empresa más.
 */
export const GRUPO_SIN_CUENTA = 'sin-cuenta';
/**
 * Grupo del ingreso de un superadministrador **activo** (`/plataforma/sesiones`). Solo entra quien tiene
 * cuenta (se comprueba antes de pedir cupo), y el turno por nombre deja a lo sumo una espera por cada uno:
 * ningún nombre inventado puede llenar esta cola.
 */
export const GRUPO_PLATAFORMA = 'plataforma';
/**
 * Grupo del scrypt falso de los nombres de `/plataforma/sesiones` sin superadministrador activo. Es **propio**
 * (no se comparte con `sin-cuenta`) para que una inundación de nombres inventados contra la plataforma no
 * altere la respuesta de los nombres inexistentes de `/sesiones/contrasena` frente a los que tienen cuenta
 * (criterio 11), ni al revés.
 */
export const GRUPO_SIN_CUENTA_PLATAFORMA = 'sin-cuenta-plataforma';

/** Lo más que espera un ingreso por un cupo antes de responder 429 de 1 s (sin evaluar y sin contar). */
const ESPERA_MAXIMA_MS = 2_000;
/**
 * Tope de memoria de la cola de un grupo (no es el que reparte: ver `CupoScrypt`). Con 3 cupos de ~100 ms, en
 * `ESPERA_MAXIMA_MS` se despachan unas 60 esperas: más allá ya no se servirían a tiempo y el temporizador las
 * rechazaría igual. Pasado este número, el que llega recibe 429 al instante.
 */
const COLA_MAXIMA_POR_GRUPO = 64;

/**
 * Cuántos scrypt pueden correr a la vez en el proceso: siempre menos que los hilos del pool de libuv (para
 * que quede uno libre para lo demás: DNS, archivos, `randomBytes`…) y menos que los núcleos (para que
 * el bucle de eventos y la base no se queden sin CPU). Con 4 hilos y 4 núcleos, 3.
 */
export function capacidadDeScrypt(): number {
  const hilos = Number(process.env.UV_THREADPOOL_SIZE) || 4;
  return Math.max(1, Math.min(hilos - 1, availableParallelism() - 1));
}

interface Espera {
  grupo: string;
  resolver: (liberar: () => void) => void;
  temporizador: NodeJS.Timeout;
}

/**
 * Semáforo **único** para todo scrypt de ingreso del proceso, real o falso (criterio 5, RNF-03; criterios 11 y
 * 61), con reparto justo entre grupos (una empresa, el superadministrador y los nombres sin cuenta).
 *
 * El pool de hilos de libuv es de 4 y cada scrypt ocupa un hilo ~100 ms: sin un tope, una ráfaga de ingresos
 * de una empresa llena la cola del pool y los de otra esperan segundos. Aquí:
 *
 * - Hay `capacidad` cupos (menos que los hilos). Quien llega con un cupo libre lo toma y sigue.
 * - Si no, espera en la cola de **su grupo**: lo que espera más de `ESPERA_MAXIMA_MS` (o no cabe en el tope
 *   de memoria `COLA_MAXIMA_POR_GRUPO`) responde 429 `BLOQUEO_TEMPORAL` de 1 s. Como el cupo se toma **antes** de
 *   reservar el intento en la base, esa respuesta no evalúa nada, no cuenta como fallo y no retiene ninguna
 *   conexión.
 * - **Reparto justo por nombre dentro del grupo.** Quien llama pasa antes por el turno por nombre de
 *   `TopeDeIntentos.conTurno`, así que cada nombre (o cada cuenta, en el cambio de contraseña) tiene como
 *   máximo una espera en la cola: la cola nunca es más larga que los nombres distintos que hay en curso, y un
 *   solo nombre, real o inventado, no puede llenarla. Por eso el tope de la cola no deja fuera a un nombre
 *   que no tiene ninguna espera propia mientras la cola de su grupo no esté realmente saturada.
 * - Al liberarse un cupo pasa al primer grupo con espera y ese grupo se manda al final de la ronda: los grupos
 *   se turnan, así que una empresa que llena su cola no hace esperar a otra más que un turno.
 *
 * La respuesta ante el exceso solo depende del estado de la cola del grupo y del semáforo, nunca de si el
 * nombre tiene cuenta: los ingresos con y sin cuenta toman el cupo de la misma manera, antes de que la base
 * diga si hay cuenta o bloqueo. Es por proceso, como los demás topes.
 */
@Injectable()
export class CupoScrypt {
  private enUso = 0;
  /** Esperas por grupo, en orden de llegada; el orden de las claves es el de la ronda. */
  private readonly colas = new Map<string, Espera[]>();

  /** Cupos del proceso (se calcula al crear el servicio). */
  readonly capacidad = capacidadDeScrypt();

  /** Corre `fn` con un cupo; 429 de 1 s si no hay cupo a tiempo. El cupo se suelta al terminar `fn`. */
  async conCupo<T>(grupo: string, fn: () => Promise<T>): Promise<T> {
    const liberar = await this.tomar(grupo);
    try {
      return await fn();
    } finally {
      liberar();
    }
  }

  private tomar(grupo: string): Promise<() => void> {
    if (this.enUso < this.capacidad) {
      this.enUso += 1;
      return Promise.resolve(this.liberadorUnico());
    }
    const cola = this.colas.get(grupo) ?? [];
    if (cola.length >= COLA_MAXIMA_POR_GRUPO) return Promise.reject(demasiadosALaVez());
    return new Promise<() => void>((resolver, rechazar) => {
      const espera: Espera = {
        grupo,
        resolver,
        temporizador: setTimeout(() => {
          const propia = this.colas.get(grupo);
          const posicion = propia?.indexOf(espera) ?? -1;
          if (propia === undefined || posicion < 0) return;
          propia.splice(posicion, 1);
          if (propia.length === 0) this.colas.delete(grupo);
          rechazar(demasiadosALaVez());
        }, ESPERA_MAXIMA_MS),
      };
      espera.temporizador.unref();
      cola.push(espera);
      this.colas.set(grupo, cola);
    });
  }

  private liberadorUnico(): () => void {
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      this.enUso -= 1;
      this.despachar();
    };
  }

  /** Da el cupo libre al primer grupo de la ronda y lo manda al final si le quedan esperas. */
  private despachar(): void {
    while (this.enUso < this.capacidad) {
      const primero = this.colas.entries().next().value;
      if (primero === undefined) return;
      const [grupo, cola] = primero;
      const espera = cola.shift()!;
      this.colas.delete(grupo);
      if (cola.length > 0) this.colas.set(grupo, cola); // al final de la ronda
      clearTimeout(espera.temporizador);
      this.enUso += 1;
      espera.resolver(this.liberadorUnico());
    }
  }
}
