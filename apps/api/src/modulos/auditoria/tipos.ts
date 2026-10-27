/**
 * Entrada de una fila de auditoría. El actor y el equipo no forman parte de la entrada: los pone la
 * base a partir del contexto de actor de la transacción (criterio 119). La empresa, la sesión y la
 * sucursal activa salen del contexto y del principal de la petición; la hora, del reloj de la API.
 */
export interface EntradaAuditoria {
  /** Acción de la lista cerrada de la sección (`crear_usuario`, `autorizacion_otorgada`…). */
  accion: string;
  /** Sucursal de la entidad afectada; si falta, se usa la sucursal activa de la sesión. */
  sucursalId?: string | null;
  motivo?: string | null;
  entidad?: string | null;
  entidadId?: string | null;
  /** Quien autorizó con su PIN (clave de supervisor), si hubo. */
  autorizadoPorId?: string | null;
  autorizacionId?: string | null;
  /** Antes y después de los campos cambiados, sin secretos (criterio 59). */
  detalle?: unknown;
}

/** Fila de auditoría de una operación de plataforma (la escribe `OperacionPlataforma`). */
export interface EntradaAuditoriaPlataforma {
  accion: string;
  empresaId?: string | null;
  sucursalId?: string | null;
  motivo?: string | null;
  entidad?: string | null;
  entidadId?: string | null;
  sesionId?: string | null;
  detalle?: unknown;
  /** Hora de la fila: la del reloj de la API. */
  ocurridoEn: Date;
}
