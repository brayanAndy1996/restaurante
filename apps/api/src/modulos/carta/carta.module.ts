import { Module } from '@nestjs/common';
import { SeguridadModule } from '../seguridad';
import { AjustesSucursalController } from './ajustes-sucursal.controller';
import { CartaDisponibilidadService } from './carta-disponibilidad.service';
import { CartaVentaService } from './carta-venta.service';
import { DisponibilidadController } from './disponibilidad.controller';
import { EstacionesController } from './estaciones.controller';
import { FamiliasController } from './familias.controller';
import { FotosProductoController } from './fotos-producto.controller';
import { GruposController } from './grupos.controller';
import { MenuDelDiaController } from './menu-del-dia.controller';
import { ProductosController } from './productos.controller';
import { VistaSucursalController } from './vista-sucursal.controller';

/**
 * Carta (historia 003): dueño de `estacion`, `familia`, `producto`, `producto_sucursal`,
 * `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo` y
 * `menu_del_dia_opcion` (las tablas llegan con las migraciones de la fase C). Importa `SeguridadModule`
 * para conocer el rol de una persona en cada sucursal (criterio 19b). Exporta solo los dos servicios que
 * usan las secciones 3, 5 y 6.
 */
@Module({
  imports: [SeguridadModule],
  controllers: [
    EstacionesController,
    FamiliasController,
    ProductosController,
    FotosProductoController,
    AjustesSucursalController,
    GruposController,
    MenuDelDiaController,
    DisponibilidadController,
    VistaSucursalController,
  ],
  providers: [CartaVentaService, CartaDisponibilidadService],
  exports: [CartaVentaService, CartaDisponibilidadService],
})
export class CartaModule {}
