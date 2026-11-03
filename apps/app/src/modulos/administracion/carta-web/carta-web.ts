import {
  COLOR_PRINCIPAL_POR_DEFECTO,
  cartaWebRespuestaSchema,
  cartaWebSucursalRespuestaSchema,
  logoCartaWebRespuestaSchema,
  type CartaWebEntrada,
  type CartaWebRespuesta,
  type CartaWebSucursalEntrada,
  type CartaWebSucursalRespuesta,
} from '@restaurante/contratos';
import {
  LARGO_MAXIMO_SLUG,
  LARGO_MINIMO_SLUG,
  COLOR_SOBRE_MARCA,
  SLUGS_RESERVADOS,
  colorDeMarcaAccesible,
  colorDeMarcaSobreBlanco,
  contraste,
  esSlugValido,
  propuestaDeSlug,
} from '@restaurante/dominio';
import { api } from '../../../lib/api';
import type { ExtraDeEscritura } from '../../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../../lib/errores';

/** Ajustes › Carta web (historia 005, criterios 74 y 76): nombre, dirección, logo, color y sucursales. */

export const claveCartaWeb = ['carta-web'] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

export const leerCartaWeb = (senal?: AbortSignal) =>
  api.get('/carta-web', { esquema: cartaWebRespuestaSchema, ...(senal ? { senal } : {}) });

export const guardarCartaWeb = (entrada: CartaWebEntrada, extra?: ExtraDeEscritura) =>
  api.put('/carta-web', entrada, { esquema: cartaWebRespuestaSchema, ...extra });

export const guardarSucursalDeCartaWeb = (
  sucursalId: string,
  entrada: CartaWebSucursalEntrada,
  extra?: ExtraDeEscritura,
) =>
  // La respuesta es la fila de la sucursal de `cartaWebRespuesta`.
  api.put(`/carta-web/sucursales/${sucursalId}`, entrada, {
    esquema: cartaWebSucursalRespuestaSchema,
    ...extra,
  });

export const subirLogoDeCartaWeb = (logo: Blob, extra?: ExtraDeEscritura) =>
  api.put('/carta-web/logo', logo, {
    esquema: logoCartaWebRespuestaSchema,
    idempotente: true,
    ...extra,
  });

export const quitarLogoDeCartaWeb = (extra?: ExtraDeEscritura) =>
  api.delete('/carta-web/logo', { idempotente: true, ...extra });

// --- Direcciones ------------------------------------------------------------------------------------

/** La dirección sin `https://` ni barra final: "carta.ejemplo.pe/sabor-norteno". */
export const sinProtocolo = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/**
 * El sitio donde vive la carta ("carta.ejemplo.pe"), sacado de la dirección ya guardada de la empresa.
 * Antes de guardar la primera vez la API no lo dice: `null`.
 */
export function sitioDeLaCarta(carta: CartaWebRespuesta | undefined): string | null {
  if (!carta?.url || !carta.slug) return null;
  const sufijo = `/${carta.slug}`;
  const url = carta.url.replace(/\/+$/, '');
  return sinProtocolo(url.endsWith(sufijo) ? url.slice(0, -sufijo.length) : url);
}

/** Cómo se verá la dirección: "carta.ejemplo.pe/sabor-norteno", o "…/sabor-norteno" si aún no se conoce el sitio. */
export function vistaDeLaDireccion(sitio: string | null, slug: string, sucursal?: string): string {
  const resto = [slug.trim() === '' ? '…' : slug.trim(), sucursal].filter(Boolean).join('/');
  return `${sitio ?? '…'}/${resto}`;
}

const normalizada = (texto: string) => texto.trim().toLowerCase();

/** Motivo en palabras por el que una dirección no sirve, o `undefined` si es válida. */
export function errorDeDireccion(texto: string): string | undefined {
  const slug = texto.trim();
  if (slug === '') return 'Escribe la dirección';
  if (/[A-Z]/.test(slug)) return 'Usa solo letras minúsculas, números y guiones';
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) {
    return 'Esa dirección está reservada. Elige otra';
  }
  if (slug.length < LARGO_MINIMO_SLUG) return `Usa al menos ${LARGO_MINIMO_SLUG} caracteres`;
  if (slug.length > LARGO_MAXIMO_SLUG) return `Usa ${LARGO_MAXIMO_SLUG} caracteres como máximo`;
  if (!esSlugValido(slug)) {
    return 'Usa solo letras minúsculas, números y guiones entre palabras, por ejemplo sabor-norteno';
  }
  return undefined;
}

/** Escribir la dirección es escribir como se ve en la URL: minúsculas y sin espacios en los extremos. */
export const direccionEscrita = (texto: string) => texto.toLowerCase().replace(/\s+/g, '-');

// --- Color ------------------------------------------------------------------------------------------

