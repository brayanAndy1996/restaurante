import { Injectable } from '@nestjs/common';
import { demasiadosLlamados } from './errores-llamados';

/** Creaciones en curso con ids distintos que se aceptan para un mismo código de mesa. */
export const MAXIMO_CREACIONES_POR_CODIGO = 5;

/**
 * Tope de **concurrencia** de las creaciones de llamados por código de mesa (historia 005, plan "Crear un
 * llamado"). Una ráfaga contra una sola mesa no puede ocupar todas las conexiones de la base: lo que excede el tope
 * se rechaza al instante con 429 de 1 segundo, sin tocar la base. Cuenta lo que está **en curso**, no los intentos:
 * nada dura más que una petición. Solo recorta ráfagas; los límites exactos (6 en 30 minutos por mesa, 20 en 10 por
 * conexión) son los de la base. Es por proceso: cada réplica de la API lleva el suyo.
 *
 * Una réplica (otra petición en curso con el mismo `id`) no cuenta como creación nueva y nunca se rechaza: el
 * criterio 29 manda que diez peticiones simultáneas con el mismo `id` respondan todas 201.
 */
@Injectable()
export class TopeDeCreaciones {
  /** Por código, los ids en curso y cuántas peticiones lleva cada uno. */
  private readonly enCurso = new Map<string, Map<string, number>>();

  /** Reserva un lugar para crear el llamado `id` en `codigo`; devuelve cómo soltarlo. 429 si no hay lugar. */
  entrar(codigo: string, id: string): () => void {
    const clave = id.toLowerCase();
    const ids = this.enCurso.get(codigo) ?? new Map<string, number>();
    const propias = ids.get(clave) ?? 0;
    if (propias === 0 && ids.size >= MAXIMO_CREACIONES_POR_CODIGO) throw demasiadosLlamados(1);
    ids.set(clave, propias + 1);
    this.enCurso.set(codigo, ids);
    let soltado = false;
    return () => {
      if (soltado) return;
      soltado = true;
      const actuales = this.enCurso.get(codigo);
      if (actuales === undefined) return;
      const quedan = (actuales.get(clave) ?? 1) - 1;
      if (quedan > 0) actuales.set(clave, quedan);
      else actuales.delete(clave);
      if (actuales.size === 0) this.enCurso.delete(codigo);
    };
  }
}
