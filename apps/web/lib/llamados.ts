import type {
  EstadoLlamadoPublico,
  LlamadoEntrada,
  LlamadoPublico,
  MesaPublica,
} from '@restaurante/contratos';
import type { EstadoLlamado } from '@restaurante/dominio';
import { ErrorApi, pedirApi, rutaMesa, urlApiPublica } from './api';
import type { NombreDeIcono } from '@/componentes/Iconos';

/**
 * Llamadas del modo mesa a la API pública, desde el navegador (criterios 25, 26 y 38), y lo que se le dice al
 * cliente en cada caso (criterio 86 y 87). Sin `zod`: el navegador solo comprueba la forma de lo que usa.
 */

/** Cada cuánto se consulta el estado de un llamado pendiente (decisión de 005). */
export const INTERVALO_ESTADO_MS = 10_000;

/** Espera entre reintentos de un envío sin red (plan: 1, 2, 5 y 10 segundos, y de ahí en adelante 10). */
export const ESPERAS_REINTENTO_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** Veces que se reintenta un 5xx antes de pararse y dejar que el cliente pulse otra vez. */
export const REINTENTOS_DE_SERVIDOR = 3;

/**
 * Un error que no es final: el 5xx del servidor y el 409 `CONFLICTO` (criterio 29: dos peticiones del mismo `id` a la
 * vez; la segunda, repetida, responde 201). Se reintenta con el mismo `id`. Un 409 `LLAMADO_PENDIENTE` o
 * `FUERA_DE_HORARIO` sí es final: repetirlo no cambia la respuesta.
 */
export function esReintentable(error: ErrorApi): boolean {
  return error.estado >= 500 || (error.estado === 409 && error.codigo === 'CONFLICTO');
}

const objeto = (dato: unknown): dato is Record<string, unknown> =>
  typeof dato === 'object' && dato !== null;

async function cuerpoJson(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorApi(502, 'Respuesta ilegible');
  }
}

/** `POST /publico/mesas/:código/llamados`. El mismo `id` repite el envío sin duplicar el llamado (criterio 29). */
export async function enviarLlamado(
  codigo: string,
  cuerpo: LlamadoEntrada,
): Promise<LlamadoPublico> {
  const respuesta = await pedirApi(urlApiPublica(), `${rutaMesa(codigo)}/llamados`, {
    method: 'POST',
    json: cuerpo,
    credentials: 'omit',
  });
  const dato = await cuerpoJson(respuesta);
  if (!objeto(dato) || typeof dato.id !== 'string' || typeof dato.venceEn !== 'string') {
    throw new ErrorApi(502, 'Respuesta ilegible');
  }
  return dato as unknown as LlamadoPublico;
}

/** `GET /publico/mesas/:código/llamados/:id` (criterio 38). */
export async function consultarEstado(
  codigo: string,
  id: string,
  señal?: AbortSignal,
): Promise<EstadoLlamadoPublico> {
  const respuesta = await pedirApi(
    urlApiPublica(),
    `${rutaMesa(codigo)}/llamados/${encodeURIComponent(id)}`,
    { credentials: 'omit', cache: 'no-store', signal: señal },
  );
  const dato = await cuerpoJson(respuesta);
  if (!objeto(dato) || typeof dato.estado !== 'string' || typeof dato.venceEn !== 'string') {
    throw new ErrorApi(502, 'Respuesta ilegible');
  }
  return dato as unknown as EstadoLlamadoPublico;
}

