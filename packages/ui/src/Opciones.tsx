import { useId, type ReactNode } from 'react';
import { Icono, IconoAlerta, IconoCandado, IconoOk } from './iconos';
import { clases } from './utilidades';

interface PropsCasilla {
  etiqueta: string;
  /** Segunda línea: qué significa marcarla. */
  ayuda?: ReactNode;
  marcada: boolean;
  onCambio: (marcada: boolean) => void;
  /** No se puede cambiar (por ejemplo, una sucursal donde la persona no tiene permiso): lleva candado y su motivo en `ayuda`. */
  bloqueada?: boolean;
}

/**
 * Casilla grande de una fila de 48 px o más: toda la fila responde al toque. El estado se dice con
 * la marca dentro de la caja, no solo con el color.
 */
export function Casilla({ etiqueta, ayuda, marcada, onCambio, bloqueada }: PropsCasilla) {
  const id = useId();
  return (
    <label className={clases('ui-casilla', bloqueada && 'ui-casilla--bloqueada')} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="ui-casilla__entrada"
        checked={marcada}
        disabled={bloqueada}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className="ui-casilla__caja" aria-hidden="true">
        <Icono icono={IconoOk} tamano={20} />
      </span>
      <span className="ui-casilla__texto">
        <span className="ui-casilla__etiqueta">{etiqueta}</span>
        {ayuda ? (
          <span className="ui-casilla__ayuda" id={`${id}-ayuda`}>
            {ayuda}
          </span>
        ) : null}
      </span>
      {bloqueada ? <Icono icono={IconoCandado} tamano={20} /> : null}
    </label>
  );
}

export interface OpcionConAyuda<T extends string> {
  valor: T;
  titulo: string;
  /** Una línea que dice qué significa elegirla. */
  ayuda: string;
}

interface PropsOpcionesConAyuda<T extends string> {
  /** Pregunta del grupo ("Cómo se controla el stock"). */
  etiqueta: string;
  ayuda?: ReactNode;
  opciones: readonly OpcionConAyuda<T>[];
  /** `''` si todavía no se eligió ninguna. */
  valor: T | '';
  onCambio: (valor: T) => void;
  error?: string | undefined;
}

/**
 * Grupo de opciones de una sola respuesta, cada una con su título y una línea de ayuda. Son botones
 * de radio nativos (el teclado y los lectores de pantalla ya saben usarlos) con aspecto de baldosa;
 * la elegida lleva marca, fondo cobalto suave y borde cobalto.
 */
export function OpcionesConAyuda<T extends string>({
  etiqueta,
  ayuda,
  opciones,
  valor,
  onCambio,
  error,
}: PropsOpcionesConAyuda<T>) {
  const id = useId();
  return (
    <fieldset
      className={clases('ui-opciones', error && 'ui-opciones--error')}
      aria-describedby={
        [ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
        undefined
      }
      aria-invalid={error ? true : undefined}
    >
      <legend className="ui-campo__etiqueta">{etiqueta}</legend>
      {ayuda ? (
        <div className="ui-campo__ayuda" id={`${id}-ayuda`}>
          {ayuda}
        </div>
      ) : null}
      <div className="ui-opciones__lista">
        {opciones.map((o) => {
          const elegida = o.valor === valor;
          return (
            <label key={o.valor} className={clases('ui-opcion', elegida && 'ui-opcion--elegida')}>
              <input
                type="radio"
                className="ui-opcion__entrada"
                name={id}
                value={o.valor}
                checked={elegida}
                onChange={() => onCambio(o.valor)}
              />
              <span className="ui-opcion__marca" aria-hidden="true">
                {elegida ? <Icono icono={IconoOk} tamano={16} /> : null}
              </span>
              <span className="ui-opcion__texto">
                <span className="ui-opcion__titulo">{o.titulo}</span>
                <span className="ui-opcion__ayuda">{o.ayuda}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <div className="ui-campo__mensaje" id={`${id}-error`} role="alert">
          <Icono icono={IconoAlerta} tamano={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </fieldset>
  );
}
