import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icono, IconoAlerta, IconoError, IconoExito, IconoInfo } from './iconos';
import { clases } from './utilidades';

export type TipoAviso = 'error' | 'alerta' | 'ok' | 'info';

const ICONOS: Record<TipoAviso, LucideIcon> = {
  error: IconoError,
  alerta: IconoAlerta,
  ok: IconoExito,
  info: IconoInfo,
};

interface PropsAviso {
  tipo: TipoAviso;
  /** En negrita: dice qué pasó ("No pudimos ingresarte"). */
  titulo?: string;
  children?: ReactNode;
  className?: string;
  /** Icono propio (por ejemplo, el candado de un bloqueo); por defecto, el del tipo. */
  icono?: LucideIcon;
}

/**
 * Aviso en línea: fondo suave del color de estado, borde de 1 px, icono y título. Los errores se
 * anuncian a los lectores de pantalla (`role="alert"`); lo demás, con cortesía (`role="status"`).
 */
export function Aviso({ tipo, titulo, children, className, icono }: PropsAviso) {
  return (
    <div
      className={clases('ui-aviso', `ui-aviso--${tipo}`, className)}
      role={tipo === 'error' ? 'alert' : 'status'}
    >
      <Icono icono={icono ?? ICONOS[tipo]} />
      <div className="ui-aviso__cuerpo">
        {titulo ? <b className="ui-aviso__titulo">{titulo}</b> : null}
        {children}
      </div>
    </div>
  );
}
