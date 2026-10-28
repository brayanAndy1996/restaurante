import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ahoraDelServidor } from '../../lib/api';
import {
  CLAVES_DISPONIBILIDAD,
  PERIODO_DE_REFRESCO_MS,
  consultarCartaSucursal,
  type VistaEnCache,
} from './disponibilidad';

/**
 * La vista de la carta de la sucursal activa (`GET /carta/sucursal`), compartida por "Agotados" y por el
 * "Menú del día" (que la usa para decir por qué un plato no está disponible).
 *
 * - Guarda el `ETag` junto a la vista y lo manda como `If-None-Match`: si nada cambió, el servidor
 *   responde 304 y se conserva lo que ya hay, sin bajar el cuerpo (criterio 49).
 * - Con `refrescar`, la vuelve a pedir cada 15 segundos en segundo plano (`X-Actividad: segundo-plano`: no
 *   renueva la inactividad) y al volver a la pestaña (criterio 80). Es la forma de que dos equipos de
 *   cocina vean lo mismo hasta que llegue el tiempo real de la sección 3 (decisión 2).
 * - Si una consulta falla, la vista anterior sigue en pantalla; `isError` con `data` = "puede estar vieja".
 */
export function useVistaDeSucursal(
  sucursalId: string,
  { refrescar = true, habilitada = true }: { refrescar?: boolean; habilitada?: boolean } = {},
) {
  const clientes = useQueryClient();
  return useQuery({
    queryKey: CLAVES_DISPONIBILIDAD.vista(sucursalId),
    enabled: sucursalId !== '' && habilitada,
    staleTime: 0,
    refetchInterval: refrescar ? PERIODO_DE_REFRESCO_MS : false,
    refetchOnWindowFocus: refrescar ? 'always' : false,
    queryFn: async ({ signal }): Promise<VistaEnCache> => {
      const previo = clientes.getQueryData<VistaEnCache>(CLAVES_DISPONIBILIDAD.vista(sucursalId));
      const respuesta = await consultarCartaSucursal(
        previo?.etag ?? null,
        previo !== undefined,
        signal,
      );
      if (respuesta.cambio) {
        return { vista: respuesta.datos, etag: respuesta.etag, actualizadaEn: ahoraDelServidor() };
      }
      if (previo) return { ...previo, actualizadaEn: ahoraDelServidor() };
      // 304 sin nada guardado (la caché se vació a mitad de la consulta): se pide completa.
      const completa = await consultarCartaSucursal(null, false, signal);
      if (!completa.cambio) throw new Error('La vista llegó vacía');
      return { vista: completa.datos, etag: completa.etag, actualizadaEn: ahoraDelServidor() };
    },
  });
}
