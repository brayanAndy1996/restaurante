'use client';

import type { ReactNode, Ref } from 'react';
import { Icono } from '../Iconos';

interface Props {
  barraRef: Ref<HTMLDivElement>;
  /** El estado del llamado, un error o "Enviando…", ya armado por `Mesa`. */
  avisos: ReactNode;
  /** Platos del pedido y su total ya armado (`null` mientras se cargan las reglas de montos); `null` sin pedido. */
  pedido: { platos: number; total: ReactNode } | null;
  /** Los tres envíos apagados (hay un llamado pendiente, el local está cerrado o se está enviando). */
  envioApagado: boolean;
  alVerPedido: () => void;
  alLlamar: () => void;
  alPedirCuenta: () => void;
}

/**
 * La barra fija de abajo del modo mesa (criterio 85): el aviso de estado o de error, "Ver tu pedido" cuando hay
 * pedido y, siempre, "Llamar al mozo" y "Pedir la cuenta". Está en la zona del pulgar y respeta la zona segura de
 * los celulares con muesca.
 */
export function BarraDeMesa({
  barraRef,
  avisos,
  pedido,
  envioApagado,
  alVerPedido,
  alLlamar,
  alPedirCuenta,
}: Props) {
  return (
    <div className="barra" role="region" aria-label="Tu mesa" ref={barraRef}>
      <div className="barra__contenido">
        {/* Sin `aria-live` aquí: cada `Aviso` ya trae su `role` (`status` o `alert`) y un contenedor vivo encima
            haría que el lector de pantalla lo dijera dos veces. */}
        <div className="barra__avisos">{avisos}</div>
        {pedido ? (
          <button type="button" className="boton-principal" onClick={alVerPedido}>
            <span className="barra__cantidad">
              <span>Ver tu pedido · </span>
              <span>
                {pedido.platos} {pedido.platos === 1 ? 'plato' : 'platos'}
              </span>
            </span>
            <span>{pedido.total}</span>
          </button>
        ) : null}
        <div className="barra__llamados">
          <button
            type="button"
            className="boton-secundario"
            aria-disabled={envioApagado}
            onClick={() => {
              if (!envioApagado) alLlamar();
            }}
          >
            <Icono nombre="campana" pequeno />
            Llamar al mozo
          </button>
          <button
            type="button"
            className="boton-secundario"
            aria-disabled={envioApagado}
            onClick={() => {
              if (!envioApagado) alPedirCuenta();
            }}
          >
            <Icono nombre="cuenta" pequeno />
            Pedir la cuenta
          </button>
        </div>
      </div>
    </div>
  );
}
