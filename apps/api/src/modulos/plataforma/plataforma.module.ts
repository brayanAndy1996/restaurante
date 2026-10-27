import { Module } from '@nestjs/common';
import { OperacionPlataforma } from './operacion-plataforma';
import { PlataformaEmpresasService } from './plataforma-empresas.service';
import { SucursalService } from './sucursal.service';
import { SucursalesController } from './sucursales.controller';

// FASE A: sin conexión ni modelos. T11/T14 agregan el proveedor CONEXION_PLATAFORMA (no exportado).
@Module({
  controllers: [SucursalesController],
  providers: [OperacionPlataforma, PlataformaEmpresasService, SucursalService],
  exports: [OperacionPlataforma, PlataformaEmpresasService, SucursalService],
})
export class PlataformaModule {}
