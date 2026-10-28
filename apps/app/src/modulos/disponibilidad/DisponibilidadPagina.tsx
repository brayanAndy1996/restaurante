import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import {
  SECCIONES_DE_DISPONIBILIDAD,
  seccionDeDisponibilidadPedida,
  type SeccionDeDisponibilidad,
} from './disponibilidad';
import { AgotadosSeccion } from './AgotadosSeccion';
import { MenuDelDiaSeccion } from './MenuDelDiaSeccion';

/**
 * Marco del destino "Disponibilidad": título, el cambio de sección arriba y, abajo, la acción fija de la sección (guardar el menú, deshacer un agotado).
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
  const opciones: OpcionDeSegmento<SeccionDeDisponibilidad>[] = SECCIONES_DE_DISPONIBILIDAD.map(
    (s) => ({
      valor: s.valor,
      etiqueta: s.etiqueta,
    }),
  );
  return (
    <Pagina titulo="Disponibilidad" ancho="ancho" {...(pie ? { pie } : {})}>
      <div className="carta__secciones">
        <Segmentos
          etiqueta="Secciones de disponibilidad"
          opciones={opciones}
          valor={actual}
          onCambio={(valor) => navegar(`/disponibilidad?ver=${valor}`, { replace: true })}
        />
      </div>
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
