const ZONA_LIMA = 'America/Lima';
const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatoFechaLima = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_LIMA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Día operativo (AAAA-MM-DD, hora de Lima) al que pertenece un instante: las ventas anteriores a la
 * hora de corte cuentan para el día anterior; a la hora exacta de corte empieza el nuevo día.
 * Perú no tiene horario de verano, así que restar la hora de corte al instante y tomar la fecha
 * calendario de Lima es suficiente.
 */
export function diaOperativo(instante: Date, horaCorte: string): string {
  const coincidencia = FORMATO_HORA.exec(horaCorte);
  if (!coincidencia) {
    throw new RangeError(`Hora de corte inválida: "${horaCorte}" (se espera HH:MM)`);
  }
  if (Number.isNaN(instante.getTime())) {
    throw new RangeError('Instante inválido');
  }
  const minutosCorte = Number(coincidencia[1]) * 60 + Number(coincidencia[2]);
  const desplazado = new Date(instante.getTime() - minutosCorte * 60_000);
  return formatoFechaLima.format(desplazado);
}
