import type { AutorizacionRespuesta, ObjetivoAutorizacion } from '@restaurante/contratos';
import type { RequisitoPermiso } from '@restaurante/dominio';
import { useRef, useState } from 'react';
import { mismoObjetivo, type ContextoDeObjetivo } from '../../componentes/objetivo-de-clave';
import { useClaveDeSupervisor } from '../../componentes/useClaveDeSupervisor';
import { ahoraDelServidor, nuevaClaveDeIdempotencia } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { INTENTOS_RECORDADOS, type IntentoRecordado } from '../../lib/intentos-recordados';
import { ErrorApi } from '../../lib/errores';
import type { ExtraConClave } from './cuenta';

/** Una autorización que vence en menos de esto se pide de nuevo antes de usarla. */
const MARGEN_DE_AUTORIZACION_MS = 5_000;

const NOTA_DE_CLAVE_PERDIDA =
  'La clave del supervisor ya no valía. Pídela otra vez; lo que escribiste sigue aquí.';

export interface PedidoDeAjuste<T = unknown> {
  accion: 'APLICAR_DESCUENTO' | 'APLICAR_CORTESIA' | 'EMITIR_NOTA_CREDITO';
  /** `clave` si la persona necesita la clave de un supervisor; `permitido` si aplica sin ella. */
  permiso: RequisitoPermiso;
  /** Lo que se autoriza: es lo que la ventana muestra y lo que va a `POST /autorizaciones`. */
  objetivo: ObjetivoAutorizacion;
  contexto: ContextoDeObjetivo;
  motivo: string;
  /** Todo lo escrito que cambia la acción: mientras no cambie, un nuevo toque repite el mismo `id`. */
  huella: string;
  /**
   * Todo lo que viaja en el cuerpo, también lo que no cambia la acción (el motivo, el total): la clave de idempotencia
   * solo se repite con el mismo cuerpo, porque la API rechaza otra clave con otro cuerpo. Por defecto, la `huella`.
   */
  huellaDelCuerpo?: string;
  /** Manda la escritura con el `id` del descuento o de la cortesía y la autorización, si hubo. */
  enviar: (id: string, extra: ExtraConClave) => Promise<T>;
}

export type ResultadoDeAjuste<T = unknown> =
  /** `respuesta` es lo que contestó la API a la escritura. */
  | { estado: 'hecho'; respuesta: T }
  /** La persona cerró la ventana de la clave. */
  | { estado: 'cancelado' }
  | { estado: 'fallo'; error: unknown };

type Intento = IntentoRecordado;

/**
 * Aplicar un descuento o una cortesía con la clave atada (criterio 40 de 006, pregunta 9): pide la clave del
 * supervisor con el objetivo exacto cuando hace falta, repite la escritura con `X-Autorizacion` y, si la API dice
 * que la clave ya no vale (403 `AUTORIZACION_INVALIDA`), la pide otra vez una vez más sin perder nada de lo escrito.
 *
 * - El `id` del descuento y la clave de idempotencia se conservan entre toques mientras no cambie lo escrito
 *   (`huella`) ni la autorización: un corte de red repite la misma escritura sin duplicarla.
 * - Una autorización sirve de nuevo (por ejemplo, tras un 422 que la API revirtió) solo si su objetivo es
 *   exactamente el de ahora y no está por vencer.
 */
export function useAjusteConClave(opciones: { recordarComo?: string } = {}) {
  const envio = useEnvioPendiente();
  const { pedir, ventana } = useClaveDeSupervisor();
  const autorizacion = useRef<AutorizacionRespuesta | null>(null);
  const propio = useRef<Intento | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  // Con `recordarComo`, el intento sobrevive a cerrar y volver a abrir la pantalla: un envío que se quedó esperando la
  // red sigue con su `id`, y el que se abre después de él lo repite en vez de crear otra cosa.
  const memoria = opciones.recordarComo;
  const intento = {
    get current(): Intento | null {
      return memoria === undefined ? propio.current : (INTENTOS_RECORDADOS.get(memoria) ?? null);
    },
    set current(valor: Intento | null) {
      if (memoria === undefined) propio.current = valor;
      else if (valor === null) INTENTOS_RECORDADOS.delete(memoria);
      else INTENTOS_RECORDADOS.set(memoria, valor);
    },
  };

  async function ejecutar<T>(pedido: PedidoDeAjuste<T>): Promise<ResultadoDeAjuste<T>> {
    setNota(null);
    try {
      // Una segunda vuelta solo si la API dice que la autorización ya no vale.
      for (let vuelta = 0; vuelta < 2; vuelta++) {
        let autorizacionId: string | null = null;
        if (pedido.permiso === 'clave') {
          const actual = autorizacion.current;
          const sirve =
            actual !== null &&
            mismoObjetivo(actual.objetivo, pedido.objetivo) &&
            Date.parse(actual.expiraEn) - ahoraDelServidor() > MARGEN_DE_AUTORIZACION_MS;
          if (!sirve) {
            autorizacion.current = null;
            const nueva = await pedir({
              accion: pedido.accion,
              objetivo: pedido.objetivo,
              contexto: pedido.contexto,
              motivo: pedido.motivo,
            });
            if (!nueva) return { estado: 'cancelado' };
            autorizacion.current = nueva;
          }
          autorizacionId = autorizacion.current?.autorizacionId ?? null;
        }

        const previo = intento.current;
        const huellaDelCuerpo = pedido.huellaDelCuerpo ?? pedido.huella;
        const mismaAccion = previo?.huella === pedido.huella;
        const mismoCuerpo =
          mismaAccion &&
          previo?.huellaDelCuerpo === huellaDelCuerpo &&
          previo?.autorizacionId === autorizacionId;
        const actual: Intento = {
          huella: pedido.huella,
          huellaDelCuerpo,
          id: mismaAccion && previo ? previo.id : nuevaClaveDeIdempotencia(),
          clave: mismoCuerpo && previo ? previo.clave : nuevaClaveDeIdempotencia(),
          autorizacionId,
        };
        intento.current = actual;

        try {
          const respuesta = await envio.enviar(
            (extra) =>
              pedido.enviar(actual.id, {
                ...extra,
                ...(autorizacionId ? { autorizacion: autorizacionId } : {}),
              }),
            undefined,
            undefined,
            actual.clave,
          );
          return { estado: 'hecho', respuesta };
        } catch (error) {
          const clavePerdida =
            error instanceof ErrorApi &&
            pedido.permiso === 'clave' &&
            (error.codigo === 'AUTORIZACION_INVALIDA' || error.codigo === 'CLAVE_REQUERIDA');
          if (clavePerdida) {
            autorizacion.current = null;
            if (vuelta === 0) {
              // Venció o ya se usó: se vuelve a pedir, con lo mismo escrito.
              if (envio.sigueMontada()) setNota(NOTA_DE_CLAVE_PERDIDA);
              continue;
            }
          }
          return { estado: 'fallo', error };
        }
      }
      return { estado: 'cancelado' };
    } catch (error) {
      return { estado: 'fallo', error };
    }
  }

  /** Hubo una respuesta final (la nota salió, o la API dijo que no): lo que sigue es otra acción, con otro `id`. */
  function soltar() {
    intento.current = null;
  }

  /** La escritura con ese `id` ya salió (se vio en lo que la API devuelve): su intento ya no hace falta. */
  function soltarSiEs(id: string) {
    if (intento.current?.id === id) intento.current = null;
  }

  return {
    ejecutar,
    soltar,
    soltarSiEs,
    ventana,
    pendiente: envio.pendiente,
    sigueMontada: envio.sigueMontada,
    nota,
  };
}
