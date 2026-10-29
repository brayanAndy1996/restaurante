import type { EstadoMesa, FormaMesa } from '@restaurante/dominio';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { BaldosaDeMesa } from './BaldosaDeMesa';
import { Icono, IconoMas } from './iconos';
import { clases } from './utilidades';

/** Una mesa dibujada en la cuadrícula; `columna` y `fila` cuentan desde 1. */
export interface MesaDeCuadricula {
  id: string;
  nombre: string;
  capacidad: number;
  forma: FormaMesa;
  columna: number;
  fila: number;
  /** Estado en el salón; el editor del mapa no lo usa. */
  estado?: EstadoMesa;
  detalle?: string;
  /** Las otras mesas de la misma cuenta ("5, 6"): la baldosa dice "Grupo con 5, 6" y lleva un eslabón. */
  grupo?: string;
  /**
   * Por qué esta mesa no se puede elegir ahora (modo selección de mover y unir): "Ocupada: para juntar
   * cuentas usa Unir". La baldosa se ve apagada, no se toca y la etiqueta accesible dice el motivo.
   */
  noElegible?: string;
}

export interface CeldaDeCuadricula {
  columna: number;
  fila: number;
}

interface PropsCuadricula {
  /** Nombre de la cuadrícula para los lectores de pantalla ("Mesas de Salón principal"). */
  etiqueta: string;
  columnas: number;
  filas: number;
  mesas: readonly MesaDeCuadricula[];
  /** Lado de cada celda en px: 64 o más en el salón (por defecto 72); nunca menos de 48. */
  tamanoCelda?: number;
  mesaElegidaId?: string | null;
  /** Varias mesas elegidas a la vez (unir mesas); se suman a `mesaElegidaId`. */
  mesasElegidasIds?: readonly string[];
  onElegirMesa?: (id: string) => void;
  /** Celda vacía elegida (el editor está creando una mesa ahí). */
  celdaElegida?: CeldaDeCuadricula | null;
  /** Si se pasa, las celdas vacías se pueden tocar (editor del mapa); si no, son solo espacio. */
  onElegirCelda?: (columna: number, fila: number) => void;
  /** Texto que dice cuántas columnas hay fuera de la vista; por defecto, una indicación de deslizar. */
  pistaDeDesplazamiento?: string;
  className?: string;
}

const LADO_MINIMO = 48;

/**
 * Cuadrícula de mesas (el mapa del salón y el editor del mapa). Cada celda mide `tamanoCelda` px y
 * se toca con el dedo; las celdas se separan por juntas de 4 px, como una pared de azulejos. Si
 * las columnas no caben a lo ancho, solo la cuadrícula se desplaza (la página no): una indicación
 * lo dice en palabras.
 *
 * Teclado y lectores de pantalla: es una sola parada del tabulador (foco itinerante); las flechas
 * mueven el foco entre celdas, `Inicio` y `Fin` van al principio y al final de la fila, y Enter o
 * espacio tocan la celda. Cada mesa dice su nombre, capacidad, forma y estado en la etiqueta.
 */
