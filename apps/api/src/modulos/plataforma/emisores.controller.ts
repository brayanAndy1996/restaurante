import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  emisorCrearEntradaSchema,
  type EmisorCrearEntrada,
  type EmisorRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { SoloAdministrador } from '../seguridad';

/** Emisores de la empresa de la sesión (criterios 9 y 70). Lógica en la tarea T14 (lectura) y T27 (alta). */
@Controller('emisores')
export class EmisoresController {
  /** 200: cualquier rol con sesión en la empresa. */
  @Get()
  async listar(): Promise<EmisorRespuesta[]> {
    return noImplementado();
  }

  /** Solo Administrador. Con `Idempotency-Key` opcional. 201; 400; 403. */
  @Post()
  @SoloAdministrador()
  @Idempotente()
  async crear(
    @Body(new PipeZod(emisorCrearEntradaSchema)) _entrada: EmisorCrearEntrada,
  ): Promise<EmisorRespuesta> {
    return noImplementado();
  }
}
