import {
  menuDelDiaRespuestaSchema,
  type MenuDelDiaEntrada,
  type MenuDelDiaRespuesta,
} from '@restaurante/contratos';
import { api, listaDe } from '../../lib/api';
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
};

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
  /** Si ya existe. "Agotados" llega con C5 (T27): al encenderla, el destino muestra el cambio de sección. */
  habilitada: boolean;
}

export const SECCIONES_DE_DISPONIBILIDAD: readonly DefinicionDeSeccion[] = [
  { valor: 'agotados', etiqueta: 'Agotados', habilitada: false },
  { valor: 'menu', etiqueta: 'Menú del día', habilitada: true },
];

export const SECCIONES_HABILITADAS = SECCIONES_DE_DISPONIBILIDAD.filter((s) => s.habilitada);

/** La sección que pide la dirección (`?ver=`); una desconocida o aún no construida cae en la primera habilitada. */
export function seccionDeDisponibilidadPedida(valor: string | null): SeccionDeDisponibilidad {
  return (SECCIONES_HABILITADAS.find((s) => s.valor === valor) ?? SECCIONES_HABILITADAS[0]!).valor;
}
