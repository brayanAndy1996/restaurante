// spec: 001-base-multitenancy (pruebas protegidas)
//
// Lista de nombres que la guarda de la API y la de plataforma rechazan antes de la base, fuera de literales
// y comentarios (criterio 38e, inciso d, y los criterios 22b, 22d y 22e que ya rechazaban algunos). Cada
// entrada trae una sentencia sintácticamente válida para PostgreSQL que menciona el nombre; `variantes()`
// la reescribe con el esquema, entre comillas dobles, en mayúsculas, tras otra sentencia permitida y tras
// comentarios (criterio 38e, inciso e).

export interface EntradaProhibida {
  /** Nombre completo, o un identificador que empieza con uno de los prefijos (`lo_x`, `pg_stat_get_backend_x`). */
  nombre: string;
  /** Grupo de la lista: de qué criterio viene. */
  grupo: '38b' | '38c' | '38d' | 'xml' | '22d' | '22e';
  /** Sentencia que menciona el nombre ya renderizado (`n`), por ejemplo `SELECT lo_get(1)`. */
  sql: (n: string) => string;
  /** Esquema con el que se puede calificar (`pg_catalog.lo_get`); sin valor, no se califica. */
  esquema?: 'pg_catalog' | 'public';
}

const BYTEA = '\\x00';

const pgCatalog = 'pg_catalog' as const;

