import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { SeguridadModule } from '../seguridad';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';
import { FacturadoService } from './facturado';
import { SeriesService } from './series.service';

/**
 * Facturación (historia 006, entrega 6a): dueño de `serie`, `comprobante` y `comprobante_linea` (todavía sin tablas:
 * migración 3 de la fase C). Numera sin saltos ni duplicados dentro de la transacción del cobro (`EmisionService`) y
 * guarda cada comprobante tal como era al emitirse. Usa plataforma (`EmisoresService`, `SuscripcionService`) e
 * impresión (puerto `IMPRESION`, global); nunca lee tablas ajenas y el módulo de caja lo usa por sus servicios. En 6b
 * se agregan el envío al PSE, las notas de crédito y el padrón.
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule],
  controllers: [ComprobantesController],
  providers: [SeriesService, EmisionService, FacturadoService, ComprobantesService],
  exports: [SeriesService, EmisionService, FacturadoService],
})
export class FacturacionModule {}
