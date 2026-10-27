import { validarHorario, type TramoHorario } from '@restaurante/dominio';
import { useId, useState } from 'react';
import { Boton } from './Boton';
import { Icono, IconoAlerta, IconoCerrar, IconoMas } from './iconos';
import { clases } from './utilidades';

const DIAS = [
  { dia: 1, corto: 'Lun', largo: 'lunes' },
  { dia: 2, corto: 'Mar', largo: 'martes' },
  { dia: 3, corto: 'Mié', largo: 'miércoles' },
  { dia: 4, corto: 'Jue', largo: 'jueves' },
  { dia: 5, corto: 'Vie', largo: 'viernes' },
  { dia: 6, corto: 'Sáb', largo: 'sábado' },
  { dia: 7, corto: 'Dom', largo: 'domingo' },
] as const;

/** Ordena por día y hora de inicio, para que el mismo horario siempre se vea y se compare igual. */
export function ordenarTramos(tramos: TramoHorario[]): TramoHorario[] {
  return [...tramos].sort(
    (a, b) => a.dia - b.dia || a.desde.localeCompare(b.desde) || a.hasta.localeCompare(b.hasta),
  );
}

export function mismoHorario(a: TramoHorario[] | null, b: TramoHorario[] | null): boolean {
  if (a === null || b === null) return a === b;
  const x = ordenarTramos(a);
  const y = ordenarTramos(b);
  return (
    x.length === y.length &&
    x.every((t, i) => t.dia === y[i]?.dia && t.desde === y[i]?.desde && t.hasta === y[i]?.hasta)
  );
}

interface ErrorPorDia {
  dia: number;
  mensaje: string;
  /** Posiciones de los tramos afectados en `valor`. */
  indices: number[];
}

/** Traduce los errores de `validarHorario` a frases que dicen el problema y la salida. */
export function erroresDeHorario(valor: TramoHorario[]): ErrorPorDia[] {
  const resultado = validarHorario(valor);
  if (resultado.valido) return [];
  const nombreDe = (dia: number | undefined) => DIAS.find((d) => d.dia === dia)?.largo ?? '';
  return resultado.errores.map((error) => {
    const tramo = error.indice === undefined ? undefined : valor[error.indice];
    const dia = tramo?.dia ?? 1;
    const indices = error.indice === undefined ? [] : [error.indice];
    let mensaje: string;
    if (error.mensaje.includes('solapa')) {
      const otro = Number(/tramo (\d+)$/.exec(error.mensaje)?.[1]);
      const delOtro = Number.isInteger(otro) ? valor[otro] : undefined;
      if (Number.isInteger(otro)) indices.push(otro);
      mensaje =
        delOtro && delOtro.dia !== dia
          ? `El tramo del ${nombreDe(dia)} se cruza con uno del ${nombreDe(delOtro.dia)}. Cambia uno de los dos.`
          : `Los tramos del ${nombreDe(dia)} se cruzan. Cambia uno de los dos.`;
    } else if (error.mensaje.includes('igual')) {
      mensaje = `El tramo del ${nombreDe(dia)} empieza y termina a la misma hora. Cámbialo.`;
    } else {
      mensaje = error.mensaje;
    }
    return { dia, mensaje, indices };
  });
}

interface Edicion {
  dia: number;
  /** Posición del tramo que se edita en la lista ordenada; `null` si es uno nuevo. */
  indice: number | null;
  desde: string;
  hasta: string;
}

interface PropsEditor {
  valor: TramoHorario[];
  onCambio: (valor: TramoHorario[]) => void;
}

function etiquetaTramo(t: TramoHorario): string {
  return `${t.desde} – ${t.hasta}`;
}

/**
 * Editor de horario semanal: un bloque por día, un botón de tramo de 44 px por cada tramo, y un botón
 * para agregar. Admite varios tramos por día y tramos que cruzan la medianoche (se escriben tal cual,
 * "18:00 – 02:00"). La hora se elige con el selector nativo. Los errores de `validarHorario` salen
 * debajo del día afectado, en palabras.
 */
