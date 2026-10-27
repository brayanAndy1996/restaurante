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

/** Funciones de `pg_catalog` que cancelan o terminan la sesión de otro backend. */
const FUNCIONES_DE_SENAL = ['pg_cancel_backend', 'pg_terminate_backend'];

/**
 * Criterio 38c: igual que el 38b, las sesiones de `restaurante_api` (y de `restaurante_plataforma`)
 * comparten rol, y PostgreSQL deja que una cancele (`pg_cancel_backend`) o termine
 * (`pg_terminate_backend`) a otra del mismo rol, aunque atienda a otra empresa, y que enumere las
 * demás sesiones con las funciones `pg_stat_get_backend_*` (pid, usuario, tiempos). Se quita el
 * `EXECUTE` de todas las firmas a PUBLIC y a los dos roles (se devuelve a `pg_signal_backend` y a
 * `restaurante_migrador` las de señal, y a `pg_read_all_stats` las de estadísticas, para no quitar
 * capacidades a quien las tenga por esos roles) y se les quita la pertenencia a `pg_signal_backend`.
 * Es repetible. El `statement_timeout` del servidor no usa estas funciones (cancela por dentro) ni
 * `pg` (que cancela por el protocolo, con una conexión nueva), así que `/health` y las consultas con
 * tiempo límite no se ven afectados.
 */
