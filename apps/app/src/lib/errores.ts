import {
  errorRespuestaSchema,
  type CampoError,
  type SeQuita,
  type UsadoEn,
} from '@restaurante/contratos';

/** Códigos que solo existen en el cliente. */
export type CodigoCliente = 'SIN_CONEXION' | 'RESPUESTA_INVALIDA';

/** Error de una llamada a la API: siempre con estado, código y campos, listo para mostrarse. */
export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  readonly campos: CampoError[];
  readonly reintentarEnSegundos: number | undefined;
  /** Solo en `EN_USO` de un cambio de tipo: dónde se usa el producto (003, criterio 10c). */
  readonly usadoEn: UsadoEn | undefined;
  /** Solo en `CONFIRMACION_REQUERIDA`: lo que el cambio de tipo quitaría (003, criterio 10b). */
  readonly seQuita: SeQuita | undefined;
  /** La escritura se reintentó por un corte antes de fallar: pudo haberse aplicado una vez. */
  readonly reintentada: boolean;

  constructor(datos: {
    estado: number;
    codigo: string;
    mensaje: string;
    campos?: CampoError[];
    reintentarEnSegundos?: number;
    usadoEn?: UsadoEn;
    seQuita?: SeQuita;
    reintentada?: boolean;
  }) {
    super(datos.mensaje);
    this.name = 'ErrorApi';
    this.estado = datos.estado;
    this.codigo = datos.codigo;
    this.campos = datos.campos ?? [];
    this.reintentarEnSegundos = datos.reintentarEnSegundos;
    this.usadoEn = datos.usadoEn;
    this.seQuita = datos.seQuita;
    this.reintentada = datos.reintentada ?? false;
  }

  /** `true` si el servidor no llegó a contestar (red caída, tiempo agotado). */
  get sinConexion(): boolean {
    return this.codigo === 'SIN_CONEXION';
  }
}

/** Convierte el cuerpo de un error HTTP en un `ErrorApi`; tolera cuerpos que no son JSON. */
export function errorDeRespuesta(estado: number, cuerpo: unknown, reintentada = false): ErrorApi {
  const analizado = errorRespuestaSchema.safeParse(cuerpo);
  if (analizado.success) {
    const e = analizado.data;
    return new ErrorApi({
      estado,
      codigo: e.codigo,
      mensaje: e.mensaje,
      campos: e.campos ?? [],
      ...(e.reintentarEnSegundos === undefined
        ? {}
        : { reintentarEnSegundos: e.reintentarEnSegundos }),
      ...(e.usadoEn === undefined ? {} : { usadoEn: e.usadoEn }),
      ...(e.seQuita === undefined ? {} : { seQuita: e.seQuita }),
      reintentada,
    });
  }
  return new ErrorApi({
    estado,
    codigo: estado >= 500 ? 'ERROR_INTERNO' : 'PETICION_INVALIDA',
    mensaje: `Respuesta inesperada (${estado})`,
    reintentada,
  });
}

/** "5 minutos", "1 minuto", "40 segundos": lo que falta para poder volver a intentar. */
export function textoDeEspera(segundos: number): string {
  if (segundos < 60) return `${Math.max(1, Math.ceil(segundos))} segundos`;
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
}

/**
 * Mensaje en español, en trato de "tú", que dice el problema y la salida. Nunca muestra códigos HTTP
 * ni jerga. `porCodigo` deja a cada pantalla decir algo más preciso para un código concreto.
 */
