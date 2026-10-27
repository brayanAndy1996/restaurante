import {
  Cenefa,
  ContenidoDeDestino,
  IconoCandado,
  IconoInicio,
  IconoUsuarios,
  Navegacion,
} from '@restaurante/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { VigilanteDeInactividad } from '../modulos/acceso/inactividad';
import { useSesion } from '../modulos/acceso/sesion';
import {
  BannerDeConexion,
  BannerDeSoporte,
  BannerDeSuscripcion,
  useEstadoDeCenefa,
} from './AvisosGlobales';

/**
 * Marco de la app de empresa: cenefa y banners de estado arriba (siempre en el mismo lugar), el
 * contenido que se desplaza, y la navegación abajo en celular o en un riel de 72 px desde 768 px.
 */
export function AppLayout() {
  const { sesion } = useSesion();
  const estado = useEstadoDeCenefa();
  const destinos = [
    { a: '/', etiqueta: 'Inicio', icono: IconoInicio, fin: true },
    ...(sesion?.esAdministrador
      ? [
          { a: '/administracion/usuarios', etiqueta: 'Usuarios', icono: IconoUsuarios, fin: false },
          { a: '/administracion/acceso', etiqueta: 'Acceso', icono: IconoCandado, fin: false },
        ]
      : []),
  ];
  return (
    <div className="app">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <Cenefa estado={estado} />
      <div className="app__avisos">
        <BannerDeConexion />
        <BannerDeSoporte />
        <BannerDeSuscripcion />
        <VigilanteDeInactividad />
      </div>
      <div className="app__marco">
        <main className="app__principal" id="contenido" tabIndex={-1}>
          <Outlet />
        </main>
        {destinos.length > 1 ? (
          <Navegacion etiqueta="Principal">
            {destinos.map((d) => (
              <NavLink key={d.a} to={d.a} end={d.fin} className="ui-nav__destino">
                <ContenidoDeDestino icono={d.icono} etiqueta={d.etiqueta} />
              </NavLink>
            ))}
          </Navegacion>
        ) : null}
      </div>
    </div>
  );
}
