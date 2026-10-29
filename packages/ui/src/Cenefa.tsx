import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icono } from './iconos';
import { clases } from './utilidades';

/** Situaciones de la cenefa, de más a menos prioritaria: sin conexión, soporte, suspendida, gracia, normal. */
export type EstadoCenefa =
  'normal' | 'sin-conexion' | 'soporte' | 'suspendida' | 'gracia' | 'plataforma';

const CLASE: Record<EstadoCenefa, string> = {
  normal: '',
  'sin-conexion': 'ui-cenefa--aji',
  gracia: 'ui-cenefa--aji',
  suspendida: 'ui-cenefa--rocoto',
  soporte: 'ui-cenefa--soporte',
  plataforma: 'ui-cenefa--plataforma',
};

/**
 * Banda de 8 px en lo más alto, hecha con módulos de 14 px separados por una junta de 2 px. Su color
 * dice la situación; al cambiar, la banda nueva se llena módulo a módulo de izquierda a derecha en
 * 240 ms (sin movimiento con `prefers-reduced-motion`). Siempre va acompañada de un banner con palabras.
 */
export function Cenefa({ estado }: { estado: EstadoCenefa }) {
  // Se guarda el estado anterior para pintar la banda vieja debajo mientras la nueva se llena.
  const [vista, setVista] = useState({ actual: estado, previo: estado });
  if (vista.actual !== estado) setVista({ actual: estado, previo: vista.actual });
  const llenando = vista.previo !== vista.actual;
  return (
    <div
      className={clases('ui-cenefa', CLASE[vista.previo])}
      data-estado={estado}
      aria-hidden="true"
    >
      {llenando ? (
        <div
          key={vista.actual}
          className={clases('ui-cenefa__llenado', CLASE[vista.actual])}
          onAnimationEnd={() => setVista({ actual: vista.actual, previo: vista.actual })}
        />
      ) : null}
    </div>
  );
}

interface PropsBanner {
  tono: 'aji' | 'rocoto' | 'soporte' | 'huacatay';
  icono: LucideIcon;
  titulo: ReactNode;
  children?: ReactNode;
  /** Acción a la derecha (por ejemplo "Terminar" en el modo soporte). */
  accion?: ReactNode;
  /** `timer` para textos que cambian cada segundo: los lectores de pantalla no los repiten. */
  rol?: 'status' | 'timer';
}

/** Banner de estado: dice con palabras qué pasa y qué hacer. Persistente; nunca solo color. */
export function BannerDeEstado({ tono, icono, titulo, children, accion, rol }: PropsBanner) {
  return (
    <div
      className={clases('ui-banner', `ui-banner--${tono}`)}
      role={rol ?? (tono === 'soporte' ? 'region' : 'status')}
      aria-label={tono === 'soporte' ? 'Modo soporte' : undefined}
    >
      <Icono icono={icono} />
      <div className="ui-banner__texto">
        <b className="ui-banner__titulo">{titulo}</b>
        {children ? <span className="ui-banner__detalle">{children}</span> : null}
      </div>
      {accion ? <div className="ui-banner__accion">{accion}</div> : null}
    </div>
  );
}
