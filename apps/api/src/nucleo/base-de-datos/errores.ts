/** La conexión usa un rol que puede saltarse la RLS o es dueño de tablas: la API se niega a arrancar. */
export class RolPrivilegiadoError extends Error {
  constructor(
    mensaje: string,
    readonly rol: string,
    readonly atributos: string[],
  ) {
    super(mensaje);
    this.name = 'RolPrivilegiadoError';
  }
}

/** Una consulta intentó cambiar el contexto de empresa o la sesión por una vía no autorizada. */
export class ConsultaProhibidaError extends Error {
  constructor(
    mensaje = 'Consulta no permitida: el contexto de empresa y la sesión solo los gestiona ContextoEmpresa',
  ) {
    super(mensaje);
    this.name = 'ConsultaProhibidaError';
  }
}
