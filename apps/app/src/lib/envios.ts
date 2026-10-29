import { useCallback, useEffect, useRef, useState } from 'react';
import { espera, nuevaClaveDeIdempotencia, type OpcionesApi } from './api';
import { conexion } from './conexion';
import { avisosDeEnvio, textoDeEnvioCancelado } from './envios-cancelados';
import { ErrorApi } from './errores';
import {
  alCambiarLaIdentidad,
  cambioDeIdentidad,
  identidadActual,
  type IdentidadDeSesion,
  type MotivoDeCambioDeIdentidad,
} from './identidad';

/**
 * Lo que una escritura de la carta o de la disponibilidad recibe de `enviarSinPerder`: la clave de
 * idempotencia de esta escritura lógica (la misma en todos los intentos) y el aviso de "empezó a
 * reintentarse". Cada llamada de `carta.ts` lo pasa tal cual a `api.ts`.
 */
export type ExtraDeEscritura = Pick<
  OpcionesApi<unknown>,
  'idempotente' | 'alReintentar' | 'reintentos' | 'senal'
>;

/**
 * El envío no salió porque la sesión que lo originó dejó de valer (se cerró, entró otra persona o cambió
 * la sucursal). Es un `ErrorApi` con código `ENVIO_CANCELADO` para que cada pantalla lo muestre con su
 * manejo de errores de siempre; su mensaje ya dice el porqué ("No se envió: cambiaste de usuario.").
 */
export class EnvioCancelado extends ErrorApi {
  readonly motivo: MotivoDeCambioDeIdentidad;

  constructor(motivo: MotivoDeCambioDeIdentidad) {
    super({ estado: 0, codigo: 'ENVIO_CANCELADO', mensaje: textoDeEnvioCancelado(motivo) });
    this.name = 'EnvioCancelado';
    this.motivo = motivo;
  }
}

/**
 * Opciones de `useMutation` para toda escritura que pasa por `enviarSinPerder`. Por defecto TanStack Query
 * pausa una mutación mientras el navegador dice que no hay red (`navigator.onLine` en falso): la pantalla
 * se quedaría en "Guardando…" sin llegar nunca a "Pendiente de envío". Con `always` la mutación corre, el
 * intento falla por la red y `enviarSinPerder` la sigue reintentando con la misma clave hasta que vuelve.
 */
export const MUTACION_SIN_PAUSA = { networkMode: 'always' } as const;

/** Espera entre los intentos que siguen a `api.ts` (que ya reintenta unos 35 s): 15 s, 30 s y luego 60 s. */
const ESPERAS_DE_ENVIO_MS = [15_000, 30_000, 60_000] as const;
/** Intentos máximos antes de rendirse y avisar (unos 35 minutos); evita un bucle sin fin. */
const INTENTOS_MAXIMOS = 40;

