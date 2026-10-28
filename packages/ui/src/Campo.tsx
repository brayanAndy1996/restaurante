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

/** Miles con coma ("1,234,567" o "1,234.50"): grupos de exactamente tres cifras y, a lo más, un punto decimal. */
const MILES_CON_COMA = /^\d{1,3}(,\d{3})+(\.\d*)?$/;

/**
 * Limpia lo que se escribe en un campo de monto: solo dígitos y un separador decimal, con la coma del
 * teclado de algunos celulares convertida en punto, hasta 8 enteros y 2 decimales. Es texto, no
 * aritmética: el valor sigue siendo el texto decimal que viaja a la API ("28.5", nunca un número).
 *
 * Al pegar un monto con separador de miles no se cambia su valor en silencio:
 * - "1,234.50" y "1,234,567" (comas en grupos de tres, con punto decimal o con más de una coma) se
 *   leen como miles y las comas se descartan ("1234.50");
 * - si trae coma y punto de otra forma ("1.234,50", "1,2.50"), no se sabe cuál es el decimal: el texto
 *   se deja como llegó (solo dígitos, comas y puntos) y la validación del formulario avisa.
 * Una sola coma ("28,5", "1,234") sigue siendo el decimal del teclado del celular.
 */
export function limpiarMontoEscrito(texto: string): string {
  const crudo = texto.replace(/[^\d.,]/g, '');
  const comas = crudo.split(',').length - 1;
  const conMiles = MILES_CON_COMA.test(crudo) && (crudo.includes('.') || comas > 1);
  if (!conMiles && comas > 0 && crudo.includes('.')) return crudo.slice(0, 24);
  const normalizado = conMiles ? crudo.replace(/,/g, '') : crudo.replace(/,/g, '.');
  const primero = normalizado.indexOf('.');
  if (primero === -1) return normalizado.slice(0, 8);
  const enteros = normalizado.slice(0, primero).slice(0, 8);
  const decimales = normalizado
    .slice(primero + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${enteros}.${decimales}`;
}

/** Completa un monto escrito a 2 decimales ("28" → "28.00", ".5" → "0.50"); si no es un monto, lo deja como está. */
export function completarMontoEscrito(texto: string): string {
  if (!/^\d*\.?\d*$/.test(texto) || texto === '' || texto === '.') return texto;
  const [enteros = '', decimales = ''] = texto.split('.');
  return `${enteros === '' ? '0' : enteros}.${decimales.padEnd(2, '0')}`;
}

export interface PropsCampoMonto
  extends
    PropsMarco,
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'className' | 'id' | 'type' | 'inputMode' | 'value' | 'onChange' | 'onBlur' | 'prefix'
    > {
  id?: string;
  /** Texto decimal tal como se escribe ("28.5"). */
  value: string;
  onValor: (valor: string) => void;
}

/**
 * Campo de monto en soles: `S/` delante, teclado decimal del celular y cifras tabulares. Solo deja
 * escribir dígitos y un separador; al salir completa los 2 decimales. La validación (mayor que 0,
 * obligatorio) es de quien lo usa.
 */
export function CampoMonto({
  etiqueta,
  opcional,
  ayuda,
  error,
  className,
  id,
  value,
  onValor,
  ...resto
}: PropsCampoMonto) {
  const propio = useId();
  const idCampo = id ?? propio;
  return (
    <Marco
      id={idCampo}
      etiqueta={etiqueta}
      opcional={opcional}
      ayuda={ayuda}
      error={error}
      className={clases('ui-campo--monto', className)}
    >
      <span className="ui-campo__prefijo" aria-hidden="true">
        S/
      </span>
      <input
        id={idCampo}
        className="ui-campo__control ui-campo__control--monto"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        value={value}
        onChange={(e) => onValor(limpiarMontoEscrito(e.target.value))}
        onBlur={() => onValor(completarMontoEscrito(value))}
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
  /**
   * Nombre para lectores de pantalla cuando varios interruptores comparten la misma etiqueta visible
   * ("Disponible" en cada sucursal): debe empezar por la etiqueta visible.
   */
  nombreAccesible?: string;
}

/** Interruptor de 52 x 32 px con rol `switch`; el estado se dice también con la posición, no solo con el color. */
export function Interruptor({
  etiqueta,
  ayuda,
  marcado,
  onCambio,
  icono,
  disabled,
  nombreAccesible,
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
          aria-label={nombreAccesible}
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
