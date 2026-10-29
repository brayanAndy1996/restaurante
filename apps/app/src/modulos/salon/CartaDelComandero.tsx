import type { ProductoDeVenta } from '@restaurante/contratos';
import { CampoTexto, EstadoVacio, IconoBuscar, Segmentos } from '@restaurante/ui';
import { useId, useState } from 'react';
import { montoEnSoles } from '../../lib/formato';
import { buscarProductos, motivoCorto, type FamiliaDeVenta } from './comandero';
import './comandero.css';

interface Props {
  /** Las familias con productos que se venden solos (`familiasParaVender`). */
  familias: readonly FamiliaDeVenta[];
  onElegir: (producto: ProductoDeVenta) => void;
}

/**
 * La carta del comandero (criterio 91 de 004): búsqueda por nombre, familias como segmentos que pasan de
 * fila y los productos como baldosas con nombre y precio. Un producto que no se puede vender se ve apagado,
 * con el motivo en palabras, y no se puede elegir. No muestra cantidades de stock (decisión 2).
 */
export function CartaDelComandero({ familias, onElegir }: Props) {
  const idBusqueda = useId();
  const [texto, setTexto] = useState('');
  const [familiaId, setFamiliaId] = useState<string | null>(null);

  const buscando = texto.trim() !== '';
  const familia = familias.find((f) => f.id === familiaId) ?? familias[0];
  const productos = buscando ? buscarProductos(familias, texto) : (familia?.productos ?? []);

  return (
    <div className="carta-comandero">
      <CampoTexto
        id={idBusqueda}
        etiqueta="Buscar un producto"
        type="search"
        value={texto}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Nombre del plato o bebida"
        onChange={(e) => setTexto(e.target.value)}
      />

      {!buscando && familias.length > 1 ? (
        <Segmentos
          etiqueta="Familias de la carta"
          opciones={familias.map((f) => ({ valor: f.id, etiqueta: f.nombre }))}
          valor={familia?.id ?? ''}
          onCambio={setFamiliaId}
        />
      ) : null}

      {productos.length === 0 ? (
        <EstadoVacio icono={IconoBuscar} titulo="No hay productos">
          {buscando
            ? `Ninguno se llama «${texto.trim()}». Prueba con otra palabra.`
            : 'Esta familia no tiene productos para vender.'}
        </EstadoVacio>
      ) : (
        <ul
          className="carta-comandero__productos"
          aria-label={
            buscando ? 'Resultados de la búsqueda' : `Productos de ${familia?.nombre ?? ''}`
          }
        >
          {productos.map((p) => (
            <li key={p.id}>
              <BaldosaDeProducto producto={p} onElegir={onElegir} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Baldosa de un producto: nombre y precio; apagada y con su motivo si no se puede vender. */
function BaldosaDeProducto({
  producto,
  onElegir,
}: {
  producto: ProductoDeVenta;
  onElegir: (producto: ProductoDeVenta) => void;
}) {
  const motivo = motivoCorto(producto);
  const precio = montoEnSoles(producto.precio);
  const vendible = motivo === null && producto.seVendeSolo;
  return (
    <button
      type="button"
      className={vendible ? 'baldosa-producto' : 'baldosa-producto baldosa-producto--apagada'}
      aria-disabled={vendible ? undefined : true}
      aria-label={[producto.nombre, precio, motivo].filter(Boolean).join(', ')}
      onClick={() => {
        if (vendible) onElegir(producto);
      }}
    >
      <span className="baldosa-producto__nombre">{producto.nombre}</span>
      <span className="baldosa-producto__pie">
        {precio ? <span className="baldosa-producto__precio">{precio}</span> : null}
        {motivo ? <span className="baldosa-producto__motivo">{motivo}</span> : null}
      </span>
    </button>
  );
}
