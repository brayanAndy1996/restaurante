import { describe, expect, it } from 'vitest';
import {
  contieneControlDeTransaccion,
  contieneSentenciaNoPermitida,
  mencionaContextoDeEmpresa,
  NOMBRES_PROHIBIDOS,
  PREFIJOS_PROHIBIDOS,
} from '../src/nucleo/base-de-datos/control-transaccion';

// Analizador de sentencias de las guardas (criterios 22b, 22d y 32b), comparado con el escáner léxico
// de PostgreSQL 16 (`scan.l`). Pruebas del desarrollador (no protegidas); no usan la base de datos.
// Cada caso lleva `true` si la guarda debe rechazar y `false` si PostgreSQL lo leería como un único
// literal o comentario (nada ejecutable escondido ni rechazo de más).

type Caso = [nombre: string, sql: string, rechaza: boolean];

describe('comentarios `--`: terminan en \\n o \\r (newline [\\n\\r])', () => {
  const casos: Caso[] = [
    ['\\r', 'SELECT 1; --x\rCOMMIT', true],
    ['\\r\\n', 'SELECT 1; --x\r\nCOMMIT', true],
    ['\\n', 'SELECT 1; --x\nCOMMIT', true],
    ['\\r sin sentencia previa', '--x\rCOMMIT', true],
    ['comentario vacío con \\r', 'SELECT 1; --\rCOMMIT', true],
    ['\\r\\r\\n', 'SELECT 1; --x\r\r\nCOMMIT', true],
    ['SET tras \\r', 'SELECT 1; --x\rSET x = 1', true],
    ['sin salto de línea: todo es comentario', 'SELECT 1; --x COMMIT', false],
    ['\\f no termina el comentario', 'SELECT 1; --x\fCOMMIT', false],
    ['\\v no termina el comentario', 'SELECT 1; --x\vCOMMIT', false],
    ['U+2028 no termina el comentario', 'SELECT 1; --x COMMIT', false],
    ['`--` dentro de una cadena no es comentario', "SELECT 'a --x\rCOMMIT'", false],
    ['`--` pegado a un operador', 'SELECT 1 +--x\r;COMMIT', true],
    ['`--` pegado a un operador oculta lo que sigue', 'SELECT 1 +--x;COMMIT\r', false],
  ];
  it.each(casos)('control de transacción · %s', (_n, sql, rechaza) => {
    expect(contieneControlDeTransaccion(sql)).toBe(rechaza);
  });

  it('la lista blanca y la mención de contexto ven lo mismo tras `\\r`', () => {
    expect(contieneSentenciaNoPermitida('SELECT 1; --x\rSET x = 1')).toBe(true);
    expect(contieneSentenciaNoPermitida('SELECT 1; --x\rALTER ROLE r SET a.b = 1')).toBe(true);
    expect(contieneSentenciaNoPermitida('SELECT 1; --x\rSELECT 2')).toBe(false);
    expect(contieneSentenciaNoPermitida('SELECT 1 --x\r')).toBe(false);
    expect(mencionaContextoDeEmpresa("SELECT 1; --x\rSELECT set_config('a.b','c',true)")).toBe(
      true,
    );
    expect(mencionaContextoDeEmpresa('SELECT 1 --set_config\r, 2')).toBe(false);
  });
});

describe('comentarios de bloque anidados', () => {
  const casos: Caso[] = [
    ['anidado oculta el texto', '/* a /* b */ COMMIT */ SELECT 1', false],
    ['tras cerrar todos los niveles', '/* a /* b */ c */ COMMIT', true],
    ['sin cerrar el nivel exterior', '/* a /* b */ COMMIT', true],
    ['`/*/` abre y no cierra', '/*/ COMMIT', true],
    ['`/**/` está cerrado', 'SELECT 1; /**/ COMMIT', true],
    ['`**/` cierra', 'SELECT 1 /* a **/; COMMIT', true],
    ['`--` dentro de un bloque no cuenta', 'SELECT 1 /* -- */; COMMIT', true],
    ['abre pegado a un operador', 'SELECT 1 +/* x */; COMMIT', true],
  ];
  it.each(casos)('%s', (_n, sql, rechaza) => {
    expect(contieneControlDeTransaccion(sql)).toBe(rechaza);
  });
});

