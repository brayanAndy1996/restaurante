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
  /** De dónde se leen `NODE_ENV`, `DB_PASSWORD_*` y `DB_PROTECCION_CATALOGO`; por defecto `process.env`. */
  env?: NodeJS.ProcessEnv;
  registrar?: (mensaje: string) => void;
  /**
   * Recibe el aviso de las protecciones del catálogo omitidas (criterio 38e): solo se llama si el
   * administrador no puede aplicarlas y `DB_PROTECCION_CATALOGO=omitir`. Por defecto, la salida de
   * error (`console.warn`).
   */
  avisar?: (mensaje: string) => void;
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

/** Funciones de `pg_catalog` que ejecutan como SQL un texto (o un cursor) que reciben. */
const FUNCIONES_QUE_EJECUTAN_SQL = [
  'ts_rewrite',
  'ts_stat',
  'query_to_xml',
  'query_to_xmlschema',
  'query_to_xml_and_xmlschema',
  'cursor_to_xml',
  'cursor_to_xmlschema',
];
/** Un catálogo de PostgreSQL 16 trae unas 9 firmas de estas funciones; menos es una lectura rota. */
const MINIMO_FIRMAS_QUE_EJECUTAN_SQL = 7;

/**
 * Criterio 22d: dentro de una transacción de `restaurante_api` con el contexto de la empresa A, las
 * funciones que ejecutan SQL recibido como texto (`ts_rewrite`, todas sus firmas, `ts_stat`,
 * `query_to_xml`, `query_to_xmlschema`, `query_to_xml_and_xmlschema`) o por nombre de cursor
 * (`cursor_to_xml`, `cursor_to_xmlschema`) pueden llamar `set_config('app.empresa_id', <B>, true)` sin
 * que la guarda de la API lo vea, y la vista `pg_settings` es actualizable (un `UPDATE` equivale a
 * `set_config`). Se quita el `EXECUTE` de todas las firmas (descubiertas en `pg_proc`, no una lista
 * fija) a PUBLIC y a los dos roles (incluidas las dos de `ts_rewrite`), y el `UPDATE` sobre
 * `pg_settings`. No se toca `set_config` (lo usa `ContextoEmpresa`),
 * `current_setting` ni el `SELECT` sobre `pg_settings`. Al ser objetos de `pg_catalog` existen por base
 * de datos: hay que aplicarlo conectado a la base de destino. Es repetible y termina comprobando, rol
 * por rol, que quedó aplicado. Falla con un mensaje claro si el administrador no puede aplicarlo.
 */
async function protegerEjecucionDeSql(adminUrl: string, baseDeDatos: string): Promise<void> {
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
          AND p.proname = ANY ($1::text[])
        ORDER BY 1`,
      [FUNCIONES_QUE_EJECUTAN_SQL],
    );
    for (const nombre of FUNCIONES_QUE_EJECUTAN_SQL) {
      if (!funciones.some((f) => f.firma.startsWith(`${nombre}(`))) {
        throw new Error(`no se encontró la función ${nombre} de pg_catalog`);
      }
    }
    if (funciones.length < MINIMO_FIRMAS_QUE_EJECUTAN_SQL) {
      throw new Error(`solo se encontraron ${funciones.length} firmas en pg_catalog`);
    }
    const sentencias = funciones.map(
      ({ firma }) => `REVOKE ALL ON FUNCTION ${firma} FROM PUBLIC, ${listaRoles}`,
    );
    sentencias.push(`REVOKE UPDATE ON pg_catalog.pg_settings FROM PUBLIC, ${listaRoles}`);
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
      const { rows } = await cliente.query('SELECT has_table_privilege($1, $2, $3) AS permitido', [
        rol,
        'pg_catalog.pg_settings',
        'UPDATE',
      ]);
      if (rows[0]?.permitido) pendientes.push(`${rol} puede actualizar pg_settings`);
    }
    if (pendientes.length > 0) throw new Error(pendientes.join('; '));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo impedir que ${ROLES.api} y ${ROLES.plataforma} ejecuten SQL armado como texto ni ` +
        `actualicen pg_settings en la base ${baseDeDatos} (${motivo}). El usuario de ` +
        'DATABASE_ADMIN_URL debe ser superusuario (o dueño de los objetos de pg_catalog) para quitar ' +
        'permisos sobre ts_rewrite, ts_stat, query_to_xml, query_to_xmlschema, ' +
        'query_to_xml_and_xmlschema, cursor_to_xml, cursor_to_xmlschema y sobre UPDATE en pg_settings ' +
        '(criterio 22d). La base queda sin esta protección.',
    );
  } finally {
    await cliente.end();
  }
}

