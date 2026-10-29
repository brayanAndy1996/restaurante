import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './componentes/AppLayout';
import { AvisoDeEnvioCancelado } from './componentes/AvisoDeEnvioCancelado';
import { ErrorDeArranque, PantallaDeCarga } from './componentes/Pantallas';
import { instalarAvisoAlSalir } from './lib/envios';
import { CambiarContrasenaPagina } from './modulos/acceso/CambiarContrasenaPagina';
import { ElegirSucursalPagina } from './modulos/acceso/ElegirSucursalPagina';
import { IngresoPagina } from './modulos/acceso/IngresoPagina';
import { InicioPagina } from './modulos/acceso/InicioPagina';
import { PinPagina } from './modulos/acceso/PinPagina';
import { RecordarEquipoAutomatico } from './modulos/acceso/RecordarEquipo';
import { veElSalon, veLaCocina } from './modulos/acceso/navegacion';
import { usePermiso } from './modulos/acceso/permisos';
import { useSesion } from './modulos/acceso/sesion';
import { PlataformaIngresoPagina } from './modulos/plataforma/PlataformaIngresoPagina';
import { PlataformaLayout } from './modulos/plataforma/PlataformaLayout';

// La administración y el panel de plataforma se cargan bajo demanda: el paquete inicial queda liviano.
const UsuariosPagina = lazy(() =>
  import('./modulos/administracion/UsuariosPagina').then((m) => ({ default: m.UsuariosPagina })),
);
const UsuarioNuevoPagina = lazy(() =>
  import('./modulos/administracion/UsuarioFormularioPagina').then((m) => ({
    default: m.UsuarioNuevoPagina,
  })),
);
const UsuarioEditarPagina = lazy(() =>
  import('./modulos/administracion/UsuarioFormularioPagina').then((m) => ({
    default: m.UsuarioEditarPagina,
  })),
);
const MisEquiposPagina = lazy(() =>
  import('./modulos/acceso/MisEquiposPagina').then((m) => ({ default: m.MisEquiposPagina })),
);
const AccesoSucursalPagina = lazy(() =>
  import('./modulos/administracion/AccesoSucursalPagina').then((m) => ({
    default: m.AccesoSucursalPagina,
  })),
);
const MapaDeMesasPagina = lazy(() =>
  import('./modulos/administracion/mesas/MapaDeMesasPagina').then((m) => ({
    default: m.MapaDeMesasPagina,
  })),
);
const CartaPagina = lazy(() =>
  import('./modulos/carta/CartaPagina').then((m) => ({ default: m.CartaPagina })),
);
const ProductoNuevoPagina = lazy(() =>
  import('./modulos/carta/ProductoFormularioPagina').then((m) => ({
    default: m.ProductoNuevoPagina,
  })),
);
const ProductoEditarPagina = lazy(() =>
  import('./modulos/carta/ProductoFormularioPagina').then((m) => ({
    default: m.ProductoEditarPagina,
  })),
);
const GrupoNuevoPagina = lazy(() =>
  import('./modulos/carta/GrupoFormularioPagina').then((m) => ({ default: m.GrupoNuevoPagina })),
);
const GrupoEditarPagina = lazy(() =>
  import('./modulos/carta/GrupoFormularioPagina').then((m) => ({ default: m.GrupoEditarPagina })),
);
const DisponibilidadPagina = lazy(() =>
  import('./modulos/disponibilidad/DisponibilidadPagina').then((m) => ({
    default: m.DisponibilidadPagina,
  })),
);
const SalonPagina = lazy(() =>
  import('./modulos/salon/SalonPagina').then((m) => ({ default: m.SalonPagina })),
);
const OrdenPagina = lazy(() =>
  import('./modulos/salon/OrdenPagina').then((m) => ({ default: m.OrdenPagina })),
);
const CocinaPagina = lazy(() =>
  import('./modulos/cocina/CocinaPagina').then((m) => ({ default: m.CocinaPagina })),
);
// Solo en desarrollo: la ruta y su código no llegan al paquete de producción.
const ClaveSupervisorDemo = import.meta.env.DEV
  ? lazy(() =>
      import('./modulos/demostracion/ClaveSupervisorDemo').then((m) => ({
        default: m.ClaveSupervisorDemo,
      })),
    )
  : null;
