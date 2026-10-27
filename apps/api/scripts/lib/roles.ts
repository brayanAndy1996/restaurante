/** Nombres fijos de los roles (las políticas RLS los nombran) y cómo derivar sus URL. */

export const BASE_DE_DATOS_POR_DEFECTO = 'restaurante';

export const ROLES = {
  migrador: 'restaurante_migrador',
  api: 'restaurante_api',
  plataforma: 'restaurante_plataforma',
} as const;

export type RolAplicacion = keyof typeof ROLES;

/** Contraseñas de desarrollo y pruebas; en producción hay que definir `DB_PASSWORD_*`. */
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

/** Contraseñas de `DB_PASSWORD_*` o, si faltan, las de desarrollo (nunca en producción). */
export function contrasenasDeRoles(
  env: NodeJS.ProcessEnv = process.env,
): Record<RolAplicacion, string> {
  const resultado = { ...CONTRASENAS_POR_DEFECTO };
  for (const rol of Object.keys(ROLES) as RolAplicacion[]) {
    const definida = env[VARIABLE_CONTRASENA[rol]];
    if (definida) {
      resultado[rol] = definida;
    } else if (env.NODE_ENV === 'production') {
      throw new Error(
        `Falta ${VARIABLE_CONTRASENA[rol]}: en producción no hay contraseña por defecto`,
      );
    }
  }
  return resultado;
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
  url.password = contrasenasDeRoles(env)[rol];
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
