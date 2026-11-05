import {
  impresionDeCajaRespuestaSchema,
  type ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import { EtiquetaDeEstado, IconoImpresora, claseBoton } from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, nuevaClaveDeIdempotencia } from '../../lib/api';
import { MUTACION_SIN_PAUSA, useEnvioPendiente, type ExtraDeEscritura } from '../../lib/envios';
import { mensajeDeError } from '../../lib/errores';
import { useSesionActiva } from '../acceso/sesion';
import { PREFIJO_DE_TRABAJOS, claveTrabajos, listarTrabajos } from '../impresion/trabajos';
import './impresion-caja.css';

/**
 * Lo que la caja cuenta de la impresión (historia 006, criterios 90 a 96 y 110 a 114): el estado de un trabajo
 * recién encolado (el ticket del comprobante, el reporte X o Z, el pulso de la gaveta), "Imprimir otra vez" del
 * comprobante y "Imprimir" del reporte X. La API decide qué se imprime y dónde; aquí solo se pide y se dice.
 */

export type EstadoDeImpresion = 'EN_COLA' | 'SIN_IMPRESORA';

// --- Llamadas a la API ----------------------------------------------------------------------------

/** `POST /comprobantes/:id/impresiones` (criterio 90): una copia nueva con la marca «REIMPRESIÓN», sin abrir la gaveta. */
export const imprimirComprobante = (comprobanteId: string, extra?: ExtraDeEscritura) =>
  api.post(`/comprobantes/${comprobanteId}/impresiones`, undefined, {
    esquema: impresionDeCajaRespuestaSchema,
    ...extra,
  });

/** `POST /turnos/:id/reporte-x/impresiones` (criterio 95): nunca responde 409; sin impresora, `SIN_IMPRESORA`. */
export const imprimirReporteX = (turnoId: string, extra?: ExtraDeEscritura) =>
  api.post(`/turnos/${turnoId}/reporte-x/impresiones`, undefined, {
    esquema: impresionDeCajaRespuestaSchema,
    ...extra,
  });

// --- Textos ---------------------------------------------------------------------------------------

export const TEXTO_SIN_IMPRESORA_DE_CAJA = 'Sin impresora de caja';

/** Por qué no se pudo imprimir, en palabras y con la salida. */
export const MENSAJES_DE_IMPRESION_DE_CAJA = {
  SIN_IMPRESORA:
    'Esta caja no tiene impresora. El Administrador puede elegirla en Ajustes › Cajas.',
  PROHIBIDO: 'Solo quien cobró en este turno, un supervisor o el Administrador puede imprimirlo.',
  NO_ENCONTRADO: 'Ya no encontramos ese documento. Actualiza la pantalla.',
  MODULO_NO_INCLUIDO:
    'El plan de esta sucursal no incluye esta función. Pide a tu administrador que lo revise.',
} as const;

/** El nombre de la impresora de un trabajo recién encolado, o `null` mientras no se sepa. */
export function useNombreDeImpresora(trabajoId: string | null | undefined): string | null {
  const sucursalId = useSesionActiva().sucursal?.id ?? '';
  const lista = useQuery({
    queryKey: claveTrabajos(sucursalId, 'todos'),
    queryFn: ({ signal }) => listarTrabajos({}, signal),
    enabled: Boolean(trabajoId) && sucursalId !== '',
    // El trabajo es de hace un instante: una lista guardada de antes no lo trae.
    refetchOnMount: 'always',
    retry: false,
  });
  if (!trabajoId) return null;
  return lista.data?.find((t) => t.id === trabajoId)?.impresora.nombre ?? null;
}

interface PropsEstado {
  impresion: EstadoDeImpresion | undefined;
  trabajoId: string | null | undefined;
  /** Qué sale: «el reporte X», «el reporte Z»; sin decir nada, el ticket. */
  que?: string;
  /** El pulso de la gaveta no imprime: «Abriendo la gaveta en Caja 1». */
  gaveta?: boolean;
}

/**
 * El estado de un trabajo de impresión de la caja: «Imprimiendo en Caja 1» o, sin impresora de caja, «Sin impresora
 * de caja» con el camino para el Administrador (enlace a Ajustes › Cajas) y un aviso para los demás. No dice nada
 * si la API no trajo `impresion` (una apertura con fondo en cero no abre la gaveta).
 */
export function EstadoDeLaImpresion({ impresion, trabajoId, que, gaveta }: PropsEstado) {
  const esAdministrador = useSesionActiva().esAdministrador;
  const nombre = useNombreDeImpresora(impresion === 'EN_COLA' ? trabajoId : null);
  if (!impresion) return null;
  if (impresion === 'SIN_IMPRESORA') {
    return (
      <div className="impresion-caja" role="status">
        <EtiquetaDeEstado tono="neutro" icono={IconoImpresora}>
          {TEXTO_SIN_IMPRESORA_DE_CAJA}
        </EtiquetaDeEstado>
        {esAdministrador ? (
          <Link to="/administracion/cajas" className={claseBoton()}>
            Elegir la impresora en Ajustes › Cajas
          </Link>
        ) : (
          <p className="texto-ayuda">El Administrador puede elegirla en Ajustes › Cajas.</p>
        )}
      </div>
    );
  }
  const donde = nombre ? ` en ${nombre}` : '';
  return (
    <div className="impresion-caja" role="status">
      <EtiquetaDeEstado tono="info" icono={IconoImpresora}>
        {gaveta ? `Abriendo la gaveta${donde}` : `Imprimiendo${que ? ` ${que}` : ''}${donde}`}
      </EtiquetaDeEstado>
    </div>
  );
}

// --- Imprimir otra vez sin duplicar ---------------------------------------------------------------

export interface FalloDeImpresionDeCaja {
  mensaje: string;
}

/**
 * Pide una impresión (`llamar`) con `enviarSinPerder` y una clave de idempotencia por documento que se conserva hasta
 * que sale bien: si la red se corta, el envío reintenta solo con esa clave; si falla y la persona vuelve a tocar, se
 * usa la misma clave y, si la primera sí llegó, no se imprime otra copia. Tras una respuesta buena, el siguiente
 * toque es una copia nueva a propósito y lleva clave nueva.
 */
export function useImpresionDeCaja(
  llamar: (id: string, extra: ExtraDeEscritura) => Promise<ImpresionDeCajaRespuesta>,
) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const claves = useRef(new Map<string, string>());
  const [enCurso, setEnCurso] = useState(false);
  const [resultado, setResultado] = useState<ImpresionDeCajaRespuesta | null>(null);
  const [fallo, setFallo] = useState<FalloDeImpresionDeCaja | null>(null);

  const mutacion = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: (id: string) => {
      const clave = claves.current.get(id) ?? nuevaClaveDeIdempotencia();
      claves.current.set(id, clave);
      return envio.enviar((extra) => llamar(id, extra), undefined, undefined, clave);
    },
  });

  async function imprimir(id: string) {
    if (enCurso) return;
    setEnCurso(true);
    setResultado(null);
    setFallo(null);
    try {
      const respuesta = await mutacion.mutateAsync(id);
      claves.current.delete(id);
      if (envio.sigueMontada()) setResultado(respuesta);
      void clientes.invalidateQueries({ queryKey: PREFIJO_DE_TRABAJOS });
    } catch (error) {
      if (envio.sigueMontada()) {
        setFallo({ mensaje: mensajeDeError(error, MENSAJES_DE_IMPRESION_DE_CAJA) });
      }
    } finally {
      if (envio.sigueMontada()) setEnCurso(false);
    }
  }

  return { imprimir, enCurso, resultado, fallo, pendiente: envio.pendiente };
}
