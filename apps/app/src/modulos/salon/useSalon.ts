import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { ahoraDelSalon, claveSalon, consultarSalon, type SalonEnCache } from './salon';

/** Cada cuánto se vuelve a calcular "hace N min" (los minutos cambian despacio). */
const PERIODO_DEL_RELOJ_MS = 20_000;

/**
 * El mapa del salón de la sucursal activa (`GET /salon`).
 *
 * - Guarda el `ETag` junto al cuerpo y lo manda como `If-None-Match`: si nada cambió, 304 y no se baja nada.
 * - Con la conexión de tiempo real abierta lo mantienen al día los eventos (`salon.cambio`, `orden.cambio`);
 *   sin ella, lo refresca cada 30 s en segundo plano (criterio 97), y al volver a la app.
 * - Solo la primera lectura cuenta como actividad de la persona; las demás (eventos, sondeo) mandan
 *   `X-Actividad: segundo-plano` para no mantener viva una sesión que nadie usa.
 * - Si una lectura falla, lo último que se vio sigue en pantalla (`isError` con `data` = "puede estar viejo").
 */
export function useSalon(sucursalId: string) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  return useQuery({
    queryKey: claveSalon(sucursalId),
    enabled: sucursalId !== '',
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: async ({ signal }): Promise<SalonEnCache> => {
      const previo = clientes.getQueryData<SalonEnCache>(claveSalon(sucursalId));
      const respuesta = await consultarSalon(previo?.etag ?? null, previo !== undefined, signal);
      if (respuesta.cambio) {
        return {
          salon: respuesta.datos,
          etag: respuesta.etag,
          ahoraDelServidorMs: Date.parse(respuesta.datos.ahora),
          recibidoEnMs: Date.now(),
        };
      }
      if (previo) return previo;
      // 304 sin nada guardado (la caché se vació a mitad de la consulta): se pide completa.
      const completa = await consultarSalon(null, false, signal);
      if (!completa.cambio) throw new Error('El salón llegó vacío');
      return {
        salon: completa.datos,
        etag: completa.etag,
        ahoraDelServidorMs: Date.parse(completa.datos.ahora),
        recibidoEnMs: Date.now(),
      };
    },
  });
}

/** La hora del servidor, calculada con el reloj de este equipo solo para medir lo que pasó desde la respuesta. */
export function useAhoraDelSalon(datos: SalonEnCache | undefined): number {
  const [, dibujar] = useState(0);
  useEffect(() => {
    const reloj = setInterval(() => dibujar((n) => n + 1), PERIODO_DEL_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);
  return ahoraDelSalon(datos, Date.now());
}
