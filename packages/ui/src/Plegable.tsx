import { useId, type ReactNode } from 'react';
import { Icono, IconoAbajo } from './iconos';
import { clases } from './utilidades';

interface PropsPlegable {
  titulo: string;
  /** Lo que hay dentro, dicho en una línea, para no tener que abrirlo ("Gravado · sin ICBPER"). */
  resumen?: ReactNode;
  abierto: boolean;
  onCambio: (abierto: boolean) => void;
  children: ReactNode;
}

/**
 * Sección plegada: una fila de 56 px con su título y su resumen, que se abre con un toque. Para lo que
 * casi nunca se toca (datos tributarios) pero que no debe quedar escondido sin decir qué contiene.
 */
export function Plegable({ titulo, resumen, abierto, onCambio, children }: PropsPlegable) {
  const id = useId();
  return (
    <section className={clases('ui-plegable', abierto && 'ui-plegable--abierto')}>
      <h3 className="ui-plegable__titulo">
        <button
          type="button"
          className="ui-plegable__boton"
          aria-expanded={abierto}
          aria-controls={`${id}-contenido`}
          onClick={() => onCambio(!abierto)}
        >
          <span className="ui-plegable__texto">
            <span className="ui-plegable__nombre">{titulo}</span>
            {resumen ? <span className="ui-plegable__resumen">{resumen}</span> : null}
          </span>
          <Icono icono={IconoAbajo} className="ui-plegable__chevron" />
        </button>
      </h3>
      <div className="ui-plegable__contenido" id={`${id}-contenido`} hidden={!abierto}>
        {children}
      </div>
    </section>
  );
}
