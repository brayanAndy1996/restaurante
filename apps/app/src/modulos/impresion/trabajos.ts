import {
  trabajoCreadoRespuestaSchema,
  trabajoResumenSchema,
  type EstadoTrabajo,
  type TipoTrabajo,
  type TrabajoResumen,
} from '@restaurante/contratos';
import {
  IconoError,
  IconoOk,
  IconoPendiente,
  nombreAccesibleDeMesa,
  type LucideIcon,
  type TonoEtiqueta,
} from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, listaDe, nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente, type ExtraDeEscritura } from '../../lib/envios';
import { mensajeDeError } from '../../lib/errores';

/**
 * Trabajos de impresión en la PWA (historia 004, entrega 3b, criterios 128 y 139): la lista de hoy y la
 * reimpresión. La usan Ajustes › Impresión ("Trabajos de hoy") y la cuenta de la mesa. Aquí van las llamadas
 * a la API, los textos y el hook que reimprime sin duplicar.
 */

/** Cuelga de aquí todo lo de trabajos: una reimpresión que sale bien invalida el prefijo entero. */
export const PREFIJO_DE_TRABAJOS = ['impresion', 'trabajos'] as const;

export const claveTrabajos = (sucursalId: string, estado: EstadoTrabajo | 'todos' = 'todos') =>
  [...PREFIJO_DE_TRABAJOS, sucursalId, estado] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

/**
 * `GET /impresion/trabajos`: los del día operativo de la sucursal activa. Es una consulta que se repite
 * sola, así que no cuenta como actividad de la persona.
 */
export const listarTrabajos = (estado?: EstadoTrabajo, senal?: AbortSignal) =>
  api.get(`/impresion/trabajos${estado ? `?estado=${estado}` : ''}`, {
    esquema: listaDe(trabajoResumenSchema),
    segundoPlano: true,
    ...(senal ? { senal } : {}),
  });

/**
 * `POST /impresion/trabajos/:id/reimpresion` (criterio 128). La `Idempotency-Key` es obligatoria y viene de
 * `extra` (la pone `enviarSinPerder`): repetir con la misma clave no imprime dos veces.
 */
export const reimprimirTrabajo = (trabajoId: string, extra?: ExtraDeEscritura) =>
  api.post(`/impresion/trabajos/${trabajoId}/reimpresion`, undefined, {
    esquema: trabajoCreadoRespuestaSchema,
    ...extra,
  });

// --- Textos ---------------------------------------------------------------------------------------

export const TEXTO_DE_TIPO: Record<TipoTrabajo, string> = {
  COMANDA: 'Comanda',
  ADICION: 'Adición',
  MARCHAR: 'Marcha',
  ANULACION: 'Anulación',
  PRECUENTA: 'Pre-cuenta',
  PRUEBA: 'Página de prueba',
};

export const ESTADO_DE_TRABAJO: Record<
  EstadoTrabajo,
  { tono: TonoEtiqueta; icono: LucideIcon; texto: string }
> = {
  PENDIENTE: { tono: 'alerta', icono: IconoPendiente, texto: 'Pendiente' },
  IMPRESO: { tono: 'ok', icono: IconoOk, texto: 'Impreso' },
  VENCIDO: { tono: 'neutro', icono: IconoError, texto: 'Vencido' },
};

export const textoDeIntentos = (n: number): string => (n === 1 ? '1 intento' : `${n} intentos`);

/** Las mesas de un trabajo ("4" o "4, 5") dichas como en la cuenta: "Mesa 4", "Mesas 4 y 5". */
export function textoDeMesasDeTrabajo(mesa: string | null): string | null {
  const nombres = nombresDeMesas(mesa);
  if (nombres.length === 0) return null;
  if (nombres.length === 1) return nombreAccesibleDeMesa(nombres[0] ?? '');
  return `Mesas ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Los nombres de mesa de `trabajo.mesa` (separados por coma), sin espacios sobrantes. */
export const nombresDeMesas = (mesa: string | null): string[] =>
  (mesa ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');

/**
 * Los trabajos que son de esta cuenta. El contrato (`trabajoResumenSchema`) no trae el id de la cuenta ni el
 * número de envío, solo los nombres de sus mesas: se reconoce la cuenta por esas mesas y porque el trabajo
 * nació cuando ella ya estaba abierta. No incluye la página de prueba.
 */
export function trabajosDeLaCuenta(
  trabajos: readonly TrabajoResumen[],
  cuenta: { mesas: readonly { nombre: string }[]; abiertaEn: string },
): TrabajoResumen[] {
  const mesas = cuenta.mesas.map((m) => m.nombre.trim()).sort();
  const desde = Date.parse(cuenta.abiertaEn);
  return trabajos
    .filter((t) => {
      if (t.tipo === 'PRUEBA') return false;
      const delTrabajo = nombresDeMesas(t.mesa).sort();
      return (
        delTrabajo.length === mesas.length &&
        delTrabajo.every((n, i) => n === mesas[i]) &&
        Date.parse(t.creadoEn) >= desde - 1000
      );
    })
    .sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn) || a.id.localeCompare(b.id));
}

/** Por qué no se pudo reimprimir, con la salida. */
export const MENSAJES_DE_REIMPRESION = {
  SIN_IMPRESORA:
    'Ya no hay una impresora activa para este ticket. El Administrador puede elegir otra en Ajustes › Impresión.',
  NO_ENCONTRADO: 'Ese ticket ya no está disponible. Actualiza la lista.',
} as const;

// --- Reimprimir sin duplicar ----------------------------------------------------------------------

export interface FalloDeReimpresion {
  trabajoId: string;
  mensaje: string;
}

/**
 * Reimprime un trabajo con `enviarSinPerder`: una clave de idempotencia por ticket que se conserva hasta que
 * sale bien. Si la red se corta, el envío reintenta solo con esa clave; si falla y la persona vuelve a tocar
 * "Reimprimir", se usa **la misma clave**, así que si la primera vez sí llegó a la API no se imprime otra
 * copia. Una vez que sale bien, el siguiente toque es una copia nueva a propósito y lleva clave nueva.
 */
export function useReimpresion() {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const claves = useRef(new Map<string, string>());
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [fallo, setFallo] = useState<FalloDeReimpresion | null>(null);

  const mutacion = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (trabajoId: string) => {
      const clave = claves.current.get(trabajoId) ?? nuevaClaveDeIdempotencia();
      claves.current.set(trabajoId, clave);
      return envio.enviar(
        (extra) => reimprimirTrabajo(trabajoId, extra),
        undefined,
        undefined,
        clave,
      );
    },
  });

  async function reimprimir(trabajoId: string) {
    if (enCurso !== null) return;
    setEnCurso(trabajoId);
    setHecho(null);
    setFallo(null);
    try {
      await mutacion.mutateAsync(trabajoId);
      claves.current.delete(trabajoId);
      if (envio.sigueMontada()) setHecho(trabajoId);
      await clientes.invalidateQueries({ queryKey: PREFIJO_DE_TRABAJOS });
    } catch (error) {
      if (envio.sigueMontada()) {
        setFallo({ trabajoId, mensaje: mensajeDeError(error, MENSAJES_DE_REIMPRESION) });
      }
    } finally {
      if (envio.sigueMontada()) setEnCurso(null);
    }
  }

  return { reimprimir, enCurso, hecho, fallo, pendiente: envio.pendiente };
}
