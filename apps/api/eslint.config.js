// Configuración de ESLint de la API: extiende la base compartida y agrega las reglas de los criterios
// 37, 37b y 22c de la historia 001, que protegen el aislamiento entre empresas:
//
// 1. La conexión de plataforma (`nucleo/base-de-datos/conexion-plataforma`) solo se importa dentro
//    de `src/modulos/plataforma/`. Se detecta el `import` estático, el `import()` dinámico,
//    `require(...)`, `import x = require(...)`, el `import('…')` de tipos y los reexportes
//    (`export … from`). Un `import()` o `require()` con un argumento que no es un texto fijo también
//    falla, porque no se puede saber qué carga.
// 2. El texto del parámetro de contexto de empresa (`app.empresa_id`) y el de la función que lo fija
//    (`fijar_contexto_empresa`, criterio 22e) solo los escribe el servicio de contexto
//    (`src/nucleo/contexto-empresa/contexto-empresa.ts`) y `src/nucleo/fijar-contexto.ts` (que define
//    el nombre de la función y `SQL_FIJAR_CONTEXTO`, sin dependencias de Nest), también si se arma por concatenación de
//    literales o con una plantilla de literales (criterio 22c: el parser de `herramientas/` calcula
//    esos textos antes de aplicar la regla).
// 3. El texto SQL con el que `ContextoEmpresa` fija la empresa (`SQL_FIJAR_CONTEXTO`, definido en
//    `nucleo/fijar-contexto`, y su antigua ruta `contexto-empresa/contexto-empresa`) y el registro
//    de transacciones por autorizar (`nucleo/base-de-datos/autorizacion-transaccion`) solo se usan
//    dentro de `src/nucleo/` (criterio 22c), con las mismas formas de importación de la regla 1.
//
// 4. (Historia 002) Los nombres de la función que fija el actor de la transacción (`fijar_contexto_actor`) y
//    de la que busca la empresa de un usuario al ingresar (`empresa_de_usuario`) reciben el mismo trato que
//    `fijar_contexto_empresa`: solo los escribe `src/nucleo/fijar-contexto.ts` (que define `SQL_FIJAR_ACTOR`),
//    `src/nucleo/base-de-datos/consultas-sin-empresa.ts` (la consulta fija de ingreso) y las migraciones;
//    y la constante `SQL_FIJAR_ACTOR` solo se usa dentro de `src/nucleo/`.
//
// Todas aplican a todo archivo `.ts`, `.tsx`, `.mts` y `.cts` de `src/`. Las migraciones quedan fuera
// de la regla 2 porque su SQL tiene que nombrar el parámetro y la función; las pruebas
// y los scripts quedan fuera de todas porque no son código de la API.
const base = require('@restaurante/config/eslint');
const parserTextosCalculados = require('./herramientas/parser-textos-calculados');

const EXTENSIONES = '{ts,tsx,mts,cts}';
const SRC = `src/**/*.${EXTENSIONES}`;
const PLATAFORMA = `src/modulos/plataforma/**/*.${EXTENSIONES}`;
const NUCLEO = `src/nucleo/**/*.${EXTENSIONES}`;
const SERVICIO_DE_CONTEXTO = 'src/nucleo/contexto-empresa/contexto-empresa.ts';
const TEXTO_DE_FIJACION = 'src/nucleo/fijar-contexto.ts';
const CONSULTAS_SIN_EMPRESA = 'src/nucleo/base-de-datos/consultas-sin-empresa.ts';
const MIGRACIONES = `src/migraciones/**/*.${EXTENSIONES}`;

// Fragmentos de ruta. Sin `/` en los selectores (esquery no admite la barra dentro de una expresión
// regular): `\x2f` es la barra. Las mismas rutas para `no-restricted-imports` van como `regex` normal.
const RUTA_CONEXION = '(^|\\x2f)conexion-plataforma(\\.[cm]?[jt]sx?)?$';
const RUTA_SQL_CONTEXTO =
  '(^|\\x2f)(contexto-empresa\\x2fcontexto-empresa|fijar-contexto)(\\.[cm]?[jt]sx?)?$';
const RUTA_AUTORIZACION = '(^|\\x2f)autorizacion-transaccion(\\.[cm]?[jt]sx?)?$';

const MENSAJE_CONEXION =
  'La conexión de plataforma solo puede importarse dentro de src/modulos/plataforma/. ' +
  'La API usa la conexión CONEXION_API con ContextoEmpresa.';
const MENSAJE_SQL_CONTEXTO =
  'El texto SQL que fija la empresa (SQL_FIJAR_CONTEXTO) solo se usa dentro de src/nucleo/: ' +
  'usa ContextoEmpresa.ejecutar.';
const MENSAJE_AUTORIZACION =
  'El registro de transacciones por autorizar solo se usa dentro de src/nucleo/: ' +
  'solo ContextoEmpresa.ejecutar autoriza una transacción de la API.';
