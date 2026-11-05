import type { CobroRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  EtiquetaDeEstado,
  IconoExito,
  IconoImpresora,
  claseBoton,
} from '@restaurante/ui';
import { Link } from 'react-router-dom';
import { montoEnSoles, montoEsCero } from '../../lib/monto';
import { NOMBRE_DE_MEDIO_DE_PAGO } from './cobro';

interface Props {
  respuesta: CobroRespuesta;
  /** «Mesa 4», «Mesas 4 y 5» o «Llamado 23». */
  titulo: string;
  /** Si la cuenta se dividió en partes iguales: «Parte 2 de 3» y cuántas faltan. */
  parteIgual: { numero: number; de: number } | null;
  /** Qué sigue cuando falta cobrar algo de la cuenta. */
  textoDeSeguir: string;
  onSeguir: () => void;
  volverA: string;
  /** El número de llamado de una venta de mostrador (criterio 115): se muestra en grande y no hay mesa que liberar. */
  llamado?: number;
}

/**
 * Lo que pasó al cobrar (criterio 114): el comprobante emitido con su número, el vuelto, el redondeo, si salió o no por
 * una impresora y, si la cuenta quedó pagada, que la mesa está libre; si falta algo, cómo seguir. «Imprimir otra vez»
 * llega con la impresión (la API todavía responde `SIN_IMPRESORA`).
 */
export function ResultadoDeCobro({
  respuesta,
  titulo,
  parteIgual,
  textoDeSeguir,
  onSeguir,
  volverA,
  llamado,
}: Props) {
  const cerrada = respuesta.cuenta.estado === 'CERRADA';
  const comprobante = respuesta.comprobante;
  const efectivo = respuesta.pagos.find((p) => p.medio === 'EFECTIVO');
  const hayVuelto = !montoEsCero(respuesta.vuelto);
  const deMostrador = llamado !== undefined;
  return (
    <div className="resultado">
      {deMostrador ? (
        <p className="resultado__llamado" role="status">
          {`Llamado ${llamado}`}
        </p>
      ) : null}
      <div role="status">
        <Aviso tipo="ok" titulo="Cobrado" icono={IconoExito}>
          {deMostrador
            ? 'La venta está cobrada y el pedido ya salió a cocina.'
            : parteIgual
              ? `Parte ${parteIgual.numero} de ${parteIgual.de} de ${titulo}.`
              : `Cuenta de ${titulo}.`}
        </Aviso>
      </div>

      <p className="resultado__numero">
        {comprobante.tipo === 'FACTURA' ? 'Factura' : 'Boleta'} · {comprobante.numero}
      </p>

      {hayVuelto ? (
        <div className="resultado__vuelto" role="status">
          <span>Vuelto</span>
          <b>{montoEnSoles(respuesta.vuelto)}</b>
          {efectivo?.recibido ? (
            <span>{`Recibiste ${montoEnSoles(efectivo.recibido) ?? ''}`}</span>
          ) : null}
        </div>
      ) : null}

      <dl className="desglose" aria-label="Lo que se cobró">
        <div className="desglose__fila">
          <dt>{deMostrador ? 'Total de la venta' : 'Total de la parte'}</dt>
          <dd>{montoEnSoles(respuesta.total)}</dd>
        </div>
        {respuesta.pagos.map((p, i) => (
          <div key={`${p.medio}${i}`} className="desglose__fila desglose__fila--ayuda">
            <dt>{NOMBRE_DE_MEDIO_DE_PAGO[p.medio]}</dt>
            <dd>{montoEnSoles(p.monto)}</dd>
          </div>
        ))}
        {!montoEsCero(respuesta.redondeo) ? (
          <div className="desglose__fila desglose__fila--ayuda">
            <dt>Redondeo a favor del cliente</dt>
            <dd>{montoEnSoles(respuesta.redondeo)}</dd>
          </div>
        ) : null}
      </dl>

      {respuesta.impresion === 'SIN_IMPRESORA' ? (
        <EtiquetaDeEstado tono="neutro" icono={IconoImpresora}>
          Sin impresora
        </EtiquetaDeEstado>
      ) : (
        <EtiquetaDeEstado tono="info" icono={IconoImpresora}>
          Imprimiendo
        </EtiquetaDeEstado>
      )}

      {deMostrador ? null : cerrada ? (
        <div role="status">
          <Aviso tipo="ok" titulo={`${titulo} libre`}>
            La cuenta quedó pagada y la mesa vuelve a estar libre.
          </Aviso>
        </div>
      ) : (
        <Aviso tipo="info" titulo={`Falta cobrar ${montoEnSoles(respuesta.cuenta.saldo) ?? ''}`}>
          La mesa sigue ocupada hasta que se pague todo.
        </Aviso>
      )}

      <div className="resultado__acciones">
        {cerrada && !deMostrador ? null : (
          <Boton variante="principal" bloque onClick={onSeguir}>
            {textoDeSeguir}
          </Boton>
        )}
        <Link
          to={volverA}
          className={claseBoton(cerrada && !deMostrador ? 'principal' : 'secundario', true)}
        >
          {deMostrador ? 'Volver a Caja' : cerrada ? 'Listo' : 'Volver a Por cobrar'}
        </Link>
      </div>
    </div>
  );
}
