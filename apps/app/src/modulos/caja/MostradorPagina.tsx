import type { ProductoDeVenta, VentaMostradorRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CONSULTA_TABLET,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  Icono,
  IconoArriba,
  IconoCarta,
  IconoIzquierda,
  IconoPago,
  claseBoton,
  useCoincide,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { useVistaDeSucursal } from '../disponibilidad/useVistaDeSucursal';
import {
  borrarBorrador,
  claveDeBorrador,
  leerEstadoDeEnvio,
  totalDelBorrador,
  unidadesDelBorrador,
  useBorrador,
  type LineaBorrador,
} from '../salon/borrador';
import { CartaDelComandero } from '../salon/CartaDelComandero';
import { familiasParaVender } from '../salon/comandero';
import { HojaDeProducto } from '../salon/HojaDeProducto';
import { textoDeItems } from '../salon/ordenes';
import { PorEnviar } from '../salon/PorEnviar';
import {
  CLIENTE_VACIO,
  NOMBRE_DE_MEDIO_DE_PAGO,
  resumirPagos,
  type ClienteEscrito,
  type FormatoDeCobro,
} from './cobro';
import { ComprobantePanel } from './ComprobantePanel';
import { motivoDelCliente, useClienteFactura } from './padron';
import {
  ORDEN_DEL_MOSTRADOR,
  claveDeVentaEnCurso,
  guardarVentaEnCurso,
  leerVentaEnCurso,
  totalDeLaVenta,
  venderBorrador,
  type FalloDeVenta,
} from './mostrador';
import { PagosPanel, pagoNuevo } from './PagosPanel';
import { ResultadoDeCobro } from './ResultadoDeCobro';
import { claveCajasDeTurno, claveTurnoMio, leerTurnoMio, listarCajasActivas } from './turno';
import '../salon/comandero.css';
import './cobro.css';
import './mostrador.css';

type Panel = 'carta' | 'venta';

/**
 * `/caja/mostrador`: la venta de mostrador (criterios 79 a 85 y 115 de 006). El comandero de 004 sin mesa ni mozo, y en la
 * misma pantalla el comprobante, el cliente y los pagos con vuelto y redondeo. «Cobrar y enviar» cobra primero y manda el
 * pedido a cocina con su número de llamado, todo o nada. No hay descuentos ni cortesías (pregunta 14).
 */
export function MostradorPagina() {
  const sesion = useSesionActiva();
  const puedeCobrar = usePermiso('COBRAR') !== 'prohibido';
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Mostrador" atras={{ a: '/caja', etiqueta: 'Caja' }}>
        <EstadoVacio icono={IconoCarta} titulo="Elige una sucursal">
          La carta es de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  if (!puedeCobrar) {
    return (
      <Pagina titulo="Mostrador" atras={{ a: '/caja', etiqueta: 'Caja' }}>
        <EstadoVacio icono={IconoPago} titulo="Tu rol no cobra">
          La venta de mostrador es del Cajero, el Supervisor y el Administrador.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Mostrador
      key={`${sesion.usuario?.id ?? 'soporte'}.${sesion.sucursal.id}`}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? null}
      sucursalId={sesion.sucursal.id}
    />
  );
}

interface Hecha {
  respuesta: VentaMostradorRespuesta;
}

function Mostrador({
  empresaId,
  usuarioId,
  sucursalId,
}: {
  empresaId: string;
  usuarioId: string | null;
  sucursalId: string;
}) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const clave = claveDeBorrador(empresaId, usuarioId, ORDEN_DEL_MOSTRADOR);
  const claveDeVenta = claveDeVentaEnCurso(empresaId, usuarioId);
  const borrador = useBorrador(clave);
  const consultaCarta = useVistaDeSucursal(sucursalId);
  const turnoConsulta = useQuery({
    queryKey: claveTurnoMio(usuarioId ?? '', sucursalId),
    queryFn: ({ signal }) => leerTurnoMio(signal),
    refetchInterval: sondeo,
  });
  // Los tipos de comprobante que el régimen del emisor permite salen de la caja del turno (criterio 115): la PWA no
  // lleva una lista propia.
  const cajasConsulta = useQuery({
    queryKey: claveCajasDeTurno(sucursalId),
    queryFn: ({ signal }) => listarCajasActivas(signal),
    enabled: turnoConsulta.data != null,
  });
  const ancha = useCoincide(CONSULTA_TABLET);

  const [panel, setPanel] = useState<Panel>(borrador.envioId !== null ? 'venta' : 'carta');
  const [abierto, setAbierto] = useState<{
    producto: ProductoDeVenta;
    linea: LineaBorrador | null;
  } | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [sinProducto, setSinProducto] = useState<string | null>(null);
  const [tipoElegido, setTipo] = useState<'BOLETA' | 'FACTURA'>('BOLETA');
  const [formato, setFormato] = useState<FormatoDeCobro>('DETALLADO');
  const [cliente, setCliente] = useState<ClienteEscrito>(CLIENTE_VACIO);
  const [filas, setFilas] = useState(() => [pagoNuevo('EFECTIVO')]);
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState<FalloDeVenta | null>(null);
  const [hecha, setHecha] = useState<Hecha | null>(null);
  const [vendiendo, setVendiendo] = useState(false);
  const enviando = useRef(false);
  const montado = useRef(true);
  const alertaDeFallo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  // Quien toca «Cobrar y enviar» está abajo: si falla, el aviso se trae a la vista.
  useEffect(() => {
    if (fallo) alertaDeFallo.current?.scrollIntoView?.({ block: 'start' });
  }, [fallo]);

  const turno = turnoConsulta.data ?? null;
  const permitidos =
    cajasConsulta.data?.find((c) => c.id === turno?.caja.id)?.parametros.tiposComprobante ?? null;
  // Si lo elegido no lo permite el régimen, se usa el primero que sí.
  const tipo =
    permitidos === null || permitidos.includes(tipoElegido)
      ? tipoElegido
      : (permitidos[0] ?? tipoElegido);
  const carta = consultaCarta.data?.vista;
  const familias = useMemo(() => familiasParaVender(carta?.familias ?? []), [carta]);
  const bloqueado = borrador.envioId !== null;
  const enCurso = bloqueado ? leerVentaEnCurso(claveDeVenta) : null;

  // --- Lo que se cobra --------------------------------------------------------------------------------
  const venta = useMemo(
    () => (carta ? totalDeLaVenta(borrador.lineas, carta.familias, formato) : null),
    [carta, borrador.lineas, formato],
  );
  const total = venta?.ok ? venta.total : '0.00';
  const padron = useClienteFactura(tipo, total, cliente, setCliente);
  const clienteValidado = padron.validado;
  const resumen = useMemo(() => resumirPagos(total, filas), [total, filas]);

  function elegir(producto: ProductoDeVenta) {
    setSinProducto(null);
    setAbierto({ producto, linea: null });
  }

  function editar(linea: LineaBorrador) {
    const producto = (carta?.familias ?? [])
      .flatMap((f) => f.productos)
      .find((p) => p.id === linea.productoId);
    if (!producto) {
      setSinProducto(
        `${linea.nombre} ya no está en la carta de esta sucursal. Quita la línea para poder cobrar.`,
      );
      return;
    }
    setSinProducto(null);
    setAbierto({ producto, linea });
  }

  function guardar(linea: LineaBorrador) {
    if (abierto?.linea) borrador.reemplazar(abierto.linea.clave, linea);
    else borrador.agregar(linea);
    setAnuncio(
      `${abierto?.linea ? 'Cambiaste' : 'Agregaste'} ${linea.cantidad} × ${linea.nombre}.`,
    );
    setAbierto(null);
  }

  async function intentarVender() {
    if (enviando.current || !turno || borrador.lineas.length === 0) return;
    const listo = venta?.ok && clienteValidado.ok && resumen.pagos !== null && permitidos !== null;
    // Un reintento manda lo que se guardó con el `id`; solo uno nuevo exige que el formulario esté bien.
    if (!listo && !enCurso) {
      setIntentado(true);
      return;
    }
    enviando.current = true;
    setVendiendo(true);
    setFallo(null);
    const cuerpo = enCurso
      ? enCurso.cuerpo
      : {
          turnoId: turno.id,
          total,
          comprobante: {
            tipo,
            formato,
            ...(clienteValidado.ok && clienteValidado.cliente
              ? { cliente: clienteValidado.cliente }
              : {}),
          },
          pagos: resumen.pagos ?? [],
          redondeo: resumen.redondeo,
        };
    try {
      const resultado = await venderBorrador({
        clave,
        claveDeVenta,
        cuerpo,
        clientes,
        sucursalId,
      });
      if (!montado.current) return;
      if (resultado.resultado === 'vendida') {
        borrarBorrador(clave);
        guardarVentaEnCurso(claveDeVenta, null);
        setHecha({ respuesta: resultado.respuesta });
      } else if (resultado.resultado === 'cambio') {
        setFallo(resultado.fallo);
        setIntentado(true);
      } else if (resultado.resultado === 'rechazada') {
        // Si las líneas rechazadas ya llevan su aviso en «La venta», no se dice dos veces.
        if (leerEstadoDeEnvio(clave).aviso === null) setFallo(resultado.fallo);
        setIntentado(true);
      } else if (resultado.resultado === 'fallo') {
        setIntentado(true);
      }
    } finally {
      enviando.current = false;
      if (montado.current) setVendiendo(false);
    }
  }

  // --- Pantallas previas ---------------------------------------------------------------------------------
  if (turnoConsulta.isPending) {
    return (
      <Pagina titulo="Mostrador" atras={{ a: '/caja', etiqueta: 'Caja' }}>
        <EsqueletoDeLista filas={4} conInicial={false} etiqueta="Cargando tu caja" />
      </Pagina>
    );
  }

  if (hecha) {
    const { respuesta } = hecha;
    return (
      <Pagina key="resultado" titulo="Venta">
        <ResultadoDeCobro
          respuesta={respuesta.cobro}
          titulo={`Llamado ${respuesta.venta.numeroLlamado}`}
          parteIgual={null}
          llamado={respuesta.venta.numeroLlamado}
          textoDeSeguir="Nueva venta"
          onSeguir={() => {
            setHecha(null);
            setFallo(null);
            setIntentado(false);
            setCliente(CLIENTE_VACIO);
            setTipo('BOLETA');
            setFormato('DETALLADO');
            setFilas([pagoNuevo('EFECTIVO')]);
            setPanel('carta');
          }}
          volverA="/caja"
        />
      </Pagina>
    );
  }

  if (!turno) {
    return (
      <Pagina titulo="Mostrador" atras={{ a: '/caja', etiqueta: 'Caja' }}>
        <EstadoVacio
          icono={IconoPago}
          titulo="Abre tu caja para vender"
          accion={
            <Link to="/caja" className={claseBoton('principal')}>
              Ir a Caja
            </Link>
          }
        >
          Cada venta queda en un turno. Abre la caja con tu fondo y vuelve al mostrador.
        </EstadoVacio>
      </Pagina>
    );
  }

  // --- La venta ---------------------------------------------------------------------------------------------
  const hayLineas = borrador.lineas.length > 0;
  const unidades = unidadesDelBorrador(borrador.lineas);
  const totalDelPie = enCurso ? enCurso.cuerpo.total : total;
  const motivo =
    !hayLineas || enCurso
      ? null
      : permitidos === null
        ? cajasConsulta.isError
          ? 'No pudimos leer los comprobantes que emite esta caja.'
          : 'Cargando los comprobantes que emite esta caja.'
        : !venta
          ? 'Cargando la carta para calcular el total.'
          : !venta.ok
            ? venta.motivo === 'FUERA_DE_CARTA'
              ? `${venta.nombres.join(', ')} ya no ${venta.nombres.length === 1 ? 'está' : 'están'} en la carta. Quita ${venta.nombres.length === 1 ? 'la línea' : 'las líneas'} para cobrar.`
              : null
            : !clienteValidado.ok
              ? motivoDelCliente(clienteValidado.errores)
              : resumen.problema === null
                ? null
                : intentado
                  ? 'Revisa los pagos marcados.'
                  : resumen.problema;
  const etiquetaDelBoton = `${bloqueado && !vendiendo ? 'Reintentar la venta' : 'Cobrar y enviar'} · ${montoEnSoles(totalDelPie) ?? ''}`;
  const verCarta = ancha || panel === 'carta';
  const verVenta = ancha || panel === 'venta';
  const resumenTocable = !ancha && panel === 'carta' && hayLineas;
  const totalDelResumen = montoEnSoles(totalDelBorrador(borrador.lineas));

  const pie = !hayLineas ? undefined : resumenTocable ? (
    <div className="comandero__pie">
      <button
        type="button"
        className="comandero__resumen comandero__resumen--boton"
        aria-label={`Revisar la venta: ${textoDeItems(unidades)}, ${totalDelResumen}`}
        onClick={() => setPanel('venta')}
      >
        <span className="comandero__resumen-texto">
          <span>{textoDeItems(unidades)} en la venta</span>
          <b>{totalDelResumen}</b>
        </span>
        <Icono icono={IconoArriba} tamano={20} />
      </button>
      <Boton variante="principal" onClick={() => setPanel('venta')}>
        Cobrar
      </Boton>
    </div>
  ) : (
    <div className="cobro__pie">
      {motivo ? (
        <p id="mostrador-motivo" className="cobro__pie-motivo" role="status">
          {motivo}
        </p>
      ) : null}
      <Boton
        variante="principal"
        bloque
        cargando={vendiendo}
        textoCargando={borrador.fase === 'esperando-red' ? 'Pendiente de envío' : 'Cobrando…'}
        disabled={!enCurso && !venta?.ok}
        {...(motivo ? { 'aria-describedby': 'mostrador-motivo' } : {})}
        onClick={() => void intentarVender()}
      >
        {etiquetaDelBoton}
      </Boton>
    </div>
  );

  const totales = venta?.ok ? venta.calculada.totales : null;

  return (
    <Pagina
      titulo="Mostrador"
      atras={{ a: '/caja', etiqueta: 'Caja' }}
      ancho="ancho"
      {...(pie ? { pie } : {})}
    >
      {sinProducto ? (
        <Aviso tipo="alerta" titulo="Producto fuera de la carta">
          {sinProducto}
        </Aviso>
      ) : null}

      <div className={ancha ? 'comandero comandero--ancho mostrador' : 'comandero mostrador'}>
        {verCarta ? (
          <section className="comandero__panel" aria-label="Carta">
            {bloqueado ? (
              <Aviso tipo="alerta" titulo="Primero termina la venta">
                Hay una venta sin terminar. Reinténtala desde «La venta» antes de agregar más
                productos.
              </Aviso>
            ) : consultaCarta.isPending ? (
              <EsqueletoDeLista filas={5} conInicial={false} etiqueta="Cargando la carta" />
            ) : !carta ? (
              <ErrorDeCarga
                titulo="No pudimos cargar la carta"
                onReintentar={() => void consultaCarta.refetch()}
                reintentando={consultaCarta.isFetching}
              >
                Revisa tu conexión e inténtalo de nuevo.
              </ErrorDeCarga>
            ) : familias.length === 0 ? (
              <EstadoVacio icono={IconoCarta} titulo="La carta no tiene productos para vender">
                Pide al administrador que cargue los productos de esta sucursal.
              </EstadoVacio>
            ) : (
              <>
                {consultaCarta.isError ? (
                  <Aviso tipo="alerta" titulo="No pudimos actualizar la carta">
                    Lo que ves puede estar desactualizado. Seguimos intentando.
                  </Aviso>
                ) : null}
                <CartaDelComandero familias={familias} onElegir={elegir} />
              </>
            )}
          </section>
        ) : null}

        {verVenta ? (
          <section className="comandero__panel mostrador__venta" aria-label="La venta">
            <div className="comandero__encabezado">
              <h2 className="comandero__titulo">La venta</h2>
              {ancha ? null : (
                <Boton variante="texto" icono={IconoIzquierda} onClick={() => setPanel('carta')}>
                  Seguir agregando
                </Boton>
              )}
            </div>

            {fallo ? (
              <div role="alert" ref={alertaDeFallo}>
                <Aviso
                  tipo={fallo.cuentaCambio ? 'alerta' : 'error'}
                  titulo={fallo.cuentaCambio ? 'Cambió un precio' : 'No se cobró ni se envió nada'}
                >
                  <>
                    {fallo.texto}
                    {fallo.totalNuevo ? (
                      <>
                        {' '}
                        El total ahora es <b>{montoEnSoles(fallo.totalNuevo)}</b>.
                      </>
                    ) : null}
                    {fallo.turno ? (
                      <>
                        {' '}
                        <Link to="/caja">Ir a Caja</Link>
                      </>
                    ) : null}
                  </>
                </Aviso>
              </div>
            ) : null}

            <PorEnviar borrador={borrador} onEditar={editar} modo="mostrador" />

            {hayLineas && enCurso ? (
              <VentaEnEspera cuerpo={enCurso.cuerpo} />
            ) : hayLineas ? (
              <>
                <section className="cobro__bloque cobro__bloque--junta">
                  {totales && !montoEsCero(totales.icbper) ? (
                    <dl className="desglose" aria-label="Desglose de la venta">
                      <div className="desglose__fila">
                        <dt>Subtotal</dt>
                        <dd>{montoEnSoles(totales.subtotal)}</dd>
                      </div>
                      <div className="desglose__fila">
                        <dt>ICBPER</dt>
                        <dd>{montoEnSoles(totales.icbper)}</dd>
                      </div>
                    </dl>
                  ) : null}
                  <div className="cobro__total" role="status" aria-live="polite">
                    <span>Total a cobrar</span>
                    <b>{venta?.ok ? montoEnSoles(venta.total) : '—'}</b>
                  </div>
                </section>

                {permitidos ? (
                  <ComprobantePanel
                    permitidos={permitidos}
                    tipo={tipo}
                    onTipo={setTipo}
                    formato={formato}
                    onFormato={setFormato}
                    soloConsumo={false}
                    total={total}
                    cliente={cliente}
                    onCliente={setCliente}
                    errores={intentado && !clienteValidado.ok ? clienteValidado.errores : null}
                    padron={padron}
                  />
                ) : null}
                <section
                  className="cobro__bloque cobro__bloque--junta"
                  aria-labelledby="mostrador-pagos"
                >
                  <h2 id="mostrador-pagos">Pagos</h2>
                  <PagosPanel
                    filas={filas}
                    onFilas={setFilas}
                    resumen={resumen}
                    verProblemas={intentado}
                  />
                </section>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      <p className="ui-solo-lectores" role="status">
        {anuncio}
      </p>

      <HojaDeProducto
        producto={abierto?.producto ?? null}
        linea={abierto?.linea ?? null}
        onGuardar={guardar}
        onCerrar={() => setAbierto(null)}
      />
    </Pagina>
  );
}

/** Una venta que se mandó y no tiene respuesta: se reintenta tal cual, así que aquí solo se ve lo que se mandó. */
function VentaEnEspera({
  cuerpo,
}: {
  cuerpo: NonNullable<ReturnType<typeof leerVentaEnCurso>>['cuerpo'];
}) {
  return (
    <section className="cobro__bloque cobro__bloque--junta" aria-label="Lo que se cobra">
      <dl className="desglose">
        <div className="desglose__fila">
          <dt>Total a cobrar</dt>
          <dd>{montoEnSoles(cuerpo.total)}</dd>
        </div>
        <div className="desglose__fila desglose__fila--ayuda">
          <dt>Comprobante</dt>
          <dd>{cuerpo.comprobante.tipo === 'FACTURA' ? 'Factura' : 'Boleta'}</dd>
        </div>
        {cuerpo.pagos.map((p, i) => (
          <div key={`${p.medio}${i}`} className="desglose__fila desglose__fila--ayuda">
            <dt>{NOMBRE_DE_MEDIO_DE_PAGO[p.medio]}</dt>
            <dd>{montoEnSoles(p.monto)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
