import { Icono, IconoCuenta, claseBoton } from '@restaurante/ui';
import { Link } from 'react-router-dom';
import { veLosComprobantes } from '../acceso/navegacion';
import { useSesion } from '../acceso/sesion';
import { RUTA_PANEL_EN_CAJA } from './rutas';

/**
 * «Comprobantes» dentro de Caja (criterio 174): el Supervisor y el Cajero (con sus turnos) entran al panel desde su
 * pantalla de Caja, tengan o no el turno abierto. Sin el módulo de Facturación en el plan no aparece.
 */
export function EnlaceAComprobantes() {
  const { sesion } = useSesion();
  if (!veLosComprobantes(sesion)) return null;
  return (
    <Link to={RUTA_PANEL_EN_CAJA} className={claseBoton('secundario', true)}>
      <Icono icono={IconoCuenta} tamano={20} />
      Comprobantes
    </Link>
  );
}
