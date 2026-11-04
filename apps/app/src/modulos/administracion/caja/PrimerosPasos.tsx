import { EtiquetaDeEstado, Icono, IconoOk, IconoPendiente } from '@restaurante/ui';
import type { ReactNode } from 'react';
import type { PasoDeInicio } from './cajas';

interface Props {
  pasos: readonly PasoDeInicio[];
  /** Una acción por paso que falta (un botón o un enlace que lleva a hacerlo). */
  accion?: (paso: PasoDeInicio) => ReactNode;
}

/**
 * Primeros pasos para cobrar (pregunta 19 de 006): "Para cobrar falta: crear una caja, sus series y la tasa de
 * IGV". Cada paso dice con palabras si está hecho o falta, y lo que falta lleva su acción. Cuando no falta nada,
 * no dibuja nada.
 */
export function PrimerosPasos({ pasos, accion }: Props) {
  const faltan = pasos.filter((p) => !p.hecho);
  if (faltan.length === 0) return null;
  return (
    <section className="caja__inicio" aria-labelledby="caja-inicio-titulo">
      <h3 className="caja__inicio-titulo" id="caja-inicio-titulo">
        Para cobrar falta {faltan.length === 1 ? 'un paso' : 'configurar lo siguiente'}
      </h3>
      <ul className="caja__pasos">
        {pasos.map((paso) => (
          <li key={paso.id} className="caja__paso">
            <span className="caja__paso-icono" aria-hidden="true">
              <Icono icono={paso.hecho ? IconoOk : IconoPendiente} tamano={20} />
            </span>
            <span
              className={
                paso.hecho ? 'caja__paso-texto caja__paso-texto--hecho' : 'caja__paso-texto'
              }
            >
              {paso.texto}
            </span>
            <span className="caja__paso-estado">
              {paso.hecho ? (
                <EtiquetaDeEstado tono="ok">Hecho</EtiquetaDeEstado>
              ) : (
                <EtiquetaDeEstado tono="alerta">Falta</EtiquetaDeEstado>
              )}
            </span>
            {!paso.hecho && accion ? (
              <span className="caja__paso-accion">{accion(paso)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
