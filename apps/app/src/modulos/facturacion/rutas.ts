/**
 * Dónde viven las pantallas de la facturación (006, 6b): el panel de comprobantes de Caja (Supervisor y Cajero, con sus
 * turnos) y el de Ajustes (Administrador, con el filtro de sucursal). Es un archivo aparte a propósito: las pantallas de
 * Caja solo necesitan el enlace y no deben bajar los esquemas de la facturación.
 */
export const RUTA_PANEL_EN_CAJA = '/caja/comprobantes';
export const RUTA_PANEL_EN_AJUSTES = '/administracion/comprobantes';

export const rutaDelDetalle = (base: string, comprobanteId: string) => `${base}/${comprobanteId}`;
