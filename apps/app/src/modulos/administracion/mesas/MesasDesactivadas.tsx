import type { MesaRespuesta } from '@restaurante/contratos';
import { Boton, ContenidoDeFila, EtiquetaDeEstado, ListaDeFilas } from '@restaurante/ui';
import { TEXTO_DE_FORMA_DE_MESA } from '@restaurante/ui';

interface Props {
  mesas: readonly MesaRespuesta[];
  /** Id de la mesa que se está reactivando. */
  reactivando: string | null;
  onReactivar: (mesa: MesaRespuesta) => void;
}

const capitalizada = (texto: string) => texto.charAt(0).toLocaleUpperCase('es-PE') + texto.slice(1);

/** Mesas desactivadas de la zona: no ocupan celda en el dibujo y se pueden volver a activar. */
export function MesasDesactivadas({ mesas, reactivando, onReactivar }: Props) {
  if (mesas.length === 0) return null;
  return (
    <section className="mapa__desactivadas" aria-labelledby="mesas-desactivadas">
      <h3 className="formulario__titulo" id="mesas-desactivadas">
        Mesas desactivadas
      </h3>
      <p className="texto-ayuda">
        No aparecen en el salón ni ocupan una celda. Al reactivar una, vuelve a su celda si sigue
        libre.
      </p>
      <ListaDeFilas etiqueta="Mesas desactivadas">
        {mesas.map((mesa) => (
          <li key={mesa.id}>
            <div className="ui-fila ui-fila--apagada">
              <ContenidoDeFila
                titulo={mesa.nombre}
                apagada
                ayuda={`${mesa.capacidad} ${mesa.capacidad === 1 ? 'persona' : 'personas'} · ${capitalizada(TEXTO_DE_FORMA_DE_MESA[mesa.forma])}`}
                derecha={
                  <>
                    <EtiquetaDeEstado tono="neutro">Inactiva</EtiquetaDeEstado>
                    <Boton
                      onClick={() => onReactivar(mesa)}
                      cargando={reactivando === mesa.id}
                      textoCargando="Reactivando…"
                      disabled={reactivando !== null}
                      aria-label={`Reactivar la mesa ${mesa.nombre}`}
                    >
                      Reactivar
                    </Boton>
                  </>
                }
              />
            </div>
          </li>
        ))}
      </ListaDeFilas>
    </section>
  );
}
