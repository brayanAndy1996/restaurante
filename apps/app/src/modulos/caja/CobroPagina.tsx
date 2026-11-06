import type { CobroRespuesta, CuentaRespuesta } from '@restaurante/contratos';
import { MAXIMO_PARTES_IGUALES } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  IconoNota,
  IconoPago,
  claseBoton,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi } from '../../lib/errores';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL, useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { claveDeBorrador, useBorrador } from '../salon/borrador';
import { rutaDeOrden } from '../salon/salon';
import {
  CLIENTE_VACIO,
  calcularLaParte,
  cobrar,
  falloDeCobro,
  huellaDeCobro,
  partesCobradas,
  resumirPagos,
  rutaDeCobro,
  type ClienteEscrito,
  type FalloDeCobro,
  type FormatoDeCobro,
  type PagoEscrito,
  type Seleccion,
} from './cobro';
import { ComprobantePanel } from './ComprobantePanel';
import { motivoDelCliente, useClienteFactura } from './padron';
import { claveDeCuenta, leerCuenta, rutaDeCuenta, sePuedeAjustar, tituloDeCuenta } from './cuenta';
import { claveDeCobro, leerEstadoDeCobro, recordarEnCobro } from './partes';
import { PagosPanel, pagoNuevo } from './PagosPanel';
import { PartePanel, type ModoDeCobro, type PlanDeIguales } from './PartePanel';
import { ResultadoDeCobro } from './ResultadoDeCobro';
import { claveTurnoMio, leerTurnoMio } from './turno';
import './cobro.css';
import './cuenta-caja.css';

const TOTAL_VACIO = '0.00';

/** `/caja/cuentas/:id/cobrar`: el cobro de una cuenta, completa o por partes (criterios 47 a 68 y 111 a 114 de 006). */
export function CobroPagina() {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  const ubicacion = useLocation();
  const atras = {
    a:
      (ubicacion.state as { desde?: string } | null)?.desde === 'caja'
        ? '/caja?ver=por-cobrar'
        : `/caja/cuentas/${id}`,
    etiqueta: (ubicacion.state as { desde?: string } | null)?.desde === 'caja' ? 'Caja' : 'Cuenta',
  };
  const puedeCobrar = usePermiso('COBRAR') !== 'prohibido';
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Cobrar" atras={atras}>
        <EstadoVacio icono={IconoNota} titulo="Elige una sucursal">
          Las cuentas son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  if (!puedeCobrar) {
    return (
      <Pagina titulo="Cobrar" atras={atras}>
        <EstadoVacio icono={IconoPago} titulo="Tu rol no cobra">
          Cobrar es del Cajero, el Supervisor y el Administrador.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Cobro
      key={`${id}.${sesion.sucursal.id}.${sesion.usuario?.id ?? ''}`}
      ordenId={id}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? null}
      sucursalId={sesion.sucursal.id}
      atras={atras}
    />
  );
}

interface PropsCobro {
  ordenId: string;
  empresaId: string;
  usuarioId: string | null;
  sucursalId: string;
  atras: { a: string; etiqueta: string };
}

/** Lo que muestra el resultado de un cobro hecho. */
interface Hecho {
  respuesta: CobroRespuesta;
  titulo: string;
  parteIgual: { numero: number; de: number } | null;
}

type FalloMostrado = FalloDeCobro & { totalAlFallar: string | null };

