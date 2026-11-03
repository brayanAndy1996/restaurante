/**
 * Estados y vencimiento de los llamados (historia 005, criterio 56; ruta crítica P2). Firmas públicas: la
 * implementación llega en la fase C (T8).
 */
import type { AccionLlamado, EstadoLlamado, TipoLlamado } from './catalogos';

/** Instante en que vence un llamado creado en `creadoEn`: `creadoEn` + `MINUTOS_VENCIMIENTO_LLAMADO`. */
export function venceEnLlamado(creadoEn: Date): Date {
  void creadoEn;
  throw new Error('No implementado');
}

/**
 * Estado vigente de un llamado: `VENCIDO` si está `PENDIENTE` y `ahora >= venceEn`; si no, su `estado`. Un
 * llamado `ATENDIDO` no vence.
 */
export function estadoVigenteLlamado(
  llamado: { estado: EstadoLlamado; venceEn: Date },
  ahora: Date,
): EstadoLlamado {
  void llamado;
  void ahora;
  throw new Error('No implementado');
}

/**
 * Estado al que pasa un llamado con una acción, o `null` si no se puede (tabla del criterio 56). `PASAR_A_CUENTA`
 * y `DESCARTAR` desde `ATENDIDO` solo valen en un `PEDIDO`.
 */
export function siguienteEstadoLlamado(
  tipo: TipoLlamado,
  estado: EstadoLlamado,
  accion: AccionLlamado,
): EstadoLlamado | null {
  void tipo;
  void estado;
  void accion;
  throw new Error('No implementado');
}
