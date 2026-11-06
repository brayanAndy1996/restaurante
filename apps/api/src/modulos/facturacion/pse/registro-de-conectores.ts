import { Inject, Injectable } from '@nestjs/common';
import { EmisoresService } from '../../plataforma';
import { CONECTOR_PSE, type ConectorDeEmisor, type ConectorPse } from './conector-pse';

/**
 * Elige el conector de un emisor según su modo (historia 006, entrega 6b, criterio 122; plan "Conector, simulador y
 * modo"). Sin fila en `configuracion_pse` → `{ modo: null }`: el envío no llama a nadie y termina en
 * `ERROR_CONFIGURACION` («facturación no activada»). `SIMULADO` usa el simulador del proceso; `REAL`, el adaptador que
 * nombra `PSE_CONECTOR` (en 6b no hay ninguno, T34). `crearAplicacion({ pse })` y `crearWorker({ pse })` instalan
 * `CONECTOR_PSE` y esa instancia sirve para cualquier modo. Una credencial guardada que no se puede abrir (clave cambiada,
 * cifrado copiado a otro emisor) deja el conector en `null`: nunca se usa otra credencial (criterio 123).
 *
 * Debe llamarse dentro de `ContextoEmpresa.ejecutar` (la configuración se lee con la RLS de la empresa). La credencial
 * descifrada vive solo en el resultado: quien la recibe no la registra ni la guarda.
 */
@Injectable()
export class RegistroDeConectores {
  constructor(
    @Inject(CONECTOR_PSE) private readonly conectorInyectado: ConectorPse,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
  ) {}

  /** El conector, la credencial descifrada y el modo del emisor (con el contexto de su empresa). */
  async para(emisorId: string): Promise<ConectorDeEmisor> {
    const configuracion = await this.emisores.configuracionPse(emisorId);
    if (configuracion === null) {
      return {
        modo: null,
        conector: null,
        credencial: null,
        detalle: 'La facturación electrónica de este RUC no está activada',
      };
    }
    if (configuracion.credencialIlegible) {
      return {
        modo: configuracion.modo,
        conector: null,
        credencial: null,
        detalle: 'La credencial del PSE no se pudo abrir',
      };
    }
    return {
      modo: configuracion.modo,
      conector: this.conectorInyectado,
      credencial: configuracion.credencial,
      detalle: null,
    };
  }
}