/** Valor único válido de `DB_PROTECCION_CATALOGO` (criterio 38e). */
const OMITIR_PROTECCION = 'omitir';

/**
 * Lee `DB_PROTECCION_CATALOGO` antes de tocar nada: sin definir o vacía es "no omitir"; `omitir` pide
 * omitir las protecciones del catálogo si el administrador no puede aplicarlas; cualquier otro valor
 * (`omitirr`, `OMITIR`…) es un error, haya o no superusuario.
 */
function leerProteccionCatalogo(env: NodeJS.ProcessEnv): { omitir: boolean } {
  const valor = env.DB_PROTECCION_CATALOGO;
  if (valor === undefined || valor === '') return { omitir: false };
  if (valor === OMITIR_PROTECCION) return { omitir: true };
  throw new Error(
    `DB_PROTECCION_CATALOGO tiene un valor no válido (${JSON.stringify(valor)}): el único valor ` +
      `válido es ${OMITIR_PROTECCION} (en minúsculas) y, para aplicar las protecciones del catálogo, ` +
      'la variable se deja sin definir (criterio 38e).',
  );
}

/** Funciones de `pg_catalog` cuyas protecciones aplica `db:preparar` (para leer sus dueños). */
const NOMBRES_DE_FUNCIONES_PROTEGIDAS = [
  ...FUNCIONES_DE_ACTIVIDAD,
  ...FUNCIONES_DE_SENAL,
  ...FUNCIONES_QUE_EJECUTAN_SQL,
  'loread',
  'lowrite',
];
/** Relaciones de `pg_catalog` cuyas protecciones aplica `db:preparar` (para leer sus dueños). */
const RELACIONES_PROTEGIDAS = [
  'pg_catalog.pg_stat_activity',
  'pg_catalog.pg_largeobject',
  'pg_catalog.pg_largeobject_metadata',
  'pg_catalog.pg_settings',
];

/**
 * Criterio 38e (a): ¿puede el usuario de `DATABASE_ADMIN_URL` aplicar las protecciones del catálogo
 * (38b, 38c, 38d y la capa de base de 22d)? Puede si es superusuario o si tiene los privilegios del
 * dueño de los objetos de `pg_catalog` afectados (el dueño se lee del catálogo, no se supone; en la
 * práctica es el superusuario de arranque del clúster). Los roles y el dueño de arranque son del
 * clúster, así que basta mirarlo desde la base de conexión. No modifica nada.
 */
async function puedeProtegerElCatalogo(admin: Client): Promise<boolean> {
  const { rows } = await admin.query<{ puede: boolean }>(
    `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
            OR COALESCE(bool_and(pg_has_role(current_user, d.dueno, 'USAGE')), false) AS puede
       FROM (SELECT p.proowner AS dueno
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'pg_catalog'
                AND (p.proname = ANY ($1::text[])
                     OR p.proname LIKE 'lo\\_%'
                     OR p.proname LIKE 'pg\\_stat\\_get\\_backend\\_%')
             UNION
             SELECT c.relowner
               FROM pg_class c
              WHERE c.oid = ANY ($2::regclass[])) d`,
    [NOMBRES_DE_FUNCIONES_PROTEGIDAS, RELACIONES_PROTEGIDAS],
  );
  return rows[0]?.puede === true;
}

const CRITERIOS_DEL_CATALOGO =
  'texto de consultas ajenas (criterio 38b), cancelar, terminar o enumerar sesiones ajenas ' +
  '(criterio 38c), objetos grandes (criterio 38d) y la capa de base de SQL armado como texto y ' +
  'UPDATE sobre pg_settings (criterio 22d)';

function mensajeSinPermisosSobreElCatalogo(usuario: string): string {
  return (
    `El usuario de DATABASE_ADMIN_URL (${usuario}) no es superusuario ni tiene los privilegios del ` +
    'dueño de los objetos de pg_catalog, así que no puede aplicar las protecciones del catálogo: ' +
    `${CRITERIOS_DEL_CATALOGO}. No se creó ni se modificó ningún rol ni base de datos. ` +
    'Si PostgreSQL es administrado y no da superusuario (producción), define ' +
    'DB_PROTECCION_CATALOGO=omitir: db:preparar prepara los roles, la base y sus privilegios sin esas ' +
    'protecciones y escribe un aviso; entonces quedan solo en la guarda de la API y en la de ' +
    'plataforma, que rechazan sus nombres, y el aislamiento entre empresas (RLS y criterio 22e) no ' +
    'depende de ellas (criterio 38e). Si no, usa un administrador superusuario.'
  );
}

