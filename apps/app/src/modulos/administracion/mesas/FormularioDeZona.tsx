import { Aviso, CampoTexto } from '@restaurante/ui';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import type { BorradorDeZona, ErroresDeZona } from './mesas';

interface Props {
  formId: string;
  titulo: string;
  borrador: BorradorDeZona;
  errores: ErroresDeZona;
  general?: string | undefined;
  onCambio: (parcial: Partial<BorradorDeZona>) => void;
  onEnviar: () => void;
  children?: ReactNode;
  enfocarNombre?: boolean;
}

/** Datos de una zona: nombre y tamaño de su cuadrícula (columnas y filas). */
export function FormularioDeZona({
  formId,
  titulo,
  borrador,
  errores,
  general,
  onCambio,
  onEnviar,
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
      <h3 className="formulario__titulo" id={`${formId}-titulo`}>
        {titulo}
      </h3>
      {general ? (
        <Aviso tipo="error" titulo="No pudimos guardar la zona">
          {general}
        </Aviso>
      ) : null}
      <CampoTexto
        etiqueta="Nombre de la zona"
        value={borrador.nombre}
        onChange={(e) => onCambio({ nombre: e.target.value })}
        error={errores.nombre}
        autoComplete="off"
        enterKeyHint="next"
        maxLength={80}
        placeholder="Por ejemplo, Salón principal"
      />
      <div className="mapa__medidas">
        <CampoTexto
          etiqueta="Columnas"
          value={borrador.columnas}
          onChange={(e) => onCambio({ columnas: e.target.value })}
          error={errores.columnas}
          inputMode="numeric"
          autoComplete="off"
          ayuda="De 2 a 12."
        />
        <CampoTexto
          etiqueta="Filas"
          value={borrador.filas}
          onChange={(e) => onCambio({ filas: e.target.value })}
          error={errores.filas}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          ayuda="De 1 a 30."
        />
      </div>
      {children}
    </form>
  );
}