export interface OpcionesDeEnvio {
  /** `true` cuando el envío queda esperando la red; `false` cuando termina (bien o mal). */
  alCambiar?: (pendiente: boolean) => void;
  /** Cancela la espera desde fuera (por ejemplo, al salir de una pantalla que ya no la necesita). */
  senal?: AbortSignal;
  /**
   * Identidad de la sesión con la que nació el envío. Por defecto, la de la llamada; quien encola el
   * envío para más tarde (una cadena de tareas) la captura antes y la pasa aquí.
   */
  identidad?: IdentidadDeSesion;
  /**
   * `true` mientras la pantalla que originó el envío sigue ahí para mostrar el error. Si se cancela por un
   * cambio de sucursal y la pantalla no está, el aviso sale como aviso global. Sin esto se da por ausente.
   */
  pantallaViva?: () => boolean;
  /**
   * Clave de idempotencia ya generada, para repetir una escritura lógica desde otra llamada (un nuevo toque
   * sobre "Reintentar" tras rendirse, con la misma autorización). Por defecto se genera una nueva.
   */
  clave?: string;
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
 * - un error de negocio (4xx) o un 5xx del servidor termina el envío con ese error: no se reintenta;
 * - queda atado a la sesión que lo originó (trazabilidad de autor): captura el token y la sucursal activa
 *   al nacer y, si la sesión se cierra, entra otra persona o cambia la sucursal mientras espera, se
 *   cancela con `EnvioCancelado` en vez de salir con la sesión nueva. Se comprueba antes de cada intento y
 *   en cuanto la sesión avisa de un cambio; la cancelación también corta el intento en vuelo.
 *
 * Lo que la persona escribió sigue en su formulario (no se vacía). Lo que no hace: sobrevivir a una
 * recarga o al cierre de la pestaña, porque la cola vive en memoria (ver `apps/app/README.md`); por eso
 * `instalarAvisoAlSalir` avisa antes de salir si hay envíos esperando.
 */
export async function enviarSinPerder<T>(
  ejecutar: (extra: ExtraDeEscritura) => Promise<T>,
  opciones: OpcionesDeEnvio = {},
): Promise<T> {
  const clave = opciones.clave ?? nuevaClaveDeIdempotencia();
  const origen = opciones.identidad ?? identidadActual();
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

  // Una sola señal para todo: la de fuera y la de "la sesión cambió". Sin `AbortSignal.any` (Safari 17.4).
  const control = new AbortController();
  const alAbortarFuera = () => control.abort(opciones.senal?.reason);
  if (opciones.senal?.aborted) alAbortarFuera();
  else opciones.senal?.addEventListener('abort', alAbortarFuera, { once: true });
  const vigilar = (sugerido?: MotivoDeCambioDeIdentidad) => {
    if (control.signal.aborted) return;
    const motivo = cambioDeIdentidad(origen);
    // Un cierre que la persona pidió como "Cambiar usuario" se dice así.
    if (motivo)
      control.abort(new EnvioCancelado(motivo === 'cierre' && sugerido ? sugerido : motivo));
  };
  const dejarDeOir = alCambiarLaIdentidad(vigilar);

  try {
    for (let intento = 0; ; intento++) {
      // Última comprobación antes de salir: la lectura del token de `api.ts` ocurre justo después.
      vigilar();
      if (control.signal.aborted) throw control.signal.reason;
      // Mientras un intento está en vuelo, `api.ts` ya cuenta el cambio como pendiente: no se cuenta dos veces.
      soltarCuenta();
      try {
        return await ejecutar({
          idempotente: clave,
          alReintentar: () => marcar(true),
          senal: control.signal,
          // Después del primer intento, uno solo de repuesto: la espera larga la hace este bucle.
          ...(intento > 0 ? { reintentos: 1 } : {}),
        });
      } catch (error) {
        if (control.signal.aborted) throw control.signal.reason;
        if (!(error instanceof ErrorApi) || !error.sinConexion || intento >= INTENTOS_MAXIMOS) {
          throw error;
        }
      }
      marcar(true);
      contada = true;
      conexion.pendienteMas();
      await espera.dormir(
        ESPERAS_DE_ENVIO_MS[Math.min(intento, ESPERAS_DE_ENVIO_MS.length - 1)] ?? 60_000,
        control.signal,
      );
      if (control.signal.aborted) throw control.signal.reason;
    }
  } catch (error) {
    // Sin la pantalla que lo pidió (o si la sesión se fue), nadie más cuenta que el cambio no salió.
    if (
      error instanceof EnvioCancelado &&
      (error.motivo !== 'sucursal' || !(opciones.pantallaViva?.() ?? false))
    ) {
      avisosDeEnvio.publicar(error.motivo);
    }
    throw error;
  } finally {
    dejarDeOir();
    opciones.senal?.removeEventListener('abort', alAbortarFuera);
    soltarCuenta();
    marcar(false);
  }
}

/**
 * Avisa antes de cerrar o recargar la pestaña si hay cambios esperando la red: la cola de envíos vive en
 * memoria y se perdería. Devuelve cómo quitar el aviso. Lo instala `App`.
 */
export function instalarAvisoAlSalir(): () => void {
  const alSalir = (evento: BeforeUnloadEvent) => {
    if (conexion.leer().pendientes === 0) return;
    evento.preventDefault();
    // Chrome pide también `returnValue` para mostrar el aviso del navegador.
    evento.returnValue = '';
  };
  window.addEventListener('beforeunload', alSalir);
  return () => window.removeEventListener('beforeunload', alSalir);
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
      /**
       * Identidad de la sesión con la que se pidió el envío, si no se manda ahora mismo sino más tarde
       * (una cola de tareas): se captura con `identidadActual()` al pedirlo.
       */
      identidad?: IdentidadDeSesion,
      /** Clave de idempotencia que se conserva entre llamadas (ver `OpcionesDeEnvio.clave`). */
      clave?: string,
    ) =>
      enviarSinPerder(ejecutar, {
        ...(identidad ? { identidad } : {}),
        ...(clave ? { clave } : {}),
        pantallaViva: () => montado.current,
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
