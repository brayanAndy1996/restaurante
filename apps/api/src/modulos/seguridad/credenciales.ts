import { Inject, Injectable } from '@nestjs/common';
import type { LargoPin } from '@restaurante/dominio';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { ENTORNO, type Entorno } from '../../config/entorno';

/**
 * Parámetros de scrypt de las contraseñas (OWASP): N = 2^15, r = 8, p = 1, sal de 16 bytes, clave de 32
 * bytes y `maxmem` de 64 MB (scrypt usa 128 · N · r = 32 MB). Formato guardado:
 * `scrypt$<log2 N>$<r>$<p>$<sal en base64>$<hash en base64>`.
 */
const LOG2_N = 15;
const R = 8;
const P = 1;
const BYTES_SAL = 16;
const BYTES_CLAVE = 32;
const MAXMEM = 64 * 1024 * 1024;

/** Límites de los parámetros que se aceptan al leer un hash guardado (defensa si la fila se manipula). */
const LOG2_N_MAXIMO = 17;
const R_MAXIMO = 16;
const P_MAXIMO = 4;

/** Intentos de generar un PIN que no exista ya en la empresa antes de rendirse. */
const INTENTOS_PIN_UNICO = 20;

function derivar(
  contrasena: string,
  sal: Buffer,
  largo: number,
  opciones: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(contrasena, sal, largo, opciones, (error, clave) =>
      error ? rechazar(error) : resolver(clave),
    );
  });
}

