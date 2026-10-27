/** Se usó un modelo o servicio de empresa fuera de `ContextoEmpresa.ejecutar`. */
export class ContextoEmpresaAusenteError extends Error {
  constructor(
    mensaje = 'No hay contexto de empresa: la operación debe correr dentro de ContextoEmpresa.ejecutar',
  ) {
    super(mensaje);
    this.name = 'ContextoEmpresaAusenteError';
  }
}

/** Se pidió `ContextoEmpresa.ejecutar` con otra empresa dentro de un contexto ya activo. */
export class ContextoEmpresaConflictoError extends Error {
  constructor(mensaje = 'Ya hay un contexto de otra empresa activo en esta operación') {
    super(mensaje);
    this.name = 'ContextoEmpresaConflictoError';
  }
}
