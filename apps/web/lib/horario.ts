import { dentroDeHorario, type TramoHorario } from '@restaurante/dominio';
import type { FilaDeHorario, TablaDeHorario } from './horario-vivo';

/**
 * El horario de la sucursal tal como lo lee el cliente (criterio 81): "Abierto ahora · hasta las 23:00" o "Cerrado
 * ahora · abre a las 12:00". Si está abierto o cerrado lo decide `dentroDeHorario` de `packages/dominio` (la hora de
 * Lima, UTC−5, sin depender de la zona del servidor); aquí solo se averigua hasta cuándo y desde cuándo, para
 * decirlo con palabras.
 */

const MINUTOS_POR_DIA = 24 * 60;
const MINUTOS_POR_SEMANA = 7 * MINUTOS_POR_DIA;
const DESFASE_LIMA_MS = 5 * 60 * 60 * 1000;

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export interface EstadoDeHorario {
  abierto: boolean;
  /** "Abierto ahora · hasta las 23:00", "Cerrado ahora · abre mañana a las 12:00". */
  texto: string;
}

interface Intervalo {
  inicio: number;
  fin: number;
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':');
  return Number(h) * 60 + Number(m);
}

function aHora(minutos: number): string {
  const delDia = ((minutos % MINUTOS_POR_DIA) + MINUTOS_POR_DIA) % MINUTOS_POR_DIA;
  const h = Math.floor(delDia / 60);
  const m = delDia % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutos desde el lunes 00:00 de Lima. */
function minutoDeSemanaEnLima(instante: Date): number {
  const lima = new Date(instante.getTime() - DESFASE_LIMA_MS);
  const dia = (lima.getUTCDay() + 6) % 7;
  return dia * MINUTOS_POR_DIA + lima.getUTCHours() * 60 + lima.getUTCMinutes();
}

/**
 * Los tramos como intervalos sobre la semana circular, repetidos una semana antes y una después para no pensar
 * en el cruce del domingo al lunes. Un tramo con `hasta` menor que `desde` cruza la medianoche.
 */
function intervalosDe(horario: readonly TramoHorario[]): Intervalo[] {
  const base: Intervalo[] = horario.map((tramo) => {
    const inicio = (tramo.dia - 1) * MINUTOS_POR_DIA + aMinutos(tramo.desde);
    const hasta = aMinutos(tramo.hasta);
    const fin =
      (tramo.dia - 1) * MINUTOS_POR_DIA +
      (hasta > aMinutos(tramo.desde) ? hasta : MINUTOS_POR_DIA + hasta);
    return { inicio, fin };
  });
  return [-1, 0, 1].flatMap((semana) =>
    base.map((i) => ({
      inicio: i.inicio + semana * MINUTOS_POR_SEMANA,
      fin: i.fin + semana * MINUTOS_POR_SEMANA,
    })),
  );
}

/** Sin horario cargado no hay nada que decir (`null`). */
export function estadoDeHorario(
  horario: readonly TramoHorario[],
  ahora: Date = new Date(),
): EstadoDeHorario | null {
  if (horario.length === 0) return null;
  const t = minutoDeSemanaEnLima(ahora);
  const intervalos = intervalosDe(horario);

  if (dentroDeHorario([...horario], ahora)) {
    const actual = intervalos.find((i) => i.inicio <= t && t < i.fin);
    if (!actual) return { abierto: true, texto: 'Abierto ahora' };
    // Tramos seguidos (uno termina cuando empieza el otro) se dicen como uno solo.
    let fin = actual.fin;
    for (let vuelta = 0; vuelta < 14; vuelta += 1) {
      const siguiente = intervalos.find((i) => i.inicio === fin);
      if (!siguiente || siguiente.fin <= fin) break;
      fin = siguiente.fin;
    }
    return { abierto: true, texto: `Abierto ahora · hasta las ${aHora(fin)}` };
  }

  const proxima = intervalos
    .filter((i) => i.inicio > t)
    .reduce<Intervalo | null>((a, i) => (a === null || i.inicio < a.inicio ? i : a), null);
  if (!proxima) return { abierto: false, texto: 'Cerrado ahora' };
  const diasDeDiferencia =
    Math.floor(proxima.inicio / MINUTOS_POR_DIA) - Math.floor(t / MINUTOS_POR_DIA);
  const hora = aHora(proxima.inicio);
  const cuando =
    diasDeDiferencia === 0
      ? ''
      : diasDeDiferencia === 1
        ? ' mañana'
        : ` el ${DIAS_LARGOS[Math.floor(proxima.inicio / MINUTOS_POR_DIA) % 7] ?? ''}`;
  return { abierto: false, texto: `Cerrado ahora · abre${cuando} a las ${hora}` };
}

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = MINUTOS_POR_DIA * MS_POR_MINUTO;

/** Medianoche de Lima del día de `instante`, en epoch ms. */
function medianocheDeLima(instante: number): number {
  return Math.floor((instante - DESFASE_LIMA_MS) / MS_POR_DIA) * MS_POR_DIA + DESFASE_LIMA_MS;
}

/**
 * La tabla de transiciones de las próximas `horas` horas para el navegador (`lib/horario-vivo.ts`): la fila de
 * ahora y una por cada cambio de lo que dice `estadoDeHorario` (abre, cierra, o pasa la medianoche de Lima, que
 * cambia "abre mañana" por "abre"). Cada fila usa la misma lógica del servidor, así que el navegador no repite
 * ninguna regla. Sin horario, la tabla va vacía.
 */
export function tablaDeHorario(
  horario: readonly TramoHorario[],
  ahora: Date = new Date(),
  horas = 48,
): TablaDeHorario {
  const inicio = ahora.getTime();
  const hasta = inicio + horas * 60 * MS_POR_MINUTO;
  const primera = estadoDeHorario(horario, ahora);
  if (!primera) return { hasta, filas: [] };

  // Cada candidato es un instante en que algo puede cambiar: la medianoche de Lima y el `desde` y el `hasta` de
  // cada tramo, en cada uno de los días que cubre la tabla. Los que no cambian nada se descartan abajo.
  const candidatos = new Set<number>();
  const hoy = medianocheDeLima(inicio);
  for (let dia = 0; dia <= Math.ceil(horas / 24); dia += 1) {
    const base = hoy + dia * MS_POR_DIA;
    candidatos.add(base);
    for (const tramo of horario) {
      candidatos.add(base + aMinutos(tramo.desde) * MS_POR_MINUTO);
      candidatos.add(base + aMinutos(tramo.hasta) * MS_POR_MINUTO);
    }
  }

  const filas: FilaDeHorario[] = [{ desde: inicio, ...primera }];
  for (const instante of [...candidatos].sort((a, b) => a - b)) {
    if (instante <= inicio || instante >= hasta) continue;
    const estado = estadoDeHorario(horario, new Date(instante));
    const anterior = filas[filas.length - 1]!;
    if (estado && (estado.abierto !== anterior.abierto || estado.texto !== anterior.texto)) {
      filas.push({ desde: instante, ...estado });
    }
  }
  return { hasta, filas };
}

/**
 * El horario de la semana para la vista previa al compartir: "lun a vie 12:00 a 23:00 · sáb y dom 12:00 a 00:00".
 * Junta los días seguidos que tienen el mismo horario. `null` si no hay horario.
 */
export function resumenDeHorario(horario: readonly TramoHorario[]): string | null {
  const porDia = DIAS_CORTOS.map((_, indice) =>
    horario
      .filter((t) => t.dia === indice + 1)
      .sort((a, b) => a.desde.localeCompare(b.desde))
      .map((t) => `${t.desde} a ${t.hasta}`)
      .join(' y '),
  );
  const grupos: { desde: number; hasta: number; horas: string }[] = [];
  porDia.forEach((horas, indice) => {
    if (horas === '') return;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.hasta === indice - 1 && ultimo.horas === horas) ultimo.hasta = indice;
    else grupos.push({ desde: indice, hasta: indice, horas });
  });
  if (grupos.length === 0) return null;
  return grupos
    .map(({ desde, hasta, horas }) => {
      const dias =
        desde === hasta
          ? DIAS_CORTOS[desde]
          : hasta === desde + 1
            ? `${DIAS_CORTOS[desde]} y ${DIAS_CORTOS[hasta]}`
            : `${DIAS_CORTOS[desde]} a ${DIAS_CORTOS[hasta]}`;
      return `${dias} ${horas}`;
    })
    .join(' · ');
}
