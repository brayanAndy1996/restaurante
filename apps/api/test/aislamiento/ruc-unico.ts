// spec: 001-base-multitenancy (pruebas protegidas)
//
// Generador de RUC válidos y únicos para las pruebas de integración.
//
// `emisor.ruc` es único en toda la base y los archivos de prueba corren en procesos paralelos contra
// la misma base. El cuerpo de un RUC tiene 8 dígitos libres (1e8 valores por prefijo): sortear cada
// RUC al azar choca por la paradoja del cumpleaños en cuanto hay unos miles de empresas. Por eso
// los cuerpos se reparten por bloques: cada proceso reserva de forma atómica (creando un archivo con
// `wx`) un bloque de 1000 cuerpos consecutivos y los consume en orden. Dos procesos nunca comparten
// bloque, así que no hay colisión posible mientras queden bloques libres (100 000 por base y por
// corrida). Si el sistema de archivos no permite reservar, se sortea el cuerpo en todo el espacio
// y se evitan al menos las repeticiones dentro del proceso.
//
// La reservación es por base de pruebas y por proceso padre del trabajador (la corrida de vitest): la
// base se recrea en cada corrida, así que las reservas de una corrida anterior no importan.
import { randomInt } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validarRuc } from '@restaurante/dominio';

export type PrefijoRuc = '10' | '15' | '16' | '17' | '20';

const FACTORES_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const TAMANO_BLOQUE = 1_000;
const CANTIDAD_BLOQUES = 100_000_000 / TAMANO_BLOQUE;
const RAIZ = join(tmpdir(), 'restaurante-ruc-pruebas');
const EDAD_MAXIMA_MS = 24 * 60 * 60 * 1000;

let bloqueActual = -1;
let usadosEnBloque = TAMANO_BLOQUE;
let reservaDisponible = true;
const sorteados = new Set<number>();

function carpetaDeReservas(): string {
  const base = (process.env.BASE_DE_PRUEBA ?? 'restaurante_test').replace(/[^\w.-]/g, '_');
  return join(RAIZ, `${base}-${process.ppid}`);
}

/** Borra, sin fallar, las carpetas de corridas viejas para que /tmp no acumule reservas. */
function limpiarCarpetasViejas(): void {
  try {
    for (const nombre of readdirSync(RAIZ)) {
      const ruta = join(RAIZ, nombre);
      if (Date.now() - statSync(ruta).mtimeMs > EDAD_MAXIMA_MS) {
        rmSync(ruta, { recursive: true, force: true });
      }
    }
  } catch {
    // Mejor esfuerzo: otro proceso puede estar limpiando lo mismo.
  }
}

/** Reserva un bloque libre creando su archivo de forma atómica; `null` si no se puede reservar. */
function reservarBloque(): number | null {
  try {
    const carpeta = carpetaDeReservas();
    mkdirSync(carpeta, { recursive: true });
    if (bloqueActual === -1) limpiarCarpetasViejas();
    for (let intento = 0; intento < 1_000; intento++) {
      const bloque = randomInt(0, CANTIDAD_BLOQUES);
      try {
        closeSync(openSync(join(carpeta, String(bloque)), 'wx'));
        return bloque;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } catch {
    // Sin sistema de archivos escribible: se cae al sorteo en todo el espacio.
  }
  return null;
}

function siguienteCuerpo(): number {
  if (reservaDisponible) {
    if (usadosEnBloque >= TAMANO_BLOQUE) {
      const bloque = reservarBloque();
      if (bloque === null) reservaDisponible = false;
      else {
        bloqueActual = bloque;
        usadosEnBloque = 0;
      }
    }
    if (reservaDisponible) return bloqueActual * TAMANO_BLOQUE + usadosEnBloque++;
  }
  // Sorteo en todo el espacio de 8 dígitos, sin repetir dentro del proceso.
  for (;;) {
    const cuerpo = randomInt(0, 100_000_000);
    if (!sorteados.has(cuerpo)) {
      sorteados.add(cuerpo);
      return cuerpo;
    }
  }
}

/** RUC válido (prefijo 20 por defecto, dígito verificador calculado), único entre archivos paralelos. */
export function generarRucUnico(prefijo: PrefijoRuc = '20'): string {
  const cuerpo = prefijo + String(siguienteCuerpo()).padStart(8, '0');
  let suma = 0;
  for (let i = 0; i < FACTORES_RUC.length; i++)
    suma += Number(cuerpo[i]) * (FACTORES_RUC[i] as number);
  const resto = 11 - (suma % 11);
  const ruc = cuerpo + String(resto >= 10 ? resto - 10 : resto);
  if (!validarRuc(ruc)) throw new Error(`El ayudante generó un RUC inválido: ${ruc}`);
  return ruc;
}
