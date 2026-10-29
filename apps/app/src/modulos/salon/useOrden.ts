import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ahoraDelServidor } from '../../lib/api';
import { CLAVES_TIEMPO_REAL, useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { consultarOrden, type OrdenEnCache } from './ordenes';

/** Cada cuánto se vuelve a calcular "abierta hace N min". */
const PERIODO_DEL_RELOJ_MS = 20_000;

/**
 * La cuenta de una mesa (`GET /ordenes/:id`).
 *
 * - Guarda el `ETag`, si la API lo manda, y lo pide como `If-None-Match`: si nada cambió, 304 y no se baja
 *   nada.
 * - Con la conexión de tiempo real abierta la mantienen al día los eventos (`orden.cambio`, `cocina.linea`,
 *   `cocina.listo`); sin ella, se refresca cada 30 s en segundo plano (criterio 97).
 * - Solo la primera lectura cuenta como actividad de la persona; las demás mandan `X-Actividad:
 *   segundo-plano`.
 * - Si una lectura falla, lo último que se vio sigue en pantalla.
 */
export function useOrden(ordenId: string) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  return useQuery({
    queryKey: CLAVES_TIEMPO_REAL.orden(ordenId),
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: async ({ signal }): Promise<OrdenEnCache> => {
      const previo = clientes.getQueryData<OrdenEnCache>(CLAVES_TIEMPO_REAL.orden(ordenId));
      const respuesta = await consultarOrden(
        ordenId,
        previo?.etag ?? null,
        previo !== undefined,
        signal,
      );
      if (respuesta.cambio) return { orden: respuesta.datos, etag: respuesta.etag };
      if (previo) return previo;
      // 304 sin nada guardado (la caché se vació a mitad de la consulta): se pide completa.
      const completa = await consultarOrden(ordenId, null, false, signal);
      if (!completa.cambio) throw new Error('La cuenta llegó vacía');
      return { orden: completa.datos, etag: completa.etag };
    },
  });
}

/** La hora del servidor, repintada cada 20 s para que "hace 25 min" avance sola. */
export function useAhoraDelServidor(): number {
  const [, dibujar] = useState(0);
  useEffect(() => {
    const reloj = setInterval(() => dibujar((n) => n + 1), PERIODO_DEL_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);
  return ahoraDelServidor();
}
