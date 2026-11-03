'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icono } from '../Iconos';

interface Props {
  /** Id del título; el diálogo se nombra con él. */
  idTitulo: string;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Algo a la izquierda del título (la foto del producto). */
  antesDelTitulo?: ReactNode;
  /** Sin cabecera con X: las confirmaciones cortas solo llevan el título dentro del cuerpo. */
  sinCerrar?: boolean;
  alCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
}

/**
 * Hoja inferior: un `<dialog>` nativo abierto como modal, así el foco queda atrapado y el fondo, inerte. El foco
 * inicial va al título (no al botón de cerrar) y al cerrarla vuelve a quien la abrió. Se cierra con la X, con
 * `Escape` y tocando la cortina. La hoja existe solo mientras está abierta: al cerrarse se desmonta y no deja nada.
 */
export function Hoja({
  idTitulo,
  titulo,
  subtitulo,
  antesDelTitulo,
  sinCerrar,
  alCerrar,
  children,
  pie,
}: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!elemento.open) elemento.showModal();
    tituloRef.current?.focus();
    return () => {
      if (elemento.open) elemento.close();
      if (previo?.isConnected) previo.focus();
    };
  }, []);

  return (
    // El toque en la cortina es una comodidad con el dedo; con teclado se cierra con `Escape` o con la X.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <dialog
      ref={dialogo}
      className="hoja"
      aria-labelledby={idTitulo}
      onCancel={(evento) => {
        evento.preventDefault();
        cerrar.current();
      }}
      onClick={(evento) => {
        // La cortina es el propio diálogo: un toque fuera del contenido llega con él como destino.
        if (evento.target === dialogo.current) cerrar.current();
      }}
    >
      <div className="hoja__asa" aria-hidden="true" />
      {sinCerrar ? (
        <div className="hoja__cuerpo hoja__cuerpo--corto">
          <h2 className="hoja__titulo" id={idTitulo} tabIndex={-1} ref={tituloRef}>
            {titulo}
          </h2>
          {children}
        </div>
      ) : (
        <>
          <div className="hoja__cabecera">
            <div className="hoja__encabezado">
              {antesDelTitulo}
              <div>
                <h2 className="hoja__titulo" id={idTitulo} tabIndex={-1} ref={tituloRef}>
                  {titulo}
                </h2>
                {subtitulo ? <div className="hoja__subtitulo">{subtitulo}</div> : null}
              </div>
            </div>
            <button
              type="button"
              className="boton-icono"
              aria-label="Cerrar"
              onClick={() => cerrar.current()}
            >
              <Icono nombre="x" />
            </button>
          </div>
          <div className="hoja__cuerpo">{children}</div>
        </>
      )}
      {pie ? <div className="hoja__pie">{pie}</div> : null}
    </dialog>
  );
}
