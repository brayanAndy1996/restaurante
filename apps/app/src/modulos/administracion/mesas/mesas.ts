import {
  mesaRespuestaSchema,
  zonaRespuestaSchema,
  type MesaEntrada,
  type MesaModificarEntrada,
  type MesaRespuesta,
  type ZonaEntrada,
  type ZonaModificarEntrada,
  type ZonaRespuesta,
} from '@restaurante/contratos';
import {
  CAPACIDAD_MAXIMA_MESA,
  COLUMNAS_MAXIMAS_ZONA,
  COLUMNAS_MINIMAS_ZONA,
  FILAS_MAXIMAS_ZONA,
  FILAS_MINIMAS_ZONA,
  type FormaMesa,
} from '@restaurante/dominio';
import { api, listaDe } from '../../../lib/api';
import type { ExtraDeEscritura } from '../../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../../lib/errores';

/** Mapa de mesas (historia 004, criterios 1 a 6 y 88 en el dibujo): zonas y mesas de una sucursal. */

export const claveZonas = (sucursalId: string) => ['mesas', 'zonas', sucursalId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

export const listarZonas = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/zonas`, {
    esquema: listaDe(zonaRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const crearZona = (sucursalId: string, entrada: ZonaEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/sucursales/${sucursalId}/zonas`, entrada, {
    esquema: zonaRespuestaSchema,
    idempotente: true,
    ...extra,
  });

