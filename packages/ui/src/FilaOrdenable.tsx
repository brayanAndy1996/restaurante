import type { ReactNode } from 'react';
import { BotonIcono } from './Boton';
import { IconoBajar, IconoSubir } from './iconos';
import { clases } from './utilidades';

interface PropsFilaOrdenable {
  /** Nombre de lo que se mueve, para los lectores de pantalla ("Subir Entradas"). */
  nombre: string;
  /** Posición actual, desde 1, y total de filas: deciden qué botones no hacen nada. */
  posicion: number;
  total: number;
  onSubir: () => void;
  onBajar: () => void;
  apagada?: boolean;
  children: ReactNode;
}

/**
 * Fila para ordenar sin arrastrar: el contenido a la izquierda y, a la derecha, "subir" y "bajar" de
 * 48 px. En el extremo, el botón que no mueve nada queda marcado con `aria-disabled` y no con
 * `disabled`, para que el foco no se pierda al llegar arriba o abajo.
 */
export function FilaOrdenable({
  nombre,
  posicion,
  total,
  onSubir,
  onBajar,
  apagada,
  children,
}: PropsFilaOrdenable) {
  const arriba = posicion <= 1;
  const abajo = posicion >= total;
  return (
    <li className={clases('ui-ordenable', apagada && 'ui-ordenable--apagada')}>
      <div className="ui-ordenable__contenido">{children}</div>
      <div className="ui-ordenable__botones">
        <BotonIcono
          icono={IconoSubir}
          etiqueta={`Subir ${nombre}`}
          aria-disabled={arriba || undefined}
          onClick={() => {
            if (!arriba) onSubir();
          }}
        />
        <BotonIcono
          icono={IconoBajar}
          etiqueta={`Bajar ${nombre}`}
          aria-disabled={abajo || undefined}
          onClick={() => {
            if (!abajo) onBajar();
          }}
        />
      </div>
    </li>
  );
}

/** Mueve el elemento de `desde` a `hacia` en una copia de la lista (el orden manual de la carta). */
export function moverEnLista<T>(lista: readonly T[], desde: number, hacia: number): T[] {
  if (desde === hacia || desde < 0 || hacia < 0 || desde >= lista.length || hacia >= lista.length) {
    return [...lista];
  }
  const copia = [...lista];
  const [elemento] = copia.splice(desde, 1);
  copia.splice(hacia, 0, elemento as T);
  return copia;
}
