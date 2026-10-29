import { Controller, Get, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { Puente, VinculacionPuente } from './puente.decoradores';

/**
 * Protocolo del puente de impresión, versión 1 (`packages/contratos/src/puente.ts`; historia 004, criterios 107 y
 * 109 a 115 y 120). `POST /puente/vinculacion` se autentica con el código `vi.…` y las demás con la credencial
 * `pu.…` del puente. Firmas de la fase A (T35): sin validación y sin lógica; los guards ya clasifican la ruta.
 */
@Controller('puente')
export class PuenteController {
  @Post('vinculacion')
  @VinculacionPuente()
  vincular(): never {
    throw noImplementado();
  }

  @Get('configuracion')
  @Puente()
  configuracion(): never {
    throw noImplementado();
  }

  @Get('trabajos')
  @Puente()
  trabajos(): never {
    throw noImplementado();
  }

  @Post('trabajos/:id/resultado')
  @Puente()
  resultado(): never {
    throw noImplementado();
  }

  @Post('latido')
  @Puente()
  latido(): never {
    throw noImplementado();
  }
}