/** Igualdad de dos buffers en tiempo constante; `false` si el largo difiere. */
export function iguales(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Contraseñas, PIN y secretos de las sesiones (RNF-07, criterios 4, 11, 13, 21 y 89). Todo lo
 * confidencial se guarda como huella: contraseñas con scrypt, PIN con HMAC-SHA256 con el secreto del
 * entorno (`PIN_PEPPER`) y secretos de sesión y de equipo con SHA-256 (son aleatorios de 256 bits).
 * Nada de esto se registra ni se devuelve.
 */
@Injectable()
export class Credenciales {
  private readonly pepper: Buffer;
  private hashFalso: Promise<string> | undefined;

  constructor(@Inject(ENTORNO) entorno: Entorno) {
    if (entorno.PIN_PEPPER === undefined) {
      // `crearAplicacion` ya lo exige en producción; esto cubre cualquier otra forma de armar el módulo.
      throw new Error(
        'PIN_PEPPER es obligatoria: sin ella no se puede calcular la huella de los PIN',
      );
    }
    this.pepper = Buffer.from(entorno.PIN_PEPPER, 'base64');
  }

  // ---- Contraseñas -------------------------------------------------------------------------------

  /** Hash scrypt de la contraseña, con una sal nueva. */
  async hashContrasena(contrasena: string): Promise<string> {
    const sal = randomBytes(BYTES_SAL);
    const hash = await derivar(contrasena, sal, BYTES_CLAVE, {
      N: 2 ** LOG2_N,
      r: R,
      p: P,
      maxmem: MAXMEM,
    });
    return ['scrypt', LOG2_N, R, P, sal.toString('base64'), hash.toString('base64')].join('$');
  }

  /**
   * Verifica la contraseña contra el hash guardado, comparando en tiempo constante. Si no hay hash (usuario
   * inexistente o inactivo) calcula igual un scrypt contra un hash fijo, para que la respuesta tarde lo
   * mismo (criterio 11), y devuelve `false`.
   */
  async verificarContrasena(contrasena: string, guardado: string | null): Promise<boolean> {
    const hash = guardado ?? (await this.contrasenaFalsa());
    const partes = hash.split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') {
      await this.verificarContrasenaFalsa(contrasena);
      return false;
    }
    const [, logN, r, p, sal, esperado] = partes as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const parametros = { log2n: Number(logN), r: Number(r), p: Number(p) };
    if (
      !Number.isInteger(parametros.log2n) ||
      !Number.isInteger(parametros.r) ||
      !Number.isInteger(parametros.p) ||
      parametros.log2n < 10 ||
      parametros.log2n > LOG2_N_MAXIMO ||
      parametros.r < 1 ||
      parametros.r > R_MAXIMO ||
      parametros.p < 1 ||
      parametros.p > P_MAXIMO
    ) {
      await this.verificarContrasenaFalsa(contrasena);
      return false;
    }
    const salBytes = Buffer.from(sal, 'base64');
    const esperadoBytes = Buffer.from(esperado, 'base64');
    const calculado = await derivar(contrasena, salBytes, esperadoBytes.length || BYTES_CLAVE, {
      N: 2 ** parametros.log2n,
      r: parametros.r,
      p: parametros.p,
      maxmem: 128 * 2 ** parametros.log2n * parametros.r * 2,
    });
    return iguales(calculado, esperadoBytes) && guardado !== null;
  }

  /** Calcula un scrypt completo contra el hash fijo y descarta el resultado (igualar tiempos). */
  async verificarContrasenaFalsa(contrasena: string): Promise<void> {
    await this.verificarContrasena(contrasena, await this.contrasenaFalsa()).catch(() => undefined);
  }

  /** Hash fijo (de una contraseña aleatoria que nadie conoce) contra el que se compara cuando no hay usuario. */
  private contrasenaFalsa(): Promise<string> {
    this.hashFalso ??= this.hashContrasena(randomBytes(24).toString('base64'));
    return this.hashFalso;
  }

  // ---- PIN ---------------------------------------------------------------------------------------

  /**
   * Huella de un PIN: `HMAC-SHA256(PIN_PEPPER, empresaId + ':' + pin)`. Con solo la base no se pueden
   * probar los PIN: hace falta también el secreto del entorno. Un PIN de 4 y uno de 6 dígitos nunca
   * colisionan (`0123` ≠ `000123`).
   */
  huellaPin(empresaId: string, pin: string): Buffer {
    return createHmac('sha256', this.pepper).update(`${empresaId}:${pin}`).digest();
  }

  /**
   * Genera un PIN de `largo` dígitos con el generador criptográfico, relleno con ceros, cuya huella no
   * existe todavía en la empresa (`existe` consulta la base). Reintenta hasta 20 veces; una carrera entre
   * dos altas simultáneas termina en la restricción de unicidad `(empresa_id, huella_pin)` y quien llama
   * responde 409 (rara).
   */
  async generarPinUnico(
    empresaId: string,
    largo: LargoPin,
    existe: (huella: Buffer) => Promise<boolean>,
  ): Promise<{ pin: string; huella: Buffer }> {
    for (let intento = 0; intento < INTENTOS_PIN_UNICO; intento++) {
      const pin = String(randomInt(0, 10 ** largo)).padStart(largo, '0');
      const huella = this.huellaPin(empresaId, pin);
      if (!(await existe(huella))) return { pin, huella };
    }
    throw new Error('No se pudo generar un PIN que no exista ya en la empresa');
  }

  /** Compara la huella de un PIN con la guardada, en tiempo constante. */
  pinCoincide(empresaId: string, pin: string, huellaGuardada: Buffer): boolean {
    return iguales(this.huellaPin(empresaId, pin), huellaGuardada);
  }

  // ---- Secretos de sesión y de equipo -------------------------------------------------------------

  /** Secreto aleatorio de 32 bytes en base64url (43 caracteres); es la última parte de un token. */
  generarSecreto(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Lo único que se guarda de un secreto: su huella SHA-256 (`bytea`). */
  huellaSecreto(secreto: string): Buffer {
    return createHash('sha256').update(secreto).digest();
  }

  /** Compara el secreto presentado con la huella guardada, en tiempo constante. */
  secretoCoincide(secreto: string, huellaGuardada: Buffer): boolean {
    return iguales(this.huellaSecreto(secreto), huellaGuardada);
  }
}
