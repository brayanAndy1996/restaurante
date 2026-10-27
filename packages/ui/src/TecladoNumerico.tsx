import { IconoBorrar, Icono } from './iconos';
import { clases } from './utilidades';

export type EstadoPuntos = 'normal' | 'error' | 'apagado';

interface PropsPuntos {
  /** Largo del PIN: 4 o 6. */
  largo: number;
  llenos: number;
  estado?: EstadoPuntos;
}

/**
 * Los dígitos del PIN nunca se muestran: solo puntos vacíos o llenos. Es un `status` con texto oculto
 * ("2 de 4 dígitos") para los lectores de pantalla.
 */
export function PuntosPin({ largo, llenos, estado = 'normal' }: PropsPuntos) {
  return (
    <div
      className={clases('ui-puntos', estado !== 'normal' && `ui-puntos--${estado}`)}
      role="status"
    >
      <span className="ui-solo-lectores">{`${llenos} de ${largo} dígitos`}</span>
      {Array.from({ length: largo }, (_, i) => (
        <i
          key={i}
          aria-hidden="true"
          className={clases('ui-puntos__punto', i < llenos && 'ui-puntos__punto--lleno')}
        />
      ))}
    </div>
  );
}

interface PropsTeclado {
  onDigito: (digito: string) => void;
  onBorrar: () => void;
  deshabilitado?: boolean;
  /** Teclas de 52 px, para usarlo dentro de una hoja. */
  compacto?: boolean;
}

const DIGITOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Muro de baldosas de 3 columnas por 4 filas con juntas de 2 px. Reemplaza al teclado del sistema, que
 * nunca se abre para escribir un PIN. La fila de abajo: espacio, 0 y borrar.
 */
export function TecladoNumerico({ onDigito, onBorrar, deshabilitado, compacto }: PropsTeclado) {
  return (
    <div
      className={clases('ui-teclado', compacto && 'ui-teclado--compacto')}
      role="group"
      aria-label="Teclado numérico"
    >
      {DIGITOS.map((d) => (
        <button
          key={d}
          type="button"
          className="ui-tecla"
          disabled={deshabilitado}
          onClick={() => onDigito(d)}
        >
          {d}
        </button>
      ))}
      <span className="ui-tecla ui-tecla--vacia" aria-hidden="true" />
      <button
        type="button"
        className="ui-tecla"
        disabled={deshabilitado}
        onClick={() => onDigito('0')}
      >
        0
      </button>
      <button
        type="button"
        className="ui-tecla ui-tecla--funcion"
        disabled={deshabilitado}
        aria-label="Borrar el último dígito"
        onClick={onBorrar}
      >
        <Icono icono={IconoBorrar} />
      </button>
    </div>
  );
}
