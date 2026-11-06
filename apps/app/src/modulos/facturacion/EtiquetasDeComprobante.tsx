import type { PanelItem } from '@restaurante/contratos';
import {
  EtiquetaDeEstado,
  IconoAlerta,
  IconoBloqueo,
  IconoError,
  IconoOk,
  IconoPendiente,
  IconoReloj,
  type LucideIcon,
  type TonoEtiqueta,
} from '@restaurante/ui';
import { NOMBRE_DE_ALERTA, NOMBRE_DE_ESTADO } from './facturacion';

const ESTADO: Record<PanelItem['estado'], { tono: TonoEtiqueta; icono: LucideIcon }> = {
  POR_ENVIAR: { tono: 'info', icono: IconoPendiente },
  ENVIADO: { tono: 'info', icono: IconoReloj },
  ACEPTADO: { tono: 'ok', icono: IconoOk },
  RECHAZADO: { tono: 'mal', icono: IconoError },
  ANULADO: { tono: 'neutro', icono: IconoBloqueo },
};

/** El estado del comprobante ante SUNAT: siempre con palabras e icono, el color solo lo refuerza. */
export function EtiquetaDeEstadoSunat({ estado }: { estado: PanelItem['estado'] }) {
  const { tono, icono } = ESTADO[estado];
  return (
    <EtiquetaDeEstado tono={tono} icono={icono}>
      {NOMBRE_DE_ESTADO[estado]}
    </EtiquetaDeEstado>
  );
}

/** Lo que pide atención de un comprobante, si algo: el rechazado sin reemplazo, el demorado, el detenido o el sin activar. */
export function EtiquetaDeAlerta({ alerta }: { alerta: PanelItem['alerta'] }) {
  if (!alerta) return null;
  return (
    <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
      {NOMBRE_DE_ALERTA[alerta]}
    </EtiquetaDeEstado>
  );
}

/** La marca de un comprobante de prueba: no va a SUNAT ni tiene valor tributario (criterio 122). */
export function EtiquetaSimulado() {
  return <EtiquetaDeEstado tono="alerta">Simulado</EtiquetaDeEstado>;
}
