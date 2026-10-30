import type { PlanRespuesta, SuscripcionResumen } from '@restaurante/contratos';
import { MEDIOS_DE_PAGO } from '@restaurante/contratos';
import { estadoSuscripcion, fechaLima, sumarMeses } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  CampoSeleccion,
  CampoTexto,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Hoja,
  IconoPago,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, mensajeDeCampo, mensajeDeError, erroresPorCampo } from '../../lib/errores';
import { fechaLarga, formatearFecha } from '../../lib/formato';
import { formatearMonto } from '../../lib/monto';
import { useClaveDeEscritura } from './claves';
import { validarFechaOpcional, validarMotivo, type Errores } from './empresa-form';
import {
  CLAVES,
  NOMBRE_DE_MEDIO,
  TEXTO_DE_ESTADO,
  listarPlanes,
  listarSuscripciones,
  modificarSuscripcion,
  registrarPago,
  textoDeConsumo,
} from './plataforma';

const FORMATO_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

/** Monto escrito por una persona ("120", "120.5", "120,50") como texto decimal de la API; `null` si no vale. */
export function montoNormalizado(texto: string): string | null {
  const t = texto.trim().replace(',', '.');
  if (!FORMATO_MONTO.test(t) || new Decimal(t).lte(0)) return null;
  return t;
}

type Hojas = 'pago' | 'plan' | 'vencimiento' | null;

function comoErrorApi(e: unknown): ErrorApi {
  return e instanceof ErrorApi
    ? e
    : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
}