function Cobro({ ordenId, empresaId, usuarioId, sucursalId, atras }: PropsCobro) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const envio = useEnvioPendiente();
  const claveEstado = claveDeCobro(empresaId, usuarioId, ordenId);
  const borrador = useBorrador(claveDeBorrador(empresaId, usuarioId, ordenId));

  const consulta = useQuery({
    queryKey: claveDeCuenta(ordenId),
    staleTime: 0,
    refetchInterval: sondeo,
    refetchOnWindowFocus: 'always',
    queryFn: ({ signal }) =>
      leerCuenta(ordenId, signal, clientes.getQueryData(claveDeCuenta(ordenId)) !== undefined),
  });
  const turnoConsulta = useQuery({
    queryKey: claveTurnoMio(usuarioId ?? '', sucursalId),
    queryFn: ({ signal }) => leerTurnoMio(signal),
    refetchInterval: sondeo,
  });
  const cuenta = consulta.data;
  const turno = turnoConsulta.data ?? null;

  // Este equipo recuerda del cobro dos cosas (criterios 55 y 65): el `id` del cobro que se mandó y aún no tiene respuesta
  // final, y en cuántas partes iguales se dividió la cuenta.
  const [enCurso, setEnCursoLocal] = useState(() => leerEstadoDeCobro(claveEstado).enCurso);
  const recordarEnCurso = (nuevo: { id: string; huella: string } | null) => {
    setEnCursoLocal(nuevo);
    recordarEnCobro(claveEstado, { enCurso: nuevo });
  };

  const [modo, setModo] = useState<ModoDeCobro>('TOTAL');
  const [unidades, setUnidades] = useState<Record<string, number>>({});
  // En cuántas partes iguales se divide la cuenta, contando las ya cobradas; `null` si este equipo no lo sabe. Se guarda
  // el total (no las que faltan) en el equipo para que, al recargar o si otro equipo cobra una parte, las que faltan
  // aquí se ajusten solas.
  const [partesTotales, setPartesTotalesLocal] = useState<number | null>(
    () => leerEstadoDeCobro(claveEstado).partesTotales,
  );
  const setPartesTotales = (total: number | null) => {
    setPartesTotalesLocal(total);
    recordarEnCobro(claveEstado, { partesTotales: total });
  };
  // El total que se propone al confirmar cuando este equipo no lo sabe (no es el saldo completo: eso sería adivinar).
  const [totalPorConfirmar, setTotalPorConfirmar] = useState<number | null>(null);
  const [tipo, setTipo] = useState<'BOLETA' | 'FACTURA'>('BOLETA');
  const [formato, setFormato] = useState<FormatoDeCobro>('DETALLADO');
  const [cliente, setCliente] = useState<ClienteEscrito>(CLIENTE_VACIO);
  const [filas, setFilas] = useState<PagoEscrito[]>(() => [pagoNuevo('EFECTIVO')]);
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState<FalloMostrado | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const enviando = useRef(false);
  const alertaDeFallo = useRef<HTMLDivElement>(null);
  // Quien toca «Cobrar» está abajo: si falla, el aviso se trae a la vista.
  useEffect(() => {
    if (fallo) alertaDeFallo.current?.scrollIntoView?.({ block: 'start' });
  }, [fallo]);
  const [cobrando, setCobrando] = useState(false);
  // Una cuenta que ya no está abierta no necesita recordar su división.
  const cuentaAbierta = cuenta
    ? cuenta.estado === 'ABIERTA' || cuenta.estado === 'EN_PRECUENTA'
    : null;
  useEffect(() => {
    if (cuentaAbierta === false) recordarEnCobro(claveEstado, { partesTotales: null });
  }, [cuentaAbierta, claveEstado]);

  // --- Lo que se cobra ---------------------------------------------------------------------------------
  // Todo sale de la cuenta que dice la API: cada cobro trae su `detalleParte`, así que se divide desde cualquier equipo.
  const anteriores = useMemo(() => (cuenta ? partesCobradas(cuenta) : []), [cuenta]);
  const plan: PlanDeIguales = {
    pagadas:
      cuenta?.cobros
        .filter((c) => c.detalleParte.tipo === 'IGUALES')
        .map((c) => c.comprobante.numero) ?? [],
  };
  // Después de partes iguales solo siguen partes iguales; «lo que falta» es la última (1 restante).
  const soloIguales = cuenta?.modo === 'IGUALES';
  const pagadas = plan.pagadas.length;
  const minimoDePartes = pagadas > 0 ? 1 : 2;
  // El total solo vale si deja al menos una parte por pagar; si no (la cuenta creció después de la última parte, o el
  // total guardado quedó viejo), se vuelve a preguntar.
  const totalConocido = partesTotales !== null && partesTotales > pagadas ? partesTotales : null;
  // Con partes ya cobradas y sin total, no se propone nada: antes de cobrar la persona confirma en cuántas se dividió.
  const sinConfirmar = pagadas > 0 && totalConocido === null;
  const partesRestantes = Math.min(
    MAXIMO_PARTES_IGUALES,
    Math.max(minimoDePartes, totalConocido === null ? minimoDePartes : totalConocido - pagadas),
  );
  const modoVigente: ModoDeCobro = soloIguales ? 'IGUALES' : modo;
  const porConfirmar = modoVigente === 'IGUALES' && sinConfirmar;
  const seleccion: Seleccion =
    modoVigente === 'IGUALES'
      ? { tipo: 'IGUALES', partesRestantes }
      : modoVigente === 'ITEMS'
        ? { tipo: 'ITEMS', unidades }
        : { tipo: 'TOTAL' };
  const soloConsumo = modoVigente === 'IGUALES';
  const formatoVigente: FormatoDeCobro = soloConsumo ? 'CONSUMO' : formato;

  const parte = useMemo(
    () =>
      !cuenta
        ? null
        : porConfirmar
          ? ({ ok: false, motivo: 'PARTES_SIN_CONFIRMAR' } as const)
          : calcularLaParte(cuenta, anteriores, seleccion, formatoVigente),
    // `seleccion` se reconstruye cada vez: lo que cuenta es lo que la compone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cuenta, anteriores, modoVigente, unidades, partesRestantes, formatoVigente, porConfirmar],
  );
  const totalDeLaParte = parte?.ok ? parte.total : TOTAL_VACIO;
  const padron = useClienteFactura(tipo, totalDeLaParte, cliente, setCliente);
  const clienteValidado = padron.validado;
  const resumen = useMemo(() => resumirPagos(totalDeLaParte, filas), [totalDeLaParte, filas]);

  // --- Pantallas previas al formulario ------------------------------------------------------------------
  if (consulta.error instanceof ErrorApi && !cuenta) {
    const sinCuenta = consulta.error.codigo === 'NO_ENCONTRADO';
    return (
      <Pagina titulo="Cobrar" atras={atras}>
        <EstadoVacio
          icono={IconoNota}
          titulo={sinCuenta ? 'Esta cuenta no existe' : 'No puedes cobrar esta cuenta'}
        >
          {sinCuenta
            ? 'Puede que se haya anulado o que no sea de esta sucursal. Vuelve atrás.'
            : 'Tu rol o el plan de la sucursal no incluye el cobro.'}
        </EstadoVacio>
      </Pagina>
    );
  }
  if (!cuenta || turnoConsulta.isPending) {
    return (
      <Pagina titulo="Cobrar" atras={atras}>
        {consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar la cuenta"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : (
          <EsqueletoDeLista filas={4} conInicial={false} etiqueta="Cargando la cuenta" />
        )}
      </Pagina>
    );
  }

  const titulo = tituloDeCuenta(cuenta);

  if (hecho) {
    return (
      <Pagina titulo="Cobro">
        <ResultadoDeCobro
          respuesta={hecho.respuesta}
          titulo={hecho.titulo}
          parteIgual={hecho.parteIgual}
          textoDeSeguir={
            hecho.parteIgual && hecho.parteIgual.numero < hecho.parteIgual.de
              ? `Cobrar la parte ${hecho.parteIgual.numero + 1} de ${hecho.parteIgual.de}`
              : 'Cobrar lo que falta'
          }
          onSeguir={() => {
            setHecho(null);
            setFallo(null);
            setIntentado(false);
            setUnidades({});
            setCliente(CLIENTE_VACIO);
            setTipo('BOLETA');
            setFilas([pagoNuevo('EFECTIVO')]);
            // Tras una parte igual siguen las demás, en las mismas partes.
            if (hecho.parteIgual) {
              setModo('IGUALES');
              setPartesTotales(hecho.parteIgual.de);
            } else {
              setModo('TOTAL');
            }
          }}
          volverA="/caja?ver=por-cobrar"
        />
      </Pagina>
    );
  }

  if (!turno) {
    return (
      <Pagina titulo={`Cobrar · ${titulo}`} atras={atras}>
        <EstadoVacio
          icono={IconoPago}
          titulo="Abre tu caja para cobrar"
          accion={
            <Link to="/caja" className={claseBoton('principal')}>
              Ir a Caja
            </Link>
          }
        >
          Cada cobro queda en un turno. Abre la caja con tu fondo y vuelve a esta cuenta.
        </EstadoVacio>
      </Pagina>
    );
  }

  if (cuenta.estado !== 'ABIERTA' && cuenta.estado !== 'EN_PRECUENTA') {
    return (
      <Pagina titulo={`Cobrar · ${titulo}`} atras={atras}>
        <EstadoVacio
          icono={IconoNota}
          titulo={
            cuenta.estado === 'UNIDA'
              ? 'Esta cuenta se unió a otra'
              : 'Esta cuenta ya no está abierta'
          }
          accion={
            <Link to="/caja?ver=por-cobrar" className={claseBoton('principal')}>
              Volver a Por cobrar
            </Link>
          }
        >
          {cuenta.estado === 'UNIDA'
            ? 'Se cobra desde la cuenta principal.'
            : 'Puede que ya se haya cobrado o anulado.'}
        </EstadoVacio>
      </Pagina>
    );
  }

  // --- Cobrar ------------------------------------------------------------------------------------------------
  const etiquetaDelBoton = !parte?.ok
    ? 'Cobrar'
    : `${enCurso && fallo?.repetir ? 'Reintentar el cobro' : modoVigente === 'IGUALES' ? `Cobrar la parte ${plan.pagadas.length + 1} de ${plan.pagadas.length + partesRestantes}` : 'Cobrar'} ${modoVigente === 'IGUALES' ? '· ' : ''}${montoEnSoles(parte.total) ?? ''}`;
  const motivo = !parte?.ok
    ? parte?.motivo === 'PARTES_SIN_CONFIRMAR'
      ? 'Confirma en cuántas partes se dividió la cuenta.'
      : null
    : !clienteValidado.ok
      ? motivoDelCliente(clienteValidado.errores)
      : resumen.problema === null
        ? null
        : intentado
          ? 'Revisa los pagos marcados.'
          : resumen.problema;

  async function intentarCobrar() {
    if (!cuenta || !turno || enviando.current) return;
    if (!parte?.ok || !clienteValidado.ok || resumen.pagos === null) {
      setIntentado(true);
      return;
    }
    enviando.current = true;
    setCobrando(true);
    setFallo(null);
    const base = {
      turnoId: turno.id,
      parte: parte.entrada,
      comprobante: {
        tipo,
        formato: formatoVigente,
        ...(clienteValidado.cliente ? { cliente: clienteValidado.cliente } : {}),
      },
      pagos: resumen.pagos,
      redondeo: resumen.redondeo,
    };
    // El mismo cobro conserva su `id` hasta una respuesta final; otro cobro (otros datos), otro `id`.
    const huella = huellaDeCobro(base);
    const guardado = leerEstadoDeCobro(claveEstado).enCurso;
    const id = guardado?.huella === huella ? guardado.id : nuevaClaveDeIdempotencia();
    recordarEnCurso({ id, huella });
    // Lo que se cobra como parte igual fija la división: la siguiente (aquí, tras recargar o en otro turno) sigue en ella.
    if (parte.entrada.tipo === 'IGUALES') {
      setPartesTotales(plan.pagadas.length + parte.entrada.partesRestantes);
    }
    try {
      const respuesta = await envio.enviar(
        (extra) =>
          cobrar(ordenId, { id, ...base, version: cuenta.version, total: parte.total }, extra),
        undefined,
        undefined,
        id,
      );
      recordarEnCurso(null);
      if (respuesta.cuenta.estado !== 'ABIERTA' && respuesta.cuenta.estado !== 'EN_PRECUENTA') {
        setPartesTotales(null);
      }
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
      setHecho({
        respuesta,
        titulo: tituloDeCuenta(cuenta),
        parteIgual:
          parte.entrada.tipo === 'IGUALES'
            ? {
                numero: plan.pagadas.length + 1,
                de: plan.pagadas.length + parte.entrada.partesRestantes,
              }
            : null,
      });
    } catch (error) {
      const traducido = falloDeCobro(error);
      const final =
        error instanceof ErrorApi &&
        error.codigo !== 'CONFLICTO' &&
        error.codigo !== 'ENVIO_CANCELADO' &&
        !error.sinConexion &&
        error.estado < 500;
      // Una respuesta final (la API contestó que no) suelta el `id`; un corte o un 5xx lo conserva para «Reintentar».
      if (final) recordarEnCurso(null);
      if (traducido.cuentaCambio || traducido.cuentaCerrada) {
        void clientes.invalidateQueries({ queryKey: claveDeCuenta(ordenId) });
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      }
      setFallo({ ...traducido, totalAlFallar: parte.total });
      setIntentado(true);
    } finally {
      enviando.current = false;
      setCobrando(false);
    }
  }

  const totalNuevo =
    fallo?.cuentaCambio && parte?.ok && fallo.totalAlFallar !== parte.total ? parte.total : null;

  return (
    <Pagina
      titulo={`Cobrar · ${titulo}`}
      atras={atras}
      pie={
        <div className="cobro__pie">
          {motivo ? (
            <p id="cobro-motivo" className="cobro__pie-motivo" role="status">
              {motivo}
            </p>
          ) : null}
          <Boton
            variante="principal"
            bloque
            cargando={cobrando}
            textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Cobrando…'}
            disabled={!parte?.ok}
            {...(motivo ? { 'aria-describedby': 'cobro-motivo' } : {})}
            onClick={() => void intentarCobrar()}
          >
            {etiquetaDelBoton}
          </Boton>
        </div>
      }
    >
      <div className="cobro">
        {borrador.lineas.length > 0 ? (
          <Aviso tipo="alerta" titulo="Hay ítems sin enviar en este equipo">
            <>
              Solo se cobra lo que ya se envió a cocina. Los{' '}
              {borrador.lineas.length === 1 ? 'ítem' : 'ítems'} que armaste en este equipo siguen
              sin enviar. <Link to={rutaDeOrden(ordenId)}>Ir a la cuenta de la mesa</Link>
            </>
          </Aviso>
        ) : null}
        {consulta.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar la cuenta">
            Lo que ves puede estar desactualizado. Seguimos intentando.
          </Aviso>
        ) : null}
        <AvisoPendiente pendiente={envio.pendiente} />
        {fallo ? (
          <div role="alert" ref={alertaDeFallo}>
            <Aviso
              tipo={fallo.cuentaCambio ? 'alerta' : 'error'}
              titulo={fallo.cuentaCambio ? 'La cuenta cambió' : 'No se pudo cobrar'}
            >
              <>
                {fallo.texto}
                {totalNuevo ? (
                  <>
                    {' '}
                    El total ahora es <b>{montoEnSoles(totalNuevo)}</b>.
                  </>
                ) : null}
                {fallo.cuentaCerrada || fallo.turno ? (
                  <>
                    {' '}
                    <Link
                      to={
                        fallo.ordenPrincipalId
                          ? rutaDeCobro(fallo.ordenPrincipalId)
                          : fallo.turno
                            ? '/caja'
                            : '/caja?ver=por-cobrar'
                      }
                    >
                      {fallo.ordenPrincipalId
                        ? 'Ir a la cuenta principal'
                        : fallo.turno
                          ? 'Ir a Caja'
                          : 'Volver a Por cobrar'}
                    </Link>
                  </>
                ) : null}
              </>
            </Aviso>
          </div>
        ) : null}

        <PartePanel
          cuenta={cuenta}
          porItems={!soloIguales}
          modo={modoVigente}
          onModo={setModo}
          unidades={unidades}
          onUnidades={setUnidades}
          partesElegidas={partesRestantes}
          onPartesElegidas={(faltan) => setPartesTotales(plan.pagadas.length + faltan)}
          plan={plan}
          parte={parte ?? { ok: false, motivo: 'VACIA' }}
          porConfirmar={
            porConfirmar
              ? {
                  total: totalPorConfirmar ?? Math.min(MAXIMO_PARTES_IGUALES, pagadas + 2),
                  onTotal: setTotalPorConfirmar,
                  onConfirmar: () =>
                    setPartesTotales(
                      totalPorConfirmar ?? Math.min(MAXIMO_PARTES_IGUALES, pagadas + 2),
                    ),
                }
              : null
          }
        />

        <DesgloseDeLaParte cuenta={cuenta} parte={parte} />

        {sePuedeAjustar(cuenta) ? (
          <Link
            to={rutaDeCuenta(ordenId)}
            state={{ desde: 'cobro' }}
            className={claseBoton('texto')}
          >
            Descuentos y cortesías
          </Link>
        ) : null}

        {parte?.ok && montoEsCero(parte.total) ? (
          <Aviso tipo="info" titulo="Esta parte no se cobra">
            Solo tiene cortesías: se emite el comprobante sin pagos.
          </Aviso>
        ) : (
          <>
            <ComprobantePanel
              permitidos={cuenta.parametros.tiposPermitidos}
              tipo={tipo}
              onTipo={setTipo}
              formato={formatoVigente}
              onFormato={setFormato}
              soloConsumo={soloConsumo}
              total={totalDeLaParte}
              cliente={cliente}
              onCliente={setCliente}
              errores={intentado && !clienteValidado.ok ? clienteValidado.errores : null}
              padron={padron}
            />
            <section className="cobro__bloque cobro__bloque--junta" aria-labelledby="cobro-pagos">
              <h2 id="cobro-pagos">Pagos</h2>
              <PagosPanel
                filas={filas}
                onFilas={setFilas}
                resumen={resumen}
                verProblemas={intentado}
              />
            </section>
          </>
        )}
      </div>
    </Pagina>
  );
}

