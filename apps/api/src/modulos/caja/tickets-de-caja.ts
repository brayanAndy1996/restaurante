import { Inject, Injectable } from '@nestjs/common';
import type {
  DocumentoTicket,
  ImpresionDeCajaRespuesta,
  ReporteCaja,
} from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import { RELOJ, horaLocal, type Reloj } from '../../nucleo/reloj';
import { documentoDeGaveta, documentoDeReporteCaja } from '../impresion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';
import { SucursalesConsultaService } from '../plataforma';
import { ImpresoraDeCajas } from './impresora-de-cajas';

/** `02/11 10:00` en la hora de Lima, para los reportes. */
function fechaYHora(instante: Date | string): string {
  const fecha = new Date(instante);
  const [, mes, dia] = fechaLima(fecha).split('-');
  return `${dia}/${mes} ${horaLocal(fecha)}`;
}

/**
 * Documentos de impresión de caja (historia 006, criterios 93 y 95) y su encolado: el reporte X, la Z y el pulso solo de
 * la gaveta (apertura con fondo y movimientos). Todo se encola con `ImpresionPuerto.encolar` dentro de la transacción de
 * quien llama (si el encolado falla, falla la operación entera) y el aviso al puente sale después de confirmar. Sin
 * impresora de caja ni de la sucursal no se encola nada (criterio 96). El ticket del comprobante lo arma facturación.
 */
@Injectable()
export class TicketsDeCaja {
  constructor(
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(ImpresoraDeCajas) private readonly impresoras: ImpresoraDeCajas,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** El documento del reporte X o de la Z con las horas en la hora local de la sucursal. */
  reporte(
    tipo: 'REPORTE_X' | 'REPORTE_Z',
    reporte: ReporteCaja,
    sucursalNombre: string,
  ): DocumentoTicket {
    return documentoDeReporteCaja(tipo, reporte, {
      sucursal: sucursalNombre,
      abierto: fechaYHora(reporte.turno.abiertoEn),
      cerrado: reporte.turno.cerradoEn === null ? null : fechaYHora(reporte.turno.cerradoEn),
      generado: fechaYHora(this.reloj.ahora()),
    });
  }

  /** Un documento `GAVETA` con solo el bloque `gaveta` (sin avance ni corte). */
  gaveta(): DocumentoTicket {
    return documentoDeGaveta();
  }

  /**
   * Encola el `REPORTE_X` o el `REPORTE_Z` del turno en la impresora de su caja. `{ trabajoId: null, impresion:
   * 'SIN_IMPRESORA' }` si no hay impresora (criterio 96).
   */
  async encolarReporte(
    tipo: 'REPORTE_X' | 'REPORTE_Z',
    d: { sucursalId: string; cajaId: string; turnoId: string; reporte: ReporteCaja },
  ): Promise<ImpresionDeCajaRespuesta> {
    const impresora = await this.impresoras.deLaCaja(d.cajaId);
    if (impresora === null) return { trabajoId: null, impresion: 'SIN_IMPRESORA' };
    const sucursal = (await this.sucursales.datosPublicos([d.sucursalId])).get(d.sucursalId);
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: d.sucursalId,
        impresoraId: impresora.id,
        estacionId: null,
        tipo,
        comandaId: null,
        precuentaId: null,
        turnoId: d.turnoId,
        mesa: null,
        ordenId: null,
        envioNumero: null,
        documento: this.reporte(tipo, d.reporte, sucursal?.nombre ?? ''),
      },
    ]);
    return { trabajoId: trabajoId ?? null, impresion: 'EN_COLA' };
  }

  /**
   * Encola el trabajo `GAVETA` (solo el pulso) en la impresora de la caja si tiene gaveta (criterio 93). Sin impresora
   * o sin gaveta no hace nada: `SIN_IMPRESORA` (la apertura y los movimientos se hacen igual).
   */
  async encolarGaveta(d: {
    sucursalId: string;
    cajaId: string;
    turnoId: string;
  }): Promise<ImpresionDeCajaRespuesta> {
    const impresora = await this.impresoras.deLaCaja(d.cajaId);
    if (impresora === null || !impresora.gaveta)
      return { trabajoId: null, impresion: 'SIN_IMPRESORA' };
    const [trabajoId] = await this.impresion.encolar([
      {
        sucursalId: d.sucursalId,
        impresoraId: impresora.id,
        estacionId: null,
        tipo: 'GAVETA',
        comandaId: null,
        precuentaId: null,
        turnoId: d.turnoId,
        mesa: null,
        ordenId: null,
        envioNumero: null,
        documento: this.gaveta(),
      },
    ]);
    return { trabajoId: trabajoId ?? null, impresion: 'EN_COLA' };
  }
}
