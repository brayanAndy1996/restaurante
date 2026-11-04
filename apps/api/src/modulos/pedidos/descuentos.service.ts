import { Injectable } from '@nestjs/common';
import type { DescuentoEntrada, DescuentoRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Descuentos por ítem y por cuenta (historia 006, criterios 38 a 46; ruta crítica P5). Aplicar valida con
 * `validarDescuento`, compara el objetivo de la clave con `exigirObjetivo`, sube `orden.version`, invalida la
 * pre-cuenta y deja `aplicar_descuento` en la auditoría; quitar deja `quitado_en` y `quitado_por`. FIRMAS de la
 * fase A.
 */
@Injectable()
export class DescuentosService {
  async aplicar(_ordenId: string, _entrada: DescuentoEntrada): Promise<DescuentoRespuesta> {
    throw noImplementado();
  }

  async quitar(_ordenId: string, _descuentoId: string): Promise<void> {
    throw noImplementado();
  }
}
