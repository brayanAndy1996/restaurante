import {
  equipoActualRespuestaSchema,
  equipoRecordadoRespuestaSchema,
  recordarEquipoRespuestaSchema,
  type EquipoActualRespuesta,
} from '@restaurante/contratos';
import {
  borrarTokenDeEquipo,
  guardarTokenDeEquipo,
  tokenDeEquipo,
  tokensDeEquipo,
} from './almacen';
import { api, listaDe } from './api';
import { ErrorApi } from './errores';

/** Clave de la consulta de los equipos recordados de este navegador. */
export const CLAVE_EQUIPOS = ['equipos-recordados'] as const;

/** Persona que un equipo recuerda, con lo necesario para ingresarla con PIN. */
export interface PersonaDelEquipo {
  empresaId: string;
  /** Token del equipo que la recuerda (`X-Equipo`). */
  tokenEquipo: string;
  usuarioId: string;
  nombre: string;
  largoPin: 4 | 6;
  /** Instante (ISO) hasta el que el PIN de esta persona está bloqueado en este equipo, si lo está. */
  bloqueadoHastaEn: string | null;
}

/** Un equipo (el navegador de este celular dentro de una empresa) y cuántas personas recuerda. */
export interface EquipoConocido {
  empresaId: string;
  nombre: string;
  personas: number;
}

export interface EquiposRecordados {
  personas: PersonaDelEquipo[];
  equipos: EquipoConocido[];
  /** No se pudo preguntar por algún equipo (sin conexión, error del servidor): su token se conserva. */
  fallo: ErrorApi | null;
}

function personasDe(
  empresaId: string,
  tokenEquipo: string,
  respuesta: EquipoActualRespuesta,
): PersonaDelEquipo[] {
  return respuesta.personas.map((p) => ({
    empresaId,
    tokenEquipo,
    usuarioId: p.usuarioId,
    nombre: p.nombre,
    largoPin: p.largoPin,
    bloqueadoHastaEn: p.bloqueadoHastaEn,
  }));
}

/**
 * Arranque (criterio 92): pregunta `GET /equipo` por cada token de equipo guardado (uno por empresa). Un
 * `EQUIPO_NO_RECONOCIDO` borra ese token; cualquier otro fallo lo conserva (puede ser solo la red) y se
 * informa para que la pantalla ofrezca reintentar.
 */
export async function consultarEquiposRecordados(senal?: AbortSignal): Promise<EquiposRecordados> {
  const entradas = Object.entries(tokensDeEquipo());
  const resultados = await Promise.all(
    entradas.map(async ([empresaId, token]) => {
      try {
        const respuesta = await api.get('/equipo', {
          esquema: equipoActualRespuestaSchema,
          equipo: token,
          sinToken: true,
          reintentos: 2,
          ...(senal ? { senal } : {}),
        });
        return { empresaId, token, respuesta, error: null as ErrorApi | null };
      } catch (error) {
        if (senal?.aborted) throw error;
        if (error instanceof ErrorApi && error.codigo === 'EQUIPO_NO_RECONOCIDO') {
          borrarTokenDeEquipo(empresaId);
          return null;
        }
        const e =
          error instanceof ErrorApi
            ? error
            : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
        return { empresaId, token, respuesta: null, error: e };
      }
    }),
  );

  const personas: PersonaDelEquipo[] = [];
  const equipos: EquipoConocido[] = [];
  let fallo: ErrorApi | null = null;
  for (const r of resultados) {
    if (!r) continue;
    if (r.error) {
      fallo ??= r.error;
      continue;
    }
    if (!r.respuesta) continue;
    personas.push(...personasDe(r.empresaId, r.token, r.respuesta));
    equipos.push({
      empresaId: r.empresaId,
      nombre: r.respuesta.equipo.nombre,
      personas: r.respuesta.personas.length,
    });
  }
  return { personas, equipos, fallo };
}

/** Nombre legible de este navegador y sistema ("Chrome · Android"), para que el Administrador lo reconozca. */
export function nombreDelEquipo(agente?: string): string {
  const ua =
    agente ?? (typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '')).toString();
  const sistema = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iPhone'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'Mac'
          : /Linux|X11/i.test(ua)
            ? 'Linux'
            : null;
  const navegador = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
      ? 'Opera'
      : /SamsungBrowser/i.test(ua)
        ? 'Samsung Internet'
        : /Firefox|FxiOS/i.test(ua)
          ? 'Firefox'
          : /Chrome|CriOS|HeadlessChrome/i.test(ua)
            ? 'Chrome'
            : /Safari/i.test(ua)
              ? 'Safari'
              : null;
  if (navegador && sistema) return `${navegador} · ${sistema}`;
  return navegador ?? sistema ?? 'Equipo sin nombre';
}

/**
 * Después de un ingreso con contraseña (criterio 93): recuerda este navegador para la persona sin
 * pedirle nada. Manda el token de equipo de la empresa si lo hay y guarda el que llegue (equipo nuevo).
 */
export async function recordarEsteEquipo(empresaId: string): Promise<void> {
  const existente = tokenDeEquipo(empresaId);
  const respuesta = await api.post(
    '/sesion/equipo',
    { nombre: nombreDelEquipo() },
    {
      esquema: recordarEquipoRespuestaSchema,
      reintentos: 3,
      ...(existente ? { equipo: existente } : {}),
    },
  );
  if (respuesta.tokenEquipo) guardarTokenDeEquipo(empresaId, respuesta.tokenEquipo);
}

// --- Equipos recordados de una persona (Mis equipos) y de cualquier usuario (Administrador) ----------

export const listarMisEquipos = (senal?: AbortSignal) =>
  api.get('/sesion/equipos', {
    esquema: listaDe(equipoRecordadoRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const olvidarMiEquipo = (equipoRecordadoId: string) =>
  api.delete(`/sesion/equipos/${equipoRecordadoId}`);

export const listarEquiposDeUsuario = (usuarioId: string, senal?: AbortSignal) =>
  api.get(`/usuarios/${usuarioId}/equipos`, {
    esquema: listaDe(equipoRecordadoRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const revocarEquipoDeUsuario = (usuarioId: string, equipoRecordadoId: string) =>
  api.delete(`/usuarios/${usuarioId}/equipos/${equipoRecordadoId}`);

export const revocarEquiposDeUsuario = (usuarioId: string) =>
  api.delete(`/usuarios/${usuarioId}/equipos`);
