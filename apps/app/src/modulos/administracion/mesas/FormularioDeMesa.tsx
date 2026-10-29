import { CAPACIDAD_MAXIMA_MESA, FORMAS_MESA, type FormaMesa } from '@restaurante/dominio';
import {
  Aviso,
  BotonIcono,
  CampoTexto,
  IconoAbajo,
  IconoArriba,
  IconoDerecha,
  IconoIzquierda,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import type { BorradorDeMesa, Direccion, ErroresDeMesa } from './mesas';

const FORMAS: readonly OpcionDeSegmento<FormaMesa>[] = FORMAS_MESA.map((f) => ({
  valor: f,
  etiqueta: f === 'CUADRADA' ? 'Cuadrada' : f === 'REDONDA' ? 'Redonda' : 'Rectangular',
}));

interface Props {
  /** Id del `<form>`: el botón fijo de abajo lo envía con `form=`. */
  formId: string;
  titulo: string;
  /** "Columna 3, fila 2". */
  lugar: string;
  borrador: BorradorDeMesa;
  errores: ErroresDeMesa;
  /** Aviso general (por ejemplo, un error del servidor). */
  general?: string | undefined;
  onCambio: (parcial: Partial<BorradorDeMesa>) => void;
  onEnviar: () => void;
  /** Solo al editar una mesa: mover de a una celda. */
  mover?: { onMover: (direccion: Direccion) => void; aviso: string };
  /** Acciones al final (desactivar). */
  children?: ReactNode;
  /** Pone el cursor en el nombre al abrir (al crear, que es lo primero que se escribe). */
  enfocarNombre?: boolean;
}

const FLECHAS: { direccion: Direccion; icono: typeof IconoArriba; etiqueta: string }[] = [
  { direccion: 'arriba', icono: IconoArriba, etiqueta: 'Mover una celda hacia arriba' },
  { direccion: 'izquierda', icono: IconoIzquierda, etiqueta: 'Mover una celda a la izquierda' },
  { direccion: 'abajo', icono: IconoAbajo, etiqueta: 'Mover una celda hacia abajo' },
  { direccion: 'derecha', icono: IconoDerecha, etiqueta: 'Mover una celda a la derecha' },
];

/** Datos de una mesa del mapa: nombre, capacidad y forma, y las flechas para moverla de celda. */
export function FormularioDeMesa({
  formId,
  titulo,
  lugar,
  borrador,
  errores,
  general,
  onCambio,
  onEnviar,
  mover,
  children,
  enfocarNombre,
}: Props) {
  const raiz = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (enfocarNombre) raiz.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [enfocarNombre]);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    onEnviar();
  }

  return (
    <form
      ref={raiz}
      id={formId}
      className="mapa__panel formulario"
      onSubmit={enviar}
      noValidate
      aria-labelledby={`${formId}-titulo`}
    >
      <div>
        <h3 className="formulario__titulo" id={`${formId}-titulo`}>
          {titulo}
        </h3>
        <p className="texto-ayuda">{lugar}</p>
      </div>
      {general ? (
        <Aviso tipo="error" titulo="No pudimos guardar la mesa">
          {general}
        </Aviso>
      ) : null}
      {errores.celda ? (
        <Aviso tipo="error" titulo="Esa celda no está libre">
          {errores.celda}
        </Aviso>
      ) : null}
      {mover ? (
        <div className="mapa__mover" role="group" aria-label="Mover la mesa">
          <p className="ui-campo__etiqueta">Mover en la cuadrícula</p>
          <div className="mapa__cruz">
            {FLECHAS.map((f) => (
              <BotonIcono
                key={f.direccion}
                icono={f.icono}
                etiqueta={f.etiqueta}
                className={`mapa__flecha mapa__flecha--${f.direccion}`}
                onClick={() => mover.onMover(f.direccion)}
              />
            ))}
          </div>
          <p className="texto-ayuda mapa__aviso-mover" role="status">
            {mover.aviso}
          </p>
        </div>
      ) : null}
      <CampoTexto
        etiqueta="Nombre de la mesa"
        value={borrador.nombre}
        onChange={(e) => onCambio({ nombre: e.target.value })}
        error={errores.nombre}
        autoComplete="off"
        enterKeyHint="next"
        maxLength={40}
        ayuda="Es el que verán los mozos, por ejemplo 4 o Terraza 2."
      />
      <CampoTexto
        etiqueta="Capacidad (personas)"
        value={borrador.capacidad}
        onChange={(e) => onCambio({ capacidad: e.target.value })}
        error={errores.capacidad}
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        ayuda={`De 1 a ${CAPACIDAD_MAXIMA_MESA} personas.`}
      />
      <div className="mapa__forma">
        <p className="ui-campo__etiqueta">Forma</p>
        <Segmentos
          etiqueta="Forma de la mesa"
          opciones={FORMAS}
          valor={borrador.forma}
          onCambio={(forma) => onCambio({ forma })}
        />
      </div>
      {children}
    </form>
  );
}
