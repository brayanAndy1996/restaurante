import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icono, IconoAbajo, IconoAlerta, IconoOjo, IconoOjoCerrado } from './iconos';
import { BotonIcono } from './Boton';
import { clases } from './utilidades';

interface PropsMarco {
  etiqueta: string;
  /** Se escribe "(opcional)" junto a la etiqueta. */
  opcional?: boolean;
  ayuda?: ReactNode;
  /** Mensaje de error del campo: problema y salida ("Escribe tu usuario"). */
  error?: string | undefined;
  className?: string;
}

interface MarcoInterno extends PropsMarco {
  id: string;
  children: ReactNode;
  derecha?: ReactNode;
  seleccion?: boolean;
}

function Marco({
  id,
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  children,
  derecha,
  seleccion,
}: MarcoInterno) {
  return (
    <div className={clases('ui-campo', error && 'ui-campo--error', className)}>
      <label className="ui-campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {opcional ? <span className="ui-campo__opcional"> (opcional)</span> : null}
      </label>
      <div className={clases('ui-campo__entrada', seleccion && 'ui-campo__entrada--seleccion')}>
        {children}
        {derecha}
      </div>
      {ayuda ? (
        <div className="ui-campo__ayuda" id={`${id}-ayuda`}>
          {ayuda}
        </div>
      ) : null}
      {error ? (
        <div className="ui-campo__mensaje" id={`${id}-error`} role="alert">
          <Icono icono={IconoAlerta} tamano={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

function descritoPor(id: string, ayuda: ReactNode, error: string | undefined): string | undefined {
  const ids = [ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface PropsCampoTexto
  extends PropsMarco, Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  id?: string;
}

/** Campo de texto de 52 px con la etiqueta siempre visible arriba (nunca solo el marcador). */
export function CampoTexto({
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  id,
  ...resto
}: PropsCampoTexto) {
  const propio = useId();
  const idCampo = id ?? propio;
  return (
    <Marco
      id={idCampo}
      etiqueta={etiqueta}
      opcional={opcional}
      ayuda={ayuda}
      error={error}
      className={className}
    >
      <input
        id={idCampo}
        className="ui-campo__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor(idCampo, ayuda, error)}
        {...resto}
      />
    </Marco>
  );
}

export interface PropsCampoContrasena extends Omit<PropsCampoTexto, 'type'> {
  /** `current-password` para ingresar, `new-password` para elegir una nueva. */
  autoComplete: 'current-password' | 'new-password';
}

/** Campo de contraseña con botón de ojo de 48 px; `autocomplete` correcto para los administradores de contraseñas. */
export function CampoContrasena({
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  id,
  ...resto
}: PropsCampoContrasena) {
  const propio = useId();
  const idCampo = id ?? propio;
  const [visible, setVisible] = useState(false);
  return (
    <Marco
      id={idCampo}
      etiqueta={etiqueta}
      opcional={opcional}
      ayuda={ayuda}
      error={error}
      className={className}
      derecha={
        <BotonIcono
          icono={visible ? IconoOjoCerrado : IconoOjo}
          etiqueta={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        />
      }
    >
      <input
        id={idCampo}
        className="ui-campo__control"
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor(idCampo, ayuda, error)}
        {...resto}
      />
    </Marco>
  );
}

export interface PropsCampoSeleccion
  extends PropsMarco, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'> {
  id?: string;
}

/** Selector nativo (el del sistema es el más cómodo con el pulgar). */
export function CampoSeleccion({
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  id,
  children,
  ...resto
}: PropsCampoSeleccion) {
  const propio = useId();
  const idCampo = id ?? propio;
  return (
    <Marco
      id={idCampo}
      etiqueta={etiqueta}
      opcional={opcional}
      ayuda={ayuda}
      error={error}
      className={className}
      seleccion
      derecha={<Icono icono={IconoAbajo} tamano={20} />}
    >
      <select
        id={idCampo}
        className="ui-campo__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor(idCampo, ayuda, error)}
        {...resto}
      >
        {children}
      </select>
    </Marco>
  );
}

export interface PropsCampoAreaTexto
  extends PropsMarco, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'> {
  id?: string;
}

export function CampoAreaTexto({
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  id,
  ...resto
}: PropsCampoAreaTexto) {
  const propio = useId();
  const idCampo = id ?? propio;
  return (
    <Marco
      id={idCampo}
      etiqueta={etiqueta}
      opcional={opcional}
      ayuda={ayuda}
      error={error}
      className={className}
    >
      <textarea
        id={idCampo}
        className="ui-campo__control"
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor(idCampo, ayuda, error)}
        {...resto}
      />
    </Marco>
  );
}

interface PropsInterruptor {
  etiqueta: string;
  ayuda?: ReactNode;
  marcado: boolean;
  onCambio: (marcado: boolean) => void;
  icono?: ReactNode;
  disabled?: boolean;
}

/** Interruptor de 52 x 32 px con rol `switch`; el estado se dice también con la posición, no solo con el color. */
export function Interruptor({
  etiqueta,
  ayuda,
  marcado,
  onCambio,
  icono,
  disabled,
}: PropsInterruptor) {
  const id = useId();
  return (
    <div>
      <div className="ui-interruptor">
        {icono}
        <label className="ui-interruptor__texto" htmlFor={id}>
          {etiqueta}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={marcado}
          aria-describedby={ayuda ? `${id}-ayuda` : undefined}
          className="ui-interruptor__pista"
          disabled={disabled}
          onClick={() => onCambio(!marcado)}
        >
          <span className="ui-interruptor__riel" aria-hidden="true" />
        </button>
      </div>
      {ayuda ? (
        <div className="ui-campo__ayuda" id={`${id}-ayuda`}>
          {ayuda}
        </div>
      ) : null}
    </div>
  );
}
