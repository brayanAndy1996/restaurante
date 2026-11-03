'use client';

import { useEffect } from 'react';
import { rutaCarta, urlApiPublica } from '@/lib/api';
import {
  INTERVALO_DISPONIBILIDAD_MS,
  EVENTO_DISPONIBILIDAD,
  aplicarDisponibilidad,
  esDisponibilidad,
} from '@/lib/disponibilidad';
import { actualizarHorario, type TablaDeHorario } from '@/lib/horario-vivo';

/**
 * Isla de disponibilidad (criterio 82, HU-09): con la página visible, consulta `GET …/disponibilidad` al cargar,
 * cada 15 segundos y al volver a la pestaña, con `If-None-Match` (un 304 no baja nada), y oculta lo que se agotó.
 * No dibuja nada: solo cambia el atributo `hidden` de lo que el servidor ya pintó. Sin red, deja lo último que
 * supo y vuelve a intentar en el turno siguiente. En el mismo ciclo, sin pasar por la red, elige de la tabla del
 * servidor el estado del horario que corresponde a la hora del navegador (criterio 81).
 */
export function Disponibilidad({
  empresa,
  sucursal,
  horario,
}: {
  empresa: string;
  sucursal: string;
  horario?: TablaDeHorario;
}) {
  useEffect(() => {
    const ruta = `${rutaCarta(empresa, sucursal)}/disponibilidad`;
    let etag: string | null = null;
    let consulta: AbortController | null = null;
    let temporizador: ReturnType<typeof setInterval> | undefined;

    async function consultar(): Promise<void> {
      if (horario && horario.filas.length > 0) actualizarHorario(document, horario);
      consulta?.abort();
      const actual = new AbortController();
      consulta = actual;
      try {
        const respuesta = await fetch(`${urlApiPublica()}${ruta}`, {
          headers: etag ? { 'If-None-Match': etag } : undefined,
          credentials: 'omit',
          signal: actual.signal,
        });
        if (respuesta.status === 304 || !respuesta.ok) return;
        const cuerpo: unknown = await respuesta.json();
        if (!esDisponibilidad(cuerpo)) return;
        etag = respuesta.headers.get('ETag');
        aplicarDisponibilidad(document, cuerpo);
        document.dispatchEvent(new CustomEvent(EVENTO_DISPONIBILIDAD, { detail: cuerpo }));
      } catch {
        // Sin red, una respuesta rota o una consulta reemplazada: se queda lo último y se reintenta después.
      }
    }

    function arrancar(): void {
      detener();
      void consultar();
      temporizador = setInterval(() => void consultar(), INTERVALO_DISPONIBILIDAD_MS);
    }

    function detener(): void {
      clearInterval(temporizador);
      temporizador = undefined;
    }

    function alCambiarVisibilidad(): void {
      if (document.visibilityState === 'visible') arrancar();
      else detener();
    }

    if (document.visibilityState === 'visible') arrancar();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      detener();
      consulta?.abort();
    };
  }, [empresa, sucursal, horario]);

  return null;
}
