import { urlDeRol } from './bd';

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
 * DATABASE_PLATAFORMA_URL como `restaurante_plataforma`, NODE_ENV, EMPRESA_POR_HEADER, DB_POOL_MAX)
 * y devuelve lo aplicado. Llámala antes de `crearAplicacion()`; se puede llamar varias veces en
 * el mismo proceso para crear apps con configuraciones distintas.
 */
export function fijarEntornoDePrueba(
  opciones: OpcionesEntornoDePrueba = {},
): Record<string, string | undefined> {
  const aplicado: Record<string, string | undefined> = {
    DATABASE_URL: urlDeRol('api'),
    DATABASE_PLATAFORMA_URL: urlDeRol('plataforma'),
    NODE_ENV: opciones.nodeEnv ?? 'test',
    EMPRESA_POR_HEADER: opciones.empresaPorHeader === false ? undefined : 'habilitado',
    DB_POOL_MAX: String(opciones.poolMax ?? 2),
    ...opciones.extra,
  };
  for (const [clave, valor] of Object.entries(aplicado)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  return aplicado;
}