/** Lo que se va a cobrar: subtotal, descuentos, ICBPER y el total en grande, con las cifras de `calcularParte`. */
function DesgloseDeLaParte({
  cuenta,
  parte,
}: {
  cuenta: CuentaRespuesta;
  parte: ReturnType<typeof calcularLaParte> | null;
}) {
  if (!parte?.ok) return null;
  const t = parte.calculada?.totales;
  return (
    <section className="cobro__bloque cobro__bloque--junta">
      {t ? (
        <dl className="desglose" aria-label="Desglose de la parte">
          {!montoEsCero(t.descuentos) || !montoEsCero(t.icbper) ? (
            <Fila etiqueta="Subtotal" valor={montoEnSoles(t.subtotal)} />
          ) : null}
          {!montoEsCero(t.descuentos) ? (
            <Fila etiqueta="Descuentos" valor={`−${montoEnSoles(t.descuentos) ?? ''}`} />
          ) : null}
          {!montoEsCero(t.icbper) ? (
            <Fila etiqueta="ICBPER" valor={montoEnSoles(t.icbper)} />
          ) : null}
          {cuenta.parametros.tasaIgv !== null ? (
            <Fila etiqueta="Incluye IGV" valor={montoEnSoles(t.igv)} ayuda />
          ) : null}
        </dl>
      ) : null}
      {cuenta.cobrado && !montoEsCero(cuenta.cobrado) ? (
        <p className="texto-ayuda">
          Ya se cobró {montoEnSoles(cuenta.cobrado)} de esta cuenta; quedan{' '}
          {montoEnSoles(cuenta.saldo)}.
        </p>
      ) : null}
      <div className="cobro__total" role="status" aria-live="polite">
        <span>Total a cobrar</span>
        <b>{montoEnSoles(parte.total)}</b>
      </div>
    </section>
  );
}

function Fila({
  etiqueta,
  valor,
  ayuda,
}: {
  etiqueta: string;
  valor: string | null;
  ayuda?: boolean;
}) {
  return (
    <div className={ayuda ? 'desglose__fila desglose__fila--ayuda' : 'desglose__fila'}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