describe('cadenas', () => {
  const casos: Caso[] = [
    ["E'' con \\\\ cierra tras la barra", "SELECT E'\\\\'; COMMIT -- '", true],
    ["E'' con \\' sigue abierta", "SELECT E'it\\'s; COMMIT'", false],
    ["e'' en minúscula", "SELECT e'it\\'s; COMMIT'", false],
    [
      "E'' tras un identificador no lleva escapes (lo rechaza por ambigua)",
      "SELECT typeE'a\\'; COMMIT --'",
      true,
    ],
    ["E'' tras una cadena de dólares", "SELECT $a$x$a$E'a\\'; COMMIT'", false],
    ["E'' tras un comentario de bloque", "SELECT 1/**/E'a\\'; COMMIT'", false],
    [
      "cadena normal con \\' se rechaza (depende de standard_conforming_strings)",
      "SELECT 'a\\'; COMMIT --'",
      true,
    ],
    ['cadena normal con \\\\ y comilla final', "SELECT 'a\\\\'", false],
    ['cadena normal con \\ en medio', "SELECT 'a\\b; COMMIT'", false],
    ["comilla doble `''`", "SELECT 'it''s; COMMIT'", false],
    ['sin cerrar', "SELECT 'abc; COMMIT", true],
    ['continuación de cadena', "SELECT 'a'\n'; COMMIT'", false],
    ['continuación con comentario', "SELECT 'a' -- c\n'; COMMIT'", false],
    ["U&'' normal", "SELECT U&'d\\0061t; COMMIT'", false],
    ["U&'' con UESCAPE y COMMIT fuera", "SELECT U&'x!0061' UESCAPE '!'; COMMIT", true],
    ["N'', B'' y X''", "SELECT N'a; COMMIT', B'1', X'1f'", false],
  ];
  it.each(casos)('%s', (_n, sql, rechaza) => {
    expect(contieneControlDeTransaccion(sql)).toBe(rechaza);
  });
});

describe('dólar-comillas e identificadores entre comillas', () => {
  const casos: Caso[] = [
    ['`$$`', 'SELECT $$; COMMIT$$', false],
    ['con etiqueta', 'SELECT $tag$; COMMIT$tag$', false],
    ['etiqueta distinta no cierra', 'SELECT $a$ x $b$; COMMIT $a$', false],
    [
      'la `$` final de otra etiqueta puede cerrar (como en PostgreSQL)',
      'SELECT $a$ $b$a$ ; COMMIT $a$',
      true,
    ],
    ['etiqueta con guion bajo', 'SELECT $_a1$; COMMIT$_a1$', false],
    ['sin cerrar', 'SELECT $a$; COMMIT', true],
    ['`$1` es un parámetro, no un delimitador', 'SELECT $1; COMMIT', true],
    ['`$1$` tampoco', 'SELECT $1$; COMMIT$1$', true],
    ['en medio de un identificador no abre', 'SELECT a$$b; COMMIT', true],
    ['tras un dígito se rechaza de más', 'SELECT 1$$; COMMIT$$', true],
    ['dos cadenas de dólares seguidas', 'SELECT $a$ x $a$$b$ y $b$; COMMIT', true],
    ['identificador con comillas dobles', 'SELECT "x""; COMMIT --"', false],
    ['identificador sin cerrar', 'SELECT "x; COMMIT', true],
    ['punto y coma tras un identificador', 'SELECT "x"; COMMIT', true],
  ];
  it.each(casos)('%s', (_n, sql, rechaza) => {
    expect(contieneControlDeTransaccion(sql)).toBe(rechaza);
  });
});

describe('espacio en blanco: [ \\t\\n\\r\\f\\v] y algo más (leer de más es rechazar de más)', () => {
  it.each(['\t', '\n', '\r', '\f', '\v', ' ', ' ', ' '])('COMMIT tras %j se rechaza', (espacio) => {
    expect(contieneControlDeTransaccion(`SELECT 1;${espacio}COMMIT`)).toBe(true);
    expect(contieneSentenciaNoPermitida(`SELECT 1;${espacio}COMMIT`)).toBe(true);
  });
  it('paréntesis y espacios antes de la primera palabra', () => {
    expect(contieneControlDeTransaccion('SELECT 1; ( \r\n COMMIT')).toBe(true);
    expect(contieneSentenciaNoPermitida('(SELECT 1)')).toBe(false);
  });
});

describe('mención de contexto con límites de identificador', () => {
  it.each([
    "SELECT set_config('a.b', 'c', true)",
    'SELECT "set_config"(1)',
    'SELECT "SET_CONFIG"(1)',
    'SELECT pg_catalog.set_config(1)',
    'SELECT pg_catalog."set_config"(1)',
    'SELECT * FROM pg_settings',
    'UPDATE pg_settings SET setting = 1',
    "SELECT * FROM ts_stat('x')",
    "SELECT ts_rewrite('a', 'b')",
    "SELECT query_to_xml('select 1', true, false, '')",
    "SELECT query_to_xml_and_xmlschema('select 1', true, false, '')",
    "SELECT cursor_to_xml('c', 1, true, false, '')",
    "SELECT cursor_to_xmlschema('c', true, false, '')",
    'SET app . empresa_id = 1',
    'SELECT 1,set_config(1)',
    'SELECT(set_config(1))',
    'SELECT U&"set\\005fconfig"(1)',
  ])('rechaza %s', (sql) => {
    expect(mencionaContextoDeEmpresa(sql)).toBe(true);
  });

  it.each([
    'SELECT reset_config(1)',
    'SELECT my_set_config(1)',
    'SELECT x.reset_config',
    'SELECT set_config2(1)',
    'SELECT set_configé(1)',
    'SELECT * FROM mi_pg_settings',
    'SELECT * FROM ts_stats',
    'SELECT * FROM xts_stat',
    'SELECT webapp.empresa_id FROM t webapp',
    'SELECT "reset_config"(1)',
    "SELECT 'set_config pg_settings query_to_xml ts_stat app.empresa_id'",
    'SELECT 1 /* set_config */',
    'SELECT 1 -- pg_settings\n',
  ])('deja pasar %s', (sql) => {
    expect(mencionaContextoDeEmpresa(sql)).toBe(false);
  });
});

