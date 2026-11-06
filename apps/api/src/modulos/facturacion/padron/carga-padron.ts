import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/** Lo que dejó una carga del padrón (criterio 138). */
export interface ResultadoCargaPadron {
  /** Filas cargadas en la tabla inactiva. */
  filas: number;
  /** `true` si la carga cambió la tabla activa (terminó bien y tiene al menos el 90 % de las filas de la anterior). */
  activada: boolean;
}

/** Actor de la carga del padrón en los registros (`referencia` no es una tabla de clientes, criterio 163). */
export const ACTOR_WORKER_PADRON = 'worker:padron';

/**
 * La carga del padrón reducido de RUC de SUNAT (historia 006, entrega 6b, criterio 138): descarga y descomprime en flujo,
 * decodifica ISO-8859-1, escribe con `COPY` en la tabla inactiva (`referencia.padron_ruc_a` o `_b`) con el rol
 * `restaurante_referencia` (`DATABASE_REFERENCIA_URL`) y solo cambia la tabla activa si terminó sin errores y trae al
 * menos el 90 % de las filas de la carga anterior. Las búsquedas nunca ven una carga a medias.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T36 (que agrega `pg-copy-streams` y la biblioteca
 * de descompresión).
 */
@Injectable()
export class CargaPadron {
  cargar(): Promise<ResultadoCargaPadron> {
    return Promise.reject(noImplementado());
  }
}