function avisoDeProteccionesOmitidas(baseDeDatos: string): string {
  return (
    `AVISO: DB_PROTECCION_CATALOGO=omitir y el administrador no es superusuario: en la base ` +
    `${baseDeDatos} NO se aplicaron las protecciones del catálogo de PostgreSQL:\n` +
    '  - texto de consultas ajenas: pg_stat_activity y afines (criterio 38b)\n' +
    '  - cancelar, terminar o enumerar sesiones ajenas: pg_cancel_backend, pg_terminate_backend y ' +
    'pg_stat_get_backend_* (criterio 38c)\n' +
    '  - objetos grandes: lo_*, loread, lowrite, pg_largeobject y pg_largeobject_metadata (criterio 38d)\n' +
    '  - SQL armado como texto y UPDATE sobre pg_settings, capa de base: ts_rewrite, ts_stat, ' +
    'query_to_xml*, cursor_to_xml* (criterio 22d)\n' +
    'Esas protecciones quedan solo en la guarda de la API y en la de plataforma, que rechazan sus ' +
    'nombres (criterio 38e). El aislamiento entre empresas (RLS y criterio 22e) no depende de ellas. ' +
    'No instales en esa base extensiones como pg_stat_statements, dblink o postgres_fdw, ni des a ' +
    'los roles de la aplicación pg_monitor, pg_read_all_stats ni pg_signal_backend.'
  );
}

/** Clave del bloqueo asesor que serializa las preparaciones (evita "tuple concurrently updated"). */
const BLOQUEO_PREPARAR = "hashtext('restaurante:preparar-bd')";

/** Atributos que `ALTER ROLE` rechaza nombrar a un administrador que no es superusuario (PostgreSQL 16). */
const ATRIBUTOS_RESERVADOS_A_SUPERUSUARIO = [
  ['rolsuper', 'SUPERUSER'],
  ['rolbypassrls', 'BYPASSRLS'],
  ['rolreplication', 'REPLICATION'],
] as const;

/**
 * Prepara el clúster de forma idempotente: roles sin privilegios especiales (con contraseña),
 * la base con dueño `restaurante_migrador` y los permisos de conexión de la base. Es la única
 * fuente de verdad de los roles: la usan db:preparar, el entorno local, la nube, CI y las pruebas.
 * Los privilegios sobre el esquema y las tablas los fija la primera migración. Además quita a los dos
 * roles de la aplicación el acceso al texto de las consultas de otras sesiones (criterio 38b) y la
 * posibilidad de cancelar, terminar o enumerar sesiones ajenas (criterio 38c), el uso de objetos
 * grandes (criterio 38d) y la ejecución de SQL armado como texto y el `UPDATE` sobre `pg_settings`
 * (criterio 22d), lo que exige que el usuario de `DATABASE_ADMIN_URL` sea superusuario.
 *
 * Modo sin superusuario (criterio 38e, PostgreSQL administrado): antes de crear o modificar nada se
 * valida `DB_PROTECCION_CATALOGO` y se comprueba si el administrador puede aplicar esas protecciones.
 * Si no puede y la variable no es `omitir`, falla sin tocar nada; con `omitir` aplica todo lo demás,
 * omite las protecciones del catálogo y avisa (`avisar`, por defecto la salida de error). Con
 * superusuario las aplica siempre. Un bloqueo asesor serializa las preparaciones simultáneas.
 */
