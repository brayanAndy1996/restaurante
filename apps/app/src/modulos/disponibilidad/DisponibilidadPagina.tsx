import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import {
  SECCIONES_HABILITADAS,
  seccionDeDisponibilidadPedida,
  type SeccionDeDisponibilidad,
} from './disponibilidad';
import { MenuDelDiaSeccion } from './MenuDelDiaSeccion';

/**
 * Marco del destino "Disponibilidad": título, el cambio de sección arriba (solo cuando hay más de una
 * sección) y, abajo, la acción principal de la sección. "Agotados" llega en C5 (T27): se enciende en
 * `SECCIONES_DE_DISPONIBILIDAD` y su pantalla se suma en `DisponibilidadPagina`.
 */
export function MarcoDeDisponibilidad({
  actual,
  pie,
  children,
}: {
  actual: SeccionDeDisponibilidad;
  pie?: ReactNode;
  children: ReactNode;
}) {
  const navegar = useNavigate();
  const opciones: OpcionDeSegmento<SeccionDeDisponibilidad>[] = SECCIONES_HABILITADAS.map((s) => ({
    valor: s.valor,
    etiqueta: s.etiqueta,
  }));
  return (
    <Pagina titulo="Disponibilidad" ancho="ancho" {...(pie ? { pie } : {})}>
      {opciones.length > 1 ? (
        <div className="carta__secciones">
          <Segmentos
            etiqueta="Secciones de disponibilidad"
            opciones={opciones}
            valor={actual}
            onCambio={(valor) => navegar(`/disponibilidad?ver=${valor}`, { replace: true })}
          />
        </div>
      ) : null}
      {children}
    </Pagina>
  );
}

/** `/disponibilidad`: la sección sale de `?ver=` (agotados o menu). */
export function DisponibilidadPagina() {
  const [parametros] = useSearchParams();
  const seccion = seccionDeDisponibilidadPedida(parametros.get('ver'));
  // T27 (C5): `if (seccion === 'agotados') return <AgotadosSeccion />;`
  return <MenuDelDiaSeccion marco={MarcoDeDisponibilidad} actual={seccion} />;
}
