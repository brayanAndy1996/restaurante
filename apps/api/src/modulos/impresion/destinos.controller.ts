import { Controller, Get, Put } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Destino de cada estación y impresora de caja (historia 004, criterios 99 a 102). Firmas de la fase A (T35):
 * sin `@Permiso` (en la fase C, `ADMINISTRAR`), sin validación y sin lógica.
 */
@Controller('sucursales/:sucursalId')
export class DestinosController {
  @Get('estaciones-destino')
  listarDestinos(): never {
    throw noImplementado();
  }

  @Put('estaciones-destino/:estacionId')
  configurarDestino(): never {
    throw noImplementado();
  }

  @Get('impresion')
  verImpresion(): never {
    throw noImplementado();
  }

  @Put('impresion')
  configurarImpresion(): never {
    throw noImplementado();
  }
}
