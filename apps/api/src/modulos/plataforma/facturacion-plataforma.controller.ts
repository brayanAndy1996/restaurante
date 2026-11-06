import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AlertasPlataformaRespuesta, PadronEstadoRespuesta } from '@restaurante/contratos';
import { FacturacionPlataformaService } from './facturacion-plataforma.service';
import { Superadministrador, SuperadministradorActual } from './superadministrador.decorator';
import type { SuperadministradorAutenticado } from './tipos';

/**
 * Rutas del superadministrador sobre la facturación electrónica (historia 006, entrega 6b, criterios 133, 138 y 170):
 * `GET /plataforma/facturacion/alertas`, `GET /plataforma/padron` y `POST /plataforma/padron/carga`.
 */
@Controller('plataforma')
@Superadministrador()
export class FacturacionPlataformaController {
  constructor(
    @Inject(FacturacionPlataformaService) private readonly servicio: FacturacionPlataformaService,
  ) {}

  /** 200 `[{ empresaId, empresa, rechazados, demorados, detenidos, sinConfiguracion }]`. */
  @Get('facturacion/alertas')
  alertas(): Promise<AlertasPlataformaRespuesta> {
    return this.servicio.alertas();
  }

  /** 200 `{ cargadoEn, filas, fechaArchivo, ultimoIntentoEn, ultimoError }`. */
  @Get('padron')
  padron(): Promise<PadronEstadoRespuesta> {
    return this.servicio.estadoDelPadron();
  }

  /** 202: encola la carga del padrón (una a la vez). */
  @Post('padron/carga')
  @HttpCode(202)
  cargar(
    @SuperadministradorActual() superadministrador: SuperadministradorAutenticado,
  ): Promise<void> {
    return this.servicio.pedirCargaDelPadron(superadministrador.id);
  }
}
