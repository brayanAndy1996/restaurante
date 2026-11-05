import type { CobroRespuesta, CuentaRespuesta } from '@restaurante/contratos';
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
import { useMemo, useRef, useState } from 'react';
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
  resumirPagos,
  rutaDeCobro,
  validarCliente,
  type ClienteEscrito,
  type FalloDeCobro,
  type FormatoDeCobro,
  type PagoEscrito,
  type Seleccion,
} from './cobro';
import { ComprobantePanel } from './ComprobantePanel';
import { claveDeCuenta, leerCuenta, tituloDeCuenta } from './cuenta';
import {
  COBRO_VACIO,
  anterioresConocidas,
  claveDeCobro,
  guardarEstadoDeCobro,
  igualesCobradas,
  leerEstadoDeCobro,
  type EstadoDeCobro,
} from './partes';
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

  const [estado, setEstadoLocal] = useState<EstadoDeCobro>(() => leerEstadoDeCobro(claveEstado));
  const guardar = (nuevo: EstadoDeCobro) => {
    setEstadoLocal(nuevo);
    guardarEstadoDeCobro(claveEstado, nuevo);
  };

  const [modo, setModo] = useState<ModoDeCobro>(() => (estado.iguales ? 'IGUALES' : 'TOTAL'));
  const [unidades, setUnidades] = useState<Record<string, number>>({});
  const [partesElegidas, setPartesElegidas] = useState(2);
  const [tipo, setTipo] = useState<'BOLETA' | 'FACTURA'>('BOLETA');
  const [formato, setFormato] = useState<FormatoDeCobro>('DETALLADO');
  const [cliente, setCliente] = useState<ClienteEscrito>(CLIENTE_VACIO);
  const [filas, setFilas] = useState<PagoEscrito[]>(() => [pagoNuevo('EFECTIVO')]);
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState<FalloMostrado | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const enviando = useRef(false);
  const [cobrando, setCobrando] = useState(false);

  // --- Lo que se cobra ---------------------------------------------------------------------------------
  const anteriores = cuenta ? anterioresConocidas(cuenta.cobros, estado) : [];
  const hechas = cuenta ? igualesCobradas(cuenta.cobros, estado) : 0;
  const planGuardado = estado.iguales && hechas > 0 && hechas < estado.iguales.partes;
  const plan: PlanDeIguales | null =
    planGuardado && cuenta && estado.iguales
      ? {
          partes: estado.iguales.partes,
          numeros: estado.iguales.cobroIds
            .map((id) => cuenta.cobros.find((c) => c.id.toLowerCase() === id.toLowerCase()))
            .filter((c): c is NonNullable<typeof c> => c !== undefined)
            .map((c) => c.comprobante.numero),
        }
      : null;
  const sePuedeDividir =
    cuenta !== undefined && anteriores !== null && (cuenta.modo !== 'IGUALES' || plan !== null);
  const modoVigente: ModoDeCobro = !sePuedeDividir ? 'TOTAL' : plan ? 'IGUALES' : modo;
  const partesRestantes = plan ? plan.partes - plan.numeros.length : partesElegidas;
  const seleccion: Seleccion =
    modoVigente === 'IGUALES'
      ? { tipo: 'IGUALES', partesRestantes }
      : modoVigente === 'ITEMS'
        ? { tipo: 'ITEMS', unidades }
        : { tipo: 'TOTAL' };
  const soloConsumo = modoVigente === 'IGUALES' || cuenta?.modo === 'IGUALES';
  const formatoVigente: FormatoDeCobro = soloConsumo ? 'CONSUMO' : formato;

  const parte = useMemo(
    () =>
      cuenta
        ? calcularLaParte(cuenta, sePuedeDividir ? anteriores : null, seleccion, formatoVigente)
        : null,
    // `seleccion` se reconstruye cada vez: lo que cuenta es lo que la compone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cuenta, estado, modoVigente, unidades, partesRestantes, formatoVigente, sePuedeDividir],
  );
  const totalDeLaParte = parte?.ok ? parte.total : TOTAL_VACIO;
  const clienteValidado = validarCliente(tipo, totalDeLaParte, cliente);
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
      <Pagina titulo={`Cobrar · ${titulo}`}>
        <ResultadoDeCobro
          respuesta={hecho.respuesta}
          titulo={hecho.titulo}
          parteIgual={hecho.parteIgual}
          textoDeSeguir={
            estado.iguales && hechas < estado.iguales.partes
              ? `Cobrar la parte ${hechas + 1} de ${estado.iguales.partes}`
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
            setModo(estado.iguales ? 'IGUALES' : 'TOTAL');
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
  const listo =
    parte?.ok === true && clienteValidado.ok && resumen.pagos !== null && !cobrando && !!turno;
  const etiquetaDelBoton = !parte?.ok
    ? 'Cobrar'
    : `${estado.enCurso && fallo?.repetir ? 'Reintentar el cobro' : modoVigente === 'IGUALES' ? `Cobrar la parte ${(plan?.numeros.length ?? 0) + 1} de ${plan?.partes ?? partesElegidas}` : 'Cobrar'} ${modoVigente === 'IGUALES' ? '· ' : ''}${montoEnSoles(parte.total) ?? ''}`;
  const motivo = !parte?.ok
    ? null
    : !clienteValidado.ok
      ? 'Faltan los datos del cliente.'
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
    const actual = leerEstadoDeCobro(claveEstado);
    const id = actual.enCurso?.huella === huella ? actual.enCurso.id : nuevaClaveDeIdempotencia();
    guardar({ ...actual, enCurso: { id, huella } });
    try {
      const respuesta = await envio.enviar(
        (extra) =>
          cobrar(ordenId, { id, ...base, version: cuenta.version, total: parte.total }, extra),
        undefined,
        undefined,
        id,
      );
      const despues = leerEstadoDeCobro(claveEstado);
      const cobradas = parte.calculada
        ? [...despues.cobradas, { cobroId: respuesta.id, parte: parte.calculada }]
        : despues.cobradas;
      const iguales =
        parte.entrada.tipo === 'IGUALES'
          ? {
              partes: despues.iguales?.partes ?? parte.entrada.partesRestantes,
              cobroIds: [...(despues.iguales?.cobroIds ?? []), respuesta.id],
            }
          : despues.iguales;
      const cerrada = respuesta.cuenta.estado === 'CERRADA';
      guardar(cerrada ? COBRO_VACIO : { cobradas, iguales, enCurso: null });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
      setHecho({
        respuesta,
        titulo: tituloDeCuenta(cuenta),
        parteIgual:
          parte.entrada.tipo === 'IGUALES' && iguales
            ? { numero: iguales.cobroIds.length, de: iguales.partes }
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
      if (final) guardar({ ...leerEstadoDeCobro(claveEstado), enCurso: null });
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
            <p className="cobro__pie-motivo" role="status">
              {motivo}
            </p>
          ) : null}
          <Boton
            variante="principal"
            bloque
            cargando={cobrando}
            textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Cobrando…'}
            disabled={!parte?.ok}
            aria-disabled={!listo || undefined}
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
          <div role="alert">
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
          sePuedeDividir={sePuedeDividir}
          porItems={cuenta.modo !== 'IGUALES' && plan === null}
          modo={modoVigente}
          onModo={setModo}
          unidades={unidades}
          onUnidades={setUnidades}
          partesElegidas={partesElegidas}
          onPartesElegidas={setPartesElegidas}
          plan={plan}
          parte={parte ?? { ok: false, motivo: 'VACIA' }}
        />

        <DesgloseDeLaParte cuenta={cuenta} parte={parte} />

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
          <Fila etiqueta="Subtotal" valor={montoEnSoles(t.subtotal)} />
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
