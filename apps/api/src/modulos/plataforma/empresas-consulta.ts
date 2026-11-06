import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * La lista de empresas para el barrido de envíos (historia 006, entrega 6b, criterio 126): la conexión de la API no puede
 * listar empresas, así que el worker pide los ids a plataforma con una operación de solo lectura
 * (`OperacionPlataforma.consultar`). Solo ids: ningún dato de las empresas.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T31.
 */
@Injectable()
export class EmpresasConsulta {
  ids(): Promise<string[]> {
    return Promise.reject(noImplementado());
  }
}