const MENSAJE_DINAMICO =
  'Fuera de src/modulos/plataforma/ no se permite import() ni require() con una ruta que no sea un ' +
  'texto fijo: no se puede comprobar que no cargue la conexión de plataforma.';
const MENSAJE_PARAMETRO =
  'Solo ContextoEmpresa (src/nucleo/contexto-empresa/contexto-empresa.ts) puede escribir el ' +
  'parámetro de contexto de empresa ni la función que lo fija. Usa ContextoEmpresa.ejecutar.';
const MENSAJE_FUNCIONES_DE_ACCESO =
  'Solo src/nucleo/fijar-contexto.ts (SQL_FIJAR_ACTOR) y la consulta fija de ' +
  'src/nucleo/base-de-datos/consultas-sin-empresa.ts pueden escribir el nombre de la función que fija el ' +
  'actor (fijar_contexto_actor) ni el de la que busca la empresa de un usuario (empresa_de_usuario). ' +
  'Usa ContextoEmpresa.ejecutar con { actor } o ContextoEmpresa.fijarActor.';

/** Formas de cargar un módulo concreto que `no-restricted-imports` no ve. */
function selectoresDeRuta(ruta, message) {
  return [
    { selector: `ImportExpression > Literal.source[value=/${ruta}/]`, message },
    {
      selector: `ImportExpression > TemplateLiteral.source > TemplateElement[value.cooked=/${ruta}/]`,
      message,
    },
    {
      selector: `CallExpression[callee.name='require'] > Literal.arguments:first-child[value=/${ruta}/]`,
      message,
    },
    {
      selector: `CallExpression[callee.name='require'] > TemplateLiteral.arguments:first-child > TemplateElement[value.cooked=/${ruta}/]`,
      message,
    },
    { selector: `TSExternalModuleReference > Literal[value=/${ruta}/]`, message },
    { selector: `TSImportType Literal[value=/${ruta}/]`, message },
  ];
}

/** `import()` y `require()` con una ruta que no es un texto fijo (no se sabe qué cargan). */
const SELECTORES_DINAMICOS = [
  {
    selector: 'ImportExpression > .source:not(Literal):not(TemplateLiteral[expressions.length=0])',
    message: MENSAJE_DINAMICO,
  },
  {
    selector:
      "CallExpression[callee.name='require'] > .arguments:first-child:not(Literal):not(TemplateLiteral[expressions.length=0])",
    message: MENSAJE_DINAMICO,
  },
];

const SELECTORES_CONEXION = [
  ...selectoresDeRuta(RUTA_CONEXION, MENSAJE_CONEXION),
  ...SELECTORES_DINAMICOS,
];

/**
 * El texto SQL de fijación: su nombre (importado, reexportado, desestructurado o como propiedad de un
 * espacio de nombres) y la carga dinámica del archivo que lo define. Las importaciones estáticas las
 * cubre `no-restricted-imports`.
 */
const SELECTORES_SQL_CONTEXTO = [
  { selector: "Identifier[name='SQL_FIJAR_CONTEXTO']", message: MENSAJE_SQL_CONTEXTO },
  { selector: "Literal[value='SQL_FIJAR_CONTEXTO']", message: MENSAJE_SQL_CONTEXTO },
  { selector: "Identifier[name='SQL_FIJAR_ACTOR']", message: MENSAJE_SQL_CONTEXTO },
  { selector: "Literal[value='SQL_FIJAR_ACTOR']", message: MENSAJE_SQL_CONTEXTO },
  ...selectoresDeRuta(RUTA_SQL_CONTEXTO, MENSAJE_SQL_CONTEXTO),
  ...selectoresDeRuta(RUTA_AUTORIZACION, MENSAJE_AUTORIZACION),
];

/**
 * El texto del parámetro de contexto (`app.empresa_id`) y el de la función que lo fija
 * (`fijar_contexto_empresa`, criterio 22e), entre comillas o en una plantilla (ya calculado por el
 * parser). Sin distinguir mayúsculas.
 */
const SELECTORES_PARAMETRO = [
  {
    selector: 'Literal[value=/app\\.empresa_id|fijar_contexto_empresa/i]',
    message: MENSAJE_PARAMETRO,
  },
  {
    selector: 'TemplateElement[value.raw=/app\\.empresa_id|fijar_contexto_empresa/i]',
    message: MENSAJE_PARAMETRO,
  },
];

/**
 * Los nombres de la función que fija el actor y de la que busca la empresa de un usuario (historia 002),
 * entre comillas o en una plantilla (ya calculado por el parser), sin distinguir mayúsculas y sin
 * confundirlos con otro identificador que los contenga (`fijar_contexto_actores`).
 */
const SELECTORES_FUNCIONES_DE_ACCESO = [
  {
    selector:
      'Literal[value=/fijar_contexto_actor(?![A-Za-z0-9_$])|empresa_de_usuario(?![A-Za-z0-9_$])/i]',
    message: MENSAJE_FUNCIONES_DE_ACCESO,
  },
  {
    selector:
      'TemplateElement[value.raw=/fijar_contexto_actor(?![A-Za-z0-9_$])|empresa_de_usuario(?![A-Za-z0-9_$])/i]',
    message: MENSAJE_FUNCIONES_DE_ACCESO,
  },
];

