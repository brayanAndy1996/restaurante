const formatoHora = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * La hora de un instante en la hora local de Lima, `HH:mm` ("20:15"), como la piden los tickets (historia 004,
 * criterios 118, 124 y 125). Perú no tiene horario de verano.
 */
export function horaLocal(instante: Date): string {
  return formatoHora.format(instante);
}