const EmpresasPagina = lazy(() =>
  import('./modulos/plataforma/EmpresasPagina').then((m) => ({ default: m.EmpresasPagina })),
);
const EmpresaNuevaPagina = lazy(() =>
  import('./modulos/plataforma/EmpresaNuevaPagina').then((m) => ({
    default: m.EmpresaNuevaPagina,
  })),
);
const EmpresaDetallePagina = lazy(() =>
  import('./modulos/plataforma/EmpresaDetallePagina').then((m) => ({
    default: m.EmpresaDetallePagina,
  })),
);
const EmisorNuevoPagina = lazy(() =>
  import('./modulos/plataforma/EmisorNuevoPagina').then((m) => ({ default: m.EmisorNuevoPagina })),
);
const SucursalNuevaPagina = lazy(() =>
  import('./modulos/plataforma/SucursalNuevaPagina').then((m) => ({
    default: m.SucursalNuevaPagina,
  })),
);
const SuscripcionesPagina = lazy(() =>
  import('./modulos/plataforma/SuscripcionesPagina').then((m) => ({
    default: m.SuscripcionesPagina,
  })),
);
const SuscripcionDetallePagina = lazy(() =>
  import('./modulos/plataforma/SuscripcionDetallePagina').then((m) => ({
    default: m.SuscripcionDetallePagina,
  })),
);
const PlanesPagina = lazy(() =>
  import('./modulos/plataforma/PlanesPagina').then((m) => ({ default: m.PlanesPagina })),
);
const PlanNuevoPagina = lazy(() =>
  import('./modulos/plataforma/PlanFormularioPagina').then((m) => ({ default: m.PlanNuevoPagina })),
);
const PlanEditarPagina = lazy(() =>
  import('./modulos/plataforma/PlanFormularioPagina').then((m) => ({
    default: m.PlanEditarPagina,
  })),
);

/** Rutas que exigen una sesión de empresa válida, con las reglas de contraseña temporal y sucursal. */
function RutaDeEmpresa() {
  const { sesion, hayToken, cargando, errorDeCarga, reintentarCarga, salir, salida } = useSesion();
  const ubicacion = useLocation();
  if (!hayToken) {
    // Si la sesión se cerró (salida, inactividad, 401), la redirección lleva el aviso a donde corresponde.
    // Sin sesión se pasa por la pantalla de PIN, que decide: PIN si el equipo recuerda a alguien y, si
    // no, el ingreso con usuario y contraseña (criterio 92).
    return salida ? (
      <Navigate to={salida.a} replace state={salida.estado} />
    ) : (
      <Navigate to="/pin" replace state={{ desde: ubicacion.pathname }} />
    );
  }
  if (cargando) return <PantallaDeCarga />;
  if (errorDeCarga)
    return (
      <ErrorDeArranque
        error={errorDeCarga}
        onReintentar={reintentarCarga}
        onSalir={() => void salir()}
      />
    );
  if (!sesion) return <Navigate to="/pin" replace />;

  const enCambio = ubicacion.pathname === '/cambiar-contrasena';
  if (sesion.debeCambiarContrasena && !enCambio)
    return <Navigate to="/cambiar-contrasena" replace />;
  const enSucursal = ubicacion.pathname === '/sucursal';
  if (
    !sesion.debeCambiarContrasena &&
    !sesion.sucursal &&
    sesion.sucursales.length > 0 &&
    !enSucursal &&
    !enCambio
  ) {
    return <Navigate to="/sucursal" replace />;
  }
  return (
    <>
      <RecordarEquipoAutomatico />
      <Outlet />
    </>
  );
}

