import type { AutorizacionRespuesta } from '@restaurante/contratos';
import type { Accion } from '@restaurante/dominio';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { VentanaClaveSupervisor } from './VentanaClaveSupervisor';

export interface PedidoDeClave {
  accion: Accion;
  /** Qué se autoriza, para que el supervisor lo lea ("Anular ítem: Ceviche mixto x1 · S/ 38.00"). */
  descripcion: string;
  atajos?: readonly string[];
  /** Motivo que la persona ya eligió: la ventana lo muestra y no lo pide otra vez. */
  motivo?: string;
}

/**
 * Forma cómoda de usar la ventana de clave de supervisor desde una pantalla:
 *
 * ```tsx
 * const { pedir, ventana } = useClaveDeSupervisor();
 * // …
 * if (usePermiso('ANULAR_ITEM_ENVIADO') === 'clave') {
 *   const autorizacion = await pedir({ accion: 'ANULAR_ITEM_ENVIADO', descripcion });
 *   if (!autorizacion) return; // canceló
 *   await api.post(ruta, cuerpo, { autorizacion: autorizacion.autorizacionId });
 * }
 * return <>{…}{ventana}</>;
 * ```
 *
 * La autorización vale para una sola acción y vence en 2 minutos (`expiraEn`): hay que repetir la acción
 * enseguida con `X-Autorizacion`. `pedir` responde `null` si se cierra la ventana sin autorizar.
 */
export function useClaveDeSupervisor(): {
  pedir: (pedido: PedidoDeClave) => Promise<AutorizacionRespuesta | null>;
  ventana: ReactNode;
} {
  const [pedido, setPedido] = useState<PedidoDeClave | null>(null);
  const resolver = useRef<((a: AutorizacionRespuesta | null) => void) | null>(null);

  const terminar = useCallback((autorizacion: AutorizacionRespuesta | null) => {
    // La ventana también avisa al cerrarse después de autorizar: solo cuenta la primera respuesta.
    const resolverActual = resolver.current;
    resolver.current = null;
    setPedido(null);
    resolverActual?.(autorizacion);
  }, []);

  const pedir = useCallback((nuevo: PedidoDeClave) => {
    // Un pedido anterior sin respuesta se da por cancelado.
    resolver.current?.(null);
    return new Promise<AutorizacionRespuesta | null>((resolve) => {
      resolver.current = resolve;
      setPedido(nuevo);
    });
  }, []);

  const ventana = (
    <VentanaClaveSupervisor
      // Un pedido nuevo empieza con la ventana limpia.
      key={pedido ? `${pedido.accion}:${pedido.descripcion}` : 'cerrada'}
      abierta={pedido !== null}
      accion={pedido?.accion ?? 'ATENDER_MESA'}
      descripcion={pedido?.descripcion ?? ''}
      {...(pedido?.atajos ? { atajos: pedido.atajos } : {})}
      {...(pedido?.motivo ? { motivo: pedido.motivo } : {})}
      onAutorizada={terminar}
      onCancelar={() => terminar(null)}
    />
  );
  return { pedir, ventana };
}
