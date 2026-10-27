import { Controller, Get, Headers, Inject } from '@nestjs/common';
import type { EquipoActualRespuesta } from '@restaurante/contratos';
import { Publica } from './decoradores';
import { EquiposService } from './equipos.service';

/** Consulta pública del equipo (criterio 28). */
@Controller('equipo')
export class EquipoController {
  constructor(@Inject(EquiposService) private readonly equipos: EquiposService) {}

  /**
   * Exige `X-Equipo`. 200 `equipoActualRespuesta` con las personas activas que el equipo recuerda; 401
   * `EQUIPO_NO_RECONOCIDO` (el mismo cuerpo si falta, está mal formado o adulterado). Sin transacción del
   * interceptor (`@Publica()` implica `@SinEmpresa()`): el servicio abre la suya con la empresa del token.
   */
  @Get()
  @Publica()
  async actual(@Headers('x-equipo') equipo: string | undefined): Promise<EquipoActualRespuesta> {
    return this.equipos.consultar(equipo);
  }
}
