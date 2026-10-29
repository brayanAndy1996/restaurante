import { urlDeRol } from './bd';

/** `PIN_PEPPER` de las pruebas (base64 de 32 bytes). */
export const PIN_PEPPER_DE_PRUEBA = Buffer.from('pin-pepper-solo-para-pruebas-123').toString(
  'base64',
);

/** `ORIGENES_PERMITIDOS` de las pruebas. */
export const ORIGENES_PERMITIDOS_DE_PRUEBA = 'http://localhost:5173';

export interface OpcionesEntornoDePrueba {
  /** Tamaño del pool de la API; por defecto 2. */
  poolMax?: number;
  /** Por defecto `test`. */
  nodeEnv?: 'development' | 'test' | 'production';
  /** Activa el resolutor por cabecera `x-empresa-id`; por defecto `true`. */
  empresaPorHeader?: boolean;
  /** Variables adicionales; un valor `undefined` borra la variable. */
  extra?: Record<string, string | undefined>;
}

/**
 * Fija en `process.env` las variables de la app de prueba (DATABASE_URL como `restaurante_api`,
 * DATABASE_PLATAFORMA_URL como `restaurante_plataforma`, DATABASE_TIEMPO_REAL_URL como `restaurante_tiempo_real`, NODE_ENV, EMPRESA_POR_HEADER, DB_POOL_MAX,
 * PIN_PEPPER, ORIGENES_PERMITIDOS y ARCHIVOS_DRIVER) y devuelve lo aplicado. Llámala antes de `crearAplicacion()`; se puede llamar varias veces en
 * el mismo proceso para crear apps con configuraciones distintas.
 */
export function fijarEntornoDePrueba(
  opciones: OpcionesEntornoDePrueba = {},
): Record<string, string | undefined> {
  const nodeEnv = opciones.nodeEnv ?? 'test';
  const aplicado: Record<string, string | undefined> = {
    DATABASE_URL: urlDeRol('api'),
    DATABASE_PLATAFORMA_URL: urlDeRol('plataforma'),
    DATABASE_TIEMPO_REAL_URL: urlDeRol('tiempoReal'),
    NODE_ENV: nodeEnv,
    EMPRESA_POR_HEADER: opciones.empresaPorHeader === false ? undefined : 'habilitado',
    DB_POOL_MAX: String(opciones.poolMax ?? 2),
    PIN_PEPPER: PIN_PEPPER_DE_PRUEBA,
    ORIGENES_PERMITIDOS: ORIGENES_PERMITIDOS_DE_PRUEBA,
    // Las pruebas guardan los archivos en memoria (`AlmacenEnMemoria`), nunca en disco ni en R2. Solo con
    // `NODE_ENV=production`, que exige `r2` para arrancar, se dan credenciales falsas: ninguna prueba las
    // usa (el `AlmacenR2` no sale a la red hasta que se guarda o se borra un archivo).
    ARCHIVOS_DRIVER: nodeEnv === 'production' ? 'r2' : 'memoria',
    ARCHIVOS_URL_PUBLICA: nodeEnv === 'production' ? 'https://archivos.prueba.invalid' : undefined,
    R2_ACCOUNT_ID: nodeEnv === 'production' ? 'cuenta-de-prueba' : undefined,
    R2_ACCESS_KEY_ID: nodeEnv === 'production' ? 'clave-de-prueba' : undefined,
    R2_SECRET_ACCESS_KEY: nodeEnv === 'production' ? 'secreto-de-prueba' : undefined,
    R2_BUCKET: nodeEnv === 'production' ? 'bucket-de-prueba' : undefined,
    ...opciones.extra,
  };
  for (const [clave, valor] of Object.entries(aplicado)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  return aplicado;
}
