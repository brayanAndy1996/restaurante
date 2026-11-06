import type { ComprobanteRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  EtiquetaDeEstado,
  Icono,
  IconoError,
  IconoExito,
  IconoInfo,
  IconoReloj,
  claseBoton,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEstadoTiempoReal } from '../../lib/tiempo-real';
import { usePermiso } from '../acceso/permisos';
import { tieneFacturacion } from '../acceso/navegacion';
import { useSesionActiva } from '../acceso/sesion';
import {
  RUTA_PANEL_EN_CAJA,
  claveComprobante,
  describirEstado,
  leerComprobante,
  rutaDelDetalle,
} from './facturacion';
import './facturacion.css';

/**
 * Cuándo se vuelve a preguntar mientras el comprobante no tiene respuesta final. El evento `comprobante.estado` es lo
 * que actualiza la pantalla al instante, pero un evento puede perderse (un corte del socket, un aviso que llegó antes de
 * que existiera la consulta, un fallo del canal entre el worker y la API): sin una red de seguridad la pantalla diría
 * «Enviando a SUNAT…» para siempre. Por eso, con o sin conexión de tiempo real:
 *
 * - una lectura de refuerzo a los pocos segundos de la primera (casi todos los envíos terminan en ese lapso);
 * - luego, cada 15 s con el socket conectado (solo respaldo) y cada 8 s sin él.
 */
export const REFUERZO_DE_LECTURA_MS = 3_000;
export const SONDEO_CON_TIEMPO_REAL_MS = 15_000;
export const SONDEO_SIN_TIEMPO_REAL_MS = 8_000;

interface Props {
  /** Lo que respondió el cobro, la venta de mostrador o la nota de crédito: con eso se pinta mientras llega lo vivo. */
  comprobante: Pick<ComprobanteRespuesta, 'id' | 'estado' | 'simulado' | 'sunat' | 'tipo'>;
  /** En el detalle del comprobante las acciones («Emitir otro») viven en la propia pantalla. */
  sinAcciones?: boolean;
}

/**
 * El estado del comprobante ante SUNAT en el resultado de un cobro, de una venta de mostrador o de una nota de crédito
 * (criterio 173): «Enviando a SUNAT…», «Aceptado por SUNAT» o «Rechazado: <mensaje>». Se actualiza solo con el evento
 * `comprobante.estado`; además pregunta cada pocos segundos mientras no haya respuesta final (ver `REFUERZO_DE_LECTURA_MS`).
 * Con un rechazo ofrece «Emitir otro» a quien puede cobrar (pregunta 40) y solo a quien no puede emitirlo le dice que
 * avise a su supervisor (criterio 173). Un comprobante simulado lleva su marca.
 * Sin el módulo de Facturación en el plan no hay envío a SUNAT y no se muestra nada.
 */
export function EstadoDelComprobante({ comprobante, sinAcciones }: Props) {
  const sesion = useSesionActiva();
  const habilitado = tieneFacturacion(sesion);
  const puedeCobrar = usePermiso('COBRAR') !== 'prohibido';
  const tiempoReal = useEstadoTiempoReal();
  const consulta = useQuery({
    queryKey: claveComprobante(comprobante.id),
    queryFn: ({ signal }) => leerComprobante(comprobante.id, signal),
    enabled: habilitado,
    staleTime: 0,
    refetchInterval: (q) => {
      if (q.state.data !== undefined && describirEstado({ estado: q.state.data.estado }).final)
        return false;
      if (q.state.dataUpdateCount <= 1) return REFUERZO_DE_LECTURA_MS;
      return tiempoReal === 'conectado' ? SONDEO_CON_TIEMPO_REAL_MS : SONDEO_SIN_TIEMPO_REAL_MS;
    },
  });
  if (!habilitado) return null;

  // Lo vivo manda; mientras llega (o si no se pudo leer), lo que dijo la emisión.
  const vivo = consulta.data;
  const estado = vivo?.estado ?? comprobante.estado;
  const simulado = vivo?.simulado ?? comprobante.simulado ?? false;
  const descripcion = describirEstado({
    estado,
    sunatMensaje: vivo ? vivo.sunat?.mensaje : comprobante.sunat?.mensaje,
    envio: vivo?.envio,
  });
  const marca = simulado ? (
    <EtiquetaDeEstado tono="alerta">Simulado: sin valor tributario</EtiquetaDeEstado>
  ) : null;

  if (descripcion.tono === 'error' || descripcion.tono === 'alerta') {
    const rechazado = estado === 'RECHAZADO';
    return (
      <section className="estado-sunat" aria-label="Estado ante SUNAT">
        <Aviso
          tipo={descripcion.tono}
          titulo={descripcion.titulo}
          icono={rechazado ? IconoError : IconoReloj}
        >
          {descripcion.detalle ? (
            <p className="estado-sunat__texto">{descripcion.detalle}</p>
          ) : null}
          {rechazado && !sinAcciones ? (
            <p className="estado-sunat__texto">
              {puedeCobrar
                ? 'Corrige los datos y emite otro comprobante.'
                : 'Avísale a tu supervisor.'}
            </p>
          ) : null}
          {marca}
        </Aviso>
        {rechazado && puedeCobrar && !sinAcciones ? (
          <Link
            to={`${rutaDelDetalle(RUTA_PANEL_EN_CAJA, comprobante.id)}?emitir=1`}
            className={claseBoton('principal', true)}
          >
            Emitir otro
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="estado-sunat" aria-label="Estado ante SUNAT">
      <div className="estado-sunat__fila" role="status">
        <Icono
          icono={
            descripcion.tono === 'ok'
              ? IconoExito
              : descripcion.tono === 'info'
                ? IconoReloj
                : IconoInfo
          }
          className={`estado-sunat__icono estado-sunat__icono--${descripcion.tono}`}
        />
        <span className="estado-sunat__titulo">{descripcion.titulo}</span>
        {marca}
      </div>
      {descripcion.detalle ? <p className="estado-sunat__texto">{descripcion.detalle}</p> : null}
    </section>
  );
}