async function protegerSenalesDeSesiones(adminUrl: string, baseDeDatos: string): Promise<void> {
  const cliente = new Client({ connectionString: urlAdminParaBase(adminUrl, baseDeDatos) });
  cliente.on('error', () => undefined);
  await cliente.connect();
  const roles = [ROLES.api, ROLES.plataforma];
  const listaRoles = roles.map((rol) => cliente.escapeIdentifier(rol)).join(', ');
  const migrador = cliente.escapeIdentifier(ROLES.migrador);
  try {
    const { rows: funciones } = await cliente.query<{ firma: string; senal: boolean }>(
      `SELECT p.oid::regprocedure::text AS firma, p.proname = ANY ($1::text[]) AS senal
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog'
          AND (p.proname = ANY ($1::text[]) OR p.proname LIKE 'pg\\_stat\\_get\\_backend\\_%')
        ORDER BY 1`,
      [FUNCIONES_DE_SENAL],
    );
    for (const nombre of FUNCIONES_DE_SENAL) {
      if (!funciones.some((f) => f.firma.startsWith(`${nombre}(`))) {
        throw new Error(`no se encontró la función ${nombre} de pg_catalog`);
      }
    }
    if (!funciones.some((f) => f.firma.startsWith('pg_stat_get_backend_idset('))) {
      throw new Error('no se encontraron las funciones pg_stat_get_backend_* de pg_catalog');
    }
    const sentencias: string[] = [];
    for (const { firma, senal } of funciones) {
      sentencias.push(`REVOKE ALL ON FUNCTION ${firma} FROM PUBLIC, ${listaRoles}`);
      if (senal) {
        sentencias.push(`GRANT EXECUTE ON FUNCTION ${firma} TO pg_signal_backend, ${migrador}`);
      } else {
        sentencias.push(`GRANT EXECUTE ON FUNCTION ${firma} TO pg_read_all_stats`);
      }
    }
    for (const rol of roles) {
      const { rows } = await cliente.query('SELECT pg_has_role($1, $2, $3) AS miembro', [
        rol,
        'pg_signal_backend',
        'MEMBER',
      ]);
      if (rows[0]?.miembro) {
        sentencias.push(`REVOKE pg_signal_backend FROM ${cliente.escapeIdentifier(rol)}`);
      }
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
      const { rows } = await cliente.query('SELECT pg_has_role($1, $2, $3) AS miembro', [
        rol,
        'pg_signal_backend',
        'MEMBER',
      ]);
      if (rows[0]?.miembro) pendientes.push(`${rol} es miembro de pg_signal_backend`);
    }
    if (pendientes.length > 0) {
      throw new Error(pendientes.join('; '));
    }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo impedir que ${ROLES.api} y ${ROLES.plataforma} cancelen, terminen o enumeren ` +
        `sesiones ajenas en la base ${baseDeDatos} (${motivo}). El usuario de DATABASE_ADMIN_URL ` +
        'debe ser superusuario (o dueño de los objetos de pg_catalog) para quitar permisos sobre ' +
        'pg_cancel_backend, pg_terminate_backend y pg_stat_get_backend_* (criterio 38c). ' +
        'La base queda sin esta protección.',
    );
  } finally {
    await cliente.end();
  }
}

/** Tablas de `pg_catalog` donde PostgreSQL guarda el contenido y los dueños de los objetos grandes. */
const TABLAS_DE_OBJETOS_GRANDES = ['pg_largeobject', 'pg_largeobject_metadata'];
/** Un catálogo de PostgreSQL 16 trae unas 14 funciones de objetos grandes; menos es una lectura rota. */
const MINIMO_FUNCIONES_DE_OBJETOS_GRANDES = 10;

/**
 * Criterio 38d: los objetos grandes (large objects) de PostgreSQL no tienen RLS ni `empresa_id`, y
 * todas las conexiones de la API comparten el rol `restaurante_api` (y las de plataforma,
 * `restaurante_plataforma`). Con `lo_create`, `lo_put`, `lo_get`, `lo_unlink`, `lo_import`, `loread`,
 * `lowrite`… (por defecto ejecutables por PUBLIC, salvo `lo_import` y `lo_export`) una empresa podría
 * guardar o leer datos que cualquier otra sesión del rol también ve. Se quita el `EXECUTE` de todas
 * las funciones `lo_*`, `loread` y `lowrite` de `pg_catalog` (todas las firmas, descubiertas en
 * `pg_proc`, no una lista fija: una versión nueva de PostgreSQL puede agregar otras) y el `SELECT`
 * sobre `pg_largeobject` y `pg_largeobject_metadata`, a PUBLIC y a los dos roles. Al ser objetos de
 * `pg_catalog` existen por base de datos: hay que aplicarlo conectado a la base de destino. Es
 * repetible y termina comprobando, rol por rol, que quedó aplicado. Falla con un mensaje claro si el
 * administrador no puede aplicarlo.
 */
async function protegerObjetosGrandes(adminUrl: string, baseDeDatos: string): Promise<void> {
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
        WHERE n.nspname = 'pg_catalog'
          AND (p.proname LIKE 'lo\\_%' OR p.proname IN ('loread', 'lowrite'))
        ORDER BY 1`,
    );
    if (funciones.length < MINIMO_FUNCIONES_DE_OBJETOS_GRANDES) {
      throw new Error(
        `solo se encontraron ${funciones.length} funciones de objetos grandes en pg_catalog`,
      );
    }
    const sentencias = funciones.map(
      ({ firma }) => `REVOKE ALL ON FUNCTION ${firma} FROM PUBLIC, ${listaRoles}`,
    );
    for (const tabla of TABLAS_DE_OBJETOS_GRANDES) {
      sentencias.push(`REVOKE ALL ON pg_catalog.${tabla} FROM PUBLIC, ${listaRoles}`);
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
      for (const tabla of TABLAS_DE_OBJETOS_GRANDES) {
        const { rows } = await cliente.query(
          'SELECT has_table_privilege($1, $2, $3) AS permitido',
          [rol, `pg_catalog.${tabla}`, 'SELECT'],
        );
        if (rows[0]?.permitido) pendientes.push(`${rol} puede leer ${tabla}`);
      }
    }
    if (pendientes.length > 0) throw new Error(pendientes.join('; '));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo impedir que ${ROLES.api} y ${ROLES.plataforma} usen objetos grandes en la base ` +
        `${baseDeDatos} (${motivo}). El usuario de DATABASE_ADMIN_URL debe ser superusuario (o ` +
        'dueño de los objetos de pg_catalog) para quitar permisos sobre las funciones lo_*, loread y ' +
        'lowrite y sobre pg_largeobject y pg_largeobject_metadata (criterio 38d). ' +
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
 * roles de la aplicación el acceso al texto de las consultas de otras sesiones (criterio 38b) y la posibilidad de cancelar, terminar o enumerar sesiones ajenas (criterio 38c), y el uso de objetos grandes (criterio 38d), lo que
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

  // 5. Señales y enumeración de sesiones ajenas, también en la base de destino (criterio 38c).
  await protegerSenalesDeSesiones(adminUrl, baseDeDatos);
  registrar(
    `base ${baseDeDatos}: ${ROLES.api} y ${ROLES.plataforma} no pueden cancelar, terminar ni enumerar sesiones ajenas`,
  );

  // 6. Objetos grandes, también en la base de destino (criterio 38d).
  await protegerObjetosGrandes(adminUrl, baseDeDatos);
  registrar(
    `base ${baseDeDatos}: ${ROLES.api} y ${ROLES.plataforma} no pueden usar objetos grandes (large objects)`,
  );
}
