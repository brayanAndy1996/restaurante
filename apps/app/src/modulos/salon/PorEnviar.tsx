import {
  Aviso,
  BotonIcono,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoAlerta,
  IconoBasura,
  IconoPendiente,
  Boton,
} from '@restaurante/ui';
import { useState } from 'react';
import { AvisoPendiente } from '../../componentes/PendienteDeEnvio';
import { montoEnSoles } from '../../lib/formato';
import {
  totalDeLinea,
  totalDelBorrador,
  type BorradorEnPantalla,
  type LineaBorrador,
} from './borrador';
import './comandero.css';

interface Props {
  borrador: BorradorEnPantalla;
  onEditar: (linea: LineaBorrador) => void;
}

/** "3/4 · Huevo", los modificadores elegidos de una línea. */
const textoDeModificadores = (linea: LineaBorrador): string | null =>
  linea.modificadores.length > 0 ? linea.modificadores.map((m) => m.nombre).join(' · ') : null;

/**
 * "Por enviar" (criterio 91 de 004): lo que el mozo eligió y todavía no mandó a cocina. Cada línea se edita
 * (tocándola) o se quita sin clave; mientras un envío está en curso o sin terminar, las líneas se bloquean y
 * la pantalla lo dice con "Pendiente de envío" (criterio 92). Las líneas que la API rechazó llevan su motivo.
 */
export function PorEnviar({ borrador, onEditar }: Props) {
  const bloqueado = borrador.envioId !== null;
  const [quitada, setQuitada] = useState<LineaBorrador | null>(null);

  function quitar(linea: LineaBorrador) {
    borrador.quitar(linea.clave);
    setQuitada(linea);
  }
  function deshacer() {
    if (!quitada) return;
    borrador.agregar(quitada);
    setQuitada(null);
  }

  return (
    <div className="por-enviar">
      {borrador.aviso ? (
        <Aviso tipo={borrador.aviso.tipo} titulo={borrador.aviso.titulo}>
          {borrador.aviso.detalle}
        </Aviso>
      ) : null}
      {borrador.fase === 'esperando-red' ? <AvisoPendiente pendiente /> : null}
      {borrador.porReintentar && !borrador.aviso ? (
        <Aviso tipo="alerta" titulo="Hay un envío sin terminar" icono={IconoPendiente}>
          No sabemos si llegó a cocina. Toca «Reintentar el envío»: si ya había llegado, no se
          duplicará.
        </Aviso>
      ) : null}

      {borrador.lineas.length === 0 ? (
        <EstadoVacio icono={IconoPendiente} titulo="Nada por enviar">
          Elige productos en la carta y aparecerán aquí antes de salir a cocina.
        </EstadoVacio>
      ) : (
        <ul className="por-enviar__lista" aria-label="Productos por enviar">
          {borrador.lineas.map((linea) => (
            <li key={linea.clave}>
              <FilaDeLinea
                linea={linea}
                bloqueada={bloqueado}
                onEditar={() => onEditar(linea)}
                onQuitar={() => quitar(linea)}
              />
            </li>
          ))}
        </ul>
      )}

      {quitada ? (
        <p className="por-enviar__deshacer" role="status">
          <span>Quitaste {quitada.nombre}.</span>
          <Boton variante="texto" onClick={deshacer}>
            Deshacer
          </Boton>
        </p>
      ) : null}

      {borrador.lineas.length > 0 ? (
        <div className="por-enviar__total">
          <span>Total por enviar</span>
          <b>{montoEnSoles(totalDelBorrador(borrador.lineas))}</b>
        </div>
      ) : null}
    </div>
  );
}

function FilaDeLinea({
  linea,
  bloqueada,
  onEditar,
  onQuitar,
}: {
  linea: LineaBorrador;
  bloqueada: boolean;
  onEditar: () => void;
  onQuitar: () => void;
}) {
  const modificadores = textoDeModificadores(linea);
  const total = montoEnSoles(totalDeLinea(linea));
  const cuerpo = (
    <>
      <span className="linea__cantidad">{linea.cantidad} ×</span>
      <span className="linea__texto">
        <span className="linea__nombre">{linea.nombre}</span>
        {modificadores ? <span className="linea__detalle">{modificadores}</span> : null}
        {linea.observacion ? <span className="linea__detalle">«{linea.observacion}»</span> : null}
        {linea.paraLlevar || linea.tiempo === 2 ? (
          <span className="linea__etiquetas">
            {linea.tiempo === 2 ? (
              <EtiquetaDeEstado tono="alerta">Tiempo 2</EtiquetaDeEstado>
            ) : null}
            {linea.paraLlevar ? <EtiquetaDeEstado tono="info">Para llevar</EtiquetaDeEstado> : null}
          </span>
        ) : null}
      </span>
      <span className="linea__total">{total}</span>
    </>
  );
  const nombre = [
    `${linea.cantidad} × ${linea.nombre}`,
    modificadores,
    linea.observacion ? `observación: ${linea.observacion}` : null,
    total,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={linea.rechazo ? 'linea linea--rechazada' : 'linea'}>
      <div className="linea__fila">
        {bloqueada ? (
          <div className="linea__cuerpo linea__cuerpo--fijo">{cuerpo}</div>
        ) : (
          <button
            type="button"
            className="linea__cuerpo"
            aria-label={`Editar ${nombre}`}
            onClick={onEditar}
          >
            {cuerpo}
          </button>
        )}
        {bloqueada ? null : (
          <BotonIcono
            icono={IconoBasura}
            etiqueta={`Quitar ${linea.cantidad} × ${linea.nombre}`}
            onClick={onQuitar}
          />
        )}
      </div>
      {linea.rechazo ? (
        <p className="linea__rechazo" role="alert">
          <Icono icono={IconoAlerta} tamano={16} />
          <span>
            <b>No pasó:</b> {linea.rechazo}
          </span>
        </p>
      ) : null}
    </div>
  );
}
