import { EstadoVacio, IconoPendiente } from '@restaurante/ui';
import { Pagina } from '../../componentes/Pagina';

/**
 * `/cocina`: la pantalla de cocina y barra. En T11 solo existe el destino de la navegación (criterio 87);
 * las comandas, los tiempos y los botones "Preparando" y "Listo" son la tarea T20.
 */
export function CocinaPagina() {
  return (
    <Pagina titulo="Cocina" ancho="ancho">
      <EstadoVacio icono={IconoPendiente} titulo="Las comandas llegan en la siguiente parte">
        Aquí verás las comandas de tu estación en el orden en que llegan.
      </EstadoVacio>
    </Pagina>
  );
}
