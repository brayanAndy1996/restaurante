import {
  ANCHOS_PAPEL_MM,
  COLUMNAS_POR_ANCHO,
  JUEGO_CARACTERES_POR_DEFECTO,
  PUERTO_IMPRESORA_POR_DEFECTO,
  esHostValido,
  estacionDestinoRespuestaSchema,
  impresionSucursalRespuestaSchema,
  impresoraRespuestaSchema,
  type AnchoPapelMm,
  type EstacionDestinoEntrada,
  type EstacionDestinoRespuesta,
  type ImpresoraEntrada,
  type ImpresoraModificarEntrada,
  type ImpresoraRespuesta,
  type JuegoCaracteres,
  type TipoConexion,
} from '@restaurante/contratos';
import { api, listaDe } from '../../../lib/api';
import type { ExtraDeEscritura } from '../../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../../lib/errores';
import { CLAVES_TIEMPO_REAL } from '../../../lib/tiempo-real';

/**
 * Ajustes › Impresión (historia 004, entrega 3b, criterios 99 a 105, 136 y 137 en parte): impresoras de la
 * sucursal, dónde sale cada estación e impresora de caja. Aquí van las llamadas a la API, el borrador del
 * formulario, su validación y la traducción de los errores del servidor.
 */

export const claveImpresoras = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.impresoras, sucursalId] as const;
export const claveDestinos = (sucursalId: string) => ['impresion', 'destinos', sucursalId] as const;
export const claveImpresoraDeCaja = (sucursalId: string) =>
  ['impresion', 'caja', sucursalId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

export const listarImpresoras = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/impresoras`, {
    esquema: listaDe(impresoraRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const crearImpresora = (
  sucursalId: string,
  entrada: ImpresoraEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.post(`/sucursales/${sucursalId}/impresoras`, entrada, {
    esquema: impresoraRespuestaSchema,
    idempotente: true,
    ...extra,
  });

export const modificarImpresora = (
  sucursalId: string,
  id: string,
  cambios: ImpresoraModificarEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.patch(`/sucursales/${sucursalId}/impresoras/${id}`, cambios, {
    esquema: impresoraRespuestaSchema,
    ...extra,
  });

export const listarDestinos = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/estaciones-destino`, {
    esquema: listaDe(estacionDestinoRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const configurarDestino = (
  sucursalId: string,
  estacionId: string,
  entrada: EstacionDestinoEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.put(`/sucursales/${sucursalId}/estaciones-destino/${estacionId}`, entrada, {
    esquema: estacionDestinoRespuestaSchema,
    ...extra,
  });

export const leerImpresoraDeCaja = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/impresion`, {
    esquema: impresionSucursalRespuestaSchema,
    ...(senal ? { senal } : {}),
  });

export const configurarImpresoraDeCaja = (
  sucursalId: string,
  impresoraCajaId: string | null,
  extra?: ExtraDeEscritura,
) =>
  api.put(
    `/sucursales/${sucursalId}/impresion`,
    { impresoraCajaId },
    { esquema: impresionSucursalRespuestaSchema, ...extra },
  );

// --- Caché: lo que devuelve cada escritura se refleja sin volver a pedir la lista -------------------

export function conImpresoraGuardada(
  lista: readonly ImpresoraRespuesta[],
  guardada: ImpresoraRespuesta,
): ImpresoraRespuesta[] {
  return lista.some((i) => i.id === guardada.id)
    ? lista.map((i) => (i.id === guardada.id ? guardada : i))
    : [...lista, guardada];
}

export function conDestinoGuardado(
  lista: readonly EstacionDestinoRespuesta[],
  guardado: EstacionDestinoRespuesta,
): EstacionDestinoRespuesta[] {
  return lista.map((d) => (d.estacionId === guardado.estacionId ? guardado : d));
}

/** Activas primero y por nombre: la lista no cambia de orden cuando el servidor cambia el suyo. */
export function ordenadas(lista: readonly ImpresoraRespuesta[]): ImpresoraRespuesta[] {
  return [...lista].sort(
    (a, b) =>
      Number(b.activa) - Number(a.activa) ||
      a.nombre.localeCompare(b.nombre, 'es-PE', { numeric: true }),
  );
}

// --- Textos -----------------------------------------------------------------------------------------

export const TEXTO_DE_KDS = 'Pantalla de cocina';

export const NOTA_DE_BLUETOOTH = 'Requiere la app puente con Bluetooth';

export const TEXTO_DE_JUEGO: Record<JuegoCaracteres, string> = {
  PC850: 'PC850 · Latino (el más común)',
  PC858: 'PC858 · Latino con €',
  WPC1252: 'WPC1252 · Windows latino',
  PC437: 'PC437 · EE. UU.',
  SIN_TILDES: 'Sin tildes ni ñ (siempre se lee)',
};

/** "192.168.1.50:9100" o la dirección Bluetooth. */
export const detalleDeConexion = (impresora: ImpresoraRespuesta): string =>
  impresora.conexion.tipo === 'RED'
    ? `${impresora.conexion.host}:${impresora.conexion.puerto}`
    : impresora.conexion.mac;

export const textoDeConexion = (impresora: ImpresoraRespuesta): string =>
  `${impresora.conexion.tipo === 'RED' ? 'Red' : 'Bluetooth'} · ${detalleDeConexion(impresora)}`;

/** El número y "mm" no se separan al partir la línea (con un espacio de no separación). */
export const resumenDeImpresora = (impresora: ImpresoraRespuesta): string =>
  `${textoDeConexion(impresora)} · ${impresora.anchoMm}\u00a0mm`;

export const textoDePendientes = (n: number): string =>
  n === 1 ? '1 pendiente' : `${n} pendientes`;

export const textoDeColumnas = (): string =>
  ANCHOS_PAPEL_MM.map((ancho) => `${ancho} mm: ${COLUMNAS_POR_ANCHO[ancho]} columnas`).join(' · ');

/** "Cocina", "Cocina y Barra", "Cocina, Barra y la impresora de caja". */
export function unirNombres(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Dónde se usa una impresora hoy: las estaciones que salen por ella y, si lo es, la impresora de caja. */
export function usosDeImpresora(
  impresoraId: string,
  destinos: readonly EstacionDestinoRespuesta[],
  impresoraCajaId: string | null,
): string[] {
  const usos = destinos
    .filter((d) => d.destino === 'IMPRESORA' && d.impresora?.id === impresoraId)
    .map((d) => d.nombre);
  if (impresoraCajaId === impresoraId) usos.push('la impresora de caja');
  return usos;
}

// --- Borrador y validación --------------------------------------------------------------------------

export interface BorradorDeImpresora {
  nombre: string;
  tipo: TipoConexion;
  host: string;
  /** Texto del campo: se valida como entero al guardar. */
  puerto: string;
  mac: string;
  anchoMm: AnchoPapelMm;
  juegoCaracteres: JuegoCaracteres;
  gaveta: boolean;
}

export type ErroresDeImpresora = Partial<Record<'nombre' | 'host' | 'puerto' | 'mac', string>>;

export const POR_DEFECTO_DE_IMPRESORA: BorradorDeImpresora = {
  nombre: '',
  tipo: 'RED',
  host: '',
  puerto: String(PUERTO_IMPRESORA_POR_DEFECTO),
  mac: '',
  anchoMm: 80,
  juegoCaracteres: JUEGO_CARACTERES_POR_DEFECTO,
  gaveta: false,
};

export const borradorDeImpresora = (impresora: ImpresoraRespuesta): BorradorDeImpresora => ({
  ...POR_DEFECTO_DE_IMPRESORA,
  nombre: impresora.nombre,
  tipo: impresora.conexion.tipo,
  ...(impresora.conexion.tipo === 'RED'
    ? { host: impresora.conexion.host, puerto: String(impresora.conexion.puerto) }
    : { mac: impresora.conexion.mac }),
  anchoMm: impresora.anchoMm,
  juegoCaracteres: impresora.juegoCaracteres,
  gaveta: impresora.gaveta,
});

const largo = (texto: string) => Array.from(texto).length;

const mismoNombre = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('es-PE') === b.trim().toLocaleLowerCase('es-PE');

/**
 * `AA:BB:CC:DD:EE:FF` en mayúsculas a partir de lo que se escribe: acepta minúsculas y los separadores
 * `:`, `-` o espacio, o ninguno (12 dígitos seguidos). `null` si no es una dirección.
 */
export function normalizarMac(texto: string): string | null {
  const crudo = texto.trim();
  if (/^([0-9a-f]{2}[:\s-]){5}[0-9a-f]{2}$/i.test(crudo)) {
    return crudo.replace(/[-\s]/g, ':').toUpperCase();
  }
  if (/^[0-9a-f]{12}$/i.test(crudo)) {
    return (crudo.match(/.{2}/g) ?? []).join(':').toUpperCase();
  }
  return null;
}

/** Entero de 1 a 65535 escrito solo con dígitos, o `null`. */
export function puertoEscrito(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,5}$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= 1 && n <= 65535 ? n : null;
}

export type ResultadoDeImpresora =
  { ok: true; impresora: ImpresoraEntrada } | { ok: false; errores: ErroresDeImpresora };

export function validarImpresora(
  borrador: BorradorDeImpresora,
  impresoras: readonly ImpresoraRespuesta[],
  editandoId?: string,
): ResultadoDeImpresora {
  const errores: ErroresDeImpresora = {};
  const nombre = borrador.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre de la impresora';
  else if (largo(nombre) > 40) errores.nombre = 'Usa 40 caracteres como máximo';
  else if (impresoras.some((i) => i.id !== editandoId && mismoNombre(i.nombre, nombre))) {
    errores.nombre = 'Ya hay una impresora con ese nombre en esta sucursal. Usa otro.';
  }

  let conexion: ImpresoraEntrada['conexion'] | null = null;
  if (borrador.tipo === 'RED') {
    const host = borrador.host.trim();
    const puerto = puertoEscrito(borrador.puerto);
    if (host === '') errores.host = 'Escribe la IP de la impresora, por ejemplo 192.168.1.50';
    else if (!esHostValido(host)) {
      errores.host = 'Esa dirección no sirve. Usa una IP como 192.168.1.50 o el nombre del equipo.';
    }
    if (puerto === null) errores.puerto = 'Escribe un puerto de 1 a 65535 (casi siempre es 9100)';
    if (!errores.host && puerto !== null) conexion = { tipo: 'RED', host, puerto };
  } else {
    const mac = normalizarMac(borrador.mac);
    if (borrador.mac.trim() === '') errores.mac = 'Escribe la dirección Bluetooth de la impresora';
    else if (mac === null) {
      errores.mac =
        'La dirección debe verse así: AA:BB:CC:DD:EE:FF (letras de la A a la F y números)';
    } else conexion = { tipo: 'BLUETOOTH', mac };
  }

  if (Object.keys(errores).length > 0 || conexion === null) return { ok: false, errores };
  return {
    ok: true,
    impresora: {
      nombre,
      conexion,
      anchoMm: borrador.anchoMm,
      juegoCaracteres: borrador.juegoCaracteres,
      gaveta: borrador.gaveta,
    },
  };
}

const mismaConexion = (
  a: ImpresoraRespuesta['conexion'],
  b: ImpresoraEntrada['conexion'],
): boolean => {
  if (a.tipo === 'RED' && b.tipo === 'RED') {
    return a.host === b.host && a.puerto === (b.puerto ?? PUERTO_IMPRESORA_POR_DEFECTO);
  }
  if (a.tipo === 'BLUETOOTH' && b.tipo === 'BLUETOOTH') return a.mac === b.mac;
  return false;
};

/** Solo lo que cambió respecto de la impresora guardada (el `PATCH` pide al menos un campo). */
export function cambiosDeImpresora(
  guardada: ImpresoraRespuesta,
  nueva: ImpresoraEntrada,
): ImpresoraModificarEntrada {
  const cambios: ImpresoraModificarEntrada = {};
  if (nueva.nombre !== guardada.nombre) cambios.nombre = nueva.nombre;
  if (!mismaConexion(guardada.conexion, nueva.conexion)) cambios.conexion = nueva.conexion;
  if (nueva.anchoMm !== guardada.anchoMm) cambios.anchoMm = nueva.anchoMm;
  if (nueva.juegoCaracteres !== guardada.juegoCaracteres) {
    cambios.juegoCaracteres = nueva.juegoCaracteres;
  }
  if (nueva.gaveta !== guardada.gaveta) cambios.gaveta = nueva.gaveta;
  return cambios;
}

/** `true` si el borrador, ya validado, difiere de lo guardado (habilita "Guardar"). */
export function impresoraCambio(
  guardada: ImpresoraRespuesta,
  borrador: BorradorDeImpresora,
  impresoras: readonly ImpresoraRespuesta[],
): boolean {
  const resultado = validarImpresora(borrador, impresoras, guardada.id);
  // Con errores se deja guardar para que el formulario los muestre.
  if (!resultado.ok) return true;
  return Object.keys(cambiosDeImpresora(guardada, resultado.impresora)).length > 0;
}

// --- Errores del servidor ---------------------------------------------------------------------------

const AVISO_DE_REINTENTO =
  'La conexión se cortó y es posible que ya se haya guardado. Revisa la lista antes de intentarlo otra vez.';

export interface FalloDeImpresora {
  /** Aviso general sobre el formulario. */
  general?: string;
  campos: ErroresDeImpresora;
}

/** Traduce el error de crear o modificar una impresora a un mensaje general y, si se puede, a un campo. */
export function falloDeImpresora(error: unknown): FalloDeImpresora {
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    return {
      campos: { nombre: 'Ya hay una impresora con ese nombre en esta sucursal. Usa otro.' },
    };
  }
  if (error.codigo === 'DATOS_INVALIDOS' && error.campos.length > 0) {
    const porCampo = erroresPorCampo(error);
    const campos: ErroresDeImpresora = {};
    if (porCampo.nombre !== undefined) campos.nombre = mensajeDeCampo(porCampo.nombre);
    if (porCampo['conexion.host'] !== undefined) {
      campos.host = mensajeDeCampo(porCampo['conexion.host']);
    }
    if (porCampo['conexion.puerto'] !== undefined) {
      campos.puerto = mensajeDeCampo(porCampo['conexion.puerto']);
    }
    if (porCampo['conexion.mac'] !== undefined) {
      campos.mac = mensajeDeCampo(porCampo['conexion.mac']);
    }
    if (Object.keys(campos).length > 0) return { campos };
  }
  return { general: mensajeDeError(error), campos: {} };
}

/**
 * Por qué no se pudo desactivar. `EN_USO` se explica con palabras: dónde se usa la impresora (lo que la
 * pantalla ya sabe y, si no, lo que dice el servidor) y qué hacer. Lo demás, con el mensaje de siempre.
 */
export function falloDeDesactivar(
  error: unknown,
  usos: readonly string[],
): { titulo: string; mensaje: string } {
  if (error instanceof ErrorApi && error.codigo === 'EN_USO') {
    const salida =
      'Elige otro destino en “Dónde sale cada estación” o en “Impresora de caja” y vuelve a desactivarla.';
    const dicho = error.message.trim().replace(/\.+$/, '');
    return {
      titulo: 'No se puede desactivar: está en uso',
      mensaje:
        usos.length > 0
          ? `Se usa en ${unirNombres(usos)}. ${salida}`
          : `${dicho ? `${dicho}. ` : ''}${salida}`,
    };
  }
  if (error instanceof ErrorApi && error.codigo === 'CONFLICTO' && error.reintentada) {
    return { titulo: 'No pudimos desactivarla', mensaje: AVISO_DE_REINTENTO };
  }
  return { titulo: 'No pudimos desactivarla', mensaje: mensajeDeError(error) };
}

/** Error al cambiar el destino de una estación o la impresora de caja. */
export function falloDeDestino(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.codigo === 'REFERENCIA_INVALIDA' || error.codigo === 'NO_ENCONTRADO') {
      return 'Esa impresora o esa estación ya no está disponible. Actualiza la pantalla e inténtalo de nuevo.';
    }
  }
  return mensajeDeError(error);
}
