import type { LineaDeLlamado, LlamadoDetalle, LineaParaBorrador } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoAlerta,
  IconoBasura,
  IconoDeshacer,
  IconoLlamarMozo,
  IconoOk,
  Segmentos,
  SelectorDeCantidad,
  nombreAccesibleDeMesa,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { horaDeLima } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import { AbrirMesaHoja } from '../salon/AbrirMesaHoja';
import { agregarLineasDeLlamado, claveDeBorrador, useBorrador } from '../salon/borrador';
import { textoDeRechazo } from '../salon/enviar-borrador';
import { rutaDeLlamados, rutaDeOrden } from '../salon/salon';
import { useSalon } from '../salon/useSalon';
import { textoDeCerrado, useAtencion } from './AtencionDeLlamado';
import {
  TEXTO_DE_TIPO,
  claveDetalleDeLlamado,
  descartarLlamado,
  estadoDeLlamado,
  lineasParaPasar,
  lineasParaRecuperar,
  montosIguales,
  motivoParaNoPasar,
  pasarLlamadoACuenta,
  textoDeAntiguedad,
  textoDePlatos,
  totalDeLineaDeLlamado,
  totalDeLineasDeLlamado,
  type EdicionDeLinea,
} from './llamados';
import { useAhoraDeLlamados, useDetalleDeLlamado, useLlamados } from './useLlamados';
import './llamados.css';

const MENSAJES_DE_PASO = {
  NO_ENCONTRADO: 'Este llamado ya no existe o no es de tu sucursal.',
  TRANSICION_INVALIDA: 'Este llamado todavía no se puede pasar a la cuenta. Atiéndelo primero.',
  MONTO_FUERA_DE_RANGO: 'El total del pedido pasaría del máximo permitido. Baja alguna cantidad.',
} as const;

const MENSAJES_DE_DESCARTE = {
  NO_ENCONTRADO: 'Este llamado ya no existe o no es de tu sucursal.',
  LLAMADO_VENCIDO: 'Este llamado venció sin que nadie lo atendiera.',
} as const;

const MOTIVOS_DE_DESCARTE: readonly OpcionDeSegmento<string>[] = [
  { valor: '', etiqueta: 'Sin motivo' },
  { valor: 'Pedido falso', etiqueta: 'Pedido falso' },
  { valor: 'Ya lo pidió al mozo', etiqueta: 'Ya lo pidió al mozo' },
  { valor: 'Repetido', etiqueta: 'Repetido' },
];

/** `/salon/llamados/:id`: revisar un llamado con el cliente, ajustarlo y pasarlo a la cuenta o descartarlo (criterio 71). */
export function LlamadoDetallePagina() {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Llamado" atras={{ a: rutaDeLlamados(), etiqueta: 'Llamados' }}>
        <EstadoVacio icono={IconoLlamarMozo} titulo="Elige una sucursal">
          Los llamados son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Detalle
      key={`${id}.${sesion.usuario?.id ?? 'soporte'}.${sesion.sucursal.id}`}
      llamadoId={id}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? null}
      sucursalId={sesion.sucursal.id}
    />
  );
}

/** Campo de una línea rechazada al pasar: `lineas.<n>`; el mensaje trae "Posición N: CÓDIGO". */
function rechazosDelPaso(
  error: ErrorApi,
  enviadas: readonly { posicion: number }[],
): Record<number, string> {
  const porPosicion: Record<number, string> = {};
  for (const campo of error.campos) {
    const m = /^lineas\.(\d+)/.exec(campo.campo);
    if (!m) continue;
    const n = Number(m[1]);
    const conPosicion = /^Posición (\d+)/.exec(campo.mensaje);
    // La posición del mensaje manda; si no viene, `n` es la posición si existe entre las enviadas y, si no, el índice.
    const posicion = conPosicion
      ? Number(conPosicion[1])
      : enviadas.some((l) => l.posicion === n)
        ? n
        : (enviadas[n]?.posicion ?? n);
    if (porPosicion[posicion] === undefined) porPosicion[posicion] = textoDeRechazo(campo.mensaje);
  }
  return porPosicion;
}

