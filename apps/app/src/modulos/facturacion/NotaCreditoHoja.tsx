import type {
  ComprobanteDetalle,
  NotaCreditoEntrada,
  NotaCreditoRespuesta,
} from '@restaurante/contratos';
import type { TipoNotaCredito } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  CampoAreaTexto,
  Hoja,
  SelectorDeCantidad,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { ClienteFactura } from '../caja/ClienteFactura';
import { CLIENTE_VACIO, resumirPagos, type ClienteEscrito, type PagoEscrito } from '../caja/cobro';
import { useClienteFactura } from '../caja/padron';
import { PagosPanel, pagoNuevo } from '../caja/PagosPanel';
import {
  claveCajasDeTurno,
  claveTurnoMio,
  horaDelTurno,
  leerTurnoMio,
  listarCajasActivas,
} from '../caja/turno';
import { useAjusteConClave } from '../caja/useAjusteConClave';
import { claveComprobante, NOMBRE_DE_TIPO_DOCUMENTO } from './facturacion';
import { NotaCreditoHecha } from './NotaCreditoHecha';
import {
  NOMBRE_DE_TIPO_DE_NOTA,
  calcularLaNota,
  devueltoDe,
  emitirNotaCredito,
  entradaDeNota,
  etiquetaDeTurno,
  esRespuestaFinal,
  falloDeNota,
  huellaDeNota,
  huellaDelCuerpoDeNota,
  lineasPorAcreditar,
  objetivoDeNota,
  textoDeMedios,
  tiposDeNota,
  totalEnSoles,
  turnoPropio,
  turnosAbiertos,
  unidadesElegidas,
  type FalloDeNota,
} from './notas-credito';
import '../caja/cobro.css';
import '../caja/cuenta-caja.css';
import './nota-credito.css';

/** Largo máximo del motivo (`motivoSchema`). */
const LARGO_MOTIVO = 300;

const TEXTO_DEL_TIPO: Record<TipoNotaCredito, string> = {
  ANULACION: 'Se anula el comprobante completo, con todas sus líneas.',
  DEVOLUCION: 'Elige cuántas unidades devuelves de cada línea.',
  CAMBIO_A_FACTURA:
    'Se anula la boleta y se emite una factura nueva con los mismos productos y montos. No se devuelve dinero.',
};

/** Motivos de un toque, por tipo de nota: lo más frecuente en la caja. */
const ATAJOS_DE_MOTIVO: Record<TipoNotaCredito, readonly string[]> = {
  ANULACION: ['Error al cobrar', 'El cliente no recibió el pedido', 'Cobro duplicado'],
  DEVOLUCION: ['Producto en mal estado', 'El cliente lo devolvió', 'Error al cobrar'],
  CAMBIO_A_FACTURA: ['El cliente pidió factura', 'Error en los datos del cliente'],
};

const OPCIONES_DE_DINERO: readonly OpcionDeSegmento<'DEVOLVER' | 'SIN'>[] = [
  { valor: 'DEVOLVER', etiqueta: 'Devolver el dinero' },
  { valor: 'SIN', etiqueta: 'Sin devolución' },
];

/** «1 unidad», «3 unidades»: lo que se devuelve en total. */
function textoDeUnidades(elegidas: readonly { cantidad: number }[]): string {
  const total = elegidas.reduce((n, l) => n + l.cantidad, 0);
  return `${total} ${total === 1 ? 'unidad' : 'unidades'}`;
}

function revisarMotivo(motivo: string): string | undefined {
  const limpio = motivo.trim();
  if (limpio === '') return 'Elige o escribe el motivo';
  if (Array.from(limpio).length > LARGO_MOTIVO) return `Usa ${LARGO_MOTIVO} caracteres como máximo`;
  return undefined;
}

interface Props {
  /** El comprobante tal como está ahora en pantalla (se vuelve a leer solo). */
  comprobante: ComprobanteDetalle;
  /** Dónde viven los detalles, para «Ver la nota de crédito». */
  base: string;
  volver: string;
  onCerrar: () => void;
}

/** Lo que se muestra cuando la nota ya salió. */
interface Hecha {
  respuesta: NotaCreditoRespuesta;
  tipo: TipoNotaCredito;
}

