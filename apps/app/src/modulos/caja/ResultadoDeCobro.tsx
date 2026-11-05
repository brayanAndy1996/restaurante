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
}: Props) {
  const cerrada = respuesta.cuenta.estado === 'CERRADA';
  const comprobante = respuesta.comprobante;
  const efectivo = respuesta.pagos.find((p) => p.medio === 'EFECTIVO');
  const hayVuelto = !montoEsCero(respuesta.vuelto);
  return (
    <div className="resultado">
      <div role="status">
        <Aviso tipo="ok" titulo="Cobrado" icono={IconoExito}>
          {parteIgual
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
          <dt>Total de la parte</dt>
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

      {cerrada ? (
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
        {cerrada ? null : (
          <Boton variante="principal" bloque onClick={onSeguir}>
            {textoDeSeguir}
          </Boton>
        )}
        <Link to={volverA} className={claseBoton(cerrada ? 'principal' : 'secundario', true)}>
          {cerrada ? 'Listo' : 'Volver a Por cobrar'}
        </Link>
      </div>
    </div>
  );
}
