/**
 * Clave de metadatos que marca las rutas de plataforma (`@Superadministrador()`, definido en
 * `modulos/plataforma`). La define el núcleo para que el guard global de autenticación (módulo de
 * seguridad) las deje pasar a su propio guard sin importar el módulo de plataforma.
 */
export const METADATO_SUPERADMINISTRADOR = 'superadministrador';

/**
 * Claves de metadatos de las rutas del puente de impresión (historia 004, entrega 3b), definidas en
 * `modulos/impresion`: `@Puente()` (credencial `pu.…`) y `@VinculacionPuente()` (credencial `vi.…`). Las define el
 * núcleo, como la de plataforma, para que el guard global de autenticación las deje pasar a su propio guard sin
 * importar el módulo de impresión.
 */
export const METADATO_PUENTE = 'puente';
export const METADATO_VINCULACION_PUENTE = 'vinculacion-puente';
