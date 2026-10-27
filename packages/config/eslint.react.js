// Configuración de ESLint para código de interfaz (React en el navegador): la base compartida más
// las reglas de hooks y de accesibilidad. Es CommonJS, igual que `eslint.config.js`.
const globals = require('globals');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const reactHooks = require('eslint-plugin-react-hooks');
const base = require('./eslint.config.js');

module.exports = [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.tsx'],
  },
  {
    // Pruebas y configuración de herramientas corren en Node.
    files: ['**/*.config.{ts,mts,js,mjs}', '**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
