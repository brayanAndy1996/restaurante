import type { GrupoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  BotonIcono,
  CampoMonto,
  CampoSeleccion,
  CampoTexto,
  IconoBajar,
  IconoAlerta,
  IconoBasura,
  Icono,
  IconoMas,
  IconoSubir,
  Interruptor,
  OpcionesConAyuda,
  type OpcionConAyuda,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, type KeyboardEvent } from 'react';
import { mensajeDeError } from '../../lib/errores';
import { paraBuscar } from '../../lib/formato';
import { CLAVES, listarProductos } from './carta';
import {
  MAXIMO_NOMBRE_GRUPO,
  MAXIMO_NOMBRE_OPCION,
  MAXIMO_OPCIONES,
  listaEnFrase,
  reglaDelBorrador,
  usoEnProductos,
} from './grupo-form';
import type { FormularioDeGrupo } from './useFormularioDeGrupo';

const OPCIONES_DE_SELECCION: readonly OpcionConAyuda<'UNICA' | 'MULTIPLE'>[] = [
  {
    valor: 'UNICA',
    titulo: 'Una sola',
    ayuda: 'Se elige una opción, como el término de la carne o la bebida del combo.',
  },
  {
    valor: 'MULTIPLE',
    titulo: 'Varias',
    ayuda: 'Se pueden elegir varias, como los extras de una hamburguesa.',
  },
];

interface Props {
  f: FormularioDeGrupo;
  /** El grupo guardado; sin él, es uno nuevo. */
  original?: GrupoRespuesta | undefined;
  /** Id del `<form>`: la pantalla lo usa para poner el botón de guardar fuera del formulario. */
  idFormulario: string;
  /** Dentro de un producto: con sus propios botones al final y el título de su panel. */
  integrado?: { alCancelar: () => void } | undefined;
}

/**
 * Formulario de un grupo de modificadores (003, criterios 24 a 27 y 75): nombre, una o varias, obligatorio
 * o mínimo y máximo, y la lista de opciones con precio extra y producto ligado, que se ordenan y se
 * quitan. Se usa en su propia pantalla y, sin salir del producto, dentro de él.
 */
