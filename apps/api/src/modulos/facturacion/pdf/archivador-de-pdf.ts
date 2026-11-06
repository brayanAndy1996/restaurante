import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import {
  ALMACEN_COMPROBANTES,
  claveDeArchivoDeComprobante,
  type AlmacenComprobantes,
} from '../../../nucleo/archivos';
import { CONEXION_API } from '../../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../../nucleo/reloj';
import { leerComprobante } from '../lectura-comprobante';
import { RegistroDeConectores } from '../pse/registro-de-conectores';
import { PdfComprobantes } from './pdf-comprobantes';

/** El actor de las transacciones del PDF: el mismo trabajo de envíos al PSE (criterios 125, 159 y 163). */
const ACTOR_DEL_PDF = 'worker:envio-pse';

/** Cuántos comprobantes sin PDF recoge una vuelta del barrido por empresa (criterio 159). */
export const MAXIMO_PDF_POR_EMPRESA_Y_VUELTA = 20;

/** Cuánto espera el barrido para volver a intentar el PDF de un comprobante que falló en una vuelta (criterio 159). */
export const ESPERA_TRAS_FALLO_DE_PDF_MS = 10 * 60_000;
/** Tope de fallos recordados; pasado, se olvidan todos (el barrido los vuelve a aprender). */
const MAXIMO_DE_FALLOS_RECORDADOS = 10_000;

/**
 * Arma el PDF de un comprobante aceptado y lo deja en el almacén privado (historia 006, entrega 6b, criterio 159). Lo
 * llama el worker justo después de guardar el `ACEPTADO` y, para los que se quedaron sin PDF, el barrido.
 *
 * El PDF nunca se arma dentro de una transacción: una transacción corta lee el comprobante (con el contexto de su empresa
 * y el actor `worker:envio-pse`), el PDF se arma y se escribe fuera de ella con su clave fija
 * (`comprobantes/<empresaId>/<comprobanteId>/representacion.pdf`, así que repetirlo sobrescribe lo mismo) y otra
 * transacción corta anota `pdf_clave` solo si todavía no estaba. Si algo falla, el `ACEPTADO` ya está guardado y el
 * barrido lo vuelve a intentar: este servicio nunca lanza (el registro lleva ids, no datos de clientes).
 *
 * Los que fallan en el barrido (`recordarFallo`) no se vuelven a ofrecer durante `ESPERA_TRAS_FALLO_DE_PDF_MS`: así, los
 * comprobantes cuyo PDF falla siempre no ocupan el cupo de cada vuelta y no bloquean a los aceptados nuevos. El recuerdo es
 * del proceso (sin tabla): al reiniciar el worker se vuelven a intentar, que es inocuo porque el PDF es idempotente.
 */
@Injectable()
export class ArchivadorDePdf {
  private readonly logger = new Logger(ArchivadorDePdf.name);
  /** comprobanteId → instante (ms, reloj de la API) del último fallo del barrido. */
  private readonly fallos = new Map<string, number>();

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(ALMACEN_COMPROBANTES) private readonly almacen: AlmacenComprobantes,
    @Inject(PdfComprobantes) private readonly pdf: PdfComprobantes,
    @Inject(RegistroDeConectores) private readonly conectores: RegistroDeConectores,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * Arma y guarda el PDF del comprobante si está `ACEPTADO` (o `ANULADO` sin PDF) y no lo tiene. Devuelve `true` si lo
   * dejó guardado ahora; `false` si no había nada que hacer o falló.
   */
  async generar(empresaId: string, comprobanteId: string): Promise<boolean> {
    if (!uuidSchema.safeParse(empresaId).success || !uuidSchema.safeParse(comprobanteId).success) {
      return false;
    }
    try {
      const leido = await this.contexto.ejecutar(empresaId, () => this.leer(comprobanteId), {
        actor: { sistema: ACTOR_DEL_PDF },
      });
      if (leido === null) return false;
      const contenido = await this.pdf.armar(leido.comprobante, { urlConsulta: leido.urlConsulta });
      const clave = claveDeArchivoDeComprobante(empresaId, comprobanteId, 'representacion.pdf');
      await this.almacen.guardar(clave, contenido, 'application/pdf');
      await this.contexto.ejecutar(empresaId, () => this.anotar(comprobanteId, clave), {
        actor: { sistema: ACTOR_DEL_PDF },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          evento: 'pdf.no_generado',
          empresaId,
          comprobanteId,
          error: error instanceof Error ? error.name : 'error desconocido',
        }),
      );
      return false;
    }
  }

  /** El barrido anota que el PDF de este comprobante falló ahora: no se le ofrece de nuevo hasta pasada la espera. */
  recordarFallo(comprobanteId: string): void {
    if (this.fallos.size >= MAXIMO_DE_FALLOS_RECORDADOS) this.fallos.clear();
    this.fallos.set(comprobanteId, this.reloj.ahora().getTime());
  }

  /**
   * Los comprobantes aceptados (o anulados) de la empresa del contexto que siguen sin PDF, los más viejos primero, sin los que
   * fallaron en el barrido hace menos de `ESPERA_TRAS_FALLO_DE_PDF_MS`.
   */
  async pendientes(limite = MAXIMO_PDF_POR_EMPRESA_Y_VUELTA): Promise<string[]> {
    const ahora = this.reloj.ahora().getTime();
    const recientes: string[] = [];
    for (const [id, instante] of this.fallos) {
      if (ahora - instante >= ESPERA_TRAS_FALLO_DE_PDF_MS) this.fallos.delete(id);
      else recientes.push(id);
    }
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id
         FROM comprobante
        WHERE estado IN ('ACEPTADO', 'ANULADO') AND pdf_clave IS NULL
          AND id <> ALL ($1::uuid[])
        ORDER BY emitido_en, id
        LIMIT ${Math.trunc(limite)}`,
      { bind: [recientes], type: QueryTypes.SELECT },
    );
    return filas.map((f) => f.id);
  }

  private async leer(comprobanteId: string) {
    const filas = await this.conexion.query<{
      emisor_id: string;
      estado: string;
      pdf_clave: string | null;
    }>('SELECT emisor_id, estado, pdf_clave FROM comprobante WHERE id = $1', {
      bind: [comprobanteId],
      type: QueryTypes.SELECT,
    });
    const fila = filas[0];
    if (fila === undefined || fila.pdf_clave !== null) return null;
    if (fila.estado !== 'ACEPTADO' && fila.estado !== 'ANULADO') return null;
    const comprobante = await leerComprobante(this.conexion, comprobanteId);
    if (comprobante === null) return null;
    return { comprobante, urlConsulta: await this.conectores.urlConsulta(fila.emisor_id) };
  }

  /** Anota la clave solo si todavía no había una (dos workers a la vez dejan la misma clave). */
  private async anotar(comprobanteId: string, clave: string): Promise<void> {
    await this.conexion.query(
      `UPDATE comprobante SET pdf_clave = $2 WHERE id = $1 AND pdf_clave IS NULL`,
      { bind: [comprobanteId, clave], type: QueryTypes.UPDATE },
    );
  }
}
