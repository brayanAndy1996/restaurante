import { Controller, Get, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Estado de la impresión y trabajos de la sucursal activa (historia 004, criterios 121 y 128). Firmas de la fase
 * A (T35): sin `@RequiereSucursal` ni `@Permiso` (en la fase C, el estado solo `@RequiereSucursal()`; la lista de
 * trabajos y la reimpresión, `ATENDER_MESA`, esta con `Idempotency-Key` obligatoria), sin validación y sin
 * lógica.
 */
@Controller('impresion')
export class ImpresionController {
  @Get('estado')
  estado(): never {
    throw noImplementado();
  }

  @Get('trabajos')
  trabajos(): never {
    throw noImplementado();
  }

  @Post('trabajos/:id/reimpresion')
  reimprimir(): never {
    throw noImplementado();
  }
}