export const modificarZona = (
  sucursalId: string,
  id: string,
  cambios: ZonaModificarEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.patch(`/sucursales/${sucursalId}/zonas/${id}`, cambios, {
    esquema: zonaRespuestaSchema,
    ...extra,
  });

export const ordenarZonas = (sucursalId: string, ids: string[], extra?: ExtraDeEscritura) =>
  api.put(
    `/sucursales/${sucursalId}/zonas/orden`,
    { ids },
    { esquema: listaDe(zonaRespuestaSchema), ...extra },
  );

export const crearMesa = (
  sucursalId: string,
  zonaId: string,
  entrada: MesaEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post(`/sucursales/${sucursalId}/zonas/${zonaId}/mesas`, entrada, {
    esquema: mesaRespuestaSchema,
    idempotente: true,
    ...extra,
  });

export const modificarMesa = (
  sucursalId: string,
  id: string,
  cambios: MesaModificarEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.patch(`/sucursales/${sucursalId}/mesas/${id}`, cambios, {
    esquema: mesaRespuestaSchema,
    ...extra,
  });

// --- Caché: lo que devuelve cada escritura se refleja sin volver a pedir la lista -------------------

export function conZonaGuardada(
  zonas: readonly ZonaRespuesta[],
  zona: ZonaRespuesta,
): ZonaRespuesta[] {
  return zonas.some((z) => z.id === zona.id)
    ? zonas.map((z) => (z.id === zona.id ? zona : z))
    : [...zonas, zona];
}

/** La mesa guardada reemplaza a la anterior (que pudo estar en otra zona) y queda en su zona. */
export function conMesaGuardada(
  zonas: readonly ZonaRespuesta[],
  mesa: MesaRespuesta,
): ZonaRespuesta[] {
  return zonas.map((z) => {
    const sinLaMesa = z.mesas.filter((m) => m.id !== mesa.id);
    return z.id === mesa.zonaId
      ? { ...z, mesas: [...sinLaMesa, mesa] }
      : { ...z, mesas: sinLaMesa };
  });
}

// --- Reglas del dibujo ------------------------------------------------------------------------------

export const mesasActivas = (zona: ZonaRespuesta): MesaRespuesta[] =>
  zona.mesas.filter((m) => m.activa);

export function mesaEnCelda(
  zona: ZonaRespuesta,
  columna: number,
  fila: number,
  exceptoId?: string,
): MesaRespuesta | undefined {
  return mesasActivas(zona).find(
    (m) => m.columna === columna && m.fila === fila && m.id !== exceptoId,
  );
}

/** Primera celda libre leyendo de izquierda a derecha y de arriba abajo, o `null` si la zona está llena. */
export function primeraCeldaLibre(zona: ZonaRespuesta): { columna: number; fila: number } | null {
  for (let fila = 1; fila <= zona.filas; fila++) {
    for (let columna = 1; columna <= zona.columnas; columna++) {
      if (!mesaEnCelda(zona, columna, fila)) return { columna, fila };
    }
  }
  return null;
}

/** El nombre sigue la numeración: el número más alto de las mesas activas de la sucursal más uno. */
export function nombreSugerido(zonas: readonly ZonaRespuesta[]): string {
  let mayor = 0;
  for (const zona of zonas) {
    for (const mesa of mesasActivas(zona)) {
      const numero = /(\d+)\s*$/.exec(mesa.nombre.trim());
      if (numero) mayor = Math.max(mayor, Number(numero[1]));
    }
  }
  const siguiente = String(mayor + 1);
  return siguiente.length <= 20 ? siguiente : '';
}

export type Direccion = 'izquierda' | 'derecha' | 'arriba' | 'abajo';

const PASO: Record<Direccion, [number, number]> = {
  izquierda: [-1, 0],
  derecha: [1, 0],
  arriba: [0, -1],
  abajo: [0, 1],
};

export type ResultadoDeMovimiento =
  { ok: true; columna: number; fila: number } | { ok: false; motivo: string };

/** Un paso en una dirección: avisa con palabras por qué no se puede (borde de la cuadrícula u otra mesa). */
export function mover(
  zona: ZonaRespuesta,
  mesaId: string,
  desde: { columna: number; fila: number },
  direccion: Direccion,
): ResultadoDeMovimiento {
  const columna = desde.columna + PASO[direccion][0];
  const fila = desde.fila + PASO[direccion][1];
  if (columna < 1 || columna > zona.columnas || fila < 1 || fila > zona.filas) {
    return { ok: false, motivo: 'Ya está en el borde de la cuadrícula.' };
  }
  const ocupante = mesaEnCelda(zona, columna, fila, mesaId);
  if (ocupante) {
    return {
      ok: false,
      motivo: `Ahí está la mesa ${ocupante.nombre}. Elige otra dirección o mueve esa mesa primero.`,
    };
  }
  return { ok: true, columna, fila };
}

// --- Mesas: borrador y validación -------------------------------------------------------------------

export interface BorradorDeMesa {
  nombre: string;
  /** Texto del campo: se valida como entero al guardar. */
  capacidad: string;
  forma: FormaMesa;
  columna: number;
  fila: number;
}

export type ErroresDeMesa = Partial<Record<'nombre' | 'capacidad' | 'celda', string>>;

export const borradorDeMesa = (mesa: MesaRespuesta): BorradorDeMesa => ({
  nombre: mesa.nombre,
  capacidad: String(mesa.capacidad),
  forma: mesa.forma,
  columna: mesa.columna,
  fila: mesa.fila,
});

const largo = (texto: string) => Array.from(texto).length;

/** Entero de `minimo` a `maximo` escrito solo con dígitos, o `null`. */
export function enteroEnRango(texto: string, minimo: number, maximo: number): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,4}$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= minimo && n <= maximo ? n : null;
}

const mismoNombre = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('es-PE') === b.trim().toLocaleLowerCase('es-PE');

export interface ContextoDeMesa {
  zona: ZonaRespuesta;
  /** Todas las zonas de la sucursal: el nombre de una mesa es único entre las activas de la sucursal. */
  zonas: readonly ZonaRespuesta[];
  /** La mesa que se edita; ausente al crear. */
  mesaId?: string;
}

export type ResultadoDeMesa =
  { ok: true; mesa: MesaEntrada } | { ok: false; errores: ErroresDeMesa };

export function validarMesa(borrador: BorradorDeMesa, contexto: ContextoDeMesa): ResultadoDeMesa {
  const errores: ErroresDeMesa = {};
  const nombre = borrador.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre de la mesa';
  else if (largo(nombre) > 20) errores.nombre = 'Usa 20 caracteres como máximo';
  else if (
    contexto.zonas.some((z) =>
      mesasActivas(z).some((m) => m.id !== contexto.mesaId && mismoNombre(m.nombre, nombre)),
    )
  ) {
    errores.nombre = 'Ya hay una mesa con ese nombre en esta sucursal. Usa otro.';
  }
  const capacidad = enteroEnRango(borrador.capacidad, 1, CAPACIDAD_MAXIMA_MESA);
  if (capacidad === null) {
    errores.capacidad = `Escribe un número entero de 1 a ${CAPACIDAD_MAXIMA_MESA}`;
  }
  if (mesaEnCelda(contexto.zona, borrador.columna, borrador.fila, contexto.mesaId)) {
    errores.celda = 'Esa celda ya tiene otra mesa. Elige una celda libre.';
  }
  if (Object.keys(errores).length > 0 || capacidad === null) return { ok: false, errores };
  return {
    ok: true,
    mesa: {
      nombre,
      capacidad,
      forma: borrador.forma,
      columna: borrador.columna,
      fila: borrador.fila,
    },
  };
}

/** Solo lo que cambió respecto de la mesa guardada (el `PATCH` pide al menos un campo). */
export function cambiosDeMesa(guardada: MesaRespuesta, nueva: MesaEntrada): MesaModificarEntrada {
  const cambios: MesaModificarEntrada = {};
  if (nueva.nombre !== guardada.nombre) cambios.nombre = nueva.nombre;
  if (nueva.capacidad !== guardada.capacidad) cambios.capacidad = nueva.capacidad;
  if (nueva.forma !== guardada.forma) cambios.forma = nueva.forma;
  if (nueva.columna !== guardada.columna) cambios.columna = nueva.columna;
  if (nueva.fila !== guardada.fila) cambios.fila = nueva.fila;
  return cambios;
}

export function mesaCambio(guardada: MesaRespuesta, borrador: BorradorDeMesa): boolean {
  return (
    borrador.nombre.trim() !== guardada.nombre ||
    borrador.capacidad.trim() !== String(guardada.capacidad) ||
    borrador.forma !== guardada.forma ||
    borrador.columna !== guardada.columna ||
    borrador.fila !== guardada.fila
  );
}

// --- Zonas: borrador y validación -------------------------------------------------------------------

export interface BorradorDeZona {
  nombre: string;
  columnas: string;
  filas: string;
}

export type ErroresDeZona = Partial<Record<'nombre' | 'columnas' | 'filas', string>>;

export const POR_DEFECTO_DE_ZONA: BorradorDeZona = { nombre: '', columnas: '6', filas: '5' };

export const borradorDeZona = (zona: ZonaRespuesta): BorradorDeZona => ({
  nombre: zona.nombre,
  columnas: String(zona.columnas),
  filas: String(zona.filas),
});

export type ResultadoDeZona =
  { ok: true; zona: ZonaEntrada } | { ok: false; errores: ErroresDeZona };

/** "la mesa 7", "las mesas 7 y 8", "las mesas 7, 8 y 9". */
function listaDeMesas(mesas: readonly MesaRespuesta[]): string {
  const nombres = mesas.map((m) => m.nombre);
  if (nombres.length === 1) return `la mesa ${nombres[0]}`;
  return `las mesas ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

export function validarZona(
  borrador: BorradorDeZona,
  zonas: readonly ZonaRespuesta[],
  editando?: ZonaRespuesta,
): ResultadoDeZona {
  const errores: ErroresDeZona = {};
  const nombre = borrador.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre de la zona';
  else if (largo(nombre) > 40) errores.nombre = 'Usa 40 caracteres como máximo';
  else if (zonas.some((z) => z.id !== editando?.id && mismoNombre(z.nombre, nombre))) {
    errores.nombre = 'Ya tienes una zona con ese nombre. Usa otro.';
  }
  const columnas = enteroEnRango(borrador.columnas, COLUMNAS_MINIMAS_ZONA, COLUMNAS_MAXIMAS_ZONA);
  if (columnas === null) {
    errores.columnas = `Escribe un número entero de ${COLUMNAS_MINIMAS_ZONA} a ${COLUMNAS_MAXIMAS_ZONA}`;
  }
  const filas = enteroEnRango(borrador.filas, FILAS_MINIMAS_ZONA, FILAS_MAXIMAS_ZONA);
  if (filas === null) {
    errores.filas = `Escribe un número entero de ${FILAS_MINIMAS_ZONA} a ${FILAS_MAXIMAS_ZONA}`;
  }
  if (editando && columnas !== null && filas !== null) {
    const fuera = mesasActivas(editando).filter((m) => m.columna > columnas || m.fila > filas);
    if (fuera.length > 0) {
      const mensaje = `Quedarían fuera ${listaDeMesas(fuera)}. Muévelas antes de achicar la cuadrícula.`;
      if (columnas < editando.columnas) errores.columnas = mensaje;
      else errores.filas = mensaje;
    }
  }
  if (Object.keys(errores).length > 0 || columnas === null || filas === null) {
    return { ok: false, errores };
  }
  return { ok: true, zona: { nombre, columnas, filas } };
}

export function cambiosDeZona(guardada: ZonaRespuesta, nueva: ZonaEntrada): ZonaModificarEntrada {
  const cambios: ZonaModificarEntrada = {};
  if (nueva.nombre !== guardada.nombre) cambios.nombre = nueva.nombre;
  if (nueva.columnas !== guardada.columnas) cambios.columnas = nueva.columnas;
  if (nueva.filas !== guardada.filas) cambios.filas = nueva.filas;
  return cambios;
}

// --- Errores del servidor ---------------------------------------------------------------------------

const AVISO_DE_REINTENTO =
  'La conexión se cortó y es posible que ya se haya guardado. Revisa el mapa antes de intentarlo otra vez.';

export interface FalloDeMesa {
  /** Aviso general sobre el formulario. */
  general?: string;
  campos: ErroresDeMesa;
}

/** Traduce el error de crear o modificar una mesa a un mensaje general y, si se puede, a un campo. */
export function falloDeMesa(error: unknown): FalloDeMesa {
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  const porCampo = erroresPorCampo(error);
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    if (porCampo.columna !== undefined || porCampo.fila !== undefined) {
      return { campos: { celda: 'Esa celda ya tiene otra mesa. Elige una celda libre.' } };
    }
    if (porCampo.nombre !== undefined) {
      return { campos: { nombre: 'Ya hay una mesa con ese nombre en esta sucursal. Usa otro.' } };
    }
    return {
      general:
        'El nombre de la mesa o su celda ya están en uso. Revisa el mapa y vuelve a intentar.',
      campos: {},
    };
  }
  if (error.codigo === 'EN_USO') {
    return {
      general:
        'Esta mesa tiene una cuenta abierta. Ciérrala o libera la mesa antes de desactivarla.',
      campos: {},
    };
  }
  if (error.codigo === 'DATOS_INVALIDOS' && error.campos.length > 0) {
    const campos: ErroresDeMesa = {};
    if (porCampo.nombre !== undefined) campos.nombre = mensajeDeCampo(porCampo.nombre);
    if (porCampo.capacidad !== undefined) campos.capacidad = mensajeDeCampo(porCampo.capacidad);
    if (porCampo.columna !== undefined || porCampo.fila !== undefined) {
      campos.celda = mensajeDeCampo(porCampo.columna ?? porCampo.fila ?? '');
    }
    if (Object.keys(campos).length > 0) return { campos };
  }
  return { general: mensajeDeError(error), campos: {} };
}

export interface FalloDeZona {
  general?: string;
  campos: ErroresDeZona;
}

export function falloDeZona(error: unknown): FalloDeZona {
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    const porCampo = erroresPorCampo(error);
    if (porCampo.nombre !== undefined) {
      return { campos: { nombre: 'Ya tienes una zona con ese nombre. Usa otro.' } };
    }
    // Achicar la cuadrícula dejando mesas afuera: el mensaje del servidor nombra las mesas.
    const campo = porCampo.columnas !== undefined ? 'columnas' : 'filas';
    return {
      campos: {
        [campo]: error.message.trim() || 'Hay mesas que quedarían fuera. Muévelas primero.',
      },
    };
  }
  if (error.codigo === 'EN_USO') {
    return {
      general:
        'Esta zona todavía tiene mesas activas. Desactívalas o pásalas a otra zona antes de desactivarla.',
      campos: {},
    };
  }
  return { general: mensajeDeError(error), campos: {} };
}

export const pluralMesas = (n: number) => (n === 1 ? '1 mesa' : `${n} mesas`);
