import { uuidSchema } from '@restaurante/contratos';
import type { EventoPublicable } from '../eventos';

/** Espacio de nombres de la PWA (criterio 64). El del puente de impresión es `ESPACIO_PUENTE` (`/puente`, 3b). */
export const ESPACIO_PWA = '/';

/** Sala de toda una empresa (criterio 65). */
export const salaDeEmpresa = (empresaId: string): string => `e:${empresaId}`;

/** Sala de una sucursal de una empresa: lleva las dos ids, así un id de otra empresa nunca la alcanza (criterio 67). */
export const salaDeSucursal = (empresaId: string, sucursalId: string): string =>
  `s:${empresaId}:${sucursalId}`;

/** Sala de un puente de impresión (3b): también lleva la empresa. */
export const salaDePuente = (empresaId: string, puenteId: string): string =>
  `p:${empresaId}:${puenteId}`;

/** Sala de una sesión: solo sirve para desconectarla (criterio 66). */
export const salaDeSesion = (sesionId: string): string => `sesion:${sesionId}`;

/** Lo que el servidor guarda en `socket.data` de cada conexión autenticada de la PWA. */
export interface DatosDeConexion {
  empresaId: string;
  sesionId: string;
  sucursalId: string | null;
}

/** Lo que el servidor guarda en `socket.data` de cada conexión autenticada del puente de impresión (3b). */
export interface DatosDeConexionDePuente {
  empresaId: string;
  puenteId: string;
  sucursalId: string;
}

const esUuid = (valor: unknown): valor is string =>
  typeof valor === 'string' && uuidSchema.safeParse(valor).success;

/**
 * Traduce la sala de un evento a la sala de Socket.IO. Devuelve `null` si el evento no se puede enviar a nadie:
 * ids que no son UUID. Las salas de empresa y sucursal son del espacio de la PWA y la del puente, del espacio
 * `/puente`. Nunca devuelve una sala que no lleve la empresa (criterio 67).
 */
export function salaDeSocketIo(evento: EventoPublicable): string | null {
  if (!esUuid(evento.empresaId)) return null;
  const empresaId = evento.empresaId.toLowerCase();
  switch (evento.sala.tipo) {
    case 'empresa':
      return salaDeEmpresa(empresaId);
    case 'sucursal':
      return esUuid(evento.sala.sucursalId)
        ? salaDeSucursal(empresaId, evento.sala.sucursalId.toLowerCase())
        : null;
    case 'puente':
      return esUuid(evento.sala.puenteId)
        ? salaDePuente(empresaId, evento.sala.puenteId.toLowerCase())
        : null;
  }
}
