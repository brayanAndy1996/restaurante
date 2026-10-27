import { z } from 'zod';

/** Token de Nest con el entorno ya validado. */
export const ENTORNO = Symbol('ENTORNO');

const urlPostgres = z.string().regex(/^postgres(ql)?:\/\//, 'Debe ser una URL postgres://…');

const entornoSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: urlPostgres,
  DATABASE_PLATAFORMA_URL: urlPostgres,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  EMPRESA_POR_HEADER: z.enum(['habilitado', 'deshabilitado']).optional(),
});

export type Entorno = z.infer<typeof entornoSchema>;

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
  if (problemas.length > 0 || !resultado.success) throw new EntornoInvalidoError(problemas);
  return resultado.data;
}
