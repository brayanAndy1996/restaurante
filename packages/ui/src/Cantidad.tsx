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
    <div className={clases('ui-cantidad', className)} role="group" aria-label={`Cantidad de ${nombre}`}>
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
