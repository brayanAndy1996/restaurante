import {
  alertasRespuestaSchema,
  comprobanteDetalleSchema,
  envioPseRespuestaSchema,
  panelComprobantesSchema,
  type AlertasRespuesta,
  type ComprobanteDetalle,
  type EnvioPseRespuesta,
  type PanelComprobantes,
  type PanelItem,
} from '@restaurante/contratos';
import type { TipoAviso } from '@restaurante/ui';
import type { ExtraDeEscritura } from '../../lib/envios';
import { mensajeDeError } from '../../lib/errores';
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

// --- El panel (criterio 135) --------------------------------------------------------------------------

export type EstadoDelFiltro = PanelItem['estado'] | 'TODOS';
export type TipoDelFiltro = PanelItem['tipo'] | 'TODOS';

/** Lo que se eligió en el panel. Vive en la dirección de la pantalla (`?estado=…&alerta=1`), así se comparte y se vuelve atrás. */
export interface FiltrosDelPanel {
  estado: EstadoDelFiltro;
  tipo: TipoDelFiltro;
  /** `AAAA-MM-DD`; vacío = los últimos 7 días que pone el servidor. */
  desde: string;
  hasta: string;
  /** Número del comprobante o documento del cliente. */
  texto: string;
  alerta: boolean;
  /** Solo el Administrador: `''` = todas sus sucursales. */
  sucursalId: string;
}

export const FILTROS_VACIOS: FiltrosDelPanel = {
  estado: 'TODOS',
  tipo: 'TODOS',
  desde: '',
  hasta: '',
  texto: '',
  alerta: false,
  sucursalId: '',
};

/** Máximo de días entre `desde` y `hasta` que acepta la API (criterio 135). */
export const DIAS_MAXIMOS_DEL_PANEL = 93;

