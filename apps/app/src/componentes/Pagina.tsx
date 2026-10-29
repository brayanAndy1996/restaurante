import { BarraSuperior, IconoIzquierda, claseBoton, Icono } from '@restaurante/ui';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarraDePlataforma } from './BarraDePlataforma';
import { BarraDeSesionApp } from './BarraDeSesionApp';

interface PropsPagina {
  titulo: string;
  /** Enlace de volver a la pantalla anterior. */
  atras?: { a: string; etiqueta: string };
  /** Contenido a la derecha de la barra; por defecto, la sucursal y la sesión. */
  derecha?: ReactNode;
  /**
   * `estrecho` limita la columna a 720 px (formularios); `ancho`, a 1120 px (tablas); `completo` usa todo el
   * ancho (la pantalla de cocina, que reparte las comandas en columnas).
   */
  ancho?: 'estrecho' | 'ancho' | 'completo';
  /** Barra de tinta oscura del panel de plataforma. */
  plataforma?: boolean;
  /** Acción principal fija sobre la navegación, al alcance del pulgar. */
  pie?: ReactNode;
  children: ReactNode;
}

/** Página con barra superior de 56 px, columna de contenido y, si hace falta, la acción fija abajo. */
/** Al entrar en una pantalla, el contenido vuelve arriba y el foco pasa al marco (no queda en un botón que ya no existe). */
function useAlEntrar() {
  useEffect(() => {
    const marco = document.getElementById('contenido');
    if (!marco) return;
    marco.scrollTop = 0;
    marco.focus({ preventScroll: true });
  }, []);
}

export function Pagina({
  titulo,
  atras,
  derecha,
  ancho = 'estrecho',
  plataforma,
  pie,
  children,
}: PropsPagina) {
  useAlEntrar();
  return (
    <div className="pagina">
      <div className="pagina__barra">
        <BarraSuperior
          titulo={titulo}
          atras={
            atras ? (
              <Link
                to={atras.a}
                className={claseBoton('texto')}
                aria-label={`Volver a ${atras.etiqueta}`}
              >
                <Icono icono={IconoIzquierda} tamano={20} />
                {atras.etiqueta}
              </Link>
            ) : undefined
          }
          derecha={derecha ?? (plataforma ? <BarraDePlataforma /> : <BarraDeSesionApp />)}
          {...(plataforma ? { plataforma: true } : {})}
        />
      </div>
      <div className={`pagina__contenido pagina__contenido--${ancho}`}>
        {atras ? <h1 className="ui-titulo pagina__titulo">{titulo}</h1> : null}
        {children}
      </div>
      {pie ? (
        <div className="pagina__pie">
          <div className={`pagina__contenido pagina__contenido--${ancho} pagina__pie-interior`}>
            {pie}
          </div>
        </div>
      ) : null}
    </div>
  );
}
