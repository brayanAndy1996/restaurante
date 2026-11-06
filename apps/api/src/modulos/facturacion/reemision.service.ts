import { Inject, Injectable } from '@nestjs/common';
import type { ReemisionEntrada, ReemisionRespuesta } from '@restaurante/contratos';
import { AuditoriaService } from '../auditoria';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';

/**
 * "Emitir otro" (historia 006, entrega 6b, criterio 134): emite un comprobante nuevo, con otro número, en lugar de uno
 * `RECHAZADO` (mismas líneas y totales, `reemplaza_a_id`). Comprueba el alcance de quien pide (criterio 169: el Cajero, solo
 * los comprobantes de sus turnos; los demás, los de la sucursal activa), pide la emisión a `EmisionService.reemitir` y
 * deja exactamente una fila `reemitir_comprobante` en la misma transacción (criterio 171); una réplica con la misma
 * `Idempotency-Key` devuelve lo guardado sin llegar aquí. 409 `COMPROBANTE_NO_RECHAZADO` / `YA_REEMPLAZADO` / `SIN_SERIE`.
 */
@Injectable()
export class ReemisionService {
  constructor(
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
    @Inject(EmisionService) private readonly emision: EmisionService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  async reemitir(comprobanteId: string, entrada: ReemisionEntrada): Promise<ReemisionRespuesta> {
    const visible = await this.comprobantes.exigirVisible(comprobanteId);
    const id = comprobanteId.toLowerCase();
    const rechazado = await this.comprobantes.numeroDe(id);
    const emitido = await this.emision.reemitir(id, {
      tipo: entrada.tipo,
      ...(entrada.cliente === undefined ? {} : { cliente: entrada.cliente }),
    });
    const nuevo = emitido.comprobante;
    await this.auditoria.registrar({
      accion: 'reemitir_comprobante',
      sucursalId: visible.sucursalId,
      entidad: 'comprobante',
      entidadId: nuevo.id,
      detalle: {
        rechazado: { id, numero: rechazado },
        nuevo: { id: nuevo.id, numero: nuevo.numero },
        tipo: nuevo.tipo,
        cliente:
          nuevo.cliente === null || nuevo.cliente === undefined
            ? null
            : { tipoDocumento: nuevo.cliente.tipoDocumento, numero: nuevo.cliente.numero },
      },
    });
    return { comprobante: nuevo, impresion: emitido.impresion, trabajoId: emitido.trabajoId };
  }
}
