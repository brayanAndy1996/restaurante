import { BarraDeSesion, IconoSalir } from '@restaurante/ui';
import { useNavigate } from 'react-router-dom';
import { mensajeDeError } from '../lib/errores';
import { etiquetaDeRol } from '../lib/formato';
import { useSesion } from '../modulos/acceso/sesion';
import { elegirSucursal, MENSAJES_SUCURSAL } from '../modulos/acceso/sucursal';

/** La barra de la sesión de la empresa: persona, rol, sucursal, cambio de sucursal y salida. */
export function BarraDeSesionApp() {
  const { sesion, salir, actualizarSesion, soporte } = useSesion();
  const navegar = useNavigate();
  if (!sesion) return null;
  const nombre = sesion.usuario?.nombre ?? sesion.superadministrador?.nombre ?? 'Sesión';
  const rol = sesion.esAdministrador ? 'ADMINISTRADOR' : sesion.rol;
  const detalle = soporte ? `Soporte · ${etiquetaDeRol('ADMINISTRADOR')}` : etiquetaDeRol(rol);
  return (
    <BarraDeSesion
      persona={{ nombre, detalle }}
      sucursal={sesion.sucursal ? { id: sesion.sucursal.id, nombre: sesion.sucursal.nombre } : null}
      sucursales={sesion.sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        detalle: etiquetaDeRol(s.rol),
      }))}
      onElegirSucursal={(id) => {
        elegirSucursal(id)
          .then((nueva) => actualizarSesion(nueva))
          .catch((error: unknown) =>
            navegar('/sucursal', { state: { error: mensajeDeError(error, MENSAJES_SUCURSAL) } }),
          );
      }}
      acciones={[
        {
          id: 'salir',
          etiqueta: soporte ? 'Salir de la cuenta' : 'Salir',
          icono: IconoSalir,
          peligro: true,
          onSeleccionar: () => void salir(),
        },
      ]}
    />
  );
}
