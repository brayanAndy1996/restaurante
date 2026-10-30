/**
 * Tickets ESC/POS (historia 004, criterios 114, 118 y 123 a 128).
 *
 * Dos pasos: las plantillas arman un documento lógico (`documentoTicket` de `packages/contratos`, lo que guarda
 * cada trabajo de impresión) y `renderizarTicket` lo convierte en bytes con el ancho y el juego de caracteres
 * vigentes de la impresora al entregarlo. Todo es puro (sin base de datos, reloj ni red): las horas llegan ya
 * formateadas en la hora local de la sucursal, por ejemplo "20:15".
 *
 * Cómo armar la entrada desde pedidos:
 *
 * - Comanda (`documentoDeComanda(comanda, contexto)`): una por `comanda` guardada.
 *   - `comanda.tipo`, `comanda.estacion` (nombre de la estación) y `comanda.motivo` (el de la anulación, de
 *     `ComandaResumen.motivo`) salen de la comanda y su estación.
 *   - `comanda.lineas` son las `comanda_linea` de esa comanda, no las del ítem: cada una es una parte
 *     (`ParteDeComanda`) con su `cantidad` (la fija en `MARCHAR` y `ANULACION`), `nombre`, `contexto`,
 *     `modificadores`, `observacion`, `paraLlevar` y `esperar`. En una marcha van solo los ítems marchados y en
 *     una anulación solo lo anulado, con la cantidad anulada.
 *   - `contexto` toma de la orden `mesas` (nombres de las mesas vigentes) y `mozo.nombre`; `hora` es la del
 *     envío, la marcha o la anulación; `envioNumero` es el `numero` del envío (`null` en marcha y anulación).
 * - Pre-cuenta (`documentoDePrecuenta(precuenta, contexto)`): `PrecuentaRespuesta` de `precuentas.service.ts`
 *   cumple `PrecuentaParaTicket` tal cual (`numero`, `orden`, `lineas`, `total`, `nota`); `contexto` es el nombre
 *   de la sucursal y la hora de emisión.
 * - Página de prueba (`documentoDePrueba(impresora)`): `nombre`, `anchoMm` y `juegoCaracteres` de la impresora.
 * - Marcas (`conMarcas(documento, { retraso, reimpresion })`): se aplican al entregar o al reimprimir, sobre el
 *   documento guardado, que queda intacto. `retraso.horaEnvio` es la hora de creación del trabajo.
 * - Bytes (`renderizarTicket(documento, impresora)`): `impresora` es `{ anchoMm, juegoCaracteres }` vigentes al
 *   entregar; devuelve el `Uint8Array` que se manda por TCP (`ESC @` … `GS V`) y lanza `Error` si el documento
 *   no cumple `documentoTicketSchema`. Nunca pasa de `MAXIMO_BYTES_TICKET` (256 KB): si no cupo, lo corta con el aviso
 *   de incompleto. `renderizarTicketDetallado` da además `recortado`, para marcar el trabajo `incompleto`.
 *
 * - Incompleto (`esIncompleto(documento)`): `true` si a una plantilla no le cupo todo (un caso extremo) y el ticket
 *   termina con "Ticket incompleto: faltan N líneas. Revisa la cuenta en la app."; el trabajo se guarda marcado.
 *
 * Los tipos de documento son `COMANDA`, `ADICION`, `MARCHAR`, `ANULACION`, `PRECUENTA` y `PRUEBA`; el tipo del
 * documento es el del trabajo.
 */
export { renderizarTicket, renderizarTicketDetallado } from './renderizar-ticket';
export type { ImpresoraParaRenderizar, TicketRenderizado } from './renderizar-ticket';
export { documentoDeComanda } from './plantillas/comanda';
export type { ComandaParaTicket, ContextoDeComanda, LineaDeComanda } from './plantillas/comanda';
export { documentoDePrecuenta } from './plantillas/precuenta';
export type { ContextoDePrecuenta, PrecuentaParaTicket } from './plantillas/precuenta';
export { MUESTRA_DE_CARACTERES, documentoDePrueba } from './plantillas/prueba';
export type { ImpresoraDePrueba } from './plantillas/prueba';
export { TEXTO_REIMPRESION, TEXTO_RETRASO, conMarcas } from './plantillas/marcas';
export type { MarcasDeTicket } from './plantillas/marcas';
export { esIncompleto } from './plantillas/presupuesto';
export { adaptarTexto } from './tablas-codificacion';
export { LARGO_ERROR_DE_TRABAJO, errorDeDocumento, recortarError } from './validar-documento';
