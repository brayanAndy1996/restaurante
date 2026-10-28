import { Body, Controller, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import {
  familiaEntradaSchema,
  familiaModificarEntradaSchema,
  ordenEntradaSchema,
  type FamiliaEntrada,
  type FamiliaModificarEntrada,
  type FamiliaRespuesta,
  type OrdenEntrada,
  type ProductoResumen,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { FamiliasService } from './familias.service';
import { ProductosService } from './productos.service';

/** Familias y el orden de familias y de productos (criterios 3 a 5 y 13): `EDITAR_CARTA` en todas. */
@Controller('carta/familias')
export class FamiliasController {
  constructor(
    @Inject(FamiliasService) private readonly familias: FamiliasService,
    @Inject(ProductosService) private readonly productos: ProductosService,
  ) {}

  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): Promise<FamiliaRespuesta[]> {
    return this.familias.listar();
  }

  /** 201; 400; 403; 409 `CONFLICTO`. Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('EDITAR_CARTA')
  crear(
    @Body(new PipeZod(familiaEntradaSchema)) entrada: FamiliaEntrada,
  ): Promise<FamiliaRespuesta> {
    return this.familias.crear(entrada);
  }

  /** 200 con la lista en el orden nuevo; 400 con un id faltante, repetido, inexistente o de otra empresa. */
  @Put('orden')
  @Permiso('EDITAR_CARTA')
  ordenar(
    @Body(new PipeZod(ordenEntradaSchema)) entrada: OrdenEntrada,
  ): Promise<FamiliaRespuesta[]> {
    return this.familias.ordenar(entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` o `EN_USO`. */
  @Patch(':id')
  @Permiso('EDITAR_CARTA')
  modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(familiaModificarEntradaSchema)) cambios: FamiliaModificarEntrada,
  ): Promise<FamiliaRespuesta> {
    return this.familias.modificar(id, cambios);
  }

  /** 200 con los productos de la familia en el orden nuevo; 400; 403; 404. */
  @Put(':id/productos/orden')
  @Permiso('EDITAR_CARTA')
  ordenarProductos(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(ordenEntradaSchema)) entrada: OrdenEntrada,
  ): Promise<ProductoResumen[]> {
    return this.productos.ordenarDeFamilia(id, entrada);
  }
}
