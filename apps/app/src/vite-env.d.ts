/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base de la API, sin barra final. Por defecto, la API local. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
