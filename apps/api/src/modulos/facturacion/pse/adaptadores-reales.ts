import type { ConectorPse } from './conector-pse';

/**
 * Los adaptadores reales del PSE registrados, por su código (historia 006, criterios 120 a 122). Es la única forma de que un
 * emisor en modo `REAL` tenga conector: `RegistroDeConectores.para` busca aquí el código guardado en
 * `configuracion_pse.conector` y, si no está, el envío termina en `ERROR_CONFIGURACION` sin llamar a nadie. El simulador
 * nunca ocupa su lugar.
 *
 * En 6b está vacío. T34 agrega el adaptador de su proveedor con el mismo código que agrega a `PSE_CONECTORES_REALES`
 * (`config/entorno.ts`), que es lo que `PSE_CONECTOR` admite al arrancar.
 */
export const ADAPTADORES_REALES: ReadonlyMap<string, ConectorPse> = new Map<string, ConectorPse>();
