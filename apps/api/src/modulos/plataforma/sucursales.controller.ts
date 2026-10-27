import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  sucursalConfigurarEntradaSchema,
  sucursalCrearEntradaSchema,
  type SucursalConfigurarEntrada,
  type SucursalCrearEntrada,
  type SucursalRespuesta,
} from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { AuditoriaService } from '../auditoria';
import { SoloAdministrador } from '../seguridad';
import { SucursalService } from './sucursal.service';

/**
 * Rutas de sucursal. Corren dentro del contexto de empresa que fija el interceptor global, con el actor de
 * la sesión. Leer es para cualquier rol con sesión; `POST` y `PATCH` son solo para el Administrador (y el
 * soporte), criterio 9: el guard de autenticación aplica `@SoloAdministrador()` antes del controlador. Cada
 * escritura deja su fila de auditoría en la misma transacción (criterio 58).
 */
@Controller('sucursales')
export class SucursalesController {
  constructor(
    @Inject(SucursalService) private readonly sucursales: SucursalService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  async listar(): Promise<SucursalRespuesta[]> {
    return this.sucursales.listar();
  }

  @Get(':id')
  async obtener(@Param('id', PipeUuid) id: string): Promise<SucursalRespuesta> {
    const sucursal = await this.sucursales.obtener(id);
    if (!sucursal) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
    return sucursal;
  }

  /**
   * Solo Administrador. Crea la sucursal (criterio 70). Con `Idempotency-Key` opcional. 201; 400; 403;
   * 409; 422 `EMISOR_INVALIDO`. La suscripción en el plan por defecto llega con el grupo C1.
   */
  @Post()
  @SoloAdministrador()
  @Idempotente()
  async crear(
    @Body(new PipeZod(sucursalCrearEntradaSchema)) entrada: SucursalCrearEntrada,
  ): Promise<SucursalRespuesta> {
    const sucursal = await this.sucursales.crear(entrada);
    await this.auditoria.registrar({
      accion: 'crear_sucursal',
      sucursalId: sucursal.id,
      entidad: 'sucursal',
      entidadId: sucursal.id,
      detalle: {
        nombre: sucursal.nombre,
        emisorId: sucursal.emisorId,
        codigoEstablecimiento: sucursal.codigoEstablecimiento,
      },
    });
    return sucursal;
  }

  @Patch(':id')
  @SoloAdministrador()
  async configurar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(sucursalConfigurarEntradaSchema)) cambios: SucursalConfigurarEntrada,
  ): Promise<SucursalRespuesta> {
    const sucursal = await this.sucursales.configurar(id, cambios);
    await this.auditoria.registrar({
      accion: 'configurar_sucursal',
      sucursalId: sucursal.id,
      entidad: 'sucursal',
      entidadId: sucursal.id,
      detalle: { campos: Object.keys(cambios) },
    });
    return sucursal;
  }
}
