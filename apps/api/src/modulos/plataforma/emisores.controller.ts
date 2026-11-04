import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import {
  emisorCrearEntradaSchema,
  tasaIgvDesdeSchema,
  tasaIgvEntradaSchema,
  type EmisorCrearEntrada,
  type EmisorRespuesta,
  type TasaIgvEntrada,
  type TasaIgvRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { AuditoriaService } from '../auditoria';
import { Permiso, SoloAdministrador } from '../seguridad';
import { EmisoresService } from './emisores.service';

/** Emisores de la empresa de la sesión (criterios 9 y 70). */
@Controller('emisores')
export class EmisoresController {
  constructor(
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /** 200: cualquier rol con sesión en la empresa. */
  @Get()
  async listar(): Promise<EmisorRespuesta[]> {
    return this.emisores.listar();
  }

  /** Solo Administrador (y soporte). Con `Idempotency-Key` opcional. 201; 400; 403. */
  @Post()
  @SoloAdministrador()
  @Idempotente()
  async crear(
    @Body(new PipeZod(emisorCrearEntradaSchema)) entrada: EmisorCrearEntrada,
  ): Promise<EmisorRespuesta> {
    const emisor = await this.emisores.crear(entrada);
    await this.auditoria.registrar({
      accion: 'crear_emisor',
      entidad: 'emisor',
      entidadId: emisor.id,
      detalle: { ruc: emisor.ruc, razonSocial: emisor.razonSocial, regimen: emisor.regimen },
    });
    return emisor;
  }

  /**
   * Historia 006, criterio 6 (`ADMINISTRAR`, sin módulo): 200 `tasaIgvRespuesta[]` en orden de `desde`; 403; 404 si
   * el emisor es de otra empresa o no existe.
   */
  @Get(':id/tasas-igv')
  @Permiso('ADMINISTRAR')
  async tasasIgv(@Param('id', PipeUuid) id: string): Promise<TasaIgvRespuesta[]> {
    return this.emisores.tasasIgv(id);
  }

  /**
   * Historia 006, criterio 6 (`ADMINISTRAR`, sin módulo): crea o cambia la tasa desde `desde`. 200; 400; 403; 404; 409
   * `CONFLICTO` (hay comprobantes emitidos desde esa fecha). Deja `configurar_tasa_igv` en la auditoría; repetir sin
   * cambios responde 200 sin fila.
   */
  @Put(':id/tasas-igv/:desde')
  @Permiso('ADMINISTRAR')
  async configurarTasaIgv(
    @Param('id', PipeUuid) id: string,
    @Param('desde', new PipeZod(tasaIgvDesdeSchema)) desde: string,
    @Body(new PipeZod(tasaIgvEntradaSchema)) entrada: TasaIgvEntrada,
  ): Promise<TasaIgvRespuesta> {
    return this.emisores.configurarTasaIgv(id, desde, entrada);
  }
}
