import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { PlataformaModule } from '../plataforma';
import { SeguridadModule } from '../seguridad';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';
import { FacturadoService } from './facturado';
import { RegistroImpresoraDeCaja } from './impresora-de-caja';
import { SeriesService } from './series.service';
import { UltimaEmisionDeComprobantes } from './ultima-emision-de-comprobantes';

/**
 * Facturación (historia 006, entrega 6a): dueño de `serie`, `comprobante` y `comprobante_linea` (migración
 * `202611040003-facturacion`). Numera sin saltos ni duplicados dentro de la transacción del cobro (`EmisionService`) y
 * guarda cada comprobante tal como era al emitirse, con el detalle calculado de su parte (`comprobante.detalle_parte`).
 * Usa plataforma (`SuscripcionService`, y le registra la fecha del último comprobante de cada emisor) e impresión
 * (puerto `IMPRESION`, global); nunca lee tablas ajenas: el módulo de caja lo usa por sus servicios y le registra la
 * impresora de una caja para reimprimir. En 6b
 * se agregan el envío al PSE, las notas de crédito y el padrón.
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule, PlataformaModule],
  controllers: [ComprobantesController],
  providers: [
    SeriesService,
    EmisionService,
    FacturadoService,
    ComprobantesService,
    RegistroImpresoraDeCaja,
    UltimaEmisionDeComprobantes,
  ],
  exports: [
    SeriesService,
    EmisionService,
    FacturadoService,
    ComprobantesService,
    RegistroImpresoraDeCaja,
  ],
})
export class FacturacionModule {}