export function CuadriculaDeMesas({
  etiqueta,
  columnas,
  filas,
  mesas,
  tamanoCelda = 72,
  mesaElegidaId,
  mesasElegidasIds,
  onElegirMesa,
  celdaElegida,
  onElegirCelda,
  pistaDeDesplazamiento = 'Desliza la cuadrícula para ver el resto de las columnas.',
  className,
}: PropsCuadricula) {
  const lado = Math.max(tamanoCelda, LADO_MINIMO);
  const raiz = useRef<HTMLDivElement>(null);
  const [desborda, setDesborda] = useState(false);

  const mesaEn = new Map(mesas.map((m) => [`${m.columna}:${m.fila}`, m]));
  const mesaElegida = mesas.find(
    (m) => m.id === mesaElegidaId || mesasElegidasIds?.includes(m.id) === true,
  );
  const estaElegida = (id: string) =>
    id === mesaElegidaId || mesasElegidasIds?.includes(id) === true;
  const hayAcciones = onElegirMesa !== undefined || onElegirCelda !== undefined;

  // Celda que recibe el Tab: la elegida; si no, la primera mesa que se pueda tocar; si no, la primera celda.
  const primeraElegible = mesas.find((m) => !m.noElegible) ?? mesas[0];
  const porDefecto: CeldaDeCuadricula = mesaElegida
    ? { columna: mesaElegida.columna, fila: mesaElegida.fila }
    : (celdaElegida ??
      (primeraElegible && !onElegirCelda
        ? { columna: primeraElegible.columna, fila: primeraElegible.fila }
        : { columna: 1, fila: 1 }));
  const [foco, setFoco] = useState<CeldaDeCuadricula | null>(null);
  const celdaDeFoco = foco ?? porDefecto;
  // Si la celda con foco ya no existe (se achicó la cuadrícula) o dejó de ser tocable, vuelve a la de por defecto.
  const tocable = (columna: number, fila: number) =>
    columna >= 1 &&
    columna <= columnas &&
    fila >= 1 &&
    fila <= filas &&
    (mesaEn.has(`${columna}:${fila}`)
      ? onElegirMesa !== undefined && !mesaEn.get(`${columna}:${fila}`)?.noElegible
      : onElegirCelda !== undefined);
  const celdaConTab = tocable(celdaDeFoco.columna, celdaDeFoco.fila)
    ? celdaDeFoco
    : (primeraTocable() ?? celdaDeFoco);

  function primeraTocable(): CeldaDeCuadricula | null {
    for (let f = 1; f <= filas; f++) {
      for (let c = 1; c <= columnas; c++) if (tocable(c, f)) return { columna: c, fila: f };
    }
    return null;
  }

  const medir = useCallback(() => {
    const elemento = raiz.current;
    if (elemento) setDesborda(elemento.scrollWidth > elemento.clientWidth + 1);
  }, []);
  useEffect(() => {
    medir();
    const elemento = raiz.current;
    if (!elemento || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [medir, columnas, lado]);

  function irA(columna: number, fila: number) {
    setFoco({ columna, fila });
    raiz.current
      ?.querySelector<HTMLElement>(`[data-columna="${columna}"][data-fila="${fila}"]`)
      ?.focus();
  }

  function alEnfocar(evento: FocusEvent<HTMLDivElement>) {
    const { columna, fila } = (evento.target as HTMLElement).dataset;
    if (columna && fila) setFoco({ columna: Number(columna), fila: Number(fila) });
  }

  function alPulsar(evento: KeyboardEvent<HTMLDivElement>) {
    const paso: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const origen = celdaConTab;
    if (evento.key === 'Home' || evento.key === 'End') {
      const columnaFinal = evento.key === 'Home' ? 1 : columnas;
      const sentido = evento.key === 'Home' ? 1 : -1;
      for (let c = columnaFinal; c >= 1 && c <= columnas; c += sentido) {
        if (tocable(c, origen.fila)) {
          evento.preventDefault();
          return irA(c, origen.fila);
        }
      }
      return;
    }
    const delta = paso[evento.key];
    if (!delta) return;
    evento.preventDefault();
    // Sigue en esa dirección hasta la siguiente celda tocable (en el salón, las vacías se saltan).
    let c = origen.columna + delta[0];
    let f = origen.fila + delta[1];
    while (c >= 1 && c <= columnas && f >= 1 && f <= filas) {
      if (tocable(c, f)) return irA(c, f);
      c += delta[0];
      f += delta[1];
    }
  }

  const estilo = { '--celda-mesa': `${lado}px` } as CSSProperties;
  const lista = Array.from({ length: filas }, (_, i) => i + 1);
  const columnasLista = Array.from({ length: columnas }, (_, i) => i + 1);

  return (
    <div className={clases('ui-cuadricula-marco', className)}>
      {/* El foco lo tienen las celdas (foco itinerante); la cuadrícula solo recibe sus teclas por burbujeo. */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        ref={raiz}
        className="ui-cuadricula"
        style={estilo}
        role="grid"
        aria-label={etiqueta}
        aria-rowcount={filas}
        aria-colcount={columnas}
        onKeyDown={hayAcciones ? alPulsar : undefined}
        onFocus={hayAcciones ? alEnfocar : undefined}
      >
        <div className="ui-cuadricula__rejilla">
          {lista.map((fila) => (
            <div className="ui-cuadricula__fila" role="row" aria-rowindex={fila} key={fila}>
              {columnasLista.map((columna) => {
                const mesa = mesaEn.get(`${columna}:${fila}`);
                const conTab = celdaConTab.columna === columna && celdaConTab.fila === fila;
                const datos = { 'data-columna': columna, 'data-fila': fila } as const;
                if (mesa) {
                  return (
                    <div
                      className="ui-cuadricula__celda"
                      role="gridcell"
                      aria-colindex={columna}
                      key={columna}
                    >
                      <BaldosaDeMesa
                        nombre={mesa.nombre}
                        capacidad={mesa.capacidad}
                        forma={mesa.forma}
                        {...(mesa.estado ? { estado: mesa.estado } : {})}
                        {...(mesa.detalle ? { detalle: mesa.detalle } : {})}
                        {...(mesa.grupo ? { grupo: mesa.grupo } : {})}
                        {...(mesa.noElegible ? { noElegible: mesa.noElegible } : {})}
                        {...(onElegirMesa && !mesa.noElegible
                          ? {
                              onClick: () => onElegirMesa(mesa.id),
                              elegida: estaElegida(mesa.id),
                              tabIndex: conTab ? 0 : -1,
                            }
                          : {})}
                        datos={datos}
                      />
                    </div>
                  );
                }
                const elegida =
                  celdaElegida?.columna === columna && celdaElegida.fila === fila && !mesaElegida;
                return (
                  <div
                    className="ui-cuadricula__celda"
                    role="gridcell"
                    aria-colindex={columna}
                    key={columna}
                  >
                    {onElegirCelda ? (
                      <button
                        type="button"
                        className={clases('ui-celda-vacia', elegida && 'ui-celda-vacia--elegida')}
                        aria-label={`Celda libre, columna ${columna}, fila ${fila}`}
                        aria-pressed={elegida}
                        tabIndex={conTab ? 0 : -1}
                        onClick={() => onElegirCelda(columna, fila)}
                        {...datos}
                      >
                        <Icono icono={IconoMas} tamano={20} />
                      </button>
                    ) : (
                      <span className="ui-celda-vacia ui-celda-vacia--quieta" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {desborda ? <p className="ui-cuadricula__pista">{pistaDeDesplazamiento}</p> : null}
    </div>
  );
}
