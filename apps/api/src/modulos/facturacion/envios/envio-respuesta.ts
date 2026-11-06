import type { EnvioPseRespuesta, IntentoPseRespuesta } from '@restaurante/contratos';
import type { EstadoEnvioPse, ResultadoEnvioPse } from '@restaurante/dominio';

/** Las columnas de `envio_pse` que forman el `envioRespuesta` (criterios 132 y 135). */
export const COLUMNAS_ENVIO = `e.estado AS envio_estado, e.intentos AS envio_intentos,
       e.proximo_intento_en AS envio_proximo, e.plazo_hasta AS envio_plazo,
       e.ultimo_resultado AS envio_resultado, e.ultimo_error AS envio_error`;

export interface FilaDeEnvio {
  envio_estado: EstadoEnvioPse | null;
  envio_intentos: number | null;
  envio_proximo: Date | null;
  envio_plazo: Date | null;
  envio_resultado: ResultadoEnvioPse | null;
  envio_error: string | null;
}

/** `envioRespuesta` de una fila con las columnas de `COLUMNAS_ENVIO`; `null` si el comprobante no tiene envío. */
export function envioRespuestaDe(fila: FilaDeEnvio): EnvioPseRespuesta | null {
  if (fila.envio_estado === null || fila.envio_plazo === null) return null;
  return {
    estado: fila.envio_estado,
    intentos: fila.envio_intentos ?? 0,
    proximoIntentoEn: fila.envio_proximo?.toISOString() ?? null,
    plazoHasta: fila.envio_plazo.toISOString(),
    ultimoResultado: fila.envio_resultado,
    ultimoError: fila.envio_error,
  };
}

/** Un `intento_pse` como `intentoRespuesta`: nunca el documento enviado ni el cuerpo de la respuesta (criterio 131). */
export interface FilaDeIntento {
  numero: number;
  operacion: IntentoPseRespuesta['operacion'];
  iniciado_en: Date;
  terminado_en: Date;
  resultado: IntentoPseRespuesta['resultado'];
  codigo: string | null;
  mensaje: string | null;
}

export function intentoRespuestaDe(fila: FilaDeIntento): IntentoPseRespuesta {
  return {
    numero: fila.numero,
    operacion: fila.operacion,
    iniciadoEn: fila.iniciado_en.toISOString(),
    terminadoEn: fila.terminado_en.toISOString(),
    resultado: fila.resultado,
    codigo: fila.codigo,
    mensaje: fila.mensaje,
  };
}