/**
 * Hoja «Nota de crédito» (RF-62, criterios 143 a 153 y 177), abierta desde el detalle de un comprobante aceptado: el
 * tipo (anular, devolver ítems o cambiar la boleta por factura), las líneas con − y + hasta lo que falta por acreditar,
 * el total calculado con `calcularNotaCredito`, el motivo, la devolución por medio (con el redondeo del efectivo y
 * desde el turno propio; sin turno abierto, «Sin devolución») y, para el Cajero, la ventana de clave con el objetivo
 * exacto que se manda. Si la API dice que la clave ya no vale, la pide otra vez sin perder lo escrito; el `id` de la
 * nota se conserva hasta una respuesta final, así un corte o un reintento nunca emiten dos.
 */
export function NotaCreditoHoja({ comprobante, base, volver, onCerrar }: Props) {
  const clientes = useQueryClient();
  const sesion = useSesionActiva();
  const permiso = usePermiso('EMITIR_NOTA_CREDITO');
  const ajuste = useAjusteConClave({ recordarComo: `nota-credito:${comprobante.id}` });

  const tipos = tiposDeNota(comprobante);
  const [tipoElegido, setTipoElegido] = useState<TipoNotaCredito | null>(null);
  const tipo: TipoNotaCredito | null =
    tipoElegido !== null && tipos.includes(tipoElegido) ? tipoElegido : (tipos[0] ?? null);
  const [unidades, setUnidades] = useState<Record<number, number>>({});
  const [motivo, setMotivo] = useState('');
  const [devolver, setDevolver] = useState(true);
  const [filas, setFilas] = useState<PagoEscrito[]>(() => [pagoNuevo('EFECTIVO')]);
  const [cliente, setCliente] = useState<ClienteEscrito>({
    ...CLIENTE_VACIO,
    tipoDocumento: 'RUC',
  });
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState<FalloDeNota | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hecha, setHecha] = useState<Hecha | null>(null);
  const alertaDeFallo = useRef<HTMLDivElement>(null);

  // --- La nota ------------------------------------------------------------------------------------------
  const lineas = useMemo(() => lineasPorAcreditar(comprobante), [comprobante]);
  const nota = useMemo(
    () => (tipo === null ? null : calcularLaNota(comprobante, tipo, unidades)),
    [comprobante, tipo, unidades],
  );
  const total = nota?.ok ? nota.total : null;
  const esCambio = tipo === 'CAMBIO_A_FACTURA';

  // --- La devolución desde el turno propio ----------------------------------------------------------------
  const usuarioId = sesion.usuario?.id ?? '';
  const sucursalId = sesion.sucursal?.id ?? '';
  // El Cajero devuelve solo desde su turno; el Supervisor y el Administrador, desde cualquiera de los abiertos.
  const elige = permiso === 'permitido';
  const turnoConsulta = useQuery({
    queryKey: claveTurnoMio(usuarioId, sucursalId),
    queryFn: ({ signal }) => leerTurnoMio(signal),
    enabled: !esCambio && !elige && sucursalId !== '',
  });
  const cajasConsulta = useQuery({
    queryKey: claveCajasDeTurno(sucursalId),
    queryFn: ({ signal }) => listarCajasActivas(signal),
    enabled: !esCambio && elige && sucursalId !== '',
  });
  const consultaDeTurnos = elige ? cajasConsulta : turnoConsulta;
  const turnos = useMemo(
    () =>
      elige ? turnosAbiertos(cajasConsulta.data ?? [], usuarioId) : turnoPropio(turnoConsulta.data),
    [elige, cajasConsulta.data, turnoConsulta.data, usuarioId],
  );
  const [turnoElegido, setTurnoElegido] = useState<string | null>(null);
  // El turno propio viene elegido; el de otra persona, solo si se elige (así nunca sale dinero de una caja por descuido).
  const turno = turnos.find((t) => t.id === turnoElegido) ?? turnos.find((t) => t.propio) ?? null;
  const hayDinero = total !== null && !montoEsCero(total);
  const devolviendo = !esCambio && hayDinero && turno !== null && devolver;
  const faltaElegirTurno =
    !esCambio && hayDinero && devolver && turnos.length > 0 && turno === null;
  const sinPropioUnico = elige && !(turnos.length === 1 && turnos[0]?.propio);
  const resumen = useMemo(() => resumirPagos(total ?? '0.00', filas, 'DEVOLUCION'), [total, filas]);

  // --- El cliente de la factura (cambio) ---------------------------------------------------------------------
  const padron = useClienteFactura(
    esCambio ? 'FACTURA' : 'BOLETA',
    comprobante.totales.total,
    cliente,
    setCliente,
  );
  const erroresDeCliente = intentado && !padron.validado.ok ? padron.validado.errores : null;

  const errorDelMotivo = intentado ? revisarMotivo(motivo) : undefined;

  if (hecha) {
    return (
      <>
        <Hoja abierta onCerrar={onCerrar} titulo="Nota de crédito" className="hoja-ajuste">
          <NotaCreditoHecha
            respuesta={hecha.respuesta}
            tipo={hecha.tipo}
            original={comprobante}
            base={base}
            volver={volver}
            onListo={onCerrar}
          />
        </Hoja>
        {ajuste.ventana}
      </>
    );
  }

  /** Lo que se mostraría debajo del total si todavía no se puede emitir. */
  const razonDeEspera: string | null =
    nota === null
      ? 'Este comprobante ya no admite notas de crédito.'
      : !nota.ok
        ? nota.motivo === 'SIN_UNIDADES'
          ? 'Elige al menos una unidad para devolver.'
          : nota.motivo === 'DATOS'
            ? 'No pudimos leer los montos de este comprobante. Avisa al Administrador.'
            : 'El comprobante cambió. Cierra esta ventana y ábrela de nuevo.'
        : !esCambio && consultaDeTurnos.isPending
          ? 'Revisando tu caja…'
          : null;

  async function emitir() {
    if (enviando || tipo === null || nota === null || !nota.ok) return;
    setFallo(null);
    setIntentado(true);
    const motivoLimpio = motivo.trim();
    if (revisarMotivo(motivo)) return;
    if (esCambio && !padron.validado.ok) return;
    if (faltaElegirTurno) return;
    if (devolviendo && resumen.pagos === null) return;

    const devolucion =
      devolviendo && turno && resumen.pagos
        ? {
            turnoId: turno.id,
            pagos: resumen.pagos.map((p) => ({
              medio: p.medio,
              monto: p.monto,
              ...(p.operacion ? { operacion: p.operacion } : {}),
            })),
            redondeo: resumen.redondeo,
          }
        : null;
    const cuerpo: NotaCreditoEntrada = entradaDeNota({
      id: '',
      comprobanteId: comprobante.id,
      tipo,
      motivo: motivoLimpio,
      total: nota.total,
      devueltas: nota.devueltas,
      devolucion,
      cliente: padron.validado.ok ? padron.validado.cliente : undefined,
    });
    // Lo que se autoriza es lo que se manda: el total de la nota y la suma de lo que se devuelve.
    const objetivo = objetivoDeNota(
      comprobante.id,
      tipo,
      nota.total,
      devueltoDe(devolucion?.pagos),
    );

    setEnviando(true);
    const resultado = await ajuste.ejecutar({
      accion: 'EMITIR_NOTA_CREDITO',
      permiso,
      objetivo,
      contexto: {
        mesa: '',
        comprobanteNumero: comprobante.numero,
        ...(devolucion ? { devueltoEn: textoDeMedios(devolucion.pagos.map((p) => p.medio)) } : {}),
      },
      motivo: motivoLimpio,
      huella: huellaDeNota(cuerpo),
      huellaDelCuerpo: huellaDelCuerpoDeNota(cuerpo),
      enviar: (id, extra) => emitirNotaCredito({ ...cuerpo, id }, extra),
    });

    const refrescar = () => {
      void clientes.invalidateQueries({ queryKey: claveComprobante(comprobante.id) });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.facturacion });
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
    };
    if (resultado.estado === 'hecho') ajuste.soltar();
    if (!ajuste.sigueMontada()) {
      // La persona cerró la hoja mientras esperaba la red: la nota salió igual, y el detalle se pone al día.
      if (resultado.estado === 'hecho') refrescar();
      return;
    }
    setEnviando(false);
    if (resultado.estado === 'cancelado') return;
    if (resultado.estado === 'hecho') {
      refrescar();
      setHecha({ respuesta: resultado.respuesta, tipo });
      return;
    }
    if (esRespuestaFinal(resultado.error)) ajuste.soltar();
    const traducido = falloDeNota(resultado.error);
    if (traducido.releer) {
      void clientes.invalidateQueries({ queryKey: claveComprobante(comprobante.id) });
    }
    if (traducido.releerTurnos) {
      void clientes.invalidateQueries({ queryKey: CLAVES_TIEMPO_REAL.turno });
    }
    setFallo(traducido);
    requestAnimationFrame(() => alertaDeFallo.current?.scrollIntoView?.({ block: 'nearest' }));
  }

  const conClave = permiso === 'clave';
  const opcionesDeTipo = tipos.map((t) => ({ valor: t, etiqueta: NOMBRE_DE_TIPO_DE_NOTA[t] }));
  const iva = nota?.ok ? nota.totales : null;

  return (
    <>
      <Hoja abierta onCerrar={onCerrar} titulo="Nota de crédito" className="hoja-ajuste">
        <div className="formulario ajuste nota">
          <div className="ajuste__que">
            <b>{`${NOMBRE_DE_TIPO_DOCUMENTO[comprobante.tipo]} ${comprobante.numero}`}</b>
            <span className="texto-ayuda">
              {`${montoEnSoles(comprobante.totales.total) ?? ''} · ${
                comprobante.cliente ? comprobante.cliente.nombre : 'Sin cliente'
              }`}
            </span>
          </div>

          {tipo === null ? (
            <Aviso tipo="alerta" titulo="Este comprobante ya no admite notas de crédito">
              Cierra esta ventana y mira el comprobante.
            </Aviso>
          ) : (
            <>
              {tipos.length > 1 ? (
                <Segmentos
                  etiqueta="Qué quieres hacer"
                  opciones={opcionesDeTipo}
                  valor={tipo}
                  onCambio={(nuevo) => {
                    setTipoElegido(nuevo);
                    setFallo(null);
                  }}
                />
              ) : null}
              <p className="texto-ayuda">
                {tipos.length === 1 &&
                tipo === 'DEVOLUCION' &&
                (comprobante.notasCredito ?? []).length > 0
                  ? 'Este comprobante ya tiene notas de crédito: lo que queda se devuelve por ítems.'
                  : TEXTO_DEL_TIPO[tipo]}
              </p>

              {tipo === 'DEVOLUCION' ? (
                <ul className="nota__lineas" aria-label="Líneas del comprobante">
                  {lineas.map((l) => {
                    const elegidas = Math.min(unidades[l.posicion] ?? 0, l.faltan);
                    return (
                      <li key={l.posicion} className="nota__linea">
                        <div className="nota__linea-texto">
                          <b>{l.descripcion}</b>
                          <span className="texto-ayuda">
                            {l.gratuita
                              ? 'Cortesía: no se devuelve'
                              : l.faltan === 0
                                ? 'Ya se devolvió todo'
                                : l.acreditadas > 0
                                  ? `Cobraste ${l.cantidad} · ya devuelto ${l.acreditadas} · faltan ${l.faltan}`
                                  : `Cobraste ${l.cantidad} × ${montoEnSoles(l.precioUnitario) ?? ''}`}
                          </span>
                        </div>
                        {l.faltan > 0 ? (
                          <SelectorDeCantidad
                            nombre={l.descripcion}
                            valor={elegidas}
                            minimo={0}
                            maximo={l.faltan}
                            onCambio={(valor) => {
                              setUnidades((previas) => ({ ...previas, [l.posicion]: valor }));
                              setFallo(null);
                            }}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {iva && nota?.ok ? (
                <p className="nota__incluye texto-ayuda" aria-live="polite">
                  {`Incluye IGV ${montoEnSoles(iva.igv) ?? ''}${
                    montoEsCero(iva.icbper) ? '' : ` · ICBPER ${montoEnSoles(iva.icbper) ?? ''}`
                  }`}
                  {tipo === 'DEVOLUCION'
                    ? ` · ${textoDeUnidades(unidadesElegidas(comprobante, unidades))}`
                    : ''}
                </p>
              ) : null}

              <div className="formulario__grupo">
                <Segmentos
                  etiqueta="Motivos frecuentes"
                  opciones={ATAJOS_DE_MOTIVO[tipo].map((a) => ({ valor: a, etiqueta: a }))}
                  valor={ATAJOS_DE_MOTIVO[tipo].find((a) => a === motivo) ?? ''}
                  onCambio={setMotivo}
                />
                <CampoAreaTexto
                  etiqueta="Motivo"
                  ayuda="Sale en la nota de crédito y en el ticket."
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  error={errorDelMotivo}
                  maxLength={LARGO_MOTIVO}
                  rows={1}
                />
              </div>

              {esCambio ? (
                <section className="nota__bloque" aria-labelledby="nota-cliente">
                  <h3 id="nota-cliente">Cliente de la factura</h3>
                  <ClienteFactura
                    tipo="FACTURA"
                    total={comprobante.totales.total}
                    cliente={cliente}
                    onCliente={setCliente}
                    errores={erroresDeCliente}
                    padron={padron}
                  />
                </section>
              ) : hayDinero ? (
                <section className="nota__bloque" aria-labelledby="nota-dinero">
                  <h3 id="nota-dinero">Devolución del dinero</h3>
                  {consultaDeTurnos.isPending ? (
                    <p className="texto-ayuda">Revisando tu caja…</p>
                  ) : turnos.length === 0 ? (
                    <Aviso
                      tipo="info"
                      titulo={
                        elige
                          ? 'Sin devolución: no hay ninguna caja abierta'
                          : 'Sin devolución: no tienes la caja abierta'
                      }
                    >
                      {consultaDeTurnos.isError
                        ? 'No pudimos revisar tu caja. La nota se emite sin devolución; si vas a devolver el dinero, vuelve a abrir esta ventana en un momento.'
                        : elige
                          ? 'La nota se emite igual, pero el dinero no sale de ninguna caja. Si lo vas a devolver ahora, abre una caja primero.'
                          : 'La nota se emite igual, pero el dinero no sale de tu caja. Si lo vas a devolver ahora, abre tu caja primero.'}
                    </Aviso>
                  ) : (
                    <>
                      <Segmentos
                        etiqueta="Devolución del dinero"
                        opciones={OPCIONES_DE_DINERO}
                        valor={devolver ? 'DEVOLVER' : 'SIN'}
                        onCambio={(v) => setDevolver(v === 'DEVOLVER')}
                      />
                      {devolver ? (
                        <>
                          {sinPropioUnico ? (
                            <div className="formulario__grupo">
                              <Segmentos
                                etiqueta="Turno del que sale el dinero"
                                opciones={turnos.map((t) => ({
                                  valor: t.id,
                                  etiqueta: etiquetaDeTurno(t),
                                }))}
                                valor={turno?.id ?? ''}
                                onCambio={setTurnoElegido}
                              />
                              {intentado && faltaElegirTurno ? (
                                <p className="pago__problema" role="alert">
                                  Elige el turno del que sale el dinero.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {turno ? (
                            <p className="texto-ayuda">
                              {`Sale ${turno.propio ? 'de tu turno' : `del turno de ${turno.responsable}`} en ${turno.caja}, abierto a las ${horaDelTurno(turno.abiertoEn)}.`}
                            </p>
                          ) : null}
                          {turno ? (
                            <PagosPanel
                              devolucion
                              filas={filas}
                              onFilas={setFilas}
                              resumen={resumen}
                              verProblemas={intentado}
                            />
                          ) : null}
                        </>
                      ) : (
                        <p className="texto-ayuda">La nota se emite sin mover dinero de tu caja.</p>
                      )}
                    </>
                  )}
                </section>
              ) : null}
            </>
          )}

          {conClave && !ajuste.nota ? (
            <Aviso tipo="info" titulo="Hace falta la clave de un supervisor">
              Al tocar el botón, el supervisor verá exactamente lo que autoriza y pondrá su PIN en
              tu celular.
            </Aviso>
          ) : null}
          {ajuste.nota ? (
            <Aviso tipo="info" titulo="Falta una clave nueva">
              {ajuste.nota}
            </Aviso>
          ) : null}

          <div className="ajuste__pie nota__pie">
            <AvisoPendiente pendiente={ajuste.pendiente} />
            {fallo ? (
              <div role="alert" ref={alertaDeFallo}>
                <Aviso tipo={fallo.releer ? 'alerta' : 'error'} titulo={fallo.titulo}>
                  {fallo.texto}
                </Aviso>
              </div>
            ) : null}
            <dl className="nota__total" aria-label="Total de la nota">
              <dt>Total de la nota</dt>
              <dd>{totalEnSoles(total)}</dd>
            </dl>
            {razonDeEspera ? (
              <p id="nota-espera" className="texto-ayuda" role="status">
                {razonDeEspera}
              </p>
            ) : null}
            <Boton
              variante="principal"
              bloque
              cargando={enviando}
              textoCargando={ajuste.pendiente ? 'Pendiente de envío' : 'Emitiendo…'}
              disabled={razonDeEspera !== null}
              {...(razonDeEspera ? { 'aria-describedby': 'nota-espera' } : {})}
              onClick={() => void emitir()}
            >
              {conClave ? 'Pedir clave de supervisor' : 'Emitir nota de crédito'}
            </Boton>
          </div>
        </div>
      </Hoja>
      {ajuste.ventana}
    </>
  );
}
