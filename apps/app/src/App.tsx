import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './componentes/AppLayout';
import { ErrorDeArranque, PantallaDeCarga } from './componentes/Pantallas';
import { CambiarContrasenaPagina } from './modulos/acceso/CambiarContrasenaPagina';
import { ElegirSucursalPagina } from './modulos/acceso/ElegirSucursalPagina';
import { IngresoPagina } from './modulos/acceso/IngresoPagina';
import { InicioPagina } from './modulos/acceso/InicioPagina';
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
const EmpresasPagina = lazy(() =>
  import('./modulos/plataforma/EmpresasPagina').then((m) => ({ default: m.EmpresasPagina })),
);

/** Rutas que exigen una sesión de empresa válida, con las reglas de contraseña temporal y sucursal. */
function RutaDeEmpresa() {
  const { sesion, hayToken, cargando, errorDeCarga, reintentarCarga, salir, salida } = useSesion();
  const ubicacion = useLocation();
  if (!hayToken) {
    // Si la sesión se cerró (salida, inactividad, 401), la redirección lleva el aviso a donde corresponde.
    return salida ? (
      <Navigate to={salida.a} replace state={salida.estado} />
    ) : (
      <Navigate to="/ingreso" replace state={{ desde: ubicacion.pathname }} />
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
  if (!sesion) return <Navigate to="/ingreso" replace />;

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
  return <Outlet />;
}

/** Solo el Administrador entra a la administración; los demás roles ni la ven en la navegación. */
function RutaDeAdministrador() {
  const { sesion } = useSesion();
  if (!sesion?.esAdministrador) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Cargando() {
  return <PantallaDeCarga />;
}

export function App() {
  return (
    <>
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/ingreso" element={<IngresoPagina />} />
          <Route path="/plataforma/ingreso" element={<PlataformaIngresoPagina />} />
          <Route path="/plataforma" element={<PlataformaLayout />}>
            <Route index element={<EmpresasPagina />} />
          </Route>

          <Route element={<RutaDeEmpresa />}>
            <Route path="/cambiar-contrasena" element={<CambiarContrasenaPagina />} />
            <Route path="/sucursal" element={<ElegirSucursalPagina />} />
            <Route element={<AppLayout />}>
              <Route index element={<InicioPagina />} />
              <Route element={<RutaDeAdministrador />}>
                <Route path="/administracion/usuarios" element={<UsuariosPagina />} />
                <Route path="/administracion/usuarios/nuevo" element={<UsuarioNuevoPagina />} />
                <Route path="/administracion/usuarios/:id" element={<UsuarioEditarPagina />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
