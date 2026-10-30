import { BannerDeEstado, claseBoton, IconoImpresora, IconoSinRed } from '@restaurante/ui';
import { Link, useLocation } from 'react-router-dom';
import { useConexion } from '../lib/conexion';
import { useSesion } from '../modulos/acceso/sesion';
import {
  avisoDeImpresion,
  textosDelAviso,
  useEstadoDeImpresion,
} from '../modulos/impresion/estado';

const RUTA_DE_IMPRESION = '/administracion/impresion';

/**
 * Aviso de impresión en todas las pantallas de la sucursal (criterios 122 y 138 de 004): el puente está
 * desconectado o sin señal, no hay puente, o una impresora no responde. Dice cuántos tickets quedan en cola.
 * Sale solo mientras dura el problema y no aparece si la sucursal no tiene impresoras. Se pide cada 30 s, se
 * reevalúa cada 15 s y se vuelve a pedir al instante con el evento `impresion.estado` o al crear una impresora. Sin conexión con la API no se muestra: lo dicho sería viejo
 * y el banner de «Sin conexión» ya explica lo que pasa.
 */
export function BannerDeImpresion() {
  const { sesion } = useSesion();
  const { sinConexion } = useConexion();
  const { pathname } = useLocation();
  const { estado, desdeLaRespuestaMs } = useEstadoDeImpresion(sesion?.sucursal?.id);
  if (!estado || sinConexion) return null;
  const aviso = avisoDeImpresion(estado, desdeLaRespuestaMs);
  if (!aviso) return null;
  const { titulo, detalle } = textosDelAviso(aviso);
  // Solo el Administrador puede arreglarlo (vincular el puente, revisar la impresora): los demás solo se enteran.
  const accion =
    sesion?.esAdministrador && pathname !== RUTA_DE_IMPRESION ? (
      <Link to={RUTA_DE_IMPRESION} className={claseBoton('secundario')}>
        Ver impresión
      </Link>
    ) : undefined;
  return (
    <BannerDeEstado
      tono="aji"
      icono={aviso.tipo === 'no-responden' ? IconoImpresora : IconoSinRed}
      titulo={titulo}
      accion={accion}
    >
      {detalle}
    </BannerDeEstado>
  );
}