/** Detalle de la suscripción de una sucursal con sus tres acciones (criterio 101). */
export function SuscripcionDetallePagina() {
  const { id = '' } = useParams();
  const clientes = useQueryClient();
  const [hoja, setHoja] = useState<Hojas>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const consulta = useQuery({
    queryKey: CLAVES.suscripciones(),
    queryFn: ({ signal }) => listarSuscripciones(undefined, signal),
  });
  const planes = useQuery({
    queryKey: CLAVES.planes,
    queryFn: ({ signal }) => listarPlanes(signal),
  });
  const atras = { a: '/plataforma/suscripciones', etiqueta: 'Suscripciones' };
  const s = consulta.data?.find((x) => x.id === id);

  function cerrarYAvisar(texto: string) {
    setHoja(null);
    setAviso(texto);
    void clientes.invalidateQueries({ queryKey: ['plataforma'] });
  }

  if (consulta.isPending) {
    return (
      <Pagina titulo="Suscripción" plataforma atras={atras}>
        <EsqueletoDeLista etiqueta="Cargando la suscripción" conInicial={false} filas={3} />
      </Pagina>
    );
  }
  if (consulta.isError) {
    return (
      <Pagina titulo="Suscripción" plataforma atras={atras}>
        <ErrorDeCarga
          titulo="No pudimos cargar la suscripción"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  if (!s) {
    return (
      <Pagina titulo="Suscripción" plataforma atras={atras}>
        <Aviso tipo="error" titulo="No encontramos esta suscripción">
          Puede que ya no exista. Vuelve a la lista de suscripciones.
        </Aviso>
      </Pagina>
    );
  }

  const estado = TEXTO_DE_ESTADO[s.estado];
  const planActual = planes.data?.find((p) => p.id === s.plan.id);
  return (
    <Pagina
      titulo={s.sucursalNombre}
      plataforma
      atras={atras}
      pie={
        <Boton variante="principal" bloque icono={IconoPago} onClick={() => setHoja('pago')}>
          Registrar pago
        </Boton>
      }
    >
      <div className="encabezado-de-detalle">
        <p className="ui-subtitulo">
          <Link to={`/plataforma/empresas/${s.empresaId}`} className="enlace-texto">
            {s.empresaNombre}
          </Link>
        </p>
        <EtiquetaDeEstado tono={estado.tono}>{estado.texto}</EtiquetaDeEstado>
      </div>

      {aviso ? (
        <Aviso tipo="ok" titulo="Listo">
          {aviso}
        </Aviso>
      ) : null}
      {s.estado === 'EN_GRACIA' ? (
        <Aviso tipo="alerta" titulo={`Quedan ${s.diasRestantesGracia ?? 0} días de gracia`}>
          {`Se suspenderá el ${fechaLarga(s.suspensionDesde)} si no se registra un pago.`}
        </Aviso>
      ) : null}
      {s.estado === 'SUSPENDIDA' ? (
        <Aviso tipo="error" titulo="Sucursal suspendida">
          {`Desde el ${fechaLarga(s.suspensionDesde)} no puede abrir caja. Consultar y exportar sus datos sigue funcionando. Un pago la reactiva.`}
        </Aviso>
      ) : null}

      <section className="seccion" aria-labelledby="t-datos">
        <h2 className="formulario__titulo" id="t-datos">
          Suscripción
        </h2>
        <dl className="datos">
          <dt>Plan</dt>
          <dd>{s.plan.nombre}</dd>
          <dt>Vence</dt>
          <dd>{fechaLarga(s.vencimiento)}</dd>
          <dt>Se suspende</dt>
          <dd>{fechaLarga(s.suspensionDesde)}</dd>
        </dl>
        <div className="acciones-de-detalle">
          <Boton bloque onClick={() => setHoja('plan')}>
            Cambiar plan
          </Boton>
          <Boton bloque onClick={() => setHoja('vencimiento')}>
            Ajustar vencimiento
          </Boton>
        </div>
      </section>

      <section className="seccion" aria-labelledby="t-consumo">
        <h2 className="formulario__titulo" id="t-consumo">
          Comprobantes emitidos
        </h2>
        <dl className="datos">
          <dt>{`Este mes (${s.consumoMesActual.periodo})`}</dt>
          <dd>{consumo(s.consumoMesActual)}</dd>
          <dt>{`Mes anterior (${s.consumoMesAnterior.periodo})`}</dt>
          <dd>{consumo(s.consumoMesAnterior)}</dd>
        </dl>
      </section>

      <HojaPago
        key={`pago-${hoja === 'pago'}`}
        abierta={hoja === 'pago'}
        s={s}
        plan={planActual}
        onCerrar={() => setHoja(null)}
        onListo={cerrarYAvisar}
      />
      <HojaPlan
        key={`plan-${hoja === 'plan'}`}
        abierta={hoja === 'plan'}
        s={s}
        planes={planes.data ?? []}
        onCerrar={() => setHoja(null)}
        onListo={cerrarYAvisar}
      />
      <HojaVencimiento
        key={`vencimiento-${hoja === 'vencimiento'}`}
        abierta={hoja === 'vencimiento'}
        s={s}
        onCerrar={() => setHoja(null)}
        onListo={cerrarYAvisar}
      />
    </Pagina>
  );
}

function consumo(c: SuscripcionResumen['consumoMesActual']): string {
  const base = c.cuota === null ? `${c.emitidos} · sin cuota definida` : textoDeConsumo(c);
  return c.excedente > 0 ? `${base} · ${c.excedente} de más` : base;
}

interface PropsHoja {
  abierta: boolean;
  s: SuscripcionResumen;
  onCerrar: () => void;
  onListo: (aviso: string) => void;
}

/** Registrar un pago: el vencimiento nuevo se sugiere un mes después del actual. */
function HojaPago({
  abierta,
  s,
  plan,
  onCerrar,
  onListo,
}: PropsHoja & { plan: PlanRespuesta | undefined }) {
  const clave = useClaveDeEscritura();
  const hoy = fechaLima(new Date());
  const sugerido = sumarMeses(s.vencimiento, 1);
  const [monto, setMonto] = useState('');
  const [fechaPago, setFechaPago] = useState(hoy);
  const [medio, setMedio] = useState<(typeof MEDIOS_DE_PAGO)[number]>('TRANSFERENCIA');
  const [referencia, setReferencia] = useState('');
  const [vencimientoNuevo, setVencimientoNuevo] = useState(sugerido);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Cómo quedaría la sucursal con ese vencimiento (se calcula con las reglas de `packages/dominio`).
  const resultante =
    plan && /^\d{4}-\d{2}-\d{2}$/.test(vencimientoNuevo) && vencimientoNuevo > s.vencimiento
      ? safeEstado(vencimientoNuevo, plan.diasGracia)
      : null;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos: Errores = {};
    const montoTexto = montoNormalizado(monto);
    if (!montoTexto)
      nuevos.monto = 'Escribe el monto en soles, mayor que 0 y con hasta 2 decimales (120.00)';
    const errorPago = validarFechaOpcional(fechaPago, '0000-00-00');
    if (fechaPago.trim() === '') nuevos.fechaPago = 'Elige la fecha del pago';
    else if (errorPago) nuevos.fechaPago = errorPago;
    else if (fechaPago > hoy) nuevos.fechaPago = 'El pago no puede ser de una fecha futura';
    if (vencimientoNuevo.trim() === '') nuevos.vencimientoNuevo = 'Elige el vencimiento nuevo';
    else if (validarFechaOpcional(vencimientoNuevo, '0000-00-00'))
      nuevos.vencimientoNuevo = 'Elige una fecha válida';
    else if (vencimientoNuevo <= s.vencimiento)
      nuevos.vencimientoNuevo = `Debe ser posterior al vencimiento actual (${formatearFecha(s.vencimiento)})`;
    if (referencia.trim().length > 100) nuevos.referencia = 'Usa 100 caracteres como máximo';
    const m = validarMotivo(motivo);
    if (m) nuevos.motivo = m;
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0 || !montoTexto) return;

    setEnviando(true);
    try {
      await registrarPago(
        s.id,
        {
          monto: montoTexto,
          fechaPago,
          medio,
          ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
          vencimientoNuevo,
          motivo: motivo.trim(),
        },
        clave.obtener(),
      );
      clave.soltar();
      onListo(
        `Pago de S/ ${formatearMonto(montoTexto) ?? montoTexto} registrado. La suscripción vence el ${fechaLarga(vencimientoNuevo)}.`,
      );
    } catch (e) {
      const error = comoErrorApi(e);
      clave.alFallar(error);
      const campos = erroresPorCampo(error);
      if (error.codigo === 'DATOS_INVALIDOS' && Object.keys(campos).length > 0) {
        setErrores(
          Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, mensajeDeCampo(v)])),
        );
        setFallo('Revisa los datos marcados e inténtalo de nuevo.');
      } else if (error.reintentada) {
        setFallo(
          'La conexión se cortó y no sabemos si el pago quedó registrado. Vuelve a tocar "Registrar pago": si ya estaba, no se duplicará.',
        );
      } else {
        setFallo(mensajeDeError(error));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Registrar pago">
      <form className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto
          etiqueta="Monto (S/)"
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          error={errores.monto}
          autoComplete="off"
          placeholder="120.00"
        />
        <CampoTexto
          etiqueta="Fecha del pago"
          type="date"
          max={hoy}
          value={fechaPago}
          onChange={(e) => setFechaPago(e.target.value)}
          error={errores.fechaPago}
        />
        <CampoSeleccion
          etiqueta="Medio de pago"
          value={medio}
          onChange={(e) => setMedio(e.target.value as typeof medio)}
          error={errores.medio}
        >
          {MEDIOS_DE_PAGO.map((m) => (
            <option key={m} value={m}>
              {NOMBRE_DE_MEDIO[m]}
            </option>
          ))}
        </CampoSeleccion>
        <CampoTexto
          etiqueta="Referencia"
          opcional
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          error={errores.referencia}
          ayuda="Número de operación, de voucher o de Yape."
          autoComplete="off"
        />
        <CampoTexto
          etiqueta="Vencimiento nuevo"
          type="date"
          value={vencimientoNuevo}
          onChange={(e) => setVencimientoNuevo(e.target.value)}
          error={errores.vencimientoNuevo}
          ayuda={`Sugerido: un mes después del actual (${formatearFecha(sugerido)}).`}
        />
        {resultante ? (
          <Aviso
            tipo={
              resultante.estado === 'ACTIVA'
                ? 'ok'
                : resultante.estado === 'EN_GRACIA'
                  ? 'alerta'
                  : 'error'
            }
            titulo={`Con este vencimiento la sucursal quedará ${TEXTO_DE_ESTADO[resultante.estado].texto.toLowerCase()}`}
          >
            {resultante.estado === 'SUSPENDIDA'
              ? 'Sigue sin poder abrir caja: elige un vencimiento posterior.'
              : `Se suspendería el ${fechaLarga(resultante.suspensionDesde)} si no hay otro pago.`}
          </Aviso>
        ) : null}
        <CampoAreaTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
          ayuda="Queda registrado con tu nombre. Por ejemplo: pago de noviembre por transferencia."
          maxLength={300}
          rows={2}
        />
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos registrar el pago">
            {fallo}
          </Aviso>
        ) : null}
        <Boton
          type="submit"
          variante="principal"
          bloque
          cargando={enviando}
          textoCargando="Registrando…"
        >
          Registrar pago
        </Boton>
        <Boton bloque onClick={onCerrar} disabled={enviando}>
          Cancelar
        </Boton>
      </form>
    </Hoja>
  );
}

