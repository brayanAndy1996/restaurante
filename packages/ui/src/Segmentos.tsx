import { Icono, IconoOk } from './iconos';
import { clases } from './utilidades';

export interface OpcionDeSegmento<T extends string> {
  valor: T;
  etiqueta: string;
}

interface PropsSegmentos<T extends string> {
  /** Nombre del grupo para los lectores de pantalla ("Filtrar por estado"). */
  etiqueta: string;
  opciones: readonly OpcionDeSegmento<T>[];
  valor: T;
  onCambio: (valor: T) => void;
}

/**
 * Filtro de una sola opción: baldosas de 48 px en una cuadrícula que pasa a otra fila en vez de
 * desplazarse de lado. La elegida lleva una marca además del color y se anuncia como presionada.
 */
export function Segmentos<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
}: PropsSegmentos<T>) {
  return (
    <div className="ui-segmentos" role="group" aria-label={etiqueta}>
      {opciones.map((o) => {
        const elegida = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            className={clases('ui-segmento', elegida && 'ui-segmento--elegido')}
            aria-pressed={elegida}
            onClick={() => {
              if (!elegida) onCambio(o.valor);
            }}
          >
            {elegida ? <Icono icono={IconoOk} tamano={16} /> : null}
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
