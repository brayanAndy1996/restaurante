import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { veLosAvisosDeFacturacion } from '../modulos/acceso/navegacion';
import { useSesion } from '../modulos/acceso/sesion';

// Los avisos de la facturación (006, 6b) se bajan aparte y solo para quien los ve: no cuentan en el paquete inicial.
const AvisosDeFacturacion = lazy(() =>
  import('../modulos/facturacion/AvisosDeFacturacion').then((m) => ({
    default: m.AvisosDeFacturacion,
  })),
);

/** En Caja (su pantalla y su panel de comprobantes) y en Ajustes; no en pleno cobro, donde estorbarían. */
export function esPantallaDeAvisosDeFacturacion(ruta: string): boolean {
  return (
    ruta === '/caja' || ruta.startsWith('/caja/comprobantes') || ruta.startsWith('/administracion')
  );
}

/**
 * Pone los avisos de la facturación (criterio 175) en el marco, solo en Caja y Ajustes y solo para el Administrador y
 * el Supervisor con el módulo de Facturación en el plan. Para los demás no baja nada.
 */
export function AvisosDeFacturacionDeSesion() {
  const { sesion } = useSesion();
  const { pathname } = useLocation();
  if (!sesion?.sucursal || !veLosAvisosDeFacturacion(sesion)) return null;
  if (!esPantallaDeAvisosDeFacturacion(pathname)) return null;
  return (
    <Suspense fallback={null}>
      <AvisosDeFacturacion />
    </Suspense>
  );
}
