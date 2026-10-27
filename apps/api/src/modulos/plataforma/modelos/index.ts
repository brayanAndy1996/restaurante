export { definirModelos } from './definir-modelos';
export type { EmisorModelo, EmpresaModelo, Modelos, SucursalModelo } from './definir-modelos';

/** Token de Nest: modelos sobre la conexión de la API (contexto de empresa, bajo RLS). */
export const MODELOS_API = Symbol('MODELOS_API');

/** Token de Nest: modelos sobre la conexión de plataforma (solo dentro de `OperacionPlataforma`). */
export const MODELOS_PLATAFORMA = Symbol('MODELOS_PLATAFORMA');
