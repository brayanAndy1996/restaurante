import { Controller, Get, Headers, Inject, Param, Res } from '@nestjs/common';
import type { CartaPublica, DisponibilidadPublica, EmpresaPublica } from '@restaurante/contratos';
import type { Response } from 'express';
import { coincideConEtag, etagDeVista } from '../../nucleo/http/etag';
import { Publica } from '../seguridad';
import { CartaPublicaService } from './carta-publica.service';

/** `Cache-Control` de la carta y de la lista de sucursales (criterio 22): el CDN la guarda 30 s y revalida 60 s más. */
export const CACHE_CONTROL_CARTA = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';

/** `Cache-Control` de la disponibilidad (criterio 23): 5 s. */
export const CACHE_CONTROL_DISPONIBILIDAD = 'public, max-age=5, s-maxage=5';

/**
 * Carta pública (historia 005, criterios 18 a 24). Las tres rutas son `@Publica()`: no hay sesión, la empresa sale
 * solo de la dirección (`ContextoPublico`) y se ignoran `Authorization` y `x-empresa-id`. Cada respuesta lleva su
 * `ETag` fuerte y responde 304 con `If-None-Match` igual.
 */
@Controller('publico/cartas')
export class CartaPublicaController {
  constructor(@Inject(CartaPublicaService) private readonly cartas: CartaPublicaService) {}

  /** 200 `empresaPublica` con `ETag`; 304; 404. */
  @Get(':empresaSlug')
  @Publica()
  async empresa(
    @Param('empresaSlug') empresaSlug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<EmpresaPublica | undefined> {
    const cuerpo = await this.cartas.empresa(empresaSlug);
    return conCache(cuerpo, ifNoneMatch, respuesta, CACHE_CONTROL_CARTA);
  }

  /** 200 `cartaPublica` con `ETag`; 304 con `If-None-Match`; 404. */
  @Get(':empresaSlug/:sucursalSlug')
  @Publica()
  async carta(
    @Param('empresaSlug') empresaSlug: string,
    @Param('sucursalSlug') sucursalSlug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<CartaPublica | undefined> {
    const cuerpo = await this.cartas.carta(empresaSlug, sucursalSlug);
    return conCache(cuerpo, ifNoneMatch, respuesta, CACHE_CONTROL_CARTA);
  }

  /** 200 `disponibilidadPublica` con `ETag`; 304; 404. */
  @Get(':empresaSlug/:sucursalSlug/disponibilidad')
  @Publica()
  async disponibilidad(
    @Param('empresaSlug') empresaSlug: string,
    @Param('sucursalSlug') sucursalSlug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<DisponibilidadPublica | undefined> {
    const cuerpo = await this.cartas.disponibilidad(empresaSlug, sucursalSlug);
    return conCache(cuerpo, ifNoneMatch, respuesta, CACHE_CONTROL_DISPONIBILIDAD);
  }
}

/** Pone `ETag` y `Cache-Control`; con `If-None-Match` igual responde 304 sin cuerpo. */
function conCache<T>(
  cuerpo: T,
  ifNoneMatch: string | undefined,
  respuesta: Response,
  cacheControl: string,
): T | undefined {
  const etag = etagDeVista(cuerpo);
  respuesta.setHeader('ETag', etag);
  respuesta.setHeader('Cache-Control', cacheControl);
  if (coincideConEtag(ifNoneMatch, etag)) {
    respuesta.status(304);
    return undefined;
  }
  return cuerpo;
}
