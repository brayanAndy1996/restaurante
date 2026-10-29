import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  mesaEntradaSchema,
  mesaModificarEntradaSchema,
  type MesaEntrada,
  type MesaModificarEntrada,
  type MesaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { MesasService } from './mesas.service';

/**
 * Mesas del salón (historia 004, criterios 3 a 6): `ADMINISTRAR` en todas, con la sucursal en la ruta y sin
 * `@RequiereModulo` (son de configuración).
 */
@Controller('sucursales/:sucursalId')
export class MesasController {
  constructor(@Inject(MesasService) private readonly mesas: MesasService) {}

  /** 201; 400 (celda fuera de la zona); 403; 404; 409 `CONFLICTO`. Con `Idempotency-Key` opcional. */
  @Post('zonas/:zonaId/mesas')
  @Idempotente()
  @Permiso('ADMINISTRAR')
  crear(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('zonaId', PipeUuid) zonaId: string,
    @Body(new PipeZod(mesaEntradaSchema)) entrada: MesaEntrada,
  ): Promise<MesaRespuesta> {
    return this.mesas.crear(sucursalId, zonaId, entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` o `EN_USO`; 422 `REFERENCIA_INVALIDA` (zona). */
  @Patch('mesas/:id')
  @Permiso('ADMINISTRAR')
  modificar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(mesaModificarEntradaSchema)) cambios: MesaModificarEntrada,
  ): Promise<MesaRespuesta> {
    return this.mesas.modificar(sucursalId, id, cambios);
  }
}