export const ENTRADAS: EntradaProhibida[] = [
  // 38b · texto de consultas ajenas
  {
    nombre: 'pg_stat_activity',
    grupo: '38b',
    sql: (n) => `SELECT query FROM ${n}`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_stat_get_activity',
    grupo: '38b',
    sql: (n) => `SELECT * FROM ${n}(NULL)`,
    esquema: pgCatalog,
  },
  // 38c · cancelar, terminar o enumerar sesiones ajenas
  {
    nombre: 'pg_cancel_backend',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1)`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_terminate_backend',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1)`,
    esquema: pgCatalog,
  },
  { nombre: 'pg_signal_backend', grupo: '38c', sql: (n) => `SELECT 1 AS ${n}` },
  ...[
    ['pg_stat_get_backend_idset', ''],
    ['pg_stat_get_backend_pid', '1'],
    ['pg_stat_get_backend_userid', '1'],
    ['pg_stat_get_backend_start', '1'],
    ['pg_stat_get_backend_activity', '1'],
    ['pg_stat_get_backend_activity_start', '1'],
    ['pg_stat_get_backend_xact_start', '1'],
    ['pg_stat_get_backend_client_addr', '1'],
  ].map(([nombre, args]): EntradaProhibida => ({
    nombre: nombre!,
    grupo: '38c',
    sql: (n) => `SELECT ${n}(${args})`,
    esquema: pgCatalog,
  })),
  // Prefijo: cualquier identificador que empiece así se rechaza, también un alias.
  { nombre: 'pg_stat_get_backend_x', grupo: '38c', sql: (n) => `SELECT 1 AS ${n}` },
  // 38d · objetos grandes
  {
    nombre: 'pg_largeobject',
    grupo: '38d',
    sql: (n) => `SELECT 1 FROM ${n}`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_largeobject_metadata',
    grupo: '38d',
    sql: (n) => `SELECT oid FROM ${n}`,
    esquema: pgCatalog,
  },
  { nombre: 'loread', grupo: '38d', sql: (n) => `SELECT ${n}(0, 1)`, esquema: pgCatalog },
  {
    nombre: 'lowrite',
    grupo: '38d',
    sql: (n) => `SELECT ${n}(0, '${BYTEA}')`,
    esquema: pgCatalog,
  },
  ...[
    ['lo_create', '0'],
    ['lo_creat', '-1'],
    ['lo_from_bytea', `0, '${BYTEA}'`],
    ['lo_get', '1'],
    ['lo_put', `1, 0, '${BYTEA}'`],
    ['lo_open', '1, 262144'],
    ['lo_unlink', '1'],
    ['lo_import', `'/tmp/x'`],
    ['lo_export', `1, '/tmp/x'`],
    ['lo_truncate', '0, 0'],
    ['lo_truncate64', '0, 0'],
    ['lo_lseek', '0, 0, 0'],
    ['lo_lseek64', '0, 0, 0'],
    ['lo_tell', '0'],
    ['lo_tell64', '0'],
    ['lo_close', '0'],
  ].map(([nombre, args]): EntradaProhibida => ({
    nombre: nombre!,
    grupo: '38d',
    sql: (n) => `SELECT ${n}(${args})`,
    esquema: pgCatalog,
  })),
  { nombre: 'lo_x', grupo: '38d', sql: (n) => `SELECT 1 AS ${n}` },
  // Funciones que leen una relación nombrada dentro de un literal
  ...[
    ['table_to_xml', `'pg_largeobject_metadata', true, false, ''`],
    ['table_to_xmlschema', `'pg_largeobject_metadata', true, false, ''`],
    ['table_to_xml_and_xmlschema', `'pg_largeobject_metadata', true, false, ''`],
    ['schema_to_xml', `'pg_catalog', true, false, ''`],
    ['schema_to_xmlschema', `'pg_catalog', true, false, ''`],
    ['schema_to_xml_and_xmlschema', `'pg_catalog', true, false, ''`],
    ['database_to_xml', `true, false, ''`],
    ['database_to_xmlschema', `true, false, ''`],
    ['database_to_xml_and_xmlschema', `true, false, ''`],
  ].map(([nombre, args]): EntradaProhibida => ({
    nombre: nombre!,
    grupo: 'xml',
    sql: (n) => `SELECT ${n}(${args})`,
    esquema: pgCatalog,
  })),
  // 22d · SQL desde texto y parámetros (ya se rechazaban)
  {
    nombre: 'set_config',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('x.y', 'z', true)`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_settings',
    grupo: '22d',
    sql: (n) => `SELECT 1 FROM ${n}`,
    esquema: pgCatalog,
  },
  {
    nombre: 'ts_rewrite',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('x'::tsquery, 'SELECT ''a''::tsquery, ''b''::tsquery')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'ts_stat',
    grupo: '22d',
    sql: (n) => `SELECT * FROM ${n}('SELECT ''a''::tsvector')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'query_to_xml',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('SELECT 1', true, false, '')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'query_to_xmlschema',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('SELECT 1', true, false, '')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'query_to_xml_and_xmlschema',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('SELECT 1', true, false, '')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'cursor_to_xml',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('c', 1, true, false, '')`,
    esquema: pgCatalog,
  },
  {
    nombre: 'cursor_to_xmlschema',
    grupo: '22d',
    sql: (n) => `SELECT ${n}('c', true, false, '')`,
    esquema: pgCatalog,
  },
  // 22e · fijación del contexto (sin la excepción de la fijación propia de ContextoEmpresa)
  {
    nombre: 'fijar_contexto_empresa',
    grupo: '22e',
    sql: (n) => `SELECT ${n}('00000000-0000-0000-0000-000000000000')`,
    esquema: 'public',
  },
];

/** Variante de una sentencia: descripción y SQL ya renderizado. */
export type Variante = [descripcion: string, sql: string];

/**
 * Variantes de la sentencia de `entrada`: plano, con esquema, entre comillas dobles (con y sin esquema), en
 * mayúsculas, tras otra sentencia permitida y tras comentarios de bloque, de línea y de línea terminado en `\r`.
 */
export function variantes(entrada: EntradaProhibida): Variante[] {
  const { nombre, sql, esquema } = entrada;
  const plano = sql(nombre);
  const resultado: Variante[] = [
    ['plano', plano],
    ['en mayúsculas', sql(nombre.toUpperCase())],
    ['entre comillas dobles', sql(`"${nombre}"`)],
    ['tras otra sentencia permitida', `SELECT 1; ${plano}`],
    ['tras un comentario de bloque', `/* x */ ${plano}`],
    ['tras un comentario de línea', `-- x\n${plano}`],
    ['tras un comentario de línea terminado en \\r', `-- x\r${plano}`],
    ['tras otra sentencia y un comentario', `SELECT 1; /* x */ -- y\n${plano}`],
  ];
  if (esquema !== undefined) {
    resultado.push(
      [`calificado con ${esquema}.`, sql(`${esquema}.${nombre}`)],
      [`calificado con ${esquema}. y entre comillas dobles`, sql(`"${esquema}"."${nombre}"`)],
    );
  }
  return resultado;
}

/** Identificadores con escapes Unicode (`U&"…"`) que escriben alguno de los nombres. */
export const ESCAPES_UNICODE: [string, string][] = [
  ['U&"\\006Co_get"', 'SELECT U&"\\006Co_get"(1)'],
  ['U&"\\0070g_stat_activity"', 'SELECT query FROM U&"\\0070g_stat_activity"'],
  ['U&"\\006Coread"', 'SELECT U&"\\006Coread"(0, 1)'],
];

/** Sentencias que deben funcionar (alias que contienen un nombre dentro de otro identificador). */
export const CONTROLES_ALIAS = [
  'my_lo_get',
  'colo_r',
  'xlo_get',
  'pg_stat_activity_x',
  'loreadx',
  'mi_pg_largeobject',
];
