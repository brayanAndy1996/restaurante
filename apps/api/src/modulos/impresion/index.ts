export { ImpresionModule } from './impresion.module';
export { Puente, VinculacionPuente } from './puente.decoradores';
export { PuenteGuard, VinculacionGuard } from './puente.guard';
export {
  conMarcas,
  documentoDeComanda,
  documentoDeComprobante,
  documentoDeGaveta,
  documentoDePrecuenta,
  documentoDeReporteCaja,
  documentoDePrueba,
  renderizarTicket,
  textoDelQr,
} from './escpos';
export type {
  ComandaParaTicket,
  ComprobanteParaTicket,
  ContextoDeComanda,
  ContextoDeComprobante,
  ContextoDeReporteCaja,
  ReporteParaTicket,
  ContextoDePrecuenta,
  ImpresoraParaRenderizar,
  LineaDeComanda,
  PrecuentaParaTicket,
} from './escpos';
export { OrdenesVigentes } from './ordenes-vigentes';
export { AlcanceDeReimpresion } from './alcance-de-reimpresion';
export type {
  ComprobadorDeReimpresion,
  TipoDeTrabajoDeCaja,
  TrabajoPorReimprimir,
} from './alcance-de-reimpresion';
