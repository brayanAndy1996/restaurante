import type { PanelItem } from '@restaurante/contratos';
import {
  Boton,
  Casilla,
  CampoSeleccion,
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoBuscar,
  IconoCuenta,
  Plegable,
  Segmentos,
  TablaResponsiva,
  claseFila,
  type ColumnaDeTabla,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { mensajeDeError } from '../../lib/errores';
import { fechaDeLima, horaDeLima } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { MarcoDeAjustes } from '../administracion/MarcoDeAjustes';
import {
  EtiquetaDeAlerta,
  EtiquetaDeEstadoSunat,
  EtiquetaSimulado,
} from './EtiquetasDeComprobante';
import {
  FILTROS_VACIOS,
  NOMBRE_DE_ESTADO,
  NOMBRE_DE_TIPO_DOCUMENTO,
  clavePanel,
  cuantosFiltrosHay,
  direccionDeFiltros,
  errorDeFechas,
  filtrosDeLaDireccion,
  listarPanel,
  rutaDelDetalle,
  type EstadoDelFiltro,
  type FiltrosDelPanel,
  type TipoDelFiltro,
} from './facturacion';
import { RUTA_PANEL_EN_AJUSTES, RUTA_PANEL_EN_CAJA } from './rutas';
import './panel.css';

const ESPERA_DE_BUSQUEDA_MS = 400;

type Conteos = Record<PanelItem['estado'], number>;
const ESTADOS: readonly PanelItem['estado'][] = [
  'POR_ENVIAR',
  'ENVIADO',
  'ACEPTADO',
  'RECHAZADO',
  'ANULADO',
];

/** «Todos (12)», «Rechazado (2)»: los conteos de los demás estados con los mismos filtros. */
function opcionesDeEstado(conteos: Conteos | undefined): OpcionDeSegmento<EstadoDelFiltro>[] {
  const con = (nombre: string, n: number | undefined) =>
    n === undefined ? nombre : `${nombre} (${n})`;
  const total = conteos ? ESTADOS.reduce((suma, e) => suma + conteos[e], 0) : undefined;
  return [
    { valor: 'TODOS', etiqueta: con('Todos', total) },
    ...ESTADOS.map((e) => ({ valor: e, etiqueta: con(NOMBRE_DE_ESTADO[e], conteos?.[e]) })),
  ];
}

const OPCIONES_DE_TIPO: readonly { valor: TipoDelFiltro; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todos los tipos' },
  { valor: 'BOLETA', etiqueta: NOMBRE_DE_TIPO_DOCUMENTO.BOLETA },
  { valor: 'FACTURA', etiqueta: NOMBRE_DE_TIPO_DOCUMENTO.FACTURA },
  { valor: 'NOTA_CREDITO_BOLETA', etiqueta: NOMBRE_DE_TIPO_DOCUMENTO.NOTA_CREDITO_BOLETA },
  { valor: 'NOTA_CREDITO_FACTURA', etiqueta: NOMBRE_DE_TIPO_DOCUMENTO.NOTA_CREDITO_FACTURA },
];

/** `/caja/comprobantes`: el panel del Supervisor y del Cajero (que solo ve los de sus turnos). */
export function ComprobantesEnCajaPagina() {
  return (
    <Pagina titulo="Comprobantes" ancho="ancho" atras={{ a: '/caja', etiqueta: 'Caja' }}>
      <PanelDeComprobantes base={RUTA_PANEL_EN_CAJA} />
    </Pagina>
  );
}

/** `/administracion/comprobantes`: el panel del Administrador, con el filtro de sucursal. */
export function ComprobantesEnAjustesPagina() {
  return (
    <MarcoDeAjustes actual="comprobantes" ancho="ancho">
      <PanelDeComprobantes base={RUTA_PANEL_EN_AJUSTES} conTitulo />
    </MarcoDeAjustes>
  );
}

/**
 * El panel de comprobantes (HU-31, criterio 174): los conteos por estado como segmentos, la lista con sus filtros
 * (estado, tipo, fechas, número o documento y «Con alerta») y, al tocar uno, su detalle. Los filtros viven en la
 * dirección de la pantalla, así el aviso de alertas lleva aquí ya filtrado (`?alerta=1`) y «Atrás» los conserva.
 */
function PanelDeComprobantes({ base, conTitulo }: { base: string; conTitulo?: boolean }) {
  const sesion = useSesionActiva();
  const sondeo = useIntervaloDeSondeo();
  const ubicacion = useLocation();
  const [parametros, ponerParametros] = useSearchParams();
  const filtros = useMemo(() => filtrosDeLaDireccion(parametros), [parametros]);
  const cambiar = (parcial: Partial<FiltrosDelPanel>) =>
    ponerParametros(direccionDeFiltros({ ...filtros, ...parcial }), { replace: true });

  // Lo que se escribe en la búsqueda llega a la dirección con una pequeña espera: no se pide por cada letra.
  const [texto, setTexto] = useState(filtros.texto);
  useEffect(() => {
    if (texto.trim() === filtros.texto) return;
    const id = window.setTimeout(() => cambiar({ texto }), ESPERA_DE_BUSQUEDA_MS);
    return () => window.clearTimeout(id);
    // `cambiar` se rehace en cada vuelta; lo que dispara la búsqueda es el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const sucursalesPropias = sesion.esAdministrador
    ? sesion.sucursales.filter((s) => s.rol === 'ADMINISTRADOR')
    : [];
  const variasSucursales = sucursalesPropias.length > 1;
  const [masAbierto, setMasAbierto] = useState(cuantosFiltrosHay(filtros) > 0);
  const errorFechas = errorDeFechas(filtros);

  const consulta = useInfiniteQuery({
    queryKey: clavePanel(sesion.sucursal?.id ?? '', filtros),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listarPanel(filtros, pageParam, signal),
    getNextPageParam: (pagina) => pagina.siguiente ?? undefined,
    enabled: errorFechas === null,
    staleTime: 0,
    refetchInterval: sondeo,
  });
  const items = consulta.data?.pages.flatMap((p) => p.items) ?? [];
  const conteos = consulta.data?.pages[0]?.conteos;
  const hayFiltros =
    filtros.estado !== 'TODOS' || filtros.texto !== '' || cuantosFiltrosHay(filtros) > 0;

  const quitarFiltros = () => {
    setTexto('');
    ponerParametros(direccionDeFiltros(FILTROS_VACIOS), { replace: true });
  };

  return (
    <div className="panel">
      {conTitulo ? <h2 className="panel__titulo">Comprobantes</h2> : null}
      <Segmentos
        etiqueta="Estado del comprobante"
        opciones={opcionesDeEstado(conteos)}
        valor={filtros.estado}
        onCambio={(estado) => cambiar({ estado })}
      />

      <CampoTexto
        etiqueta="Buscar por número o documento"
        type="search"
        inputMode="search"
        autoComplete="off"
        maxLength={50}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />

      <Plegable
        titulo="Más filtros"
        resumen={
          cuantosFiltrosHay(filtros) > 0
            ? textoDeFiltros(cuantosFiltrosHay(filtros))
            : 'Tipo, fechas y alertas'
        }
        abierto={masAbierto}
        onCambio={setMasAbierto}
      >
        <div className="panel__filtros">
          <CampoSeleccion
            etiqueta="Tipo"
            value={filtros.tipo}
            onChange={(e) => cambiar({ tipo: e.target.value as TipoDelFiltro })}
          >
            {OPCIONES_DE_TIPO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </CampoSeleccion>
          {variasSucursales ? (
            <CampoSeleccion
              etiqueta="Sucursal"
              value={filtros.sucursalId}
              onChange={(e) => cambiar({ sucursalId: e.target.value })}
            >
              <option value="">Todas mis sucursales</option>
              {sucursalesPropias.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </CampoSeleccion>
          ) : null}
          <div className="panel__fechas">
            <CampoTexto
              etiqueta="Desde"
              type="date"
              value={filtros.desde}
              onChange={(e) => cambiar({ desde: e.target.value })}
              {...(errorFechas ? { error: errorFechas } : {})}
            />
            <CampoTexto
              etiqueta="Hasta"
              type="date"
              value={filtros.hasta}
              onChange={(e) => cambiar({ hasta: e.target.value })}
            />
          </div>
          <p className="texto-ayuda">Sin fechas, se muestran los últimos 7 días.</p>
          <Casilla
            etiqueta="Solo con alerta"
            ayuda="Rechazados sin reemplazo, pendientes hace más de 30 minutos, envíos detenidos y facturación sin activar."
            marcada={filtros.alerta}
            onCambio={(alerta) => cambiar({ alerta })}
          />
        </div>
      </Plegable>

      {hayFiltros ? (
        <div className="panel__quitar">
          <Boton variante="texto" onClick={quitarFiltros}>
            Quitar filtros
          </Boton>
        </div>
      ) : null}

      <ListaDelPanel
        base={base}
        volver={ubicacion.search}
        items={items}
        pendiente={errorFechas === null && consulta.isPending}
        error={consulta.isError && consulta.data === undefined ? consulta.error : null}
        reintentando={consulta.isFetching}
        onReintentar={() => void consulta.refetch()}
        hayFiltros={hayFiltros}
        conSucursal={variasSucursales}
        hayMas={consulta.hasNextPage}
        cargandoMas={consulta.isFetchingNextPage}
        onVerMas={() => void consulta.fetchNextPage()}
      />
    </div>
  );
}

const textoDeFiltros = (n: number) => (n === 1 ? '1 filtro puesto' : `${n} filtros puestos`);

interface PropsLista {
  base: string;
  /** La búsqueda de la dirección, para volver al panel como estaba. */
  volver: string;
  items: PanelItem[];
  pendiente: boolean;
  error: unknown;
  reintentando: boolean;
  onReintentar: () => void;
  hayFiltros: boolean;
  conSucursal: boolean;
  hayMas: boolean;
  cargandoMas: boolean;
  onVerMas: () => void;
}

function ListaDelPanel({
  base,
  volver,
  items,
  pendiente,
  error,
  reintentando,
  onReintentar,
  hayFiltros,
  conSucursal,
  hayMas,
  cargandoMas,
  onVerMas,
}: PropsLista) {
  if (pendiente) {
    return <EsqueletoDeLista etiqueta="Cargando los comprobantes" filas={4} conInicial={false} />;
  }
  if (error) {
    return (
      <ErrorDeCarga
        titulo="No pudimos cargar los comprobantes"
        onReintentar={onReintentar}
        reintentando={reintentando}
      >
        {mensajeDeError(error)}
      </ErrorDeCarga>
    );
  }
  if (items.length === 0) {
    return (
      <EstadoVacio icono={IconoCuenta} titulo="No hay comprobantes">
        {hayFiltros
          ? 'Ninguno coincide con lo que elegiste. Cambia los filtros o quítalos.'
          : 'No se emitió ninguno en los últimos 7 días.'}
      </EstadoVacio>
    );
  }

  const enlace = (c: PanelItem) => ({
    pathname: rutaDelDetalle(base, c.id),
  });
  const columnas: ColumnaDeTabla<PanelItem>[] = [
    {
      id: 'numero',
      encabezado: 'Comprobante',
      sinSaltos: true,
      celda: (c) => (
        <>
          <Link to={enlace(c)} state={{ volver }} className="panel__enlace">
            {c.numero}
          </Link>
          <span className="panel__sub">{NOMBRE_DE_TIPO_DOCUMENTO[c.tipo]}</span>
        </>
      ),
    },
    {
      id: 'cliente',
      encabezado: 'Cliente',
      celda: (c) => <span className="panel__cliente">{c.cliente ?? 'Sin cliente'}</span>,
    },
    {
      id: 'emitido',
      encabezado: 'Emitido',
      sinSaltos: true,
      celda: (c) => `${fechaCorta(c.emitidoEn)} ${horaDeLima(c.emitidoEn)}`,
    },
    ...(conSucursal
      ? [{ id: 'sucursal', encabezado: 'Sucursal', celda: (c: PanelItem) => c.sucursal.nombre }]
      : []),
    {
      id: 'total',
      encabezado: 'Total',
      alinear: 'derecha',
      sinSaltos: true,
      celda: (c) => montoEnSoles(c.total),
    },
    {
      id: 'estado',
      encabezado: 'Estado',
      celda: (c) => (
        <span className="panel__etiquetas">
          <EtiquetaDeEstadoSunat estado={c.estado} />
          <EtiquetaDeAlerta alerta={c.alerta} />
          {c.simulado ? <EtiquetaSimulado /> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <TablaResponsiva
        etiqueta="Comprobantes"
        filas={items}
        columnas={columnas}
        clave={(c) => c.id}
        filaEnLista={(c) => (
          <Link
            to={enlace(c)}
            state={{ volver }}
            className={claseFila()}
            aria-label={`${NOMBRE_DE_TIPO_DOCUMENTO[c.tipo]} ${c.numero}, ${NOMBRE_DE_ESTADO[c.estado]}, ${montoEnSoles(c.total) ?? ''}`}
          >
            <ContenidoDeFila
              titulo={c.numero}
              ayuda={ayudaDeFila(c, conSucursal)}
              derecha={
                <span className="panel__derecha">
                  <b>{montoEnSoles(c.total)}</b>
                  <EtiquetaDeEstadoSunat estado={c.estado} />
                </span>
              }
              extra={
                c.alerta || c.simulado ? (
                  <>
                    <EtiquetaDeAlerta alerta={c.alerta} />
                    {c.simulado ? <EtiquetaSimulado /> : null}
                  </>
                ) : undefined
              }
            />
          </Link>
        )}
      />
      {hayMas ? (
        <Boton
          bloque
          icono={IconoBuscar}
          cargando={cargandoMas}
          textoCargando="Cargando…"
          onClick={onVerMas}
        >
          Ver más comprobantes
        </Boton>
      ) : null}
    </>
  );
}

/** «05/11»: el día y el mes de Lima de un instante (el panel no pasa de 93 días). */
function fechaCorta(instante: string): string {
  return fechaDeLima(instante).slice(0, 5);
}

/** «Boleta · Rosa Quispe · 05/11/2026 19:10», con la sucursal si el panel junta varias. */
function ayudaDeFila(c: PanelItem, conSucursal: boolean): string {
  return [
    NOMBRE_DE_TIPO_DOCUMENTO[c.tipo],
    c.cliente ?? 'Sin cliente',
    `${fechaDeLima(c.emitidoEn)} ${horaDeLima(c.emitidoEn)}`,
    conSucursal ? c.sucursal.nombre : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
