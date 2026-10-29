/**
 * Puerto con el que el servidor de Socket.IO (núcleo) valida las conexiones y revisa las sesiones sin depender
 * del módulo de seguridad. `SeguridadModule` lo provee con `ValidadorDeSesion`, el mismo código que valida las
 * peticiones HTTP (historia 004, criterios 63b y 64).
 */
export const VALIDADOR_DE_CONEXIONES = Symbol('VALIDADOR_DE_CONEXIONES');

/** Lo que el servidor necesita saber de una sesión que pasó la validación. */
export interface SesionDeConexion {
  empresaId: string;
  sesionId: string;
  /** La sucursal activa, o `null` si todavía no eligió una. */
  sucursalId: string | null;
}

export interface ValidadorDeConexiones {
  /**
   * Valida el token (y el equipo, si lo exige la sesión) sin renovar la inactividad, o lanza un error: la
   * conexión se rechaza con `NO_AUTENTICADO`.
   */
  validar(
    token: string | null | undefined,
    equipo: string | undefined,
    opciones: { renovar: false },
  ): Promise<SesionDeConexion>;
  /** De las sesiones de una empresa, las que siguen vigentes con el reloj de la API. */
  siguenValidas(empresaId: string, sesionIds: readonly string[]): Promise<Set<string>>;
}
