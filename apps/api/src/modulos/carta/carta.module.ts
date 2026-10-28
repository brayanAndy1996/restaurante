import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { SeguridadModule } from '../seguridad';
import { AjustesSucursalController } from './ajustes-sucursal.controller';
import { AjustesSucursalService } from './ajustes-sucursal.service';
import { CartaDisponibilidadService } from './carta-disponibilidad.service';
import { CartaVentaService } from './carta-venta.service';
import { DisponibilidadController } from './disponibilidad.controller';
import { EstacionesController } from './estaciones.controller';
import { EstacionesService } from './estaciones.service';
import { EventosCarta } from './eventos-carta';
import { FamiliasController } from './familias.controller';
import { FamiliasService } from './familias.service';
import { FotosProductoController } from './fotos-producto.controller';
import { FotosProductoService } from './fotos-producto.service';
import { GruposController } from './grupos.controller';
import { MenuDelDiaController } from './menu-del-dia.controller';
import { PermisosCarta } from './permisos-carta';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { VistaSucursalController } from './vista-sucursal.controller';

/**
 * Carta (historia 003): dueño de `estacion`, `familia`, `producto`, `producto_sucursal`,
 * `producto_agotado`, `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo` y
 * `menu_del_dia_opcion` (las tablas llegan con las migraciones de la fase C: `estacion`, `familia` y
 * `producto` con el grupo C1). Importa `AuditoriaModule` (una fila por escritura) y `SeguridadModule`
 * para conocer el rol de una persona en cada sucursal (criterio 19b). Exporta solo los dos servicios que
 * usan las secciones 3, 5 y 6.
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule],
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
  providers: [
    EventosCarta,
    PermisosCarta,
    EstacionesService,
    FamiliasService,
    ProductosService,
    FotosProductoService,
    AjustesSucursalService,
    CartaVentaService,
    CartaDisponibilidadService,
  ],
  exports: [CartaVentaService, CartaDisponibilidadService],
})
export class CartaModule {}
