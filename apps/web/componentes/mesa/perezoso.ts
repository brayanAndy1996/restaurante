/**
 * Lo que el modo mesa carga bajo demanda (criterio 88): las hojas de producto y de pedido, y las reglas de montos de
 * `packages/dominio` con `decimal.js`. `Mesa` lo pide con `cargarPerezoso()` al primer toque, al volver con un
 * pedido guardado o al abrir una hoja; una sola descarga, que luego queda en la caché del navegador.
 */
export { HojaDeProducto } from './HojaDeProducto';
export { HojaDePedido } from './HojaDePedido';
export { Monto } from './Monto';
export * as reglas from '@/lib/reglas';
