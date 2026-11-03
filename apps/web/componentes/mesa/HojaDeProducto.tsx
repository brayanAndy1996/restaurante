'use client';

import { useMemo, useState } from 'react';
import {
  CANTIDAD_MAXIMA_LLAMADO,
  LARGO_NOTA_LLAMADO,
  calcularLinea,
  precioEnSoles,
  precioEsCero,
  precioLeido,
} from '@restaurante/dominio';
import { srcSetDeFoto } from '@/lib/foto';
import type { LineaPedido, ProductoMesa } from '@/lib/pedido';
import { paraLinea } from '@/lib/reglas';
import { Icono } from '../Iconos';
import { Hoja } from './Hoja';
import { Monto } from './Monto';

type Grupo = ProductoMesa['grupos'][number];

/** La regla de un grupo en palabras: "Elige 1", "Elige hasta 2", "Elige de 1 a 3". */
export function reglaEnPalabras(grupo: Pick<Grupo, 'minimo' | 'maximo'>): string {
  const { minimo, maximo } = grupo;
  if (minimo === maximo) return `Elige ${maximo}`;
  if (minimo === 0) return maximo === 1 ? 'Elige 1 si quieres' : `Elige hasta ${maximo}`;
  return `Elige de ${minimo} a ${maximo}`;
}

interface Props {
  producto: ProductoMesa;
  /** Opciones que ya no están disponibles: no se ofrecen. */
  noDisponibles: ReadonlySet<string>;
  /** Presente al editar una línea del pedido. */
  linea?: LineaPedido;
  /** El pedido ya tiene 30 líneas distintas y esta sería nueva. */
  lleno: boolean;
  alGuardar: (linea: Omit<LineaPedido, 'clave'>) => void;
  alCerrar: () => void;
}

/**
 * Hoja del producto (criterio 84): un grupo por cada grupo de modificadores con su regla en palabras y validada con
 * `validarSeleccion` (vía `calcularLinea`), la cantidad de 1 a 20, las indicaciones (hasta 140) y el precio de la
 * línea, que calcula `packages/dominio`.
 */
