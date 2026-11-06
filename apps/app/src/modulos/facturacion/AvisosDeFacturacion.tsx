import { BannerDeEstado, IconoAlerta, IconoInfo, claseBoton } from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { useSesionActiva } from '../acceso/sesion';
import {
  RUTA_PANEL_EN_AJUSTES,
  RUTA_PANEL_EN_CAJA,
  DETALLE_MODO_SIMULADO,
  TITULO_MODO_SIMULADO,
  TEXTO_SIN_ACTIVAR,
  claveAlertas,
  leerAlertas,
  resumenDeAlertas,
} from './facturacion';

/**
 * Los avisos persistentes de la facturación para el Administrador y el Supervisor, en Caja y en Ajustes (criterio 175):
 * los comprobantes con alerta (con un enlace al panel ya filtrado), la facturación que no está activada y el modo
 * simulado (criterio 122). Lo que cuenta es `GET /facturacion/alertas` (con el alcance de quien pregunta); se vuelve
 * a pedir al abrir y cada vez que llega `facturacion.alerta` o `comprobante.estado`. Si no se pudo leer, no se
 * muestra nada: un aviso viejo diría lo que ya no es.
 */
export function AvisosDeFacturacion() {
  const sesion = useSesionActiva();
  const { pathname } = useLocation();
  const sondeo = useIntervaloDeSondeo();
  const consulta = useQuery({
    queryKey: claveAlertas(sesion.sucursal?.id ?? ''),
    queryFn: ({ signal }) => leerAlertas(signal),
    staleTime: 0,
    refetchInterval: sondeo,
  });
  const alertas = consulta.data;
  if (!alertas) return null;

  // El Administrador corrige desde Ajustes (ve todas sus sucursales); el Supervisor, desde Caja.
  const panel = sesion.esAdministrador ? RUTA_PANEL_EN_AJUSTES : RUTA_PANEL_EN_CAJA;
  const resumen = resumenDeAlertas(alertas);
  const grave = alertas.rechazados > 0 || alertas.detenidos > 0;
  return (
    <>
      {resumen ? (
        <BannerDeEstado
          tono={grave ? 'rocoto' : 'aji'}
          icono={IconoAlerta}
          titulo={resumen}
          accion={
            pathname.startsWith(panel) ? undefined : (
              <Link to={`${panel}?alerta=1`} className={claseBoton('secundario')}>
                Ver comprobantes
              </Link>
            )
          }
        >
          Revísalos para que lleguen a SUNAT.
        </BannerDeEstado>
      ) : null}
      {alertas.sinConfiguracion > 0 ? (
        <BannerDeEstado tono="aji" icono={IconoAlerta} titulo="Facturación electrónica sin activar">
          {TEXTO_SIN_ACTIVAR}
        </BannerDeEstado>
      ) : null}
      {alertas.modoSimulado ? (
        <BannerDeEstado tono="aji" icono={IconoInfo} titulo={TITULO_MODO_SIMULADO}>
          {DETALLE_MODO_SIMULADO}
        </BannerDeEstado>
      ) : null}
    </>
  );
}
