import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { SeguridadModule } from '../seguridad';
import { AjustesSucursalController } from './ajustes-sucursal.controller';
import { AjustesSucursalService } from './ajustes-sucursal.service';
import { CartaConsultaService } from './carta-consulta.service';
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
import { GruposService } from './grupos.service';
import { MenuDelDiaController } from './menu-del-dia.controller';
import { MenuDelDiaService } from './menu-del-dia.service';
import { PermisosCarta } from './permisos-carta';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { VistaSucursalController } from './vista-sucursal.controller';

/**
 * Carta (historia 003): dueño de `estacion`, `familia`, `producto`, `producto_sucursal`, `producto_agotado`,
 * `grupo_modificadores`, `modificador`, `producto_grupo`, `componente_combo` y `menu_del_dia_opcion` (una
 * migración por grupo de tareas: C1 `estacion`, `familia` y `producto`; C2 `producto_sucursal`; C3 los grupos;
 * C4 `componente_combo` y `menu_del_dia_opcion`; C5 `producto_agotado`). Importa `AuditoriaModule` (una fila por
 * escritura) y `SeguridadModule` para conocer el rol de una persona en cada sucursal (criterio 19b). Exporta solo
 * los servicios que usan las secciones 3, 5 y 6.
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
    GruposService,
    MenuDelDiaService,
    CartaVentaService,
    CartaConsultaService,
    CartaDisponibilidadService,
  ],
  exports: [CartaVentaService, CartaConsultaService, CartaDisponibilidadService],
})
export class CartaModule {}
