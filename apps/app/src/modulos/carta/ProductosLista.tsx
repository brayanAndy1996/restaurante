import type { ProductoResumen } from '@restaurante/contratos';
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
  IconoCarta,
  IconoDerecha,
  IconoMas,
  IconoOrdenar,
  Miniatura,
  TablaResponsiva,
  claseBoton,
  claseFila,
  moverEnLista,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { paraBuscar } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import {
  CLAVES,
  ETIQUETA_DE_CONTROL,
  agruparPorFamilia,
  listarEstaciones,
  listarFamilias,
  listarProductos,
  ordenarProductosDeFamilia,
  pluralProductos,
} from './carta';
import { MarcoDeCarta } from './MarcoDeCarta';
import { etiquetaDeTipo } from './tipos';

/** Más productos que esto y aparece la búsqueda. */
const PRODUCTOS_PARA_BUSCAR = 6;

function Etiquetas({ producto }: { producto: ProductoResumen }) {
  const hay = !producto.activo || producto.tipo !== 'SIMPLE' || !producto.seVendeSolo;
  if (!hay) return null;
  return (
    <span className="etiquetas">
      {!producto.activo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : null}
      {producto.tipo !== 'SIMPLE' ? (
        <EtiquetaDeEstado tono="info">{etiquetaDeTipo(producto.tipo)}</EtiquetaDeEstado>
      ) : null}
      {producto.tipo === 'SIMPLE' && !producto.seVendeSolo ? (
        <EtiquetaDeEstado tono="neutro">No se vende solo</EtiquetaDeEstado>
      ) : null}
    </span>
  );
}

/** Segunda línea de una fila: el precio con IGV y la estación ("S/ 28.00 · Cocina"). */
function ayudaDe(producto: ProductoResumen, estaciones: ReadonlyMap<string, string>): string {
  const partes: string[] = [];
  const precio = montoEnSoles(producto.precio);
  if (precio) partes.push(precio);
  if (producto.tipo === 'SIMPLE') {
    partes.push(
      producto.estacionId ? (estaciones.get(producto.estacionId) ?? 'Estación') : 'Sin estación',
    );
  }
  return partes.join(' · ');
}

/**
 * Productos de la carta (criterio 71): agrupados por familia en su orden, con miniatura, precio y
 * estado; búsqueda; "Activos" o "Todos"; y el modo "Ordenar" con subir y bajar. En celular cada
 * producto es una fila de 72 px; desde 768 px, una tabla por familia.
 */
