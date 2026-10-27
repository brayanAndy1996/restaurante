import { useRef } from 'react';
import { nuevaClaveDeIdempotencia } from '../../lib/api';
import type { ErrorApi } from '../../lib/errores';

/**
 * Clave de idempotencia de una escritura lógica (por ejemplo, "registrar este pago"). Se pide con
 * `obtener()` al enviar y se reutiliza si la escritura falló sin saberse si llegó (corte de red o
 * error del servidor): repetirla con la misma clave no duplica el efecto. Con un rechazo claro (datos
 * inválidos, conflicto) o con éxito se suelta, y el siguiente envío usa una clave nueva.
 */
export function useClaveDeEscritura() {
  const clave = useRef<string | null>(null);
  return {
    obtener(): string {
      clave.current ??= nuevaClaveDeIdempotencia();
      return clave.current;
    },
    soltar(): void {
      clave.current = null;
    },
    /** Suelta la clave salvo que el resultado de la escritura sea dudoso. */
    alFallar(error: ErrorApi): void {
      if (error.sinConexion || error.reintentada || error.estado >= 500) return;
      clave.current = null;
    },
  };
}
