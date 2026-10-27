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

/**
 * Una consulta intentó cambiar el contexto de empresa o la sesión, o nombrar un objeto prohibido, por
 * una vía no autorizada. La guarda la rechaza antes de llegar a la base, así que no es un error de
 * PostgreSQL (`DatabaseError`) y no lleva el `code` de uno: quien necesite distinguir una denegación
 * de la guarda de un permiso denegado de la base usa `instanceof ConsultaProhibidaError`.
 */
export class ConsultaProhibidaError extends Error {
  constructor(
    mensaje = 'Consulta no permitida: el contexto de empresa y la sesión solo los gestiona ContextoEmpresa',
  ) {
    super(mensaje);
    this.name = 'ConsultaProhibidaError';
  }
}
