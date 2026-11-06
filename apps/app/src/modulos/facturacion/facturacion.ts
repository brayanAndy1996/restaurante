import {
  alertasRespuestaSchema,
  comprobanteDetalleSchema,
  type AlertasRespuesta,
  type ComprobanteDetalle,
  type EnvioPseRespuesta,
} from '@restaurante/contratos';
import type { TipoAviso } from '@restaurante/ui';
import { api } from '../../lib/api';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';

/**
 * La facturación electrónica en la PWA (historia 006, entrega 6b, criterios 173 a 175): lo que SUNAT sabe de cada
 * comprobante, las alertas del envío y los textos con que se dicen. Aquí van las llamadas a la API, las claves de las
 * consultas (cuelgan de `['facturacion']`, que invalidan `comprobante.estado` y `facturacion.alerta`) y las palabras.
 * Ningún monto se calcula aquí.
 */

// --- Claves de las consultas --------------------------------------------------------------------------

export const claveComprobante = (comprobanteId: string) =>
  CLAVES_TIEMPO_REAL.facturacionComprobante(comprobanteId);
export const claveAlertas = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.facturacionAlertas, sucursalId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------------

/** El comprobante con su envío y sus intentos (`GET /facturacion/comprobantes/:id`, criterio 135). */
export const leerComprobante = (comprobanteId: string, senal?: AbortSignal) =>
  api.get<ComprobanteDetalle>(`/facturacion/comprobantes/${comprobanteId}`, {
    esquema: comprobanteDetalleSchema,
    ...(senal ? { senal } : {}),
  });

/** Los conteos de alertas del alcance de quien pregunta, y si algún emisor está en modo simulado (criterio 133). */
export const leerAlertas = (senal?: AbortSignal) =>
  api.get<AlertasRespuesta>('/facturacion/alertas', {
    esquema: alertasRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

// --- Rutas ------------------------------------------------------------------------------------------------

/** El panel de comprobantes de Caja (Supervisor y Cajero) y el de Ajustes (Administrador). */
export const RUTA_PANEL_EN_CAJA = '/caja/comprobantes';
export const RUTA_PANEL_EN_AJUSTES = '/administracion/comprobantes';

export const rutaDelDetalle = (base: string, comprobanteId: string) => `${base}/${comprobanteId}`;

// --- Palabras ---------------------------------------------------------------------------------------------

/** "1 comprobante rechazado", "2 comprobantes rechazados". */
const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * El resumen de las alertas en una línea («2 comprobantes rechazados · 1 pendiente hace más de 30 minutos»), o `null`
 * si no hay ninguna. No incluye los de «sin configurar»: eso es otro aviso, con otra solución.
 */
export function resumenDeAlertas(alertas: AlertasRespuesta): string | null {
  const partes = [
    alertas.rechazados > 0
      ? cuantos(alertas.rechazados, 'comprobante rechazado', 'comprobantes rechazados')
      : null,
    alertas.demorados > 0
      ? `${alertas.demorados} ${alertas.demorados === 1 ? 'pendiente' : 'pendientes'} hace más de 30 minutos`
      : null,
    alertas.detenidos > 0 ? cuantos(alertas.detenidos, 'envío detenido', 'envíos detenidos') : null,
  ].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** El aviso de cuando el emisor no tiene su facturación activada (criterio 122). */
export const TEXTO_SIN_ACTIVAR =
  'La facturación electrónica de este RUC no está activada: pide a soporte que la active.';

/** El aviso permanente del modo simulado (criterio 122): «Facturación en modo simulado: los comprobantes no van a SUNAT». */
export const TITULO_MODO_SIMULADO = 'Facturación en modo simulado';
export const DETALLE_MODO_SIMULADO = 'Los comprobantes no van a SUNAT.';

/** El estado de un comprobante dicho en palabras, con el tono con que se muestra. */
export interface DescripcionDeEstado {
  /** `info`: en camino; `ok`: aceptado; `error`: rechazado; `alerta`: pide atención; `neutro`: anulado. */
  tono: TipoAviso | 'neutro';
  titulo: string;
  detalle?: string;
  /** El comprobante ya no cambia por sí solo (aceptado, rechazado o anulado): no hace falta volver a preguntar. */
  final: boolean;
}

/**
 * Lo que SUNAT sabe del comprobante y, si sigue en camino, cómo va el envío (criterios 127 y 173): «Enviando a
 * SUNAT…», «Aceptado por SUNAT», «Rechazado: <mensaje>». Un envío detenido o sin configurar se dice aparte, porque
 * no se arregla esperando.
 */
export function describirEstado(entrada: {
  estado: ComprobanteDetalle['estado'];
  sunatMensaje?: string | null | undefined;
  envio?: EnvioPseRespuesta | null | undefined;
}): DescripcionDeEstado {
  switch (entrada.estado) {
    case 'ACEPTADO':
      return { tono: 'ok', titulo: 'Aceptado por SUNAT', final: true };
    case 'RECHAZADO':
      return {
        tono: 'error',
        titulo: entrada.sunatMensaje ? `Rechazado: ${entrada.sunatMensaje}` : 'Rechazado por SUNAT',
        final: true,
      };
    case 'ANULADO':
      return { tono: 'neutro', titulo: 'Anulado', final: true };
    case 'POR_ENVIAR':
    case 'ENVIADO': {
      const envio = entrada.envio;
      if (envio?.estado === 'DETENIDO') {
        return {
          tono: 'alerta',
          titulo: 'El envío a SUNAT se detuvo',
          detalle: 'Pasó el plazo sin respuesta. Reinténtalo desde Comprobantes.',
          final: false,
        };
      }
      if (envio?.ultimoResultado === 'ERROR_CONFIGURACION') {
        return {
          tono: 'alerta',
          titulo: 'Todavía no se envía a SUNAT',
          detalle: TEXTO_SIN_ACTIVAR,
          final: false,
        };
      }
      return {
        tono: 'info',
        titulo: 'Enviando a SUNAT…',
        ...(envio?.ultimoResultado === 'ERROR_TRANSPORTE'
          ? { detalle: 'No pudimos comunicarnos con SUNAT. Seguimos intentando.' }
          : {}),
        final: false,
      };
    }
  }
}
