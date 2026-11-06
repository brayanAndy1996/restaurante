import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  notaCreditoEntradaSchema,
  type NotaCreditoEntradaValidada,
  type NotaCreditoRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { NotasCreditoService } from './notas-credito.service';

/**
 * `POST /notas-credito` (historia 006, entrega 6b, criterio 144). Fase A: sin `@Permiso('EMITIR_NOTA_CREDITO')`, sin la
 * clave diferida (`@ClaveDespuesDeValidar`) y sin `@RequiereModulo('FACTURACION')` (T40). Responde `Error('No implementado')`.
 * No cuelga de ningún prefijo de 6a (criterio 168).
 */
@Controller('notas-credito')
export class NotasCreditoController {
  constructor(@Inject(NotasCreditoService) private readonly notas: NotasCreditoService) {}

  /** 201 `notaCreditoRespuesta`; 400; 403; 404; 409; 422. */
  @Post()
  @IdempotenteObligatoria()
  emitir(
    @Body(new PipeZod(notaCreditoEntradaSchema)) entrada: NotaCreditoEntradaValidada,
  ): Promise<NotaCreditoRespuesta> {
    return this.notas.emitir(entrada);
  }
}
