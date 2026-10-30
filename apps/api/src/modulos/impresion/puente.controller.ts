import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  latidoEntradaSchema,
  resultadoTrabajoEntradaSchema,
  vincularPuenteEntradaSchema,
  type ConfiguracionPuente,
  type LatidoEntrada,
  type ResultadoTrabajoEntrada,
  type TrabajoParaImprimir,
  type VincularPuenteEntrada,
  type VincularPuenteRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import type { PuenteAutenticado, VinculacionAutenticada } from '../../nucleo/principal';
import { EstadoImpresionService } from './estado-impresion.service';
import { Puente, PuenteActual, VinculacionActual, VinculacionPuente } from './puente.decoradores';
import { PuentesService } from './puentes.service';
import { TrabajosService } from './trabajos.service';

/**
 * Protocolo del puente de impresión, versión 1 (`packages/contratos/src/puente.ts`; historia 004, criterios 107 y
 * 109 a 115 y 120). `POST /puente/vinculacion` se autentica con el código `vi.…` y las demás con la credencial
 * `pu.…` del puente; ninguna usa `@Permiso`: el puente no es una persona. La empresa, la sucursal y el actor
 * `puente:<id>` salen de la credencial, nunca del cuerpo, una cabecera o un parámetro.
 */
@Controller('puente')
export class PuenteController {
  constructor(
    @Inject(PuentesService) private readonly puentes: PuentesService,
    @Inject(TrabajosService) private readonly trabajos: TrabajosService,
    @Inject(EstadoImpresionService) private readonly estado: EstadoImpresionService,
  ) {}

  /** 201 `vincularPuenteRespuesta`; 400; 401 `VINCULACION_INVALIDA` (o `NO_AUTENTICADO` si el token no es un `vi.`). */
  @Post('vinculacion')
  @VinculacionPuente()
  vincular(
    @VinculacionActual() vinculacion: VinculacionAutenticada,
    @Body(new PipeZod(vincularPuenteEntradaSchema)) entrada: VincularPuenteEntrada,
  ): Promise<VincularPuenteRespuesta> {
    return this.puentes.vincular(vinculacion, entrada);
  }

  /** 200 `configuracionPuente`: las impresoras activas de su sucursal (criterio 110). */
  @Get('configuracion')
  @Puente()
  configuracion(@PuenteActual() puente: PuenteAutenticado): Promise<ConfiguracionPuente> {
    return this.puentes.configuracion(puente);
  }

  /**
   * 200 con hasta 20 trabajos pendientes por impresora de red activa de su sucursal, en orden de creación dentro de
   * cada una (criterio 113).
   */
  @Get('trabajos')
  @Puente()
  entregar(@PuenteActual() puente: PuenteAutenticado): Promise<TrabajoParaImprimir[]> {
    return this.trabajos.entregar(puente);
  }

  /** 200; 400; 404 (de otra sucursal, de otra empresa o inexistente); 409 `TRANSICION_INVALIDA` (vencido). */
  @Post('trabajos/:id/resultado')
  @Puente()
  @HttpCode(200)
  async resultado(
    @PuenteActual() puente: PuenteAutenticado,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(resultadoTrabajoEntradaSchema)) entrada: ResultadoTrabajoEntrada,
  ): Promise<void> {
    await this.trabajos.resultado(puente, id, entrada);
  }

  /** 204; 400. Guarda la señal y el estado de las impresoras de su sucursal (criterio 120). */
  @Post('latido')
  @Puente()
  @HttpCode(204)
  async latido(
    @PuenteActual() puente: PuenteAutenticado,
    @Body(new PipeZod(latidoEntradaSchema)) entrada: LatidoEntrada,
  ): Promise<void> {
    await this.estado.latido(puente, entrada);
  }
}
