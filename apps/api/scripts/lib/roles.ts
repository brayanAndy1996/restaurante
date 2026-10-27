/** Nombres fijos de los roles (las políticas RLS los nombran) y cómo derivar sus URL. */

export const BASE_DE_DATOS_POR_DEFECTO = 'restaurante';

export const ROLES = {
  migrador: 'restaurante_migrador',
  api: 'restaurante_api',
  plataforma: 'restaurante_plataforma',
} as const;

export type RolAplicacion = keyof typeof ROLES;

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

/** URL de un rol de la aplicación derivada de la del administrador (mismo servidor y puerto). */
export function urlParaRol(
  adminUrl: string,
  rol: RolAplicacion,
  baseDeDatos: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = new URL(adminUrl);
  url.username = ROLES[rol];
  url.password = contrasenaDeRol(rol, env);
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
