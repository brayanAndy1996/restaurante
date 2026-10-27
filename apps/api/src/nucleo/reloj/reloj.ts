/**
 * Reloj de la API: toda regla de tiempo (inactividad, bloqueos, vencimientos, horario, auditoría)
 * toma la hora de aquí, nunca de `new Date()` ni de `now()` de la base. Las pruebas lo reemplazan con
 * `RelojManual` (`crearAplicacion({ reloj })`).
 */

/** Token de Nest del reloj de la aplicación. */
export const RELOJ = Symbol('RELOJ');

export interface Reloj {
  /** Instante actual. Devuelve siempre un `Date` nuevo: quien lo recibe puede modificarlo. */
  ahora(): Date;
}

/** El reloj real: la hora del sistema. */
export class RelojSistema implements Reloj {
  ahora(): Date {
    return new Date();
  }
}

export type InstanteDeReloj = Date | string | number;

function aFecha(instante: InstanteDeReloj): Date {
  const fecha = instante instanceof Date ? new Date(instante.getTime()) : new Date(instante);
  if (Number.isNaN(fecha.getTime())) throw new RangeError('Instante inválido para el reloj manual');
  return fecha;
}

/**
 * Reloj controlado por la prueba: no avanza solo. Empieza en el instante que se le pasa (por defecto,
 * la hora real al crearlo); `fijar` lo pone en otro instante y `avanzar` lo mueve hacia adelante (o
 * hacia atrás con un número negativo).
 */
export class RelojManual implements Reloj {
  private instante: number;

  constructor(inicial: InstanteDeReloj = new Date()) {
    this.instante = aFecha(inicial).getTime();
  }

  ahora(): Date {
    return new Date(this.instante);
  }

  /** Pone el reloj en `instante` (un `Date`, un texto ISO 8601 con zona o milisegundos desde 1970). */
  fijar(instante: InstanteDeReloj): void {
    this.instante = aFecha(instante).getTime();
  }

  /** Mueve el reloj `milisegundos` (por ejemplo `15 * 60 * 1000` para 15 minutos). */
  avanzar(milisegundos: number): void {
    if (!Number.isFinite(milisegundos)) throw new RangeError('Los milisegundos deben ser finitos');
    this.instante += milisegundos;
  }
}
