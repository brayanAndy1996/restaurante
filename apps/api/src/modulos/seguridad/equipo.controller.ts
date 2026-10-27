import { Controller, Get } from '@nestjs/common';
import type { EquipoActualRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { Publica } from './decoradores';

/** Consulta pública del equipo (criterio 28). Lógica en la tarea T33. */
@Controller('equipo')
export class EquipoController {
  /** Exige `X-Equipo`. 200 `equipoActualRespuesta`; 401 `EQUIPO_NO_RECONOCIDO`. */
  @Get()
  @Publica()
  async actual(): Promise<EquipoActualRespuesta> {
    return noImplementado();
  }
}
