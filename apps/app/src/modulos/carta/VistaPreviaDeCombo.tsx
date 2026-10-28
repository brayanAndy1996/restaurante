import type { GrupoRespuesta } from '@restaurante/contratos';
import { calcularLinea, type ErrorLinea } from '@restaurante/dominio';
import { Casilla, OpcionesConAyuda, type OpcionConAyuda } from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { montoComoTexto, montoEnSoles, montoEsCero } from '../../lib/formato';
import { CLAVES, listarGrupos } from './carta';
import type { GrupoDeProducto } from './producto-form';

/** Valor de la opción "Ninguna" de un grupo único y opcional. */
const NINGUNA = '__ninguna__';

interface Props {
  /** Precio del combo tal como se escribe en el formulario ("22.9"). */
  precio: string;
  /** Los grupos asignados al producto, en orden. */
  grupos: readonly GrupoDeProducto[];
}

/** "+ S/ 4.50" o "Sin recargo": el precio extra tal como lo guarda el grupo (no se suma aquí). */
function recargoDe(precioExtra: string): string {
  const monto = montoEnSoles(precioExtra);
  return monto === null || montoEsCero(precioExtra) ? 'Sin recargo' : `+ ${monto}`;
}

/** Lo que se elige al principio: las primeras opciones que exige el mínimo, para que el total sea válido. */
function eleccionInicial(grupo: GrupoRespuesta): string[] {
  return grupo.modificadores.slice(0, grupo.minimo).map((m) => m.id);
}

/** Un error de `calcularLinea` dicho en palabras ("Elige 1 en «Bebida»"). */
function frase(error: ErrorLinea, grupos: readonly GrupoRespuesta[]): string | null {
  if (error.codigo === 'MENOS_DEL_MINIMO' || error.codigo === 'MAS_DEL_MAXIMO') {
    const nombre = grupos.find((g) => g.id === error.grupoId)?.nombre ?? 'un grupo';
    if (error.codigo === 'MENOS_DEL_MINIMO') {
      return error.minimo === 1
        ? `Elige 1 en «${nombre}»`
        : `Elige al menos ${error.minimo} en «${nombre}»`;
    }
    return error.maximo === 1
      ? `Elige solo 1 en «${nombre}»`
      : `Elige como máximo ${error.maximo} en «${nombre}»`;
  }
  return null;
}

/**
 * Vista previa "Precio con estas opciones" (003, criterios 72 y 79): la persona que arma el combo elige
 * opciones como lo haría el cliente y ve el precio. El precio lo calcula `calcularLinea` de
 * `@restaurante/dominio` (la misma regla que usa la API al vender); aquí no se suma ningún monto. Lo
 * que se elige en la vista previa no se guarda.
 */
export function VistaPreviaDeCombo({ precio, grupos }: Props) {
  const idBase = useId();
  const consulta = useQuery({
    queryKey: CLAVES.grupos,
    queryFn: ({ signal }) => listarGrupos(signal),
  });
  const [elegido, setElegido] = useState<Record<string, string[]>>({});

  const porId = new Map((consulta.data ?? []).map((g) => [g.id, g]));
  const completos = grupos
    .map((g) => porId.get(g.id))
    .filter((g): g is GrupoRespuesta => g !== undefined && g.modificadores.length > 0);
  if (completos.length === 0) return null;

  const seleccion = (grupo: GrupoRespuesta): string[] => {
    const ids = new Set(grupo.modificadores.map((m) => m.id));
    return (elegido[grupo.id] ?? eleccionInicial(grupo)).filter((id) => ids.has(id));
  };
  const elegir = (grupo: GrupoRespuesta, ids: string[]) =>
    setElegido((previa) => ({ ...previa, [grupo.id]: ids }));

  const precioBase = montoComoTexto(precio);
  const resultado =
    precioBase === null
      ? null
      : calcularLinea(
          {
            precio: precioBase,
            grupos: completos.map((g) => ({
              id: g.id,
              minimo: g.minimo,
              maximo: g.maximo,
              modificadores: g.modificadores.map((m) => ({
                id: m.id,
                precioExtra: m.precioExtra,
                disponible: true,
              })),
            })),
          },
          completos.flatMap(seleccion),
          1,
        );
  const problemas =
    resultado && !resultado.valido
      ? resultado.errores.map((e) => frase(e, completos)).filter((f): f is string => f !== null)
      : [];

  return (
    <section className="seccion" aria-labelledby={`${idBase}-titulo`}>
      <h2 className="formulario__titulo" id={`${idBase}-titulo`}>
        Vista previa del precio
      </h2>
      <p className="texto-ayuda">
        Elige opciones como lo haría el cliente y mira cuánto pagaría. Es solo una prueba: no se
        guarda.
      </p>

      {completos.map((grupo) => {
        const actuales = seleccion(grupo);
        if (grupo.seleccion === 'UNICA') {
          const opciones: OpcionConAyuda<string>[] = [
            ...(grupo.minimo === 0
              ? [{ valor: NINGUNA, titulo: 'Ninguna', ayuda: 'No elegir nada de este grupo' }]
              : []),
            ...grupo.modificadores.map((m) => ({
              valor: m.id,
              titulo: m.nombre,
              ayuda: recargoDe(m.precioExtra),
            })),
          ];
          return (
            <OpcionesConAyuda
              key={grupo.id}
              etiqueta={grupo.nombre}
              opciones={opciones}
              valor={actuales[0] ?? (grupo.minimo === 0 ? NINGUNA : '')}
              onCambio={(valor) => elegir(grupo, valor === NINGUNA ? [] : [valor])}
            />
          );
        }
        return (
          <fieldset key={grupo.id} className="vista-previa__grupo">
            <legend className="ui-campo__etiqueta">{grupo.nombre}</legend>
            <div className="carta__casillas">
              {grupo.modificadores.map((m) => (
                <Casilla
                  key={m.id}
                  etiqueta={m.nombre}
                  ayuda={recargoDe(m.precioExtra)}
                  marcada={actuales.includes(m.id)}
                  onCambio={(marcada) =>
                    elegir(
                      grupo,
                      marcada ? [...actuales, m.id] : actuales.filter((id) => id !== m.id),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        );
      })}

      <div className="vista-previa__total" role="status">
        <span className="vista-previa__etiqueta">Precio con estas opciones</span>
        {resultado?.valido ? (
          <b className="vista-previa__monto">{montoEnSoles(resultado.precioUnitario)}</b>
        ) : (
          <span className="vista-previa__aviso">
            {precioBase === null
              ? 'Escribe el precio del producto para ver el total.'
              : problemas.length > 0
                ? problemas.join('. ')
                : 'Revisa las opciones elegidas.'}
          </span>
        )}
      </div>
    </section>
  );
}
