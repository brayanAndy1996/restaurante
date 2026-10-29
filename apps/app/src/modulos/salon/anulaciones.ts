import {
  anulacionRespuestaSchema,
  ordenRespuestaSchema,
  type AnularItemEntrada,
  type AnularOrdenEntrada,
  type ItemRespuesta,
  type OrdenRespuesta,
} from '@restaurante/contratos';
import { totalVigenteLinea } from '@restaurante/dominio';
import { api } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { montoEnSoles } from '../../lib/formato';
import { estaAbierta, textoDeItems, tituloDeMesas } from './ordenes';

/**
 * Anular un ítem enviado, anular la orden y liberar la mesa (criterios 35 a 44 y 93 de 004): las llamadas a
 * la API y las reglas de presentación, sin React. Los montos que se dicen en pantalla salen de
 * `packages/dominio` (`totalVigenteLinea`); aquí no se suma ni se multiplica nada.
 */

/** Lo que `enviarSinPerder` entrega, más la autorización del supervisor cuando la acción exige clave. */
export type ExtraConAutorizacion = ExtraDeEscritura & { autorizacion?: string };

/** `POST /ordenes/:id/items/:itemId/anulaciones` (criterio 35). `entrada.id` se conserva entre reintentos. */
export const anularItem = (
  ordenId: string,
  itemId: string,
  entrada: AnularItemEntrada,
  extra?: ExtraConAutorizacion,
) =>
  api.post(`/ordenes/${ordenId}/items/${itemId}/anulaciones`, entrada, {
    esquema: anulacionRespuestaSchema,
    ...extra,
  });

/** `POST /ordenes/:id/anulacion` (criterio 42): la cuenta queda `ANULADA` y sus mesas libres. */
export const anularOrden = (
  ordenId: string,
  entrada: AnularOrdenEntrada,
  extra?: ExtraConAutorizacion,
) =>
  api.post(`/ordenes/${ordenId}/anulacion`, entrada, { esquema: ordenRespuestaSchema, ...extra });

/** `POST /ordenes/:id/liberacion` (criterio 44): sin clave y sin cuerpo; solo si nunca hubo un envío. */
export const liberarMesa = (ordenId: string, extra?: ExtraDeEscritura) =>
  api.post(`/ordenes/${ordenId}/liberacion`, undefined, {
    esquema: ordenRespuestaSchema,
    ...extra,
  });

// --- Reglas de presentación -----------------------------------------------------------------------

export type DestinoDeStock = AnularItemEntrada['destinoStock'];

/** Las dos respuestas de "¿El stock vuelve o es merma?" (criterio 93); ninguna viene elegida. */
export const OPCIONES_DE_DESTINO: readonly {
  valor: DestinoDeStock;
  titulo: string;
  ayuda: string;
}[] = [
  {
    valor: 'VUELVE',
    titulo: 'Vuelve al stock',
    ayuda: 'No se llegó a preparar o se puede volver a usar.',
  },
  {
    valor: 'MERMA',
    titulo: 'Es merma',
    ayuda: 'Se preparó o se perdió: queda como pérdida.',
  },
];

/** Un ítem al que todavía se le puede anular algo. */
export const sePuedeAnularItem = (item: Pick<ItemRespuesta, 'estado' | 'cantidadVigente'>) =>
  item.estado !== 'ANULADO' && item.cantidadVigente > 0;

/**
 * "Liberar la mesa" aparece solo con la cuenta abierta que nunca tuvo un envío (decisión 7, criterio 44):
 * con cualquier envío, aunque todo esté anulado, la API responde 409 `ORDEN_CON_CONSUMO` y se ofrece "Anular
 * la orden". Los ítems de la cuenta son los enviados, así que sin ítems no hubo envíos.
 */
export const sePuedeLiberar = (orden: Pick<OrdenRespuesta, 'estado' | 'items'>) =>
  estaAbierta(orden) && orden.items.length === 0;

/** "Anular la orden" aparece con la cuenta abierta y al menos un ítem enviado. */
export const sePuedeAnularOrden = (orden: Pick<OrdenRespuesta, 'estado' | 'items'>) =>
  estaAbierta(orden) && orden.items.length > 0;

/** Lo que cuestan `cantidad` unidades del ítem, calculado por `packages/dominio`. */
export const importeDeAnular = (item: Pick<ItemRespuesta, 'precioUnitario'>, cantidad: number) =>
  montoEnSoles(totalVigenteLinea(item.precioUnitario, cantidad, 0)) ?? '';

/** "Ceviche mixto × 1 · S/ 38.00": lo que el supervisor lee antes de dar su clave. */
export const resumenDeAnularItem = (item: ItemRespuesta, cantidad: number) =>
  `${item.nombre} × ${cantidad} · ${importeDeAnular(item, cantidad)}`;

/** "Mesa 4 · 5 ítems · S/ 169.20" (la orden entera). */
export function resumenDeAnularOrden(orden: OrdenRespuesta): string {
  const unidades = orden.items.reduce((suma, i) => suma + i.cantidadVigente, 0);
  return `${tituloDeMesas(orden.mesas)} · ${textoDeItems(unidades)} · ${montoEnSoles(orden.total) ?? ''}`;
}

/** Cuántas unidades vigentes quedan en la cuenta. */
export const unidadesVigentes = (orden: Pick<OrdenRespuesta, 'items'>) =>
  orden.items.reduce((suma, i) => suma + i.cantidadVigente, 0);
