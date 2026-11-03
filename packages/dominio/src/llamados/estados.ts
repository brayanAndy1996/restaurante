/**
 * Estados y vencimiento de los llamados (historia 005, criterio 56; ruta crítica P2). Reglas puras: el reloj entra
 * siempre como argumento (el de la API), nunca se lee aquí.
 */
import {
  MINUTOS_VENCIMIENTO_LLAMADO,
  type AccionLlamado,
  type EstadoLlamado,
  type TipoLlamado,
} from './catalogos';

const MS_POR_MINUTO = 60_000;

/** Instante en que vence un llamado creado en `creadoEn`: `creadoEn` + `MINUTOS_VENCIMIENTO_LLAMADO`. */
export function venceEnLlamado(creadoEn: Date): Date {
  return new Date(creadoEn.getTime() + MINUTOS_VENCIMIENTO_LLAMADO * MS_POR_MINUTO);
}

/**
 * Estado vigente de un llamado: `VENCIDO` si está `PENDIENTE` y `ahora >= venceEn`; si no, su `estado`. Un
 * llamado `ATENDIDO` no vence.
 */
export function estadoVigenteLlamado(
  llamado: { estado: EstadoLlamado; venceEn: Date },
  ahora: Date,
): EstadoLlamado {
  if (llamado.estado === 'PENDIENTE' && ahora.getTime() >= llamado.venceEn.getTime()) {
    return 'VENCIDO';
  }
  return llamado.estado;
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
  if (estado === 'PENDIENTE') {
    if (accion === 'ATENDER') return 'ATENDIDO';
    if (accion === 'DESCARTAR') return 'DESCARTADO';
    return null;
  }
  if (estado === 'ATENDIDO' && tipo === 'PEDIDO') {
    if (accion === 'PASAR_A_CUENTA') return 'PASADO_A_CUENTA';
    if (accion === 'DESCARTAR') return 'DESCARTADO';
  }
  return null;
}