export function mensajeDeError(error: unknown, porCodigo: Record<string, string> = {}): string {
  if (!(error instanceof ErrorApi)) {
    return 'Algo salió mal. Inténtalo de nuevo.';
  }
  const propio = porCodigo[error.codigo];
  if (propio) return propio;
  switch (error.codigo) {
    case 'SIN_CONEXION':
      return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    case 'RESPUESTA_INVALIDA':
      return 'Recibimos una respuesta que no entendemos. Actualiza la aplicación e inténtalo de nuevo.';
    case 'CREDENCIALES_INVALIDAS':
      return 'Tu usuario o contraseña no son correctos. Revisa y vuelve a intentar.';
    case 'BLOQUEO_TEMPORAL':
      return error.reintentarEnSegundos === undefined
        ? 'Hiciste demasiados intentos. Espera unos minutos y vuelve a probar.'
        : `Hiciste demasiados intentos. Vuelve a probar en ${textoDeEspera(error.reintentarEnSegundos)}.`;
    case 'FUERA_DE_HORARIO':
      return 'Ahora estás fuera de tu horario de acceso. Pide a tu administrador que lo revise.';
    case 'SESION_EXPIRADA':
      return 'Tu sesión se cerró por inactividad. Vuelve a ingresar.';
    case 'NO_AUTENTICADO':
      return 'Tu sesión ya no es válida. Vuelve a ingresar.';
    case 'CAMBIO_CONTRASENA_REQUERIDO':
      return 'Antes de seguir, cambia tu contraseña temporal.';
    case 'PROHIBIDO':
      return 'No tienes permiso para hacer esto.';
    case 'NO_ENCONTRADO':
      return 'No encontramos lo que buscas. Puede que ya no exista.';
    case 'ULTIMO_ADMINISTRADOR':
      return 'La empresa no puede quedarse sin un administrador activo. Nombra a otro antes de hacer este cambio.';
    case 'SUCURSAL_INVALIDA':
      return 'Una de las sucursales elegidas no es válida. Actualiza la pantalla e inténtalo de nuevo.';
    case 'SUCURSAL_NO_ELEGIDA':
      return 'Elige primero tu sucursal.';
    case 'DATOS_INVALIDOS':
      return 'Revisa los datos marcados e inténtalo de nuevo.';
    case 'DEMASIADAS_PETICIONES':
      return 'Hiciste muchas solicitudes seguidas. Espera un momento e inténtalo de nuevo.';
    case 'EQUIPO_NO_RECONOCIDO':
      return 'Este equipo ya no está registrado. Ingresa con tu usuario y contraseña.';
    case 'PLAN_INVALIDO':
      return 'El plan elegido no existe o está desactivado. Elige otro.';
    case 'CLAVE_IDEMPOTENCIA_REUTILIZADA':
      return 'Esta operación ya se había enviado con otros datos. Vuelve a abrir la pantalla e inténtalo de nuevo.';
    case 'CONFLICTO':
      return 'Esto choca con algo que ya existe. Revisa los datos e inténtalo de nuevo.';
    case 'REFERENCIA_INVALIDA':
      return 'Algo de lo que elegiste ya no existe o está desactivado. Actualiza la pantalla e inténtalo de nuevo.';
    case 'EN_USO':
      return 'Esto se está usando en otro lugar. Quítalo de ahí antes de desactivarlo.';
    case 'CONFIRMACION_REQUERIDA':
      return 'Este cambio necesita tu confirmación antes de aplicarse.';
    case 'FOTO_INVALIDA':
      return 'No pudimos usar esa foto. Elige otra en JPEG, PNG o WebP, de al menos 200 píxeles de lado.';
    case 'CUERPO_DEMASIADO_GRANDE':
      return 'Lo que enviaste pesa demasiado. Elige un archivo más liviano.';
    case 'TIPO_NO_SOPORTADO':
      return 'Ese tipo de archivo no se admite.';
    default:
      return error.estado >= 500
        ? 'Algo falló de nuestro lado. Inténtalo de nuevo en un momento.'
        : 'No pudimos completar la acción. Inténtalo de nuevo.';
  }
}

/** Errores por campo (`DATOS_INVALIDOS`): `campo` usa puntos para anidar (`accesos.0.rol`). */
export function erroresPorCampo(error: unknown): Record<string, string> {
  if (!(error instanceof ErrorApi)) return {};
  const mapa: Record<string, string> = {};
  for (const c of error.campos) mapa[c.campo] = c.mensaje;
  return mapa;
}

/** Mensajes de campo de zod que llegan en inglés: se reemplazan por uno en español que dice qué hacer. */
const PREFIJOS_EN_INGLES =
  /^(Too (small|big)|Invalid|Unrecognized|Expected|Required|String must|Number must)/i;

/**
 * Mensaje de un campo devuelto por la API (`DATOS_INVALIDOS`). Los que ya vienen en español se muestran
 * tal cual; los de las validaciones genéricas (en inglés) se cambian por un texto neutro, porque la
 * pantalla ya valida cada campo con su propio mensaje antes de enviar.
 */
export function mensajeDeCampo(mensaje: string): string {
  return PREFIJOS_EN_INGLES.test(mensaje.trim()) ? 'Revisa este dato' : mensaje;
}
