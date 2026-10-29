import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import {
  envioEntradaSchema,
  marchaEntradaSchema,
  type EnvioEntradaValidada,
  type EnvioRespuesta,
  type MarchaEntrada,
  type MarchaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { EnviosService } from './envios.service';

/**
 * Enviar la comanda y marchar (historia 004, criterios 15 a 33; ruta crítica P2). Ambas rutas llevan
 * `ATENDER_MESA` y `SALON`, y exigen `Idempotency-Key` (400 `DATOS_INVALIDOS` sin ella).
 */
@Controller('ordenes/:id')
export class EnviosController {
  constructor(@Inject(EnviosService) private readonly envios: EnviosService) {}

  /**
   * 201 `envioRespuesta`; 400; 403; 404 (orden de otra sucursal, de otra empresa o inexistente); 409
   * `ORDEN_NO_ABIERTA` (con `ordenId` si la orden se unió a otra); 422 `PRODUCTO_NO_VENDIBLE`,
   * `SELECCION_INVALIDA`, `MONTO_FUERA_DE_RANGO` o `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post('envios')
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  enviar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(envioEntradaSchema)) entrada: EnvioEntradaValidada,
  ): Promise<EnvioRespuesta> {
    return this.envios.enviar(id, entrada);
  }

  /**
   * 201 `{ id, comandas }`; 400; 403; 404; 409 `NADA_QUE_MARCHAR` u `ORDEN_NO_ABIERTA`; 422 `DATOS_INVALIDOS`
   * (ítems que no se pueden marchar) o `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post('marchas')
  @IdempotenteObligatoria()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  marchar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(marchaEntradaSchema)) entrada: MarchaEntrada,
  ): Promise<MarchaRespuesta> {
    return this.envios.marchar(id, entrada);
  }
}
