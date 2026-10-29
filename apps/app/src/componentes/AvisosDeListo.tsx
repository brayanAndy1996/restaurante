import { BannerDeEstado, claseBoton, IconoAvisoDeListo } from '@restaurante/ui';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { instalarAvisosDeListo, useAvisosDeListo } from '../lib/avisos-de-listo';
import { veElSalon } from '../modulos/acceso/navegacion';
import { useSesion } from '../modulos/acceso/sesion';

/**
 * Guarda los avisos de "Listo" de la persona de la sesión (criterio 98 de 004) mientras la app de empresa
 * está en pantalla, en cualquier pantalla. No dibuja nada; los avisos se ven en el banner y en la lista
 * "Avisos" del salón.
 */
export function AvisosDeListoDeSesion() {
  const { sesion } = useSesion();
  const usuarioId = sesion?.usuario?.id;
  const atiendeMesas = veElSalon(sesion);
  useEffect(() => {
    if (!usuarioId || !atiendeMesas) return;
    return instalarAvisosDeListo(usuarioId);
  }, [usuarioId, atiendeMesas]);
  return null;
}

/**
 * Banner del aviso más reciente, fuera del salón (dentro del salón ya está la lista "Avisos"). Se queda hasta
 * que la persona toca el aviso en el salón.
 */
export function BannerDeAvisosDeListo() {
  const avisos = useAvisosDeListo();
  const { pathname } = useLocation();
  const ultimo = avisos[0];
  if (!ultimo || pathname === '/salon') return null;
  const otros = avisos.length - 1;
  return (
    <BannerDeEstado
      tono="huacatay"
      icono={IconoAvisoDeListo}
      titulo={ultimo.texto}
      accion={
        <Link to="/salon" className={claseBoton('secundario')}>
          Ver avisos
        </Link>
      }
    >
      {otros > 0 ? `Y ${otros} ${otros === 1 ? 'aviso más' : 'avisos más'}.` : null}
    </BannerDeEstado>
  );
}
