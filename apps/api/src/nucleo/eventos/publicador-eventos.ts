/**
 * Puerto para publicar eventos en tiempo real (historia 003, decisión 2). Esta sección solo fija el
 * contrato; el transporte (Socket.IO con el adaptador de PostgreSQL) llega en la sección 3.
 *
 * Las operaciones lo llaman únicamente con `ContextoEmpresa.alConfirmar`, es decir, después de confirmar la
 * transacción: no hay contexto de empresa al publicar, así que el evento lleva su `empresaId` (el de
 * `empresaActual()` al registrarlo) y su sala.
 */

/** Token de Nest del publicador de eventos. */
export const PUBLICADOR_EVENTOS = Symbol('PUBLICADOR_EVENTOS');

/** Sala a la que va un evento: toda la empresa o una sucursal. */
export type SalaDeEvento = { tipo: 'empresa' } | { tipo: 'sucursal'; sucursalId: string };

export interface EventoPublicable {
  empresaId: string;
  sala: SalaDeEvento;
  /** Por ejemplo `carta.disponibilidad` o `carta.actualizada`. */
  nombre: string;
  datos: Readonly<Record<string, unknown>>;
}

export interface PublicadorEventos {
  publicar(evento: EventoPublicable): void | Promise<void>;
}