function Detalle({
  llamadoId,
  empresaId,
  usuarioId,
  sucursalId,
}: {
  llamadoId: string;
  empresaId: string;
  usuarioId: string | null;
  sucursalId: string;
}) {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const clientes = useQueryClient();
  const consulta = useDetalleDeLlamado(llamadoId);
  const detalle = consulta.data;
  // La hora del servidor sale de la lista de llamados (que ya está en caché o se pide aquí): "hace 3 min" y el
  // vencimiento no dependen del reloj del equipo.
  const lista = useLlamados(sucursalId);
  const ahora = useAhoraDeLlamados(lista.data);
  const atencion = useAtencion();
  const salon = useSalon(sucursalId);
  const envio = useEnvioPendiente();

  const [ediciones, setEdiciones] = useState<Record<number, EdicionDeLinea>>({});
  const [rechazos, setRechazos] = useState<Record<number, string>>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [sinCuenta, setSinCuenta] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState<string>('');
  const [falloDeDescarte, setFalloDeDescarte] = useState<string | null>(null);
  const [descartado, setDescartado] = useState(false);
  // Otra persona ya había pasado este pedido: no se agrega nada al borrador de quien lo vio después.
  const [pasoAjeno, setPasoAjeno] = useState(false);
  // «Agregar a mi borrador» de un pedido que ya se pasó (recuperarlo).
  const [recuperando, setRecuperando] = useState(false);
  const [falloDeRecuperar, setFalloDeRecuperar] = useState<string | null>(null);
  const [sinAgregar, setSinAgregar] = useState<{
    ordenId: string;
    lineas: LineaParaBorrador[];
  } | null>(null);

  // El borrador de la cuenta de la mesa: si tiene un envío en curso, no se le pueden sumar líneas (criterio 72).
  const ordenDeLaMesa = detalle?.ordenId ?? null;
  const borrador = useBorrador(
    ordenDeLaMesa ? claveDeBorrador(empresaId, usuarioId, ordenDeLaMesa) : '',
  );
  const conEnvioEnCurso = ordenDeLaMesa !== null && borrador.envioId !== null;

  const pasar = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: { lineas: { posicion: number; cantidad: number }[] }) =>
      envio.enviar((extra) => pasarLlamadoACuenta(llamadoId, entrada, extra)),
    onSuccess: (respuesta) => {
      clientes.setQueryData(claveDetalleDeLlamado(llamadoId), respuesta.llamado);
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
      // Solo quien lo pasó recibe las líneas en su borrador: si el servidor devuelve un paso ajeno (una réplica de
      // otra persona), agregarlas aquí enviaría el pedido dos veces.
      if (usuarioId === null || respuesta.llamado.cerradoPor?.id !== usuarioId) {
        if (envio.sigueMontada()) setPasoAjeno(true);
        return;
      }
      // Las líneas van al borrador de esa cuenta en este equipo: nada llega a cocina hasta que se pulse «Enviar».
      const resultado = agregarLineasDeLlamado(
        claveDeBorrador(empresaId, usuarioId, respuesta.ordenId),
        llamadoId,
        respuesta.lineas,
      );
      if (resultado === 'bloqueado') {
        if (envio.sigueMontada())
          setSinAgregar({ ordenId: respuesta.ordenId, lineas: respuesta.lineas });
        return;
      }
      if (envio.sigueMontada())
        navegar(rutaDeOrden(respuesta.ordenId), { state: { revisaElPedido: true } });
    },
    onError: (error, entrada) => {
      if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
      }
      if (!envio.sigueMontada()) return;
      if (error instanceof ErrorApi && error.codigo === 'MESA_SIN_CUENTA') {
        setSinCuenta(true);
        return;
      }
      if (error instanceof ErrorApi && error.estado === 422) {
        const motivos = rechazosDelPaso(error, entrada.lineas);
        if (Object.keys(motivos).length > 0) {
          setRechazos(motivos);
          setFallo(
            Object.keys(motivos).length === 1
              ? 'Una línea no pasó. Quítala y vuelve a intentarlo.'
              : 'Algunas líneas no pasaron. Quítalas y vuelve a intentarlo.',
          );
          return;
        }
      }
      if (error instanceof ErrorApi && error.codigo === 'LLAMADO_CERRADO') {
        // Otra persona ya lo pasó: se dice quién y cuándo con el detalle que se vuelve a leer.
        if (error.estadoDelLlamado === 'PASADO_A_CUENTA') setPasoAjeno(true);
        else setFallo(textoDeCerrado(error.estadoDelLlamado));
        return;
      }
      setFallo(mensajeDeError(error, MENSAJES_DE_PASO));
    },
  });

  const descarte = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: { motivo?: string }) =>
      envio.enviar((extra) => descartarLlamado(llamadoId, entrada, extra)),
    onSuccess: (respuesta) => {
      clientes.setQueryData(claveDetalleDeLlamado(llamadoId), respuesta);
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
      if (!envio.sigueMontada()) return;
      setDescartando(false);
      setDescartado(true);
    },
    onError: (error) => {
      if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.llamados });
      }
      if (!envio.sigueMontada()) return;
      setFalloDeDescarte(
        error instanceof ErrorApi && error.codigo === 'LLAMADO_CERRADO'
          ? textoDeCerrado(error.estadoDelLlamado)
          : mensajeDeError(error, MENSAJES_DE_DESCARTE),
      );
    },
  });

  if (consulta.error instanceof ErrorApi && consulta.error.codigo === 'NO_ENCONTRADO' && !detalle) {
    return (
      <Pagina titulo="Llamado" atras={{ a: rutaDeLlamados(), etiqueta: 'Llamados' }}>
        <EstadoVacio icono={IconoLlamarMozo} titulo="Este llamado no existe">
          Puede que no sea de esta sucursal. Vuelve a la lista de llamados.
        </EstadoVacio>
      </Pagina>
    );
  }
  if (!detalle) {
    return (
      <Pagina titulo="Llamado" atras={{ a: rutaDeLlamados(), etiqueta: 'Llamados' }}>
        {consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar el llamado"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            Revisa tu conexión e inténtalo de nuevo.
          </ErrorDeCarga>
        ) : (
          <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando el llamado" />
        )}
      </Pagina>
    );
  }

  // El detalle ya llega con el estado vigente del servidor; con la hora del servidor a mano se mantiene al día.
  const estado = lista.data ? estadoDeLlamado(detalle, ahora) : detalle.estado;
  const esPedido = detalle.tipo === 'PEDIDO';
  const pendiente = estado === 'PENDIENTE';
  const enAtencion = estado === 'ATENDIDO' && esPedido;
  const puedeDescartar = pendiente || enAtencion;
  const mesa = nombreAccesibleDeMesa(detalle.mesa.nombre);
  const mesaDelSalon = salon.data?.salon.zonas
    .flatMap((z) => z.mesas)
    .find((m) => m.id === detalle.mesa.id);
  const mesaAbiertaAhora =
    (ubicacion.state as { mesaAbierta?: boolean } | null)?.mesaAbierta === true;

  const motivoNoPasar = enAtencion ? motivoParaNoPasar(detalle, ediciones, conEnvioEnCurso) : null;
  const quedan = detalle.lineas.filter((l) => !ediciones[l.posicion]?.quitada);
  const quitadas = detalle.lineas.filter((l) => ediciones[l.posicion]?.quitada);
  const cantidadDe = (l: LineaDeLlamado) => ediciones[l.posicion]?.cantidad ?? l.cantidad;
  const totalAPasar = totalDeLineasDeLlamado(
    quedan.flatMap((l) =>
      l.revision.disponible
        ? [{ precioUnitario: l.revision.precioUnitario, cantidad: cantidadDe(l) }]
        : [],
    ),
  );

  function editar(posicion: number, cambio: Partial<EdicionDeLinea>, linea: LineaDeLlamado) {
    setRechazos((r) => {
      const { [posicion]: _quitado, ...resto } = r;
      return resto;
    });
    setEdiciones((e) => ({
      ...e,
      [posicion]: { cantidad: linea.cantidad, quitada: false, ...e[posicion], ...cambio },
    }));
  }

  function pasarAhora() {
    if (!detalle || pasar.isPending || motivoNoPasar !== null) return;
    setFallo(null);
    setSinCuenta(false);
    setPasoAjeno(false);
    pasar.mutate({ lineas: lineasParaPasar(detalle, ediciones) });
  }

  function agregarAlBorradorOtraVez() {
    if (!sinAgregar) return;
    const resultado = agregarLineasDeLlamado(
      claveDeBorrador(empresaId, usuarioId, sinAgregar.ordenId),
      llamadoId,
      sinAgregar.lineas,
    );
    if (resultado === 'bloqueado') return;
    navegar(rutaDeOrden(sinAgregar.ordenId), { state: { revisaElPedido: true } });
  }

  const paraRecuperar = detalle.ordenId ? lineasParaRecuperar(detalle) : null;
  const sePuedeRecuperar =
    estado === 'PASADO_A_CUENTA' && esPedido && detalle.ordenId !== null && paraRecuperar !== null;

  function recuperar() {
    if (!detalle?.ordenId) return;
    const { lineas } = lineasParaRecuperar(detalle);
    if (lineas.length === 0) {
      setFalloDeRecuperar(
        'Ninguna de esas líneas está disponible hoy, así que no hay nada que agregar.',
      );
      return;
    }
    const resultado = agregarLineasDeLlamado(
      claveDeBorrador(empresaId, usuarioId, detalle.ordenId),
      llamadoId,
      lineas,
    );
    if (resultado === 'bloqueado') {
      setFalloDeRecuperar(
        'La cuenta tiene un envío a cocina sin terminar. Espera a que termine e inténtalo de nuevo.',
      );
      return;
    }
    setRecuperando(false);
    navegar(rutaDeOrden(detalle.ordenId), { state: { revisaElPedido: true } });
  }

  return (
    <Pagina
      titulo={mesa}
      atras={{ a: rutaDeLlamados(), etiqueta: 'Llamados' }}
      {...(pendiente || enAtencion
        ? {
            pie: (
              <div className="llamado-detalle__pie">
                {pendiente ? (
                  <Boton
                    variante="principal"
                    bloque
                    cargando={atencion.atendiendoId === detalle.id}
                    textoCargando="Atendiendo…"
                    onClick={() => atencion.atender(detalle)}
                  >
                    Atender
                  </Boton>
                ) : (
                  <>
                    {motivoNoPasar ? (
                      <p className="llamado-detalle__pie-motivo" id="motivo-no-pasar">
                        {motivoNoPasar}
                      </p>
                    ) : null}
                    <Boton
                      variante="principal"
                      bloque
                      cargando={pasar.isPending}
                      textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Pasando…'}
                      disabled={motivoNoPasar !== null}
                      aria-describedby={motivoNoPasar ? 'motivo-no-pasar' : undefined}
                      onClick={pasarAhora}
                    >
                      Pasar a la cuenta
                    </Boton>
                  </>
                )}
              </div>
            ),
          }
        : {})}
    >
      <div className="llamado-detalle">
        <header className="llamado-detalle__cabecera">
          <EtiquetaDeEstado tono={tonoDeEstado(estado)}>
            {textoDeEstado(detalle, estado)}
          </EtiquetaDeEstado>
          <p className="llamado-detalle__datos">
            {TEXTO_DE_TIPO[detalle.tipo]} · {textoDeAntiguedad(detalle.creadoEn, ahora)}
            {detalle.atendidoPor ? ` · Atiende ${detalle.atendidoPor.nombre}` : ''}
          </p>
        </header>

        {mesaAbiertaAhora ? <Aviso tipo="ok" titulo="Abriste la mesa a tu nombre" /> : null}
        {consulta.isError ? (
          <Aviso tipo="alerta" titulo="No pudimos actualizar el llamado">
            Lo que ves puede estar desactualizado. Seguimos intentando.
          </Aviso>
        ) : null}
        {atencion.aviso}
        {atencion.falloSinHoja ? (
          <Aviso tipo="error" titulo="No pudimos atenderlo">
            {atencion.falloSinHoja}
          </Aviso>
        ) : null}
        {detalle.nota ? (
          <Aviso tipo="info" titulo="El cliente escribió">
            «{detalle.nota}»
          </Aviso>
        ) : null}
        {estado === 'VENCIDO' ? (
          <Aviso tipo="alerta" titulo="Este llamado venció">
            Nadie lo atendió a tiempo. El cliente tendrá que volver a enviarlo.
          </Aviso>
        ) : null}
        {estado === 'DESCARTADO' && !descartado ? (
          <Aviso tipo="info" titulo="Este llamado se descartó">
            {detalle.motivoDescarte ? `Motivo: ${detalle.motivoDescarte}.` : 'Sin motivo.'}
          </Aviso>
        ) : null}
        {estado === 'PASADO_A_CUENTA' ? (
          <Aviso tipo="ok" titulo="Pasó a la cuenta">
            {detalle.cerradoPor ? `${detalle.cerradoPor.nombre} lo pasó` : 'Se pasó'}
            {detalle.cerradoEn ? ` a las ${horaDeLima(detalle.cerradoEn)}` : ''}. Pasarlo no envía
            nada a cocina: el pedido queda en «Por enviar» en el equipo de quien lo pasó.{' '}
            {detalle.ordenId ? <Link to={rutaDeOrden(detalle.ordenId)}>Ir a la cuenta</Link> : null}
            {sePuedeRecuperar && (paraRecuperar?.lineas.length ?? 0) > 0 ? (
              <div className="llamado-detalle__accion">
                <Boton
                  onClick={() => {
                    setFalloDeRecuperar(null);
                    setRecuperando(true);
                  }}
                >
                  Agregar a mi borrador
                </Boton>
              </div>
            ) : null}
          </Aviso>
        ) : null}
        {pasoAjeno ? (
          <Aviso tipo="alerta" titulo="Otra persona ya pasó este pedido">
            No agregamos nada a tu borrador, para que no salga dos veces.
          </Aviso>
        ) : null}
        {estado === 'ATENDIDO' && !esPedido ? (
          <Aviso tipo="ok" titulo="Atendido">
            {detalle.atendidoPor ? `${detalle.atendidoPor.nombre} atendió` : 'Se atendió'} este
            aviso.
            {detalle.ordenId && detalle.tipo === 'PEDIR_CUENTA' ? (
              <>
                {' '}
                <Link to={rutaDeOrden(detalle.ordenId)} state={{ pidieronLaCuenta: true }}>
                  Ir a la cuenta
                </Link>
              </>
            ) : null}
          </Aviso>
        ) : null}
        {descartado ? (
          <Aviso tipo="ok" titulo="Llamado descartado">
            {detalle.ordenId && detalle.atendidoPor ? (
              <>
                Si la mesa quedó abierta y no hay nada enviado,{' '}
                <Link to={rutaDeOrden(detalle.ordenId)}>libérala desde su cuenta</Link>.
              </>
            ) : (
              'Ya no aparece en pendientes.'
            )}
          </Aviso>
        ) : null}
        {fallo ? (
          <Aviso tipo="error" titulo="No se pasó nada a la cuenta">
            {fallo}
          </Aviso>
        ) : null}
        {sinCuenta ? (
          <Aviso tipo="alerta" titulo="La mesa ya no tiene cuenta abierta">
            Alguien la anuló después de atender. Ábrela otra vez y el pedido pasa a la nueva cuenta.
            <div className="llamado-detalle__accion">
              <Boton onClick={() => setAbriendo(true)}>Abrir la mesa</Boton>
            </div>
          </Aviso>
        ) : null}
        {sinAgregar ? (
          <Aviso tipo="alerta" titulo="El pedido ya pasó a la cuenta">
            La cuenta tiene un envío a cocina en curso, así que las líneas aún no están en «Por
            enviar». Cuando termine, agrégalas.
            <div className="llamado-detalle__accion">
              <Boton onClick={agregarAlBorradorOtraVez}>Agregar al borrador</Boton>
            </div>
          </Aviso>
        ) : null}
        <AvisoPendiente pendiente={envio.pendiente} />

        {esPedido && detalle.lineas.length > 0 ? (
          <ul className="llamado-detalle__lineas" aria-label="Lo que pidió el cliente">
            {quedan.map((linea) => (
              <li key={linea.posicion}>
                <TarjetaDeLinea
                  linea={linea}
                  cantidad={cantidadDe(linea)}
                  editable={enAtencion && !pasar.isPending}
                  rechazo={rechazos[linea.posicion] ?? null}
                  pasada={
                    estado === 'PASADO_A_CUENTA'
                      ? (detalle.lineasPasadas?.find((p) => p.posicion === linea.posicion)
                          ?.cantidad ?? 0)
                      : null
                  }
                  onCantidad={(cantidad) => editar(linea.posicion, { cantidad }, linea)}
                  onQuitar={() => editar(linea.posicion, { quitada: true }, linea)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {quitadas.length > 0 ? (
          <ul className="llamado-detalle__quitadas" aria-label="Líneas que quitaste">
            {quitadas.map((linea) => (
              <li key={linea.posicion} className="llamado-detalle__quitada">
                <span>Quitaste {linea.nombre}</span>
                <Boton
                  variante="texto"
                  icono={IconoDeshacer}
                  onClick={() => editar(linea.posicion, { quitada: false }, linea)}
                  aria-label={`Deshacer: volver a poner ${linea.nombre}`}
                >
                  Deshacer
                </Boton>
              </li>
            ))}
          </ul>
        ) : null}

        {esPedido && detalle.lineas.length > 0 && (pendiente || enAtencion) ? (
          <div className="llamado-detalle__total">
            <span>Total para la cuenta</span>
            <b>{montoEnSoles(totalAPasar)}</b>
          </div>
        ) : null}

        {puedeDescartar ? (
          <section className="llamado-detalle__aparte" aria-label="Descartar el llamado">
            <Boton
              variante="peligro"
              bloque
              icono={IconoBasura}
              disabled={pasar.isPending}
              onClick={() => {
                setFalloDeDescarte(null);
                setMotivo('');
                setDescartando(true);
              }}
            >
              Descartar
            </Boton>
          </section>
        ) : null}
      </div>

      {atencion.hoja}

      <DialogoConfirmacion
        abierta={descartando}
        titulo="Descartar este llamado"
        etiquetaConfirmar="Descartar"
        peligro
        cargando={descarte.isPending}
        textoCargando="Descartando…"
        error={
          falloDeDescarte ? (
            <Aviso tipo="error" titulo="No pudimos descartarlo">
              {falloDeDescarte}
            </Aviso>
          ) : null
        }
        onCancelar={() => {
          if (!descarte.isPending) setDescartando(false);
        }}
        onConfirmar={() => {
          setFalloDeDescarte(null);
          descarte.mutate(motivo === '' ? {} : { motivo });
        }}
      >
        <div className="llamado-hoja__motivos">
          <p className="llamado-hoja__texto">
            {esPedido && enAtencion
              ? 'El pedido no pasará a la cuenta. Si abriste la mesa y no hay nada enviado, podrás liberarla.'
              : 'El llamado saldrá de pendientes. Puedes decir por qué:'}
          </p>
          <Segmentos
            etiqueta="Motivo del descarte"
            opciones={MOTIVOS_DE_DESCARTE}
            valor={motivo}
            onCambio={setMotivo}
          />
        </div>
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierta={recuperando}
        titulo="Agregar a mi borrador"
        etiquetaConfirmar="Agregar a mi borrador"
        error={
          falloDeRecuperar ? (
            <Aviso tipo="error" titulo="No se agregó nada">
              {falloDeRecuperar}
            </Aviso>
          ) : null
        }
        onCancelar={() => setRecuperando(false)}
        onConfirmar={recuperar}
      >
        <p className="llamado-hoja__texto">
          Úsalo solo si nadie envió este pedido a cocina. Si ya se envió, saldrá dos veces.
        </p>
        {paraRecuperar ? (
          <p className="llamado-hoja__texto">
            Se agregarán {textoDePlatos(paraRecuperar.lineas.reduce((n, l) => n + l.cantidad, 0))} a
            tu borrador de la cuenta.
            {paraRecuperar.omitidas > 0
              ? ` ${paraRecuperar.omitidas === 1 ? 'Una línea no está disponible hoy y se deja fuera.' : `${paraRecuperar.omitidas} líneas no están disponibles hoy y se dejan fuera.`}`
              : ''}
          </p>
        ) : null}
      </DialogoConfirmacion>

      <AbrirMesaHoja
        mesa={
          abriendo
            ? {
                id: detalle.mesa.id,
                nombre: detalle.mesa.nombre,
                capacidad: mesaDelSalon?.capacidad ?? 2,
              }
            : null
        }
        mozos={salon.data?.salon.mozos ?? []}
        onCerrar={() => setAbriendo(false)}
        alAbrir={() => {
          // La mesa tiene cuenta otra vez: se vuelve a pasar el pedido a ella.
          setAbriendo(false);
          setSinCuenta(false);
          void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
          pasarAhora();
        }}
      />
    </Pagina>
  );
}

function tonoDeEstado(
  estado: LlamadoDetalle['estado'],
): 'ok' | 'alerta' | 'mal' | 'neutro' | 'info' {
  switch (estado) {
    case 'PENDIENTE':
      return 'alerta';
    case 'ATENDIDO':
    case 'PASADO_A_CUENTA':
      return 'ok';
    case 'VENCIDO':
      return 'mal';
    default:
      return 'neutro';
  }
}

function textoDeEstado(detalle: LlamadoDetalle, estado: LlamadoDetalle['estado']): string {
  switch (estado) {
    case 'PENDIENTE':
      return 'Pendiente';
    case 'ATENDIDO':
      return detalle.tipo === 'PEDIDO' ? 'Falta pasarlo a la cuenta' : 'Atendido';
    case 'PASADO_A_CUENTA':
      return 'Pasó a la cuenta';
    case 'DESCARTADO':
      return 'Descartado';
    default:
      return 'Venció';
  }
}

function TarjetaDeLinea({
  linea,
  cantidad,
  editable,
  rechazo,
  pasada,
  onCantidad,
  onQuitar,
}: {
  linea: LineaDeLlamado;
  cantidad: number;
  editable: boolean;
  rechazo: string | null;
  /** Lo que se pasó a la cuenta de esta línea (`0` = se quitó); `null` si el llamado no se pasó. */
  pasada: number | null;
  onCantidad: (cantidad: number) => void;
  onQuitar: () => void;
}) {
  const disponible = linea.revision.disponible;
  const modificadores = linea.modificadores.map((m) => m.nombre).join(' · ');
  return (
    <div className={disponible ? 'linea-llamado' : 'linea-llamado linea-llamado--no-disponible'}>
      <div className="linea-llamado__fila">
        <span className="linea-llamado__texto">
          <span className="linea-llamado__nombre">
            {cantidad} × {linea.nombre}
          </span>
          {modificadores ? <span className="linea-llamado__detalle">{modificadores}</span> : null}
          {linea.observacion ? (
            <span className="linea-llamado__detalle">«{linea.observacion}»</span>
          ) : null}
        </span>
        {linea.revision.disponible ? (
          <span className="linea-llamado__total">
            {montoEnSoles(totalDeLineaDeLlamado(linea.revision.precioUnitario, cantidad))}
          </span>
        ) : null}
      </div>

      {linea.revision.disponible ? (
        <p className="linea-llamado__precio">
          {montoEnSoles(linea.revision.precioUnitario)} c/u
          {!montosIguales(linea.revision.precioUnitario, linea.precioCliente) ? (
            <>
              {' · '}
              <span className="linea-llamado__cliente">
                El cliente vio {montoEnSoles(linea.precioCliente)}
              </span>
            </>
          ) : null}
        </p>
      ) : (
        <p className="linea-llamado__motivo">
          <Icono icono={IconoAlerta} tamano={20} />
          <span>
            <b>No disponible:</b> {motivoEnPalabras(linea.revision)}
          </span>
        </p>
      )}

      {rechazo ? (
        <p className="linea-llamado__motivo" role="alert">
          <Icono icono={IconoAlerta} tamano={20} />
          <span>
            <b>No pasó:</b> {rechazo}
          </span>
        </p>
      ) : null}

      {pasada !== null ? (
        <p className="linea-llamado__precio">
          <Icono icono={IconoOk} tamano={16} />{' '}
          {pasada > 0 ? `Pasaste ${pasada} a la cuenta` : 'No la pasaste a la cuenta'}
        </p>
      ) : null}

      {editable ? (
        <div className="linea-llamado__controles">
          {disponible ? (
            <SelectorDeCantidad
              nombre={linea.nombre}
              valor={cantidad}
              minimo={1}
              maximo={99}
              onCambio={onCantidad}
            />
          ) : (
            <span />
          )}
          <Boton onClick={onQuitar} aria-label={`Quitar ${linea.nombre}`}>
            Quitar
          </Boton>
        </div>
      ) : null}
    </div>
  );
}

/** El motivo de una línea no disponible en palabras: por su código si lo conocemos, y si no, el que manda la API. */
function motivoEnPalabras(revision: { codigo: string; motivo: string }): string {
  const porCodigo = textoDeRechazo(revision.codigo);
  return porCodigo === revision.codigo ? revision.motivo : porCodigo;
}
