import {
  Aviso,
  Boton,
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  FilaOrdenable,
  Icono,
  IconoEditar,
  IconoMas,
  IconoOrdenar,
  ListaDeFilas,
  moverEnLista,
  claseFila,
  type LucideIcon,
} from '@restaurante/ui';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { MarcoDeCarta, type SeccionDeCarta } from './MarcoDeCarta';

/** Lo que tienen en común una familia y una estación: un nombre, activa o no, y cuántos productos activos las usan. */
export interface ItemDeCatalogo {
  id: string;
  nombre: string;
  activa: boolean;
  /** Productos activos que lo usan. */
  cuenta: number;
}

export interface TextosDeCatalogo {
  /** "familia", "estación". */
  singular: string;
  agregar: string;
  /** Etiqueta del campo de nombre. */
  campo: string;
  /** Largo máximo del nombre (lo fija la API). */
  maximo: number;
  ejemplo: string;
  cargando: string;
  errorDeCarga: string;
  vacioTitulo: string;
  vacioTexto: string;
  /** Nombre de la lista para los lectores de pantalla ("Familias"). */
  lista: string;
  /** "3 familias · 1 inactiva". */
  resumen: (total: number, inactivos: number) => string;
  /** "1 producto", "4 productos". */
  cuenta: (cantidad: number) => string;
  /** Por qué no se puede desactivar mientras la usan productos. */
  enUso: (cantidad: number) => string;
  repetido: string;
  /** "Inactiva", "Inactivo". */
  inactiva: string;
  icono: LucideIcon;
}

interface PropsListaDeCatalogo {
  seccion: SeccionDeCarta;
  textos: TextosDeCatalogo;
  items: ItemDeCatalogo[] | undefined;
  cargando: boolean;
  error: unknown;
  reintentando: boolean;
  onReintentar: () => void;
  onCrear: (nombre: string) => Promise<unknown>;
  onModificar: (id: string, cambios: { nombre?: string; activa?: boolean }) => Promise<unknown>;
  /** Si se pasa, la lista se puede ordenar con subir y bajar. */
  onOrdenar?: (ids: string[]) => Promise<unknown>;
}

function comoError(e: unknown): ErrorApi {
  return e instanceof ErrorApi
    ? e
    : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
}

/**
 * Lista de un catálogo simple de la carta (familias y estaciones): filas con su nombre y cuántos
 * productos la usan, alta y edición en la misma pantalla (sin hojas), desactivar con su explicación y,
 * si se pide, orden manual con subir y bajar. Nada se borra: se desactiva (decisión del especificador).
 */
