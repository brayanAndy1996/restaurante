/**
 * Los intentos de una escritura que sobreviven a la pantalla que los hizo (la nota de crédito, historia 006, criterio
 * 153): el `id` que se mandó y la clave de idempotencia, para que un envío que se quedó sin respuesta no se convierta en
 * dos al volver a abrir la pantalla. Viven en memoria y se borran al cerrar la sesión: lo que una persona dejó a medias
 * no lo hereda la siguiente.
 */
export interface IntentoRecordado {
  huella: string;
  huellaDelCuerpo: string;
  id: string;
  clave: string;
  autorizacionId: string | null;
}

const INTENTOS = new Map<string, IntentoRecordado>();

/** Los envíos de cada intento que siguen vivos (en vuelo o esperando la red): por intento, cuántos hay con cada `id`. */
const ENVIOS_VIVOS = new Map<string, Map<string, number>>();
/** Cómo terminó con éxito el último envío de cada intento: lo consume la hoja que lo esperaba (otra hoja, ya cerrada, lo mandó). */
export interface ResultadoDeEnvio {
  id: string;
  respuesta: unknown;
}
const RESULTADOS = new Map<string, ResultadoDeEnvio>();
/**
 * Envíos vivos que la persona pidió revisar («Revisar el comprobante»): hasta que terminen, su intento no se suelta ni
 * siquiera porque el comprobante ya muestre la nota, y ninguna hoja manda otro envío de ese comprobante.
 */
const RETENIDOS = new Set<string>();
const llaveDe = (clave: string, id: string) => `${clave}|${id}`;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((o) => o());

/** Quien necesita enterarse de que cambió un intento o un envío (la hoja que espera la respuesta anterior). */
export function alCambiarLosIntentos(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export const leerIntento = (clave: string): IntentoRecordado | null => INTENTOS.get(clave) ?? null;

export function guardarIntento(clave: string, intento: IntentoRecordado | null): void {
  if (intento === null) INTENTOS.delete(clave);
  else INTENTOS.set(clave, intento);
  avisar();
}

export const leerResultadoDeEnvio = (clave: string): ResultadoDeEnvio | null =>
  RESULTADOS.get(clave) ?? null;

/** Guarda la respuesta de un envío que terminó bien, antes de anotar que terminó, para que quien lo esperaba la vea. */
export function guardarResultadoDeEnvio(clave: string, resultado: ResultadoDeEnvio): void {
  RESULTADOS.set(clave, resultado);
  avisar();
}

/**
 * Anota un envío vivo del intento `clave` con ese `id`; devuelve cómo anotar que terminó (con su respuesta final o con un
 * error). Mientras haya uno vivo, el intento no se suelta ni se manda otro: a lo más un envío vivo por intento, aunque la
 * pantalla que lo mandó ya se haya cerrado.
 */
export function registrarEnvioVivo(clave: string, id: string): () => void {
  const porId = ENVIOS_VIVOS.get(clave) ?? new Map<string, number>();
  porId.set(id, (porId.get(id) ?? 0) + 1);
  ENVIOS_VIVOS.set(clave, porId);
  avisar();
  let terminado = false;
  return () => {
    if (terminado) return;
    terminado = true;
    const actual = ENVIOS_VIVOS.get(clave);
    const n = (actual?.get(id) ?? 0) - 1;
    if (n > 0) actual?.set(id, n);
    else {
      actual?.delete(id);
      RETENIDOS.delete(llaveDe(clave, id));
    }
    avisar();
  };
}

/** La persona revisó el comprobante con ese envío aún vivo: el intento se queda hasta que el envío termine. */
export function retenerHastaSuRespuesta(clave: string, id: string): void {
  RETENIDOS.add(llaveDe(clave, id));
  avisar();
}

export const estaRetenido = (clave: string, id: string): boolean =>
  RETENIDOS.has(llaveDe(clave, id)) && hayEnvioVivo(clave, id);

/** ¿Hay un envío vivo del intento `clave` con ese `id`? */
export const hayEnvioVivo = (clave: string, id: string): boolean =>
  (ENVIOS_VIVOS.get(clave)?.get(id) ?? 0) > 0;

/** Se llama al cerrar la sesión («Salir» y «Cambiar usuario»). */
export function olvidarIntentosRecordados(): void {
  INTENTOS.clear();
  ENVIOS_VIVOS.clear();
  RESULTADOS.clear();
  RETENIDOS.clear();
  avisar();
}

/**
 * Al arrancar la app (una carga nueva de la página) no hay envíos vivos de antes: los de otra instancia de la app ya no
 * se siguen. En la práctica el registro nace vacío; esto solo lo asegura cuando la app se vuelve a montar en el mismo
 * contexto (las pruebas, la recarga en caliente).
 */
export function olvidarEnviosVivos(): void {
  ENVIOS_VIVOS.clear();
  avisar();
}
