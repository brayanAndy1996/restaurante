import {
  estadoImpresionRespuestaSchema,
  type EstadoImpresionRespuesta,
} from '@restaurante/contratos';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';

/**
 * Estado de la impresión de la sucursal (historia 004, entrega 3b, criterios 121, 122 y 138): la consulta
 * `GET /impresion/estado` que comparten el aviso de todas las pantallas, el KDS y Ajustes › Impresión, y las
 * reglas que deciden qué decir. Va en el paquete inicial, así que no importa montos ni nada pesado.
 */

/** Cada cuánto se vuelve a mirar el estado, aunque no llegue ningún evento (criterio 122). */
export const PERIODO_DE_REEVALUACION_MS = 15_000;

/** Pasado este tiempo sin señal, el puente cuenta como desconectado (criterio 121). */
export const SEGUNDOS_SIN_SENAL = 60;

export const claveEstadoImpresion = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.impresionEstado, sucursalId] as const;

/**
 * `GET /impresion/estado`: el puente y las impresoras de la sucursal activa. Es una consulta que se repite
 * sola: no cuenta como actividad de la persona ni se reintenta (la siguiente vuelta ya es el reintento).
 */
export const leerEstadoDeImpresion = (senal?: AbortSignal) =>
  api.get('/impresion/estado', {
    esquema: estadoImpresionRespuestaSchema,
    segundoPlano: true,
    reintentos: 0,
    ...(senal ? { senal } : {}),
  });

