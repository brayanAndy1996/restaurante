import { Inject, Injectable } from '@nestjs/common';
import { EmisoresService } from '../../plataforma';
import { ADAPTADORES_REALES } from './adaptadores-reales';
import { CONECTOR_PSE, type ConectorDeEmisor, type ConectorPse } from './conector-pse';

/**
 * Elige el conector de un emisor según su modo (historia 006, entrega 6b, criterio 122; plan "Conector, simulador y
 * modo"). Falla cerrado: un emisor `REAL` nunca se envía con el simulador, que aceptaría el documento sin pasar por SUNAT.
 * - Sin fila en `configuracion_pse` → `{ modo: null }`: el envío no llama a nadie y termina en `ERROR_CONFIGURACION`
 *   («facturación no activada»).
 * - `SIMULADO` → el simulador (`CONECTOR_PSE`: el que inyectan `crearAplicacion({ pse })` y `crearWorker({ pse })`, o el
 *   propio de la aplicación). Ese `pse` reemplaza solo al simulador, nunca a un adaptador real.
 * - `REAL` → solo el adaptador real registrado en `ADAPTADORES_REALES` con el código guardado en
 *   `configuracion_pse.conector`. Si no existe (en 6b no hay ninguno, T34), `conector: null` con su detalle: el envío termina
 *   en `ERROR_CONFIGURACION` sin llamar a nadie.
 * - Una credencial guardada que no se puede abrir (clave cambiada, cifrado copiado a otro emisor) deja el conector en
 *   `null`: nunca se usa otra credencial (criterio 123).
 *
 * Debe llamarse dentro de `ContextoEmpresa.ejecutar` (la configuración se lee con la RLS de la empresa). La credencial
 * descifrada vive solo en el resultado: quien la recibe no la registra ni la guarda.
 */
@Injectable()
export class RegistroDeConectores {
  constructor(
    @Inject(CONECTOR_PSE) private readonly simulador: ConectorPse,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
  ) {}

  /**
   * La dirección donde el cliente consulta el comprobante (`urlConsulta()` del conector del emisor; criterio 162), para la
   * leyenda del ticket. Sin configuración, `null`. **No descifra la credencial**: el cobro nunca la toca (criterio 123).
   * Con el contexto de su empresa.
   */
  async urlConsulta(emisorId: string): Promise<string | null> {
    const configuracion = await this.emisores.conectorPse(emisorId);
    if (configuracion === null) return null;
    if (configuracion.modo === 'SIMULADO') return this.simulador.urlConsulta();
    return configuracion.conector === null
      ? null
      : (ADAPTADORES_REALES.get(configuracion.conector)?.urlConsulta() ?? null);
  }

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
    const modo = configuracion.modo;
    let conector: ConectorPse | null = this.simulador;
    if (modo === 'REAL') {
      conector =
        configuracion.conector === null
          ? null
          : (ADAPTADORES_REALES.get(configuracion.conector) ?? null);
      if (conector === null) {
        return {
          modo,
          conector: null,
          credencial: null,
          detalle: 'No hay un adaptador del PSE registrado para el conector de este emisor',
        };
      }
    }
    if (configuracion.credencialIlegible) {
      return {
        modo,
        conector: null,
        credencial: null,
        detalle: 'La credencial del PSE no se pudo abrir',
      };
    }
    return { modo, conector, credencial: configuracion.credencial, detalle: null };
  }
}
