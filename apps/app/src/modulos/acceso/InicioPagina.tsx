import { claseBoton, EstadoVacio, IconoUsuarios, Icono, IconoCelular } from '@restaurante/ui';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { etiquetaDeRol } from '../../lib/formato';
import { useSesion, useSesionActiva } from './sesion';

/** Inicio: de momento solo dice quién eres y dónde estás; las mesas, la cocina y la caja llegan después. */
export function InicioPagina() {
  const sesion = useSesionActiva();
  const { soporte } = useSesion();
  const nombre =
    sesion.usuario?.nombre.split(' ')[0] ?? sesion.superadministrador?.nombre.split(' ')[0] ?? '';
  const rol = sesion.esAdministrador ? 'ADMINISTRADOR' : sesion.rol;
  return (
    <Pagina titulo="Inicio">
      <div>
        <h2 className="ui-titulo">
          {soporte
            ? `Estás en la cuenta de ${soporte.empresaNombre}`
            : nombre
              ? `Hola, ${nombre}`
              : 'Hola'}
        </h2>
        <p className="ui-subtitulo">
          {soporte ? 'Das soporte como administrador' : etiquetaDeRol(rol)}
          {sesion.sucursal ? ` en ${sesion.sucursal.nombre}` : ''}
        </p>
      </div>
      <EstadoVacio
        icono={IconoCelular}
        titulo="Aquí irán tus mesas y pedidos"
        accion={
          sesion.esAdministrador ? (
            <Link to="/administracion/usuarios" className={claseBoton('principal')}>
              <Icono icono={IconoUsuarios} tamano={20} />
              Administrar usuarios
            </Link>
          ) : undefined
        }
      >
        {sesion.esAdministrador
          ? 'La atención de mesas, la cocina y la caja llegan en las siguientes versiones. Por ahora puedes administrar a tu personal.'
          : 'La atención de mesas, la cocina y la caja llegan en las siguientes versiones.'}
      </EstadoVacio>
    </Pagina>
  );
}
