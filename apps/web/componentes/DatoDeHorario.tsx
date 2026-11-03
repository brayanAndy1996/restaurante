import type { TramoHorario } from '@restaurante/dominio';
import { estadoDeHorario } from '@/lib/horario';
import { Icono } from './Iconos';

/**
 * "Abierto ahora · hasta las 23:00" o "Cerrado ahora · abre a las 12:00" en la cabecera (criterio 81). Sin horario
 * cargado no se dibuja nada. Dice el estado con palabras y un icono, nunca solo con color.
 *
 * Es el valor inicial: lo arma el servidor (la carta se lee sin JavaScript), pero la página puede venir de la caché
 * (ISR y CDN) con la hora de anoche. La isla `Disponibilidad` elige la fila que corresponde a la hora del navegador
 * en la tabla de `tablaDeHorario` y cambia solo este texto y `data-abierto` (`actualizarHorario`).
 */
export function DatoDeHorario({
  horario,
  ahora,
}: {
  horario: readonly TramoHorario[];
  ahora?: Date;
}) {
  const estado = estadoDeHorario(horario, ahora);
  if (!estado) return null;
  return (
    <p className="dato" data-horario="" data-abierto={estado.abierto}>
      <Icono nombre="reloj" />
      <span data-horario-texto="">{estado.texto}</span>
    </p>
  );
}
