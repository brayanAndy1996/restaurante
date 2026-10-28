/**
 * Catálogos y límites de la carta (historia 003). Son datos puros: los comparten la API (validación y
 * base de datos), los contratos (esquemas zod) y la PWA (etiquetas y formularios).
 */

/** Tipos de producto. El tipo se elige al crear el producto y se puede cambiar después (criterio 10b). */
export const TIPOS_PRODUCTO = ['SIMPLE', 'COMBO', 'MENU_DEL_DIA'] as const;
export type TipoProducto = (typeof TIPOS_PRODUCTO)[number];

/** Cómo se controla el stock de un producto (su uso es de la sección 6). */
export const TIPOS_CONTROL_STOCK = ['UNIDADES', 'PORCIONES', 'SIN_CONTROL'] as const;
export type TipoControlStock = (typeof TIPOS_CONTROL_STOCK)[number];

/** Afectación tributaria del producto (decisión 10): `GRAVADO` es la que se asume por defecto. */
export const AFECTACIONES_IGV = ['GRAVADO', 'EXONERADO', 'INAFECTO'] as const;
export type AfectacionIgv = (typeof AFECTACIONES_IGV)[number];

/** Selección de un grupo de modificadores: una sola opción o varias. */
export const SELECCIONES = ['UNICA', 'MULTIPLE'] as const;
export type Seleccion = (typeof SELECCIONES)[number];

/** Cuánto dura un agotado (decisión 4): hasta el fin del día operativo o hasta que alguien lo reactive. */
export const HASTA_AGOTADO = ['FIN_DEL_DIA', 'REACTIVAR'] as const;
export type HastaAgotado = (typeof HASTA_AGOTADO)[number];

/** Quién marcó el agotado: una persona (`MANUAL`) o el inventario al llegar a cero (`SIN_STOCK`, sección 6). */
export const ORIGENES_AGOTADO = ['MANUAL', 'SIN_STOCK'] as const;
export type OrigenAgotado = (typeof ORIGENES_AGOTADO)[number];

/**
 * Por qué un producto no es vendible, en el orden en que se evalúan (criterio 59): el primero que
 * aplica es el que se informa.
 */
export const MOTIVOS_NO_VENDIBLE = [
  'INACTIVO',
  'NO_DISPONIBLE',
  'AGOTADO',
  'COMPONENTE_NO_DISPONIBLE',
  'MENU_SIN_ARMAR',
  'OPCIONES_INSUFICIENTES',
] as const;
export type MotivoNoVendible = (typeof MOTIVOS_NO_VENDIBLE)[number];

/** Errores de `validarSeleccion` (criterio 56). */
export const ERRORES_SELECCION = [
  'MODIFICADOR_DESCONOCIDO',
  'MODIFICADOR_REPETIDO',
  'MODIFICADOR_NO_DISPONIBLE',
  'MENOS_DEL_MINIMO',
  'MAS_DEL_MAXIMO',
] as const;
export type CodigoErrorSeleccion = (typeof ERRORES_SELECCION)[number];

/** Cantidad máxima de una línea de venta (criterio 57). */
export const CANTIDAD_MAXIMA_LINEA = 999;

/** Cantidad máxima de un componente de combo (criterio 6). */
export const CANTIDAD_MAXIMA_COMPONENTE = 99;
