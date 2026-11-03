import react from '@restaurante/config/eslint-react';

export default [
  ...react,
  { ignores: ['.next/**', 'next-env.d.ts', 'e2e/resultados/**', 'playwright-report/**'] },
];
