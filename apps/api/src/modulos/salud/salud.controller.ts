import { Controller, Get } from '@nestjs/common';
import type { SaludRespuesta } from '@restaurante/contratos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';

@Controller('health')
export class SaludController {
  /** 200 `{ estado: 'ok', baseDeDatos: 'ok' }` o 503 sin detalles (tarea T13). */
  @Get()
  @SinEmpresa()
  async comprobar(): Promise<SaludRespuesta> {
    throw new Error('No implementado');
  }
}
