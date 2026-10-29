import type { PrecuentaRespuesta } from '@restaurante/contratos';
import { Aviso, Boton, EtiquetaDeEstado, Hoja, IconoNota } from '@restaurante/ui';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { horaDeLima, montoEnSoles } from '../../lib/formato';
import { tituloDeMesas } from './ordenes';
import { TEXTO_SIN_IMPRESION, esFraseDeIcbper, frasesDeLaNota } from './precuenta';
import './precuenta.css';

interface PropsPrecuenta {
  precuenta: PrecuentaRespuesta;
  /** `false` si después de pedirla se agregó o se anuló algo (decisión 10): la hoja lo dice y ofrece otra. */
  vale: boolean;
  /** Se está pidiendo otra pre-cuenta. */
  pidiendo: boolean;
  /** Un pedido espera la red. */
  pendiente: boolean;
  /** Lo que salió mal al pedir otra, si algo salió mal. */
  fallo: string | null;
  onPedirOtra: () => void;
  onCerrar: () => void;
}

/**
 * La pre-cuenta en pantalla (criterios 50 a 54 y 95 de 004): las líneas, el total con IGV incluido (sin
 * desglose, decisión 5) y la nota de la API, todo con cifras tabulares. En 3a no hay papel: lo dice. Si la
 * cuenta cambió después de pedirla, la hoja deja de presentarla como vigente y ofrece pedir otra.
 */
export function PrecuentaHoja({
  precuenta,
  vale,
  pidiendo,
  pendiente,
  fallo,
  onPedirOtra,
  onCerrar,
}: PropsPrecuenta) {
  const { orden, lineas } = precuenta;
  const comensales = `${orden.comensales} ${orden.comensales === 1 ? 'comensal' : 'comensales'}`;
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Pre-cuenta" className="hoja-precuenta">
      <div className={vale ? 'precuenta' : 'precuenta precuenta--vencida'}>
        <header className="precuenta__cabecera">
          <EtiquetaDeEstado tono={vale ? 'alerta' : 'mal'} icono={IconoNota}>
            {vale ? `Pre-cuenta ${precuenta.numero}` : `Pre-cuenta ${precuenta.numero}: ya no vale`}
          </EtiquetaDeEstado>
          <p className="precuenta__datos">
            {[
              tituloDeMesas(orden.mesas),
              orden.mozo.nombre,
              comensales,
              horaDeLima(precuenta.emitidaEn),
            ].join(' · ')}
          </p>
        </header>

        {!vale ? (
          <Aviso tipo="alerta" titulo="Esta pre-cuenta ya no vale">
            Se agregó o se anuló algo después de pedirla. Pide otra antes de mostrársela al cliente.
          </Aviso>
        ) : null}

        <ul className="precuenta__lineas" aria-label="Detalle de la pre-cuenta">
          {lineas.map((linea) => (
            <li key={linea.itemId} className="precuenta__linea">
              <span className="precuenta__cantidad">{linea.cantidad} ×</span>
              <span className="precuenta__texto">
                <span className="precuenta__nombre">{linea.nombre}</span>
                {linea.modificadores.length > 0 ? (
                  <span className="precuenta__detalle">{linea.modificadores.join(' · ')}</span>
                ) : null}
                {linea.cantidad > 1 ? (
                  <span className="precuenta__detalle">
                    {montoEnSoles(linea.precioUnitario)} cada uno
                  </span>
                ) : null}
              </span>
              <span className="precuenta__importe">{montoEnSoles(linea.total)}</span>
            </li>
          ))}
        </ul>

        <div className="precuenta__total">
          <span>
            Total
            <small>IGV incluido</small>
          </span>
          <b>{montoEnSoles(precuenta.total)}</b>
        </div>

        <div className="precuenta__nota">
          {frasesDeLaNota(precuenta.nota).map((frase) => (
            <p key={frase} className={esFraseDeIcbper(frase) ? 'precuenta__icbper' : undefined}>
              {frase}
            </p>
          ))}
        </div>

        <Aviso tipo="info">{TEXTO_SIN_IMPRESION}</Aviso>

        <div className="precuenta__pie">
          <AvisoPendiente pendiente={pendiente} />
          {fallo ? (
            <Aviso tipo="error" titulo="No pudimos pedir la pre-cuenta">
              {fallo}
            </Aviso>
          ) : null}
          {vale ? (
            <Boton variante="principal" bloque onClick={onCerrar}>
              Volver a la cuenta
            </Boton>
          ) : (
            <>
              <Boton
                variante="principal"
                bloque
                cargando={pidiendo}
                textoCargando={pendiente ? 'Pendiente de envío' : 'Pidiendo…'}
                onClick={onPedirOtra}
              >
                Pedir otra pre-cuenta
              </Boton>
              <Boton bloque onClick={onCerrar}>
                Volver a la cuenta
              </Boton>
            </>
          )}
        </div>
      </div>
    </Hoja>
  );
}
