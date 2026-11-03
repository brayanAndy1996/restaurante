'use client';

import type { AvisoDeMesa } from '@/lib/llamados';
import { Aviso } from './Aviso';
import { Hoja } from './Hoja';

interface Props {
  /** "llamar" o "cuenta". */
  tipo: 'llamar' | 'cuenta';
  /** "Mesa 4". */
  mesa: string;
  enviando: boolean;
  aviso: AvisoDeMesa | null;
  /** Por qué no se puede enviar ahora, en palabras. */
  motivoBloqueo: string | null;
  alConfirmar: () => void;
  alCancelarEnvio: () => void;
  alCerrar: () => void;
}

/**
 * Confirmación corta de "Llamar al mozo" y "Pedir la cuenta" (criterio 85): una pregunta, una frase que explica y
 * dos botones apilados.
 */
export function HojaDeConfirmar({
  tipo,
  mesa,
  enviando,
  aviso,
  motivoBloqueo,
  alConfirmar,
  alCancelarEnvio,
  alCerrar,
}: Props) {
  const llamar = tipo === 'llamar';
  const bloqueado = enviando || motivoBloqueo !== null;
  return (
    <Hoja
      idTitulo="t-confirmar"
      titulo={llamar ? '¿Llamamos al mozo a tu mesa?' : '¿Pedimos la cuenta?'}
      sinCerrar
      alCerrar={alCerrar}
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
      <p>
        {llamar
          ? `El mozo recibirá un aviso en la ${mesa} y vendrá en cuanto pueda.`
          : `El mozo traerá la cuenta de la ${mesa}. Lo que ya pediste sigue en tu mesa.`}
      </p>
      {motivoBloqueo ? (
        <p className="hoja__ayuda hoja__ayuda--motivo" role="status">
          {motivoBloqueo}
        </p>
      ) : null}
      <div className="confirmar__acciones">
        <button
          type="button"
          className="boton-principal boton-principal--centro"
          aria-disabled={bloqueado}
          onClick={() => {
            if (!bloqueado) alConfirmar();
          }}
        >
          {enviando ? 'Enviando…' : llamar ? 'Sí, llamar al mozo' : 'Sí, pedir la cuenta'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Ahora no
        </button>
      </div>
    </Hoja>
  );
}
