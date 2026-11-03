import { precioEnSoles, precioLeido } from '@restaurante/dominio';

/**
 * Un monto como se ve y como se lee: "S/ 36.00" a la vista y "36 soles" para el lector de pantalla. El formato lo da
 * `packages/dominio`; por eso este componente viaja en el bloque que se carga bajo demanda.
 */
export function Monto({ valor }: { valor: string }) {
  return (
    <>
      <span aria-hidden="true">{precioEnSoles(valor)}</span>
      <span className="sr">{precioLeido(valor)}</span>
    </>
  );
}
