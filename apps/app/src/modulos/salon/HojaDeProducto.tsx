import type { ProductoDeVenta } from '@restaurante/contratos';
import { CANTIDAD_MAXIMA_LINEA } from '@restaurante/dominio';
import {
  Boton,
  Casilla,
  CampoTexto,
  Hoja,
  Icono,
  IconoAlerta,
  OpcionesConAyuda,
  Segmentos,
  SelectorDeCantidad,
  type OpcionConAyuda,
} from '@restaurante/ui';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { montoEnSoles } from '../../lib/monto';
import type { LineaBorrador } from './borrador';
import {
  LARGO_OBSERVACION,
  calcularDeProducto,
  erroresPorGrupo,
  fraseDeError,
  incluyeDelProducto,
  recargoDeOpcion,
  reglaDelGrupo,
  type GrupoDeProducto,
  type SeleccionPorGrupo,
} from './comandero';
import './comandero.css';

/** Valor de la opción "Ninguna" de un grupo de una sola opción y opcional. */
const NINGUNA = '__ninguna__';

interface Props {
  /** El producto que se está armando; `null` con la hoja cerrada. */
  producto: ProductoDeVenta | null;
  /** La línea del borrador que se edita; `null` si se agrega una nueva. */
  linea: LineaBorrador | null;
  onGuardar: (linea: LineaBorrador) => void;
  onCerrar: () => void;
}

/**
 * Hoja de un producto (criterio 91 de 004): sus grupos de modificadores con la regla en palabras (mínimo,
 * máximo, obligatorio) y la validación de `validarSeleccion`, la cantidad, la observación (hasta 140), el
 * tiempo de servicio 1 o 2 y "Para llevar". El precio de la línea sale de `calcularLinea` de
 * `packages/dominio`; aquí no se suma ningún monto. Sirve para agregar y para editar una línea del borrador.
 */
export function HojaDeProducto({ producto, linea, onGuardar, onCerrar }: Props) {
  return (
    <Hoja
      abierta={producto !== null}
      onCerrar={onCerrar}
      titulo={producto?.nombre ?? 'Producto'}
      className="hoja-producto"
    >
      {producto ? (
        <FormularioDeProducto
          key={linea?.clave ?? producto.id}
          producto={producto}
          linea={linea}
          onGuardar={onGuardar}
        />
      ) : null}
    </Hoja>
  );
}

/** La selección con que se abre la hoja: la de la línea que se edita, sin las opciones que ya no se pueden elegir. */
function seleccionInicial(
  producto: ProductoDeVenta,
  linea: LineaBorrador | null,
): SeleccionPorGrupo {
  if (!linea) return {};
  const elegidos = new Set(linea.modificadores.map((m) => m.id));
  const seleccion: SeleccionPorGrupo = {};
  for (const grupo of producto.grupos) {
    const ids = grupo.modificadores
      .filter((m) => elegidos.has(m.id) && m.disponible)
      .map((m) => m.id);
    if (ids.length > 0) seleccion[grupo.id] = ids;
  }
  return seleccion;
}

