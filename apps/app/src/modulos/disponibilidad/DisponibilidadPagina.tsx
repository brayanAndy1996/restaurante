import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import {
  SECCIONES_HABILITADAS,
  seccionDeDisponibilidadPedida,
  type SeccionDeDisponibilidad,
} from './disponibilidad';
import { AgotadosSeccion } from './AgotadosSeccion';
import { MenuDelDiaSeccion } from './MenuDelDiaSeccion';

/**
 * Marco del destino "Disponibilidad": título, el cambio de sección arriba (solo cuando hay más de una
 * sección) y, abajo, la acción fija de la sección (guardar el menú, deshacer un agotado).
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

/** `/disponibilidad`: la sección sale de `?ver=` (agotados, la primera, o menu). */
export function DisponibilidadPagina() {
  const [parametros] = useSearchParams();
  const seccion = seccionDeDisponibilidadPedida(parametros.get('ver'));
  if (seccion === 'agotados')
    return <AgotadosSeccion marco={MarcoDeDisponibilidad} actual={seccion} />;
  return <MenuDelDiaSeccion marco={MarcoDeDisponibilidad} actual={seccion} />;
}
