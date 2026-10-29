/** Nombres fijos de los roles (las políticas RLS los nombran) y cómo derivar sus URL. */

export const BASE_DE_DATOS_POR_DEFECTO = 'restaurante';

export const ROLES = {
  migrador: 'restaurante_migrador',
  api: 'restaurante_api',
  plataforma: 'restaurante_plataforma',
} as const;

export type RolAplicacion = keyof typeof ROLES;

/**
 * Rol del adaptador de Socket.IO (historia 004): sin privilegios sobre `public`, solo sobre el esquema
 * `tiempo_real`. Lo crea `db:preparar` junto con los tres de arriba, pero no forma parte de `ROLES` ni de
 * `contrasenasDeRoles` (esos son los roles que tocan las tablas de la aplicación).
 */
export const ROL_TIEMPO_REAL = 'restaurante_tiempo_real';

/** Rol que tiene URL derivada: los de `ROLES` y el del tiempo real. */
export type RolConUrl = RolAplicacion | 'tiempoReal';

/** Contraseña de desarrollo y pruebas del rol del tiempo real. */
export const CONTRASENA_TIEMPO_REAL_POR_DEFECTO = 'tiempo_real_local';

/** Contraseñas de desarrollo y pruebas; fuera de `NODE_ENV` development o test hay que definir `DB_PASSWORD_*`. */
export const CONTRASENAS_POR_DEFECTO: Record<RolAplicacion, string> = {
  migrador: 'migrador_local',
  api: 'api_local',
  plataforma: 'plataforma_local',
};

const VARIABLE_CONTRASENA: Record<RolAplicacion, string> = {
  migrador: 'DB_PASSWORD_MIGRADOR',
  api: 'DB_PASSWORD_API',
  plataforma: 'DB_PASSWORD_PLATAFORMA',
};

/** Con estos valores de `NODE_ENV` (escritos de forma explícita) se aceptan las contraseñas por defecto. */
const ENTORNOS_CON_CONTRASENA_POR_DEFECTO = ['development', 'test'];

/**
 * Contraseña de un rol: la de su `DB_PASSWORD_*` o, solo con `NODE_ENV` `development` o `test`
 * explícito, la de desarrollo. Sin `NODE_ENV`, o con otro valor, falta la variable y falla nombrándola
 * (criterio 29b): así un despliegue que olvide `NODE_ENV=production` no queda con contraseñas conocidas.
 */
export function contrasenaDeRol(rol: RolAplicacion, env: NodeJS.ProcessEnv = process.env): string {
  const definida = env[VARIABLE_CONTRASENA[rol]];
  if (definida) return definida;
  if (env.NODE_ENV !== undefined && ENTORNOS_CON_CONTRASENA_POR_DEFECTO.includes(env.NODE_ENV)) {
    return CONTRASENAS_POR_DEFECTO[rol];
  }
  throw new Error(
    `Falta ${VARIABLE_CONTRASENA[rol]}: solo hay contraseña por defecto con NODE_ENV=development ` +
      'o NODE_ENV=test escritos de forma explícita',
  );
}

/**
 * Contraseña del rol del tiempo real: `DB_PASSWORD_TIEMPO_REAL` o, solo con `NODE_ENV` `development` o `test`
 * explícito, la de desarrollo; si no, falla nombrando la variable (como `contrasenaDeRol`).
 */
export function contrasenaDeTiempoReal(env: NodeJS.ProcessEnv = process.env): string {
  const definida = env.DB_PASSWORD_TIEMPO_REAL;
  if (definida) return definida;
  if (env.NODE_ENV !== undefined && ENTORNOS_CON_CONTRASENA_POR_DEFECTO.includes(env.NODE_ENV)) {
    return CONTRASENA_TIEMPO_REAL_POR_DEFECTO;
  }
  throw new Error(
    'Falta DB_PASSWORD_TIEMPO_REAL: solo hay contraseña por defecto con NODE_ENV=development ' +
      'o NODE_ENV=test escritos de forma explícita',
  );
}

/** Contraseñas de los tres roles (ver `contrasenaDeRol`). */
export function contrasenasDeRoles(
  env: NodeJS.ProcessEnv = process.env,
): Record<RolAplicacion, string> {
  return {
    migrador: contrasenaDeRol('migrador', env),
    api: contrasenaDeRol('api', env),
    plataforma: contrasenaDeRol('plataforma', env),
  };
}

/**
 * Base de datos a la que apuntan los scripts cuando no se les da una: la de `DATABASE_URL` si está
 * definida (y tiene nombre de base) o, si no, `restaurante`.
 */
export function baseDeDatosDelEntorno(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) return BASE_DE_DATOS_POR_DEFECTO;
  let nombre: string;
  try {
    nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL no es una URL válida');
  }
  return nombre === '' ? BASE_DE_DATOS_POR_DEFECTO : validarNombreDeBase(nombre);
}

export function validarNombreDeBase(nombre: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(nombre)) {
    throw new Error(
      `Nombre de base de datos inválido: "${nombre}" (minúsculas, dígitos y guion bajo)`,
    );
  }
  return nombre;
}

/** URL del administrador apuntando a otra base (misma conexión, otro nombre de base). */
export function urlAdminParaBase(adminUrl: string, baseDeDatos: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${validarNombreDeBase(baseDeDatos)}`;
  return url.toString();
}

/** Base de mantenimiento por defecto de PostgreSQL. */
export const BASE_DE_MANTENIMIENTO = 'postgres';

/**
 * URL con la que el administrador crea roles y bases: la de `DATABASE_ADMIN_URL` tal cual (en
 * DigitalOcean la base de mantenimiento es `defaultdb`, no `postgres`). Si la URL no nombra base, o
 * nombra la que se va a preparar (no se puede borrar la base a la que se está conectado), usa
 * `postgres`, como antes.
 */
export function urlAdminDeMantenimiento(adminUrl: string, baseDeDestino: string): string {
  let nombre: string;
  try {
    nombre = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_ADMIN_URL no es una URL válida');
  }
  if (nombre === '' || nombre === baseDeDestino) {
    return urlAdminParaBase(adminUrl, BASE_DE_MANTENIMIENTO);
  }
  return adminUrl;
}

/** URL de un rol de la aplicación derivada de la del administrador (mismo servidor y puerto). */
export function urlParaRol(
  adminUrl: string,
  rol: RolConUrl,
  baseDeDatos: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = new URL(adminUrl);
  url.username = rol === 'tiempoReal' ? ROL_TIEMPO_REAL : ROLES[rol];
  url.password = rol === 'tiempoReal' ? contrasenaDeTiempoReal(env) : contrasenaDeRol(rol, env);
  url.pathname = `/${validarNombreDeBase(baseDeDatos)}`;
  return url.toString();
}

export function exigirUrlAdmin(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      'DATABASE_ADMIN_URL no está definida. Se necesita un usuario administrador de PostgreSQL ' +
        '(por ejemplo postgres://postgres:postgres@localhost:5432/postgres) para crear roles y bases.',
    );
  }
  return url;
}
