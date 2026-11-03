import {
  qrMesaRespuestaSchema,
  qrMesasRespuestaSchema,
  type QrMesaDeLista,
  type QrMesaRespuesta,
  type QrMesasRespuesta,
} from '@restaurante/contratos';
import { api } from '../../../../lib/api';
import type { ExtraDeEscritura } from '../../../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../../../lib/errores';

/** Ajustes › Mapa de mesas › QR de las mesas (historia 005, criterios 75 y 76; HU-42). */

export const claveQrMesas = (sucursalId: string) => ['mesas', 'qr', sucursalId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

export const listarQrMesas = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/qr-mesas`, {
    esquema: qrMesasRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

/** Crea el código de las mesas que no lo tienen (las creadas antes de esta sección). Repetirlo no cambia nada. */
export const crearQrFaltantes = (sucursalId: string, extra?: ExtraDeEscritura) =>
  api.post(`/sucursales/${sucursalId}/qr-mesas`, undefined, {
    esquema: qrMesasRespuestaSchema,
    ...extra,
  });

/** Un código nuevo para la mesa: el impreso deja de funcionar. Lleva clave de idempotencia (la misma al reintentar). */
export const cambiarQrDeMesa = (sucursalId: string, mesaId: string, extra?: ExtraDeEscritura) =>
  api.post(`/sucursales/${sucursalId}/mesas/${mesaId}/qr`, undefined, {
    esquema: qrMesaRespuestaSchema,
    idempotente: true,
    ...extra,
  });

// --- Reglas de la pantalla --------------------------------------------------------------------------

export const tieneCodigo = (mesa: QrMesaDeLista): mesa is QrMesaDeLista & { url: string } =>
  mesa.codigo !== null && mesa.url !== null;

export const mesasSinCodigo = (mesas: readonly QrMesaDeLista[]) =>
  mesas.filter((m) => !tieneCodigo(m));

/** "Mesa 12". */
export const nombreDeMesa = (nombre: string) => `Mesa ${nombre}`;

export interface ZonaConQr {
  zona: QrMesaDeLista['zona'];
  mesas: QrMesaDeLista[];
}

/** Las mesas por zona, en el orden del mapa (la API ya las manda ordenadas por zona y por mesa). */
export function agruparPorZona(mesas: readonly QrMesaDeLista[]): ZonaConQr[] {
  const grupos: ZonaConQr[] = [];
  for (const mesa of mesas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.zona.id === mesa.zona.id) ultimo.mesas.push(mesa);
    else grupos.push({ zona: mesa.zona, mesas: [mesa] });
  }
  return grupos;
}

/** El código nuevo de una mesa reemplaza al anterior en la lista que se tiene en pantalla. */
export function conQrCambiado(lista: QrMesasRespuesta, nuevo: QrMesaRespuesta): QrMesasRespuesta {
  return {
    ...lista,
    mesas: lista.mesas.map((m) =>
      m.mesaId === nuevo.mesaId
        ? { ...m, codigo: nuevo.codigo, url: nuevo.url, generadoEn: nuevo.generadoEn }
        : m,
    ),
  };
}

/** "1 mesa", "12 mesas". */
export const pluralMesas = (cantidad: number) => (cantidad === 1 ? '1 mesa' : `${cantidad} mesas`);

const MENSAJES_DE_CARGA = {
  CONFIGURACION_INCOMPLETA:
    'Falta configurar el sitio donde vive la carta web. Avisa a soporte para que lo configure y vuelve a abrir esta pantalla.',
  NO_ENCONTRADO: 'Esta sucursal ya no existe. Elige otra arriba, junto a tu nombre.',
} as const;

/** Mensaje al cargar la lista o al crear los códigos que faltan. */
export function mensajeDeQr(error: unknown): string {
  return mensajeDeError(error, MENSAJES_DE_CARGA);
}

/** Mensaje al cambiar el QR de una mesa. */
export function mensajeDeCambioDeQr(error: unknown, mesa: string): string {
  if (error instanceof ErrorApi) {
    if (error.codigo === 'CONFLICTO') {
      return error.reintentada
        ? 'La conexión se cortó y es posible que el QR ya se haya cambiado. Mira la lista antes de intentarlo otra vez.'
        : `La mesa ${mesa} está desactivada. Reactívala en el mapa para cambiar su QR.`;
    }
    if (error.codigo === 'NO_ENCONTRADO') {
      return `La mesa ${mesa} ya no existe. Actualiza la pantalla.`;
    }
  }
  return mensajeDeError(error, MENSAJES_DE_CARGA);
}
