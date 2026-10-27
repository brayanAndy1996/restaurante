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
 * PostgreSQL (`DatabaseError`). Cuando la denegación equivale a un permiso denegado de la base (los
 * nombres de la lista del criterio 38e, que en producción sin superusuario no tienen la revocación
 * de `pg_catalog`), lleva `code` = `42501` (`insufficient_privilege`), para que quien distinga los
 * permisos denegados los trate igual con o sin superusuario.
 */
export class ConsultaProhibidaError extends Error {
  constructor(
    mensaje = 'Consulta no permitida: el contexto de empresa y la sesión solo los gestiona ContextoEmpresa',
    readonly code?: string,
  ) {
    super(mensaje);
    this.name = 'ConsultaProhibidaError';
  }
}
