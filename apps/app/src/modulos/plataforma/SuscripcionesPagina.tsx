import type { EstadoSuscripcionRespuesta, SuscripcionResumen } from '@restaurante/contratos';
import {
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoSuscripcion,
  Segmentos,
  TablaResponsiva,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { mensajeDeError } from '../../lib/errores';
import { formatearFecha } from '../../lib/formato';
import {
  CLAVES,
  TEXTO_DE_ESTADO,
  listarSuscripciones,
  textoDeComprobantesDelMes,
  textoDeConsumo,
  textoDePlan,
} from './plataforma';

type Filtro = 'todas' | EstadoSuscripcionRespuesta;

const OPCIONES = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'ACTIVA', etiqueta: 'Activas' },
  { valor: 'EN_GRACIA', etiqueta: 'En gracia' },
  { valor: 'SUSPENDIDA', etiqueta: 'Suspendidas' },
] as const;

const VACIO_POR_FILTRO: Record<Filtro, string> = {
  todas: 'Cuando se registre una empresa, la suscripción de cada sucursal aparecerá aquí.',
  ACTIVA: 'Ninguna sucursal tiene la suscripción al día.',
  EN_GRACIA: 'Ninguna sucursal está en gracia. Es una buena noticia.',
  SUSPENDIDA: 'Ninguna sucursal está suspendida. Es una buena noticia.',
};

function EtiquetaDeSuscripcion({ s }: { s: SuscripcionResumen }) {
  const estado = TEXTO_DE_ESTADO[s.estado];
  return <EtiquetaDeEstado tono={estado.tono}>{estado.texto}</EtiquetaDeEstado>;
}

function comprobantes(s: SuscripcionResumen): string {
  const c = s.consumoMesActual;
  return c.excedente > 0 ? `${textoDeConsumo(c)} · ${c.excedente} de más` : textoDeConsumo(c);
}

function comprobantesDelMes(s: SuscripcionResumen): string {
  const c = s.consumoMesActual;
  const texto = textoDeComprobantesDelMes(c);
  return c.excedente > 0 ? `${texto} · ${c.excedente} de más` : texto;
}

/** Suscripciones de todas las sucursales, por estado (criterios 76 y 101). */
export function SuscripcionesPagina() {
  const [params, setParams] = useSearchParams();
  const pedido = params.get('estado');
  const filtro: Filtro = OPCIONES.some((o) => o.valor === pedido) ? (pedido as Filtro) : 'todas';
  const estado = filtro === 'todas' ? undefined : filtro;
  const consulta = useQuery({
    queryKey: CLAVES.suscripciones(estado),
    queryFn: ({ signal }) => listarSuscripciones(estado, signal),
  });
  const filas = consulta.data ?? [];

  return (
    <Pagina titulo="Suscripciones" plataforma ancho="ancho">
      <Segmentos
        etiqueta="Filtrar por estado"
        opciones={OPCIONES}
        valor={filtro}
        onCambio={(valor) =>
          setParams(valor === 'todas' ? {} : { estado: valor }, { replace: true })
        }
      />

      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando suscripciones" conInicial={false} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar las suscripciones"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : filas.length === 0 ? (
        <EstadoVacio icono={IconoSuscripcion} titulo="No hay suscripciones aquí">
          {VACIO_POR_FILTRO[filtro]}
        </EstadoVacio>
      ) : (
        <>
          <p className="texto-ayuda" aria-live="polite">
            {filas.length === 1 ? '1 suscripción' : `${filas.length} suscripciones`}
          </p>
          <TablaResponsiva
            etiqueta="Suscripciones"
            filas={filas}
            clave={(s) => s.id}
            filaEnLista={(s) => (
              <Link to={`/plataforma/suscripciones/${s.id}`} className={claseFila()}>
                <ContenidoDeFila
                  titulo={s.sucursalNombre}
                  ayuda={s.empresaNombre}
                  derecha={
                    <>
                      <EtiquetaDeSuscripcion s={s} />
                      <Icono icono={IconoDerecha} />
                    </>
                  }
                  extra={
                    <span className="texto-ayuda">
                      {`${textoDePlan(s.plan.nombre)} · vence el ${formatearFecha(s.vencimiento)} · ${comprobantesDelMes(s)}`}
                    </span>
                  }
                />
              </Link>
            )}
            columnas={[
              { id: 'empresa', encabezado: 'Empresa', celda: (s) => s.empresaNombre },
              {
                id: 'sucursal',
                encabezado: 'Sucursal',
                celda: (s) => (
                  <Link
                    to={`/plataforma/suscripciones/${s.id}`}
                    className="enlace-texto enlace-nombre"
                  >
                    {s.sucursalNombre}
                  </Link>
                ),
              },
              { id: 'plan', encabezado: 'Plan', sinSaltos: true, celda: (s) => s.plan.nombre },
              {
                id: 'vence',
                encabezado: 'Vence',
                alinear: 'derecha',
                sinSaltos: true,
                celda: (s) => formatearFecha(s.vencimiento),
              },
              {
                id: 'estado',
                encabezado: 'Estado',
                sinSaltos: true,
                celda: (s) => <EtiquetaDeSuscripcion s={s} />,
              },
              {
                id: 'comprobantes',
                encabezado: 'Comprobantes del mes',
                alinear: 'derecha',
                sinSaltos: true,
                celda: (s) => comprobantes(s),
              },
              {
                id: 'acciones',
                encabezado: 'Acciones',
                encabezadoOculto: true,
                alinear: 'derecha',
                sinSaltos: true,
                celda: (s) => (
                  <Link to={`/plataforma/suscripciones/${s.id}`} className={claseBoton()}>
                    Ver <span className="ui-solo-lectores">{`${s.sucursalNombre}`}</span>
                  </Link>
                ),
              },
            ]}
          />
        </>
      )}
    </Pagina>
  );
}
