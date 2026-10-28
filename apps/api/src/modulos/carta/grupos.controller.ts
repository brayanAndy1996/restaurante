import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  grupoEntradaSchema,
  grupoModificarEntradaSchema,
  type GrupoEntradaValidada,
  type GrupoModificarEntradaValidada,
  type GrupoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { GruposService } from './grupos.service';

/** Grupos de modificadores y sus modificadores (criterios 24 a 29): `EDITAR_CARTA` en todas. */
@Controller('carta/grupos-modificadores')
export class GruposController {
  constructor(@Inject(GruposService) private readonly grupos: GruposService) {}

  /** 200; los grupos de la empresa ordenados por nombre. */
  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): Promise<GrupoRespuesta[]> {
    return this.grupos.listar();
  }

  /** 200; 404 con un id de otra empresa igual que con uno inexistente. */
  @Get(':id')
  @Permiso('EDITAR_CARTA')
  obtener(@Param('id', PipeUuid) id: string): Promise<GrupoRespuesta> {
    return this.grupos.obtener(id);
  }

  /** 201; 400; 403; 409 `CONFLICTO`; 422 `REFERENCIA_INVALIDA`. Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('EDITAR_CARTA')
  crear(
    @Body(new PipeZod(grupoEntradaSchema)) entrada: GrupoEntradaValidada,
  ): Promise<GrupoRespuesta> {
    return this.grupos.crear(entrada);
  }

  /** 200 (también al desactivar); 400; 403; 404; 409 `CONFLICTO` o `EN_USO`; 422 `REFERENCIA_INVALIDA`. */
  @Patch(':id')
  @Permiso('EDITAR_CARTA')
  modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(grupoModificarEntradaSchema)) cambios: GrupoModificarEntradaValidada,
  ): Promise<GrupoRespuesta> {
    return this.grupos.modificar(id, cambios);
  }
}