/** "hace 8 s", "hace 2 min", "hace 3 h", "hace 2 d". */
export function textoDeHace(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/**
 * Lo que la PWA le cuenta a la persona de la impresión. Solo existe cuando algo impide imprimir:
 * - `sin-puente`: hay impresoras, pero ningún puente vinculado que las alcance.
 * - `puente-desconectado`: el puente dejó de dar señal (más de 60 s).
 * - `no-responden`: el puente está bien pero alguna impresora no responde.
 */
export type AvisoDeImpresion =
  | { tipo: 'sin-puente'; pendientes: number }
  | { tipo: 'puente-desconectado'; sinSenal: string | null; pendientes: number }
  | { tipo: 'no-responden'; nombres: readonly string[]; pendientes: number };

const sumar = (n: readonly { pendientes: number }[]): number =>
  n.reduce((total, i) => total + i.pendientes, 0);

/**
 * Si el puente da señal ahora, con la hora de la API y no la del equipo: `ahora` de la respuesta más el
 * tiempo que pasó desde que llegó. Así un puente que dejó de latir se nota entre dos consultas.
 */
export function puenteConSenal(estado: EstadoImpresionRespuesta, desdeLaRespuestaMs: number) {
  const puente = estado.puente;
  if (!puente?.conectado || !puente.ultimaSenalEn) return false;
  const ahora = Date.parse(estado.ahora) + Math.max(0, desdeLaRespuestaMs);
  return (ahora - Date.parse(puente.ultimaSenalEn)) / 1000 <= SEGUNDOS_SIN_SENAL;
}

/**
 * Qué avisar según el estado (criterio 122), o `null` si no hay nada que avisar. Sin impresoras no hay nada
 * que imprimir, así que no se avisa de nada, tenga o no un puente. Una impresora `DESCONOCIDO` (por ejemplo,
 * una Bluetooth) no es un fallo: solo `NO_RESPONDE` avisa.
 */
export function avisoDeImpresion(
  estado: EstadoImpresionRespuesta,
  desdeLaRespuestaMs: number,
): AvisoDeImpresion | null {
  const { impresoras, puente } = estado;
  if (impresoras.length === 0) return null;
  if (!puente) return { tipo: 'sin-puente', pendientes: sumar(impresoras) };
  if (!puenteConSenal(estado, desdeLaRespuestaMs)) {
    const ahora = Date.parse(estado.ahora) + Math.max(0, desdeLaRespuestaMs);
    return {
      tipo: 'puente-desconectado',
      sinSenal: puente.ultimaSenalEn
        ? textoDeHace((ahora - Date.parse(puente.ultimaSenalEn)) / 1000)
        : null,
      pendientes: sumar(impresoras),
    };
  }
  const caidas = impresoras.filter((i) => i.estado === 'NO_RESPONDE');
  if (caidas.length === 0) return null;
  return { tipo: 'no-responden', nombres: caidas.map((i) => i.nombre), pendientes: sumar(caidas) };
}

/** "A", "A y B", "A, B y C". */
export function unirConY(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** "Los tickets quedan en cola (4)." o, si no hay ninguno todavía, que los nuevos esperarán. */
export function textoDeCola(pendientes: number): string {
  return pendientes > 0
    ? `Los tickets quedan en cola (${pendientes}).`
    : 'Los tickets nuevos quedan en cola.';
}

/** El título y el detalle del banner, con palabras (criterio 122). */
export function textosDelAviso(aviso: AvisoDeImpresion): { titulo: string; detalle: string } {
  switch (aviso.tipo) {
    case 'sin-puente':
      return {
        titulo: 'No hay un puente de impresión vinculado',
        detalle: textoDeCola(aviso.pendientes),
      };
    case 'puente-desconectado':
      return {
        titulo: 'El puente de impresión está desconectado',
        detalle: `${aviso.sinSenal ? `Última señal ${aviso.sinSenal}. ` : 'Aún no dio señal. '}${textoDeCola(aviso.pendientes)}`,
      };
    case 'no-responden':
      return {
        titulo:
          aviso.nombres.length === 1
            ? `La impresora ${aviso.nombres[0]} no responde`
            : `Las impresoras ${unirConY(aviso.nombres)} no responden`,
        detalle: `${aviso.nombres.length === 1 ? 'Revisa que esté encendida' : 'Revisa que estén encendidas'} y en la red del local. ${textoDeCola(aviso.pendientes)}`,
      };
  }
}

/** Resumen de una línea para el KDS: discreto cuando todo va bien, con la palabra clave cuando no. */
export interface ResumenDeImpresion {
  tono: 'ok' | 'alerta' | 'neutro';
  texto: string;
}

export function resumenDeImpresion(
  estado: EstadoImpresionRespuesta,
  desdeLaRespuestaMs: number,
): ResumenDeImpresion | null {
  if (estado.impresoras.length === 0) return null;
  const aviso = avisoDeImpresion(estado, desdeLaRespuestaMs);
  const enCola = (n: number) => (n > 0 ? ` · ${n} en cola` : '');
  if (aviso) {
    // Una línea corta: el detalle (cuál impresora, desde cuándo) ya lo dice el banner de arriba.
    const causa =
      aviso.tipo === 'sin-puente'
        ? 'sin puente'
        : aviso.tipo === 'puente-desconectado'
          ? 'puente desconectado'
          : aviso.nombres.length === 1
            ? '1 impresora no responde'
            : `${aviso.nombres.length} impresoras no responden`;
    return { tono: 'alerta', texto: `Impresión: ${causa}${enCola(aviso.pendientes)}` };
  }
  const pendientes = sumar(estado.impresoras);
  return estado.impresoras.every((i) => i.estado === 'LISTA')
    ? { tono: 'ok', texto: `Impresión lista${enCola(pendientes)}` }
    : { tono: 'neutro', texto: `Impresión sin datos de todas las impresoras${enCola(pendientes)}` };
}

/**
 * El estado de la impresión de la sucursal, vuelto a pedir cada 15 s y al instante con el evento
 * `impresion.estado` (`lib/tiempo-real.ts`). También se vuelve a dibujar cada 15 s: si una consulta
 * falla, "hace 2 min" y el paso a "desconectado" no se quedan congelados. `desdeLaRespuestaMs` es el
 * tiempo que pasó desde que llegó la respuesta, para usar con la hora de la API.
 */
export function useEstadoDeImpresion(sucursalId: string | undefined) {
  const consulta = useQuery({
    queryKey: claveEstadoImpresion(sucursalId ?? ''),
    queryFn: ({ signal }) => leerEstadoDeImpresion(signal),
    enabled: !!sucursalId,
    refetchInterval: PERIODO_DE_REEVALUACION_MS,
  });
  const [, dibujar] = useState(0);
  useEffect(() => {
    if (!sucursalId) return;
    const reloj = setInterval(() => dibujar((n) => n + 1), PERIODO_DE_REEVALUACION_MS);
    return () => clearInterval(reloj);
  }, [sucursalId]);
  return {
    estado: consulta.data,
    desdeLaRespuestaMs: Date.now() - consulta.dataUpdatedAt,
  };
}
