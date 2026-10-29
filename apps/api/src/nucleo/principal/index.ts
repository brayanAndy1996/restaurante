export type { Principal, TipoPrincipal } from './principal';
export {
  autorizacionConsumidaActual,
  ejecutarConPrincipal,
  guardarAutorizacionConsumida,
  principalActual,
} from './almacen';
export type { AutorizacionDePeticion, PeticionConPrincipal } from './almacen';
export { PrincipalInterceptor } from './principal.interceptor';
export { METADATO_SUPERADMINISTRADOR } from './metadatos';