export function ListaDeCatalogo({
  seccion,
  textos,
  items,
  cargando,
  error,
  reintentando,
  onReintentar,
  onCrear,
  onModificar,
  onOrdenar,
}: PropsListaDeCatalogo) {
  const [agregando, setAgregando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [errorNuevo, setErrorNuevo] = useState<string>();
  const [creando, setCreando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState('');
  const [errorEdicion, setErrorEdicion] = useState<string>();
  const [guardando, setGuardando] = useState(false);

  const [borrador, setBorrador] = useState<ItemDeCatalogo[] | null>(null);
  const [errorOrden, setErrorOrden] = useState<string>();
  const [guardandoOrden, setGuardandoOrden] = useState(false);
  const [anuncio, setAnuncio] = useState('');

  // Al abrir el alta o la edición, el cursor ya está en el nombre (la persona acaba de tocar el botón).
  useEffect(() => {
    if (agregando) document.getElementById('nombre-nuevo-catalogo')?.focus();
  }, [agregando]);
  useEffect(() => {
    if (editandoId !== null) document.getElementById('nombre-edicion-catalogo')?.focus();
  }, [editandoId]);

  const todos = items ?? [];
  const inactivos = todos.filter((i) => !i.activa).length;

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    if (creando) return;
    const nombre = nombreNuevo.trim();
    if (nombre === '') return setErrorNuevo(`Escribe el nombre de la ${textos.singular}`);
    if (Array.from(nombre).length > textos.maximo)
      return setErrorNuevo(`Usa ${textos.maximo} caracteres como máximo`);
    setErrorNuevo(undefined);
    setCreando(true);
    try {
      await onCrear(nombre);
      setNombreNuevo('');
      setAgregando(false);
    } catch (e) {
      const falla = comoError(e);
      if (falla.codigo === 'CONFLICTO' && !falla.reintentada) setErrorNuevo(textos.repetido);
      else if (falla.codigo === 'CONFLICTO') {
        setErrorNuevo(
          'La conexión se cortó y es posible que ya se haya creado. Revisa la lista antes de intentarlo otra vez.',
        );
      } else setErrorNuevo(mensajeDeError(falla));
    } finally {
      setCreando(false);
    }
  }

  function editar(item: ItemDeCatalogo) {
    setEditandoId(item.id);
    setNombreEditado(item.nombre);
    setErrorEdicion(undefined);
  }

  async function guardar(item: ItemDeCatalogo, cambios: { nombre?: string; activa?: boolean }) {
    if (guardando) return;
    setGuardando(true);
    setErrorEdicion(undefined);
    try {
      await onModificar(item.id, cambios);
      setEditandoId(null);
    } catch (e) {
      const falla = comoError(e);
      if (falla.codigo === 'CONFLICTO') setErrorEdicion(textos.repetido);
      else if (falla.codigo === 'EN_USO') setErrorEdicion(textos.enUso(item.cuenta));
      else setErrorEdicion(mensajeDeError(falla));
    } finally {
      setGuardando(false);
    }
  }

  function enviarNombre(evento: FormEvent, item: ItemDeCatalogo) {
    evento.preventDefault();
    const nombre = nombreEditado.trim();
    if (nombre === '') return setErrorEdicion(`Escribe el nombre de la ${textos.singular}`);
    if (Array.from(nombre).length > textos.maximo)
      return setErrorEdicion(`Usa ${textos.maximo} caracteres como máximo`);
    if (nombre === item.nombre) return setEditandoId(null);
    void guardar(item, { nombre });
  }

  function mover(desde: number, hacia: number) {
    if (!borrador) return;
    const nueva = moverEnLista(borrador, desde, hacia);
    setBorrador(nueva);
    const movido = nueva[hacia];
    if (movido) setAnuncio(`${movido.nombre}: posición ${hacia + 1} de ${nueva.length}`);
  }

  async function guardarOrden() {
    if (!borrador || !onOrdenar || guardandoOrden) return;
    setGuardandoOrden(true);
    setErrorOrden(undefined);
    try {
      await onOrdenar(borrador.map((i) => i.id));
      setBorrador(null);
    } catch (e) {
      const falla = comoError(e);
      setErrorOrden(
        falla.codigo === 'DATOS_INVALIDOS'
          ? 'La lista cambió mientras la ordenabas. Sal de ordenar y vuelve a entrar.'
          : mensajeDeError(falla),
      );
    } finally {
      setGuardandoOrden(false);
    }
  }

  const ordenCambio = borrador !== null && borrador.some((item, i) => item.id !== todos[i]?.id);

  // La acción principal de la sección va fija abajo, al alcance del pulgar.
  let pie: ReactNode;
  if (borrador) {
    pie = (
      <div className="fila-botones">
        <Boton onClick={() => setBorrador(null)} disabled={guardandoOrden}>
          Cancelar
        </Boton>
        <Boton
          variante="principal"
          cargando={guardandoOrden}
          textoCargando="Guardando…"
          disabled={!ordenCambio}
          onClick={() => void guardarOrden()}
        >
          Guardar orden
        </Boton>
      </div>
    );
  } else if (agregando) {
    pie = (
      <div className="fila-botones">
        <Boton
          onClick={() => {
            setAgregando(false);
            setNombreNuevo('');
            setErrorNuevo(undefined);
          }}
          disabled={creando}
        >
          Cancelar
        </Boton>
        <Boton
          variante="principal"
          type="submit"
          form="formulario-nuevo-catalogo"
          cargando={creando}
          textoCargando="Guardando…"
        >
          Crear {textos.singular}
        </Boton>
      </div>
    );
  } else if (editandoId === null && !cargando && !error) {
    pie = (
      <Boton variante="principal" bloque icono={IconoMas} onClick={() => setAgregando(true)}>
        {textos.agregar}
      </Boton>
    );
  }

  return (
    <MarcoDeCarta actual={seccion} {...(pie ? { pie } : {})}>
      {cargando ? (
        <EsqueletoDeLista etiqueta={textos.cargando} conInicial={false} />
      ) : error ? (
        <ErrorDeCarga
          titulo={textos.errorDeCarga}
          onReintentar={onReintentar}
          reintentando={reintentando}
        >
          {mensajeDeError(error)}
        </ErrorDeCarga>
      ) : (
        <>
          {agregando ? (
            <form
              id="formulario-nuevo-catalogo"
              className="ui-bloque"
              onSubmit={(e) => void crear(e)}
              noValidate
            >
              <CampoTexto
                etiqueta={textos.campo}
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                error={errorNuevo}
                id="nombre-nuevo-catalogo"
                placeholder={textos.ejemplo}
                autoComplete="off"
                enterKeyHint="done"
              />
            </form>
          ) : null}

          {todos.length === 0 ? (
            agregando ? null : (
              <EstadoVacio
                icono={textos.icono}
                titulo={textos.vacioTitulo}
                accion={
                  <Boton variante="principal" icono={IconoMas} onClick={() => setAgregando(true)}>
                    {textos.agregar}
                  </Boton>
                }
              >
                {textos.vacioTexto}
              </EstadoVacio>
            )
          ) : (
            <>
              <div className="carta__resumen">
                <p className="texto-ayuda" aria-live="polite">
                  {textos.resumen(todos.length, inactivos)}
                </p>
                {onOrdenar && todos.length > 1 && !borrador ? (
                  <Boton
                    variante="texto"
                    icono={IconoOrdenar}
                    onClick={() => {
                      setBorrador(todos);
                      setEditandoId(null);
                      setAgregando(false);
                    }}
                  >
                    Ordenar
                  </Boton>
                ) : null}
              </div>
              <span className="ui-solo-lectores" role="status" aria-live="polite">
                {anuncio}
              </span>

              {borrador ? (
                <>
                  <p className="texto-ayuda">
                    Toca las flechas para subir o bajar. Así se verán en la carta de todas las
                    sucursales.
                  </p>
                  {errorOrden ? (
                    <Aviso tipo="error" titulo="No pudimos guardar el orden">
                      {errorOrden}
                    </Aviso>
                  ) : null}
                  <ul className="ui-lista" aria-label={`Ordenar ${textos.lista.toLowerCase()}`}>
                    {borrador.map((item, i) => (
                      <FilaOrdenable
                        key={item.id}
                        nombre={item.nombre}
                        posicion={i + 1}
                        total={borrador.length}
                        apagada={!item.activa}
                        onSubir={() => mover(i, i - 1)}
                        onBajar={() => mover(i, i + 1)}
                      >
                        <div className="ui-fila">
                          <ContenidoDeFila
                            titulo={item.nombre}
                            apagada={!item.activa}
                            ayuda={textos.cuenta(item.cuenta)}
                            derecha={
                              item.activa ? undefined : (
                                <EtiquetaDeEstado tono="neutro">{textos.inactiva}</EtiquetaDeEstado>
                              )
                            }
                          />
                        </div>
                      </FilaOrdenable>
                    ))}
                  </ul>
                </>
              ) : (
                <ListaDeFilas etiqueta={textos.lista}>
                  {todos.map((item) => (
                    <li key={item.id}>
                      {editandoId === item.id ? (
                        <form
                          className="catalogo__editor"
                          onSubmit={(e) => enviarNombre(e, item)}
                          noValidate
                        >
                          <CampoTexto
                            etiqueta={textos.campo}
                            value={nombreEditado}
                            onChange={(e) => setNombreEditado(e.target.value)}
                            error={errorEdicion}
                            id="nombre-edicion-catalogo"
                            autoComplete="off"
                            enterKeyHint="done"
                          />
                          <div className="fila-botones">
                            <Boton onClick={() => setEditandoId(null)} disabled={guardando}>
                              Cancelar
                            </Boton>
                            <Boton
                              variante="principal"
                              type="submit"
                              cargando={guardando}
                              textoCargando="Guardando…"
                            >
                              Guardar
                            </Boton>
                          </div>
                          <div className="ui-acciones__separada">
                            {item.activa ? (
                              <>
                                {item.cuenta > 0 ? (
                                  <p className="texto-ayuda">{textos.enUso(item.cuenta)}</p>
                                ) : null}
                                <Boton
                                  variante="peligro"
                                  bloque
                                  disabled={item.cuenta > 0 || guardando}
                                  onClick={() => void guardar(item, { activa: false })}
                                >
                                  Desactivar {textos.singular}
                                </Boton>
                              </>
                            ) : (
                              <Boton
                                bloque
                                disabled={guardando}
                                onClick={() => void guardar(item, { activa: true })}
                              >
                                Reactivar {textos.singular}
                              </Boton>
                            )}
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className={claseFila(!item.activa)}
                          onClick={() => editar(item)}
                          aria-label={`Editar ${item.nombre}`}
                        >
                          <ContenidoDeFila
                            titulo={item.nombre}
                            apagada={!item.activa}
                            ayuda={textos.cuenta(item.cuenta)}
                            derecha={
                              <>
                                {item.activa ? null : (
                                  <EtiquetaDeEstado tono="neutro">
                                    {textos.inactiva}
                                  </EtiquetaDeEstado>
                                )}
                                <Icono icono={IconoEditar} />
                              </>
                            }
                          />
                        </button>
                      )}
                    </li>
                  ))}
                </ListaDeFilas>
              )}
            </>
          )}
        </>
      )}
    </MarcoDeCarta>
  );
}
