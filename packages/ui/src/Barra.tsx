import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Boton } from './Boton';
import { Hoja } from './Hoja';
import { Icono, IconoAbajo, IconoTienda } from './iconos';
import { BaldosaDeOpcion, Inicial } from './Persona';
import { clases } from './utilidades';

interface PropsBarraSuperior {
  titulo: string;
  /**
   * Botón de volver. Con él, la barra no repite el nombre de la pantalla (que va como título en el
   * contenido): deja el sitio a la sucursal y a la sesión.
   */
  atras?: ReactNode;
  derecha?: ReactNode;
  /** Barra de tinta oscura de la plataforma y del soporte (Soporte Is Ink). */
  plataforma?: boolean;
}

/** Barra superior de 56 px: nombre de la pantalla o botón de volver, y a la derecha la sesión. */
export function BarraSuperior({ titulo, atras, derecha, plataforma }: PropsBarraSuperior) {
  return (
    <header className={clases('ui-barra', plataforma && 'ui-barra--plataforma')}>
      {atras}
      {atras ? (
        <span className="ui-barra__espacio" />
      ) : (
        <h1 className="ui-barra__titulo">{titulo}</h1>
      )}
      {derecha}
    </header>
  );
}

export interface AccionDeSesion {
  id: string;
  etiqueta: string;
  icono: LucideIcon;
  onSeleccionar: () => void;
  /** Acción que cierra o destruye: contorno rocoto y separada del resto. */
  peligro?: boolean;
}

export interface SucursalElegible {
  id: string;
  nombre: string;
  /** Segunda línea (por ejemplo, el rol en esa sucursal). */
  detalle?: string;
}

interface PropsBarraDeSesion {
  persona: { nombre: string; detalle: string };
  /** Sucursal activa; `null` si todavía no se eligió. */
  sucursal: SucursalElegible | null;
  sucursales: SucursalElegible[];
  onElegirSucursal: (id: string) => void;
  acciones: AccionDeSesion[];
}

/**
 * Persona, rol y sucursal siempre visibles. La sucursal se toca para cambiarla cuando hay varias; la
 * inicial de la persona abre una hoja con los datos de la sesión y sus acciones ("Salir", …).
 */
export function BarraDeSesion({
  persona,
  sucursal,
  sucursales,
  onElegirSucursal,
  acciones,
}: PropsBarraDeSesion) {
  const [hoja, setHoja] = useState<'sesion' | 'sucursal' | null>(null);
  const puedeCambiar = sucursales.length > 1;
  return (
    <>
      {sucursal ? (
        puedeCambiar ? (
          <button type="button" className="ui-barra__sucursal" onClick={() => setHoja('sucursal')}>
            <Icono icono={IconoTienda} tamano={20} />
            <span>{sucursal.nombre}</span>
            <Icono icono={IconoAbajo} tamano={20} />
          </button>
        ) : (
          <span className="ui-barra__sucursal ui-barra__sucursal--fija">
            <Icono icono={IconoTienda} tamano={20} />
            <span>{sucursal.nombre}</span>
          </span>
        )
      ) : null}
      <button
        type="button"
        className="ui-barra__persona"
        aria-label={`Sesión de ${persona.nombre}`}
        onClick={() => setHoja('sesion')}
      >
        <Inicial nombre={persona.nombre} chica />
        <span className="ui-barra__persona-texto" aria-hidden="true">
          <b>{persona.nombre}</b>
          <span>{persona.detalle}</span>
        </span>
      </button>

      <Hoja abierta={hoja === 'sesion'} onCerrar={() => setHoja(null)} titulo="Tu sesión">
        <div className="ui-sesion-datos">
          <Inicial nombre={persona.nombre} />
          <div className="ui-sesion-datos__texto">
            <b className="ui-fila__titulo">{persona.nombre}</b>
            <span className="ui-fila__ayuda">{persona.detalle}</span>
            {sucursal ? <span className="ui-fila__ayuda">{sucursal.nombre}</span> : null}
          </div>
        </div>
        <div className="ui-acciones">
          {puedeCambiar ? (
            <Boton bloque icono={IconoTienda} onClick={() => setHoja('sucursal')}>
              Cambiar de sucursal
            </Boton>
          ) : null}
          {acciones
            .filter((a) => !a.peligro)
            .map((a) => (
              <Boton
                key={a.id}
                bloque
                icono={a.icono}
                onClick={() => {
                  setHoja(null);
                  a.onSeleccionar();
                }}
              >
                {a.etiqueta}
              </Boton>
            ))}
          {acciones
            .filter((a) => a.peligro)
            .map((a) => (
              <Boton
                key={a.id}
                bloque
                variante="peligro"
                icono={a.icono}
                onClick={() => {
                  setHoja(null);
                  a.onSeleccionar();
                }}
              >
                {a.etiqueta}
              </Boton>
            ))}
        </div>
      </Hoja>

      <Hoja abierta={hoja === 'sucursal'} onCerrar={() => setHoja(null)} titulo="Elige tu sucursal">
        <div className="ui-acciones">
          {sucursales.map((s) => {
            const activa = s.id === sucursal?.id;
            return (
              <BaldosaDeOpcion
                key={s.id}
                titulo={s.nombre}
                {...(s.detalle ? { detalle: s.detalle } : {})}
                activa={activa}
                onElegir={() => {
                  setHoja(null);
                  if (!activa) onElegirSucursal(s.id);
                }}
              />
            );
          })}
        </div>
      </Hoja>
    </>
  );
}

/** Navegación inferior en celular y riel de 72 px desde 768 px. Los destinos son enlaces del router. */
export function Navegacion({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <nav className="ui-nav" aria-label={etiqueta}>
      {children}
    </nav>
  );
}

/** Contenido de un destino: icono de 24 px y etiqueta de 13 px siempre visible. */
export function ContenidoDeDestino({ icono, etiqueta }: { icono: LucideIcon; etiqueta: string }) {
  return (
    <>
      <Icono icono={icono} />
      <span>{etiqueta}</span>
    </>
  );
}
