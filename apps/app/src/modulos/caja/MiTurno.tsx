import type { ReporteCaja, TurnoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  IconoCandado,
  IconoOk,
  IconoReintentar,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { CerrarCaja } from './CerrarCaja';
import { Movimientos } from './Movimientos';
import { ReporteDeCaja } from './ReporteDeCaja';
import { claveReporte, horaDelTurno, leerReporte, mensajeDeCaja, soles } from './turno';

type Vista = 'movimientos' | 'reporte-x';

const VISTAS: readonly OpcionDeSegmento<Vista>[] = [
  { valor: 'movimientos', etiqueta: 'Movimientos' },
  { valor: 'reporte-x', etiqueta: 'Reporte X' },
];

interface Props {
  turno: TurnoRespuesta;
  onCerrada: (reporte: ReporteCaja) => void;
}

/**
 * `/caja` con turno abierto (criterio 110 de 006): de qué caja es, desde cuándo y con qué fondo; el cambio entre
 * "Movimientos" y "Reporte X"; y, separado por una junta, "Cerrar caja". "Por cobrar" y "Mostrador" llegan con el
 * cobro. El cierre es una vista aparte (`?paso=cierre`) para que el botón de volver del celular regrese al turno.
 */
export function MiTurno({ turno, onCerrada }: Props) {
  const [parametros, ponerParametros] = useSearchParams();
  const navegar = useNavigate();
  const sondeo = useIntervaloDeSondeo();
  const cerrando = parametros.get('paso') === 'cierre';
  const vista: Vista = parametros.get('ver') === 'reporte-x' ? 'reporte-x' : 'movimientos';

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
        </section>

        <Segmentos
          etiqueta="Secciones de tu turno"
          opciones={VISTAS}
          valor={vista}
          onCambio={(valor) => ponerParametros({ ver: valor }, { replace: true })}
        />

        {vista === 'movimientos' ? (
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
                    icono={IconoReintentar}
                    onClick={() => void reporte.refetch()}
                    cargando={reporte.isFetching}
                    textoCargando="Actualizando…"
                  >
                    Actualizar
                  </Boton>
                </div>
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