/** `GET /publico/mesas/:código` (criterio 25): si la mesa acepta llamados y si ya hay uno pendiente. */
export async function consultarMesa(codigo: string, señal?: AbortSignal): Promise<MesaPublica> {
  const respuesta = await pedirApi(urlApiPublica(), rutaMesa(codigo), {
    credentials: 'omit',
    cache: 'no-store',
    signal: señal,
  });
  const dato = await cuerpoJson(respuesta);
  if (!objeto(dato) || typeof dato.aceptaLlamados !== 'boolean') {
    throw new ErrorApi(502, 'Respuesta ilegible');
  }
  const pendiente = dato.llamadoPendiente;
  if (
    pendiente !== null &&
    !(
      objeto(pendiente) &&
      typeof pendiente.tipo === 'string' &&
      typeof pendiente.venceEn === 'string'
    )
  ) {
    throw new ErrorApi(502, 'Respuesta ilegible');
  }
  return dato as unknown as MesaPublica;
}

// ---------------------------------------------------------------------------------------------------
// Lo que se le dice al cliente
// ---------------------------------------------------------------------------------------------------

export type TonoDeAviso = 'info' | 'exito' | 'aviso' | 'error';

/** Un aviso del modo mesa: el problema o el estado en palabras, con su icono (nunca un código). */
export interface AvisoDeMesa {
  tono: TonoDeAviso;
  icono: NombreDeIcono;
  titulo: string;
  texto?: string;
  /** `alert` para los errores de un envío; `status` para el resto. */
  rol: 'alert' | 'status';
}

export const AVISO_SIN_CONEXION: AvisoDeMesa = {
  tono: 'aviso',
  icono: 'sin-red',
  titulo: 'Sin conexión',
  texto: 'Lo enviaremos cuando vuelva. No cierres esta página.',
  rol: 'status',
};

export const AVISO_LOCAL_CERRADO: AvisoDeMesa = {
  tono: 'aviso',
  icono: 'reloj',
  titulo: 'El local está cerrado ahora',
  texto: 'Por ahora no recibimos pedidos desde la mesa. Habla con el mozo.',
  rol: 'alert',
};

export const AVISO_YA_AVISAMOS: AvisoDeMesa = {
  tono: 'info',
  icono: 'campana',
  titulo: 'Ya avisamos al mozo',
  texto: 'En cuanto te atienda podrás enviar otro pedido o volver a llamarlo.',
  rol: 'alert',
};

/** "Espera 2 minutos": los segundos que dio la API, dichos como una persona. */
export function esperaEnPalabras(segundos: number | null): string {
  if (segundos === null || segundos <= 0) return 'un momento';
  if (segundos < 60) return `${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}`;
  const minutos = Math.ceil(segundos / 60);
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}

/** Las líneas que rechazó un 422: posición (`lineas.<i>`) y motivo en palabras. */
export function rechazosDeLineas(
  cuerpo: unknown,
  nombreDeOpcion: (id: string) => string | undefined,
): Map<number, string> {
  const rechazos = new Map<number, string>();
  const campos = objeto(cuerpo) && Array.isArray(cuerpo.campos) ? cuerpo.campos : [];
  for (const campo of campos) {
    if (!objeto(campo) || typeof campo.campo !== 'string' || typeof campo.mensaje !== 'string')
      continue;
    const posicion = /^lineas\.(\d+)$/.exec(campo.campo)?.[1];
    if (posicion === undefined) continue;
    rechazos.set(Number(posicion), motivoDeLinea(campo.mensaje, nombreDeOpcion));
  }
  return rechazos;
}

// Pendiente (M5, revisión de 5b): esto lee el texto del campo `mensaje` de la API, que no es un contrato estable;
// ver «Avisos y estados del llamado» en `DESIGN.md`. No se cambia hasta que la API dé un código por línea.
function motivoDeLinea(
  mensaje: string,
  nombreDeOpcion: (id: string) => string | undefined,
): string {
  if (/AGOTADO|COMPONENTE_NO_DISPONIBLE|OPCIONES_INSUFICIENTES/.test(mensaje)) return 'Se agotó';
  const opcion = /MODIFICADOR_NO_DISPONIBLE: ([0-9a-f-]{36})/i.exec(mensaje)?.[1];
  if (opcion !== undefined) {
    const nombre = nombreDeOpcion(opcion);
    return nombre === undefined
      ? 'Una opción ya no está disponible'
      : `${nombre} ya no está disponible`;
  }
  if (/MENOS_DEL_MINIMO|MAS_DEL_MAXIMO|MODIFICADOR_/.test(mensaje)) {
    return 'Cambiaron las opciones de este plato. Edítalo';
  }
  return 'Ya no se vende';
}

