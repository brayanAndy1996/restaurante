import type { ZonaRespuesta } from '@restaurante/contratos';
import { ContenidoDeFila, EtiquetaDeEstado, FilaOrdenable } from '@restaurante/ui';
import { mesasActivas, pluralMesas } from './mesas';

interface Props {
  zonas: readonly ZonaRespuesta[];
  onSubir: (indice: number) => void;
  onBajar: (indice: number) => void;
  /** Anuncio para lectores de pantalla ("Terraza: posición 1 de 3"). */
  anuncio: string;
}

/** Orden de las zonas con subir y bajar de 48 px: es el orden en que las ve el mozo en el salón. */
export function OrdenDeZonas({ zonas, onSubir, onBajar, anuncio }: Props) {
  return (
    <div className="mapa__panel">
      <p className="texto-ayuda">
        Toca las flechas para subir o bajar. Así se verán las zonas en el salón.
      </p>
      <span className="ui-solo-lectores" role="status" aria-live="polite">
        {anuncio}
      </span>
      <ul className="ui-lista" aria-label="Ordenar las zonas">
        {zonas.map((zona, i) => (
          <FilaOrdenable
            key={zona.id}
            nombre={zona.nombre}
            posicion={i + 1}
            total={zonas.length}
            apagada={!zona.activa}
            onSubir={() => onSubir(i)}
            onBajar={() => onBajar(i)}
          >
            <div className="ui-fila">
              <ContenidoDeFila
                titulo={zona.nombre}
                apagada={!zona.activa}
                ayuda={pluralMesas(mesasActivas(zona).length)}
                derecha={
                  zona.activa ? undefined : (
                    <EtiquetaDeEstado tono="neutro">Inactiva</EtiquetaDeEstado>
                  )
                }
              />
            </div>
          </FilaOrdenable>
        ))}
      </ul>
    </div>
  );
}
