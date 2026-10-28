import {
  agotadoRespuestaSchema,
  cartaSucursalRespuestaSchema,
  menuDelDiaRespuestaSchema,
  sucursalRespuestaSchema,
  type AgotadoEntrada,
  type AgotadoRespuesta,
  type CartaSucursalRespuesta,
  type MenuDelDiaEntrada,
  type MenuDelDiaRespuesta,
} from '@restaurante/contratos';
import { api, consultarSiCambio, listaDe } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';

/**
 * Claves de TanStack Query de Disponibilidad. Todo cuelga de `['disponibilidad']`, que se invalida
 * cuando la carta cambia (un menú que cambia de tipo o de grupos) y se limpia al cerrar la sesión.
 */
export const CLAVE_DISPONIBILIDAD = ['disponibilidad'] as const;

export const CLAVES_DISPONIBILIDAD = {
  /** El menú del día "de hoy" que decide la API (el día operativo de la sucursal activa). */
  menuDeHoy: (sucursalId: string) => ['disponibilidad', 'menu', sucursalId, 'hoy'] as const,
  /** El menú de un día concreto (AAAA-MM-DD): el anterior, el actual o el siguiente (criterio 34). */
  menuDelDia: (sucursalId: string, dia: string) =>
    ['disponibilidad', 'menu', sucursalId, 'dia', dia] as const,
  /** La carta de la sucursal activa con su disponibilidad (`GET /carta/sucursal`). */
  vista: (sucursalId: string) => ['disponibilidad', 'vista', sucursalId] as const,
  /** La hora de corte de la sucursal (cambia muy rara vez). */
  corte: (sucursalId: string) => ['disponibilidad', 'corte', sucursalId] as const,
};

/** Cada cuánto vuelve a pedirse la vista en segundo plano (criterio 80, decisión 2: sin Socket.IO en esta sección). */
export const PERIODO_DE_REFRESCO_MS = 15_000;

/** Lo que se guarda de la vista: el cuerpo y el `ETag` con el que se pidió. `etag: null` obliga a bajarla completa. */
export interface VistaEnCache {
  vista: CartaSucursalRespuesta;
  etag: string | null;
  /** Cuándo llegó (o se confirmó que seguía igual), según la hora del servidor, en ms de época. */
  actualizadaEn: number;
}

/**
 * La vista de la sucursal activa con `If-None-Match`: si no cambió, 304 y no se baja nada (criterio 49).
 * `segundoPlano` marca la consulta automática para que no renueve la inactividad de la sesión.
 */
export const consultarCartaSucursal = (
  etag: string | null,
  segundoPlano: boolean,
  senal?: AbortSignal,
) =>
  consultarSiCambio('/carta/sucursal', {
    esquema: cartaSucursalRespuestaSchema,
    etag,
    // La consulta automática no insiste: si no llega, la pantalla avisa que puede estar desactualizada.
    ...(segundoPlano ? { segundoPlano: true, reintentos: 1 } : {}),
    ...(senal ? { senal } : {}),
  });

/**
 * Marca un producto como agotado en la sucursal activa (criterio 39). Es un valor absoluto: repetirlo con
 * el mismo `hasta` da lo mismo. Lleva la clave de idempotencia del envío.
 */
export const marcarAgotado = (
  productoId: string,
  entrada: AgotadoEntrada,
  extra?: ExtraDeEscritura,
): Promise<AgotadoRespuesta> =>
  api.put(`/carta/sucursal/agotados/${productoId}`, entrada, {
    esquema: agotadoRespuestaSchema,
    ...extra,
  });

/** Reactiva un producto (criterio 41): 204, también si no estaba agotado. */
export const reactivarAgotado = (productoId: string, extra?: ExtraDeEscritura): Promise<void> =>
  api.delete(`/carta/sucursal/agotados/${productoId}`, { ...extra });

/** La sucursal (para su hora de corte). Leer es para cualquier rol con sesión. */
export const consultarSucursal = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}`, {
    esquema: sucursalRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

/**
 * Los menús del día de la sucursal activa con sus opciones elegidas para un día (criterio 34). Sin `dia`,
 * la API usa el día operativo actual de la sucursal: así la PWA sabe cuál es "hoy" sin conocer la hora de
 * corte.
 */
export const consultarMenuDelDia = (dia?: string, senal?: AbortSignal) =>
  api.get(`/carta/sucursal/menu-del-dia${dia ? `?dia=${encodeURIComponent(dia)}` : ''}`, {
    esquema: listaDe(menuDelDiaRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

/**
 * Reemplaza las opciones de un día de un menú (criterio 35). Es un valor absoluto: repetirlo da el mismo
 * resultado. Lleva la clave de idempotencia del envío (la misma en cada reintento).
 */
export const armarMenuDelDia = (
  productoId: string,
  entrada: MenuDelDiaEntrada,
  extra?: ExtraDeEscritura,
): Promise<MenuDelDiaRespuesta> =>
  api.put(`/carta/sucursal/menu-del-dia/${productoId}`, entrada, {
    esquema: menuDelDiaRespuestaSchema,
    ...extra,
  });

// --- Secciones del destino --------------------------------------------------------------------------

export type SeccionDeDisponibilidad = 'agotados' | 'menu';

interface DefinicionDeSeccion {
  valor: SeccionDeDisponibilidad;
  etiqueta: string;
}

export const SECCIONES_DE_DISPONIBILIDAD: readonly DefinicionDeSeccion[] = [
  { valor: 'agotados', etiqueta: 'Agotados' },
  { valor: 'menu', etiqueta: 'Menú del día' },
];

/** La sección que pide la dirección (`?ver=`); una desconocida cae en la primera. */
export function seccionDeDisponibilidadPedida(valor: string | null): SeccionDeDisponibilidad {
  return (SECCIONES_DE_DISPONIBILIDAD.find((s) => s.valor === valor) ?? SECCIONES_DE_DISPONIBILIDAD[0]!)
    .valor;
}
