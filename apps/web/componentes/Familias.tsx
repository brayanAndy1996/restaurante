/**
 * Las familias como enlaces a sus secciones, en una sola fila que se desliza de lado y queda fija arriba al bajar
 * (criterio 81). Son enlaces a `#id`: funcionan sin JavaScript. La isla `FamiliaActual` marca la que está en pantalla.
 */
export function Familias({ familias }: { familias: readonly { id: string; nombre: string }[] }) {
  return (
    <nav className="familias" aria-label="Secciones de la carta">
      <div className="familias__interior">
        <ul>
          {familias.map((familia) => (
            <li key={familia.id} data-familia-enlace={familia.id}>
              <a href={`#f-${familia.id}`}>{familia.nombre}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
