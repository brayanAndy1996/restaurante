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
});

type EntornoLeido = z.infer<typeof entornoSchema>;

export interface Entorno extends Omit<EntornoLeido, 'PIN_PEPPER' | 'ORIGENES_PERMITIDOS'> {
  /**
   * Secreto con el que se calcula la huella de los PIN (base64, 32 bytes o más). Con `NODE_ENV`
   * `development` o `test` tiene un valor por defecto. Será obligatoria en producción desde la tarea
   * T10; hasta entonces puede faltar (`undefined`).
   */
  PIN_PEPPER: string | undefined;
  /** Orígenes de la PWA permitidos por CORS (`ORIGENES_PERMITIDOS`, separados por coma). */
  ORIGENES_PERMITIDOS: string[];
}

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
  // Se comprueba aparte de zod para que el motivo salga siempre, aunque falte otra variable.
  if (limpio.NODE_ENV === 'production' && limpio.EMPRESA_POR_HEADER === 'habilitado') {
    problemas.push(
      'EMPRESA_POR_HEADER=habilitado está prohibido en producción (NODE_ENV=production): ' +
        'la cabecera x-empresa-id permitiría suplantar a cualquier empresa',
    );
  }
  // Con development o test las dos variables nuevas tienen valor por defecto; en producción pueden
  // faltar hasta la tarea T10, que las vuelve obligatorias.
  const conDefectos = limpio.NODE_ENV === 'development' || limpio.NODE_ENV === 'test';
  const pinPepper = limpio.PIN_PEPPER ?? (conDefectos ? PIN_PEPPER_LOCAL : undefined);
  if (typeof limpio.PIN_PEPPER === 'string') validarPinPepper(limpio.PIN_PEPPER, problemas);
  const origenesTexto =
    limpio.ORIGENES_PERMITIDOS ?? (conDefectos ? ORIGENES_PERMITIDOS_LOCAL : undefined);
  const origenes = leerOrigenes(origenesTexto ?? '', problemas);

  if (problemas.length > 0 || !resultado.success) throw new EntornoInvalidoError(problemas);
  return { ...resultado.data, PIN_PEPPER: pinPepper, ORIGENES_PERMITIDOS: origenes };
}
