import { Cenefa } from '@restaurante/ui';
import { Navigate, Outlet } from 'react-router-dom';
import { BannerDeConexion } from '../../componentes/AvisosGlobales';
import { VigilanteDePlataforma } from '../acceso/inactividad';
import { useSesion } from '../acceso/sesion';
import { useConexion } from '../../lib/conexion';

/**
 * Marco del panel de plataforma: exige la sesión del superadministrador. La cenefa y la barra son de
 * tinta oscura, color que ninguna sucursal usa, para que nadie lo confunda con un restaurante.
 */
export function PlataformaLayout() {
  const { plataforma, salida } = useSesion();
  const { sinConexion } = useConexion();
  if (!plataforma) {
    return (
      <Navigate
        to={salida?.a ?? '/plataforma/ingreso'}
        replace
        {...(salida ? { state: salida.estado } : {})}
      />
    );
  }
  return (
    <div className="app">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <Cenefa estado={sinConexion ? 'sin-conexion' : 'plataforma'} />
      <div className="app__avisos">
        <BannerDeConexion />
      </div>
      <div className="app__marco">
        <main className="app__principal plataforma-contenido" id="contenido" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <VigilanteDePlataforma />
    </div>
  );
}
