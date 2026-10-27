// Configuración de ESLint de la API: extiende la base compartida y agrega las dos reglas del
// criterio 37 de la historia 001, que protegen el aislamiento entre empresas:
//
// 1. La conexión de plataforma (`nucleo/base-de-datos/conexion-plataforma`) solo se importa dentro
//    de `src/modulos/plataforma/`.
// 2. El texto del parámetro de contexto de empresa solo lo escribe el servicio de contexto
//    (`src/nucleo/contexto-empresa/contexto-empresa.ts`).
//
// Las reglas se aplican al código de `src/`. Las migraciones quedan fuera de la segunda porque su SQL
// tiene que nombrar el parámetro (lo lee `empresa_actual()`); las pruebas y los scripts quedan fuera
// de ambas porque no son código de la API.
const base = require('@restaurante/config/eslint');

const MENSAJE_PARAMETRO =
  'Solo ContextoEmpresa (src/nucleo/contexto-empresa/contexto-empresa.ts) puede escribir el ' +
  'parámetro de contexto de empresa. Usa ContextoEmpresa.ejecutar.';

module.exports = [
  ...base,
  {
    // Regla 1: la conexión de plataforma no se importa fuera de su módulo.
    files: ['src/**/*.ts'],
    ignores: ['src/modulos/plataforma/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)conexion-plataforma(\\.[jt]s)?$',
              message:
                'La conexión de plataforma solo puede importarse dentro de src/modulos/plataforma/. ' +
                'La API usa la conexión CONEXION_API con ContextoEmpresa.',
            },
          ],
        },
      ],
    },
  },
  {
    // Regla 2: el parámetro de contexto solo se escribe en el servicio de contexto.
    files: ['src/**/*.ts'],
    ignores: ['src/nucleo/contexto-empresa/contexto-empresa.ts', 'src/migraciones/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/app\\.empresa_id/i]',
          message: MENSAJE_PARAMETRO,
        },
        {
          selector: 'TemplateElement[value.raw=/app\\.empresa_id/i]',
          message: MENSAJE_PARAMETRO,
        },
      ],
    },
  },
];
