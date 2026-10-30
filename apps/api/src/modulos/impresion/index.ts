export { ImpresionModule } from './impresion.module';
export { Puente, VinculacionPuente } from './puente.decoradores';
export { PuenteGuard, VinculacionGuard } from './puente.guard';
export {
  conMarcas,
  documentoDeComanda,
  documentoDePrecuenta,
  documentoDePrueba,
  renderizarTicket,
} from './escpos';
export type {
  ComandaParaTicket,
  ContextoDeComanda,
  ContextoDePrecuenta,
  ImpresoraParaRenderizar,
  LineaDeComanda,
  PrecuentaParaTicket,
} from './escpos';
