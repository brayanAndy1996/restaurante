import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { identidadActual } from '../../lib/identidad';
import { useEnvioPendiente, type ExtraDeEscritura } from '../../lib/envios';
import { mensajeDeError } from '../../lib/errores';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import {
  ahoraDeCocina,
  cambiarEstadoDeLinea,
  claveCocina,
  conComandaVista,
  conLineaEn,
  conTodoListo,
  consultarCocina,
  marcarTodoListo,
  marcarVista,
  prefijoCocina,
  type CocinaEnCache,
  type EstadoElegible,
} from './cocina';

/** Cada cuánto se vuelve a calcular el tiempo transcurrido de las comandas (los umbrales son de minutos). */
const PERIODO_DEL_RELOJ_MS = 10_000;

function enCache(respuesta: CocinaEnCache['cocina'], etag: string | null): CocinaEnCache {
  return {
    cocina: respuesta,
    etag,
    ahoraDelServidorMs: Date.parse(respuesta.ahora),
    recibidoEnMs: Date.now(),
  };
}

/**
 * Las comandas de la sucursal activa para las estaciones elegidas (`GET /cocina/comandas`).
 *
 * - Guarda el `ETag` junto al cuerpo y lo manda como `If-None-Match`: si nada cambió, 304 y no se baja nada.
 * - Con la conexión de tiempo real abierta la mantienen al día los eventos `cocina.*`; sin ella, se refresca
 *   cada 30 s en segundo plano (criterio 97) y al volver a la app.
 * - Solo la primera lectura cuenta como actividad de la persona; las demás mandan `X-Actividad:
 *   segundo-plano` (la sesión de Cocina/Barra vive 60 minutos sin toques, criterio 63b).
 * - Si una lectura falla, lo último que se vio sigue en pantalla (`isError` con `data` = "puede estar viejo").
 */
export function useCocina(sucursalId: string, estacionIds: readonly string[]) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const clave = claveCocina(sucursalId, estacionIds);
  return useQuery({
    queryKey: clave,
    enabled: sucursalId !== '',
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: async ({ signal }): Promise<CocinaEnCache> => {
      const previo = clientes.getQueryData<CocinaEnCache>(clave);
      const respuesta = await consultarCocina(
        estacionIds,
        previo?.etag ?? null,
        previo !== undefined,
        signal,
      );
      if (respuesta.cambio) return enCache(respuesta.datos, respuesta.etag);
      if (previo) return previo;
      // 304 sin nada guardado (la caché se vació a mitad de la consulta): se pide completa.
      const completa = await consultarCocina(estacionIds, null, false, signal);
      if (!completa.cambio) throw new Error('La cocina llegó vacía');
      return enCache(completa.datos, completa.etag);
    },
  });
}

