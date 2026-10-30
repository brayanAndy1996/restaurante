import { z } from 'zod';

/** Token de Nest con el entorno ya validado. */
export const ENTORNO = Symbol('ENTORNO');

const urlPostgres = z.string().regex(/^postgres(ql)?:\/\//, 'Debe ser una URL postgres://…');

/** Valores válidos de `NODE_ENV` (criterio 29b). */
export const VALORES_NODE_ENV = ['development', 'test', 'production'] as const;

/** Valor de `PIN_PEPPER` con `NODE_ENV` `development` o `test` si no se define (32 bytes en base64). */
export const PIN_PEPPER_LOCAL = Buffer.from('pin-pepper-solo-para-desarrollo!').toString('base64');

/** Valor de `ORIGENES_PERMITIDOS` con `NODE_ENV` `development` o `test` si no se define (la PWA con Vite). */
export const ORIGENES_PERMITIDOS_LOCAL = 'http://localhost:5173';

const MINIMO_BYTES_PIN_PEPPER = 32;

/** Valores de `ARCHIVOS_DRIVER`: dónde se guardan las fotos de la carta. */
export const DRIVERS_DE_ARCHIVOS = ['memoria', 'disco', 'r2'] as const;
export type DriverDeArchivos = (typeof DRIVERS_DE_ARCHIVOS)[number];

/** Valores de `TIEMPO_REAL`. */
export const ESTADOS_TIEMPO_REAL = ['habilitado', 'deshabilitado'] as const;
export type EstadoTiempoReal = (typeof ESTADOS_TIEMPO_REAL)[number];

const entornoSchema = z.object({
  // Sin valor por defecto: un despliegue que olvide `NODE_ENV=production` no debe arrancar con
  // el resolutor por cabecera ni con contraseñas conocidas (criterio 29b).
  NODE_ENV: z.enum(VALORES_NODE_ENV, {
    error: `NODE_ENV es obligatoria y debe ser uno de: ${VALORES_NODE_ENV.join(', ')}`,
  }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: urlPostgres,
  DATABASE_PLATAFORMA_URL: urlPostgres,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  EMPRESA_POR_HEADER: z.enum(['habilitado', 'deshabilitado']).optional(),
  PIN_PEPPER: z.string().optional(),
  ORIGENES_PERMITIDOS: z.string().optional(),
  // Almacén de archivos (fotos de la carta, historia 003): `ARCHIVOS_DRIVER` elige el almacén (ver
  // `cargarEntorno` y `exigirEntornoDeProduccion` para las reglas por entorno).
  ARCHIVOS_DRIVER: z.enum(DRIVERS_DE_ARCHIVOS).optional(),
  ARCHIVOS_DIRECTORIO: z.string().optional(),
  ARCHIVOS_URL_PUBLICA: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Tiempo real (historia 004): `TIEMPO_REAL` enciende o apaga el servidor de Socket.IO; el adaptador de
  // PostgreSQL usa su propio rol (`restaurante_tiempo_real`) y su propia conexión.
  TIEMPO_REAL: z.enum(ESTADOS_TIEMPO_REAL).optional(),
  DATABASE_TIEMPO_REAL_URL: urlPostgres.optional(),
  // URL pública de la API que va en el QR de vinculación del puente de impresión (historia 004, 3b, criterio 106).
  API_URL_PUBLICA: z.string().optional(),
});

type EntornoLeido = z.infer<typeof entornoSchema>;

export interface Entorno extends Omit<
  EntornoLeido,
  'PIN_PEPPER' | 'ORIGENES_PERMITIDOS' | 'ARCHIVOS_DRIVER' | 'TIEMPO_REAL'
> {
  /**
   * Secreto con el que se calcula la huella de los PIN (base64, 32 bytes o más). Con `NODE_ENV`
   * `development` o `test` tiene un valor por defecto; en producción es obligatoria
   * (`exigirEntornoDeProduccion`, que `crearAplicacion` llama al arrancar), así que puede faltar
   * (`undefined`) solo al leer el entorno, no en una API que arrancó. Cambiarla invalida todos los PIN.
   */
  PIN_PEPPER: string | undefined;
  /** Orígenes de la PWA permitidos por CORS (`ORIGENES_PERMITIDOS`, separados por coma). */
  ORIGENES_PERMITIDOS: string[];
  /**
   * Almacén de archivos: `memoria` con `NODE_ENV=test` y `disco` con `development` si no se define; en
   * producción puede faltar (`undefined`) al leer el entorno, pero la API no arranca sin `r2`
   * (`exigirEntornoDeProduccion`). `disco` solo vale en desarrollo.
   */
  ARCHIVOS_DRIVER: DriverDeArchivos | undefined;
  /** Carpeta del almacén en disco; por defecto `./archivos` (solo con `disco`). */
  ARCHIVOS_DIRECTORIO: string;
  /**
   * URL base pública de los archivos, sin barra final. Con `disco` y sin definir, la de la propia API
   * (`http://localhost:<PORT>/archivos`); con `r2` es obligatoria (el dominio público del bucket).
   */
  ARCHIVOS_URL_PUBLICA: string | undefined;
  /**
   * Si la API sirve Socket.IO: `habilitado` salvo con `NODE_ENV=test` (las pruebas de tiempo real lo
   * habilitan con `crearAplicacion({ tiempoReal: { habilitado: true } })`). Con `habilitado`, el adaptador de
   * PostgreSQL necesita `DATABASE_TIEMPO_REAL_URL`.
   */
  TIEMPO_REAL: EstadoTiempoReal;
  /** Conexión del adaptador de Socket.IO con el rol `restaurante_tiempo_real` (2 conexiones); puede faltar. */
  DATABASE_TIEMPO_REAL_URL?: string | undefined;
  /**
   * URL base pública de la API, sin barra final: la que el puente de impresión usa para hablar con ella y la que va
   * en el texto del QR de vinculación (`restaurante-puente://vincular?api=<URL>&t=<código>`, criterio 106). Con
   * `NODE_ENV` `development` o `test` y sin definir, `http://localhost:<PORT>`; en producción puede faltar
   * (`undefined`) y entonces crear un código de vinculación responde un error interno con el motivo en el log.
   */
  API_URL_PUBLICA: string | undefined;
}

/** Carpeta del almacén en disco si no se define `ARCHIVOS_DIRECTORIO`. */
export const ARCHIVOS_DIRECTORIO_LOCAL = './archivos';

/** Base64 o base64url, con o sin relleno. */
const FORMATO_BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

function validarPinPepper(valor: string, problemas: string[]): void {
  const bytes = FORMATO_BASE64.test(valor) ? Buffer.from(valor, 'base64').length : 0;
  if (bytes < MINIMO_BYTES_PIN_PEPPER) {
    problemas.push(
      `PIN_PEPPER: debe estar en base64 y tener al menos ${MINIMO_BYTES_PIN_PEPPER} bytes al decodificarse`,
    );
  }
}

function leerOrigenes(valor: string, problemas: string[]): string[] {
  const origenes = valor
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen !== '');
  for (const origen of origenes) {
    let valido = false;
    try {
      const url = new URL(origen);
      valido = (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origen;
    } catch {
      valido = false;
    }
    if (!valido) {
      problemas.push(
        `ORIGENES_PERMITIDOS: "${origen}" no es un origen válido (por ejemplo https://app.ejemplo.pe, sin ruta ni barra final)`,
      );
    }
  }
  return origenes;
}

export class EntornoInvalidoError extends Error {
  constructor(readonly problemas: string[]) {
    super(`Configuración de entorno inválida:\n${problemas.map((p) => ` - ${p}`).join('\n')}`);
    this.name = 'EntornoInvalidoError';
  }
}

/**
 * Valida las variables de entorno. Se llama al crear la aplicación (no al importar módulos), así
 * que cada llamada ve el `process.env` de ese momento. Lanza `EntornoInvalidoError` con todos los
 * problemas, incluida la prohibición de `EMPRESA_POR_HEADER=habilitado` en producción.
 */
export function cargarEntorno(env: NodeJS.ProcessEnv = process.env): Entorno {
  // Una variable vacía (`VAR=`) es lo mismo que una ausente.
  const limpio = Object.fromEntries(Object.entries(env).filter(([, valor]) => valor !== ''));
  const resultado = entornoSchema.safeParse(limpio);

  const problemas: string[] = [];
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      problemas.push(`${issue.path.join('.') || 'entorno'}: ${issue.message}`);
    }
  }
  // Se comprueba aparte de zod para que el motivo salga siempre, aunque falte otra variable. Desde la
  // historia 002 (criterio 7) la cabecera solo vale con NODE_ENV=test: es el punto de enganche de las
  // pruebas, y con cualquier otro entorno permitiría suplantar a cualquier empresa.
  if (limpio.EMPRESA_POR_HEADER === 'habilitado' && limpio.NODE_ENV === 'production') {
    problemas.push(
      'EMPRESA_POR_HEADER=habilitado está prohibido en producción (NODE_ENV=production): ' +
        'la cabecera x-empresa-id permitiría suplantar a cualquier empresa; solo vale con NODE_ENV=test',
    );
  } else if (limpio.EMPRESA_POR_HEADER === 'habilitado' && limpio.NODE_ENV !== 'test') {
    problemas.push(
      `EMPRESA_POR_HEADER=habilitado solo vale con NODE_ENV=test (NODE_ENV=${limpio.NODE_ENV ?? ''}): ` +
        'la empresa de cada petición sale de la sesión; quita EMPRESA_POR_HEADER',
    );
  }
  // Con development o test las dos variables nuevas tienen valor por defecto; en producción las exige
  // `exigirEntornoDeProduccion` al crear la aplicación (esta función solo lee y valida el formato).
  const conDefectos = limpio.NODE_ENV === 'development' || limpio.NODE_ENV === 'test';
  const pinPepper = limpio.PIN_PEPPER ?? (conDefectos ? PIN_PEPPER_LOCAL : undefined);
  if (typeof limpio.PIN_PEPPER === 'string') validarPinPepper(limpio.PIN_PEPPER, problemas);
  const origenesTexto =
    limpio.ORIGENES_PERMITIDOS ?? (conDefectos ? ORIGENES_PERMITIDOS_LOCAL : undefined);
  const origenes = leerOrigenes(origenesTexto ?? '', problemas);

  const driver =
    resultado.success && limpio.ARCHIVOS_DRIVER !== undefined
      ? (limpio.ARCHIVOS_DRIVER as DriverDeArchivos)
      : undefined;
  validarArchivos(limpio, driver, problemas);
  validarApiUrlPublica(limpio.API_URL_PUBLICA, problemas);

  if (problemas.length > 0 || !resultado.success) throw new EntornoInvalidoError(problemas);
  const driverPorDefecto: DriverDeArchivos | undefined =
    limpio.NODE_ENV === 'test'
      ? 'memoria'
      : limpio.NODE_ENV === 'development'
        ? 'disco'
        : undefined;
  const driverFinal = resultado.data.ARCHIVOS_DRIVER ?? driverPorDefecto;
  const apiUrlPublica =
    resultado.data.API_URL_PUBLICA ??
    (conDefectos ? `http://localhost:${resultado.data.PORT}` : undefined);
  const urlPublica =
    resultado.data.ARCHIVOS_URL_PUBLICA ??
    (driverFinal === 'disco' ? `http://localhost:${resultado.data.PORT}/archivos` : undefined);
  return {
    ...resultado.data,
    PIN_PEPPER: pinPepper,
    ORIGENES_PERMITIDOS: origenes,
    ARCHIVOS_DRIVER: driverFinal,
    ARCHIVOS_DIRECTORIO: resultado.data.ARCHIVOS_DIRECTORIO ?? ARCHIVOS_DIRECTORIO_LOCAL,
    ARCHIVOS_URL_PUBLICA: urlPublica?.replace(/\/+$/, ''),
    TIEMPO_REAL:
      resultado.data.TIEMPO_REAL ?? (limpio.NODE_ENV === 'test' ? 'deshabilitado' : 'habilitado'),
    API_URL_PUBLICA: apiUrlPublica?.replace(/\/+$/, ''),
  };
}

