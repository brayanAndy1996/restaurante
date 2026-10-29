import {
  Cenefa,
  ContenidoDeDestino,
  IconoAjustes,
  IconoCarta,
  IconoCocina,
  IconoDisponibilidad,
  IconoInicio,
  IconoSalon,
  Navegacion,
  type LucideIcon,
} from '@restaurante/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { VigilanteDeInactividad } from '../modulos/acceso/inactividad';
import { destinosDeNavegacion, type IdDeDestino } from '../modulos/acceso/navegacion';
import { useSesion } from '../modulos/acceso/sesion';
import {
  BannerDeConexion,
  BannerDeSoporte,
  BannerDeSuscripcion,
  useEstadoDeCenefa,
} from './AvisosGlobales';
import { TiempoRealDeSesion } from './TiempoRealDeSesion';

const ICONO_DE_DESTINO: Record<IdDeDestino, LucideIcon> = {
  inicio: IconoInicio,
  salon: IconoSalon,
  cocina: IconoCocina,
  carta: IconoCarta,
  disponibilidad: IconoDisponibilidad,
  ajustes: IconoAjustes,
};

/**
 * Marco de la app de empresa: cenefa y banners de estado arriba (siempre en el mismo lugar), el
 * contenido que se desplaza, y la navegación abajo en celular o en un riel desde 768 px. Los destinos
 * salen del rol y del plan de la sucursal (criterio 87 de 004). También mantiene abierta la conexión de
 * tiempo real de la sesión.
 */
export function AppLayout() {
  const { sesion } = useSesion();
  const estado = useEstadoDeCenefa();
  const destinos = destinosDeNavegacion(sesion);
  // "Disponibilidad" no cabe en el riel de 72 px: con ese destino el riel mide 96.
  const rielAncho = destinos.some((d) => d.id === 'disponibilidad');
  return (
    <div className={rielAncho ? 'app app--riel-ancho' : 'app'}>
      <TiempoRealDeSesion />
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
              <NavLink key={d.id} to={d.a} end={d.fin} className="ui-nav__destino">
                <ContenidoDeDestino icono={ICONO_DE_DESTINO[d.id]} etiqueta={d.etiqueta} />
              </NavLink>
            ))}
          </Navegacion>
        ) : null}
      </div>
    </div>
  );
}
