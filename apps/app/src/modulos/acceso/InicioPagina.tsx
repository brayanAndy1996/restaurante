import { claseBoton, EstadoVacio, IconoUsuarios, Icono, IconoCelular } from '@restaurante/ui';
import { Link, Navigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { etiquetaDeRol } from '../../lib/formato';
import { destinoInicial } from './navegacion';
import { useSesion, useSesionActiva } from './sesion';

/**
 * Inicio. Quien atiende mesas entra en "Salón" y quien solo usa la cocina, en "Cocina" (criterio 87 de
 * 004). Esta pantalla queda para quien no tiene ni una ni otra (por ejemplo, el plan de la sucursal no
 * incluye esos módulos): dice quién eres y dónde estás, y a dónde ir.
 */
export function InicioPagina() {
  const sesion = useSesionActiva();
  const { soporte } = useSesion();
  const inicial = destinoInicial(sesion);
  if (inicial) return <Navigate to={inicial} replace />;
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
        titulo="No hay pantallas de atención para ti aquí"
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
          ? 'El salón y la cocina dependen de tu rol y del plan de la sucursal. Mientras tanto puedes administrar a tu personal.'
          : 'El salón y la cocina dependen de tu rol y del plan de la sucursal. Si crees que falta algo, avisa a tu administrador.'}
      </EstadoVacio>
      {import.meta.env.DEV ? (
        <Link to="/demo/clave-supervisor" className="enlace-texto">
          Demostración de la clave de supervisor (solo desarrollo)
        </Link>
      ) : null}
    </Pagina>
  );
}
