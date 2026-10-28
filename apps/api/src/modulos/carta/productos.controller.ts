import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  productoCrearEntradaSchema,
  productoModificarEntradaSchema,
  type ProductoCrearEntradaValidada,
  type ProductoModificarEntrada,
  type ProductoRespuesta,
  type ProductoResumen,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { ProductosService } from './productos.service';

/** Productos (criterios 6 a 12): `EDITAR_CARTA` (el Administrador y el Cajero). */
@Controller('carta/productos')
export class ProductosController {
  constructor(@Inject(ProductosService) private readonly productos: ProductosService) {}

  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): Promise<ProductoResumen[]> {
    return this.productos.listar();
  }

  /** 200; 404 con un id de otra empresa igual que con uno inexistente. */
  @Get(':id')
  @Permiso('EDITAR_CARTA')
  obtener(@Param('id', PipeUuid) id: string): Promise<ProductoRespuesta> {
    return this.productos.obtener(id);
  }

  /** 201; 400; 403; 409 `CONFLICTO`; 422 `REFERENCIA_INVALIDA`. Con `Idempotency-Key` opcional. */
  @Post()
  @Idempotente()
  @Permiso('EDITAR_CARTA')
  crear(
    @Body(new PipeZod(productoCrearEntradaSchema)) entrada: ProductoCrearEntradaValidada,
  ): Promise<ProductoRespuesta> {
    return this.productos.crear(entrada);
  }

  /** 200 (también al desactivar); 400; 403; 404; 409 `CONFLICTO`; 422 `REFERENCIA_INVALIDA`. */
  @Patch(':id')
  @Permiso('EDITAR_CARTA')
  modificar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(productoModificarEntradaSchema)) cambios: ProductoModificarEntrada,
  ): Promise<ProductoRespuesta> {
    return this.productos.modificar(id, cambios);
  }
}
