import type { ItemRespuesta, OrdenRespuesta, PrecuentaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoCambiar,
  IconoDerecha,
  IconoNota,
  IconoPendiente,
  IconoSalon,
  IconoUnidas,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { horaDeLima } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { avisoDeImpresion, useEstadoDeImpresion } from '../impresion/estado';
import { useSesionActiva } from '../acceso/sesion';
import {
  claveDeBorrador,
  pasarBorrador,
  totalDelBorrador,
  unidadesDelBorrador,
  useBorrador,
} from './borrador';
import { sePuedeAnularItem, sePuedeAnularOrden, sePuedeLiberar } from './anulaciones';
import type { ObjetivoDeAnulacion } from './AnularHoja';
import { enviarBorrador } from './enviar-borrador';
import {
  ETIQUETA_DE_ESTADO,
  agruparPorEnvio,
  esperaLaMarcha,
  estaAbierta,
  estadoEnCocina,
  itemsPorMarchar,
  marcharItems,
  resumenDeCuenta,
  textoDeEnvioHecho,
  textoDeItems,
  textoDeModificadores,
  tituloDeMesas,
  type GrupoDeEnvio,
} from './ordenes';
import { pedirPrecuenta, esLaVigente, sePuedePedirPrecuenta } from './precuenta';
import { TicketsDeLaCuenta } from './TicketsDeLaCuenta';
import { rutaDeComandero, rutaDeMover, rutaDeOrden, rutaDeUnir } from './salon';
import { useAhoraDelServidor, useOrden } from './useOrden';
import './cuenta.css';

// Anular y liberar se cargan al tocarlos: la cuenta se abre sin ese código (presupuesto del paquete).
const AnularHoja = lazy(() => import('./AnularHoja').then((m) => ({ default: m.AnularHoja })));
const LiberarMesaHoja = lazy(() =>
  import('./AnularHoja').then((m) => ({ default: m.LiberarMesaHoja })),
);
const PrecuentaHoja = lazy(() =>
  import('./PrecuentaHoja').then((m) => ({ default: m.PrecuentaHoja })),
);

/** Lo que la pantalla anterior le pide a la cuenta al llegar. */
interface EstadoDeLlegada {
  /** Se abrió una mesa que otra persona acababa de abrir (criterio 89). */
  mesaOcupada?: boolean;
  /** El envío que acaba de salir, para decirlo. */
  enviado?: { numero: number; esAdicion: boolean };
  /** Esta cuenta absorbió a otra (criterio 47). */
  unida?: boolean;
  /** Lo que acaba de hacerse desde otra pantalla (mover o unir mesas), dicho en una frase. */
  hecho?: string;
}

const MENSAJES_DE_PRECUENTA = {
  ORDEN_SIN_CONSUMO:
    'Aún no hay nada vigente en la cuenta. Envía un pedido antes de pedir la pre-cuenta.',
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta.',
  NO_ENCONTRADO: 'Esta cuenta ya no existe.',
} as const;

const MENSAJES_DE_MARCHA = {
  NADA_QUE_MARCHAR: 'No hay nada por marchar. Puede que otra persona ya lo haya marchado.',
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta.',
  NO_ENCONTRADO: 'Esta cuenta ya no existe.',
} as const;

/**
 * "Pedido enviado": dice que la comanda se envió a cocina, no que ya salió el ticket. Si el estado de la
 * impresión (la misma consulta del aviso de todas las pantallas) indica un problema, añade que quedó en cola.
 */
function AvisoDeEnvio({ numero, esAdicion }: { numero: number; esAdicion: boolean }) {
  const sesion = useSesionActiva();
  const { estado, desdeLaRespuestaMs } = useEstadoDeImpresion(sesion.sucursal?.id);
  const problema = estado ? avisoDeImpresion(estado, desdeLaRespuestaMs) !== null : false;
  return (
    <Aviso tipo="ok" titulo="Pedido enviado">
      {textoDeEnvioHecho(numero, esAdicion, problema)}
    </Aviso>
  );
}

/** `/salon/ordenes/:id`: la cuenta de la mesa (criterio 90 de 004). */
export function OrdenPagina() {
  const { id = '' } = useParams();
  const sesion = useSesionActiva();
  if (!sesion.sucursal) {
    return (
      <Pagina titulo="Cuenta de la mesa" atras={{ a: '/salon', etiqueta: 'Salón' }}>
        <EstadoVacio icono={IconoSalon} titulo="Elige una sucursal">
          Las cuentas son de una sucursal. Elígela arriba, junto a tu nombre.
        </EstadoVacio>
      </Pagina>
    );
  }
  return (
    <Cuenta
      key={`${id}.${sesion.usuario?.id ?? 'soporte'}.${sesion.sucursal.id}`}
      ordenId={id}
      empresaId={sesion.empresaId}
      usuarioId={sesion.usuario?.id ?? null}
    />
  );
}

function Cuenta({
  ordenId,
  empresaId,
  usuarioId,
}: {
  ordenId: string;
  empresaId: string;
  usuarioId: string | null;
}) {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  // Lo que trae la pantalla anterior se lee una vez: se dice al llegar y no vuelve al recargar.
  const [llegada] = useState<EstadoDeLlegada>(
    () => (ubicacion.state as EstadoDeLlegada | null) ?? {},
  );
  const clientes = useQueryClient();
  const consulta = useOrden(ordenId);
  const orden = consulta.data?.orden;
  const ahora = useAhoraDelServidor();
  const clave = claveDeBorrador(empresaId, usuarioId, ordenId);
  const borrador = useBorrador(clave);
  const envio = useEnvioPendiente();

  const [enviado, setEnviado] = useState(llegada.enviado ?? null);
  const [marchada, setMarchada] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  // Anular un ítem o la orden y liberar la mesa (criterios 35 a 44).
  const [anulando, setAnulando] = useState<ObjetivoDeAnulacion | null>(null);
  const [liberando, setLiberando] = useState(false);
  const [conConsumo, setConConsumo] = useState(false);
  const [hecho, setHecho] = useState<string | null>(llegada.hecho ?? null);
  // La pre-cuenta que se está mirando y cuándo llegó (para saber si lo que se ve de la cuenta es posterior).
  const [precuenta, setPrecuenta] = useState<{
    datos: PrecuentaRespuesta;
    recibidaEn: number;
  } | null>(null);
  const [falloPrecuenta, setFalloPrecuenta] = useState<string | null>(null);
  // Decisión 10: la pre-cuenta vigente que se vio y dejó de valer (se agregó o se anuló algo).
  const [vistaVigente, setVistaVigente] = useState<number | null>(null);
  const [vencida, setVencida] = useState<number | null>(null);
  const puedeAnularItem = usePermiso('ANULAR_ITEM_ENVIADO') !== 'prohibido';
  const puedeAnularOrden = usePermiso('ANULAR_ORDEN') !== 'prohibido';
  const puedeLiberar = usePermiso('ATENDER_MESA') !== 'prohibido';
  const puedeAtender = usePermiso('ATENDER_MESA') !== 'prohibido';
  const puedeMoverUnir = usePermiso('MOVER_UNIR_MESAS') !== 'prohibido';

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    if (ubicacion.state !== null) navegar('.', { replace: true, state: null });
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const marchar = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: () => {
      // El id de la marcha se genera una vez por toque y se conserva en los reintentos (criterio 32).
      const id = nuevaClaveDeIdempotencia();
      return envio.enviar((extra) => marcharItems(ordenId, { id }, extra));
    },
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      if (montado.current) {
        setMarchada(true);
        setFallo(null);
      }
    },
    onError: (error) => {
      if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      }
      if (montado.current) {
        setMarchada(false);
        setFallo(mensajeDeError(error, MENSAJES_DE_MARCHA));
      }
    },
  });

  // Se ajusta durante el dibujo (no en un efecto): el número de la pre-cuenta vigente que se ve ahora.
  const numeroVigente =
    orden?.estado === 'EN_PRECUENTA' ? (orden.precuentaVigente?.numero ?? null) : null;
  if (orden && numeroVigente !== vistaVigente) {
    setVistaVigente(numeroVigente);
    if (numeroVigente !== null) setVencida(null);
    else if (vistaVigente !== null) setVencida(vistaVigente);
  }

  const pedirLaPrecuenta = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: () => {
      // El id de la pre-cuenta se genera una vez por toque y se conserva en los reintentos (criterio 50).
      const id = nuevaClaveDeIdempotencia();
      return envio.enviar((extra) => pedirPrecuenta(ordenId, { id }, extra));
    },
    onSuccess: (datos) => {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.salon });
      if (montado.current) {
        setPrecuenta({ datos, recibidaEn: Date.now() });
        setFalloPrecuenta(null);
      }
    },
    onError: (error) => {
      if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) {
        void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.orden(ordenId) });
      }
      if (montado.current) setFalloPrecuenta(mensajeDeError(error, MENSAJES_DE_PRECUENTA));
    },
  });

  // Esta cuenta se unió a otra (criterio 47): se lleva a la persona a la cuenta principal con su borrador.
  // Con un envío sin terminar no se mueve nada: se reintenta con su id y el servidor dice si llegó.
  const unidaA = orden?.estado === 'UNIDA' ? orden.unidaA : null;
  const moverAlUnir = unidaA !== null && borrador.envioId === null;
  useEffect(() => {
    if (!unidaA || !moverAlUnir) return;
    pasarBorrador(clave, claveDeBorrador(empresaId, usuarioId, unidaA));
  }, [unidaA, moverAlUnir, clave, empresaId, usuarioId]);

  async function reintentar() {
    const resultado = await enviarBorrador({ clave, ordenId, clientes });
    if (!montado.current) return;
    if (resultado.resultado === 'enviado') {
      setEnviado({ numero: resultado.envio.numero, esAdicion: resultado.envio.esAdicion });
    } else if (resultado.resultado === 'otra-orden') {
      pasarBorrador(clave, claveDeBorrador(empresaId, usuarioId, resultado.ordenId));
      navegar(rutaDeOrden(resultado.ordenId), { replace: true, state: { unida: true } });
    }
  }

  if (consulta.error instanceof ErrorApi && consulta.error.codigo === 'NO_ENCONTRADO' && !orden) {
    return (
      <Pagina titulo="Cuenta de la mesa" atras={{ a: '/salon', etiqueta: 'Salón' }}>
        <EstadoVacio icono={IconoSalon} titulo="Esta cuenta no existe">
          Puede que se haya anulado o que no sea de esta sucursal. Vuelve al salón.
        </EstadoVacio>
      </Pagina>
    );
  }

  if (!orden) {
    return (
      <Pagina titulo="Cuenta de la mesa" atras={{ a: '/salon', etiqueta: 'Salón' }}>
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

  if (unidaA && moverAlUnir) {
    return (
      <Navigate
        to={rutaDeOrden(unidaA)}
        replace
        state={{ unida: true } satisfies EstadoDeLlegada}
      />
    );
  }

  const abierta = estaAbierta(orden);
  const grupos = agruparPorEnvio(orden.items);
  const porMarchar = itemsPorMarchar(orden);
  const hayBorrador = borrador.lineas.length > 0;
  // "Liberar la mesa" solo si la cuenta nunca tuvo un envío (criterio 44); en cualquier otro caso de cuenta
  // abierta, "Anular la orden". Si la API dijo que hubo consumo (409), también "Anular la orden".
  const ofreceLiberar = puedeLiberar && sePuedeLiberar(orden) && !conConsumo;
  const ofreceAnularOrden =
    puedeAnularOrden && (sePuedeAnularOrden(orden) || (conConsumo && abierta));
  const ofrecePrecuenta = puedeAtender && sePuedePedirPrecuenta(orden);
  const enPrecuenta = orden.estado === 'EN_PRECUENTA' ? orden.precuentaVigente : null;

  return (
    <Pagina
      titulo={tituloDeMesas(orden.mesas)}
      atras={{ a: '/salon', etiqueta: 'Salón' }}
      {...(abierta
        ? {
            pie: (
              <Link to={rutaDeComandero(ordenId)} className={claseBoton('principal', true)}>
                Agregar
              </Link>
            ),
          }
        : {})}
    >
      {llegada.mesaOcupada ? (
        <Aviso tipo="info" titulo="Otra persona acaba de abrir esta mesa">
          Te llevamos a su cuenta.
        </Aviso>
      ) : null}
      {llegada.unida ? (
        <Aviso tipo="info" titulo="Las cuentas se unieron">
          Esta es la cuenta principal. Lo que tenías por enviar sigue en «Por enviar».
        </Aviso>
      ) : null}
      {enviado ? <AvisoDeEnvio numero={enviado.numero} esAdicion={enviado.esAdicion} /> : null}
      {consulta.isError ? (
        <Aviso tipo="alerta" titulo="No pudimos actualizar la cuenta">
          Lo que ves puede estar desactualizado. Seguimos intentando.
        </Aviso>
      ) : null}

      {hecho ? (
        <Aviso tipo="ok" titulo="Hecho">
          {hecho}
        </Aviso>
      ) : null}

      <Cabecera orden={orden} ahora={ahora} />

      {abierta && vencida !== null ? (
        <Aviso tipo="alerta" titulo={`La pre-cuenta ${vencida} ya no vale`}>
          Se agregó o se anuló algo después de pedirla. Pide otra cuando el cliente la necesite.
        </Aviso>
      ) : null}

      {!abierta ? (
        <Aviso
          tipo="alerta"
          titulo={
            orden.estado === 'UNIDA'
              ? 'Esta cuenta se unió a otra'
              : 'Esta cuenta ya no está abierta'
          }
        >
          {orden.estado === 'UNIDA' && orden.unidaA ? (
            <>
              Sus ítems pasaron a la cuenta principal.{' '}
              <Link to={rutaDeOrden(orden.unidaA)}>Ir a la cuenta principal</Link>
            </>
          ) : (
            'Solo puedes mirarla. Para atender otra mesa, vuelve al salón.'
          )}
        </Aviso>
      ) : null}

      {hayBorrador || borrador.porReintentar ? (
        <section className="cuenta__borrador" aria-label="Por enviar">
          {borrador.aviso ? (
            <Aviso tipo={borrador.aviso.tipo} titulo={borrador.aviso.titulo}>
              {borrador.aviso.detalle}
            </Aviso>
          ) : null}
          {borrador.fase === 'esperando-red' ? <AvisoPendiente pendiente /> : null}
          {borrador.porReintentar ? (
            <Aviso tipo="alerta" titulo="Hay un envío sin terminar" icono={IconoPendiente}>
              No sabemos si llegó a cocina. Si ya había llegado, reintentar no lo duplica.
            </Aviso>
          ) : null}
          {borrador.porReintentar || borrador.fase !== null ? (
            <Boton
              variante="principal"
              bloque
              cargando={borrador.fase !== null}
              textoCargando={borrador.fase === 'esperando-red' ? 'Pendiente de envío' : 'Enviando…'}
              onClick={() => void reintentar()}
            >
              Reintentar el envío
            </Boton>
          ) : null}
          {hayBorrador ? (
            <Link
              to={rutaDeComandero(ordenId)}
              state={{ vista: 'borrador' }}
              className={claseFila()}
            >
              <ContenidoDeFila
                titulo="Por enviar"
                ayuda={`${textoDeItems(unidadesDelBorrador(borrador.lineas))} sin enviar a cocina`}
                derecha={
                  <span className="cuenta__fila-derecha">
                    <b>{montoEnSoles(totalDelBorrador(borrador.lineas))}</b>
                    <Icono icono={IconoDerecha} tamano={20} />
                  </span>
                }
              />
            </Link>
          ) : null}
        </section>
      ) : null}

      {abierta && porMarchar.length > 0 ? (
        <section className="cuenta__marcha" aria-label="Segundo tiempo">
          <p className="cuenta__marcha-texto">
            <b>Esperan la marcha</b>
            <span>
              {porMarchar.length === 1
                ? '1 ítem de segundo tiempo'
                : `${porMarchar.length} ítems de segundo tiempo`}
            </span>
          </p>
          <Boton
            cargando={marchar.isPending}
            textoCargando="Marchando…"
            onClick={() => {
              setMarchada(false);
              setFallo(null);
              marchar.mutate();
            }}
          >
            Marchar
          </Boton>
        </section>
      ) : null}
      <AvisoPendiente pendiente={envio.pendiente} />
      {marchada ? (
        <Aviso tipo="ok" titulo="Marcha enviada">
          Cocina ya sabe que puede sacar el segundo tiempo.
        </Aviso>
      ) : null}
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos marchar">
          {fallo}
        </Aviso>
      ) : null}

      {grupos.length === 0 ? (
        <EstadoVacio icono={IconoPendiente} titulo="Aún no se envió nada">
          {abierta
            ? 'Toca «Agregar» para tomar el pedido de la mesa y mandarlo a cocina.'
            : 'Esta cuenta no tuvo pedidos.'}
        </EstadoVacio>
      ) : (
        grupos.map((grupo) => (
          <GrupoDeItems
            key={grupo.clave}
            grupo={grupo}
            {...(abierta && puedeAnularItem
              ? {
                  alAnular: (item: ItemRespuesta) => {
                    setHecho(null);
                    setAnulando({ tipo: 'item', itemId: item.id });
                  },
                }
              : {})}
          />
        ))
      )}

      {grupos.length > 0 ? (
        <div className="cuenta__total">
          <span>Total</span>
          <b>{montoEnSoles(orden.total)}</b>
        </div>
      ) : null}

      {abierta && (ofrecePrecuenta || puedeMoverUnir) ? (
        <section className="cuenta__acciones" aria-label="Pre-cuenta, mover y unir">
          {ofrecePrecuenta ? (
            <>
              {enPrecuenta ? (
                <p className="cuenta__precuenta-dato">
                  Pre-cuenta {enPrecuenta.numero} pedida a las {horaDeLima(enPrecuenta.emitidaEn)}.
                  Si agregas o anulas algo, deja de valer.
                </p>
              ) : null}
              <Boton
                bloque
                icono={IconoNota}
                cargando={pedirLaPrecuenta.isPending}
                textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Pidiendo…'}
                onClick={() => {
                  setFalloPrecuenta(null);
                  pedirLaPrecuenta.mutate();
                }}
              >
                {enPrecuenta ? 'Ver pre-cuenta' : 'Pedir pre-cuenta'}
              </Boton>
              {falloPrecuenta && !precuenta ? (
                <Aviso tipo="error" titulo="No pudimos pedir la pre-cuenta">
                  {falloPrecuenta}
                </Aviso>
              ) : null}
            </>
          ) : null}
          {puedeMoverUnir ? (
            <div className="cuenta__mover-unir">
              <Link to={rutaDeMover(ordenId)} className={claseBoton()}>
                <Icono icono={IconoCambiar} tamano={20} />
                Mover
              </Link>
              <Link to={rutaDeUnir(ordenId)} className={claseBoton()}>
                <Icono icono={IconoUnidas} tamano={20} />
                Unir
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {abierta && puedeAtender && grupos.length > 0 ? <TicketsDeLaCuenta orden={orden} /> : null}

      {conConsumo ? (
        <Aviso tipo="alerta" titulo="Esta mesa ya tuvo pedidos">
          No se puede liberar sin más. Para dejarla libre, anula la orden.
        </Aviso>
      ) : null}
      {ofreceLiberar || ofreceAnularOrden ? (
        <section className="cuenta__cierre" aria-label="Cerrar sin cobrar">
          {ofreceLiberar ? (
            <Boton
              bloque
              onClick={() => {
                setHecho(null);
                setLiberando(true);
              }}
            >
              Liberar la mesa
            </Boton>
          ) : null}
          {ofreceAnularOrden ? (
            <Boton
              variante="peligro"
              bloque
              onClick={() => {
                setHecho(null);
                setAnulando({ tipo: 'orden' });
              }}
            >
              Anular la orden
            </Boton>
          ) : null}
        </section>
      ) : null}

      <Suspense fallback={null}>
        {precuenta ? (
          <PrecuentaHoja
            precuenta={precuenta.datos}
            // Mientras lo que se ve de la cuenta sea anterior a la pre-cuenta, no se puede decir que dejó de valer.
            vale={
              consulta.dataUpdatedAt < precuenta.recibidaEn || esLaVigente(orden, precuenta.datos)
            }
            pidiendo={pedirLaPrecuenta.isPending}
            pendiente={envio.pendiente}
            fallo={falloPrecuenta}
            onPedirOtra={() => {
              setFalloPrecuenta(null);
              pedirLaPrecuenta.mutate();
            }}
            onCerrar={() => setPrecuenta(null)}
          />
        ) : null}
        {anulando ? (
          <AnularHoja
            key={anulando.tipo === 'item' ? anulando.itemId : 'orden'}
            objetivo={anulando}
            orden={orden}
            onCerrar={() => setAnulando(null)}
            onHecho={(texto) => {
              if (!montado.current) return;
              setAnulando(null);
              setHecho(texto);
            }}
          />
        ) : null}
        {liberando ? (
          <LiberarMesaHoja
            orden={orden}
            onCerrar={() => setLiberando(false)}
            onHecho={() => {
              if (!montado.current) return;
              setLiberando(false);
              setHecho('La mesa quedó libre.');
            }}
            onConConsumo={() => {
              if (!montado.current) return;
              setLiberando(false);
              setConConsumo(true);
            }}
          />
        ) : null}
      </Suspense>
    </Pagina>
  );
}

function Cabecera({ orden, ahora }: { orden: OrdenRespuesta; ahora: number }) {
  const etiqueta = ETIQUETA_DE_ESTADO[orden.estado];
  return (
    <header className="cuenta__cabecera">
      <EtiquetaDeEstado tono={etiqueta.tono}>{etiqueta.texto}</EtiquetaDeEstado>
      <p className="cuenta__datos">{resumenDeCuenta(orden, ahora)}</p>
    </header>
  );
}

function GrupoDeItems({
  grupo,
  alAnular,
}: {
  grupo: GrupoDeEnvio;
  alAnular?: (item: ItemRespuesta) => void;
}) {
  return (
    <section className="cuenta__envio" aria-label={grupo.titulo}>
      <h2 className="cuenta__envio-titulo">
        <span>{grupo.titulo}</span>
        <span className="cuenta__envio-quien">
          {grupo.hora}
          {grupo.comandadoPor ? ` · ${grupo.comandadoPor}` : ' · Soporte'}
        </span>
      </h2>
      <ul className="cuenta__items">
        {grupo.items.map((item) => (
          <li key={item.id}>
            <FilaDeItem item={item} {...(alAnular ? { alAnular } : {})} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaDeItem({
  item,
  alAnular,
}: {
  item: ItemRespuesta;
  alAnular?: (item: ItemRespuesta) => void;
}) {
  const anulado = item.estado === 'ANULADO';
  const modificadores = textoDeModificadores(item);
  const cocina = estadoEnCocina(item);
  const espera = esperaLaMarcha(item);
  const total = montoEnSoles(item.totalVigente);
  return (
    <div className={anulado ? 'item item--anulado' : 'item'}>
      <span className="item__cantidad">{anulado ? item.cantidad : item.cantidadVigente} ×</span>
      <span className="item__texto">
        <span className="item__nombre">{item.nombre}</span>
        {modificadores ? <span className="item__detalle">{modificadores}</span> : null}
        {item.observacion ? <span className="item__detalle">«{item.observacion}»</span> : null}
        <span className="item__etiquetas">
          {anulado ? <EtiquetaDeEstado tono="neutro">Anulado</EtiquetaDeEstado> : null}
          {!anulado && item.cantidadAnulada > 0 ? (
            <EtiquetaDeEstado tono="neutro">{item.cantidadAnulada} anulado</EtiquetaDeEstado>
          ) : null}
          {item.tiempo === 2 && !anulado ? (
            espera ? (
              <EtiquetaDeEstado tono="alerta">Esperar</EtiquetaDeEstado>
            ) : item.marchadoEn ? (
              <EtiquetaDeEstado tono="neutro">Marchado</EtiquetaDeEstado>
            ) : null
          ) : null}
          {item.paraLlevar && !anulado ? (
            <EtiquetaDeEstado tono="info">Para llevar</EtiquetaDeEstado>
          ) : null}
          {cocina ? <EtiquetaDeEstado tono="neutro">{cocina}</EtiquetaDeEstado> : null}
        </span>
      </span>
      {anulado ? null : (
        <span className="item__lado">
          <span className="item__total">{total}</span>
          {alAnular && sePuedeAnularItem(item) ? (
            <button
              type="button"
              className={`${claseBoton()} item__anular`}
              aria-label={`Anular ${item.nombre}`}
              onClick={() => alAnular(item)}
            >
              Anular
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
}
