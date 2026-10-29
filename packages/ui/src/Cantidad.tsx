import { BotonIcono } from './Boton';
import { IconoMas, IconoMenos } from './iconos';
import { clases } from './utilidades';

interface PropsCantidad {
  /** Qué se cuenta, para los lectores de pantalla ("Hamburguesa clásica"): "Quitar una unidad de …". */
  nombre: string;
  valor: number;
  minimo?: number;
  maximo: number;
  onCambio: (valor: number) => void;
  className?: string;
}

/**
 * Cantidad con "menos" y "más" de 48 px y el número entre los dos, en cifras tabulares. Se toca con
 * una mano y sin teclado; en los extremos el botón que no hace nada queda marcado con `aria-disabled`
 * (el foco no se pierde). El número se anuncia al cambiar.
 */
export function SelectorDeCantidad({
  nombre,
  valor,
  minimo = 1,
  maximo,
  onCambio,
  className,
}: PropsCantidad) {
  const enElMinimo = valor <= minimo;
  const enElMaximo = valor >= maximo;
  return (
    <div
      className={clases('ui-cantidad', className)}
      role="group"
      aria-label={`Cantidad de ${nombre}`}
    >
      <BotonIcono
        icono={IconoMenos}
        etiqueta={`Quitar una unidad de ${nombre}`}
        aria-disabled={enElMinimo || undefined}
        onClick={() => {
          if (!enElMinimo) onCambio(valor - 1);
        }}
      />
      <output className="ui-cantidad__valor">
        <span aria-hidden="true">× </span>
        {valor}
      </output>
      <BotonIcono
        icono={IconoMas}
        etiqueta={`Agregar una unidad de ${nombre}`}
        aria-disabled={enElMaximo || undefined}
        onClick={() => {
          if (!enElMaximo) onCambio(valor + 1);
        }}
      />
    </div>
  );
}

interface PropsContadorGrande {
  /** Qué se cuenta, para los lectores de pantalla ("comensales"): "Quitar uno de comensales". */
  nombre: string;
  valor: number;
  minimo?: number;
  maximo: number;
  /** Texto bajo el número ("comensales"). */
  unidad?: string;
  onCambio: (valor: number) => void;
  className?: string;
}

/**
 * Contador de números chicos que se eligen con el pulgar (los comensales de una mesa): el valor en
 * cifras grandes y tabulares al centro, y "menos" y "más" de 48 px a los lados. En los extremos el
 * botón que no hace nada queda marcado con `aria-disabled` (el foco no se pierde). El número se anuncia
 * al cambiar.
 */
export function ContadorGrande({
  nombre,
  valor,
  minimo = 1,
  maximo,
  unidad,
  onCambio,
  className,
}: PropsContadorGrande) {
  const enElMinimo = valor <= minimo;
  const enElMaximo = valor >= maximo;
  return (
    <div
      className={clases('ui-contador', className)}
      role="group"
      aria-label={`Cantidad de ${nombre}`}
    >
      <BotonIcono
        icono={IconoMenos}
        etiqueta={`Quitar uno de ${nombre}`}
        aria-disabled={enElMinimo || undefined}
        onClick={() => {
          if (!enElMinimo) onCambio(valor - 1);
        }}
      />
      <output className="ui-contador__valor" aria-live="polite">
        <span className="ui-contador__numero">{valor}</span>
        {unidad ? <span className="ui-contador__unidad">{unidad}</span> : null}
      </output>
      <BotonIcono
        icono={IconoMas}
        etiqueta={`Agregar uno a ${nombre}`}
        aria-disabled={enElMaximo || undefined}
        onClick={() => {
          if (!enElMaximo) onCambio(valor + 1);
        }}
      />
    </div>
  );
}
