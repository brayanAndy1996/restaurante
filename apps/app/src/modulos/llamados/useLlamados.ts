import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import {
  ahoraDeLlamados,
  claveDetalleDeLlamado,
  claveListaDeLlamados,
  consultarLlamado,
  consultarLlamados,
  type LlamadosEnCache,
} from './llamados';

/** Cada cuánto se vuelve a calcular "vence en N min" y qué pendientes ya vencieron (con el reloj del servidor). */
const PERIODO_DEL_RELOJ_MS = 10_000;

function enCache(datos: Awaited<ReturnType<typeof consultarLlamados>>): LlamadosEnCache | null {
  if (!datos.cambio) return null;
  return {
    respuesta: datos.datos,
    etag: datos.etag,
    ahoraDelServidorMs: Date.parse(datos.datos.ahora),
    recibidoEnMs: Date.now(),
  };
}

/**
 * La lista de llamados de la sucursal activa (`GET /llamados`, criterios 39 y 70).
 *
 * - Guarda el `ETag` y lo manda como `If-None-Match`: si nada cambió, 304 y no se baja nada.
 * - Con la conexión de tiempo real abierta la mantienen al día `llamado.nuevo` y `llamado.cambio`; sin ella
 *   se refresca cada 30 s en segundo plano (criterio 97 de 004), y al volver a la app.
 * - Solo la primera lectura cuenta como actividad de la persona; las demás mandan `X-Actividad: segundo-plano`.
 * - Si una lectura falla, lo último que se vio sigue en pantalla.
 */
export function useLlamados(sucursalId: string) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  return useQuery({
    queryKey: claveListaDeLlamados(sucursalId),
    enabled: sucursalId !== '',
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: async ({ signal }): Promise<LlamadosEnCache> => {
      const previo = clientes.getQueryData<LlamadosEnCache>(claveListaDeLlamados(sucursalId));
      const nuevo = enCache(
        await consultarLlamados(previo?.etag ?? null, previo !== undefined, signal),
      );
      if (nuevo) return nuevo;
      if (previo) return previo;
      // 304 sin nada guardado (la caché se vació a mitad de la consulta): se pide completa.
      const completa = enCache(await consultarLlamados(null, false, signal));
      if (!completa) throw new Error('La lista de llamados llegó vacía');
      return completa;
    },
  });
}

/** El detalle de un llamado con la revisión de sus líneas (`GET /llamados/:id`, criterio 40). */
export function useDetalleDeLlamado(llamadoId: string) {
  const sondeo = useIntervaloDeSondeo();
  return useQuery({
    queryKey: claveDetalleDeLlamado(llamadoId),
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: ({ signal }) => consultarLlamado(llamadoId, false, signal),
  });
}

/** La hora del servidor, repintada cada 10 s para que "vence en 12 min" avance y los vencidos salgan de pendientes. */
export function useAhoraDeLlamados(datos: LlamadosEnCache | undefined): number {
  const [, dibujar] = useState(0);
  useEffect(() => {
    const reloj = setInterval(() => dibujar((n) => n + 1), PERIODO_DEL_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);
  return ahoraDeLlamados(datos, Date.now());
}
