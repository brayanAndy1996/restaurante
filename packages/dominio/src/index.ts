export { validarRuc } from './ruc';
export { diaOperativo } from './dia-operativo';
export { dentroDeHorario, validarHorario } from './horario';
export type { ErrorHorario, ResultadoValidacion, TramoHorario } from './horario';
export { REGIMENES_TRIBUTARIOS } from './regimen';
export type { RegimenTributario } from './regimen';
export {
  ACCIONES,
  ROLES,
  ROLES_DE_ACCESO,
  alcanceReportes,
  largoPin,
  permisosDeRol,
  puedeAutorizar,
  requisitoPermiso,
} from './permisos';
export type {
  Accion,
  AlcanceReportes,
  LargoPin,
  RequisitoPermiso,
  Rol,
  RolDeAcceso,
} from './permisos';
export { MODULOS } from './modulos';
export type { Modulo } from './modulos';
export { MAXIMO_PERSONAS_POR_EQUIPO } from './acceso';
export { estadoSuscripcion, fechaLima, periodoLima, sumarMeses } from './suscripcion';
export type {
  DatosSuscripcion,
  EstadoSuscripcionCodigo,
  ResultadoEstadoSuscripcion,
} from './suscripcion';
export * from './carta';
