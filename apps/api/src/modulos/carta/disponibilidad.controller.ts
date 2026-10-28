import { Body, Controller, Delete, HttpCode, Inject, Param, Put } from '@nestjs/common';
import {
  agotadoEntradaSchema,
  type AgotadoEntradaValidada,
  type AgotadoRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Permiso, RequiereSucursal, SesionActual } from '../seguridad';
import { CartaDisponibilidadService } from './carta-disponibilidad.service';
import { noEncontrado } from './errores-carta';

/**
 * Agotados (86) de la sucursal activa (criterios 39 a 44): `GESTIONAR_DISPONIBILIDAD` y sucursal activa
 * (Cocina/Barra, Supervisor y Administrador; Mozo y Cajero reciben 403). La sucursal es siempre la activa de la
 * sesión: el cuerpo no la acepta (un campo desconocido responde 400).
 */
@Controller('carta/sucursal/agotados')
export class DisponibilidadController {
  constructor(
    @Inject(CartaDisponibilidadService) private readonly agotados: CartaDisponibilidadService,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  /** La sucursal activa; la ruta ya exige una (`@RequiereSucursal()`). */
  private sucursalActiva(): string {
    const sucursalId = this.sesion.principal().sucursalId;
    if (sucursalId === null) throw noEncontrado('La sucursal');
    return sucursalId;
  }

  /** 200 `agotadoRespuesta`; 400; 403; 404 (producto de otra empresa o inexistente); 409 sin sucursal activa. */
  @Put(':productoId')
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  marcar(
    @Param('productoId', PipeUuid) productoId: string,
    @Body(new PipeZod(agotadoEntradaSchema)) entrada: AgotadoEntradaValidada,
  ): Promise<AgotadoRespuesta> {
    return this.agotados.marcarAgotado({
      sucursalId: this.sucursalActiva(),
      productoId,
      hasta: entrada.hasta,
      origen: 'MANUAL',
    });
  }

  /** 204 (también si no estaba agotado); 403; 404; 409 sin sucursal activa. */
  @Delete(':productoId')
  @HttpCode(204)
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  reactivar(@Param('productoId', PipeUuid) productoId: string): Promise<void> {
    return this.agotados.reactivar({ sucursalId: this.sucursalActiva(), productoId });
  }
}
