import { Controller, Get, Inject, Param } from '@nestjs/common';
import { padronRucParametroSchema, type PadronRucRespuesta } from '@restaurante/contratos';
import { PipeZod } from '../../../nucleo/errores/pipes';
import { PadronService } from './padron.service';

/**
 * `GET /padron/ruc/:ruc` (historia 006, entrega 6b, criterio 139). Fase A: sin `@Permiso('COBRAR')` ni
 * `@RequiereModulo('FACTURACION')` (T36). 200 `padronRucRespuesta`; 400 (`campos.ruc`); 403; 404 `RUC_NO_ENCONTRADO`; 503
 * `PADRON_NO_DISPONIBLE`.
 */
@Controller('padron')
export class PadronController {
  constructor(@Inject(PadronService) private readonly padron: PadronService) {}

  @Get('ruc/:ruc')
  buscar(
    @Param('ruc', new PipeZod(padronRucParametroSchema)) ruc: string,
  ): Promise<PadronRucRespuesta> {
    return this.padron.buscar(ruc);
  }
}
