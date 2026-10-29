import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { alCambiarLaIdentidad } from '../lib/identidad';
import { detenerTiempoReal, sincronizarTiempoReal } from '../lib/tiempo-real';
import { useSesion } from '../modulos/acceso/sesion';

/**
 * Mantiene abierta la conexión de tiempo real de la sesión mientras la app de empresa está en pantalla
 * (criterio 97 de 004). No dibuja nada. La conexión es de la sesión: se alinea cada vez que la sesión
 * avisa un cambio (ingreso, otra sucursal, cierre) y se cierra al salir de la app de empresa.
 */
export function TiempoRealDeSesion() {
  const cliente = useQueryClient();
  const { sesion } = useSesion();
  const sucursalId = sesion?.sucursal?.id;
  const usuarioId = sesion?.usuario?.id;

  useEffect(() => {
    sincronizarTiempoReal(cliente);
    return alCambiarLaIdentidad(() => sincronizarTiempoReal(cliente));
  }, [cliente, sucursalId, usuarioId]);

  useEffect(() => () => detenerTiempoReal(), []);
  return null;
}
