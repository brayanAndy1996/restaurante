import { Inject, Injectable } from '@nestjs/common';
import { noImplementado } from '../../../nucleo/errores/no-implementado';
import { EmisoresService } from '../../plataforma';
import { CONECTOR_PSE, type ConectorDeEmisor, type ConectorPse } from './conector-pse';

/**
 * Elige el conector de un emisor según su modo (historia 006, entrega 6b, criterio 122; plan "Conector, simulador y
 * modo"). Sin fila en `configuracion_pse` → `{ modo: null }`: el envío no llama a nadie y termina en
 * `ERROR_CONFIGURACION`. `SIMULADO` usa el simulador del proceso; `REAL`, el adaptador que nombra `PSE_CONECTOR` (en 6b
 * no hay ninguno). `crearAplicacion({ pse })` y `crearWorker({ pse })` devuelven esa instancia para cualquier modo.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T30.
 */
@Injectable()
export class RegistroDeConectores {
  constructor(
    @Inject(CONECTOR_PSE) private readonly conectorInyectado: ConectorPse,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
  ) {}

  /** El conector, la credencial descifrada y el modo del emisor (con el contexto de su empresa). */
  para(emisorId: string): Promise<ConectorDeEmisor> {
    void this.conectorInyectado;
    void this.emisores;
    void emisorId;
    return Promise.reject(noImplementado());
  }
}
