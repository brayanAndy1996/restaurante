import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Aviso } from './Aviso';
import { Boton } from './Boton';
import { Icono, IconoReintentar } from './iconos';
import { clases } from './utilidades';

/** Pieza de esqueleto: el brillo se detiene con `prefers-reduced-motion`. */
export function Esqueleto({
  ancho,
  alto,
  className,
}: {
  ancho?: string | number;
  alto?: string | number;
  className?: string;
}) {
  return (
    <span
      className={clases('ui-esqueleto', className)}
      style={{ width: ancho, height: alto }}
      aria-hidden="true"
    />
  );
}

/** Tiempo tras el cual la carga dice que está tardando más de lo normal. */
const MS_CARGA_LENTA = 8000;

/**
 * Carga de una lista: esqueleto con la forma exacta de las filas (inicial y dos líneas), nunca una
 * pantalla en blanco. Pasados 8 segundos dice que sigue intentando.
 */
export function EsqueletoDeLista({
  filas = 4,
  conInicial = true,
  etiqueta = 'Cargando',
}: {
  filas?: number;
  conInicial?: boolean;
  etiqueta?: string;
}) {
  const [lenta, setLenta] = useState(false);
  useEffect(() => {
    const temporizador = setTimeout(() => setLenta(true), MS_CARGA_LENTA);
    return () => clearTimeout(temporizador);
  }, []);
  const anchos = ['60%', '50%', '65%', '45%'];
  return (
    <div role="status" aria-busy="true" aria-label={etiqueta}>
      {Array.from({ length: filas }, (_, i) => (
        <div className="ui-esqueleto-fila" key={i}>
          {conInicial ? <Esqueleto ancho={48} alto={48} /> : null}
          <div className="ui-esqueleto-fila__lineas">
            <Esqueleto alto={16} ancho={anchos[i % anchos.length]} />
            <Esqueleto alto={12} ancho="35%" />
          </div>
        </div>
      ))}
      {lenta ? (
        <p className="ui-campo__ayuda" style={{ padding: '0 var(--espacio-lg)' }}>
          Esto tarda más de lo normal. Seguimos intentando.
        </p>
      ) : null}
    </div>
  );
}

interface PropsVacio {
  icono: LucideIcon;
  titulo: string;
  /** Dice qué falta y cómo crearlo. */
  children: ReactNode;
  accion?: ReactNode;
}

/** Estado vacío: icono de 32 px, una frase que dice qué falta y la acción para crearlo. */
export function EstadoVacio({ icono, titulo, children, accion }: PropsVacio) {
  return (
    <div className="ui-vacio">
      <Icono icono={icono} tamano={32} />
      <b className="ui-vacio__titulo">{titulo}</b>
      <span>{children}</span>
      {accion ? <div className="ui-vacio__accion">{accion}</div> : null}
    </div>
  );
}

interface PropsErrorCarga {
  titulo: string;
  children?: ReactNode;
  onReintentar: () => void;
  reintentando?: boolean;
}

/** Error de carga: aviso rocoto que nombra el problema y "Reintentar" en la misma pantalla. */
export function ErrorDeCarga({ titulo, children, onReintentar, reintentando }: PropsErrorCarga) {
  return (
    <div className="ui-error-carga">
      <Aviso tipo="error" titulo={titulo}>
        {children}
      </Aviso>
      <Boton
        bloque
        icono={IconoReintentar}
        onClick={onReintentar}
        cargando={reintentando}
        textoCargando="Reintentando…"
      >
        Reintentar
      </Boton>
    </div>
  );
}