function safeEstado(vencimiento: string, diasGracia: number) {
  try {
    return estadoSuscripcion({ vencimiento, diasGracia }, new Date());
  } catch {
    return null;
  }
}

/** Cambiar el plan de la suscripción: rige desde la siguiente petición de la sucursal. */
function HojaPlan({
  abierta,
  s,
  planes,
  onCerrar,
  onListo,
}: PropsHoja & { planes: PlanRespuesta[] }) {
  const [planId, setPlanId] = useState(s.plan.id);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const opciones = planes.filter((p) => p.activo || p.id === s.plan.id);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos: Errores = {};
    if (planId === s.plan.id) nuevos.planId = 'Elige un plan distinto del actual';
    const m = validarMotivo(motivo);
    if (m) nuevos.motivo = m;
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      await modificarSuscripcion(s.id, { planId, motivo: motivo.trim() });
      const nuevo = planes.find((p) => p.id === planId);
      onListo(
        `El plan ahora es ${nuevo?.nombre ?? 'el elegido'}. Rige desde la siguiente acción de la sucursal.`,
      );
    } catch (e) {
      setFallo(mensajeDeError(comoErrorApi(e)));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Cambiar plan">
      <form className="formulario" onSubmit={enviar} noValidate>
        <CampoSeleccion
          etiqueta="Plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          error={errores.planId}
          ayuda={`Plan actual: ${s.plan.nombre}.`}
        >
          {opciones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
              {p.id === s.plan.id ? ' (actual)' : ''}
            </option>
          ))}
        </CampoSeleccion>
        <CampoAreaTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
          ayuda="Queda registrado con tu nombre."
          maxLength={300}
          rows={2}
        />
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos cambiar el plan">
            {fallo}
          </Aviso>
        ) : null}
        <Boton
          type="submit"
          variante="principal"
          bloque
          cargando={enviando}
          textoCargando="Guardando…"
        >
          Cambiar plan
        </Boton>
        <Boton bloque onClick={onCerrar} disabled={enviando}>
          Cancelar
        </Boton>
      </form>
    </Hoja>
  );
}

