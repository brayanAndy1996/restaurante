import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ALMACEN_COMPROBANTES, type AlmacenComprobantes } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { EnlacesComprobante } from './enlaces';
import { enlaceNoValido } from './errores-facturacion';
import { textoDelNumero } from './lectura-comprobante';

/** El actor de la lectura pública del PDF (criterio 160): no hay persona, hay «el enlace público del comprobante». */
export const ACTOR_PUBLICO_COMPROBANTE = { sistema: 'publico:comprobante' } as const;

/**
 * La lectura del PDF por un sello (historia 006, entrega 6b, criterio 160; ruta crítica P9). El orden es siempre el
 * mismo y todo fallo es el mismo 404 (`enlaceNoValido`), sin decir cuál de los cuatro motivos fue:
 *
 * 1. Abre el sello (sin tocar la base): alterado, de otra clave, vencido o mal formado → 404.
 * 2. Una sola `ContextoEmpresa.ejecutar` con la empresa que dice el sello y el actor `publico:comprobante`: lee el número y
 *    la `pdf_clave` del comprobante bajo la RLS de esa empresa. Un comprobante inexistente (o de otra empresa, que ese
 *    contexto no ve) o sin PDF → 404. La clave guardada debe ser la de esa empresa (`comprobantes/<empresaId>/…`).
 * 3. Ya sin transacción, lee el archivo del almacén privado.
 *
 * Nunca hay una consulta sin empresa ni una lista: el único camino a un archivo es un sello válido.
 */
@Injectable()
export class PublicoComprobantesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(EnlacesComprobante) private readonly enlaces: EnlacesComprobante,
    @Inject(ALMACEN_COMPROBANTES) private readonly almacen: AlmacenComprobantes,
  ) {}

  /** El PDF y el número del comprobante del sello; 404 `NO_ENCONTRADO` (el mismo cuerpo) si algo no cuadra. */
  async abrir(sello: string): Promise<{ contenido: Buffer; numero: string }> {
    const datos = this.enlaces.abrir(sello);
    if (datos === null) throw enlaceNoValido();
    const { empresaId, comprobanteId } = datos;
    const fila = await this.contexto.ejecutar(
      empresaId,
      async () => {
        const filas = await this.conexion.query<{
          serie: string;
          numero: number;
          pdf_clave: string | null;
        }>('SELECT serie, numero, pdf_clave FROM comprobante WHERE id = $1', {
          bind: [comprobanteId],
          type: QueryTypes.SELECT,
        });
        return filas[0] ?? null;
      },
      { actor: ACTOR_PUBLICO_COMPROBANTE },
    );
    if (fila === null || fila.pdf_clave === null) throw enlaceNoValido();
    if (!fila.pdf_clave.startsWith(`comprobantes/${empresaId}/${comprobanteId}/`)) {
      throw enlaceNoValido();
    }
    const contenido = await this.almacen.leer(fila.pdf_clave);
    if (contenido === null) throw enlaceNoValido();
    return { contenido, numero: textoDelNumero(fila.serie, fila.numero) };
  }
}