export function EditorDeHorario({ valor, onCambio }: PropsEditor) {
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const idBase = useId();
  const tramos = ordenarTramos(valor);
  const errores = erroresDeHorario(tramos);
  const indicesConError = new Set(errores.flatMap((e) => e.indices));

  function abrirNuevo(dia: number) {
    const delDia = tramos.filter((t) => t.dia === dia);
    const ultimo = delDia[delDia.length - 1];
    setErrorEdicion(null);
    setEdicion({
      dia,
      indice: null,
      desde: ultimo?.hasta ?? '18:00',
      hasta: ultimo ? '' : '23:00',
    });
  }

  function abrirExistente(indice: number) {
    const t = tramos[indice];
    if (!t) return;
    setErrorEdicion(null);
    setEdicion({ dia: t.dia, indice, desde: t.desde, hasta: t.hasta });
  }

  function guardarEdicion() {
    if (!edicion) return;
    if (!edicion.desde || !edicion.hasta) {
      setErrorEdicion('Elige la hora de inicio y la de fin.');
      return;
    }
    if (edicion.desde === edicion.hasta) {
      setErrorEdicion('El inicio y el fin no pueden ser la misma hora.');
      return;
    }
    const nuevo: TramoHorario = { dia: edicion.dia, desde: edicion.desde, hasta: edicion.hasta };
    const resto = edicion.indice === null ? tramos : tramos.filter((_, i) => i !== edicion.indice);
    onCambio(ordenarTramos([...resto, nuevo]));
    setEdicion(null);
  }

  function quitar(indice: number) {
    onCambio(tramos.filter((_, i) => i !== indice));
    setEdicion(null);
  }

  return (
    <div className="ui-horario">
      {DIAS.map(({ dia, corto, largo }) => {
        const delDia = tramos.map((t, indice) => ({ t, indice })).filter(({ t }) => t.dia === dia);
        const erroresDia = errores.filter((e) => e.dia === dia);
        const marcado = delDia.some(({ indice }) => indicesConError.has(indice));
        const editandoAqui = edicion?.dia === dia;
        return (
          <div
            key={dia}
            className={clases(
              'ui-horario__dia',
              (erroresDia.length > 0 || marcado) && 'ui-horario__dia--error',
            )}
          >
            <span className="ui-horario__nombre">
              <span aria-hidden="true">{corto}</span>
              <span className="ui-solo-lectores">{largo}</span>
            </span>
            <div className="ui-horario__tramos">
              {delDia.length === 0 && !editandoAqui ? (
                <span className="ui-horario__vacio">Sin acceso</span>
              ) : null}
              {delDia.map(({ t, indice }) => (
                <span
                  key={indice}
                  className={clases('ui-tramo', indicesConError.has(indice) && 'ui-tramo--error')}
                >
                  <button
                    type="button"
                    className="ui-tramo__editar"
                    aria-label={`Cambiar el tramo ${etiquetaTramo(t)} del ${largo}`}
                    onClick={() => abrirExistente(indice)}
                  >
                    {etiquetaTramo(t)}
                  </button>
                  <button
                    type="button"
                    className="ui-tramo__quitar"
                    aria-label={`Quitar el tramo ${etiquetaTramo(t)} del ${largo}`}
                    onClick={() => quitar(indice)}
                  >
                    <Icono icono={IconoCerrar} tamano={20} />
                  </button>
                </span>
              ))}
              {editandoAqui && edicion ? (
                <div className="ui-horario__edicion" role="group" aria-label={`Tramo del ${largo}`}>
                  <div className="ui-campo">
                    <label className="ui-campo__etiqueta" htmlFor={`${idBase}-desde`}>
                      Desde
                    </label>
                    <div className="ui-campo__entrada">
                      <input
                        id={`${idBase}-desde`}
                        className="ui-campo__control"
                        type="time"
                        value={edicion.desde}
                        onChange={(e) => setEdicion({ ...edicion, desde: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="ui-campo">
                    <label className="ui-campo__etiqueta" htmlFor={`${idBase}-hasta`}>
                      Hasta
                    </label>
                    <div className="ui-campo__entrada">
                      <input
                        id={`${idBase}-hasta`}
                        className="ui-campo__control"
                        type="time"
                        value={edicion.hasta}
                        onChange={(e) => setEdicion({ ...edicion, hasta: e.target.value })}
                      />
                    </div>
                  </div>
                  {errorEdicion ? (
                    <div className="ui-campo__mensaje" role="alert" style={{ width: '100%' }}>
                      <Icono icono={IconoAlerta} tamano={16} />
                      <span>{errorEdicion}</span>
                    </div>
                  ) : null}
                  <div className="ui-horario__edicion-acciones">
                    <Boton
                      variante="principal"
                      style={{ minHeight: 48, flex: 1 }}
                      onClick={guardarEdicion}
                    >
                      {edicion.indice === null ? 'Agregar tramo' : 'Guardar tramo'}
                    </Boton>
                    <Boton onClick={() => setEdicion(null)}>Cancelar</Boton>
                  </div>
                </div>
              ) : null}
              {erroresDia.length > 0 ? (
                <div className="ui-horario__errores">
                  {erroresDia.map((e, i) => (
                    <div key={i} className="ui-campo__mensaje" role="alert">
                      <Icono icono={IconoAlerta} tamano={16} />
                      <span>{e.mensaje}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="ui-horario__mas"
              aria-label={`Agregar tramo el ${largo}`}
              onClick={() => abrirNuevo(dia)}
            >
              <Icono icono={IconoMas} tamano={20} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
