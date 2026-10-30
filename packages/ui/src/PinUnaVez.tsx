import { useState } from 'react';
import { Aviso } from './Aviso';
import { Boton } from './Boton';
import { IconoCopiar, IconoOk } from './iconos';
import { copiarTexto } from './utilidades';

interface PropsPinUnaVez {
  /** Persona a la que pertenece el PIN. */
  nombre: string;
  pin: string;
  /** Se llama al tocar "Ya lo anoté": el PIN deja de estar en pantalla. */
  onListo: () => void;
  /** Qué hacer con el PIN; por defecto, entregarlo en persona. */
  recomendacion?: string;
}

/**
 * PIN mostrado una sola vez: baldosa con borde de tinta, cifras de 44 px y espacio entre dígitos,
 * "Copiar PIN" y el botón principal "Ya lo anoté". No se puede volver a ver: la pantalla se vacía al
 * salir, y el componente no guarda el PIN en ningún almacenamiento.
 */
export function PinUnaVez({ nombre, pin, onListo, recomendacion }: PropsPinUnaVez) {
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  return (
    <>
      <div className="ui-pin-una-vez">
        <span className="ui-pin-una-vez__quien">{`PIN de ${nombre}`}</span>
        <span className="ui-pin-una-vez__numero" aria-label={`PIN: ${pin.split('').join(' ')}`}>
          {pin}
        </span>
        <span className="ui-pin-una-vez__nota">Se muestra una sola vez</span>
      </div>
      <Aviso tipo="alerta">
        {recomendacion ??
          'Anótalo y entrégaselo en persona. Si sales sin anotarlo, tendrás que generar uno nuevo.'}
      </Aviso>
      <div role="status" className="ui-solo-lectores">
        {copiado === 'si' ? 'PIN copiado' : ''}
      </div>
      {copiado === 'no' ? <Aviso tipo="info">No pudimos copiarlo. Anótalo a mano.</Aviso> : null}
      <Boton
        bloque
        icono={copiado === 'si' ? IconoOk : IconoCopiar}
        onClick={async () => setCopiado((await copiarTexto(pin)) ? 'si' : 'no')}
      >
        {copiado === 'si' ? 'PIN copiado' : 'Copiar PIN'}
      </Boton>
      <Boton variante="principal" bloque onClick={onListo}>
        Ya lo anoté
      </Boton>
    </>
  );
}
