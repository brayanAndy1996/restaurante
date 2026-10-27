// Configuración de ESLint de la API: extiende la base compartida y agrega las reglas de los criterios
// 37, 37b y 22c de la historia 001, que protegen el aislamiento entre empresas:
//
// 1. La conexión de plataforma (`nucleo/base-de-datos/conexion-plataforma`) solo se importa dentro
//    de `src/modulos/plataforma/`. Se detecta el `import` estático, el `import()` dinámico,
//    `require(...)`, `import x = require(...)`, el `import('…')` de tipos y los reexportes
//    (`export … from`). Un `import()` o `require()` con un argumento que no es un texto fijo también
//    falla, porque no se puede saber qué carga.
// 2. El texto del parámetro de contexto de empresa solo lo escribe el servicio de contexto
//    (`src/nucleo/contexto-empresa/contexto-empresa.ts`), también si se arma por concatenación de
//    literales o con una plantilla de literales (criterio 22c: el parser de `herramientas/` calcula
//    esos textos antes de aplicar la regla).
// 3. El texto SQL con el que `ContextoEmpresa` fija la empresa (`SQL_FIJAR_CONTEXTO`) y el registro
//    de transacciones por autorizar (`nucleo/base-de-datos/autorizacion-transaccion`) solo se usan
//    dentro de `src/nucleo/` (criterio 22c), con las mismas formas de importación de la regla 1.
//
// Todas aplican a todo archivo `.ts`, `.tsx`, `.mts` y `.cts` de `src/`. Las migraciones quedan fuera
// de la regla 2 porque su SQL tiene que nombrar el parámetro (lo lee `empresa_actual()`); las pruebas
// y los scripts quedan fuera de todas porque no son código de la API.
const base = require('@restaurante/config/eslint');
const parserTextosCalculados = require('./herramientas/parser-textos-calculados');

const EXTENSIONES = '{ts,tsx,mts,cts}';
const SRC = `src/**/*.${EXTENSIONES}`;
const PLATAFORMA = `src/modulos/plataforma/**/*.${EXTENSIONES}`;
const NUCLEO = `src/nucleo/**/*.${EXTENSIONES}`;
const SERVICIO_DE_CONTEXTO = 'src/nucleo/contexto-empresa/contexto-empresa.ts';
const MIGRACIONES = `src/migraciones/**/*.${EXTENSIONES}`;

// Fragmentos de ruta. Sin `/` en los selectores (esquery no admite la barra dentro de una expresión
// regular): `\x2f` es la barra. Las mismas rutas para `no-restricted-imports` van como `regex` normal.
const RUTA_CONEXION = '(^|\\x2f)conexion-plataforma(\\.[cm]?[jt]sx?)?$';
const RUTA_SQL_CONTEXTO = '(^|\\x2f)contexto-empresa\\x2fcontexto-empresa(\\.[cm]?[jt]sx?)?$';
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
  'parámetro de contexto de empresa. Usa ContextoEmpresa.ejecutar.';

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
  ...selectoresDeRuta(RUTA_SQL_CONTEXTO, MENSAJE_SQL_CONTEXTO),
  ...selectoresDeRuta(RUTA_AUTORIZACION, MENSAJE_AUTORIZACION),
];

/** El texto del parámetro de contexto, entre comillas o en una plantilla (ya calculado por el parser). */
const SELECTORES_PARAMETRO = [
  { selector: 'Literal[value=/app\\.empresa_id/i]', message: MENSAJE_PARAMETRO },
  { selector: 'TemplateElement[value.raw=/app\\.empresa_id/i]', message: MENSAJE_PARAMETRO },
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
        PATRON_AUTORIZACION,
      ),
    },
  },
  {
    // El módulo de plataforma sí puede usar la conexión de plataforma.
    files: [PLATAFORMA],
    rules: { 'no-restricted-imports': importaciones(PATRON_SQL_CONTEXTO, PATRON_AUTORIZACION) },
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
      ],
    },
  },
  {
    // Las migraciones sí nombran el parámetro (su SQL lo necesita).
    files: [MIGRACIONES],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_SQL_CONTEXTO],
    },
  },
  {
    // El módulo de plataforma sí puede usar la conexión de plataforma.
    files: [PLATAFORMA],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_SQL_CONTEXTO, ...SELECTORES_PARAMETRO],
    },
  },
  {
    // `src/nucleo/`, salvo el servicio de contexto: sí usa el SQL de fijación, pero no escribe el parámetro.
    files: [NUCLEO],
    ignores: [SERVICIO_DE_CONTEXTO],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_PARAMETRO],
    },
  },
  {
    // El servicio de contexto sí nombra el parámetro.
    files: [SERVICIO_DE_CONTEXTO],
    rules: { 'no-restricted-syntax': ['error', ...SELECTORES_CONEXION] },
  },
];