const VARIABLES_R2 = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

/**
 * Reglas del almacén de archivos (historia 003, tarea T10): `disco` solo con `NODE_ENV=development` (la API
 * sirve esa carpeta en `/archivos`, y nunca debe hacerlo en otro entorno); `r2` exige sus credenciales y la
 * URL pública del bucket.
 */
function validarArchivos(
  env: Record<string, string | undefined>,
  driver: DriverDeArchivos | undefined,
  problemas: string[],
): void {
  if (driver === 'disco' && env.NODE_ENV !== 'development') {
    problemas.push(
      'ARCHIVOS_DRIVER=disco solo vale con NODE_ENV=development: ' +
        'usa r2 (producción) o memoria (pruebas)',
    );
  }
  if (driver === 'r2') {
    for (const variable of VARIABLES_R2) {
      if (env[variable] === undefined) {
        problemas.push(`${variable} es obligatoria con ARCHIVOS_DRIVER=r2`);
      }
    }
    if (env.ARCHIVOS_URL_PUBLICA === undefined) {
      problemas.push('ARCHIVOS_URL_PUBLICA es obligatoria con ARCHIVOS_DRIVER=r2');
    }
  }
  if (env.ARCHIVOS_URL_PUBLICA !== undefined) {
    let valida = false;
    try {
      const url = new URL(env.ARCHIVOS_URL_PUBLICA);
      valida = url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      valida = false;
    }
    if (!valida) {
      problemas.push(
        'ARCHIVOS_URL_PUBLICA no es una URL http(s) válida (por ejemplo https://fotos.ejemplo.pe)',
      );
    }
  }
}

