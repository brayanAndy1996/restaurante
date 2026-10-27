/** URL base de la API, sin barra final. En desarrollo, la API local. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
