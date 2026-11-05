import type { ReporteCaja, TurnoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  IconoCandado,
  Icono,
  IconoImpresora,
  IconoPago,
  IconoOk,
  IconoReintentar,
  Segmentos,
  claseBoton,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { usePermiso } from '../acceso/permisos';
import { useSesionActiva } from '../acceso/sesion';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { CerrarCaja } from './CerrarCaja';
import { EstadoDeLaImpresion, imprimirReporteX, useImpresionDeCaja } from './impresion-caja';
import { Movimientos } from './Movimientos';
import { PorCobrar } from './PorCobrar';
import { ReporteDeCaja } from './ReporteDeCaja';
import {
  RUTA_DEL_MOSTRADOR,
  claveReporte,
  horaDelTurno,
  leerReporte,
  mensajeDeCaja,
  soles,
} from './turno';

type Vista = 'por-cobrar' | 'movimientos' | 'reporte-x';

const VISTAS: readonly OpcionDeSegmento<Vista>[] = [
  { valor: 'movimientos', etiqueta: 'Movimientos' },
  { valor: 'reporte-x', etiqueta: 'Reporte X' },
];
const VISTAS_CON_COBRO: readonly OpcionDeSegmento<Vista>[] = [
  { valor: 'por-cobrar', etiqueta: 'Por cobrar' },
  ...VISTAS,
];

interface Props {
  turno: TurnoRespuesta;
  /** Lo que dijo la API de la gaveta al abrir este turno (criterio 93); se omite con fondo 0.00 y al volver a la pantalla. */
  aperturaImpresa?: Pick<TurnoRespuesta, 'impresion' | 'trabajoId'> | undefined;
  onCerrada: (reporte: ReporteCaja) => void;
}

/**
 * `/caja` con turno abierto (criterio 110 de 006): de qué caja es, desde cuándo y con qué fondo; el cambio entre
 * "Por cobrar" (para quien cobra), "Movimientos" y "Reporte X"; y, separado por una junta, "Cerrar caja". "Mostrador" (la venta sin mesa, para quien cobra). El cierre es una vista aparte (`?paso=cierre`) para que el botón de volver del celular regrese al turno.
 */
export function MiTurno({ turno, aperturaImpresa, onCerrada }: Props) {
  const [parametros, ponerParametros] = useSearchParams();
  const navegar = useNavigate();
  const sondeo = useIntervaloDeSondeo();
  const cerrando = parametros.get('paso') === 'cierre';
  const puedeCobrar = usePermiso('COBRAR') !== 'prohibido';
  const sucursalId = useSesionActiva().sucursal?.id ?? '';
  const pedida = parametros.get('ver');
  const impresionDelX = useImpresionDeCaja(imprimirReporteX);
  // «Por cobrar» se ofrece a quien cobra; la vista por defecto sigue siendo «Movimientos» hasta que llegue el cobro.
  const vista: Vista =
    pedida === 'reporte-x'
      ? 'reporte-x'
      : pedida === 'por-cobrar' && puedeCobrar
        ? 'por-cobrar'
        : 'movimientos';

  // El reporte trae la lista de movimientos y, en el X, lo que debería haber. La pantalla de cierre no lo pide ni lo
  // muestra (arqueo a ciegas): se monta aparte, sin esta consulta.
  const reporte = useQuery({
    queryKey: claveReporte(turno.id),
    queryFn: ({ signal }) => leerReporte(turno.id, signal),
    enabled: !cerrando,
    refetchInterval: sondeo,
  });

  if (cerrando) {
    return (
      <CerrarCaja
        turno={turno}
        onCerrada={(z) => {
          navegar('/caja', { replace: true });
          onCerrada(z);
        }}
      />
    );
  }

  return (
    <Pagina titulo="Caja">
      <div className="turno">
        <section className="turno__resumen" aria-label="Tu turno">
          <div className="turno__resumen-cabecera">
            <b className="turno__caja">{turno.caja.nombre}</b>
            <EtiquetaDeEstado tono="ok" icono={IconoOk}>
              Turno abierto
            </EtiquetaDeEstado>
          </div>
          <dl className="turno__datos">
            <div className="turno__dato">
              <dt>Abierto desde</dt>
              <dd>{`las ${horaDelTurno(turno.abiertoEn)} · ${turno.responsable.nombre}`}</dd>
            </div>
            <div className="turno__dato">
              <dt>Fondo inicial</dt>
              <dd>{soles(turno.fondo)}</dd>
            </div>
          </dl>
          {aperturaImpresa?.impresion ? (
            <EstadoDeLaImpresion
              gaveta
              impresion={aperturaImpresa.impresion}
              trabajoId={aperturaImpresa.trabajoId}
            />
          ) : null}
        </section>

        {puedeCobrar ? (
          <Link to={RUTA_DEL_MOSTRADOR} className={claseBoton('principal', true)}>
            <Icono icono={IconoPago} tamano={20} />
            Vender en el mostrador
          </Link>
        ) : null}

        <Segmentos
          etiqueta="Secciones de tu turno"
          opciones={puedeCobrar ? VISTAS_CON_COBRO : VISTAS}
          valor={vista}
          onCambio={(valor) => ponerParametros({ ver: valor }, { replace: true })}
        />

        {vista === 'por-cobrar' ? (
          <PorCobrar sucursalId={sucursalId} />
        ) : vista === 'movimientos' ? (
          <Movimientos
            turno={turno}
            reporte={reporte.data}
            cargando={reporte.isPending}
            fallo={reporte.isError && reporte.data === undefined}
          />
        ) : (
          <div className="turno__x">
            {reporte.isPending ? (
              <EsqueletoDeLista etiqueta="Cargando el reporte X" filas={4} conInicial={false} />
            ) : reporte.isError && reporte.data === undefined ? (
              <ErrorDeCarga
                titulo="No pudimos cargar el reporte X"
                onReintentar={() => void reporte.refetch()}
                reintentando={reporte.isFetching}
              >
                {mensajeDeCaja(reporte.error)}
              </ErrorDeCarga>
            ) : reporte.data ? (
              <>
                <div className="turno__x-acciones">
                  <Boton
                    icono={IconoImpresora}
                    cargando={impresionDelX.enCurso}
                    textoCargando={impresionDelX.pendiente ? 'Pendiente de envío' : 'Imprimiendo…'}
                    onClick={() => void impresionDelX.imprimir(turno.id)}
                  >
                    Imprimir
                  </Boton>
                  <Boton
                    icono={IconoReintentar}
                    onClick={() => void reporte.refetch()}
                    cargando={reporte.isFetching}
                    textoCargando="Actualizando…"
                  >
                    Actualizar
                  </Boton>
                </div>
                <AvisoPendiente pendiente={impresionDelX.pendiente} />
                {impresionDelX.fallo ? (
                  <Aviso tipo="error" titulo="No pudimos imprimir el reporte X">
                    {impresionDelX.fallo.mensaje}
                  </Aviso>
                ) : null}
                {impresionDelX.resultado ? (
                  <EstadoDeLaImpresion
                    que="el reporte X"
                    impresion={impresionDelX.resultado.impresion}
                    trabajoId={impresionDelX.resultado.trabajoId}
                  />
                ) : null}
                {reporte.isError ? (
                  <Aviso tipo="alerta" titulo="No pudimos actualizar el reporte">
                    Lo que ves puede estar desactualizado. Seguimos intentando.
                  </Aviso>
                ) : null}
                <ReporteDeCaja reporte={reporte.data} />
              </>
            ) : null}
          </div>
        )}

        <div className="ui-acciones__separada turno__cerrar">
          <p className="texto-ayuda">
            Al terminar tu turno, cuenta el dinero y ciérralo para que quede el reporte Z.
          </p>
          <Boton bloque icono={IconoCandado} onClick={() => navegar('/caja?paso=cierre')}>
            Cerrar caja
          </Boton>
        </div>
      </div>
    </Pagina>
  );
}
