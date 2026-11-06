import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria';
import { PlataformaModule } from '../plataforma';
import { SeguridadModule } from '../seguridad';
import { ResolutorDeAlcanceDelPanel } from './alcance-del-panel';
import { RegistroAlcanceDeTurnos } from './alcance-de-turnos';
import { AlertasParaPlataforma } from './alertas-para-plataforma';
import { AlcanceDeReimpresionDeComprobantes } from './alcance-de-reimpresion-de-comprobantes';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';
import { EmisionService } from './emision.service';
import { EnlacesComprobante } from './enlaces';
import { BarridoEnviosPse } from './envios/barrido-envios';
import { EnviosService } from './envios/envios.service';
import { ProcesadorEnviosPse } from './envios/procesador-envios';
import { TrabajoEnSegundoPlano } from './envios/trabajo-en-segundo-plano';
import { PublicoComprobantesController } from './publico-comprobantes.controller';
import { PublicoComprobantesService } from './publico-comprobantes.service';
import { PanelController } from './panel.controller';
import { PanelService } from './panel.service';
import { CargaPadron } from './padron/carga-padron';
import { PadronController } from './padron/padron.controller';
import { PadronService } from './padron/padron.service';
import { ArchivadorDePdf } from './pdf/archivador-de-pdf';
import { PdfComprobantes } from './pdf/pdf-comprobantes';
import { RegistroDeConectores } from './pse/registro-de-conectores';
import { ReemisionService } from './reemision.service';
import { FacturadoService } from './facturado';
import { RegistroImpresoraDeCaja, RegistroPagosDeCobro } from './impresora-de-caja';
import { SeriesService } from './series.service';
import { UltimaEmisionDeComprobantes } from './ultima-emision-de-comprobantes';

/**
 * Facturación (historia 006, entrega 6a): dueño de `serie`, `comprobante` y `comprobante_linea` (migración
 * `202611040003-facturacion`). Numera sin saltos ni duplicados dentro de la transacción del cobro (`EmisionService`) y
 * guarda cada comprobante tal como era al emitirse, con el detalle calculado de su parte (`comprobante.detalle_parte`).
 * Usa plataforma (`SuscripcionService`, y le registra la fecha del último comprobante de cada emisor) e impresión
 * (puerto `IMPRESION`, global); nunca lee tablas ajenas: el módulo de caja lo usa por sus servicios y le registra la
 * impresora de una caja para reimprimir. En 6b se agregan el envío al PSE (`RegistroDeConectores`,
 * `ProcesadorEnviosPse`, `BarridoEnviosPse`), el panel y la reemisión, el PDF y el enlace público, y el padrón de RUC
 * (dueño de `envio_pse` e `intento_pse`; las notas de crédito las orquesta caja y las numera `EmisionService`).
 */
@Module({
  imports: [AuditoriaModule, SeguridadModule, PlataformaModule],
  controllers: [
    ComprobantesController,
    PanelController,
    PadronController,
    // `GET /publico/comprobantes/:sello` (`@Publica()`): la única ruta pública nueva de 6b; las listas protegidas de rutas
    // públicas ya la admiten (T43).
    PublicoComprobantesController,
  ],
  providers: [
    SeriesService,
    EmisionService,
    FacturadoService,
    ComprobantesService,
    RegistroImpresoraDeCaja,
    RegistroPagosDeCobro,
    RegistroAlcanceDeTurnos,
    UltimaEmisionDeComprobantes,
    AlcanceDeReimpresionDeComprobantes,
    // Entrega 6b (fase A: firmas que lanzan «No implementado»).
    RegistroDeConectores,
    EnviosService,
    ProcesadorEnviosPse,
    BarridoEnviosPse,
    TrabajoEnSegundoPlano,
    PanelService,
    ResolutorDeAlcanceDelPanel,
    AlertasParaPlataforma,
    ReemisionService,
    EnlacesComprobante,
    PublicoComprobantesService,
    PdfComprobantes,
    ArchivadorDePdf,
    CargaPadron,
    PadronService,
  ],
  exports: [
    SeriesService,
    EmisionService,
    FacturadoService,
    ComprobantesService,
    RegistroImpresoraDeCaja,
    RegistroPagosDeCobro,
    RegistroAlcanceDeTurnos,
    RegistroDeConectores,
    EnviosService,
    ProcesadorEnviosPse,
    BarridoEnviosPse,
    TrabajoEnSegundoPlano,
    CargaPadron,
  ],
})
export class FacturacionModule {}
