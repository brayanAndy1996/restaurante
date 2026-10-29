import type { EstadoMesa, FormaMesa } from '@restaurante/dominio';
import {
  Icono,
  IconoFormaCuadrada,
  IconoFormaRectangular,
  IconoFormaRedonda,
  IconoOk,
  IconoUsuarios,
  type LucideIcon,
} from './iconos';
import { clases } from './utilidades';

/** Texto de cada estado de la mesa: el color solo lo refuerza. */
export const TEXTO_DE_ESTADO_DE_MESA: Record<EstadoMesa, string> = {
  LIBRE: 'Libre',
  OCUPADA: 'Ocupada',
  EN_PRECUENTA: 'Pre-cuenta',
};

export const TEXTO_DE_FORMA_DE_MESA: Record<FormaMesa, string> = {
  CUADRADA: 'cuadrada',
  REDONDA: 'redonda',
  RECTANGULAR: 'rectangular',
};

const ICONO_DE_FORMA: Record<FormaMesa, LucideIcon> = {
  CUADRADA: IconoFormaCuadrada,
  REDONDA: IconoFormaRedonda,
  RECTANGULAR: IconoFormaRectangular,
};

export interface PropsBaldosaDeMesa {
  nombre: string;
  capacidad: number;
  forma: FormaMesa;
  /** Estado en el salón. Sin él (el editor del mapa) la baldosa solo muestra el nombre y los datos de la mesa. */
  estado?: EstadoMesa;
  /** Lo que sigue al estado: "3 · 25 min" da "Ocupada · 3 · 25 min". */
  detalle?: string;
  /** Mesa elegida: lleva una marca además del color y se anuncia como presionada. */
  elegida?: boolean;
  /** Se toca (botón). Sin él, la baldosa es solo informativa. */
  onClick?: () => void;
  /** Para el foco itinerante de la cuadrícula. */
  tabIndex?: number;
  className?: string;
  /** Atributos `data-*` que la cuadrícula usa para mover el foco. */
  datos?: Record<`data-${string}`, string | number>;
}

/** Nombre de la mesa para los lectores de pantalla: "Mesa 4" (o el nombre tal cual si ya empieza con "Mesa"). */
export function nombreAccesibleDeMesa(nombre: string): string {
  return /^mesa\b/i.test(nombre.trim()) ? nombre : `Mesa ${nombre}`;
}

/**
 * Baldosa de una mesa: nombre, capacidad y forma (con icono, porque la forma no se dibuja con
 * círculos) y, en el salón, su estado dicho con palabras además del color. Mide lo que mida la
 * celda de la cuadrícula (nunca menos de 48 px); el texto largo se corta con puntos suspensivos y
 * el nombre completo queda en la etiqueta accesible.
 */
export function BaldosaDeMesa({
  nombre,
  capacidad,
  forma,
  estado,
  detalle,
  elegida,
  onClick,
  tabIndex,
  className,
  datos,
}: PropsBaldosaDeMesa) {
  const textoEstado = estado
    ? `${TEXTO_DE_ESTADO_DE_MESA[estado]}${detalle ? ` · ${detalle}` : ''}`
    : undefined;
  const etiqueta = [
    nombreAccesibleDeMesa(nombre),
    `${capacidad} ${capacidad === 1 ? 'persona' : 'personas'}`,
    TEXTO_DE_FORMA_DE_MESA[forma],
    textoEstado,
  ]
    .filter(Boolean)
    .join(', ');
  const clase = clases(
    'ui-mesa',
    estado && `ui-mesa--${estado.toLowerCase().replace('_', '-')}`,
    elegida && 'ui-mesa--elegida',
    className,
  );
  const interior = (
    <>
      <span className="ui-mesa__nombre">{nombre}</span>
      <span className="ui-mesa__datos" aria-hidden="true">
        <Icono icono={IconoUsuarios} tamano={16} />
        <span>{capacidad}</span>
        <Icono icono={ICONO_DE_FORMA[forma]} tamano={16} />
      </span>
      {textoEstado ? (
        <span className="ui-mesa__estado" aria-hidden="true">
          {textoEstado}
        </span>
      ) : null}
      {elegida ? (
        <span className="ui-mesa__marca" aria-hidden="true">
          <Icono icono={IconoOk} tamano={16} />
        </span>
      ) : null}
    </>
  );
  if (!onClick) {
    return (
      <div className={clase} role="img" aria-label={etiqueta} title={nombre} {...datos}>
        {interior}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={clase}
      aria-label={etiqueta}
      aria-pressed={elegida}
      title={nombre}
      tabIndex={tabIndex}
      onClick={onClick}
      {...datos}
    >
      {interior}
    </button>
  );
}
