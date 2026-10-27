import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Boton, BotonIcono } from './Boton';
import { IconoCerrar } from './iconos';
import { clases } from './utilidades';

interface PropsHoja {
  abierta: boolean;
  onCerrar: () => void;
  titulo: string;
  children: ReactNode;
  className?: string;
}

/**
 * En celular, hoja que sube desde abajo con asa, esquinas superiores de 16 px, sombra y cortina de
 * tinta al 45 %; desde 768 px, diálogo centrado de 480 px. Usa `<dialog>` modal: el navegador atrapa
 * el foco, lo devuelve al cerrar y cierra con Escape. Las hojas son para claves y confirmaciones;
 * lo que se puede resolver en la pantalla no abre una hoja.
 *
 * El contenido solo existe mientras está abierta, así que cada apertura empieza limpia (por ejemplo
 * un PIN escrito no sobrevive al cierre). Marca con `data-foco-inicial` el control que debe recibir
 * el foco al abrir (en una confirmación destructiva, "Cancelar").
 */
export function Hoja({ abierta, onCerrar, titulo, children, className }: PropsHoja) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const cierre = useRef(onCerrar);
  useEffect(() => {
    cierre.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierta && !dialogo.open) {
      dialogo.showModal();
      dialogo.querySelector<HTMLElement>('[data-foco-inicial]')?.focus();
    } else if (!abierta && dialogo.open) {
      dialogo.close();
    }
  }, [abierta]);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    const alCerrar = () => cierre.current();
    // Un toque sobre la cortina (el propio <dialog>, fuera de su contenido) la cierra; con el
    // teclado se cierra con Escape.
    const alTocar = (evento: MouseEvent) => {
      if (evento.target === dialogo) dialogo.close();
    };
    dialogo.addEventListener('close', alCerrar);
    dialogo.addEventListener('click', alTocar);
    return () => {
      dialogo.removeEventListener('close', alCerrar);
      dialogo.removeEventListener('click', alTocar);
    };
  }, []);

  return (
    <dialog ref={ref} className={clases('ui-hoja', className)} aria-labelledby={idTitulo}>
      {abierta ? (
        <>
          <div className="ui-hoja__asa" aria-hidden="true" />
          <div className="ui-hoja__cabecera">
            <h2 className="ui-hoja__titulo" id={idTitulo}>
              {titulo}
            </h2>
            <BotonIcono
              icono={IconoCerrar}
              etiqueta="Cerrar"
              onClick={() => ref.current?.close()}
            />
          </div>
          <div className="ui-hoja__cuerpo">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}

interface PropsConfirmacion {
  abierta: boolean;
  titulo: string;
  /** Dice qué pasará ("Se cerrarán sus sesiones abiertas"). */
  children: ReactNode;
  etiquetaConfirmar: string;
  /** Acción destructiva: relleno rocoto solo en esta confirmación final. */
  peligro?: boolean;
  cargando?: boolean;
  textoCargando?: string;
  /** Error de la acción (aparece dentro de la hoja). */
  error?: ReactNode;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Confirmación de una acción que deja rastro. El foco empieza en "Cancelar": nunca es lo destructivo. */
export function DialogoConfirmacion({
  abierta,
  titulo,
  children,
  etiquetaConfirmar,
  peligro,
  cargando,
  textoCargando,
  error,
  onConfirmar,
  onCancelar,
}: PropsConfirmacion) {
  return (
    <Hoja abierta={abierta} onCerrar={onCancelar} titulo={titulo}>
      <div>{children}</div>
      {error}
      <Boton
        variante={peligro ? 'peligro-lleno' : 'principal'}
        bloque
        cargando={cargando}
        textoCargando={textoCargando}
        onClick={onConfirmar}
      >
        {etiquetaConfirmar}
      </Boton>
      <Boton bloque onClick={onCancelar} disabled={cargando} data-foco-inicial>
        Cancelar
      </Boton>
    </Hoja>
  );
}