function FormularioDeProducto({
  producto,
  linea,
  onGuardar,
}: {
  producto: ProductoDeVenta;
  linea: LineaBorrador | null;
  onGuardar: (linea: LineaBorrador) => void;
}) {
  const idBase = useId();
  const [seleccion, setSeleccion] = useState<SeleccionPorGrupo>(() =>
    seleccionInicial(producto, linea),
  );
  const [cantidad, setCantidad] = useState(linea?.cantidad ?? 1);
  const [observacion, setObservacion] = useState(linea?.observacion ?? '');
  const [tiempo, setTiempo] = useState<1 | 2>(linea?.tiempo ?? 1);
  const [paraLlevar, setParaLlevar] = useState(linea?.paraLlevar ?? false);
  const [intentado, setIntentado] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);

  const resultado = useMemo(
    () => calcularDeProducto(producto, seleccion, cantidad),
    [producto, seleccion, cantidad],
  );
  const errores = intentado ? erroresPorGrupo(producto, resultado) : {};
  const hayErrores = Object.keys(errores).length > 0;

  // Al intentar agregar con una regla sin cumplir, la hoja lleva al primer grupo marcado.
  useEffect(() => {
    if (!hayErrores) return;
    formulario.current
      ?.querySelector<HTMLElement>('[data-grupo-error="true"]')
      ?.scrollIntoView?.({ block: 'center' });
  }, [hayErrores, intentado]);

  function elegir(grupo: GrupoDeProducto, ids: string[]) {
    setSeleccion((previa) => ({ ...previa, [grupo.id]: ids }));
  }

  function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!resultado.valido) {
      setIntentado(true);
      return;
    }
    const nombres = new Map(
      producto.grupos.flatMap((g) => g.modificadores.map((m) => [m.id, m.nombre] as const)),
    );
    onGuardar({
      clave: linea?.clave ?? nuevaClaveDeIdempotencia(),
      productoId: producto.id,
      nombre: producto.nombre,
      modificadores: resultado.modificadores.map((m) => ({
        id: m.id,
        nombre: nombres.get(m.id) ?? 'Opción',
        precioExtra: m.precioExtra,
      })),
      cantidad,
      observacion: observacion.trim(),
      tiempo,
      paraLlevar,
      precioUnitario: resultado.precioUnitario,
    });
  }

  const incluye = incluyeDelProducto(producto);
  const sinPrecio =
    !resultado.valido && resultado.errores.some((e) => e.codigo === 'PRODUCTO_SIN_PRECIO');
  const faltas =
    intentado && !resultado.valido
      ? resultado.errores
          .map((e) => fraseDeError(e, producto))
          .filter((f): f is string => f !== null)
      : [];

  return (
    <form className="hoja-producto__formulario" onSubmit={guardar} noValidate ref={formulario}>
      {producto.descripcion || incluye ? (
        <p className="hoja-producto__detalle">
          {producto.descripcion}
          {producto.descripcion && incluye ? ' ' : null}
          {incluye}
        </p>
      ) : null}

      {producto.grupos.map((grupo) =>
        grupo.maximo === 1 ? (
          <GrupoDeUnaOpcion
            key={grupo.id}
            grupo={grupo}
            elegido={seleccion[grupo.id]?.[0] ?? null}
            error={errores[grupo.id]}
            onElegir={(id) => elegir(grupo, id === null ? [] : [id])}
          />
        ) : (
          <GrupoDeVariasOpciones
            key={grupo.id}
            grupo={grupo}
            elegidos={seleccion[grupo.id] ?? []}
            error={errores[grupo.id]}
            onCambio={(ids) => elegir(grupo, ids)}
          />
        ),
      )}

      <div className="hoja-producto__fila">
        <span className="ui-campo__etiqueta">Cantidad</span>
        <SelectorDeCantidad
          nombre={producto.nombre}
          valor={cantidad}
          maximo={CANTIDAD_MAXIMA_LINEA}
          onCambio={setCantidad}
        />
      </div>

      <section className="hoja-producto__bloque" aria-labelledby={`${idBase}-tiempo`}>
        <h3 className="ui-campo__etiqueta" id={`${idBase}-tiempo`}>
          Tiempo de servicio
        </h3>
        <Segmentos
          etiqueta="Tiempo de servicio"
          opciones={[
            { valor: '1', etiqueta: 'Tiempo 1' },
            { valor: '2', etiqueta: 'Tiempo 2' },
          ]}
          valor={String(tiempo)}
          onCambio={(v) => setTiempo(v === '2' ? 2 : 1)}
        />
        <p className="ui-campo__ayuda">
          {tiempo === 2
            ? 'Cocina lo recibe como «Esperar» hasta que marches.'
            : 'Cocina lo prepara apenas lo recibe.'}
        </p>
      </section>

      <Casilla
        etiqueta="Para llevar"
        ayuda="Sale empacado"
        marcada={paraLlevar}
        onCambio={setParaLlevar}
      />

      <CampoTexto
        etiqueta="Observación"
        opcional
        value={observacion}
        maxLength={LARGO_OBSERVACION}
        autoComplete="off"
        enterKeyHint="done"
        ayuda={`Por ejemplo: sin cebolla. ${observacion.length} de ${LARGO_OBSERVACION}.`}
        onChange={(e) => setObservacion(e.target.value)}
      />

      <div className="hoja-producto__pie">
        {faltas.length > 0 ? (
          <p className="hoja-producto__faltas" role="alert">
            <Icono icono={IconoAlerta} tamano={16} />
            {faltas.join('. ')}
          </p>
        ) : null}
        {sinPrecio ? (
          <p className="hoja-producto__faltas" role="alert">
            <Icono icono={IconoAlerta} tamano={16} />
            Este producto no se vende solo.
          </p>
        ) : null}
        <Boton type="submit" variante="principal" bloque disabled={sinPrecio}>
          {linea ? 'Guardar cambios' : 'Agregar'}
          {resultado.valido ? ` · ${montoEnSoles(resultado.total)}` : ''}
        </Boton>
      </div>
    </form>
  );
}

