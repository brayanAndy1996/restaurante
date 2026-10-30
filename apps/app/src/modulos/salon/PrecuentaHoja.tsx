import type { PrecuentaRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  EtiquetaDeEstado,
  Hoja,
  IconoImpresora,
  IconoNota,
  IconoPendiente,
} from '@restaurante/ui';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { horaDeLima, montoEnSoles } from '../../lib/formato';
import { tituloDeMesas } from './ordenes';
import { TEXTO_DE_IMPRESION, esFraseDeIcbper, frasesDeLaNota } from './precuenta';
import './precuenta.css';

interface PropsPrecuenta {
  precuenta: PrecuentaRespuesta;
  /** `false` si después de pedirla se agregó o se anuló algo (decisión 10): la hoja lo dice y ofrece otra. */
  vale: boolean;
  /** Se está pidiendo otra pre-cuenta o mandando otra copia a la impresora. */
  pidiendo: boolean;
  /** Cuántas veces se mandó esta pre-cuenta a la impresora de caja desde que se abrió (1 la primera vez). */
  copias: number;
  /** Un pedido espera la red. */
  pendiente: boolean;
  /** Lo que salió mal al pedir otra, si algo salió mal. */
  fallo: string | null;
  onPedirOtra: () => void;
  /** Manda otra copia de esta misma pre-cuenta a la impresora de caja. */
  onImprimir: () => void;
  onCerrar: () => void;
}

/**
 * La pre-cuenta en pantalla (criterios 50 a 54, 95 y 138 de 004): las líneas, el total con IGV incluido (sin
 * desglose, decisión 5) y la nota de la API, todo con cifras tabulares. Dice qué pasó con el papel (`impresion`
 * de la respuesta): "En cola" con "Imprimir otra vez", o "Sin impresora de caja". Si la cuenta cambió después de
 * pedirla, la hoja deja de presentarla como vigente y ofrece pedir otra (que sale a la impresora).
 */
export function PrecuentaHoja({
  precuenta,
  vale,
  pidiendo,
  copias,
  pendiente,
  fallo,
  onPedirOtra,
  onImprimir,
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

        {vale ? <ImpresionDeLaPrecuenta impresion={precuenta.impresion} copias={copias} /> : null}

        <div className="precuenta__pie">
          <AvisoPendiente pendiente={pendiente} />
          {fallo ? (
            <Aviso
              tipo="error"
              titulo={vale ? 'No pudimos imprimir la pre-cuenta' : 'No pudimos pedir la pre-cuenta'}
            >
              {fallo}
            </Aviso>
          ) : null}
          {vale ? (
            <>
              {precuenta.impresion === 'EN_COLA' ? (
                <Boton
                  bloque
                  icono={IconoImpresora}
                  cargando={pidiendo}
                  textoCargando={pendiente ? 'Pendiente de envío' : 'Imprimiendo…'}
                  onClick={onImprimir}
                >
                  Imprimir otra vez
                </Boton>
              ) : null}
              <Boton variante="principal" bloque onClick={onCerrar}>
                Volver a la cuenta
              </Boton>
            </>
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

/** Qué pasó con el papel: "En cola" o "Sin impresora de caja", dicho con palabras y con icono. */
function ImpresionDeLaPrecuenta({
  impresion,
  copias,
}: {
  impresion: PrecuentaRespuesta['impresion'];
  copias: number;
}) {
  if (impresion === 'SIN_IMPRESORA') {
    return (
      <Aviso tipo="info" titulo={TEXTO_DE_IMPRESION.SIN_IMPRESORA.titulo}>
        {TEXTO_DE_IMPRESION.SIN_IMPRESORA.ayuda}
      </Aviso>
    );
  }
  const texto = TEXTO_DE_IMPRESION.EN_COLA;
  return (
    <div className="precuenta__impresion" role="status">
      <EtiquetaDeEstado tono="alerta" icono={IconoPendiente}>
        {texto.etiqueta}
      </EtiquetaDeEstado>
      <p>{copias > 1 ? texto.otraCopia : texto.ayuda}</p>
    </div>
  );
}
