import { Injectable } from '@nestjs/common';
import type { PadronRucRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/**
 * La búsqueda de un RUC en el padrón (historia 006, entrega 6b, criterios 139 y 142): llama a
 * `public.padron_buscar_ruc(ruc)` (`SECURITY DEFINER`, `STABLE`) con la conexión de la API; solo responde por un RUC
 * exacto de 11 dígitos, no escribe nada y no guarda quién consultó qué. 404 `RUC_NO_ENCONTRADO`; 503
 * `PADRON_NO_DISPONIBLE` sin ninguna carga.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T36.
 */
@Injectable()
export class PadronService {
  buscar(ruc: string): Promise<PadronRucRespuesta> {
    void ruc;
    return Promise.reject(noImplementado());
  }
}
