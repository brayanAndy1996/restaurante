import { Injectable } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** Ingresos simultáneos que se aceptan para un mismo nombre de usuario (más que los 5 que puede evaluar un bloqueo). */
const MAXIMO_INGRESOS_POR_NOMBRE = 10;
/**
 * Cuánto espera un ingreso su turno detrás de los demás ingresos del mismo nombre. Con 10 como máximo y un
 * ingreso de ~150 ms, la espera normal es de ~1,5 s; pasado esto algo anda mal y se responde 429 de 1 s.
 */
const ESPERA_TURNO_MS = 5_000;

/** Ingresos simultáneos del mismo nombre desde los que se considera una ráfaga (y no un reintento normal). */
const UMBRAL_RAFAGA = 3;
/** Cuánto se recuerda, en milisegundos de reloj real, que un nombre sin cuenta atacado en ráfaga no tiene cuenta. */
const MEMORIA_SIN_CUENTA_MS = 2_000;
const MAXIMO_RECUERDOS = 1_000;

/**
 * Lo que el servidor rechaza al instante cuando hay demasiados ingresos a la vez (por nombre o en todo el
 * proceso): 429 `BLOQUEO_TEMPORAL` con `reintentarEnSegundos` de 1 (el mismo código que ya responde una cuenta
 * bloqueada, así una ráfaga solo ve 401 y 429 sea cual sea el nombre). **No cuenta como fallo.**
 */
export const demasiadosALaVez = () =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    1,
  );

/** Clave de los topes del ingreso con contraseña de un nombre de usuario de empresa (ya normalizado). */
export const claveDeIngresoUsuario = (nombre: string): string => `contrasena:${nombre}`;

/** Clave de los topes del cambio de la propia contraseña (`PUT /sesion/contrasena`), por usuario. */
export const claveDeCambioContrasena = (usuarioId: string): string =>
  `cambio-contrasena:${usuarioId}`;

interface TurnoPorNombre {
  /** Quienes esperan el turno, en orden de llegada. */
  espera: { resolver: () => void; temporizador: NodeJS.Timeout }[];
}

/**
 * Topes de **concurrencia** por nombre para los ingresos con contraseña (criterio 5, RNF-03). Una ráfaga contra
 * un solo nombre no puede dejar sin servicio a las demás empresas: lo que excede el tope se rechaza sin tocar la
 * base ni el pool de hilos, así no hace cola por delante de otros ingresos. El tope global del scrypt (real o
 * falso) y el reparto entre empresas son de `CupoScrypt`.
 *
 * - `entrar`: tope de ingresos en curso por nombre, antes de cualquier consulta. Es holgado respecto de los 5
 *   intentos que puede evaluar una cuenta real (criterio 12, que cuenta la base de forma exacta): solo recorta
 *   las ráfagas.
 * - `conTurno`: los ingresos de un mismo nombre se evalúan **uno detrás de otro** dentro del proceso. Así una
 *   cuenta no ocupa varios cupos del scrypt a la vez ni apila reservas esperando el bloqueo de su fila, y los
 *   intentos de una ráfaga se resuelven en el orden en que llegaron (la base sigue siendo la que cuenta de
 *   forma exacta entre procesos).
 * - Memorias de 2 s (`esSinCuentaReciente`, `bloqueoReciente`): solo se consultan cuando el nombre está en
 *   ráfaga y se olvidan al crear, reactivar o desactivar un usuario o cambiarle la contraseña.
 * - `entrar` y `conTurno` también cubren el cambio de la propia contraseña (clave por usuario), de modo que una
 *   sesión no puede ocupar varios lugares de la cola de scrypt de su empresa.
 *
 * Cuentan lo que está **en curso**, no los intentos: nada dura más que una petición, así que quien escribe mal
 * un nombre una y otra vez, una por una, sigue recibiendo 401. Los topes son por proceso (cada réplica de la
 * API lleva los suyos); el límite por dirección IP es de Cloudflare.
 */
@Injectable()
export class TopeDeIntentos {
  private readonly ingresos = new Map<string, number>();
  private readonly turnos = new Map<string, TurnoPorNombre>();
  private readonly sinCuenta = new Map<string, number>();
  private readonly bloqueados = new Map<string, { hasta: Date; expira: number }>();

  /**
   * Reserva un lugar para un ingreso de `clave` (nombre normalizado con prefijo por tipo de cuenta); 429 si no
   * hay. `enRafaga` dice si ese nombre ya tiene varios ingresos simultáneos (decide si se consultan y se
   * escriben las memorias).
   */
  entrar(clave: string): { soltar: () => void; enRafaga: boolean } {
    const propios = this.ingresos.get(clave) ?? 0;
    if (propios >= MAXIMO_INGRESOS_POR_NOMBRE) throw demasiadosALaVez();
    this.ingresos.set(clave, propios + 1);
    return { soltar: soltarUno(this.ingresos, clave), enRafaga: propios + 1 >= UMBRAL_RAFAGA };
  }

  /**
   * Corre `fn` cuando le toque el turno de `clave`: un ingreso a la vez por nombre, en orden de llegada. Si el
   * turno tarda más de `ESPERA_TURNO_MS`, 429 de 1 s sin haber evaluado nada.
   */
  async conTurno<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    await this.tomarTurno(clave);
    try {
      return await fn();
    } finally {
      this.soltarTurno(clave);
    }
  }

  private tomarTurno(clave: string): Promise<void> {
    const turno = this.turnos.get(clave);
    if (turno === undefined) {
      this.turnos.set(clave, { espera: [] });
      return Promise.resolve();
    }
    return new Promise<void>((resolver, rechazar) => {
      const entrada = {
        resolver,
        temporizador: setTimeout(() => {
          const posicion = turno.espera.indexOf(entrada);
          if (posicion >= 0) turno.espera.splice(posicion, 1);
          rechazar(demasiadosALaVez());
        }, ESPERA_TURNO_MS),
      };
      entrada.temporizador.unref();
      turno.espera.push(entrada);
    });
  }

  private soltarTurno(clave: string): void {
    const turno = this.turnos.get(clave);
    if (turno === undefined) return;
    const siguiente = turno.espera.shift();
    if (siguiente === undefined) {
      this.turnos.delete(clave);
      return;
    }
    clearTimeout(siguiente.temporizador);
    siguiente.resolver(); // el turno pasa a quien sigue sin quedar libre
  }

  /**
   * ¿Se vio hace un instante, en plena ráfaga, que este nombre no tiene cuenta activa? Si sí, quien llama
   * puede pasar directo al scrypt falso sin volver a preguntárselo a la base. Solo se recuerda durante una
   * ráfaga y unos segundos (`recordarSinCuenta`) y quien llama solo la consulta si la petición actual también
   * está en ráfaga: un reintento normal siempre consulta la base.
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

  /**
   * Olvida lo que se recuerda de `clave`: se llama cuando el nombre pasa a tener cuenta activa (usuario creado
   * o reactivado) o cambia su contraseña, para que el siguiente ingreso consulte la base.
   */
  olvidar(clave: string): void {
    this.sinCuenta.delete(clave);
    this.bloqueados.delete(clave);
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
