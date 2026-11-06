import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import type { AppFact } from '../facturacion-critica/fabrica-facturacion';

/**
 * Cambia `comprobante.pdf_clave` con el contexto de la empresa y el actor de sistema `prueba`, por la conexión de la API (que
 * solo puede escribir esa columna y las de la respuesta del PSE): sirve para simular una fila que apunta a otro archivo.
 */
export async function actualizarPdfClave(
  ctx: AppFact,
  empresaId: string,
  comprobanteId: string,
  clave: string | null,
): Promise<void> {
  const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
  const conexion = ctx.app.get<Sequelize>(CONEXION_API, { strict: false });
  await contexto.ejecutar(
    empresaId,
    async () => {
      await conexion.query('UPDATE comprobante SET pdf_clave = $2 WHERE id = $1', {
        bind: [comprobanteId, clave],
        type: QueryTypes.UPDATE,
      });
    },
    { actor: { sistema: 'prueba' } },
  );
}