const PATRON_CONEXION = {
  regex: '(^|/)conexion-plataforma(\\.[cm]?[jt]sx?)?$',
  message: MENSAJE_CONEXION,
};
// Con `importNames`, solo se prohíbe el nombre `SQL_FIJAR_CONTEXTO` (y `import *` / `export *`); el
// resto de lo que exportan el archivo y el barril de la carpeta (`ContextoEmpresa`…) se importa normal.
const PATRON_SQL_CONTEXTO = {
  regex: '(^|/)contexto-empresa(/(index|contexto-empresa))?(\\.[cm]?[jt]sx?)?$',
  importNames: ['SQL_FIJAR_CONTEXTO'],
  message: MENSAJE_SQL_CONTEXTO,
};
// El archivo que define el texto de fijación: nada de fuera de `src/nucleo/` lo importa.
const PATRON_TEXTO_DE_FIJACION = {
  regex: '(^|/)fijar-contexto(\\.[cm]?[jt]sx?)?$',
  message: MENSAJE_SQL_CONTEXTO,
};
const PATRON_AUTORIZACION = {
  regex: '(^|/)autorizacion-transaccion(\\.[cm]?[jt]sx?)?$',
  message: MENSAJE_AUTORIZACION,
};

const importaciones = (...patterns) => ['error', { patterns }];

module.exports = [
  ...base,
  {
    // Todo `src/`: el parser que calcula los textos formados solo por literales.
    files: [SRC],
    languageOptions: { parser: parserTextosCalculados },
  },
  // Importaciones estáticas y reexportes (`no-restricted-imports`).
  {
    files: [SRC],
    ignores: [PLATAFORMA, NUCLEO],
    rules: {
      'no-restricted-imports': importaciones(
        PATRON_CONEXION,
        PATRON_SQL_CONTEXTO,
        PATRON_TEXTO_DE_FIJACION,
        PATRON_AUTORIZACION,
      ),
    },
  },
  {
    // El módulo de plataforma sí puede usar la conexión de plataforma.
    files: [PLATAFORMA],
    rules: {
      'no-restricted-imports': importaciones(
        PATRON_SQL_CONTEXTO,
        PATRON_TEXTO_DE_FIJACION,
        PATRON_AUTORIZACION,
      ),
    },
  },
  {
    // `src/nucleo/` sí usa el texto SQL de fijación y el registro de autorización.
    files: [NUCLEO],
    rules: { 'no-restricted-imports': importaciones(PATRON_CONEXION) },
  },
  // `no-restricted-syntax` es una sola regla por archivo: cada bloque de abajo trae el conjunto de
  // selectores que le toca, y los bloques no se solapan.
  {
    // Casi todo `src/`: todas las reglas.
    files: [SRC],
    ignores: [PLATAFORMA, NUCLEO, MIGRACIONES],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SELECTORES_CONEXION,
        ...SELECTORES_SQL_CONTEXTO,
        ...SELECTORES_PARAMETRO,
        ...SELECTORES_FUNCIONES_DE_ACCESO,
      ],
    },
  },
  {
    // Las migraciones sí nombran el parámetro y la función (su SQL lo necesita).
    files: [MIGRACIONES],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_SQL_CONTEXTO],
    },
  },
  {
    // El módulo de plataforma sí puede usar la conexión de plataforma.
    files: [PLATAFORMA],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SELECTORES_SQL_CONTEXTO,
        ...SELECTORES_PARAMETRO,
        ...SELECTORES_FUNCIONES_DE_ACCESO,
      ],
    },
  },
  {
    // `src/nucleo/`, salvo el servicio de contexto, el archivo del texto de fijación y las consultas sin
    // empresa: sí usa el SQL de fijación, pero no escribe el parámetro ni los nombres de las funciones.
    files: [NUCLEO],
    ignores: [SERVICIO_DE_CONTEXTO, TEXTO_DE_FIJACION, CONSULTAS_SIN_EMPRESA],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SELECTORES_CONEXION,
        ...SELECTORES_PARAMETRO,
        ...SELECTORES_FUNCIONES_DE_ACCESO,
      ],
    },
  },
  {
    // El servicio de contexto nombra el parámetro y la función de la empresa; el actor lo fija con
    // `SQL_FIJAR_ACTOR`, sin escribir el nombre de su función.
    files: [SERVICIO_DE_CONTEXTO],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_FUNCIONES_DE_ACCESO],
    },
  },
  {
    // El archivo del texto de fijación nombra el parámetro y las funciones.
    files: [TEXTO_DE_FIJACION],
    rules: { 'no-restricted-syntax': ['error', ...SELECTORES_CONEXION] },
  },
  {
    // Las consultas sin empresa nombran `empresa_de_usuario` (la consulta fija de ingreso).
    files: [CONSULTAS_SIN_EMPRESA],
    rules: { 'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_PARAMETRO] },
  },
];
