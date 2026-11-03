import type { TramoHorario } from '@restaurante/dominio';
import { estadoDeHorario } from '@/lib/horario';
import { Icono } from './Iconos';

/**
 * "Abierto ahora · hasta las 23:00" o "Cerrado ahora · abre a las 12:00" en la cabecera (criterio 81). Sin horario
 * cargado no se dibuja nada. Dice el estado con palabras y un icono, nunca solo con color.
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
    <p className="dato" data-abierto={estado.abierto}>
      <Icono nombre="reloj" />
      {estado.texto}
    </p>
  );
}
