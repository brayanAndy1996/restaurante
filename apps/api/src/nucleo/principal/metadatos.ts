/**
 * Clave de metadatos que marca las rutas de plataforma (`@Superadministrador()`, definido en
 * `modulos/plataforma`). La define el núcleo para que el guard global de autenticación (módulo de
 * seguridad) las deje pasar a su propio guard sin importar el módulo de plataforma.
 */
export const METADATO_SUPERADMINISTRADOR = 'superadministrador';
