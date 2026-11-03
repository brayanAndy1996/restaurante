'use client';

import { LARGO_NOTA_LLAMADO } from '@restaurante/dominio';
import type { AvisoDeMesa } from '@/lib/llamados';
import { nombresDeOpciones, type LineaPedido, type ProductoMesa } from '@/lib/pedido';
import { precioDeLinea } from '@/lib/reglas';
import { Icono } from '../Iconos';
import { Aviso } from './Aviso';
import { Hoja } from './Hoja';
import { Monto } from './Monto';

interface Props {
  /** "Mesa 4": va en el subtítulo. */
  mesa: string;
  lineas: readonly LineaPedido[];
  productos: ReadonlyMap<string, ProductoMesa>;
  /** Por qué una línea no se puede enviar (clave → texto), si hay. */
  problemas: ReadonlyMap<string, string>;
  nota: string;
  platos: number;
  total: string;
  /** Por qué "Enviar al mozo" está apagado, en palabras; `null` si se puede enviar. */
  motivoBloqueo: string | null;
  enviando: boolean;
  aviso: AvisoDeMesa | null;
  alEditar: (clave: string) => void;
  alQuitar: (clave: string) => void;
  alCambiarNota: (nota: string) => void;
  alEnviar: () => void;
  alCancelarEnvio: () => void;
  alCerrar: () => void;
}

/**
 * Hoja "Tu pedido" (criterio 84): una línea por plato con "Editar" y "Quitar", la nota para el mozo, el total con
 * `totalOrden` y "Enviar al mozo". Una línea que se agotó queda marcada y el envío se apaga hasta quitarla.
 */
export function HojaDePedido({
  mesa,
  lineas,
  productos,
  problemas,
  nota,
  platos,
  total,
  motivoBloqueo,
  enviando,
  aviso,
  alEditar,
  alQuitar,
  alCambiarNota,
  alEnviar,
  alCancelarEnvio,
  alCerrar,
}: Props) {
  const bloqueado = motivoBloqueo !== null || enviando;
  return (
    <Hoja
      idTitulo="t-pedido"
      titulo="Tu pedido"
      subtitulo={`${mesa} · ${platos} ${platos === 1 ? 'plato' : 'platos'}`}
      alCerrar={alCerrar}
      pie={
        <>
          <p className="hoja__total">
            <span>Total</span>
            <strong>
              <Monto valor={total} />
            </strong>
          </p>
          <p className="hoja__ayuda">
            El mozo revisará tu pedido contigo antes de mandarlo a cocina.
          </p>
          {motivoBloqueo ? (
            <p className="hoja__ayuda hoja__ayuda--motivo" role="status">
              {motivoBloqueo}
            </p>
          ) : null}
          <button
            type="button"
            className="boton-principal boton-principal--centro"
            aria-disabled={bloqueado}
            onClick={() => {
              if (!bloqueado) alEnviar();
            }}
          >
            {enviando ? 'Enviando…' : 'Enviar al mozo'}
          </button>
        </>
      }
    >
      {aviso ? (
        <Aviso
          aviso={aviso}
          accion={
            enviando ? (
              <button type="button" className="boton-texto" onClick={alCancelarEnvio}>
                Cancelar el envío
              </button>
            ) : undefined
          }
        />
      ) : null}

      {lineas.length === 0 ? (
        <p>Todavía no agregaste nada. Toca un plato de la carta para empezar.</p>
      ) : (
        <ul className="lineas">
          {lineas.map((linea) => {
            const producto = productos.get(linea.productoId);
            const problema = problemas.get(linea.clave);
            const precio = producto
              ? precioDeLinea(producto, linea.modificadorIds, linea.cantidad)
              : null;
            const opciones = producto ? nombresDeOpciones(producto, linea.modificadorIds) : [];
            const nombre = producto?.nombre ?? 'Plato que ya no está en la carta';
            const editable = producto !== undefined && problema !== 'Se agotó';
            return (
              <li key={linea.clave} className={problema ? 'linea--agotada' : undefined}>
                <div className="linea__cabecera">
                  <h3 className="linea__nombre">
                    {linea.cantidad} × {nombre}
                  </h3>
                  {precio ? (
                    <p className="precio">
                      <Monto valor={precio.total} />
                    </p>
                  ) : null}
                </div>
                {opciones.length > 0 ? (
                  <p className="linea__detalle">{opciones.join(' · ')}</p>
                ) : null}
                {linea.observacion ? (
                  <p className="linea__detalle">Indicaciones: {linea.observacion}</p>
                ) : null}
                {problema ? (
                  <p className="linea__motivo">
                    <span className="etiqueta etiqueta--error">
                      <Icono nombre="alerta" />
                      {problema}
                    </span>
                  </p>
                ) : null}
                <div className="linea__acciones">
                  {editable ? (
                    <button
                      type="button"
                      className="boton-texto"
                      aria-label={`Editar ${nombre}`}
                      onClick={() => alEditar(linea.clave)}
                    >
                      <Icono nombre="lapiz" pequeno />
                      Editar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="boton-texto boton-texto--peligro"
                    aria-label={`Quitar ${nombre}`}
                    onClick={() => alQuitar(linea.clave)}
                  >
                    <Icono nombre="basura" pequeno />
                    Quitar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="campo">
        <label htmlFor="nota-pedido">Nota para el mozo (opcional)</label>
        <textarea
          id="nota-pedido"
          rows={2}
          maxLength={LARGO_NOTA_LLAMADO}
          placeholder="Por ejemplo: somos 4, el niño no come ají"
          value={nota}
          onChange={(e) => alCambiarNota(e.target.value)}
        />
        <p className="campo__contador">
          {nota.length} de {LARGO_NOTA_LLAMADO}
        </p>
      </div>
    </Hoja>
  );
}
