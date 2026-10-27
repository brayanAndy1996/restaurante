import {
  Cenefa,
  ContenidoDeDestino,
  IconoEmpresa,
  IconoPlan,
  IconoSuscripcion,
  Navegacion,
} from '@restaurante/ui';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BannerDeConexion } from '../../componentes/AvisosGlobales';
import { VigilanteDePlataforma } from '../acceso/inactividad';
import { useSesion } from '../acceso/sesion';
import { useConexion } from '../../lib/conexion';

const DESTINOS = [
  {
    a: '/plataforma',
    etiqueta: 'Empresas',
    icono: IconoEmpresa,
    // Las pantallas de una empresa (alta, detalle, emisores y sucursales) siguen siendo "Empresas".
    activo: (ruta: string) => ruta === '/plataforma' || ruta.startsWith('/plataforma/empresas'),
  },
  {
    a: '/plataforma/suscripciones',
    etiqueta: 'Suscripciones',
    icono: IconoSuscripcion,
    activo: (ruta: string) => ruta.startsWith('/plataforma/suscripciones'),
  },
  {
    a: '/plataforma/planes',
    etiqueta: 'Planes',
    icono: IconoPlan,
    activo: (ruta: string) => ruta.startsWith('/plataforma/planes'),
  },
] as const;

/**
 * Marco del panel de plataforma: exige la sesión del superadministrador. La cenefa y la barra son de
 * tinta oscura, color que ninguna sucursal usa, para que nadie lo confunda con un restaurante.
 */
export function PlataformaLayout() {
  const { plataforma, salida } = useSesion();
  const { sinConexion } = useConexion();
  const { pathname } = useLocation();
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
    <div className="app app--plataforma">
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
        <Navegacion etiqueta="Plataforma">
          {DESTINOS.map((d) => (
            <Link
              key={d.a}
              to={d.a}
              className="ui-nav__destino"
              aria-current={d.activo(pathname) ? 'page' : undefined}
            >
              <ContenidoDeDestino icono={d.icono} etiqueta={d.etiqueta} />
            </Link>
          ))}
        </Navegacion>
      </div>
      <VigilanteDePlataforma />
    </div>
  );
}
