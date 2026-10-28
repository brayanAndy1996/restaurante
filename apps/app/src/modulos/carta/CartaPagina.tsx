import { useSearchParams } from 'react-router-dom';
import { usePermiso } from '../acceso/permisos';
import { EstacionesLista } from './EstacionesLista';
import { FamiliasLista } from './FamiliasLista';
import { GruposLista } from './GruposLista';
import { seccionPedida } from './MarcoDeCarta';
import { ProductosLista } from './ProductosLista';

/** `/carta`: la sección sale de `?ver=` (productos, familias, modificadores o estaciones). */
export function CartaPagina() {
  const [parametros] = useSearchParams();
  const puedeAdministrar = usePermiso('ADMINISTRAR') === 'permitido';
  const seccion = seccionPedida(parametros.get('ver'), puedeAdministrar);
  if (seccion === 'familias') return <FamiliasLista />;
  if (seccion === 'modificadores') return <GruposLista />;
  if (seccion === 'estaciones') return <EstacionesLista />;
  return <ProductosLista />;
}