describe('lista de nombres y prefijos del criterio 38e', () => {
  it.each([
    'SELECT fijar_contexto_empresa($1)',
    'SELECT public.fijar_contexto_empresa($1)',
    'SELECT "fijar_contexto_empresa"($1)',
    'SELECT FIJAR_CONTEXTO_EMPRESA($1)',
    'SELECT query FROM pg_stat_activity',
    'SELECT * FROM pg_catalog.pg_stat_get_activity(NULL)',
    'SELECT pg_cancel_backend(1)',
    'SELECT "pg_catalog"."pg_terminate_backend"(1)',
    'SELECT 1 AS pg_signal_backend',
    'SELECT 1 FROM pg_largeobject',
    'SELECT oid FROM pg_largeobject_metadata',
    'SELECT loread(0, 1)',
    'SELECT lowrite(0, 1)',
    'SELECT pg_stat_get_backend_idset()',
    'SELECT pg_stat_get_backend_x',
    'SELECT lo_get(1)',
    'SELECT lo_from_bytea(0, 1)',
    'SELECT 1 AS lo_x',
    "SELECT table_to_xml('t', true, false, '')",
    "SELECT schema_to_xml_and_xmlschema('s', true, false, '')",
    "SELECT database_to_xmlschema(true, false, '')",
    'SELECT U&"\\006Co_get"(1)',
  ])('rechaza %s', (sql) => {
    expect(mencionaContextoDeEmpresa(sql)).toBe(true);
  });

  it.each([
    'SELECT 1 AS my_lo_get',
    'SELECT 1 AS colo_r',
    'SELECT 1 AS xlo_get',
    'SELECT 1 AS pg_stat_activity_x',
    'SELECT 1 AS loreadx',
    'SELECT 1 AS lowritex',
    'SELECT 1 AS mi_pg_largeobject',
    'SELECT 1 AS mi_pg_largeobject_metadata',
    'SELECT 1 AS fijar_contexto_empresa2',
    'SELECT 1 AS mi_fijar_contexto_empresa',
    'SELECT 1 AS xpg_stat_get_backend_pid',
    "UPDATE sucursal SET direccion = 'lo_get pg_stat_activity fijar_contexto_empresa' WHERE id = 1",
    'SELECT 1 /* lo_get */ -- pg_largeobject\n',
    "SELECT $$lo_get$$, E'pg_cancel_backend'",
  ])('deja pasar %s', (sql) => {
    expect(mencionaContextoDeEmpresa(sql)).toBe(false);
  });

  it('exporta la lista como dato, con nombres y prefijos en minúsculas', () => {
    expect(NOMBRES_PROHIBIDOS).toEqual(
      expect.arrayContaining(['set_config', 'pg_stat_activity', 'loread', 'lowrite']),
    );
    expect(PREFIJOS_PROHIBIDOS).toEqual(
      expect.arrayContaining(['lo_', 'pg_stat_get_backend_', 'table_to_xml']),
    );
    for (const nombre of [...NOMBRES_PROHIBIDOS, ...PREFIJOS_PROHIBIDOS]) {
      expect(nombre).toBe(nombre.toLowerCase());
    }
  });
});

describe('el resultado recordado no se mezcla entre textos', () => {
  it('textos distintos seguidos dan cada uno su resultado', () => {
    for (let i = 0; i < 3; i++) {
      expect(contieneControlDeTransaccion('SELECT 1; COMMIT')).toBe(true);
      expect(mencionaContextoDeEmpresa('SELECT 1; COMMIT')).toBe(false);
      expect(contieneSentenciaNoPermitida('SELECT 1; COMMIT')).toBe(true);
      expect(contieneControlDeTransaccion('SELECT 2')).toBe(false);
      expect(contieneSentenciaNoPermitida('SELECT 2')).toBe(false);
      expect(contieneControlDeTransaccion("SELECT 'sin cerrar")).toBe(true);
      expect(mencionaContextoDeEmpresa('SELECT 2')).toBe(false);
    }
  });
});
