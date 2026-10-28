import { Injectable, PipeTransform } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { ZodType } from 'zod';
import { ErrorAplicacion, errorDatosInvalidos } from './error-aplicacion';

/** Valida el valor con un esquema zod y devuelve el resultado ya con sus valores por defecto. */
export class PipeZod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodType<T>) {}

  transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    return resultado.data;
  }
}

/**
 * Parámetro de ruta UUID; si no lo es responde 400 DATOS_INVALIDOS. Lo devuelve en minúsculas, que es como
 * PostgreSQL imprime los `uuid` y como se guardan y comparan en toda la API: así un id en mayúsculas es el mismo
 * recurso que en minúsculas y ninguna comparación de texto (por ejemplo, "el producto no puede ser componente de
 * sí mismo") depende de la capitalización de la URL.
 */
@Injectable()
export class PipeUuid implements PipeTransform<string, string> {
  transform(valor: string): string {
    if (!uuidSchema.safeParse(valor).success) {
      throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El identificador no es un UUID válido', [
        { campo: 'id', mensaje: 'Debe ser un UUID' },
      ]);
    }
    return valor.toLowerCase();
  }
}