/** Grupo en el que se elige una sola opción (botones de radio con aspecto de baldosa). */
function GrupoDeUnaOpcion({
  grupo,
  elegido,
  error,
  onElegir,
}: {
  grupo: GrupoDeProducto;
  elegido: string | null;
  error: string | undefined;
  onElegir: (id: string | null) => void;
}) {
  const opciones: OpcionConAyuda<string>[] = [
    ...(grupo.minimo === 0
      ? [{ valor: NINGUNA, titulo: 'Ninguna', ayuda: 'No elegir nada de este grupo' }]
      : []),
    ...grupo.modificadores.map((m) => ({
      valor: m.id,
      titulo: m.nombre,
      ayuda: m.disponible ? recargoDeOpcion(m.precioExtra) : 'No disponible',
      deshabilitada: !m.disponible,
    })),
  ];
  return (
    <div data-grupo-error={error ? 'true' : undefined}>
      <OpcionesConAyuda
        etiqueta={grupo.nombre}
        ayuda={reglaDelGrupo(grupo)}
        opciones={opciones}
        valor={elegido ?? (grupo.minimo === 0 ? NINGUNA : '')}
        onCambio={(valor) => onElegir(valor === NINGUNA ? null : valor)}
        error={error}
      />
    </div>
  );
}

/** Grupo en el que se pueden elegir varias opciones: casillas, con el tope dicho en palabras. */
function GrupoDeVariasOpciones({
  grupo,
  elegidos,
  error,
  onCambio,
}: {
  grupo: GrupoDeProducto;
  elegidos: string[];
  error: string | undefined;
  onCambio: (ids: string[]) => void;
}) {
  const id = useId();
  const llenoElTope = elegidos.length >= grupo.maximo;
  return (
    <fieldset
      className="hoja-producto__grupo"
      data-grupo-error={error ? 'true' : undefined}
      aria-describedby={`${id}-regla`}
    >
      <legend className="ui-campo__etiqueta">{grupo.nombre}</legend>
      <div className="ui-campo__ayuda" id={`${id}-regla`}>
        {reglaDelGrupo(grupo)}
      </div>
      <div className="hoja-producto__casillas">
        {grupo.modificadores.map((m) => {
          const marcada = elegidos.includes(m.id);
          const sinLugar = llenoElTope && !marcada;
          return (
            <Casilla
              key={m.id}
              etiqueta={m.nombre}
              ayuda={
                !m.disponible
                  ? 'No disponible'
                  : sinLugar
                    ? `Ya elegiste ${grupo.maximo}`
                    : recargoDeOpcion(m.precioExtra)
              }
              marcada={marcada}
              bloqueada={!m.disponible || sinLugar}
              onCambio={(valor) =>
                onCambio(valor ? [...elegidos, m.id] : elegidos.filter((e) => e !== m.id))
              }
            />
          );
        })}
      </div>
      {error ? (
        <div className="ui-campo__mensaje" role="alert">
          <Icono icono={IconoAlerta} tamano={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </fieldset>
  );
}
