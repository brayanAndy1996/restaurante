import type {
  ComprobanteDetalle,
  ComprobanteRespuesta,
  NotaCreditoRespuesta,
} from '@restaurante/contratos';
import type { TipoNotaCredito } from '@restaurante/dominio';
import { Aviso, Boton, EtiquetaDeEstado, IconoExito, claseBoton } from '@restaurante/ui';
import { Link } from 'react-router-dom';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { NOMBRE_DE_MEDIO_DE_PAGO } from '../caja/cobro';
import { EstadoDeLaImpresion } from '../caja/impresion-caja';
import { AccionesDelDocumento } from './AccionesDelDocumento';
import { EstadoDelComprobante } from './EstadoDelComprobante';
import { NOMBRE_DE_TIPO_DOCUMENTO, rutaDelDetalle } from './facturacion';
import { TITULO_DE_TIPO_DE_NOTA } from './notas-credito';
import '../caja/cuenta-caja.css';
import './nota-credito.css';

/**
 * Lo que se muestra de una nota emitida. Viene de la respuesta del envío (`NotaCreditoRespuesta`) o, si esa respuesta no
 * llegó pero el comprobante releído ya trae la nota, solo de la nota: entonces `devolucion` e `impresion` no se saben.
 */
export interface NotaEmitida {
  nota: ComprobanteRespuesta;
  factura?: ComprobanteRespuesta | null | undefined;
  devolucion?: NotaCreditoRespuesta['devolucion'] | undefined;
  impresion?: NotaCreditoRespuesta['impresion'] | undefined;
  trabajoIds?: readonly string[] | undefined;
}

interface Props {
  respuesta: NotaEmitida;
  tipo: TipoNotaCredito;
  /** El comprobante que se acreditó. */
  original: Pick<ComprobanteDetalle, 'tipo' | 'numero' | 'notasCredito'>;
  /** Dónde viven los detalles (`/caja/comprobantes` o `/administracion/comprobantes`) y a dónde vuelve «Atrás». */
  base: string;
  volver: string;
  onListo: () => void;
}

/** Un comprobante nuevo con su número, su marca de simulado y su estado ante SUNAT en vivo (criterio 173). */
function DocumentoNuevo({
  comprobante,
  conNumero,
  yaListado,
}: {
  comprobante: ComprobanteRespuesta;
  conNumero?: boolean;
  /** El detalle de atrás ya lista este número («Relacionados»): aquí no se repite suelto. */
  yaListado?: boolean;
}) {
  return (
    <div className="nota-hecha__documento">
      <p className="nota-hecha__numero">
        {`${NOMBRE_DE_TIPO_DOCUMENTO[comprobante.tipo]}${yaListado ? ' ' : ' · '}`}
        {/* El número no se parte en el guion al cambiar de línea (360 px). */}
        <span className="nota-hecha__nobreak">
          {yaListado ? `· ${comprobante.numero}` : comprobante.numero}
        </span>
      </p>
      {comprobante.simulado ? <EtiquetaDeEstado tono="alerta">Simulado</EtiquetaDeEstado> : null}
      <EstadoDelComprobante comprobante={comprobante} />
      <AccionesDelDocumento comprobante={comprobante} {...(conNumero ? { conNumero } : {})} />
    </div>
  );
}

/**
 * Lo que pasó al emitir la nota de crédito (criterios 144, 150, 151 y 173): el número de la nota (y el de la factura
 * nueva en un cambio) con su estado ante SUNAT en vivo, lo que se devolvió por medio y si salió el ticket.
 */
export function NotaCreditoHecha({ respuesta, tipo, original, base, volver, onListo }: Props) {
  const { nota, devolucion } = respuesta;
  const factura = respuesta.factura ?? null;
  const trabajoIds = respuesta.trabajoIds ?? [];
  return (
    <div className="nota-hecha">
      <div role="status">
        <Aviso tipo="ok" titulo="Nota de crédito emitida" icono={IconoExito}>
          {`${TITULO_DE_TIPO_DE_NOTA[tipo]} de ${NOMBRE_DE_TIPO_DOCUMENTO[original.tipo].toLowerCase()} ${original.numero}.`}
        </Aviso>
      </div>

      <DocumentoNuevo
        comprobante={nota}
        conNumero={factura !== null}
        yaListado={(original.notasCredito ?? []).some((n) => n.numero === nota.numero)}
      />
      {factura ? <DocumentoNuevo comprobante={factura} conNumero /> : null}

      {tipo === 'CAMBIO_A_FACTURA' && respuesta.factura === undefined ? (
        <p className="texto-ayuda">La factura nueva está en Comprobantes.</p>
      ) : null}

      {devolucion === undefined ? (
        <p className="texto-ayuda">Lo que se devolvió está en la nota de crédito.</p>
      ) : (
        <dl className="desglose" aria-label="Lo que se devolvió">
          {devolucion ? (
            <>
              {devolucion.pagos.map((p, i) => (
                <div key={`${p.medio}${i}`} className="desglose__fila">
                  <dt>{`Devuelto en ${NOMBRE_DE_MEDIO_DE_PAGO[p.medio].toLowerCase()}`}</dt>
                  <dd>{montoEnSoles(p.monto)}</dd>
                </div>
              ))}
              {!montoEsCero(devolucion.redondeo) ? (
                <div className="desglose__fila desglose__fila--ayuda">
                  <dt>Redondeo</dt>
                  <dd>{montoEnSoles(devolucion.redondeo)}</dd>
                </div>
              ) : null}
            </>
          ) : (
            <div className="desglose__fila">
              <dt>Devolución de dinero</dt>
              <dd>Ninguna</dd>
            </div>
          )}
        </dl>
      )}

      {respuesta.impresion ? (
        <EstadoDeLaImpresion
          impresion={respuesta.impresion}
          trabajoId={trabajoIds[0] ?? null}
          que={trabajoIds.length > 1 ? 'los tickets' : 'el ticket'}
        />
      ) : null}

      <div className="nota-hecha__acciones">
        <Boton variante="principal" bloque onClick={onListo}>
          Listo
        </Boton>
        <Link
          to={rutaDelDetalle(base, nota.id)}
          state={{ volver }}
          className={claseBoton('secundario', true)}
        >
          Ver la nota de crédito
        </Link>
      </div>
    </div>
  );
}
