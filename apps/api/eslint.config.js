// Configuración de ESLint de la API: extiende la base compartida y agrega las dos reglas del
// criterio 37 de la historia 001 (y 37b), que protegen el aislamiento entre empresas:
//
// 1. La conexión de plataforma (`nucleo/base-de-datos/conexion-plataforma`) solo se importa dentro
//    de `src/modulos/plataforma/`. Se detecta el `import` estático, el `import()` dinámico,
//    `require(...)`, `import x = require(...)`, el `import('…')` de tipos y los reexportes
//    (`export … from`). Un `import()` o `require()` con un argumento que no es un texto fijo también
//    falla, porque no se puede saber qué carga.
// 2. El texto del parámetro de contexto de empresa solo lo escribe el servicio de contexto
//    (`src/nucleo/contexto-empresa/contexto-empresa.ts`).
//
// Ambas aplican a todo archivo `.ts`, `.tsx`, `.mts` y `.cts` de `src/`. Las migraciones quedan fuera
// de la segunda porque su SQL tiene que nombrar el parámetro (lo lee `empresa_actual()`); las pruebas
// y los scripts quedan fuera de ambas porque no son código de la API.
const base = require('@restaurante/config/eslint');

const EXTENSIONES = '{ts,tsx,mts,cts}';
const SRC = `src/**/*.${EXTENSIONES}`;
const PLATAFORMA = `src/modulos/plataforma/**/*.${EXTENSIONES}`;
const SERVICIO_DE_CONTEXTO = 'src/nucleo/contexto-empresa/contexto-empresa.ts';
const MIGRACIONES = `src/migraciones/**/*.${EXTENSIONES}`;

// Fragmento de ruta de la conexión de plataforma. Sin `/` (esquery no admite la barra dentro de una
// expresión regular): `\x2f` es la barra.
const RUTA_CONEXION = '(^|\\x2f)conexion-plataforma(\\.[cm]?[jt]sx?)?$';

const MENSAJE_CONEXION =
  'La conexión de plataforma solo puede importarse dentro de src/modulos/plataforma/. ' +
  'La API usa la conexión CONEXION_API con ContextoEmpresa.';
const MENSAJE_DINAMICO =
  'Fuera de src/modulos/plataforma/ no se permite import() ni require() con una ruta que no sea un ' +
  'texto fijo: no se puede comprobar que no cargue la conexión de plataforma.';
const MENSAJE_PARAMETRO =
  'Solo ContextoEmpresa (src/nucleo/contexto-empresa/contexto-empresa.ts) puede escribir el ' +
  'parámetro de contexto de empresa. Usa ContextoEmpresa.ejecutar.';

/** Formas de cargar la conexión de plataforma que `no-restricted-imports` no ve. */
const SELECTORES_CONEXION = [
  {
    selector: `ImportExpression > Literal.source[value=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
  {
    selector: `ImportExpression > TemplateLiteral.source > TemplateElement[value.cooked=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
  {
    selector: 'ImportExpression > .source:not(Literal):not(TemplateLiteral[expressions.length=0])',
    message: MENSAJE_DINAMICO,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal.arguments:first-child[value=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
  {
    selector: `CallExpression[callee.name='require'] > TemplateLiteral.arguments:first-child > TemplateElement[value.cooked=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
  {
    selector:
      "CallExpression[callee.name='require'] > .arguments:first-child:not(Literal):not(TemplateLiteral[expressions.length=0])",
    message: MENSAJE_DINAMICO,
  },
  {
    selector: `TSExternalModuleReference > Literal[value=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
  {
    selector: `TSImportType Literal[value=/${RUTA_CONEXION}/]`,
    message: MENSAJE_CONEXION,
  },
];

/** El texto del parámetro de contexto, entre comillas o en una plantilla. */
const SELECTORES_PARAMETRO = [
  { selector: 'Literal[value=/app\\.empresa_id/i]', message: MENSAJE_PARAMETRO },
  { selector: 'TemplateElement[value.raw=/app\\.empresa_id/i]', message: MENSAJE_PARAMETRO },
];

module.exports = [
  ...base,
  {
    // Regla 1 (importaciones): la conexión de plataforma no se importa fuera de su módulo. Cubre el
    // `import` estático y los reexportes `export … from`.
    files: [SRC],
    ignores: [PLATAFORMA],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)conexion-plataforma(\\.[cm]?[jt]sx?)?$',
              message: MENSAJE_CONEXION,
            },
          ],
        },
      ],
    },
  },
  // `no-restricted-syntax` es una sola regla por archivo: cada bloque de abajo trae el conjunto de
  // selectores que le toca, y los bloques no se solapan.
  {
    // Ambas reglas: casi todo `src/`.
    files: [SRC],
    ignores: [PLATAFORMA, SERVICIO_DE_CONTEXTO, MIGRACIONES],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION, ...SELECTORES_PARAMETRO],
    },
  },
  {
    // Solo la regla 2: el módulo de plataforma sí puede usar la conexión.
    files: [PLATAFORMA],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_PARAMETRO],
    },
  },
  {
    // Solo la regla 1: el servicio de contexto y las migraciones sí nombran el parámetro.
    files: [SERVICIO_DE_CONTEXTO, MIGRACIONES],
    rules: {
      'no-restricted-syntax': ['error', ...SELECTORES_CONEXION],
    },
  },
];
