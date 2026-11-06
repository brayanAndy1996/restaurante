import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { tieneFacturacion } from '../acceso/navegacion';
import { useSesion } from '../acceso/sesion';

export type SeccionDeAjustes =
  | 'usuarios'
  | 'acceso'
  | 'mesas'
  | 'impresion'
  | 'carta-web'
  | 'cajas'
  | 'emisores'
  | 'comprobantes';

const SECCIONES: readonly OpcionDeSegmento<SeccionDeAjustes>[] = [
  { valor: 'usuarios', etiqueta: 'Usuarios' },
  { valor: 'acceso', etiqueta: 'Acceso' },
  { valor: 'mesas', etiqueta: 'Mapa de mesas' },
  { valor: 'impresion', etiqueta: 'Impresión' },
  { valor: 'carta-web', etiqueta: 'Carta web' },
  { valor: 'cajas', etiqueta: 'Cajas' },
  { valor: 'emisores', etiqueta: 'Emisores' },
  { valor: 'comprobantes', etiqueta: 'Comprobantes' },
];

export const RUTA_DE_SECCION: Record<SeccionDeAjustes, string> = {
  usuarios: '/administracion/usuarios',
  acceso: '/administracion/acceso',
  mesas: '/administracion/mesas',
  impresion: '/administracion/impresion',
  'carta-web': '/administracion/carta-web',
  cajas: '/administracion/cajas',
  emisores: '/administracion/emisores',
  comprobantes: '/administracion/comprobantes',
};

interface PropsMarco {
  actual: SeccionDeAjustes;
  /** Acción principal fija abajo, al alcance del pulgar. */
  pie?: ReactNode;
  ancho?: 'estrecho' | 'ancho';
  children: ReactNode;
}

/**
 * Ajustes del Administrador (criterio 87 de 004): una sola puerta para Usuarios, Acceso, Mapa de
 * mesas, Impresión (3b), Carta web (005), Cajas, Emisores y Comprobantes (006). Es una pantalla con el cambio de sección arriba, como la Carta, para que
 * "Ajustes" sea un destino de la navegación y no tres.
 */
export function MarcoDeAjustes({ actual, pie, ancho = 'estrecho', children }: PropsMarco) {
  const navegar = useNavigate();
  // «Comprobantes» (006, 6b) solo está si el plan de la sucursal incluye Facturación.
  const { sesion } = useSesion();
  const secciones = SECCIONES.filter((s) => s.valor !== 'comprobantes' || tieneFacturacion(sesion));
  return (
    <Pagina titulo="Ajustes" ancho={ancho} {...(pie ? { pie } : {})}>
      <div className="ajustes__secciones">
        <Segmentos
          etiqueta="Secciones de Ajustes"
          opciones={secciones}
          valor={actual}
          onCambio={(valor) => navegar(RUTA_DE_SECCION[valor], { replace: true })}
        />
      </div>
      {children}
    </Pagina>
  );
}
