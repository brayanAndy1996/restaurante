import {
  enlaceComprobanteRespuestaSchema,
  type ComprobanteRespuesta,
} from '@restaurante/contratos';
import { api } from '../../lib/api';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { formatearMonto } from '../../lib/monto';

/**
 * Entregar el comprobante al cliente (historia 006, 6b, criterios 159, 160 y 161): ver el PDF y compartir por WhatsApp
 * el enlace público con vencimiento. Aquí van las llamadas, el texto del mensaje y la dirección de `wa.me`; la API
 * de WhatsApp está fuera del MVP, así que el envío lo hace la persona desde su propio WhatsApp.
 */

// --- Llamadas a la API ----------------------------------------------------------------------------

/**
 * `GET /facturacion/comprobantes/:id/pdf` (criterio 159): el PDF como archivo. Requiere la sesión, así que no se
 * abre con un enlace directo sino con esta llamada y una dirección `blob:`. 409 `PDF_NO_DISPONIBLE` si aún no hay PDF.
 */
export const leerPdf = (comprobanteId: string, senal?: AbortSignal) =>
  api.get<Blob>(`/facturacion/comprobantes/${comprobanteId}/pdf`, {
    comoBlob: true,
    reintentos: 2,
    ...(senal ? { senal } : {}),
  });

/** `GET /facturacion/comprobantes/:id/enlace` (criterio 160): la dirección pública sellada, vigente 30 días. */
export const leerEnlace = (comprobanteId: string, senal?: AbortSignal) =>
  api.get(`/facturacion/comprobantes/${comprobanteId}/enlace`, {
    esquema: enlaceComprobanteRespuestaSchema,
    reintentos: 2,
    ...(senal ? { senal } : {}),
  });

// --- Cuándo hay PDF -------------------------------------------------------------------------------

export const AVISO_PDF_PENDIENTE = 'El PDF estará listo cuando SUNAT acepte el comprobante.';
export const AVISO_PDF_PREPARANDO = 'El PDF se está preparando; estará listo en un minuto.';

type DatosDeDisponibilidad = Pick<ComprobanteRespuesta, 'estado'> & { pdfDisponible?: boolean };

/**
 * Lo que se sabe de antemano sobre el PDF, para avisarlo junto a los botones sin impedir tocarlos: el servidor es quien
 * decide (si el aviso está viejo, el toque lo corrige). `null` = no hay nada que avisar.
 */
export function avisoDeDisponibilidad(comprobante: DatosDeDisponibilidad): string | null {
  if (comprobante.estado !== 'ACEPTADO' && comprobante.estado !== 'ANULADO')
    return AVISO_PDF_PENDIENTE;
  return comprobante.pdfDisponible === false ? AVISO_PDF_PREPARANDO : null;
}

/** `true` si el error es «el PDF aún no está»: no es una falla, es un «todavía no». */
export const esPdfNoDisponible = (error: unknown): error is ErrorApi =>
  error instanceof ErrorApi && error.codigo === 'PDF_NO_DISPONIBLE';

/**
 * El mensaje de un fallo al pedir el PDF o el enlace. El de `PDF_NO_DISPONIBLE` viene de la API y distingue «estará
 * listo cuando SUNAT acepte» de «se está preparando»; los demás, en palabras de la pantalla.
 */
export function mensajeDeFalloDelPdf(error: unknown): string {
  if (esPdfNoDisponible(error)) return error.message || AVISO_PDF_PENDIENTE;
  if (error instanceof ErrorApi && error.codigo === 'CONFIGURACION_INCOMPLETA' && error.message)
    return error.message;
  return mensajeDeError(error, {
    NO_ENCONTRADO: 'Este comprobante ya no está disponible. Actualiza la pantalla.',
    PROHIBIDO: 'Este comprobante no es de tus turnos.',
    MODULO_NO_INCLUIDO:
      'El plan de esta sucursal no incluye esta función. Pide a tu administrador que lo revise.',
  });
}

// --- WhatsApp -------------------------------------------------------------------------------------

const TITULO_PARA_EL_MENSAJE: Record<ComprobanteRespuesta['tipo'], string> = {
  BOLETA: 'BOLETA',
  FACTURA: 'FACTURA',
  NOTA_CREDITO_BOLETA: 'NOTA DE CRÉDITO',
  NOTA_CREDITO_FACTURA: 'NOTA DE CRÉDITO',
};

type DatosParaElMensaje = Pick<ComprobanteRespuesta, 'tipo' | 'numero'> & {
  emisor: Pick<ComprobanteRespuesta['emisor'], 'razonSocial'>;
  totales: Pick<ComprobanteRespuesta['totales'], 'total'>;
};

/** «Tu BOLETA B001-00000124 de Cevichería Sol S.A.C. por S/ 69.20: https://…» (criterio 161). */
export function textoParaWhatsApp(comprobante: DatosParaElMensaje, url: string): string {
  const total = formatearMonto(comprobante.totales.total) ?? comprobante.totales.total;
  return `Tu ${TITULO_PARA_EL_MENSAJE[comprobante.tipo]} ${comprobante.numero} de ${comprobante.emisor.razonSocial} por S/ ${total}: ${url}`;
}

/**
 * El celular que escribió el cajero, listo para `wa.me`: `51` y 9 dígitos que empiezan con 9. Acepta espacios, guiones,
 * puntos y paréntesis, y el `+51` o `51` por delante. Vacío = sin celular (se elige el contacto en WhatsApp).
 * `null` = no es un celular peruano.
 */
export function celularParaWhatsApp(texto: string): { numero: string | null } | null {
  const limpio = texto.trim().replace(/[\s\-.()]/g, '');
  if (limpio === '') return { numero: null };
  const sinPrefijo = limpio.replace(/^(\+?51)(?=9\d{8}$)/, '');
  return /^9\d{8}$/.test(sinPrefijo) ? { numero: `51${sinPrefijo}` } : null;
}

/** `https://wa.me/51987654321?text=…`, o `https://wa.me/?text=…` sin celular (criterio 161). */
export function direccionDeWhatsApp(texto: string, celular: string | null): string {
  return `https://wa.me/${celular ?? ''}?text=${encodeURIComponent(texto)}`;
}

export const TEXTO_CELULAR_INVALIDO =
  'Escribe un celular de 9 dígitos que empiece con 9, por ejemplo 987 654 321.';

// --- Pestañas -------------------------------------------------------------------------------------

/**
 * Abre una pestaña en blanco **en el mismo toque** de la persona, antes de esperar a la API: los celulares (Safari
 * sobre todo) bloquean una pestaña que se abre después de una espera. Se la lleva a su destino con `llevarPestana`.
 */
export function abrirPestanaEnBlanco(): Window | null {
  try {
    const ventana = window.open('', '_blank');
    // La pestaña va a `wa.me` o al PDF: no debe poder volver a esta con `window.opener`.
    if (ventana) ventana.opener = null;
    return ventana;
  } catch {
    return null;
  }
}

/**
 * Lleva la pestaña en blanco a `url`; si no se pudo abrir (o se cerró), prueba abrir una nueva. `false` si el
 * navegador la bloqueó: la pantalla ofrece entonces un enlace para tocar.
 */
export function llevarPestana(ventana: Window | null, url: string): boolean {
  if (ventana && !ventana.closed) {
    ventana.location.href = url;
    return true;
  }
  try {
    const nueva = window.open(url, '_blank');
    if (nueva) nueva.opener = null;
    return nueva !== null;
  } catch {
    return false;
  }
}