/** Solo el Administrador entra a la administración; los demás roles ni la ven en la navegación. */
function RutaDeAdministrador() {
  const { sesion } = useSesion();
  if (!sesion?.esAdministrador) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * La carta la edita quien tiene `EDITAR_CARTA` con su rol en la sucursal activa (Administrador y
 * Cajero). La guarda solo ordena la pantalla: la API decide.
 */
function RutaDeCarta() {
  const permiso = usePermiso('EDITAR_CARTA');
  if (permiso !== 'permitido') return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * La disponibilidad (agotados y menú del día) la gestiona quien tiene `GESTIONAR_DISPONIBILIDAD`
 * con su rol en la sucursal activa: Cocina/Barra, Supervisor y Administrador. La guarda solo ordena la
 * pantalla: la API decide.
 */
function RutaDeDisponibilidad() {
  const permiso = usePermiso('GESTIONAR_DISPONIBILIDAD');
  if (permiso !== 'permitido') return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * El salón lo ve quien tiene `ATENDER_MESA` con su rol en la sucursal activa y el módulo de Salón en su plan
 * (criterio 87 de 004). La guarda solo ordena la pantalla: la API decide.
 */
function RutaDeSalon() {
  const { sesion } = useSesion();
  if (!veElSalon(sesion)) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** La cocina la ve quien tiene `USAR_KDS` con su rol en la sucursal activa y el módulo de Cocina en su plan. */
function RutaDeCocina() {
  const { sesion } = useSesion();
  if (!veLaCocina(sesion)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Cargando() {
  return <PantallaDeCarga />;
}

export function App() {
  // La cola de envíos pendientes vive en memoria: recargar o cerrar la pestaña los perdería.
  useEffect(() => instalarAvisoAlSalir(), []);
  return (
    <>
      <AvisoDeEnvioCancelado />
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/pin" element={<PinPagina />} />
          <Route path="/ingreso" element={<IngresoPagina />} />
          <Route path="/plataforma/ingreso" element={<PlataformaIngresoPagina />} />
          <Route path="/plataforma" element={<PlataformaLayout />}>
            <Route index element={<EmpresasPagina />} />
            <Route path="empresas/nueva" element={<EmpresaNuevaPagina />} />
            <Route path="empresas/:id" element={<EmpresaDetallePagina />} />
            <Route path="empresas/:id/emisores/nuevo" element={<EmisorNuevoPagina />} />
            <Route path="empresas/:id/sucursales/nueva" element={<SucursalNuevaPagina />} />
            <Route path="suscripciones" element={<SuscripcionesPagina />} />
            <Route path="suscripciones/:id" element={<SuscripcionDetallePagina />} />
            <Route path="planes" element={<PlanesPagina />} />
            <Route path="planes/nuevo" element={<PlanNuevoPagina />} />
            <Route path="planes/:id" element={<PlanEditarPagina />} />
          </Route>

          <Route element={<RutaDeEmpresa />}>
            <Route path="/cambiar-contrasena" element={<CambiarContrasenaPagina />} />
            <Route path="/sucursal" element={<ElegirSucursalPagina />} />
            <Route element={<AppLayout />}>
              <Route index element={<InicioPagina />} />
              <Route path="/mis-equipos" element={<MisEquiposPagina />} />
              {ClaveSupervisorDemo ? (
                <Route path="/demo/clave-supervisor" element={<ClaveSupervisorDemo />} />
              ) : null}
              <Route element={<RutaDeSalon />}>
                <Route path="/salon" element={<SalonPagina />} />
                <Route path="/salon/ordenes/:id" element={<OrdenPagina />} />
              </Route>
              <Route element={<RutaDeCocina />}>
                <Route path="/cocina" element={<CocinaPagina />} />
              </Route>
              <Route element={<RutaDeCarta />}>
                <Route path="/carta" element={<CartaPagina />} />
                <Route path="/carta/productos/nuevo" element={<ProductoNuevoPagina />} />
                <Route path="/carta/productos/:id" element={<ProductoEditarPagina />} />
                <Route path="/carta/grupos/nuevo" element={<GrupoNuevoPagina />} />
                <Route path="/carta/grupos/:id" element={<GrupoEditarPagina />} />
              </Route>
              <Route element={<RutaDeDisponibilidad />}>
                <Route path="/disponibilidad" element={<DisponibilidadPagina />} />
              </Route>
              <Route element={<RutaDeAdministrador />}>
                <Route
                  path="/administracion"
                  element={<Navigate to="/administracion/usuarios" replace />}
                />
                <Route path="/administracion/usuarios" element={<UsuariosPagina />} />
                <Route path="/administracion/usuarios/nuevo" element={<UsuarioNuevoPagina />} />
                <Route path="/administracion/usuarios/:id" element={<UsuarioEditarPagina />} />
                <Route path="/administracion/acceso" element={<AccesoSucursalPagina />} />
                <Route path="/administracion/mesas" element={<MapaDeMesasPagina />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