export function HojaDeProducto({
  producto,
  noDisponibles,
  linea,
  lleno,
  alGuardar,
  alCerrar,
}: Props) {
  const grupos = useMemo(
    () =>
      producto.grupos.map((g) => ({
        ...g,
        modificadores: g.modificadores.filter((m) => !noDisponibles.has(m.id)),
      })),
    [producto, noDisponibles],
  );
  const visibles = useMemo(
    () => new Set(grupos.flatMap((g) => g.modificadores.map((m) => m.id))),
    [grupos],
  );
  const [elegidos, setElegidos] = useState<string[]>(() =>
    (linea?.modificadorIds ?? []).filter((id) => visibles.has(id)),
  );
  const [cantidad, setCantidad] = useState(linea?.cantidad ?? 1);
  const [observacion, setObservacion] = useState(linea?.observacion ?? '');

  const resultado = calcularLinea(paraLinea({ ...producto, grupos }), elegidos, cantidad);
  const faltan = grupos.filter((g) => {
    const n = g.modificadores.filter((m) => elegidos.includes(m.id)).length;
    return n < g.minimo;
  });
  const sinLugar = lleno && !linea;
  const puedeGuardar = resultado.valido && !sinLugar;
  const motivo = sinLugar
    ? 'Tu pedido ya tiene 30 platos distintos. Quita uno para agregar otro.'
    : faltan[0]
      ? `Falta elegir: ${faltan[0].nombre}`
      : null;

  function elegir(grupo: (typeof grupos)[number], id: string | null, marcada: boolean) {
    const delGrupo = new Set(grupo.modificadores.map((m) => m.id));
    const resto = elegidos.filter((e) => !delGrupo.has(e));
    if (grupo.seleccion === 'UNICA') {
      setElegidos(id === null ? resto : [...resto, id]);
    } else {
      setElegidos(marcada && id ? [...elegidos, id] : elegidos.filter((e) => e !== id));
    }
  }

  const foto = producto.fotoUrl ? srcSetDeFoto(producto.fotoUrl) : null;
  return (
    <Hoja
      idTitulo="t-producto"
      titulo={producto.nombre}
      subtitulo={<Monto valor={producto.precio} />}
      antesDelTitulo={
        foto ? (
          <div className="foto foto--hoja">
            <img src={foto.src} srcSet={foto.srcSet} width={72} height={72} alt="" />
          </div>
        ) : undefined
      }
      alCerrar={alCerrar}
      pie={
        <>
          {motivo ? (
            <p className="hoja__ayuda" role="status">
              {motivo}
            </p>
          ) : null}
          <button
            type="button"
            className="boton-principal"
            aria-disabled={!puedeGuardar}
            onClick={() => {
              if (!puedeGuardar) return;
              alGuardar({
                productoId: producto.id,
                modificadorIds: elegidos,
                cantidad,
                observacion: observacion.trim(),
              });
            }}
          >
            <span>{linea ? 'Guardar cambios' : 'Agregar al pedido'}</span>
            {resultado.valido ? (
              <span>
                <Monto valor={resultado.total} />
              </span>
            ) : null}
          </button>
        </>
      }
    >
      {producto.descripcion ? <p>{producto.descripcion}</p> : null}

      {grupos.map((grupo) => {
        const elegidosDelGrupo = grupo.modificadores.filter((m) => elegidos.includes(m.id)).length;
        const unica = grupo.seleccion === 'UNICA';
        return (
          <fieldset className="grupo" key={grupo.id}>
            <legend>{grupo.nombre}</legend>
            <p className="grupo__regla">
              <span className="etiqueta etiqueta--neutra">
                {grupo.obligatorio ? 'Obligatorio' : 'Opcional'}
              </span>
              <span>{reglaEnPalabras(grupo)}</span>
            </p>
            <div className="lista-opciones">
              {unica && grupo.minimo === 0 ? (
                <label className="opcion">
                  <input
                    type="radio"
                    name={grupo.id}
                    checked={elegidosDelGrupo === 0}
                    onChange={() => elegir(grupo, null, true)}
                  />
                  <span>Ninguna</span>
                  <span />
                </label>
              ) : null}
              {grupo.modificadores.map((m) => {
                const marcada = elegidos.includes(m.id);
                const lleno = !unica && !marcada && elegidosDelGrupo >= grupo.maximo;
                return (
                  <label className="opcion" key={m.id} data-apagada={lleno ? '' : undefined}>
                    <input
                      type={unica ? 'radio' : 'checkbox'}
                      name={grupo.id}
                      checked={marcada}
                      disabled={lleno}
                      onChange={(e) => elegir(grupo, m.id, e.target.checked)}
                    />
                    <span>{m.nombre}</span>
                    {precioEsCero(m.precioExtra) ? (
                      <span />
                    ) : (
                      <span className="opcion__extra">
                        <span aria-hidden="true">+ {precioEnSoles(m.precioExtra)}</span>
                        <span className="sr">más {precioLeido(m.precioExtra)}</span>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="cantidad">
        <span className="campo__etiqueta" id="e-cantidad">
          Cantidad
        </span>
        <div className="contador" role="group" aria-labelledby="e-cantidad">
          <button
            type="button"
            className="boton-icono"
            aria-label="Quitar uno"
            aria-disabled={cantidad <= 1}
            onClick={() => setCantidad((c) => Math.max(1, c - 1))}
          >
            <Icono nombre="menos" />
          </button>
          <output aria-live="polite">{cantidad}</output>
          <button
            type="button"
            className="boton-icono"
            aria-label="Agregar uno"
            aria-disabled={cantidad >= CANTIDAD_MAXIMA_LLAMADO}
            onClick={() => setCantidad((c) => Math.min(CANTIDAD_MAXIMA_LLAMADO, c + 1))}
          >
            <Icono nombre="mas" />
          </button>
        </div>
      </div>

      <div className="campo">
        <label htmlFor="obs-producto">Indicaciones para la cocina (opcional)</label>
        <textarea
          id="obs-producto"
          rows={2}
          maxLength={LARGO_NOTA_LLAMADO}
          placeholder="Por ejemplo: sin cebolla"
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
        />
        <p className="campo__contador">
          {observacion.length} de {LARGO_NOTA_LLAMADO}
        </p>
      </div>
    </Hoja>
  );
}
