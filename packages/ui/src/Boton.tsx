import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { IconoCargando, Icono } from './iconos';
import { clases } from './utilidades';

export type VarianteBoton =
  'secundario' | 'principal' | 'texto' | 'peligro' | 'peligro-lleno' | 'sobre-oscuro';

/** Clases de un botón, para dar el aspecto de botón a un enlace del router. */
export function claseBoton(variante: VarianteBoton = 'secundario', bloque?: boolean): string {
  return clases(
    'ui-boton',
    variante !== 'secundario' && `ui-boton--${variante}`,
    bloque && 'ui-boton--bloque',
  );
}

export interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  /** Ocupa todo el ancho (la norma en celular para la acción principal). */
  bloque?: boolean;
  icono?: LucideIcon;
  /** Muestra el indicador y desactiva el botón sin cambiar su ancho. */
  cargando?: boolean;
  /** Texto mientras `cargando`, por ejemplo "Ingresando…". Por defecto, el mismo texto. */
  textoCargando?: string;
}

/** Botón de 48 px (56 px el principal de pantalla). Uno principal por pantalla. */
export function Boton({
  variante = 'secundario',
  bloque,
  icono,
  cargando,
  textoCargando,
  className,
  children,
  disabled,
  type = 'button',
  ...resto
}: PropsBoton) {
  return (
    <button
      type={type}
      className={clases(claseBoton(variante, bloque), className)}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando ? (
        <Icono icono={IconoCargando} tamano={20} girando />
      ) : icono ? (
        <Icono icono={icono} tamano={20} />
      ) : null}
      {cargando && textoCargando ? textoCargando : children}
    </button>
  );
}

interface PropsBotonIcono extends ButtonHTMLAttributes<HTMLButtonElement> {
  icono: LucideIcon;
  /** Nombre accesible en español: el botón no lleva texto visible. */
  etiqueta: string;
}

/** Botón cuadrado de 48 px solo con icono (cerrar, mostrar contraseña). Exige una etiqueta. */
export function BotonIcono({
  icono,
  etiqueta,
  className,
  type = 'button',
  ...resto
}: PropsBotonIcono) {
  return (
    <button
      type={type}
      className={clases('ui-boton-icono', className)}
      aria-label={etiqueta}
      {...resto}
    >
      <Icono icono={icono} />
    </button>
  );
}
