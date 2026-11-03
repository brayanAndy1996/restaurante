import type { CSSProperties, ReactNode } from 'react';
import type { CartaPublica } from '@restaurante/contratos';
import { colorDeMarcaAccesible, colorDeMarcaSobreBlanco } from '@restaurante/dominio';
import { Cabecera } from './Cabecera';
import { Disponibilidad } from './Disponibilidad';
import { FamiliaActual } from './FamiliaActual';
import { Familias } from './Familias';
import { Icono } from './Iconos';
import { Producto } from './Producto';

/** El color de la marca como variables de CSS: el fondo, el texto encima y el indicador sobre blanco. */
export function variablesDeMarca(colorPrincipal: string): CSSProperties {
  const { fondo, texto } = colorDeMarcaAccesible(colorPrincipal);
  return {
    '--marca': fondo,
    '--sobre-marca': texto,
    '--indicador': colorDeMarcaSobreBlanco(colorPrincipal),
  } as CSSProperties;
}

/** "4" es la mesa 4; "Terraza 2" ya se dice sola. */
export function etiquetaDeMesa(nombre: string): string {
  return /^\d+$/.test(nombre) ? `Mesa ${nombre}` : nombre;
}

interface Props {
  carta: CartaPublica;
  /** Las direcciones con las que se consulta la disponibilidad (`GET …/disponibilidad`). */
  empresaSlug: string;
  sucursalSlug: string;
  /** Nombre de la mesa: solo en el modo mesa (`/m/<código>`). */
  mesa?: string;
  /**
   * La barra fija de abajo del modo mesa (llamar al mozo, pedir la cuenta, ver el pedido): la isla `Mesa`. En la
   * carta pública no hay nada.
   */
  barra?: ReactNode;
}

/**
 * La carta del restaurante, armada en el servidor (criterio 81): cabecera con la marca, familias en una fila fija,
 * y una sección por familia con sus productos. Se lee completa sin JavaScript; las islas solo agregan la
 * disponibilidad en vivo y la familia en pantalla. La usan `/<empresa>/<sucursal>` y `/m/<código>`.
 */
export function CartaWeb({ carta, empresaSlug, sucursalSlug, mesa, barra }: Props) {
  let indice = 0;
  return (
    <div
      className="carta"
      data-modo={mesa === undefined ? 'carta' : 'mesa'}
      data-con-barra={barra ? '' : undefined}
      style={variablesDeMarca(carta.empresa.colorPrincipal)}
    >
      <a className="saltar" href="#carta">
        Ir a la carta
      </a>
      <Cabecera
        nombre={carta.empresa.nombre}
        logoUrl={carta.empresa.logoUrl}
        sucursal={carta.sucursal.nombre}
        direccion={mesa === undefined ? carta.sucursal.direccion : undefined}
        horario={carta.sucursal.horario}
        mesa={mesa === undefined ? undefined : etiquetaDeMesa(mesa)}
      />
      <div className="cuerpo">
        {carta.familias.length > 0 ? <Familias familias={carta.familias} /> : null}
        <main id="carta">
          <div className="columna">
            {mesa !== undefined && carta.familias.length > 0 ? (
              <p className="guia" data-guia>
                <Icono nombre="info" pequeno />
                Toca un plato para agregarlo a tu pedido.
              </p>
            ) : null}
            {carta.familias.length === 0 ? (
              <p className="vacia">Por ahora no hay platos disponibles.</p>
            ) : null}
            {carta.familias.map((familia) => (
              <section
                key={familia.id}
                className="seccion"
                id={`f-${familia.id}`}
                data-familia-id={familia.id}
                aria-labelledby={`h-${familia.id}`}
              >
                <h2 id={`h-${familia.id}`}>{familia.nombre}</h2>
                <ul>
                  {familia.productos.map((producto) => (
                    <Producto
                      key={producto.id}
                      producto={producto}
                      indice={indice++}
                      modoMesa={mesa !== undefined}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </main>
      </div>
      {barra}
      <Disponibilidad empresa={empresaSlug} sucursal={sucursalSlug} />
      {carta.familias.length > 0 ? <FamiliaActual /> : null}
    </div>
  );
}
