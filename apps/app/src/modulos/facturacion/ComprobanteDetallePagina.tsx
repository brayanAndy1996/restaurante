import type { ComprobanteDetalle, ReemisionEntrada } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  IconoReintentar,
  claseBoton,
} from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { MUTACION_SIN_PAUSA, useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { fechaDeLima, horaDeLima } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL, useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { EstadoDelComprobante } from './EstadoDelComprobante';
import {
  NOMBRE_DE_ESTADO_DE_ENVIO,
  NOMBRE_DE_RESULTADO,
  NOMBRE_DE_TIPO_DOCUMENTO,
  claveComprobante,
  falloDeReemision,
  leerComprobante,
  reemitir,
  reintentarEnvio,
  rutaDelDetalle,
  sePuedeEmitirOtro,
  sePuedeReintentar,
  textoDeFalloDeReintento,
} from './facturacion';
import { ID_FORMULARIO_DE_REEMISION } from './ids';
import { sePuedeEmitirNota } from './notas-credito';
import { RUTA_PANEL_EN_AJUSTES, RUTA_PANEL_EN_CAJA } from './rutas';
import './panel.css';

// El formulario de «Emitir otro» (con las reglas del cliente del cobro) se baja solo al abrirlo.
const EmitirOtro = lazy(() => import('./EmitirOtro').then((m) => ({ default: m.EmitirOtro })));
const ReemisionHecha = lazy(() =>
  import('./EmitirOtro').then((m) => ({ default: m.ReemisionHecha })),
);
// La hoja de la nota de crédito (con el cálculo de la nota, los pagos y el cliente de la factura) también se baja al abrirla.
const NotaCreditoHoja = lazy(() =>
  import('./NotaCreditoHoja').then((m) => ({ default: m.NotaCreditoHoja })),
);

/** `/caja/comprobantes/:id`: el detalle para el Supervisor y el Cajero (de sus turnos). */
export function ComprobanteDetalleEnCajaPagina() {
  return <Detalle base={RUTA_PANEL_EN_CAJA} />;
}

/** `/administracion/comprobantes/:id`: el detalle para el Administrador. */
export function ComprobanteDetalleEnAjustesPagina() {
  return <Detalle base={RUTA_PANEL_EN_AJUSTES} />;
}

const instante = (valor: string) => `${fechaDeLima(valor)} ${horaDeLima(valor)}`;

function mensajeDeLectura(error: unknown): string {
  return mensajeDeError(error, {
    NO_ENCONTRADO: 'Este comprobante no existe o ya no está disponible.',
    PROHIBIDO: 'Este comprobante no es de tus turnos.',
  });
}

/**
 * El detalle de un comprobante (HU-31, criterio 174): lo que SUNAT respondió (motivo del rechazo y observaciones), el
 * envío con cada intento, los comprobantes relacionados y las acciones: «Reintentar» mientras el envío no termine.
 */
function Detalle({ base }: { base: string }) {
  const { id = '' } = useParams();
  const ubicacion = useLocation();
  const sondeo = useIntervaloDeSondeo();
  const volver = (ubicacion.state as { volver?: string } | null)?.volver ?? '';
  const consulta = useQuery({
    queryKey: claveComprobante(id),
    queryFn: ({ signal }) => leerComprobante(id, signal),
    staleTime: 0,
    refetchInterval: sondeo,
  });
  const atras = { a: `${base}${volver}`, etiqueta: 'Comprobantes' };
  const comprobante = consulta.data;

  if (!comprobante) {
    return (
      <Pagina titulo="Comprobante" atras={atras}>
        {consulta.isError ? (
          <ErrorDeCarga
            titulo="No pudimos cargar el comprobante"
            onReintentar={() => void consulta.refetch()}
            reintentando={consulta.isFetching}
          >
            {mensajeDeLectura(consulta.error)}
          </ErrorDeCarga>
        ) : (
          <EsqueletoDeLista etiqueta="Cargando el comprobante" filas={4} conInicial={false} />
        )}
      </Pagina>
    );
  }
  return <DetalleCargado base={base} atras={atras} volver={volver} comprobante={comprobante} />;
}

interface PropsCargado {
  base: string;
  atras: { a: string; etiqueta: string };
  volver: string;
  comprobante: ComprobanteDetalle;
}

function DetalleCargado({ base, atras, volver, comprobante }: PropsCargado) {
  const clientes = useQueryClient();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [parametros, ponerParametros] = useSearchParams();
  const puedeCobrar = usePermiso('COBRAR') !== 'prohibido';
  const puedeNota =
    usePermiso('EMITIR_NOTA_CREDITO') !== 'prohibido' && sePuedeEmitirNota(comprobante);
  const [notaAbierta, ponerNotaAbierta] = useState(false);
  const envio = useEnvioPendiente();
  const yaReemplazado = (ubicacion.state as { aviso?: string } | null)?.aviso === 'YA_REEMPLAZADO';

  const reintento = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: () => envio.enviar((extra) => reintentarEnvio(comprobante.id, extra)),
    onSuccess: (nuevo) => {
      clientes.setQueryData<ComprobanteDetalle>(claveComprobante(comprobante.id), (anterior) =>
        anterior ? { ...anterior, envio: nuevo } : anterior,
      );
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.facturacionPanel });
    },
    onError: (error) => {
      // Ya terminó o cambió: lo que se ve en pantalla estaba viejo.
      if (error instanceof ErrorApi && error.estado === 409) {
        void clientes.invalidateQueries({ queryKey: claveComprobante(comprobante.id) });
      }
    },
  });

  const reemision = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (entrada: ReemisionEntrada) =>
      envio.enviar((extra) => reemitir(comprobante.id, entrada, extra)),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.facturacion });
    },
    onError: (error) => {
      const fallo = falloDeReemision(error);
      if (fallo.releer)
        void clientes.invalidateQueries({ queryKey: claveComprobante(comprobante.id) });
      // Otra persona ya emitió el reemplazo: se lleva a quien lo pidió al comprobante nuevo.
      if (fallo.yaReemplazadoPor) {
        navegar(rutaDelDetalle(base, fallo.yaReemplazadoPor), {
          replace: true,
          state: { volver, aviso: 'YA_REEMPLAZADO' },
        });
      }
    },
  });

  const emitible = puedeCobrar && sePuedeEmitirOtro(comprobante);
  const abierto = parametros.get('emitir') === '1';
  const cambiarEmitir = (abrir: boolean) => {
    const siguiente = new URLSearchParams(parametros);
    if (abrir) siguiente.set('emitir', '1');
    else siguiente.delete('emitir');
    ponerParametros(siguiente, { replace: true, state: ubicacion.state });
  };
  const hecha = reemision.data;
  const reintentable = sePuedeReintentar(comprobante);

  let pie: ReactNode;
  if (hecha) {
    pie = (
      <Link
        to={rutaDelDetalle(base, hecha.comprobante.id)}
        state={{ volver }}
        className={claseBoton('principal', true)}
      >
        Ver el comprobante nuevo
      </Link>
    );
  } else if (emitible && abierto) {
    pie = (
      <Boton
        variante="principal"
        bloque
        type="submit"
        form={ID_FORMULARIO_DE_REEMISION}
        cargando={reemision.isPending}
        textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Emitiendo…'}
      >
        Emitir comprobante
      </Boton>
    );
  } else if (emitible) {
    pie = (
      <Boton variante="principal" bloque onClick={() => cambiarEmitir(true)}>
        Emitir otro
      </Boton>
    );
  } else if (reintentable) {
    pie = (
      <Boton
        variante="principal"
        bloque
        icono={IconoReintentar}
        cargando={reintento.isPending}
        textoCargando={envio.pendiente ? 'Pendiente de envío' : 'Pidiendo el reintento…'}
        onClick={() => reintento.mutate()}
      >
        Reintentar el envío
      </Boton>
    );
  } else if (puedeNota) {
    pie = (
      <Boton variante="principal" bloque onClick={() => ponerNotaAbierta(true)}>
        Nota de crédito
      </Boton>
    );
  }

  return (
    <Pagina
      titulo={`${NOMBRE_DE_TIPO_DOCUMENTO[comprobante.tipo]} ${comprobante.numero}`}
      atras={atras}
      {...(pie ? { pie } : {})}
    >
      <div className="detalle">
        {yaReemplazado ? (
          <Aviso tipo="info" titulo="Ya habían emitido el reemplazo">
            Otra persona emitió este comprobante en lugar del rechazado. Es el que ves aquí.
          </Aviso>
        ) : null}
        <EstadoDelComprobante comprobante={comprobante} sinAcciones />
        <AvisoPendiente pendiente={envio.pendiente} />
        {reintento.isSuccess ? (
          <Aviso tipo="ok" titulo="Pedimos reintentar el envío">
            En unos segundos verás aquí la respuesta de SUNAT.
          </Aviso>
        ) : null}
        {reintento.isError ? (
          <Aviso tipo="error" titulo="No pudimos pedir el reintento">
            {textoDeFalloDeReintento(reintento.error)}
          </Aviso>
        ) : null}

        {hecha ? (
          <Suspense fallback={null}>
            <ReemisionHecha respuesta={hecha} />
          </Suspense>
        ) : emitible && abierto ? (
          <Suspense
            fallback={
              <EsqueletoDeLista etiqueta="Cargando el formulario" filas={3} conInicial={false} />
            }
          >
            <EmitirOtro
              comprobante={comprobante}
              enviando={reemision.isPending}
              fallo={reemision.isError ? falloDeReemision(reemision.error).texto : undefined}
              onEnviar={(entrada) => reemision.mutate(entrada)}
              onCancelar={() => {
                reemision.reset();
                cambiarEmitir(false);
              }}
            />
          </Suspense>
        ) : null}

        {notaAbierta && puedeNota ? (
          <Suspense fallback={null}>
            <NotaCreditoHoja
              comprobante={comprobante}
              base={base}
              volver={volver}
              onCerrar={() => ponerNotaAbierta(false)}
            />
          </Suspense>
        ) : null}

        <Resumen comprobante={comprobante} />
        <RespuestaDeSunat comprobante={comprobante} />
        <EnvioYIntentos comprobante={comprobante} />
        <Relacionados base={base} volver={volver} comprobante={comprobante} />
      </div>
    </Pagina>
  );
}

