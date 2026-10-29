import type { ItemRespuesta, OrdenRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoPendiente,
  IconoSalon,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { montoEnSoles } from '../../lib/formato';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import {
  claveDeBorrador,
  pasarBorrador,
  totalDelBorrador,
  unidadesDelBorrador,
  useBorrador,
} from './borrador';
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
  textoDeItems,
  textoDeModificadores,
  tituloDeMesas,
  type GrupoDeEnvio,
} from './ordenes';
import { rutaDeComandero, rutaDeOrden } from './salon';
import { useAhoraDelServidor, useOrden } from './useOrden';
import './cuenta.css';

/** Lo que la pantalla anterior le pide a la cuenta al llegar. */
interface EstadoDeLlegada {
  /** Se abrió una mesa que otra persona acababa de abrir (criterio 89). */
  mesaOcupada?: boolean;
  /** El envío que acaba de salir, para decirlo. */
  enviado?: { numero: number; esAdicion: boolean };
  /** Esta cuenta absorbió a otra (criterio 47). */
  unida?: boolean;
}

const MENSAJES_DE_MARCHA = {
  NADA_QUE_MARCHAR: 'No hay nada por marchar. Puede que otra persona ya lo haya marchado.',
  ORDEN_NO_ABIERTA: 'Esta cuenta ya no está abierta.',
  NO_ENCONTRADO: 'Esta cuenta ya no existe.',
} as const;

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
      {enviado ? (
        <Aviso tipo="ok" titulo="Pedido enviado">
          {enviado.esAdicion || enviado.numero > 1
            ? `La adición ${enviado.numero} ya salió a cocina.`
            : 'La comanda ya salió a cocina.'}
        </Aviso>
      ) : null}
      {consulta.isError ? (
        <Aviso tipo="alerta" titulo="No pudimos actualizar la cuenta">
          Lo que ves puede estar desactualizado. Seguimos intentando.
        </Aviso>
      ) : null}

      <Cabecera orden={orden} ahora={ahora} />

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
        grupos.map((grupo) => <GrupoDeItems key={grupo.clave} grupo={grupo} />)
      )}

      {grupos.length > 0 ? (
        <div className="cuenta__total">
          <span>Total</span>
          <b>{montoEnSoles(orden.total)}</b>
        </div>
      ) : null}
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

function GrupoDeItems({ grupo }: { grupo: GrupoDeEnvio }) {
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
            <FilaDeItem item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaDeItem({ item }: { item: ItemRespuesta }) {
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
      {anulado ? null : <span className="item__total">{total}</span>}
    </div>
  );
}
