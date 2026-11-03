import Image from 'next/image';
import type { ProductoPublico } from '@restaurante/contratos';
import { precioEnSoles, precioEsCero, precioLeido } from '@restaurante/dominio';
import { esImagenOptimizable } from '@/lib/imagenes';

/** Una opción de un combo o del menú del día, con su extra si cuesta algo. */
function textoDeOpcion(nombre: string, precioExtra: string): string {
  return precioEsCero(precioExtra) ? nombre : `${nombre} (+ ${precioEnSoles(precioExtra)})`;
}

/** Lo que incluye un combo y las opciones del menú del día: "Entrada: causa limeña o ensalada". */
function Incluye({ producto }: { producto: ProductoPublico }) {
  const componentes = producto.componentes.map((c) =>
    c.cantidad > 1 ? `${c.cantidad} × ${c.nombre}` : c.nombre,
  );
  if (componentes.length === 0 && producto.grupos.length === 0) return null;
  return (
    <ul className="producto__incluye">
      {componentes.length > 0 ? (
        <li>
          <strong>Incluye:</strong> {componentes.join(', ')}.
        </li>
      ) : null}
      {producto.grupos.map((grupo) => (
        <li key={grupo.id}>
          <strong>{grupo.nombre}:</strong>{' '}
          <span className="opciones">
            {grupo.modificadores.map((m) => (
              <span key={m.id} data-modificador-id={m.id}>
                {textoDeOpcion(m.nombre, m.precioExtra)}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  producto: ProductoPublico;
  /** Posición del producto en toda la carta: las cuatro primeras fotos se cargan de una vez y las demás, al llegar. */
  indice: number;
}

/**
 * Una fila de la carta (criterio 81): nombre, descripción de hasta dos líneas, lo que incluye si es combo o menú
 * del día, precio y foto de 96 px (solo si el producto tiene). Los atributos `data-*` son los ganchos de la isla
 * de disponibilidad (oculta lo que se agotó) y de la hoja de producto del modo mesa (tarea T24).
 */
export function Producto({ producto, indice }: Props) {
  const idNombre = `p-${producto.id}`;
  const conFoto = esImagenOptimizable(producto.fotoUrl);
  return (
    <li className="fila" data-producto-id={producto.id}>
      <article className="producto" aria-labelledby={idNombre}>
        <div>
          <h3 className="producto__nombre" id={idNombre}>
            {producto.nombre}
          </h3>
          {producto.descripcion ? <p className="producto__desc">{producto.descripcion}</p> : null}
          <Incluye producto={producto} />
          <div className="producto__pie">
            <p className="precio">
              <span aria-hidden="true">{precioEnSoles(producto.precio)}</span>
              <span className="sr">{precioLeido(producto.precio)}</span>
            </p>
          </div>
        </div>
        {conFoto ? (
          <div className="foto">
            <Image
              src={producto.fotoUrl as string}
              alt={producto.nombre}
              width={96}
              height={96}
              loading={indice < 4 ? 'eager' : 'lazy'}
            />
          </div>
        ) : null}
      </article>
    </li>
  );
}
