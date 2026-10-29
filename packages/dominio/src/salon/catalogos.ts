/**
 * Catálogos y límites de Salón y Cocina (historia 004, entrega 3a). Son datos puros: los comparten la API
 * (validación y base de datos), los contratos (esquemas zod) y la PWA (etiquetas y formularios).
 */

/**
 * Estados de una orden. Una orden **abierta** es `ABIERTA` o `EN_PRECUENTA`; `UNIDA` es la absorbida por otra al
 * unir mesas; `CERRADA` la usa la sección 4 (cobro).
 */
export const ESTADOS_ORDEN = ['ABIERTA', 'EN_PRECUENTA', 'ANULADA', 'UNIDA', 'CERRADA'] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

/** Tipo de orden. En 3a toda orden es `MESA`; los demás valores los usan las secciones 4 y 5. */
export const TIPOS_ORDEN = ['MESA', 'MOSTRADOR', 'PARA_LLEVAR', 'DELIVERY'] as const;
export type TipoOrden = (typeof TIPOS_ORDEN)[number];

/** Canal por el que entró la orden. En 3a toda orden es `SALON`. */
export const CANALES_ORDEN = ['SALON', 'WEB', 'TELEFONO'] as const;
export type CanalOrden = (typeof CANALES_ORDEN)[number];

/** Estado de una mesa, calculado de su orden abierta (`estadoDeMesa`); no se guarda. */
export const ESTADOS_MESA = ['LIBRE', 'OCUPADA', 'EN_PRECUENTA'] as const;
export type EstadoMesa = (typeof ESTADOS_MESA)[number];

/** Forma con la que se dibuja una mesa en el mapa. */
export const FORMAS_MESA = ['CUADRADA', 'REDONDA', 'RECTANGULAR'] as const;
export type FormaMesa = (typeof FORMAS_MESA)[number];

/** Estado de un ítem enviado: `ANULADO` cuando su cantidad vigente llega a 0. */
export const ESTADOS_ITEM = ['ENVIADO', 'ANULADO'] as const;
export type EstadoItem = (typeof ESTADOS_ITEM)[number];

/** Tiempo de servicio de un ítem: 1 (sale de inmediato) o 2 (espera la marcha). */
export const TIEMPOS_SERVICIO = [1, 2] as const;
export type TiempoServicio = (typeof TIEMPOS_SERVICIO)[number];

/** Tipo de comanda de estación: un envío (`COMANDA` la primera, `ADICION` las siguientes), una marcha o una anulación. */
export const TIPOS_COMANDA = ['COMANDA', 'ADICION', 'MARCHAR', 'ANULACION'] as const;
export type TipoComanda = (typeof TIPOS_COMANDA)[number];

/** Dónde sale una comanda: la pantalla de cocina (`KDS`) o una impresora (3b). */
export const DESTINOS_COMANDA = ['KDS', 'IMPRESORA'] as const;
export type DestinoComanda = (typeof DESTINOS_COMANDA)[number];

/** Qué parte de un ítem es una línea de comanda: el producto, un componente de combo o un producto ligado. */
export const ROLES_PARTE = ['PRODUCTO', 'COMPONENTE', 'LIGADO'] as const;
export type RolParte = (typeof ROLES_PARTE)[number];

/** Estados de una línea de comanda en el KDS (RF-37). `ANULADO` no se elige desde la pantalla. */
export const ESTADOS_LINEA_KDS = ['ENVIADO', 'EN_PREPARACION', 'LISTO', 'ANULADO'] as const;
export type EstadoLineaKds = (typeof ESTADOS_LINEA_KDS)[number];

/** Estados que la pantalla de cocina puede poner a una línea (criterio 58): todos menos `ANULADO`. */
export const ESTADOS_LINEA_ELEGIBLES = ['ENVIADO', 'EN_PREPARACION', 'LISTO'] as const;
export type EstadoLineaElegible = (typeof ESTADOS_LINEA_ELEGIBLES)[number];

/** Qué pasa con el stock de lo que se anula: vuelve al inventario o se pierde como merma (criterio 35). */
export const DESTINOS_STOCK = ['VUELVE', 'MERMA'] as const;
export type DestinoStock = (typeof DESTINOS_STOCK)[number];

/** Líneas que caben en un envío (criterio 15). */
export const MAXIMO_LINEAS_ENVIO = 50;

/** Modificadores que puede llevar una línea (criterio 15). */
export const MAXIMO_MODIFICADORES_LINEA = 30;

/** Mesas que puede tener una orden (criterio 46). */
export const MAXIMO_MESAS_ORDEN = 20;

/** Largo máximo de la observación de una línea (criterio 15). */
export const LARGO_OBSERVACION = 140;

/** Comensales de una orden: de 1 a 99 (criterio 9). */
export const MINIMO_COMENSALES = 1;
export const MAXIMO_COMENSALES = 99;

/** Cuadrícula de una zona (criterio 1) y capacidad de una mesa (criterio 3). */
export const COLUMNAS_MINIMAS_ZONA = 2;
export const COLUMNAS_MAXIMAS_ZONA = 12;
export const FILAS_MINIMAS_ZONA = 1;
export const FILAS_MAXIMAS_ZONA = 30;
export const CAPACIDAD_MAXIMA_MESA = 50;
