import {
  Aviso,
  BarraDeSesion,
  DialogoConfirmacion,
  IconoCambiar,
  IconoCelular,
  IconoOlvidar,
  IconoSalir,
  type AccionDeSesion,
} from '@restaurante/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { olvidarMiEquipo } from '../lib/equipo';
import { mensajeDeError } from '../lib/errores';
import { etiquetaDeRol } from '../lib/formato';
import { useSesion } from '../modulos/acceso/sesion';
import { elegirSucursal, MENSAJES_SUCURSAL } from '../modulos/acceso/sucursal';

/**
 * La barra de la sesión de la empresa (criterio 95): persona, rol y sucursal; "Cambiar usuario",
 * cambio de sucursal, "Mis equipos", "Olvidar este equipo" (con confirmación) y salida.
 */
export function BarraDeSesionApp() {
  const { sesion, salir, cambiarUsuario, soltarSesion, actualizarSesion, soporte } = useSesion();
  const navegar = useNavigate();
  const [confirmando, setConfirmando] = useState(false);
  const [olvidando, setOlvidando] = useState(false);
  const [errorAlOlvidar, setErrorAlOlvidar] = useState<string | null>(null);
  if (!sesion) return null;
  const nombre = sesion.usuario?.nombre ?? sesion.superadministrador?.nombre ?? 'Sesión';
  const rol = sesion.esAdministrador ? 'ADMINISTRADOR' : sesion.rol;
  const detalle = soporte ? `Soporte · ${etiquetaDeRol('ADMINISTRADOR')}` : etiquetaDeRol(rol);
  const esDePersona = sesion.tipo === 'CONTRASENA' || sesion.tipo === 'PIN';
  const recordada = esDePersona && sesion.equipo !== null;

  async function olvidarEsteEquipo() {
    const equipo = sesion?.equipo;
    if (!equipo) return;
    setOlvidando(true);
    setErrorAlOlvidar(null);
    try {
      await olvidarMiEquipo(equipo.equipoRecordadoId);
      setConfirmando(false);
      // El servidor cerró la sesión junto con el equipo; aquí solo se limpia este navegador.
      soltarSesion('/pin');
    } catch (error) {
      setErrorAlOlvidar(mensajeDeError(error));
    } finally {
      setOlvidando(false);
    }
  }

  const acciones: AccionDeSesion[] = [
    ...(recordada
      ? [
          {
            id: 'cambiar-usuario',
            etiqueta: 'Cambiar usuario',
            icono: IconoCambiar,
            principal: true,
            onSeleccionar: () => void cambiarUsuario(),
          },
        ]
      : []),
    ...(esDePersona
      ? [
          {
            id: 'mis-equipos',
            etiqueta: 'Mis equipos',
            icono: IconoCelular,
            onSeleccionar: () => navegar('/mis-equipos'),
          },
        ]
      : []),
    ...(recordada
      ? [
          {
            id: 'olvidar-equipo',
            etiqueta: 'Olvidar este equipo',
            icono: IconoOlvidar,
            peligro: true,
            onSeleccionar: () => {
              setErrorAlOlvidar(null);
              setConfirmando(true);
            },
          },
        ]
      : []),
    {
      id: 'salir',
      etiqueta: soporte ? 'Salir de la cuenta' : 'Salir',
      icono: IconoSalir,
      peligro: true,
      onSeleccionar: () => void salir(),
    },
  ];

  return (
    <>
      <BarraDeSesion
        persona={{ nombre, detalle }}
        sucursal={
          sesion.sucursal ? { id: sesion.sucursal.id, nombre: sesion.sucursal.nombre } : null
        }
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
        acciones={acciones}
      />
      <DialogoConfirmacion
        abierta={confirmando}
        titulo="Olvidar este equipo"
        etiquetaConfirmar="Olvidar este equipo"
        peligro
        cargando={olvidando}
        textoCargando="Olvidando…"
        error={
          errorAlOlvidar ? (
            <Aviso tipo="error" titulo="No pudimos hacerlo">
              {errorAlOlvidar}
            </Aviso>
          ) : null
        }
        onConfirmar={() => void olvidarEsteEquipo()}
        onCancelar={() => setConfirmando(false)}
      >
        Este equipo dejará de recordarte y se cerrará tu sesión. La próxima vez tendrás que ingresar
        con tu usuario y contraseña. Las demás personas de este equipo no se ven afectadas.
      </DialogoConfirmacion>
    </>
  );
}