const FORMATO_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Lo que se escribe en el campo del color: se agrega el `#` y se pasan a mayúsculas las letras. */
export function colorEscrito(texto: string): string {
  const limpio = texto.trim().toUpperCase();
  if (limpio === '') return '';
  return limpio.startsWith('#') ? limpio : `#${limpio}`;
}

export const colorValido = (texto: string) => FORMATO_COLOR.test(texto);

export interface MarcaEnLaCarta {
  /** Color con el que se pintan el encabezado y los botones de la carta: el que eligió el restaurante, sin tocar. */
  fondo: string;
  /** Color de las letras encima: blanco o casi negro, el que alcance 4.5:1. */
  texto: string;
  /** Cómo se dice ese texto en palabras: "blancas" u "oscuras". */
  letras: 'blancas' | 'oscuras';
  /** Contraste de las letras con el color, con un decimal ("9.4"). */
  contraste: string;
  /** Color de los indicadores sobre fondo blanco (opción elegida): la marca, o las letras si la marca es muy clara. */
  indicador: string;
}

/** El color que verá el cliente y por qué: las reglas son las de `packages/dominio`, aquí solo se muestran. */
export function marcaEnLaCarta(color: string): MarcaEnLaCarta | null {
  if (!colorValido(color)) return null;
  const { fondo, texto } = colorDeMarcaAccesible(color);
  return {
    fondo,
    texto,
    letras: texto === COLOR_SOBRE_MARCA ? 'blancas' : 'oscuras',
    contraste: contraste(fondo, texto).toFixed(1),
    indicador: colorDeMarcaSobreBlanco(color),
  };
}

// --- Borrador y validación --------------------------------------------------------------------------

export interface BorradorDeSucursal {
  sucursalId: string;
  nombre: string;
  slug: string;
  publicada: boolean;
}

export interface BorradorDeCartaWeb {
  nombre: string;
  slug: string;
  colorPrincipal: string;
  /** La dirección sigue al nombre mientras nadie la escriba a mano (solo al configurar por primera vez). */
  direccionManual: boolean;
  sucursales: BorradorDeSucursal[];
}

export function borradorDeCartaWeb(carta: CartaWebRespuesta): BorradorDeCartaWeb {
  return {
    nombre: carta.nombre ?? '',
    slug: carta.slug ?? '',
    colorPrincipal: carta.colorPrincipal || COLOR_PRINCIPAL_POR_DEFECTO,
    direccionManual: carta.configurada,
    sucursales: carta.sucursales.map((s) => ({
      sucursalId: s.sucursalId,
      nombre: s.nombre,
      slug: s.slug ?? '',
      publicada: s.publicada,
    })),
  };
}

export const propuestaDeDireccion = (nombre: string) => propuestaDeSlug(nombre.trim());

export interface ErroresDeCartaWeb {
  nombre?: string;
  slug?: string;
  colorPrincipal?: string;
  /** Por `sucursalId`: la dirección o el aviso de esa sucursal. */
  sucursales: Record<string, string>;
}

const sinErrores = (e: ErroresDeCartaWeb) =>
  !e.nombre && !e.slug && !e.colorPrincipal && Object.keys(e.sucursales).length === 0;

/** Lo que ya está guardado de una sucursal (para saber si cambió). */
const guardadaDe = (carta: CartaWebRespuesta, id: string): CartaWebSucursalRespuesta | undefined =>
  carta.sucursales.find((s) => s.sucursalId === id);

export function empresaCambio(carta: CartaWebRespuesta, b: BorradorDeCartaWeb): boolean {
  // Sin configurar, lo guardado está vacío: cualquier cosa escrita ya es algo por guardar.
  return (
    b.nombre.trim() !== (carta.nombre ?? '') ||
    b.slug.trim() !== (carta.slug ?? '') ||
    b.colorPrincipal.toUpperCase() !== carta.colorPrincipal.toUpperCase()
  );
}

export function sucursalCambio(carta: CartaWebRespuesta, b: BorradorDeSucursal): boolean {
  const guardada = guardadaDe(carta, b.sucursalId);
  return b.slug.trim() !== (guardada?.slug ?? '') || b.publicada !== (guardada?.publicada ?? false);
}

export const hayCambios = (carta: CartaWebRespuesta, b: BorradorDeCartaWeb) =>
  empresaCambio(carta, b) || b.sucursales.some((s) => sucursalCambio(carta, s));

export type ResultadoDeValidacion =
  | {
      ok: true;
      empresa: CartaWebEntrada | null;
      sucursales: (CartaWebSucursalEntrada & { sucursalId: string })[];
    }
  | { ok: false; errores: ErroresDeCartaWeb };

/**
 * Valida lo escrito antes de enviar. `empresa` es `null` si no cambió nada de la empresa; `sucursales` trae solo las
 * que cambiaron. Una sucursal sin dirección que no se publica se deja como está.
 */
