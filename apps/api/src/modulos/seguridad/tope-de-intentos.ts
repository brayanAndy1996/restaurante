import { Injectable } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** Ingresos simultáneos que se aceptan para un mismo nombre de usuario (más que los 5 que puede evaluar un bloqueo). */
const MAXIMO_INGRESOS_POR_NOMBRE = 10;
/** Evaluaciones falsas simultáneas que se aceptan para un mismo nombre sin cuenta activa. */
const MAXIMO_FALSAS_POR_NOMBRE = 1;
/**
 * Evaluaciones falsas simultáneas en todo el proceso. El pool de hilos de libuv tiene 4 y un scrypt tarda
 * ~100 ms: con 2, las falsas ocupan como mucho la mitad de los hilos y los ingresos reales de otras
 * empresas siempre encuentran hilo libre.
 */
const MAXIMO_FALSAS_TOTAL = 2;

/** Ingresos simultáneos del mismo nombre desde los que se considera una ráfaga (y no un reintento normal). */
const UMBRAL_RAFAGA = 3;
/** Cuánto se recuerda, en milisegundos de reloj real, que un nombre sin cuenta atacado en ráfaga no tiene cuenta. */
const MEMORIA_SIN_CUENTA_MS = 2_000;
const MAXIMO_RECUERDOS = 1_000;

/**
 * Lo que el servidor rechaza al instante cuando un mismo nombre recibe demasiados ingresos a la vez:
 * 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos` de 1 (el mismo código que ya responde una cuenta
 * bloqueada, así una ráfaga solo ve 401 y 429 sea cual sea el nombre).
 */
const demasiadosALaVez = () =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    1,
  );

/**
 * Topes de **concurrencia** para los ingresos con contraseña (criterio 5, RNF-03). Una ráfaga contra un solo
 * nombre no puede dejar sin servicio a las demás empresas: lo que excede el tope se rechaza sin tocar la base
 * ni el pool de hilos, así no hace cola por delante de otros ingresos.
 *
 * - `entrar`: tope de ingresos en curso por nombre, antes de cualquier consulta. Es holgado respecto de los 5
 *   intentos que puede evaluar una cuenta real (criterio 12, que cuenta la base de forma exacta): solo recorta
 *   las ráfagas.
 * - `conTopeFalso`: tope del scrypt que se gasta con un nombre **sin cuenta activa** (inexistente o inactivo)
 *   para igualar tiempos (criterio 11). Ese nombre no tiene fila donde contar y no se bloquea nunca, así que
 *   sin tope una ráfaga pondría cientos de scrypt en la cola del pool de hilos del proceso.
 *
 * Cuentan lo que está **en curso**, no los intentos: nada dura más que una petición, así que quien escribe mal
 * un nombre una y otra vez, una por una, sigue recibiendo 401. Los topes son por proceso (cada réplica de la
 * API lleva los suyos); el límite por dirección IP es de Cloudflare.
 */
@Injectable()
export class TopeDeIntentos {
  private readonly ingresos = new Map<string, number>();
  private readonly falsas = new Map<string, number>();
  private totalFalsas = 0;
  private readonly sinCuenta = new Map<string, number>();
  private readonly bloqueados = new Map<string, { hasta: Date; expira: number }>();

  /**
   * Reserva un lugar para un ingreso de `clave` (nombre normalizado con prefijo por tipo de cuenta); 429 si no
   * hay. `enRafaga` dice si ese nombre ya tiene varios ingresos simultáneos (lo usa `recordarSinCuenta`).
   */
  entrar(clave: string): { soltar: () => void; enRafaga: boolean } {
    const propios = this.ingresos.get(clave) ?? 0;
    if (propios >= MAXIMO_INGRESOS_POR_NOMBRE) throw demasiadosALaVez();
    this.ingresos.set(clave, propios + 1);
    return { soltar: soltarUno(this.ingresos, clave), enRafaga: propios + 1 >= UMBRAL_RAFAGA };
  }

  /**
   * ¿Se vio hace un instante, en plena ráfaga, que este nombre no tiene cuenta activa? Si sí, quien llama
   * puede pasar directo al scrypt falso sin volver a preguntárselo a la base. Solo se recuerda durante una
   * ráfaga y unos segundos (`recordarSinCuenta`): un reintento normal siempre consulta la base.
   */
  esSinCuentaReciente(clave: string): boolean {
    const expira = this.sinCuenta.get(clave);
    if (expira === undefined) return false;
    if (expira > Date.now()) return true;
    this.sinCuenta.delete(clave);
    return false;
  }

  /** Recuerda unos segundos que `clave` no tiene cuenta activa; solo se llama si el nombre está en ráfaga. */
  recordarSinCuenta(clave: string): void {
    recordar(this.sinCuenta, clave, Date.now() + MEMORIA_SIN_CUENTA_MS);
  }

  /**
   * Fin del bloqueo que se vio hace un instante, en plena ráfaga, para esta cuenta; `null` si no se recuerda
   * ninguno vigente a la hora `ahora` (reloj de la API). El bloqueo de contraseña solo termina al vencer:
   * ningún éxito lo levanta, así que repetirlo sin preguntar a la base no cambia ninguna respuesta.
   */
  bloqueoReciente(clave: string, ahora: Date): Date | null {
    const recuerdo = this.bloqueados.get(clave);
    if (recuerdo === undefined) return null;
    if (recuerdo.expira <= Date.now()) {
      this.bloqueados.delete(clave);
      return null;
    }
    return recuerdo.hasta.getTime() > ahora.getTime() ? recuerdo.hasta : null;
  }

  /** Recuerda unos segundos el bloqueo vigente de `clave`; solo se llama si el nombre está en ráfaga. */
  recordarBloqueo(clave: string, hasta: Date): void {
    recordar(this.bloqueados, clave, { hasta, expira: Date.now() + MEMORIA_SIN_CUENTA_MS });
  }

  /** Corre `evaluar` (el scrypt falso) si hay lugar; si no, 429 al instante sin evaluar. */
  async conTopeFalso(clave: string, evaluar: () => Promise<void>): Promise<void> {
    const propias = this.falsas.get(clave) ?? 0;
    if (propias >= MAXIMO_FALSAS_POR_NOMBRE || this.totalFalsas >= MAXIMO_FALSAS_TOTAL) {
      throw demasiadosALaVez();
    }
    this.falsas.set(clave, propias + 1);
    this.totalFalsas += 1;
    try {
      await evaluar();
    } finally {
      this.totalFalsas -= 1;
      soltarUno(this.falsas, clave)();
    }
  }
}

/** Guarda en un mapa acotado: se reinserta al final (el orden del mapa es el de uso) y se olvida el más antiguo. */
function recordar<V>(mapa: Map<string, V>, clave: string, valor: V): void {
  mapa.delete(clave);
  mapa.set(clave, valor);
  if (mapa.size > MAXIMO_RECUERDOS) {
    const masAntigua = mapa.keys().next().value;
    if (masAntigua !== undefined) mapa.delete(masAntigua);
  }
}

function soltarUno(contadores: Map<string, number>, clave: string): () => void {
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    const quedan = (contadores.get(clave) ?? 1) - 1;
    if (quedan <= 0) contadores.delete(clave);
    else contadores.set(clave, quedan);
  };
}
