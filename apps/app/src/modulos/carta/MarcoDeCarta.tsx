import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { usePermiso } from '../acceso/permisos';

export type SeccionDeCarta = 'productos' | 'familias' | 'estaciones';

const SECCIONES: readonly OpcionDeSegmento<SeccionDeCarta>[] = [
  { valor: 'productos', etiqueta: 'Productos' },
  { valor: 'familias', etiqueta: 'Familias' },
  { valor: 'estaciones', etiqueta: 'Estaciones' },
];

/**
 * Qué secciones ve cada quien: "Estaciones" solo con `ADMINISTRAR` (las define el Administrador; el
 * Cajero las lee desde el formulario del producto, pero no las edita). "Modificadores" llega con C3.
 */
export function seccionesDeCarta(puedeAdministrar: boolean): OpcionDeSegmento<SeccionDeCarta>[] {
  return SECCIONES.filter((s) => s.valor !== 'estaciones' || puedeAdministrar);
}

/** La sección que pide la dirección (`?ver=`); una desconocida o no permitida cae en "Productos". */
export function seccionPedida(valor: string | null, puedeAdministrar: boolean): SeccionDeCarta {
  return seccionesDeCarta(puedeAdministrar).find((s) => s.valor === valor)?.valor ?? 'productos';
}

export function useSeccionesDeCarta() {
  return seccionesDeCarta(usePermiso('ADMINISTRAR') === 'permitido');
}

/** Página de la carta: título, el cambio de sección arriba y, abajo, la acción principal de la sección. */
export function MarcoDeCarta({
  actual,
  pie,
  children,
}: {
  actual: SeccionDeCarta;
  pie?: ReactNode;
  children: ReactNode;
}) {
  const navegar = useNavigate();
  const secciones = useSeccionesDeCarta();
  return (
    <Pagina titulo="Carta" ancho="ancho" {...(pie ? { pie } : {})}>
      <div className="carta__secciones">
        <Segmentos
          etiqueta="Secciones de la carta"
          opciones={secciones}
          valor={actual}
          onCambio={(valor) => navegar(`/carta?ver=${valor}`, { replace: true })}
        />
      </div>
      {children}
    </Pagina>
  );
}
