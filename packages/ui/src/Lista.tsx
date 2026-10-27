import type { ReactNode } from 'react';
import { Inicial } from './Persona';
import { clases, CONSULTA_TABLET, useCoincide } from './utilidades';

/** Clase de una fila de lista: para usarla en un `<Link>` o `<button>` del router. */
export function claseFila(apagada?: boolean): string {
  return clases('ui-fila', apagada && 'ui-fila--apagada');
}

interface PropsContenidoFila {
  /** Nombre cuya inicial se muestra a la izquierda; sin él, la fila no lleva inicial. */
  inicial?: string;
  apagada?: boolean;
  titulo: ReactNode;
  ayuda?: ReactNode;
  /** Etiqueta de estado o flecha a la derecha. */
  derecha?: ReactNode;
  /** Segunda línea a todo el ancho (por ejemplo, las etiquetas de cada sucursal). */
  extra?: ReactNode;
}

/** Interior de una fila de 72 px: inicial, título, segunda línea de ayuda y un estado a la derecha. */
export function ContenidoDeFila({
  inicial,
  apagada,
  titulo,
  ayuda,
  derecha,
  extra,
}: PropsContenidoFila) {
  return (
    <>
      {inicial ? <Inicial nombre={inicial} apagada={apagada} /> : null}
      <span className="ui-fila__texto">
        <span className="ui-fila__titulo">{titulo}</span>
        {ayuda ? <span className="ui-fila__ayuda">{ayuda}</span> : null}
      </span>
      {derecha ? <span className="ui-fila__derecha">{derecha}</span> : null}
      {extra ? <span className="ui-fila__extra">{extra}</span> : null}
    </>
  );
}

/** Contenedor de filas separadas por juntas. */
export function ListaDeFilas({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  return (
    <ul className="ui-lista" aria-label={etiqueta}>
      {children}
    </ul>
  );
}

export interface ColumnaDeTabla<T> {
  id: string;
  encabezado: ReactNode;
  celda: (fila: T) => ReactNode;
  /** Cifras y fechas se alinean a la derecha. */
  alinear?: 'derecha';
  /** El encabezado solo lo oyen los lectores (columna de acciones). */
  encabezadoOculto?: boolean;
  /** Cifras, fechas y botones no se parten en dos líneas. */
  sinSaltos?: boolean;
}

interface PropsTabla<T> {
  /** Nombre de la tabla para los lectores de pantalla. */
  etiqueta: string;
  filas: T[];
  columnas: ColumnaDeTabla<T>[];
  clave: (fila: T) => string;
  /** Cómo se dibuja cada fila en celular (normalmente un `ContenidoDeFila` dentro de un enlace). */
  filaEnLista: (fila: T) => ReactNode;
  apagada?: (fila: T) => boolean;
}

/**
 * Tabla que se vuelve lista: en celular cada fila es una baldosa de 72 px y nunca hay desplazamiento
 * horizontal; desde 768 px es una tabla con encabezados, cifras a la derecha y acciones al final.
 */
export function TablaResponsiva<T>({
  etiqueta,
  filas,
  columnas,
  clave,
  filaEnLista,
  apagada,
}: PropsTabla<T>) {
  const ancha = useCoincide(CONSULTA_TABLET);
  if (!ancha) {
    return (
      <ListaDeFilas etiqueta={etiqueta}>
        {filas.map((fila) => (
          <li key={clave(fila)}>{filaEnLista(fila)}</li>
        ))}
      </ListaDeFilas>
    );
  }
  return (
    <div className="ui-tabla-envoltorio">
      <table className="ui-tabla" aria-label={etiqueta}>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={clases(
                  c.alinear === 'derecha' && 'ui-tabla__derecha',
                  c.sinSaltos && 'ui-tabla__sin-saltos',
                )}
              >
                {c.encabezadoOculto ? (
                  <span className="ui-solo-lectores">{c.encabezado}</span>
                ) : (
                  c.encabezado
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={clave(fila)} className={clases(apagada?.(fila) && 'ui-tabla__apagada')}>
              {columnas.map((c) => (
                <td
                  key={c.id}
                  className={clases(
                    c.alinear === 'derecha' && 'ui-tabla__derecha',
                    c.sinSaltos && 'ui-tabla__sin-saltos',
                  )}
                >
                  {c.celda(fila)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
