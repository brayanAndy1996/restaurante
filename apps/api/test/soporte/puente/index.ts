export { EmuladorEscPos } from './emulador-escpos';
export type { ModoDeApagado, OpcionesEmuladorEscPos } from './emulador-escpos';
export { InterpreteEscPos, interpretarEscPos } from './interprete-escpos';
export type {
  AlineacionEmulada,
  LineaEmulada,
  OpcionesInterprete,
  SegmentoEmulado,
  TicketEmulado,
} from './interprete-escpos';
export { BytesEscPos, codificarTexto } from './bytes-escpos';
export { PAGINAS_DE_CODIGOS, TABLAS_ALTAS, decodificarByte } from './tablas-codificacion';
export type { NombrePaginaDeCodigos } from './tablas-codificacion';
export { ErrorProtocoloPuente, SimuladorPuente } from './simulador-puente';
export type {
  EntradaDeBitacora,
  EstadoDelSimulador,
  ImpresionRealizada,
  OpcionesSimuladorPuente,
  ResultadoReportado,
} from './simulador-puente';
export { ApiFalsaDelPuente } from './api-falsa-del-puente';
export type { PeticionRecibida, TrabajoFalso } from './api-falsa-del-puente';
