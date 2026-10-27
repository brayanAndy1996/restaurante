import { Client } from 'pg';
import {
  BASE_DE_DATOS_POR_DEFECTO,
  ROLES,
  contrasenasDeRoles,
  exigirUrlAdmin,
  urlAdminParaBase,
  validarNombreDeBase,
} from './roles';

export interface OpcionesPrepararBd {
  /** Por defecto `DATABASE_ADMIN_URL`. */
  adminUrl?: string;
  /** Base a crear; por defecto `restaurante`. */
  baseDeDatos?: string;
  /** Borra la base si existe (para las pruebas). Nunca se usa con la base de desarrollo. */
  recrear?: boolean;
  env?: NodeJS.ProcessEnv;
  registrar?: (mensaje: string) => void;
}

/**
 * Prepara el clúster de forma idempotente: roles sin privilegios especiales (con contraseña),
 * la base con dueño `restaurante_migrador` y los permisos de conexión de la base. Es la única
 * fuente de verdad de los roles: la usan db:preparar, el entorno local, la nube, CI y las pruebas.
 * Los privilegios sobre el esquema y las tablas los fija la primera migración.
 */
export async function prepararBaseDeDatos(opciones: OpcionesPrepararBd = {}): Promise<void> {
  const env = opciones.env ?? process.env;
  const registrar = opciones.registrar ?? (() => undefined);
  const adminUrl = opciones.adminUrl ?? exigirUrlAdmin(env);
  const baseDeDatos = validarNombreDeBase(opciones.baseDeDatos ?? BASE_DE_DATOS_POR_DEFECTO);
  const contrasenas = contrasenasDeRoles(env);

  const admin = new Client({ connectionString: urlAdminParaBase(adminUrl, 'postgres') });
  admin.on('error', () => undefined);
  await admin.connect();
  try {
    // 1. Roles (CREATE o ALTER: deja siempre los mismos atributos y la contraseña vigente).
    for (const [clave, nombre] of Object.entries(ROLES) as [keyof typeof ROLES, string][]) {
      const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nombre]);
      const atributos =
        'LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION ' +
        `PASSWORD ${admin.escapeLiteral(contrasenas[clave])}`;
      await admin.query(
        `${existe.rowCount ? 'ALTER' : 'CREATE'} ROLE ${admin.escapeIdentifier(nombre)} ${atributos}`,
      );
      registrar(`rol ${nombre}: ${existe.rowCount ? 'actualizado' : 'creado'}`);
    }
    await admin.query(
      `ALTER ROLE ${admin.escapeIdentifier(ROLES.api)} SET idle_in_transaction_session_timeout = '30s'`,
    );

    // Un administrador que no es superusuario necesita ser miembro del rol dueño para crear la base.
    const { rows } = await admin.query<{ rolsuper: boolean }>(
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    if (!rows[0]?.rolsuper) {
      await admin.query(`GRANT ${admin.escapeIdentifier(ROLES.migrador)} TO CURRENT_USER`);
    }

    // 2. Base de datos con dueño restaurante_migrador.
    const base = admin.escapeIdentifier(baseDeDatos);
    if (opciones.recrear) {
      await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
      registrar(`base ${baseDeDatos}: eliminada`);
    }
    const existeBase = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      baseDeDatos,
    ]);
    if (existeBase.rowCount) {
      await admin.query(
        `ALTER DATABASE ${base} OWNER TO ${admin.escapeIdentifier(ROLES.migrador)}`,
      );
      registrar(`base ${baseDeDatos}: ya existía`);
    } else {
      await admin.query(`CREATE DATABASE ${base} OWNER ${admin.escapeIdentifier(ROLES.migrador)}`);
      registrar(`base ${baseDeDatos}: creada`);
    }

    // 3. Permisos de la base: nada para PUBLIC (CONNECT, CREATE, TEMPORARY); CONNECT para los dos roles.
    await admin.query(`REVOKE ALL ON DATABASE ${base} FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE ${base} TO ${admin.escapeIdentifier(ROLES.api)}, ${admin.escapeIdentifier(ROLES.plataforma)}`,
    );
  } finally {
    await admin.end();
  }
}
