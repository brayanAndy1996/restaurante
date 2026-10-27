import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import {
  emisorCrearEntradaSchema,
  type EmisorCrearEntrada,
  type EmisorRespuesta,
} from '@restaurante/contratos';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { AuditoriaService } from '../auditoria';
import { SoloAdministrador } from '../seguridad';
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
}