/** Fijar el vencimiento a cualquier fecha: sirve para corregir un pago mal registrado. */
function HojaVencimiento({ abierta, s, onCerrar, onListo }: PropsHoja) {
  const [vencimiento, setVencimiento] = useState(s.vencimiento);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos: Errores = {};
    if (vencimiento.trim() === '') nuevos.vencimiento = 'Elige la fecha de vencimiento';
    else if (validarFechaOpcional(vencimiento, '0000-00-00'))
      nuevos.vencimiento = 'Elige una fecha válida';
    else if (vencimiento === s.vencimiento)
      nuevos.vencimiento = 'Elige una fecha distinta de la actual';
    const m = validarMotivo(motivo);
    if (m) nuevos.motivo = m;
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      await modificarSuscripcion(s.id, { vencimiento, motivo: motivo.trim() });
      onListo(`El vencimiento ahora es el ${fechaLarga(vencimiento)}.`);
    } catch (e) {
      setFallo(mensajeDeError(comoErrorApi(e)));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Ajustar vencimiento">
      <form className="formulario" onSubmit={enviar} noValidate>
        <Aviso tipo="info">
          Úsalo para corregir un pago mal registrado. Para un pago nuevo, usa "Registrar pago".
        </Aviso>
        <CampoTexto
          etiqueta="Vencimiento"
          type="date"
          value={vencimiento}
          onChange={(e) => setVencimiento(e.target.value)}
          error={errores.vencimiento}
          ayuda={`Actual: ${formatearFecha(s.vencimiento)}.`}
        />
        <CampoAreaTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
          ayuda="Queda registrado con tu nombre. Por ejemplo: el pago del 10/11 se anotó con fecha equivocada."
          maxLength={300}
          rows={2}
        />
        {fallo ? (
          <Aviso tipo="error" titulo="No pudimos ajustar el vencimiento">
            {fallo}
          </Aviso>
        ) : null}
        <Boton
          type="submit"
          variante="principal"
          bloque
          cargando={enviando}
          textoCargando="Guardando…"
        >
          Ajustar vencimiento
        </Boton>
        <Boton bloque onClick={onCerrar} disabled={enviando}>
          Cancelar
        </Boton>
      </form>
    </Hoja>
  );
}
