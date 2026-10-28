import { Segmentos } from '@restaurante/ui';
import type { TipoProducto } from '@restaurante/dominio';
import { TIPOS_HABILITADOS, definicionDeTipo } from './tipos';

/**
 * Tipo del producto (Simple, Combo, Menú del día), al crear y, más adelante, al editar. Solo ofrece los
 * tipos que la API admite hoy (`TIPOS_DE_PRODUCTO`): con uno solo no hay nada que elegir y se dice cuál
 * es; cuando se habiliten los otros, el mismo componente pasa a mostrar las opciones.
 */
export function SelectorDeTipo({
  valor,
  onCambio,
}: {
  valor: TipoProducto;
  onCambio: (tipo: TipoProducto) => void;
}) {
  const actual = definicionDeTipo(valor);
  if (TIPOS_HABILITADOS.length <= 1) {
    return (
      <div className="campo-fijo">
        <p className="campo-fijo__linea">
          <span className="ui-campo__etiqueta">Tipo de producto</span>
          <b>{actual.etiqueta}</b>
        </p>
        <span className="ui-campo__ayuda">{actual.ayuda}</span>
      </div>
    );
  }
  return (
    <div className="campo-fijo">
      <Segmentos
        etiqueta="Tipo de producto"
        opciones={TIPOS_HABILITADOS.map((t) => ({ valor: t.valor, etiqueta: t.etiqueta }))}
        valor={valor}
        onCambio={onCambio}
      />
      <span className="ui-campo__ayuda">{actual.ayuda}</span>
    </div>
  );
}
