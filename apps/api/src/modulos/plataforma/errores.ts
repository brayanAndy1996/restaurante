/** `OperacionPlataforma.ejecutar` se llamó dentro de un contexto de empresa (o de otra operación). */
export class OperacionPlataformaAnidadaError extends Error {
  constructor(
    mensaje = 'Una operación de plataforma no puede correr dentro de un contexto de empresa ni dentro de otra operación de plataforma',
  ) {
    super(mensaje);
    this.name = 'OperacionPlataformaAnidadaError';
  }
}

/** El código de una operación de plataforma cerró la transacción por su cuenta (criterio 32b). */
export class OperacionPlataformaCerradaError extends Error {
  constructor(
    mensaje = 'El código de la operación cerró la transacción de plataforma por su cuenta; no se puede confirmar nada sin su auditoría',
  ) {
    super(mensaje);
    this.name = 'OperacionPlataformaCerradaError';
  }
}
