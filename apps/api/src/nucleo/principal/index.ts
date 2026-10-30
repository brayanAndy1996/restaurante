export type { Principal, TipoPrincipal } from './principal';
export {
  autorizacionConsumidaActual,
  ejecutarConPrincipal,
  guardarAutorizacionConsumida,
  principalActual,
} from './almacen';
export type { AutorizacionDePeticion, PeticionConPrincipal } from './almacen';
export { PrincipalInterceptor } from './principal.interceptor';
export {
  METADATO_PUENTE,
  METADATO_SUPERADMINISTRADOR,
  METADATO_VINCULACION_PUENTE,
} from './metadatos';
export type { PeticionConPuente, PuenteAutenticado, VinculacionAutenticada } from './puente';