export function ProductosLista() {
  const clientes = useQueryClient();
  const productos = useQuery({
    queryKey: CLAVES.productos,
    queryFn: ({ signal }) => listarProductos(signal),
  });
  const familias = useQuery({
    queryKey: CLAVES.familias,
    queryFn: ({ signal }) => listarFamilias(signal),
  });
  // Los nombres de las estaciones son un detalle: si no llegan, la fila dice solo "Estación".
  const estaciones = useQuery({
    queryKey: CLAVES.estaciones,
    queryFn: ({ signal }) => listarEstaciones(signal),
  });
  const nombresDeEstacion = useMemo(
    () => new Map((estaciones.data ?? []).map((e) => [e.id, e.nombre])),
    [estaciones.data],
  );

  const envio = useEnvioPendiente();
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string[]> | null>(null);
  const [errorOrden, setErrorOrden] = useState<string>();
  const [guardandoOrden, setGuardandoOrden] = useState(false);
  const [anuncio, setAnuncio] = useState('');

  const todos = useMemo(() => productos.data ?? [], [productos.data]);
  const inactivos = todos.filter((p) => !p.activo).length;
  const grupos = useMemo(
    () => agruparPorFamilia(familias.data ?? [], todos),
    [familias.data, todos],
  );

  const texto = paraBuscar(busqueda);
  const visibles = grupos
    .map((g) => ({
      ...g,
      productos: g.productos.filter(
        (p) => (verInactivos || p.activo) && (texto === '' || paraBuscar(p.nombre).includes(texto)),
      ),
    }))
    .filter((g) => g.productos.length > 0);
  const hayAlgoParaOrdenar = grupos.some((g) => g.productos.length > 1);

  function ordenar() {
    setBorrador(
      Object.fromEntries(grupos.map((g) => [g.familia.id, g.productos.map((p) => p.id)])),
    );
    setErrorOrden(undefined);
    setBusqueda('');
  }

  function mover(familiaId: string, desde: number, hacia: number) {
    const actual = borrador?.[familiaId];
    if (!borrador || !actual) return;
    const nueva = moverEnLista(actual, desde, hacia);
    setBorrador({ ...borrador, [familiaId]: nueva });
    const movido = todos.find((p) => p.id === nueva[hacia]);
    if (movido) setAnuncio(`${movido.nombre}: posición ${hacia + 1} de ${nueva.length}`);
  }

  /** Las familias cuyo orden cambió respecto del que está guardado. */
  function familiasCambiadas(): string[] {
    if (!borrador) return [];
    return grupos
      .filter((g) => g.productos.some((p, i) => p.id !== borrador[g.familia.id]?.[i]))
      .map((g) => g.familia.id);
  }

  async function guardarOrden() {
    if (!borrador || guardandoOrden) return;
    setGuardandoOrden(true);
    setErrorOrden(undefined);
    try {
      // Una familia a la vez: si una falla, las que ya se guardaron quedan y el resto sigue en el borrador.
      for (const familiaId of familiasCambiadas()) {
        const ids = borrador[familiaId];
        // Una escritura sin red no se pierde: queda "Pendiente de envío" y sale sola al volver, con su clave.
        if (ids) await envio.enviar((extra) => ordenarProductosDeFamilia(familiaId, ids, extra));
      }
      await clientes.invalidateQueries({ queryKey: CLAVES.productos });
      setBorrador(null);
    } catch (e) {
      await clientes.invalidateQueries({ queryKey: CLAVES.productos });
      setErrorOrden(
        e instanceof ErrorApi && e.codigo === 'DATOS_INVALIDOS'
          ? 'La lista cambió mientras la ordenabas. Sal de ordenar y vuelve a entrar.'
          : mensajeDeError(e),
      );
    } finally {
      setGuardandoOrden(false);
    }
  }

  const cargando = productos.isPending || familias.isPending;
  const error = productos.isError ? productos.error : familias.isError ? familias.error : null;

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
          disabled={familiasCambiadas().length === 0}
          onClick={() => void guardarOrden()}
        >
          Guardar orden
        </Boton>
      </div>
    );
  } else if (!cargando && !error) {
    pie = (
      <Link to="/carta/productos/nuevo" className={`${claseBoton('principal')} boton-pie`}>
        <Icono icono={IconoMas} />
        Nuevo producto
      </Link>
    );
  }

  return (
    <MarcoDeCarta actual="productos" {...(pie ? { pie } : {})}>
      {cargando ? (
        <EsqueletoDeLista etiqueta="Cargando productos" />
      ) : error ? (
        <ErrorDeCarga
          titulo="No pudimos cargar la carta"
          onReintentar={() => {
            void productos.refetch();
            void familias.refetch();
          }}
          reintentando={productos.isFetching || familias.isFetching}
        >
          {mensajeDeError(error)}
        </ErrorDeCarga>
      ) : todos.length === 0 ? (
        <EstadoVacio
          icono={IconoCarta}
          titulo="Aún no tienes productos"
          accion={
            (familias.data ?? []).length === 0 ? (
              <Link to="/carta?ver=familias" className={claseBoton('principal')}>
                <Icono icono={IconoMas} tamano={20} />
                Crear una familia
              </Link>
            ) : (
              <Link to="/carta/productos/nuevo" className={claseBoton('principal')}>
                <Icono icono={IconoMas} tamano={20} />
                Nuevo producto
              </Link>
            )
          }
        >
          {(familias.data ?? []).length === 0
            ? 'Crea tu primera familia y tu primer producto. La familia agrupa los productos en la carta, por ejemplo Entradas o Bebidas.'
            : 'Crea tu primer producto: elige su familia, su precio con IGV y la estación que lo prepara.'}
        </EstadoVacio>
      ) : borrador ? (
        <>
          <p className="texto-ayuda">
            Toca las flechas para subir o bajar un producto dentro de su familia. Así se verán en la
            carta de todas las sucursales.
          </p>
          <span className="ui-solo-lectores" role="status" aria-live="polite">
            {anuncio}
          </span>
          <AvisoPendiente pendiente={envio.pendiente} />
          {errorOrden ? (
            <Aviso tipo="error" titulo="No pudimos guardar el orden">
              {errorOrden}
            </Aviso>
          ) : null}
          {grupos.map((g) => {
            const ids = borrador[g.familia.id] ?? [];
            const porId = new Map(g.productos.map((p) => [p.id, p]));
            return (
              <section key={g.familia.id} className="carta__familia">
                <h2 className="formulario__titulo">{g.familia.nombre}</h2>
                <ul className="ui-lista" aria-label={`Ordenar ${g.familia.nombre}`}>
                  {ids.map((id, i) => {
                    const p = porId.get(id);
                    if (!p) return null;
                    return (
                      <FilaOrdenable
                        key={id}
                        nombre={p.nombre}
                        posicion={i + 1}
                        total={ids.length}
                        apagada={!p.activo}
                        onSubir={() => mover(g.familia.id, i, i - 1)}
                        onBajar={() => mover(g.familia.id, i, i + 1)}
                      >
                        <div className="ui-fila">
                          <ContenidoDeFila
                            izquierda={<Miniatura url={p.fotoUrl} apagada={!p.activo} />}
                            apagada={!p.activo}
                            titulo={p.nombre}
                            ayuda={ayudaDe(p, nombresDeEstacion)}
                            extra={<Etiquetas producto={p} />}
                          />
                        </div>
                      </FilaOrdenable>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      ) : (
        <>
          <div className="carta__herramientas">
            {todos.length > PRODUCTOS_PARA_BUSCAR ? (
              <CampoTexto
                className="carta__busqueda"
                etiqueta="Buscar"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre del producto"
                autoComplete="off"
              />
            ) : null}
            {hayAlgoParaOrdenar ? (
              <Boton variante="texto" icono={IconoOrdenar} onClick={ordenar}>
                Ordenar
              </Boton>
            ) : null}
          </div>
          <div className="carta__resumen">
            <p className="texto-ayuda" aria-live="polite">
              {pluralProductos(todos.length)}
              {inactivos > 0
                ? ` · ${inactivos === 1 ? '1 inactivo' : `${inactivos} inactivos`}`
                : ''}
            </p>
            {inactivos > 0 ? (
              <Boton
                variante="texto"
                aria-pressed={verInactivos}
                onClick={() => setVerInactivos((v) => !v)}
              >
                {verInactivos ? 'Ocultar inactivos' : 'Ver inactivos'}
              </Boton>
            ) : null}
          </div>

          {visibles.length === 0 ? (
            <EstadoVacio icono={IconoCarta} titulo="No encontramos productos">
              {texto !== ''
                ? 'Prueba con otro nombre.'
                : 'Todos los productos están inactivos. Toca "Ver inactivos" para verlos.'}
            </EstadoVacio>
          ) : (
            visibles.map((g) => (
              <section key={g.familia.id} className="carta__familia" aria-label={g.familia.nombre}>
                <div className="carta__familia-encabezado">
                  <h2 className="formulario__titulo">{g.familia.nombre}</h2>
                  {!g.familia.activa ? (
                    <EtiquetaDeEstado tono="neutro">Familia inactiva</EtiquetaDeEstado>
                  ) : null}
                </div>
                <TablaResponsiva
                  etiqueta={`Productos de ${g.familia.nombre}`}
                  filas={g.productos}
                  clave={(p) => p.id}
                  apagada={(p) => !p.activo}
                  filaEnLista={(p) => (
                    <Link to={`/carta/productos/${p.id}`} className={claseFila(!p.activo)}>
                      <ContenidoDeFila
                        izquierda={<Miniatura url={p.fotoUrl} apagada={!p.activo} />}
                        apagada={!p.activo}
                        titulo={p.nombre}
                        ayuda={ayudaDe(p, nombresDeEstacion)}
                        derecha={<Icono icono={IconoDerecha} />}
                        extra={<Etiquetas producto={p} />}
                      />
                    </Link>
                  )}
                  columnas={[
                    {
                      id: 'nombre',
                      encabezado: 'Producto',
                      celda: (p) => (
                        <span className="carta__producto">
                          <Miniatura url={p.fotoUrl} apagada={!p.activo} />
                          <Link
                            to={`/carta/productos/${p.id}`}
                            className="enlace-texto enlace-nombre"
                          >
                            {p.nombre}
                          </Link>
                        </span>
                      ),
                    },
                    {
                      id: 'estacion',
                      encabezado: 'Estación',
                      celda: (p) =>
                        p.tipo === 'SIMPLE'
                          ? p.estacionId
                            ? (nombresDeEstacion.get(p.estacionId) ?? 'Estación')
                            : 'Ninguna'
                          : '—',
                    },
                    {
                      id: 'stock',
                      encabezado: 'Control de stock',
                      sinSaltos: true,
                      celda: (p) => ETIQUETA_DE_CONTROL[p.tipoControlStock],
                    },
                    {
                      id: 'precio',
                      encabezado: 'Precio con IGV',
                      alinear: 'derecha',
                      sinSaltos: true,
                      celda: (p) => montoEnSoles(p.precio) ?? '—',
                    },
                    {
                      id: 'estado',
                      encabezado: 'Estado',
                      celda: (p) => <Etiquetas producto={p} />,
                    },
                    {
                      id: 'acciones',
                      encabezado: 'Acciones',
                      encabezadoOculto: true,
                      alinear: 'derecha',
                      sinSaltos: true,
                      celda: (p) => (
                        <Link to={`/carta/productos/${p.id}`} className={claseBoton()}>
                          Editar <span className="ui-solo-lectores">{p.nombre}</span>
                        </Link>
                      ),
                    },
                  ]}
                />
              </section>
            ))
          )}
        </>
      )}
    </MarcoDeCarta>
  );
}