/** `API_URL_PUBLICA`, si se define, debe ser una URL http(s): es lo que el puente de impresión escanea en el QR. */
function validarApiUrlPublica(valor: string | undefined, problemas: string[]): void {
  if (valor === undefined) return;
  let valida = false;
  try {
    const url = new URL(valor);
    valida = url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    valida = false;
  }
  if (!valida) {
    problemas.push(
      'API_URL_PUBLICA no es una URL http(s) válida (por ejemplo https://api.ejemplo.pe)',
    );
  }
}

/**
 * Lo que la API exige para arrancar en producción y que `cargarEntorno` no exige al leer el entorno:
 * `PIN_PEPPER` (sin ella no se puede calcular la huella de los PIN), `ORIGENES_PERMITIDOS` (CORS de la
 * PWA) y `ARCHIVOS_DRIVER=r2` (las fotos no pueden quedar en memoria ni en disco). Con `development` y `test` tienen valor por defecto. `crearAplicacion` la llama antes de
 * construir nada; lanza `EntornoInvalidoError` con todo lo que falte.
 */
export function exigirEntornoDeProduccion(entorno: Entorno): void {
  if (entorno.NODE_ENV !== 'production') return;
  const problemas: string[] = [];
  if (entorno.PIN_PEPPER === undefined) {
    problemas.push(
      'PIN_PEPPER es obligatoria en producción (base64, al menos 32 bytes): sin ella no se puede ' +
        'calcular la huella de los PIN',
    );
  }
  if (entorno.ORIGENES_PERMITIDOS.length === 0) {
    problemas.push(
      'ORIGENES_PERMITIDOS es obligatoria en producción (orígenes de la PWA separados por coma)',
    );
  }
  if (entorno.ARCHIVOS_DRIVER !== 'r2') {
    problemas.push(
      'ARCHIVOS_DRIVER=r2 es obligatorio en producción (fotos de la carta en Cloudflare R2, con sus ' +
        'R2_* y ARCHIVOS_URL_PUBLICA)',
    );
  }
  if (problemas.length > 0) throw new EntornoInvalidoError(problemas);
}

/**
 * Con el tiempo real habilitado (`TIEMPO_REAL=habilitado`, o la opción de `crearAplicacion`), el adaptador de
 * Socket.IO necesita su propia conexión: `DATABASE_TIEMPO_REAL_URL`, con el rol `restaurante_tiempo_real`
 * (historia 004, criterio 70). No está en `exigirEntornoDeProduccion` porque depende de si el tiempo real está
 * habilitado, que `crearAplicacion` decide con su opción y el entorno. Lanza `EntornoInvalidoError`.
 */
export function exigirEntornoDeTiempoReal(entorno: Entorno, habilitado: boolean): void {
  if (habilitado && entorno.DATABASE_TIEMPO_REAL_URL === undefined) {
    throw new EntornoInvalidoError([
      'DATABASE_TIEMPO_REAL_URL es obligatoria con TIEMPO_REAL=habilitado: es la conexión del adaptador ' +
        'de Socket.IO, con el rol restaurante_tiempo_real (ver db:preparar)',
    ]);
  }
}
