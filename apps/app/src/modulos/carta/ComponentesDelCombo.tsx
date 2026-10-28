import type { ProductoResumen } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  IconoMas,
  SelectorDeCantidad,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { montoEnSoles, paraBuscar } from '../../lib/formato';
import { CLAVES, listarProductos } from './carta';
import {
  CANTIDAD_MAXIMA_COMPONENTE,
  MAXIMO_COMPONENTES_POR_COMBO,
  type ComponenteDeProducto,
} from './producto-form';

/** Más productos que esto y aparece la búsqueda. */
const PRODUCTOS_PARA_BUSCAR = 6;

interface Props {
  /** El producto que se edita: aunque sea simple hoy, no puede ser componente de sí mismo. */
  productoId?: string | undefined;
  valor: ComponenteDeProducto[];
  onCambio: (componentes: ComponenteDeProducto[]) => void;
  error?: string | undefined;
  tipo: 'COMBO' | 'MENU_DEL_DIA';
}

/** Segunda línea de un producto que se puede agregar: su precio o que no se vende solo. */
function ayudaDe(producto: ProductoResumen): string {
  return producto.seVendeSolo
    ? (montoEnSoles(producto.precio) ?? 'Sin precio')
    : 'No se vende solo: sirve como parte de un combo';
}

/**
 * Los componentes fijos de un combo o un menú del día (003, criterios 6, 7 y 72): productos simples con
 * su cantidad (1 a 99), hasta 20. Un combo no lleva otro combo ni un menú: solo se ofrecen productos
 * simples y activos. Lo elegido aquí se guarda con el producto ("Guardar cambios").
 */
export function ComponentesDelCombo({ productoId, valor, onCambio, error, tipo }: Props) {
  const idBase = useId();
  const productos = useQuery({
    queryKey: CLAVES.productos,
    queryFn: ({ signal }) => listarProductos(signal),
  });
  const [eligiendo, setEligiendo] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const porId = new Map((productos.data ?? []).map((p) => [p.id, p]));
  const asignados = new Set(valor.map((c) => c.productoId));
  const disponibles = (productos.data ?? []).filter(
    (p) => p.tipo === 'SIMPLE' && p.activo && p.id !== productoId && !asignados.has(p.id),
  );
  const buscado = paraBuscar(busqueda);
  const visibles =
    buscado === '' ? disponibles : disponibles.filter((p) => paraBuscar(p.nombre).includes(buscado));
  const lleno = valor.length >= MAXIMO_COMPONENTES_POR_COMBO;
  const nombreDelTipo = tipo === 'COMBO' ? 'combo' : 'menú';

  function agregar(producto: ProductoResumen) {
    onCambio([...valor, { productoId: producto.id, nombre: producto.nombre, cantidad: 1 }]);
    setAviso(`«${producto.nombre}» agregado. Se guarda con el producto.`);
    setBusqueda('');
    if (valor.length + 1 >= MAXIMO_COMPONENTES_POR_COMBO) setEligiendo(false);
  }

  function quitar(componente: ComponenteDeProducto) {
    onCambio(valor.filter((c) => c.productoId !== componente.productoId));
    setAviso(`«${componente.nombre}» quitado de este ${nombreDelTipo}. El producto sigue existiendo.`);
  }

  function cambiarCantidad(componente: ComponenteDeProducto, cantidad: number) {
    onCambio(valor.map((c) => (c.productoId === componente.productoId ? { ...c, cantidad } : c)));
  }

  return (
    <section className="seccion" aria-labelledby={`${idBase}-titulo`}>
      <h2 className="formulario__titulo" id={`${idBase}-titulo`}>
        Componentes
      </h2>
      <p className="texto-ayuda">
        Lo que lleva el {nombreDelTipo} siempre, con su cantidad. Solo productos simples: un{' '}
        {nombreDelTipo} no puede llevar otro combo ni un menú. Cada componente va a su propia
        estación.
      </p>

      {error ? (
        <Aviso tipo="error" titulo="Revisa los componentes">
          {error}
        </Aviso>
      ) : null}
      {aviso ? (
        <Aviso tipo="ok" titulo="Listo">
          {aviso}
        </Aviso>
      ) : null}

      {valor.length === 0 ? (
        <p className="grupos__vacio">
          Sin componentes fijos. Agrega uno, o arma el {nombreDelTipo} solo con grupos de opciones.
        </p>
      ) : (
        <ul className="ui-lista" aria-label="Componentes de este producto">
          {valor.map((c) => {
            const conocido = porId.get(c.productoId);
            const inactivo = conocido !== undefined && !conocido.activo;
            return (
              <li key={c.productoId}>
                <div className="ui-fila">
                  <ContenidoDeFila
                    titulo={c.nombre}
                    ayuda={
                      inactivo
                        ? 'Desactivado: el producto no se puede vender mientras siga así'
                        : undefined
                    }
                    derecha={
                      inactivo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : undefined
                    }
                    extra={
                      <span className="componente__controles">
                        <SelectorDeCantidad
                          nombre={c.nombre}
                          valor={c.cantidad}
                          minimo={1}
                          maximo={CANTIDAD_MAXIMA_COMPONENTE}
                          onCambio={(cantidad) => cambiarCantidad(c, cantidad)}
                        />
                        <Boton variante="texto" aria-label={`Quitar ${c.nombre}`} onClick={() => quitar(c)}>
                          Quitar
                        </Boton>
                      </span>
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {lleno ? (
        <p className="texto-ayuda">
          Un {nombreDelTipo} admite hasta {MAXIMO_COMPONENTES_POR_COMBO} componentes. Quita uno para
          agregar otro.
        </p>
      ) : (
        <div className="fila-botones fila-botones--envuelta">
          <Boton
            icono={IconoMas}
            aria-expanded={eligiendo}
            disabled={productos.isPending}
            onClick={() => {
              setEligiendo((v) => !v);
              setAviso(null);
            }}
          >
            Agregar un componente
          </Boton>
        </div>
      )}

      {productos.isPending ? (
        <EsqueletoDeLista filas={1} conInicial={false} etiqueta="Cargando los productos" />
      ) : productos.isError ? (
        <ErrorDeCarga
          titulo={
            productos.error instanceof ErrorApi && productos.error.sinConexion
              ? 'Sin conexión'
              : 'No pudimos cargar tus productos'
          }
          onReintentar={() => void productos.refetch()}
          reintentando={productos.isFetching}
        >
          {mensajeDeError(productos.error)}
        </ErrorDeCarga>
      ) : eligiendo && !lleno ? (
        <div className="componente__selector">
          {disponibles.length > PRODUCTOS_PARA_BUSCAR ? (
            <CampoTexto
              etiqueta="Buscar un producto"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
          ) : null}
          {disponibles.length === 0 ? (
            <p className="grupos__vacio">
              {(productos.data ?? []).some((p) => p.tipo === 'SIMPLE' && p.activo)
                ? 'Ya agregaste todos tus productos simples.'
                : 'Aún no tienes productos simples. Crea uno en la carta para usarlo aquí.'}
            </p>
          ) : visibles.length === 0 ? (
            <p className="grupos__vacio">No hay productos con ese nombre.</p>
          ) : (
            <ul className="ui-lista" aria-label="Productos que puedes agregar">
              {visibles.map((p) => (
                <li key={p.id}>
                  <div className="ui-fila">
                    <ContenidoDeFila
                      titulo={p.nombre}
                      ayuda={ayudaDe(p)}
                      derecha={
                        <Boton aria-label={`Agregar ${p.nombre}`} onClick={() => agregar(p)}>
                          Agregar
                        </Boton>
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
