/**
 * Catálogo de módulos que activa un plan (RF-04). Una ruta marcada con `@RequiereModulo(modulo)`
 * responde 403 `MODULO_NO_INCLUIDO` si el plan de la sucursal activa no lo incluye (criterio 77).
 */
export const MODULOS = [
  'SALON',
  'COCINA',
  'CAJA',
  'FACTURACION',
  'PEDIDOS_WEB',
  'INVENTARIO',
  'REPORTES',
] as const;

export type Modulo = (typeof MODULOS)[number];