/**
 * El error de un envío dicho en palabras (criterios 85 a 87). `rechazadas` es `true` si el 422 señaló líneas del
 * pedido, que quedan marcadas.
 */
export function avisoDeError(error: ErrorApi, rechazadas = false): AvisoDeMesa {
  const e = (titulo: string, texto: string): AvisoDeMesa => ({
    tono: 'error',
    icono: 'alerta',
    titulo,
    texto,
    rol: 'alert',
  });
  switch (error.codigo) {
    case 'FUERA_DE_HORARIO':
      return AVISO_LOCAL_CERRADO;
    case 'LLAMADO_PENDIENTE':
      return AVISO_YA_AVISAMOS;
    case 'DEMASIADOS_LLAMADOS':
      return {
        tono: 'aviso',
        icono: 'reloj',
        titulo: 'Enviaste varios avisos seguidos',
        texto: `Espera ${esperaEnPalabras(error.reintentarEnSegundos)} para volver a enviar, o habla con el mozo.`,
        rol: 'alert',
      };
    case 'MONTO_FUERA_DE_RANGO':
      return e('Tu pedido es demasiado grande', 'Quita algo del pedido o habla con el mozo.');
    case 'CONFLICTO':
      return e(
        'No pudimos enviar tu pedido',
        'Inténtalo otra vez en un momento. Si sigue igual, habla con el mozo.',
      );
  }
  if (error.estado === 422 && rechazadas) {
    return e('No pudimos enviar tu pedido', 'Quita lo que está marcado y envíalo otra vez.');
  }
  if (error.estado === 404) {
    return e(
      'Esta mesa ya no está disponible',
      'Escanea otra vez el código QR de tu mesa o habla con el mozo.',
    );
  }
  if (error.estado >= 500) {
    return e(
      'No pudimos enviar tu pedido',
      'Inténtalo otra vez en un momento. Si sigue igual, habla con el mozo.',
    );
  }
  return e('No pudimos enviar tu pedido', 'Habla con el mozo.');
}

/** El estado del llamado dicho con palabras (criterio 86). `final` lleva el botón "Entendido". */
export function avisoDeEstado(estado: EstadoLlamado): (AvisoDeMesa & { final: boolean }) | null {
  switch (estado) {
    case 'PENDIENTE':
      return {
        tono: 'info',
        icono: 'campana',
        titulo: 'Avisamos al mozo',
        texto: 'Puedes seguir viendo la carta.',
        rol: 'status',
        final: false,
      };
    case 'ATENDIDO':
      return {
        tono: 'exito',
        icono: 'check',
        titulo: 'El mozo viene a tu mesa',
        rol: 'status',
        final: true,
      };
    case 'PASADO_A_CUENTA':
      return {
        tono: 'exito',
        icono: 'check',
        titulo: 'El mozo tomó tu pedido',
        rol: 'status',
        final: true,
      };
    case 'DESCARTADO':
      return {
        tono: 'error',
        icono: 'alerta',
        titulo: 'No pudimos atender este pedido',
        texto: 'Habla con el mozo.',
        rol: 'status',
        final: true,
      };
    case 'VENCIDO':
      return {
        tono: 'aviso',
        icono: 'reloj',
        titulo: 'Nadie respondió a tiempo',
        texto: 'Llama al mozo o vuelve a enviarlo.',
        rol: 'status',
        final: true,
      };
    default:
      // Un estado que esta versión no conoce: no se dice nada que no se sepa.
      return null;
  }
}