export async function prepararBaseDeDatos(opciones: OpcionesPrepararBd = {}): Promise<void> {
  const env = opciones.env ?? process.env;
  const registrar = opciones.registrar ?? (() => undefined);
  const avisar = opciones.avisar ?? ((mensaje: string) => console.warn(mensaje));
  const adminUrl = opciones.adminUrl ?? exigirUrlAdmin(env);
  const baseDeDatos = validarNombreDeBase(opciones.baseDeDatos ?? BASE_DE_DATOS_POR_DEFECTO);
  const contrasenas = contrasenasDeRoles(env);
  const { omitir } = leerProteccionCatalogo(env);

  const admin = new Client({ connectionString: urlAdminParaBase(adminUrl, 'postgres') });
  admin.on('error', () => undefined);
  await admin.connect();
  let aplicarProtecciones: boolean;
  try {
    // Dos preparaciones a la vez sobre el mismo clúster (por ejemplo varios archivos de pruebas)
    // chocan con "tuple concurrently updated" al modificar los mismos roles y objetos: se serializan.
    await admin.query(`SELECT pg_advisory_lock(${BLOQUEO_PREPARAR})`);

    // 0. Antes de tocar nada: ¿puede el administrador aplicar las protecciones del catálogo?
    const { rows: yo } = await admin.query<{ usuario: string; esSuperusuario: boolean }>(
      `SELECT current_user::text AS usuario, rolsuper AS "esSuperusuario"
         FROM pg_roles WHERE rolname = current_user`,
    );
    const usuario = yo[0]?.usuario ?? 'desconocido';
    const esSuperusuario = yo[0]?.esSuperusuario === true;
    aplicarProtecciones = await puedeProtegerElCatalogo(admin);
    if (!aplicarProtecciones && !omitir) {
      throw new Error(mensajeSinPermisosSobreElCatalogo(usuario));
    }
    if (aplicarProtecciones && omitir) {
      registrar(
        'DB_PROTECCION_CATALOGO=omitir se ignora: el administrador puede aplicar las protecciones',
      );
    }

    // 1. Roles (CREATE o ALTER: deja siempre los mismos atributos y la contraseña vigente).
    for (const [clave, nombre] of Object.entries(ROLES) as [keyof typeof ROLES, string][]) {
      const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [nombre]);
      // PostgreSQL 16: un administrador que no es superusuario no puede nombrar SUPERUSER, BYPASSRLS
      // ni REPLICATION en ALTER ROLE ni siquiera para negarlos (CREATE ROLE sí lo admite). Se omiten
      // en ese caso y se comprueba abajo que el rol no los tiene.
      const reservados = existe.rowCount && !esSuperusuario ? '' : 'NOSUPERUSER NOBYPASSRLS ';
      const replicacion = existe.rowCount && !esSuperusuario ? '' : ' NOREPLICATION';
      const atributos =
        `LOGIN ${reservados}NOCREATEDB NOCREATEROLE NOINHERIT${replicacion} ` +
        `PASSWORD ${admin.escapeLiteral(contrasenas[clave])}`;
      try {
        await admin.query(
          `${existe.rowCount ? 'ALTER' : 'CREATE'} ROLE ${admin.escapeIdentifier(nombre)} ${atributos}`,
        );
      } catch (error) {
        if (existe.rowCount && !esSuperusuario) {
          const motivo = error instanceof Error ? error.message : String(error);
          throw new Error(
            `No se pudo modificar el rol ${nombre} con ${usuario} (${motivo}). Un administrador que no ` +
              `es superusuario necesita CREATEROLE y ADMIN OPTION sobre ${nombre}; los tiene si ` +
              'creó el rol.',
          );
        }
        throw error;
      }
      if (existe.rowCount && !esSuperusuario) {
        const { rows } = await admin.query<Record<string, boolean>>(
          'SELECT rolsuper, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = $1',
          [nombre],
        );
        for (const [columna, atributo] of ATRIBUTOS_RESERVADOS_A_SUPERUSUARIO) {
          if (rows[0]?.[columna]) {
            throw new Error(
              `El rol ${nombre} tiene el atributo ${atributo} y ${usuario}, que no es superusuario, no ` +
                'puede quitárselo: hay que quitarlo con un superusuario (los roles de la aplicación ' +
                'no deben tenerlo, criterio 7).',
            );
          }
        }
      }
      registrar(`rol ${nombre}: ${existe.rowCount ? 'actualizado' : 'creado'}`);
    }
    await admin.query(
      `ALTER ROLE ${admin.escapeIdentifier(ROLES.api)} SET idle_in_transaction_session_timeout = '30s'`,
    );

    // Un administrador que no es superusuario necesita ser miembro del rol dueño para crear la base.
    if (!esSuperusuario) {
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

    if (aplicarProtecciones) {
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

      // 7. Funciones que ejecutan SQL desde texto y UPDATE sobre pg_settings (criterio 22d).
      await protegerEjecucionDeSql(adminUrl, baseDeDatos);
      registrar(
        `base ${baseDeDatos}: ${ROLES.api} y ${ROLES.plataforma} no pueden ejecutar SQL armado como texto ni actualizar pg_settings`,
      );
    } else {
      // Sin superusuario y con DB_PROTECCION_CATALOGO=omitir (criterio 38e).
      avisar(avisoDeProteccionesOmitidas(baseDeDatos));
    }
  } finally {
    await admin.query(`SELECT pg_advisory_unlock(${BLOQUEO_PREPARAR})`).catch(() => undefined);
    await admin.end();
  }
}
