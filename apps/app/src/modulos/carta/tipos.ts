import type { TipoProducto } from '@restaurante/dominio';

/**
 * Los tipos de producto y qué campos lleva cada uno. El formulario pregunta aquí qué mostrar, así que
 * sumar un tipo es sumar una entrada y encender `habilitado`, sin tocar el resto:
 *
 * - Desde C4 los tres tipos están habilitados, al crear y al editar (el tipo se puede cambiar,
 *   criterios 10b a 10d). El selector solo muestra los habilitados.
 * - Los campos de cada tipo salen del criterio 7 de la especificación.
 */
export interface DefinicionDeTipo {
  valor: TipoProducto;
  etiqueta: string;
  /** Una línea que dice qué es, para quien elige. */
  ayuda: string;
  /** Se puede elegir hoy. */
  habilitado: boolean;
  campos: {
    /** El interruptor "Se vende solo" (un combo o un menú siempre se vende solo). */
    seVendeSolo: boolean;
    /** La estación que lo prepara (un combo o un menú no tienen: cada componente va a la suya). */
    estacion: boolean;
    /** Los componentes fijos con su cantidad (solo un combo o un menú; siempre productos simples). */
    componentes: boolean;
  };
}

export const TIPOS_DE_PRODUCTO: readonly DefinicionDeTipo[] = [
  {
    valor: 'SIMPLE',
    etiqueta: 'Simple',
    ayuda:
      'Un plato o una bebida que se prepara en una estación y se vende solo o dentro de un combo.',
    habilitado: true,
    campos: { seVendeSolo: true, estacion: true, componentes: false },
  },
  {
    valor: 'COMBO',
    etiqueta: 'Combo',
    ayuda: 'Varios productos con un precio fijo, con opciones que pueden sumar un monto.',
    habilitado: true,
    campos: { seVendeSolo: false, estacion: false, componentes: true },
  },
  {
    valor: 'MENU_DEL_DIA',
    etiqueta: 'Menú del día',
    ayuda: 'Un combo cuyas opciones cambian cada día y en cada sucursal.',
    habilitado: true,
    campos: { seVendeSolo: false, estacion: false, componentes: true },
  },
];

export function definicionDeTipo(tipo: TipoProducto): DefinicionDeTipo {
  const definicion = TIPOS_DE_PRODUCTO.find((t) => t.valor === tipo);
  if (!definicion) throw new Error(`Tipo de producto desconocido: ${tipo}`);
  return definicion;
}

export const TIPOS_HABILITADOS = TIPOS_DE_PRODUCTO.filter((t) => t.habilitado);

/** Texto de la etiqueta de estado de un tipo que no es el simple ("Combo", "Menú del día"). */
export function etiquetaDeTipo(tipo: TipoProducto): string {
  return definicionDeTipo(tipo).etiqueta;
}

/** "simple", "combo", "menú del día": el tipo dicho en medio de una frase ("Cambiar a combo"). */
export function tipoEnFrase(tipo: TipoProducto): string {
  return definicionDeTipo(tipo).etiqueta.toLocaleLowerCase('es-PE');
}
