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

/** Funciones de `pg_catalog` que devuelven el texto de las consultas en curso de otras sesiones. */
const FUNCIONES_DE_ACTIVIDAD = ['pg_stat_get_activity', 'pg_stat_get_backend_activity'];
/** Roles integrados de monitoreo: sus miembros ven el texto de todas las consultas. */
const ROLES_DE_MONITOREO = ['pg_read_all_stats', 'pg_monitor'];

/**
 * Criterio 38b: todas las conexiones de la API comparten el rol `restaurante_api` (y las de
 * plataforma, `restaurante_plataforma`), y PostgreSQL deja que una sesión lea el texto de las
 * consultas de otras sesiones del mismo rol (`pg_stat_activity`, `pg_stat_get_activity(NULL)`,
 * `pg_stat_get_backend_activity(pid)`), con valores de otras empresas. No hay una opción que lo
 * apague, así que se quita el permiso sobre esos objetos de `pg_catalog` (que existen por base de
 * datos: hay que aplicarlo conectado a la base de destino) y se les quita la pertenencia a
 * `pg_read_all_stats` y `pg_monitor`. Los miembros de `pg_read_all_stats` (monitoreo) los conservan.
 * Es repetible. Falla con un mensaje claro si el administrador no puede aplicarlo.
 */
async function protegerCatalogoDeActividad(adminUrl: string, baseDeDatos: string): Promise<void> {
  const cliente = new Client({ connectionString: urlAdminParaBase(adminUrl, baseDeDatos) });
  cliente.on('error', () => undefined);
  await cliente.connect();
  const roles = [ROLES.api, ROLES.plataforma];
  const listaRoles = roles.map((rol) => cliente.escapeIdentifier(rol)).join(', ');
  try {
    const { rows: funciones } = await cliente.query<{ firma: string }>(
      `SELECT p.oid::regprocedure::text AS firma
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog' AND p.proname = ANY ($1::text[])
        ORDER BY 1`,
      [FUNCIONES_DE_ACTIVIDAD],
    );
    const sentencias: string[] = [];
    for (const { firma } of funciones) {
      sentencias.push(
        `REVOKE ALL ON FUNCTION ${firma} FROM PUBLIC, ${listaRoles}`,
        `GRANT EXECUTE ON FUNCTION ${firma} TO pg_read_all_stats`,
      );
    }
    sentencias.push(
      `REVOKE ALL ON pg_catalog.pg_stat_activity FROM PUBLIC, ${listaRoles}`,
      'GRANT SELECT ON pg_catalog.pg_stat_activity TO pg_read_all_stats',
    );
    for (const monitoreo of ROLES_DE_MONITOREO) {
      for (const rol of roles) {
        const { rows } = await cliente.query('SELECT pg_has_role($1, $2, $3) AS miembro', [
          rol,
          monitoreo,
          'MEMBER',
        ]);
        if (rows[0]?.miembro) {
          sentencias.push(
            `REVOKE ${cliente.escapeIdentifier(monitoreo)} FROM ${cliente.escapeIdentifier(rol)}`,
          );
        }
      }
    }
    if (funciones.length === 0) {
      throw new Error('no se encontraron las funciones de actividad de pg_catalog');
    }
    for (const sentencia of sentencias) await cliente.query(sentencia);

    // Verificación: un administrador sin permisos sobre pg_catalog no recibe error, solo avisos.
    const pendientes: string[] = [];
    for (const rol of roles) {
      for (const { firma } of funciones) {
        const { rows } = await cliente.query(
          'SELECT has_function_privilege($1, $2::regprocedure, $3) AS permitido',
          [rol, firma, 'EXECUTE'],
        );
        if (rows[0]?.permitido) pendientes.push(`${rol} puede ejecutar ${firma}`);
      }
      const vista = await cliente.query('SELECT has_table_privilege($1, $2, $3) AS permitido', [
        rol,
        'pg_catalog.pg_stat_activity',
        'SELECT',
      ]);
      if (vista.rows[0]?.permitido) pendientes.push(`${rol} puede leer pg_stat_activity`);
      for (const monitoreo of ROLES_DE_MONITOREO) {
        const { rows } = await cliente.query('SELECT pg_has_role($1, $2, $3) AS miembro', [
          rol,
          monitoreo,
          'MEMBER',
        ]);
        if (rows[0]?.miembro) pendientes.push(`${rol} es miembro de ${monitoreo}`);
      }
    }
    if (pendientes.length > 0) {
      throw new Error(pendientes.join('; '));
    }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo ocultar el texto de las consultas en curso de la base ${baseDeDatos} a ` +
        `${ROLES.api} y ${ROLES.plataforma} (${motivo}). El usuario de DATABASE_ADMIN_URL debe ser ` +
        'superusuario (o dueño de los objetos de pg_catalog) para quitar permisos sobre ' +
        'pg_stat_activity, pg_stat_get_activity y pg_stat_get_backend_activity (criterio 38b). ' +
        'La base queda sin esta protección.',
    );
  } finally {
    await cliente.end();
  }
}

/**
 * Prepara el clúster de forma idempotente: roles sin privilegios especiales (con contraseña),
 * la base con dueño `restaurante_migrador` y los permisos de conexión de la base. Es la única
 * fuente de verdad de los roles: la usan db:preparar, el entorno local, la nube, CI y las pruebas.
 * Los privilegios sobre el esquema y las tablas los fija la primera migración. Además quita a los dos
 * roles de la aplicación el acceso al texto de las consultas de otras sesiones (criterio 38b), lo que
 * exige que el usuario de `DATABASE_ADMIN_URL` sea superusuario.
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

  // 4. Texto de consultas ajenas: se aplica conectado a la base de destino (criterio 38b).
  await protegerCatalogoDeActividad(adminUrl, baseDeDatos);
  registrar(
    `base ${baseDeDatos}: texto de consultas ajenas oculto a ${ROLES.api} y ${ROLES.plataforma}`,
  );
}
