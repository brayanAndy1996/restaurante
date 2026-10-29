import { Aviso, EstadoVacio, IconoPendiente } from '@restaurante/ui';
import { useLocation } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';

/**
 * `/salon/ordenes/:id`: la cuenta de la mesa. En T11 solo está el destino al que llevan abrir una mesa y
 * tocar una mesa ocupada; la cuenta completa (ítems, comandero y envío) es la tarea T16.
 */
export function OrdenPagina() {
  const ubicacion = useLocation();
  const estado = ubicacion.state as { mesaOcupada?: boolean } | null;
  return (
    <Pagina titulo="Cuenta de la mesa" atras={{ a: '/salon', etiqueta: 'Salón' }}>
      {estado?.mesaOcupada ? (
        <Aviso tipo="info" titulo="Otra persona acaba de abrir esta mesa">
          Te llevamos a su cuenta.
        </Aviso>
      ) : null}
      <EstadoVacio icono={IconoPendiente} titulo="La cuenta llega en la siguiente parte">
        Aquí verás lo que pidió la mesa y podrás agregar platos y enviarlos a cocina.
      </EstadoVacio>
    </Pagina>
  );
}
