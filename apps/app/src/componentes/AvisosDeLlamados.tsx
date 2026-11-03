import { BannerDeEstado, claseBoton, IconoLlamarMozo } from '@restaurante/ui';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  instalarAvisosDeLlamados,
  quitarAvisoDeLlamado,
  quitarTodosLosAvisosDeLlamados,
  useAvisosDeLlamados,
  type AvisoDeLlamado,
} from '../lib/avisos-de-llamados';
import { useSesion } from '../modulos/acceso/sesion';
import { textoDeAvisoDeLlamado } from '../modulos/llamados/llamados';
import { useLlamados } from '../modulos/llamados/useLlamados';
import { rutaDeLlamado, rutaDeLlamados } from '../modulos/salon/salon';

/**
 * Avisos de llamados desde la mesa en cualquier pantalla (005, criterio 69). Guarda los avisos de la persona
 * de la sesión (solo si es destinataria, o si la mesa estaba libre), hace sonar y vibrar el equipo, y dibuja el
 * banner "Mesa 4 · Pedido (3 platos)" con "Ver". Se carga bajo demanda (`AppLayout` lo importa con `lazy`):
 * no cuenta en el paquete inicial.
 */
export function AvisosDeLlamados() {
  const { sesion } = useSesion();
  const usuarioId = sesion?.usuario?.id;
  useEffect(() => {
    if (!usuarioId) return;
    return instalarAvisosDeLlamados(usuarioId);
  }, [usuarioId]);
  const sucursalId = sesion?.sucursal?.id;
  if (!usuarioId || !sucursalId) return null;
  return <BannerDeLlamados sucursalId={sucursalId} />;
}

function BannerDeLlamados({ sucursalId }: { sucursalId: string }) {
  const avisos = useAvisosDeLlamados();
  const { pathname, search } = useLocation();
  // Dentro de la lista de llamados los pendientes ya están a la vista; en el detalle de un llamado, su aviso sobra.
  const enLaLista =
    pathname === '/salon' && new URLSearchParams(search).get('vista') === 'llamados';
  const visibles = enLaLista ? [] : avisos.filter((a) => pathname !== rutaDeLlamado(a.id));
  // Lo que la persona ya está mirando se da por visto: al salir de la lista no vuelve a aparecer el banner.
  useEffect(() => {
    if (enLaLista) quitarTodosLosAvisosDeLlamados();
    else
      avisos
        .filter((a) => pathname === rutaDeLlamado(a.id))
        .forEach((a) => quitarAvisoDeLlamado(a.id));
  }, [enLaLista, pathname, avisos]);
  const ultimo = visibles[0];
  if (!ultimo) return null;
  return <BannerDelUltimo ultimo={ultimo} otros={visibles.length - 1} sucursalId={sucursalId} />;
}

function BannerDelUltimo({
  ultimo,
  otros,
  sucursalId,
}: {
  ultimo: AvisoDeLlamado;
  otros: number;
  sucursalId: string;
}) {
  // Las unidades ("3 platos") no vienen en el evento: salen de la lista, que se pide mientras haya un aviso.
  const lista = useLlamados(sucursalId).data?.respuesta.llamados;
  const unidades = lista?.find((l) => l.id === ultimo.id)?.unidades ?? null;
  return (
    <BannerDeEstado
      tono="aji"
      compacto
      icono={IconoLlamarMozo}
      titulo={textoDeAvisoDeLlamado(ultimo.mesaNombre, ultimo.tipo, unidades)}
      accion={
        <Link
          to={otros > 0 ? rutaDeLlamados() : rutaDeLlamado(ultimo.id)}
          className={claseBoton('secundario')}
          onClick={() =>
            otros > 0 ? quitarTodosLosAvisosDeLlamados() : quitarAvisoDeLlamado(ultimo.id)
          }
        >
          Ver
        </Link>
      }
    >
      {otros > 0 ? `Y ${otros} ${otros === 1 ? 'llamado más' : 'llamados más'}.` : null}
    </BannerDeEstado>
  );
}