export function GrupoFormulario({ f, original, idFormulario, integrado }: Props) {
  const idBase = useId();
  const { estado, errores } = f;
  const productos = useQuery({
    queryKey: CLAVES.productos,
    queryFn: ({ signal }) => listarProductos(signal),
  });

  // Solo los productos simples y activos se pueden ligar a una opción (criterio 26).
  const ligables = useMemo(
    () =>
      (productos.data ?? [])
        .filter((p) => p.tipo === 'SIMPLE' && p.activo)
        .sort((a, b) => paraBuscar(a.nombre).localeCompare(paraBuscar(b.nombre), 'es')),
    [productos.data],
  );
  const nombreGuardado = useMemo(
    () =>
      new Map(
        (original?.modificadores ?? []).map((m) => [m.producto?.id ?? '', m.producto?.nombre]),
      ),
    [original],
  );

  useEffect(() => {
    if (f.clavePorEnfocar)
      document.getElementById(`${idBase}-${f.clavePorEnfocar}-nombre`)?.focus();
  }, [f.clavePorEnfocar, idBase]);

  // Dentro de un producto los títulos bajan un nivel: el del panel es el de nivel 3.
  const Titulo = integrado ? 'h4' : 'h2';
  const TituloDeOpcion = integrado ? 'h5' : 'h3';
  const regla = reglaDelBorrador(estado);
  const total = estado.opciones.length;
  const otrosProductos = (original?.productos ?? []).map((p) => p.nombre);

  function alPulsarEnter(evento: KeyboardEvent<HTMLInputElement>, indice: number) {
    // Enter en el nombre de una opción pasa a la siguiente (o agrega otra), no envía el formulario.
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const siguiente = estado.opciones[indice + 1];
    if (siguiente) document.getElementById(`${idBase}-${siguiente.clave}-nombre`)?.focus();
    else if (estado.opciones[indice]?.nombre.trim() !== '') f.agregarOpcion();
  }

  return (
    <form
      id={idFormulario}
      className="formulario formulario--secciones"
      onSubmit={(e) => void f.enviar(e)}
      noValidate
    >
      {original && original.productos.length > 0 ? (
        <Aviso tipo="alerta" titulo={usoEnProductos(original.productos.length)}>
          {integrado ? 'Si lo cambias, cambia en ' : 'Si cambias este grupo, cambia en '}
          {original.productos.length === 1 ? 'ese producto' : 'todos esos productos'}:{' '}
          {listaEnFrase(otrosProductos)}. Los cambios valen desde que guardes.
        </Aviso>
      ) : null}

      {f.guardado && !integrado ? (
        <Aviso tipo="ok" titulo="Cambios guardados">
          {original && original.productos.length > 0
            ? `Ya valen para ${original.productos.length === 1 ? 'el producto que lo usa' : `los ${original.productos.length} productos que lo usan`}.`
            : 'Ya puedes agregarlo a un producto.'}
        </Aviso>
      ) : null}
      {f.fallo ? (
        <Aviso tipo="error" titulo="No pudimos guardar el grupo">
          {f.fallo}
        </Aviso>
      ) : null}

      <section className="seccion" aria-labelledby={`${idBase}-datos`}>
        <Titulo className="formulario__titulo" id={`${idBase}-datos`}>
          Datos
        </Titulo>
        <CampoTexto
          etiqueta="Nombre del grupo"
          value={estado.nombre}
          onChange={(e) => f.cambiar({ nombre: e.target.value })}
          error={errores.nombre}
          maxLength={MAXIMO_NOMBRE_GRUPO * 2}
          placeholder="Por ejemplo, Término de la carne"
          autoComplete="off"
          enterKeyHint="next"
        />
        <OpcionesConAyuda
          etiqueta="Cuántas se pueden elegir"
          opciones={OPCIONES_DE_SELECCION}
          valor={estado.seleccion}
          onCambio={(seleccion) => f.cambiar({ seleccion })}
        />
        {estado.seleccion === 'UNICA' ? (
          <Interruptor
            etiqueta="Obligatorio"
            ayuda={
              estado.obligatorio
                ? 'No se puede enviar la comanda sin elegir una opción.'
                : 'Se puede enviar la comanda sin elegir nada de este grupo.'
            }
            marcado={estado.obligatorio}
            onCambio={(obligatorio) => f.cambiar({ obligatorio })}
          />
        ) : (
          <div className="grupo__rango">
            <CampoTexto
              etiqueta="Mínimo"
              value={estado.minimo}
              onChange={(e) => f.cambiar({ minimo: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              error={errores.minimo}
              ayuda="0 si no es obligatorio."
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
            />
            <CampoTexto
              etiqueta="Máximo"
              value={estado.maximo}
              onChange={(e) => f.cambiar({ maximo: e.target.value.replace(/\D/g, '').slice(0, 2) })}
              error={errores.maximo}
              ayuda="Cuántas como mucho."
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
            />
          </div>
        )}
        <p className="grupo__regla" aria-live="polite">
          <span className="texto-ayuda">Quien comanda verá</span>
          <b>{regla ?? 'Completa el mínimo y el máximo'}</b>
        </p>
      </section>

      <section className="seccion" aria-labelledby={`${idBase}-opciones`}>
        <div className="grupo__encabezado">
          <Titulo className="formulario__titulo" id={`${idBase}-opciones`}>
            Opciones
          </Titulo>
          <span className="texto-ayuda">
            {total} de {MAXIMO_OPCIONES}
          </span>
        </div>
        <p className="texto-ayuda">
          El precio extra se suma al del producto y es el mismo en todas las sucursales; deja 0 si
          no cuesta más. Con un producto ligado, la opción va a la estación de ese producto y
          descuenta su stock.
        </p>
        {errores.opciones ? (
          <p className="ui-campo__mensaje" role="alert">
            <Icono icono={IconoAlerta} tamano={16} />
            <span>{errores.opciones}</span>
          </p>
        ) : null}
        {productos.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos cargar tus productos">
            {mensajeDeError(productos.error)} Mientras tanto no puedes ligar productos.{' '}
            <button
              type="button"
              className="enlace-texto"
              onClick={() => void productos.refetch()}
              disabled={productos.isFetching}
            >
              {productos.isFetching ? 'Reintentando…' : 'Reintentar'}
            </button>
          </Aviso>
        ) : null}

        <ol className="opciones" aria-label="Opciones del grupo">
          {estado.opciones.map((o, i) => {
            const fallas = errores.porOpcion[o.clave] ?? {};
            const idNombre = `${idBase}-${o.clave}-nombre`;
            const estaEnLaLista = ligables.some((p) => p.id === o.productoId);
            return (
              <li key={o.clave} className="opcion">
                <div className="opcion__cabecera">
                  <TituloDeOpcion className="opcion__titulo">Opción {i + 1}</TituloDeOpcion>
                  <div className="opcion__acciones">
                    <BotonIcono
                      icono={IconoSubir}
                      etiqueta={`Subir la opción ${i + 1}`}
                      aria-disabled={i === 0 || undefined}
                      onClick={() => {
                        if (i > 0) f.moverOpcion(i, i - 1);
                      }}
                    />
                    <BotonIcono
                      icono={IconoBajar}
                      etiqueta={`Bajar la opción ${i + 1}`}
                      aria-disabled={i === total - 1 || undefined}
                      onClick={() => {
                        if (i < total - 1) f.moverOpcion(i, i + 1);
                      }}
                    />
                    <BotonIcono
                      icono={IconoBasura}
                      etiqueta={`Quitar la opción ${i + 1}`}
                      onClick={() => f.quitarOpcion(o.clave)}
                    />
                  </div>
                </div>
                <div className="opcion__campos">
                  <CampoTexto
                    id={idNombre}
                    etiqueta="Nombre"
                    aria-label={`Nombre de la opción ${i + 1}`}
                    value={o.nombre}
                    onChange={(e) => f.cambiarOpcion(o.clave, { nombre: e.target.value })}
                    onKeyDown={(e) => alPulsarEnter(e, i)}
                    error={fallas.nombre}
                    maxLength={MAXIMO_NOMBRE_OPCION * 2}
                    placeholder={i === 0 ? 'Por ejemplo, Término medio' : undefined}
                    autoComplete="off"
                    enterKeyHint="next"
                  />
                  <CampoMonto
                    etiqueta="Precio extra"
                    aria-label={`Precio extra de la opción ${i + 1}`}
                    value={o.precioExtra}
                    onValor={(precioExtra) => f.cambiarOpcion(o.clave, { precioExtra })}
                    error={fallas.precioExtra}
                    placeholder="0.00"
                  />
                  <CampoSeleccion
                    etiqueta="Producto ligado"
                    opcional
                    aria-label={`Producto ligado de la opción ${i + 1}`}
                    value={o.productoId}
                    onChange={(e) => f.cambiarOpcion(o.clave, { productoId: e.target.value })}
                    error={fallas.producto}
                    disabled={productos.isPending}
                  >
                    <option value="">
                      {productos.isPending ? 'Cargando productos…' : 'Ninguno'}
                    </option>
                    {o.productoId !== '' && !estaEnLaLista ? (
                      <option value={o.productoId}>
                        {nombreGuardado.get(o.productoId) ?? 'Producto'} (ya no está disponible)
                      </option>
                    ) : null}
                    {ligables.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </CampoSeleccion>
                </div>
              </li>
            );
          })}
        </ol>

        <Boton
          bloque
          icono={IconoMas}
          onClick={f.agregarOpcion}
          disabled={total >= MAXIMO_OPCIONES}
        >
          Agregar opción
        </Boton>
        {total >= MAXIMO_OPCIONES ? (
          <p className="texto-ayuda">Un grupo admite hasta {MAXIMO_OPCIONES} opciones.</p>
        ) : null}
      </section>

      {integrado ? (
        <div className="fila-botones">
          <Boton onClick={integrado.alCancelar} disabled={f.enviando}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            cargando={f.enviando}
            textoCargando="Guardando…"
            disabled={f.sinCambios}
          >
            {original ? 'Guardar grupo' : 'Crear grupo'}
          </Boton>
        </div>
      ) : null}
    </form>
  );
}
