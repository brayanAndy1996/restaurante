/** `OperacionPlataforma.ejecutar` se llamó dentro de un contexto de empresa (o de otra operación). */
export class OperacionPlataformaAnidadaError extends Error {
  constructor(
    mensaje = 'Una operación de plataforma no puede correr dentro de un contexto de empresa ni dentro de otra operación de plataforma',
  ) {
    super(mensaje);
    this.name = 'OperacionPlataformaAnidadaError';
  }
}
