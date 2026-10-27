import type { PlanRespuesta } from '@restaurante/contratos';
import {
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoMas,
  IconoPlan,
  TablaResponsiva,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { mensajeDeError } from '../../lib/errores';
import { CLAVES, listarPlanes, textoDePrecio } from './plataforma';

function Etiquetas({ plan }: { plan: PlanRespuesta }) {
  if (!plan.porDefecto && plan.activo) return null;
  return (
    <span className="etiquetas">
      {plan.porDefecto ? <EtiquetaDeEstado tono="info">Por defecto</EtiquetaDeEstado> : null}
      {!plan.activo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : null}
    </span>
  );
}

const resumen = (p: PlanRespuesta) =>
  `${p.codigo} · ${textoDePrecio(p.precioMensual)} al mes · ${p.diasGracia} días de gracia`;

/** Planes (criterio 101): qué módulos incluye cada uno, su precio, su cuota y sus días de gracia. */
export function PlanesPagina() {
  const consulta = useQuery({
    queryKey: CLAVES.planes,
    queryFn: ({ signal }) => listarPlanes(signal),
  });
  const planes = consulta.data ?? [];
  const nuevo = (
    <Link to="/plataforma/planes/nuevo" className={`${claseBoton('principal')} boton-pie`}>
      <Icono icono={IconoMas} />
      Nuevo plan
    </Link>
  );

  return (
    <Pagina titulo="Planes" plataforma ancho="ancho" pie={nuevo}>
      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando planes" conInicial={false} filas={3} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar los planes"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : planes.length === 0 ? (
        <EstadoVacio icono={IconoPlan} titulo="Aún no hay planes">
          Crea un plan para definir qué incluye cada suscripción.
        </EstadoVacio>
      ) : (
        <TablaResponsiva
          etiqueta="Planes"
          filas={planes}
          clave={(p) => p.id}
          apagada={(p) => !p.activo}
          filaEnLista={(p) => (
            <Link to={`/plataforma/planes/${p.id}`} className={claseFila(!p.activo)}>
              <ContenidoDeFila
                titulo={p.nombre}
                apagada={!p.activo}
                ayuda={resumen(p)}
                derecha={<Icono icono={IconoDerecha} />}
                extra={<Etiquetas plan={p} />}
              />
            </Link>
          )}
          columnas={[
            {
              id: 'nombre',
              encabezado: 'Plan',
              celda: (p) => (
                <>
                  <Link to={`/plataforma/planes/${p.id}`} className="enlace-texto enlace-nombre">
                    {p.nombre}
                  </Link>
                  <br />
                  <span className="texto-ayuda">{p.codigo}</span>
                </>
              ),
            },
            {
              id: 'precio',
              encabezado: 'Precio mensual',
              alinear: 'derecha',
              sinSaltos: true,
              celda: (p) => textoDePrecio(p.precioMensual),
            },
            {
              id: 'cuota',
              encabezado: 'Comprobantes al mes',
              alinear: 'derecha',
              sinSaltos: true,
              celda: (p) =>
                p.cuotaComprobantesMes === null ? 'Sin definir' : p.cuotaComprobantesMes,
            },
            {
              id: 'gracia',
              encabezado: 'Días de gracia',
              alinear: 'derecha',
              sinSaltos: true,
              celda: (p) => p.diasGracia,
            },
            {
              id: 'modulos',
              encabezado: 'Módulos',
              alinear: 'derecha',
              sinSaltos: true,
              celda: (p) => p.modulos.length,
            },
            { id: 'estado', encabezado: 'Estado', celda: (p) => <Etiquetas plan={p} /> },
          ]}
        />
      )}
    </Pagina>
  );
}