function Resumen({ comprobante }: { comprobante: ComprobanteDetalle }) {
  const cliente = comprobante.cliente;
  return (
    <section className="detalle__bloque" aria-labelledby="detalle-resumen">
      <h2 id="detalle-resumen">Datos</h2>
      <dl className="detalle__datos">
        <Dato nombre="Emitido">{instante(comprobante.emitidoEn)}</Dato>
        <Dato nombre="Total">{montoEnSoles(comprobante.totales.total)}</Dato>
        <Dato nombre="Cliente">
          {cliente
            ? `${cliente.nombre} · ${cliente.tipoDocumento} ${cliente.numero}`
            : 'Sin cliente'}
        </Dato>
        <Dato nombre="Sucursal">{comprobante.sucursal.nombre}</Dato>
      </dl>
    </section>
  );
}

/** El motivo del rechazo, las observaciones y cuándo pasó cada cosa (criterio 127). */
function RespuestaDeSunat({ comprobante }: { comprobante: ComprobanteDetalle }) {
  const { sunat, marcas } = comprobante;
  const momentos = [
    ['Enviado', marcas?.enviadoEn],
    ['Aceptado', marcas?.aceptadoEn],
    ['Rechazado', marcas?.rechazadoEn],
    ['Anulado', marcas?.anuladoEn],
  ].filter((m): m is [string, string] => typeof m[1] === 'string');
  if (!sunat && momentos.length === 0) return null;
  const observaciones = sunat?.observaciones ?? [];
  return (
    <section className="detalle__bloque" aria-labelledby="detalle-sunat">
      <h2 id="detalle-sunat">Respuesta de SUNAT</h2>
      <dl className="detalle__datos">
        {sunat?.codigo ? <Dato nombre="Código">{sunat.codigo}</Dato> : null}
        {sunat?.mensaje ? <Dato nombre="Mensaje">{sunat.mensaje}</Dato> : null}
        {momentos.map(([nombre, valor]) => (
          <Dato key={nombre} nombre={nombre}>
            {instante(valor)}
          </Dato>
        ))}
      </dl>
      {observaciones.length > 0 ? (
        <div className="detalle__observaciones">
          <b>{observaciones.length === 1 ? 'Observación' : 'Observaciones'}</b>
          <ul>
            {observaciones.map((o) => (
              <li key={`${o.codigo}${o.mensaje}`}>{`${o.codigo}: ${o.mensaje}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Cómo va el envío y cada intento contra SUNAT, del más nuevo al más antiguo (criterio 135). */
function EnvioYIntentos({ comprobante }: { comprobante: ComprobanteDetalle }) {
  const { envio, intentos } = comprobante;
  if (!envio) return null;
  const enCurso = envio.estado !== 'TERMINADO';
  return (
    <section className="detalle__bloque" aria-labelledby="detalle-envio">
      <h2 id="detalle-envio">Envío</h2>
      <dl className="detalle__datos">
        <Dato nombre="Estado del envío">{NOMBRE_DE_ESTADO_DE_ENVIO[envio.estado]}</Dato>
        <Dato nombre="Intentos">{String(envio.intentos)}</Dato>
        {enCurso && envio.estado !== 'DETENIDO' && envio.proximoIntentoEn ? (
          <Dato nombre="Próximo intento">{instante(envio.proximoIntentoEn)}</Dato>
        ) : null}
        <Dato nombre="Plazo para enviarlo">{instante(envio.plazoHasta)}</Dato>
        {envio.ultimoError ? <Dato nombre="Último problema">{envio.ultimoError}</Dato> : null}
      </dl>
      {intentos.length > 0 ? (
        <>
          <h3 className="detalle__subtitulo">Intentos</h3>
          <ol className="detalle__intentos" aria-label="Intentos de envío">
            {intentos.map((i) => (
              <li key={i.numero} className="detalle__intento">
                <span className="detalle__intento-cabecera">
                  <b>{`Intento ${i.numero}`}</b>
                  <span>{`${i.operacion === 'EMITIR' ? 'Envío' : 'Consulta'} · ${instante(i.iniciadoEn)}`}</span>
                </span>
                <span>{NOMBRE_DE_RESULTADO[i.resultado]}</span>
                {i.codigo || i.mensaje ? (
                  <span className="texto-ayuda">
                    {[i.codigo, i.mensaje].filter(Boolean).join(': ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

/** El original que corrige una nota, lo que reemplaza o reemplazó este comprobante, y sus notas de crédito. */
function Relacionados({
  base,
  volver,
  comprobante,
}: {
  base: string;
  volver: string;
  comprobante: ComprobanteDetalle;
}) {
  const enlace = (id: string, numero: string) => (
    <Link to={rutaDelDetalle(base, id)} state={{ volver }} className="panel__enlace">
      {numero}
    </Link>
  );
  const filas: { nombre: string; valor: React.ReactNode }[] = [];
  if (comprobante.afectaA)
    filas.push({
      nombre: 'Corrige a',
      valor: enlace(comprobante.afectaA.id, comprobante.afectaA.numero),
    });
  if (comprobante.reemplazaA)
    filas.push({
      nombre: 'Reemplaza a',
      valor: enlace(comprobante.reemplazaA.id, comprobante.reemplazaA.numero),
    });
  if (comprobante.reemplazadoPor)
    filas.push({
      nombre: 'Reemplazado por',
      valor: enlace(comprobante.reemplazadoPor.id, comprobante.reemplazadoPor.numero),
    });
  for (const nota of comprobante.notasCredito ?? [])
    filas.push({ nombre: 'Nota de crédito', valor: enlace(nota.id, nota.numero) });
  if (filas.length === 0) return null;
  return (
    <section className="detalle__bloque" aria-labelledby="detalle-relacionados">
      <h2 id="detalle-relacionados">Relacionados</h2>
      <dl className="detalle__datos">
        {filas.map((f, i) => (
          <Dato key={`${f.nombre}${i}`} nombre={f.nombre}>
            {f.valor}
          </Dato>
        ))}
      </dl>
    </section>
  );
}

function Dato({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="detalle__dato">
      <dt>{nombre}</dt>
      <dd>{children}</dd>
    </div>
  );
}
