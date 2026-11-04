import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  ventaMostradorEntradaSchema,
  type VentaMostradorEntradaValidada,
  type VentaMostradorRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { MostradorService } from './mostrador.service';

/**
 * Venta de mostrador (historia 006, criterios 79 a 85). FIRMA de la fase A: sin `@Permiso`, `@RequiereModulo` ni
 * idempotencia todavía. En la fase C lleva `COBRAR`, `CAJA` e `Idempotency-Key` obligatoria.
 */
@Controller('ventas-mostrador')
export class MostradorController {
  constructor(@Inject(MostradorService) private readonly mostrador: MostradorService) {}

  /** 201; 400; 403; 404; 409 (los del cobro y `CUENTA_CAMBIO`); 422 (los del cobro y los del envío de 004). */
  @Post()
  vender(
    @Body(new PipeZod(ventaMostradorEntradaSchema)) entrada: VentaMostradorEntradaValidada,
  ): Promise<VentaMostradorRespuesta> {
    return this.mostrador.vender(entrada);
  }
}