const ESTADOS = ['POR_ENVIAR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ANULADO'] as const;
const TIPOS = ['BOLETA', 'FACTURA', 'NOTA_CREDITO_BOLETA', 'NOTA_CREDITO_FACTURA'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Los filtros que dice la dirección; lo que no se entiende se ignora. */
export function filtrosDeLaDireccion(parametros: URLSearchParams): FiltrosDelPanel {
  const estado = parametros.get('estado');
  const tipo = parametros.get('tipo');
  const fecha = (nombre: string) => {
    const valor = parametros.get(nombre) ?? '';
    return FECHA.test(valor) ? valor : '';
  };
  return {
    estado: ESTADOS.find((e) => e === estado) ?? 'TODOS',
    tipo: TIPOS.find((t) => t === tipo) ?? 'TODOS',
    desde: fecha('desde'),
    hasta: fecha('hasta'),
    texto: (parametros.get('texto') ?? '').slice(0, 50),
    alerta: parametros.get('alerta') === '1',
    sucursalId: parametros.get('sucursal') ?? '',
  };
}

/** Lo contrario: solo lo que se apartó de lo habitual. */
export function direccionDeFiltros(filtros: FiltrosDelPanel): URLSearchParams {
  const p = new URLSearchParams();
  if (filtros.estado !== 'TODOS') p.set('estado', filtros.estado);
  if (filtros.tipo !== 'TODOS') p.set('tipo', filtros.tipo);
  if (filtros.desde) p.set('desde', filtros.desde);
  if (filtros.hasta) p.set('hasta', filtros.hasta);
  if (filtros.texto.trim()) p.set('texto', filtros.texto.trim());
  if (filtros.alerta) p.set('alerta', '1');
  if (filtros.sucursalId) p.set('sucursal', filtros.sucursalId);
  return p;
}

/** Cuántos filtros además del estado están puestos (para decirlo con el panel de filtros cerrado). */
export function cuantosFiltrosHay(filtros: FiltrosDelPanel): number {
  return [
    filtros.tipo !== 'TODOS',
    filtros.desde !== '' || filtros.hasta !== '',
    filtros.alerta,
    filtros.sucursalId !== '',
  ].filter(Boolean).length;
}

const dia = (fecha: string) => {
  const [a = 0, m = 0, d = 0] = fecha.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86_400_000;
};

/** El problema de las fechas elegidas, dicho para quien las escribió, o `null` si valen. */
export function errorDeFechas(filtros: Pick<FiltrosDelPanel, 'desde' | 'hasta'>): string | null {
  const { desde, hasta } = filtros;
  if (desde && hasta && dia(desde) > dia(hasta))
    return 'La fecha «Desde» no puede ser posterior a «Hasta».';
  if (desde && hasta && dia(hasta) - dia(desde) > DIAS_MAXIMOS_DEL_PANEL)
    return `Elige un rango de hasta ${DIAS_MAXIMOS_DEL_PANEL} días.`;
  return null;
}

/** La consulta de `GET /facturacion/comprobantes` (criterio 135). El estado va aparte: los conteos no lo usan. */
function consultaDelPanel(filtros: FiltrosDelPanel, cursor?: string): string {
  const p = new URLSearchParams();
  if (filtros.estado !== 'TODOS') p.set('estado', filtros.estado);
  if (filtros.tipo !== 'TODOS') p.set('tipo', filtros.tipo);
  if (filtros.desde) p.set('desde', filtros.desde);
  if (filtros.hasta) p.set('hasta', filtros.hasta);
  if (filtros.texto.trim()) p.set('texto', filtros.texto.trim());
  if (filtros.alerta) p.set('alerta', 'true');
  if (filtros.sucursalId) p.set('sucursalId', filtros.sucursalId);
  if (cursor) p.set('cursor', cursor);
  const texto = p.toString();
  return texto ? `?${texto}` : '';
}

export const clavePanel = (sucursalId: string, filtros: FiltrosDelPanel) =>
  [...CLAVES_TIEMPO_REAL.facturacionPanel, sucursalId, filtros] as const;

/** Una página del panel: 50 comprobantes del más nuevo al más antiguo, con los conteos de los demás estados. */
export const listarPanel = (
  filtros: FiltrosDelPanel,
  cursor: string | undefined,
  senal?: AbortSignal,
) =>
  api.get<PanelComprobantes>(`/facturacion/comprobantes${consultaDelPanel(filtros, cursor)}`, {
    esquema: panelComprobantesSchema,
    ...(senal ? { senal } : {}),
  });

// --- Reintentar (criterio 132) --------------------------------------------------------------------------

/** Pide que el envío se intente ya; con la clave de idempotencia de `enviarSinPerder`. */
export const reintentarEnvio = (comprobanteId: string, extra?: ExtraDeEscritura) =>
  api.post<EnvioPseRespuesta>(`/facturacion/comprobantes/${comprobanteId}/reintento`, undefined, {
    esquema: envioPseRespuestaSchema,
    ...extra,
  });

/** El envío puede reintentarse: el comprobante sigue sin respuesta final y el envío no terminó (criterio 132). */
export const sePuedeReintentar = (
  comprobante: Pick<ComprobanteDetalle, 'estado' | 'envio'>,
): boolean =>
  (comprobante.estado === 'POR_ENVIAR' || comprobante.estado === 'ENVIADO') &&
  comprobante.envio !== null &&
  comprobante.envio.estado !== 'TERMINADO';

/** Lo que dice la pantalla cuando el reintento no se pudo pedir. */
export function textoDeFalloDeReintento(error: unknown): string {
  return mensajeDeError(error, {
    ENVIO_TERMINADO: 'Este comprobante ya tiene su respuesta. Actualizamos su estado.',
    PROHIBIDO: 'No puedes reintentar este comprobante.',
    NO_ENCONTRADO: 'Este comprobante ya no está disponible.',
  });
}

export { RUTA_PANEL_EN_AJUSTES, RUTA_PANEL_EN_CAJA, rutaDelDetalle } from './rutas';

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

// --- Nombres ----------------------------------------------------------------------------------------------

export const NOMBRE_DE_TIPO_DOCUMENTO: Record<PanelItem['tipo'], string> = {
  BOLETA: 'Boleta',
  FACTURA: 'Factura',
  NOTA_CREDITO_BOLETA: 'Nota de crédito de boleta',
  NOTA_CREDITO_FACTURA: 'Nota de crédito de factura',
};

export const NOMBRE_DE_ESTADO: Record<PanelItem['estado'], string> = {
  POR_ENVIAR: 'Por enviar',
  ENVIADO: 'Enviado',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  ANULADO: 'Anulado',
};

/** Qué es lo que alerta de un comprobante (criterio 133). */
export const NOMBRE_DE_ALERTA: Record<NonNullable<PanelItem['alerta']>, string> = {
  RECHAZADO: 'Falta emitir otro',
  DEMORADO: 'Demorado',
  DETENIDO: 'Envío detenido',
  SIN_CONFIGURACION: 'Sin activar',
};

export const NOMBRE_DE_ESTADO_DE_ENVIO: Record<EnvioPseRespuesta['estado'], string> = {
  PENDIENTE: 'Por enviar',
  ESPERANDO_RESPUESTA: 'Esperando respuesta de SUNAT',
  TERMINADO: 'Terminado',
  DETENIDO: 'Detenido: pasó el plazo sin respuesta',
};

/** Qué pasó en un intento, en palabras. */
export const NOMBRE_DE_RESULTADO: Record<
  ComprobanteDetalle['intentos'][number]['resultado'],
  string
> = {
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  PENDIENTE: 'SUNAT aún no responde',
  ERROR_TRANSPORTE: 'No hubo conexión',
  ERROR_CONFIGURACION: 'Facturación sin activar',
  NO_EXISTE: 'No se encontró el documento',
};
