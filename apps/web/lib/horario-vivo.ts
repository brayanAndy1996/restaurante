/**
 * El estado del horario en el navegador (criterio 81), sin reglas de horario: la página puede llegar del CDN con la
 * hora de anoche, así que el servidor manda una tabla corta de transiciones de las próximas 48 horas
 * (`tablaDeHorario`, en `lib/horario.ts`) y aquí solo se elige la fila que corresponde a la hora de ahora. Este
 * módulo no importa nada de `packages/dominio` para no pesar en la carta (criterio 88).
 */

/** Desde `desde` (epoch en milisegundos) el local está abierto o cerrado y se dice con `texto`. */
export interface FilaDeHorario {
  desde: number;
  abierto: boolean;
  texto: string;
}

export interface TablaDeHorario {
  /** Hasta cuándo (epoch en ms) vale la tabla; después se deja el texto que armó el servidor. */
  hasta: number;
  filas: readonly FilaDeHorario[];
}

/** La última fila con `desde <= ahora`, o `null` si la tabla está vacía, aún no empieza o ya se agotó. */
export function filaVigente(tabla: TablaDeHorario, ahora: number): FilaDeHorario | null {
  if (ahora >= tabla.hasta) return null;
  let vigente: FilaDeHorario | null = null;
  for (const fila of tabla.filas) {
    if (fila.desde <= ahora) vigente = fila;
    else break;
  }
  return vigente;
}

/** Cambia solo el texto y `data-abierto` de lo que el servidor ya pintó (`DatoDeHorario`). */
export function actualizarHorario(
  raiz: ParentNode,
  tabla: TablaDeHorario,
  ahora: number = Date.now(),
): void {
  const fila = filaVigente(tabla, ahora);
  const dato = raiz.querySelector<HTMLElement>('[data-horario]');
  const texto = dato?.querySelector<HTMLElement>('[data-horario-texto]');
  if (!fila || !dato || !texto) return;
  if (texto.textContent !== fila.texto) texto.textContent = fila.texto;
  dato.dataset.abierto = String(fila.abierto);
}
