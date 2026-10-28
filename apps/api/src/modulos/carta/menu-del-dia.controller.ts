import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import {
  menuDelDiaConsultaSchema,
  menuDelDiaEntradaSchema,
  type MenuDelDiaConsulta,
  type MenuDelDiaEntrada,
  type MenuDelDiaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Permiso, RequiereSucursal } from '../seguridad';
import { MenuDelDiaService } from './menu-del-dia.service';

/**
 * Menú del día de la sucursal activa (criterios 34 a 38): `GESTIONAR_DISPONIBILIDAD` y sucursal activa
 * (Cocina/Barra, Supervisor y Administrador; el Mozo y el Cajero reciben 403, decisión 5).
 */
@Controller('carta/sucursal/menu-del-dia')
export class MenuDelDiaController {
  constructor(@Inject(MenuDelDiaService) private readonly menu: MenuDelDiaService) {}

  /** 200 `menuDelDiaRespuesta[]`; 400 (`dia` fuera del anterior, hoy o mañana); 403; 409 sin sucursal activa. */
  @Get()
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  consultar(
    @Query(new PipeZod(menuDelDiaConsultaSchema)) consulta: MenuDelDiaConsulta,
  ): Promise<MenuDelDiaRespuesta[]> {
    return this.menu.consultar(consulta);
  }

  /** 200; 400; 403; 404 (no es un menú del día de la empresa); 409; 422 `REFERENCIA_INVALIDA`. */
  @Put(':productoId')
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  armar(
    @Param('productoId', PipeUuid) productoId: string,
    @Body(new PipeZod(menuDelDiaEntradaSchema)) entrada: MenuDelDiaEntrada,
  ): Promise<MenuDelDiaRespuesta> {
    return this.menu.armarDia(productoId, entrada);
  }
}
