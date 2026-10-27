/** Tramo de atención: `dia` 1 = lunes … 7 = domingo (ISO). Si `hasta` < `desde`, cruza la medianoche. */
export interface TramoHorario {
  dia: number;
  desde: string;
  hasta: string;
}

export interface ErrorHorario {
  /** Posición del tramo en la lista (si el error es de un tramo concreto). */
  indice?: number;
  mensaje: string;
}

export type ResultadoValidacion = { valido: true } | { valido: false; errores: ErrorHorario[] };

const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTOS_POR_DIA = 24 * 60;
const MINUTOS_POR_SEMANA = 7 * MINUTOS_POR_DIA;

function aMinutos(hora: string): number | null {
  const coincidencia = FORMATO_HORA.exec(hora);
  if (!coincidencia) return null;
  return Number(coincidencia[1]) * 60 + Number(coincidencia[2]);
}

interface Intervalo {
  indice: number;
  inicio: number;
  fin: number;
}

/** Intervalos [inicio, fin) sobre la semana circular, en minutos desde el lunes 00:00. */
function intervalosSemanales(
  indice: number,
  dia: number,
  desde: number,
  hasta: number,
): Intervalo[] {
  const base = (dia - 1) * MINUTOS_POR_DIA;
  if (hasta > desde) {
    return [{ indice, inicio: base + desde, fin: base + hasta }];
  }
  // Cruza la medianoche: hasta el fin del día y desde el inicio del día siguiente.
  const siguiente = (base + MINUTOS_POR_DIA) % MINUTOS_POR_SEMANA;
  const partes: Intervalo[] = [{ indice, inicio: base + desde, fin: base + MINUTOS_POR_DIA }];
  if (hasta > 0) partes.push({ indice, inicio: siguiente, fin: siguiente + hasta });
  return partes;
}

/**
 * Valida una lista de tramos: día de 1 a 7, horas HH:MM, `desde` distinto de `hasta` y sin
 * solapamientos (un tramo que cruza la medianoche ocupa también el comienzo del día siguiente).
 * Dos tramos contiguos (uno termina cuando empieza el otro) no se solapan. La lista vacía es válida.
 */
export function validarHorario(tramos: TramoHorario[]): ResultadoValidacion {
  const errores: ErrorHorario[] = [];
  const intervalos: Intervalo[] = [];

  tramos.forEach((tramo, indice) => {
    let valido = true;
    if (!Number.isInteger(tramo.dia) || tramo.dia < 1 || tramo.dia > 7) {
      errores.push({ indice, mensaje: 'El día debe ser un entero de 1 (lunes) a 7 (domingo)' });
      valido = false;
    }
    const desde = aMinutos(tramo.desde);
    const hasta = aMinutos(tramo.hasta);
    if (desde === null) {
      errores.push({ indice, mensaje: 'La hora "desde" debe tener formato HH:MM' });
      valido = false;
    }
    if (hasta === null) {
      errores.push({ indice, mensaje: 'La hora "hasta" debe tener formato HH:MM' });
      valido = false;
    }
    if (desde !== null && hasta !== null && desde === hasta) {
      errores.push({ indice, mensaje: 'La hora "desde" no puede ser igual a "hasta"' });
      valido = false;
    }
    if (valido && desde !== null && hasta !== null) {
      intervalos.push(...intervalosSemanales(indice, tramo.dia, desde, hasta));
    }
  });

  const solapados = new Set<string>();
  for (let i = 0; i < intervalos.length; i++) {
    for (let j = i + 1; j < intervalos.length; j++) {
      const a = intervalos[i] as Intervalo;
      const b = intervalos[j] as Intervalo;
      if (a.indice === b.indice) continue;
      if (a.inicio < b.fin && b.inicio < a.fin) {
        const clave = `${Math.min(a.indice, b.indice)}-${Math.max(a.indice, b.indice)}`;
        if (!solapados.has(clave)) {
          solapados.add(clave);
          errores.push({
            indice: Math.max(a.indice, b.indice),
            mensaje: `El tramo se solapa con el tramo ${Math.min(a.indice, b.indice)}`,
          });
        }
      }
    }
  }

  return errores.length === 0 ? { valido: true } : { valido: false, errores };
}
