import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { CartaPublica, DisponibilidadPublica, EmpresaPublica } from '@restaurante/contratos';
import { CartaPublicaService } from './carta-publica.service';

/**
 * Carta pública (historia 005, criterios 18 a 24). FIRMAS: sin `@Publica()` hasta la fase C (T9), que también
 * valida la forma de las direcciones (404 sin consultar la base), arma `ETag` y `Cache-Control` y resuelve la empresa.
 */
@Controller('publico/cartas')
export class CartaPublicaController {
  constructor(@Inject(CartaPublicaService) private readonly cartas: CartaPublicaService) {}

  /** 200 `empresaPublica`; 404. */
  @Get(':empresaSlug')
  empresa(@Param('empresaSlug') empresaSlug: string): Promise<EmpresaPublica> {
    return this.cartas.empresa(empresaSlug);
  }

  /** 200 `cartaPublica` con `ETag`; 304 con `If-None-Match`; 404. */
  @Get(':empresaSlug/:sucursalSlug')
  carta(
    @Param('empresaSlug') empresaSlug: string,
    @Param('sucursalSlug') sucursalSlug: string,
  ): Promise<CartaPublica> {
    return this.cartas.carta(empresaSlug, sucursalSlug);
  }

  /** 200 `disponibilidadPublica` con `ETag`; 304; 404. */
  @Get(':empresaSlug/:sucursalSlug/disponibilidad')
  disponibilidad(
    @Param('empresaSlug') empresaSlug: string,
    @Param('sucursalSlug') sucursalSlug: string,
  ): Promise<DisponibilidadPublica> {
    return this.cartas.disponibilidad(empresaSlug, sucursalSlug);
  }
}
