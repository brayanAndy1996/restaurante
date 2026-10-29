import { DynamicModule, Global, Module } from '@nestjs/common';
import { INVENTARIO, InventarioNulo, type InventarioPuerto } from './inventario.puerto';

/**
 * Provee `INVENTARIO` a toda la aplicación. `crearAplicacion({ inventario })` instala el de la prueba; sin él,
 * el `InventarioNulo`. La sección 6 reemplazará este módulo por el suyo sin cambiar el envío.
 */
@Global()
@Module({})
export class InventarioModule {
  static registrar(puerto?: InventarioPuerto): DynamicModule {
    return {
      module: InventarioModule,
      providers: [{ provide: INVENTARIO, useValue: puerto ?? new InventarioNulo() }],
      exports: [INVENTARIO],
    };
  }
}
