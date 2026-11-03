/**
 * Catálogos y límites de los llamados desde la mesa (historia 005, ruta crítica P2). Son datos puros: los
 * comparten la API (validación y base de datos), los contratos (esquemas zod) y la PWA y la carta web
 * (etiquetas y formularios).
 */

/** Tipos de llamado: un pedido con líneas, o un aviso sin líneas ("Llamar al mozo", "Pedir la cuenta"). */
export const TIPOS_LLAMADO = ['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA'] as const;
export type TipoLlamado = (typeof TIPOS_LLAMADO)[number];

/** Estados de un llamado. `VENCIDO` se calcula al leer (`estadoVigenteLlamado`) y se guarda cuando alguien lo toca. */
export const ESTADOS_LLAMADO = [
  'PENDIENTE',
  'ATENDIDO',
  'PASADO_A_CUENTA',
  'DESCARTADO',
  'VENCIDO',
] as const;
export type EstadoLlamado = (typeof ESTADOS_LLAMADO)[number];

/** Lo que el mozo puede hacer con un llamado (`siguienteEstadoLlamado`). */
export const ACCIONES_LLAMADO = ['ATENDER', 'PASAR_A_CUENTA', 'DESCARTAR'] as const;
export type AccionLlamado = (typeof ACCIONES_LLAMADO)[number];

/** Minutos que un llamado `PENDIENTE` espera a que alguien lo atienda antes de vencer (decisión 4). */
export const MINUTOS_VENCIMIENTO_LLAMADO = 15;

/** Líneas que caben en un llamado (criterio 26). */
export const MAXIMO_LINEAS_LLAMADO = 30;

/** Cantidad máxima de una línea de un llamado (criterio 26). */
export const CANTIDAD_MAXIMA_LLAMADO = 20;

/** Largo máximo de la nota y de la observación de una línea de un llamado (criterio 26). */
export const LARGO_NOTA_LLAMADO = 140;

/** Límite de creación de llamados: `maximo` en una ventana de `ventanaMinutos`. */
export interface LimiteDeLlamados {
  maximo: number;
  ventanaMinutos: number;
}

/** Por mesa: 6 llamados en 30 minutos (criterio 32). */
export const LIMITE_LLAMADOS_MESA: LimiteDeLlamados = { maximo: 6, ventanaMinutos: 30 };

/** Por conexión (huella de la IP) y sucursal: 20 llamados en 10 minutos (criterio 33). */
export const LIMITE_LLAMADOS_IP: LimiteDeLlamados = { maximo: 20, ventanaMinutos: 10 };
