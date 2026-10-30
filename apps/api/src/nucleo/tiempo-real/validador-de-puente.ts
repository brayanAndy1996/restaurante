/**
 * Puerto con el que el servidor de Socket.IO (núcleo) valida las conexiones del espacio `/puente` y actualiza la
 * señal del puente sin depender del módulo de impresión. `ImpresionModule` lo provee con el mismo código que
 * autentica las peticiones HTTP del puente (historia 004, 3b, criterios 109 y 111).
 */
export const VALIDADOR_DE_PUENTE = Symbol('VALIDADOR_DE_PUENTE');

/** Lo que el servidor necesita saber de un puente que pasó la validación. */
export interface PuenteDeConexion {
  empresaId: string;
  puenteId: string;
  sucursalId: string;
}

export interface ValidadorDePuente {
  /**
   * Valida el token `pu.<empresa>.<id>.<secreto>` (un puente activo con ese secreto) o lanza un error: la
   * conexión se rechaza con `NO_AUTENTICADO`.
   */
  validar(token: string | null | undefined): Promise<PuenteDeConexion>;
  /**
   * El puente se conectó: actualiza su señal (criterio 111). Devuelve `false` si el puente ya no está activo (lo
   * revocaron o lo reemplazaron entre que se validó su token y que la conexión entró a su sala): el servidor cierra
   * esa conexión, así una revocación no se pierde por una conexión que termina de autenticarse justo entonces.
   */
  alConectar(puente: PuenteDeConexion): Promise<boolean>;
  /** El puente se desconectó: actualiza su señal (criterio 111). */
  alDesconectar(puente: PuenteDeConexion): Promise<void>;
  /** De los puentes dados (de una empresa), los que siguen activos: la revisión periódica cierra los demás. */
  siguenActivos(empresaId: string, puenteIds: readonly string[]): Promise<Set<string>>;
}