/** La hora del servidor, repintada cada 10 s para que el tiempo de cada comanda avance sola. */
export function useAhoraDeCocina(datos: CocinaEnCache | undefined): number {
  const [, dibujar] = useState(0);
  useEffect(() => {
    const reloj = setInterval(() => dibujar((n) => n + 1), PERIODO_DEL_RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);
  return ahoraDeCocina(datos, Date.now());
}

/**
 * Las acciones de la cocina sobre las comandas: "Preparando", "Listo", "Todo listo" y "Enterado".
 *
 * - La pantalla responde al toque: el cambio se ve de inmediato y la API lo confirma después.
 * - Cada escritura va por `enviarSinPerder`: una clave de idempotencia, reintentos con la misma clave y
 *   "Pendiente de envío" mientras espera la red.
 * - Las acciones de una misma comanda salen en el orden en que se tocaron (tocar "Preparando" y enseguida
 *   "Listo" no debe terminar en "Preparando").
 * - Si la API rechaza (por ejemplo, 409), se vuelve a lo que dice el servidor y se explica en palabras.
 */
export function useAccionesDeCocina(sucursalId: string) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const [fallo, setFallo] = useState<string | null>(null);
  const [esperando, setEsperando] = useState<Readonly<Record<string, number>>>({});
  const cadenas = useRef(new Map<string, Promise<unknown>>());
  const prefijo = prefijoCocina(sucursalId);

  const aplicar = useCallback(
    (cambiar: (cocina: CocinaEnCache['cocina']) => CocinaEnCache['cocina']) => {
      clientes.setQueriesData<CocinaEnCache>({ queryKey: prefijo }, (previo) =>
        previo ? { ...previo, cocina: cambiar(previo.cocina) } : previo,
      );
    },
    // `prefijo` se arma de `sucursalId`; la lista no cambia de contenido entre pintados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientes, sucursalId],
  );

  /** Vuelve a pedir lo que dice el servidor, sin `If-None-Match` (lo provisional no coincide con su `ETag`). */
  const confirmar = useCallback(() => {
    clientes.setQueriesData<CocinaEnCache>({ queryKey: prefijo }, (previo) =>
      previo ? { ...previo, etag: null } : previo,
    );
    void clientes.invalidateQueries({ queryKey: prefijo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, sucursalId]);

  function ajustarEspera(comandaId: string, pendiente: boolean) {
    setEsperando((previos) => {
      const cuenta = Math.max(0, (previos[comandaId] ?? 0) + (pendiente ? 1 : -1));
      const { [comandaId]: _antes, ...resto } = previos;
      return cuenta === 0 ? resto : { ...resto, [comandaId]: cuenta };
    });
  }

  function encolar(comandaId: string, tarea: () => Promise<unknown>) {
    const previa = cadenas.current.get(comandaId) ?? Promise.resolve();
    const siguiente = previa.then(tarea, tarea);
    cadenas.current.set(comandaId, siguiente);
    const limpiar = () => {
      if (cadenas.current.get(comandaId) === siguiente) cadenas.current.delete(comandaId);
    };
    siguiente.then(limpiar, limpiar);
    return siguiente;
  }

  /** Muestra el cambio ya, lo manda, y al terminar (bien o mal) vuelve a leer lo que dice el servidor. */
  function pedir(
    comandaId: string,
    texto: string,
    provisional: (cocina: CocinaEnCache['cocina']) => CocinaEnCache['cocina'],
    escribir: (extra: ExtraDeEscritura) => Promise<unknown>,
  ) {
    setFallo(null);
    aplicar(provisional);
    // Quién lo pide y en qué sucursal se toma ahora, no cuando le toque el turno en la cadena.
    const origen = identidadActual();
    void encolar(comandaId, () =>
      envio.enviar(escribir, (pendiente) => ajustarEspera(comandaId, pendiente), origen),
    ).then(
      () => confirmar(),
      (error: unknown) => {
        if (envio.sigueMontada()) setFallo(`${texto}: ${mensajeDeError(error)}`);
        confirmar();
      },
    );
  }

  return {
    /** Hay algún cambio esperando la red. */
    pendiente: envio.pendiente,
    /** Ids de las comandas con un cambio esperando la red. */
    esperando,
    fallo,
    descartarFallo: () => setFallo(null),
    cambiarEstado(comandaId: string, lineaId: string, nombre: string, estado: EstadoElegible) {
      pedir(
        comandaId,
        `No pudimos marcar «${nombre}»`,
        (cocina) => conLineaEn(cocina, lineaId, estado),
        (extra) => cambiarEstadoDeLinea(lineaId, estado, extra),
      );
    },
    todoListo(comandaId: string, mesa: string) {
      pedir(
        comandaId,
        `No pudimos marcar todo listo en ${mesa}`,
        (cocina) => conTodoListo(cocina, comandaId),
        (extra) => marcarTodoListo(comandaId, extra),
      );
    },
    enterado(comandaId: string, mesa: string) {
      const vistaEn = new Date().toISOString();
      pedir(
        comandaId,
        `No pudimos marcar como enterado ${mesa}`,
        (cocina) => conComandaVista(cocina, comandaId, vistaEn),
        (extra) => marcarVista(comandaId, extra),
      );
    },
  };
}
