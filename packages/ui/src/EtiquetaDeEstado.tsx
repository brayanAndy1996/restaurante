import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icono } from './iconos';
import { clases } from './utilidades';

export type TonoEtiqueta = 'ok' | 'alerta' | 'mal' | 'neutro' | 'info';

interface PropsEtiqueta {
  tono: TonoEtiqueta;
  icono?: LucideIcon;
  children: ReactNode;
}

/** Etiqueta de estado de 24 px: siempre lleva texto, el color solo la refuerza. */
export function EtiquetaDeEstado({ tono, icono, children }: PropsEtiqueta) {
  return (
    <span className={clases('ui-etiqueta', `ui-etiqueta--${tono}`)}>
      {icono ? <Icono icono={icono} tamano={16} /> : null}
      {children}
    </span>
  );
}
