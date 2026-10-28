import { useCallback, useEffect, useRef, useState } from 'react';
import { espera, nuevaClaveDeIdempotencia, type OpcionesApi } from './api';
import { conexion } from './conexion';
import { ErrorApi } from './errores';

/**
 * Lo que una escritura de la carta o de la disponibilidad recibe de `enviarSinPerder`: la clave de
 * idempotencia de esta escritura lógica (la misma en todos los intentos) y el aviso de "empezó a
 * reintentarse". Cada llamada de `carta.ts` lo pasa tal cual a `api.ts`.
 */
export type ExtraDeEscritura = Pick<
  OpcionesApi<unknown>,
  'idempotente' | 'alReintentar' | 'reintentos'
>;

/** Espera entre los intentos que siguen a `api.ts` (que ya reintenta unos 35 s): 15 s, 30 s y luego 60 s. */
const ESPERAS_DE_ENVIO_MS = [15_000, 30_000, 60_000] as const;
/** Intentos máximos antes de rendirse y avisar (unos 35 minutos); evita un bucle sin fin. */
const INTENTOS_MAXIMOS = 40;

export interface OpcionesDeEnvio {
  /** `true` cuando el envío queda esperando la red; `false` cuando termina (bien o mal). */
  alCambiar?: (pendiente: boolean) => void;
  /** Cancela la espera (por ejemplo, al cerrar la sesión). */
  senal?: AbortSignal;
}

/**
 * Envía una escritura y no la suelta mientras el problema sea solo la red (criterio 78 de 003):
 *
 * - genera **una** clave de idempotencia y la usa en todos los intentos, así que el servidor aplica la
 *   escritura una sola vez aunque una respuesta se haya perdido;
 * - `api.ts` reintenta unos 35 segundos; si no llega, aquí se sigue esperando (se despierta al volver la
 *   red, `online`) y se vuelve a enviar con la misma clave;
 * - mientras tanto avisa con `alCambiar(true)` para que la pantalla diga "Pendiente de envío", y suma
 *   la escritura a los cambios por enviar del banner de "Sin conexión";
 * - un error de negocio (4xx) o un 5xx del servidor termina el envío con ese error: no se reintenta.
 *
 * Lo que la persona escribió sigue en su formulario (no se vacía). Lo que no hace: sobrevivir a una
 * recarga o al cierre de la pestaña, porque la cola vive en memoria (ver README de la PWA).
 */
export async function enviarSinPerder<T>(
  ejecutar: (extra: ExtraDeEscritura) => Promise<T>,
  opciones: OpcionesDeEnvio = {},
): Promise<T> {
  const clave = nuevaClaveDeIdempotencia();
  let pendiente = false;
  let contada = false;
  const marcar = (valor: boolean) => {
    if (pendiente === valor) return;
    pendiente = valor;
    opciones.alCambiar?.(valor);
  };
  const soltarCuenta = () => {
    if (!contada) return;
    contada = false;
    conexion.pendienteMenos();
  };

  try {
    for (let intento = 0; ; intento++) {
      // Mientras un intento está en vuelo, `api.ts` ya cuenta el cambio como pendiente: no se cuenta dos veces.
      soltarCuenta();
      try {
        return await ejecutar({
          idempotente: clave,
          alReintentar: () => marcar(true),
          // Después del primer intento, uno solo de repuesto: la espera larga la hace este bucle.
          ...(intento > 0 ? { reintentos: 1 } : {}),
        });
      } catch (error) {
        if (!(error instanceof ErrorApi) || !error.sinConexion || intento >= INTENTOS_MAXIMOS) {
          throw error;
        }
      }
      marcar(true);
      contada = true;
      conexion.pendienteMas();
      await espera.dormir(
        ESPERAS_DE_ENVIO_MS[Math.min(intento, ESPERAS_DE_ENVIO_MS.length - 1)] ?? 60_000,
        opciones.senal,
      );
      if (opciones.senal?.aborted) {
        throw opciones.senal.reason ?? new DOMException('Cancelada', 'AbortError');
      }
    }
  } finally {
    soltarCuenta();
    marcar(false);
  }
}

/**
 * Envíos de una pantalla: `enviar` manda una escritura con `enviarSinPerder` y `pendiente` dice si hay
 * alguna esperando la red ahora mismo. Si la pantalla se cierra, los envíos en curso siguen su camino
 * (no se pierde lo que la persona ya mandó) y simplemente dejan de actualizar la pantalla.
 */
export function useEnvioPendiente() {
  const [esperando, setEsperando] = useState(0);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const enviar = useCallback(
    <T>(
      ejecutar: (extra: ExtraDeEscritura) => Promise<T>,
      /** Aviso propio de este envío (por ejemplo, marcar la fila que espera la red). */
      alCambiarEste?: (pendiente: boolean) => void,
    ) =>
      enviarSinPerder(ejecutar, {
        alCambiar: (pendiente) => {
          if (!montado.current) return;
          setEsperando((n) => Math.max(0, n + (pendiente ? 1 : -1)));
          alCambiarEste?.(pendiente);
        },
      }),
    [],
  );
  return { pendiente: esperando > 0, enviar, sigueMontada: () => montado.current };
}
