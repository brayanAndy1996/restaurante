import type { LucideIcon } from 'lucide-react';
import { Icono, IconoCandado, IconoDerecha, IconoOk } from './iconos';
import { clases } from './utilidades';

/** Letra inicial del nombre dentro de una baldosa de 48 px (40 px si es chica). */
export function Inicial({
  nombre,
  chica,
  apagada,
}: {
  nombre: string;
  chica?: boolean;
  apagada?: boolean;
}) {
  const letra = Array.from(nombre.trim())[0]?.toLocaleUpperCase('es-PE') ?? '?';
  return (
    <span
      className={clases(
        'ui-inicial',
        chica && 'ui-inicial--chica',
        apagada && 'ui-inicial--apagada',
      )}
      aria-hidden="true"
    >
      {letra}
    </span>
  );
}

interface PropsPersona {
  nombre: string;
  detalle: string;
  /** Bloqueada: relleno apagado, candado y el detalle en rocoto ("Bloqueado: vuelve en 4:32"). */
  bloqueada?: boolean;
  onElegir?: () => void;
  icono?: LucideIcon;
}

/** Fila de 72 px para elegir a una persona: inicial, nombre, detalle y flecha. */
export function BaldosaPersona({ nombre, detalle, bloqueada, onElegir, icono }: PropsPersona) {
  return (
    <button
      type="button"
      className={clases('ui-persona', bloqueada && 'ui-persona--bloqueada')}
      onClick={onElegir}
      disabled={bloqueada}
    >
      <Inicial nombre={nombre} apagada={bloqueada} />
      <span className="ui-persona__texto">
        <span className="ui-persona__nombre">{nombre}</span>
        <span className="ui-persona__detalle">{detalle}</span>
      </span>
      <Icono icono={bloqueada ? IconoCandado : (icono ?? IconoDerecha)} />
    </button>
  );
}

interface PropsCupos {
  usados: number;
  maximo: number;
}

/** Cinco baldosas pequeñas, las llenas en cobalto: "Este celular recuerda a 3 de 5 personas". */
export function CuposDelEquipo({ usados, maximo }: PropsCupos) {
  return (
    <div className="ui-cupos">
      <span className="ui-cupos__baldosas" aria-hidden="true">
        {Array.from({ length: maximo }, (_, i) => (
          <i
            key={i}
            className={clases('ui-cupos__baldosa', i < usados && 'ui-cupos__baldosa--llena')}
          />
        ))}
      </span>
      <span>{`Este celular recuerda a ${usados} de ${maximo} personas.`}</span>
    </div>
  );
}

interface PropsOpcion {
  titulo: string;
  detalle?: string;
  /** La opción elegida ahora: lleva una marca y se anuncia como actual. */
  activa?: boolean;
  disabled?: boolean;
  onElegir: () => void;
}

/** Baldosa de 72 px para elegir entre opciones sin persona (por ejemplo, una sucursal). */
export function BaldosaDeOpcion({ titulo, detalle, activa, disabled, onElegir }: PropsOpcion) {
  return (
    <button
      type="button"
      className="ui-persona"
      aria-current={activa ? 'true' : undefined}
      disabled={disabled}
      onClick={onElegir}
    >
      <span className="ui-persona__texto">
        <span className="ui-persona__nombre">{titulo}</span>
        {detalle ? <span className="ui-persona__detalle">{detalle}</span> : null}
      </span>
      <Icono icono={activa ? IconoOk : IconoDerecha} />
    </button>
  );
}
