import { z } from 'zod';

export const saludRespuestaSchema = z.object({
  estado: z.enum(['ok', 'error']),
  baseDeDatos: z.enum(['ok', 'error']),
});

export type SaludRespuesta = z.infer<typeof saludRespuestaSchema>;