export function validarCartaWeb(
  carta: CartaWebRespuesta,
  b: BorradorDeCartaWeb,
): ResultadoDeValidacion {
  const errores: ErroresDeCartaWeb = { sucursales: {} };
  const nombre = b.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre que verán tus clientes';
  else if (Array.from(nombre).length > 80) errores.nombre = 'Usa 80 caracteres como máximo';
  const slug = b.slug.trim();
  const errorSlug = errorDeDireccion(slug);
  if (errorSlug) errores.slug = errorSlug;
  if (!colorValido(b.colorPrincipal)) {
    errores.colorPrincipal = 'Escribe el color como #RRGGBB, por ejemplo #1D4A9E';
  }

  const usadas = new Map<string, string>();
  const cambiadas: (CartaWebSucursalEntrada & { sucursalId: string })[] = [];
  for (const s of b.sucursales) {
    const escrita = s.slug.trim();
    const guardada = guardadaDe(carta, s.sucursalId);
    if (escrita === '' && !s.publicada && !guardada?.slug) continue; // Sin tocar: no hay nada que enviar.
    if (escrita === '') {
      errores.sucursales[s.sucursalId] = s.publicada
        ? 'Escribe la dirección de esta sucursal para publicarla'
        : 'Escribe la dirección de esta sucursal';
      continue;
    }
    const motivo = errorDeDireccion(escrita);
    if (motivo) {
      errores.sucursales[s.sucursalId] = motivo;
      continue;
    }
    const otra = usadas.get(normalizada(escrita));
    if (otra) {
      errores.sucursales[s.sucursalId] = `La sucursal ${otra} ya usa esa dirección. Elige otra`;
      continue;
    }
    usadas.set(normalizada(escrita), s.nombre);
    if (sucursalCambio(carta, s)) {
      cambiadas.push({ sucursalId: s.sucursalId, slug: escrita, publicada: s.publicada });
    }
  }
  if (!sinErrores(errores)) return { ok: false, errores };
  return {
    ok: true,
    empresa: empresaCambio(carta, b)
      ? { nombre, slug, colorPrincipal: b.colorPrincipal.toUpperCase() }
      : null,
    sucursales: cambiadas,
  };
}

// --- Errores del servidor ---------------------------------------------------------------------------

const AVISO_DE_REINTENTO =
  'La conexión se cortó y es posible que ya se haya guardado. Revisa la pantalla antes de intentarlo otra vez.';

export interface FalloDeCartaWeb {
  general?: string;
  campos: Pick<ErroresDeCartaWeb, 'nombre' | 'slug' | 'colorPrincipal'>;
}

/** Traduce el error de guardar la carta a un mensaje general y, si se puede, a un campo. */
export function falloDeCartaWeb(error: unknown): FalloDeCartaWeb {
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    return { campos: { slug: 'Esa dirección ya la usa otro restaurante. Elige otra' } };
  }
  if (error.codigo === 'DATOS_INVALIDOS' && error.campos.length > 0) {
    const porCampo = erroresPorCampo(error);
    const campos: FalloDeCartaWeb['campos'] = {};
    if (porCampo.nombre !== undefined) campos.nombre = mensajeDeCampo(porCampo.nombre);
    if (porCampo.slug !== undefined) campos.slug = mensajeDeCampo(porCampo.slug);
    if (porCampo.colorPrincipal !== undefined) {
      campos.colorPrincipal = mensajeDeCampo(porCampo.colorPrincipal);
    }
    if (Object.keys(campos).length > 0) return { campos };
  }
  return { general: mensajeDeError(error), campos: {} };
}

/** Lo mismo para una sucursal: siempre un solo mensaje, que va bajo la dirección de esa sucursal. */
export function falloDeSucursal(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.codigo === 'CONFLICTO' && !error.reintentada) {
      return 'Otra sucursal ya usa esa dirección. Elige otra';
    }
    if (error.codigo === 'CONFLICTO') return AVISO_DE_REINTENTO;
    if (error.codigo === 'CARTA_WEB_SIN_CONFIGURAR') {
      return 'Primero guarda el nombre y la dirección de tu carta';
    }
    if (error.codigo === 'DATOS_INVALIDOS') {
      const mensaje = erroresPorCampo(error).slug;
      if (mensaje !== undefined) return mensajeDeCampo(mensaje);
    }
    if (error.codigo === 'NO_ENCONTRADO')
      return 'Esta sucursal ya no existe. Actualiza la pantalla';
  }
  return mensajeDeError(error);
}

// --- Caché ------------------------------------------------------------------------------------------

/** La sucursal guardada reemplaza a la anterior en la configuración que se tiene en pantalla. */
export function conSucursalGuardada(
  carta: CartaWebRespuesta,
  sucursal: CartaWebSucursalRespuesta,
): CartaWebRespuesta {
  return {
    ...carta,
    sucursales: carta.sucursales.map((s) => (s.sucursalId === sucursal.sucursalId ? sucursal : s)),
  };
}
