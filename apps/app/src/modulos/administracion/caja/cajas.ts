import {
  cajaRespuestaSchema,
  emisorRespuestaSchema,
  tasaIgvRespuestaSchema,
  type CajaEntrada,
  type CajaModificarEntrada,
  type CajaRespuesta,
  type EmisorRespuesta,
  type SerieEntrada,
  type SerieRespuesta,
  type TasaIgvRespuesta,
} from '@restaurante/contratos';
import { api, listaDe } from '../../../lib/api';
import type { ExtraDeEscritura } from '../../../lib/envios';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../../lib/errores';
import { horaDeLima } from '../../../lib/formato';

/**
 * Ajustes › Cajas y Ajustes › Emisores (historia 006, entrega 6a, criterios 1 a 7 y 117): las cajas de una
 * sucursal con su impresora y sus series, y la tasa de IGV de cada emisor. Aquí van las llamadas a la API, los
 * borradores de los formularios, su validación y la traducción de los errores del servidor. Ningún monto se
 * calcula aquí: la tasa viaja y se muestra como texto.
 */

/** Los cuatro documentos que numera una caja: boletas, facturas y, desde 6b, las notas de crédito de cada una (criterio 149). */
export type TipoSerie = 'BOLETA' | 'FACTURA' | 'NOTA_CREDITO_BOLETA' | 'NOTA_CREDITO_FACTURA';

export const claveCajas = (sucursalId: string) => ['caja', 'cajas', sucursalId] as const;
export const claveSucursal = (sucursalId: string) => ['caja', 'sucursal', sucursalId] as const;
export const claveEmisores = ['caja', 'emisores'] as const;
export const claveTasas = (emisorId: string) => ['caja', 'tasas-igv', emisorId] as const;

// --- Llamadas a la API ----------------------------------------------------------------------------

export const listarCajas = (sucursalId: string, senal?: AbortSignal) =>
  api.get(`/sucursales/${sucursalId}/cajas`, {
    esquema: listaDe(cajaRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const crearCaja = (sucursalId: string, entrada: CajaEntrada, extra?: ExtraDeEscritura) =>
  api.post(`/sucursales/${sucursalId}/cajas`, entrada, {
    esquema: cajaRespuestaSchema,
    idempotente: true,
    ...extra,
  });

export const modificarCaja = (
  sucursalId: string,
  id: string,
  cambios: CajaModificarEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.patch(`/sucursales/${sucursalId}/cajas/${id}`, cambios, {
    esquema: cajaRespuestaSchema,
    ...extra,
  });

export const configurarSerie = (
  sucursalId: string,
  cajaId: string,
  tipo: TipoSerie,
  entrada: SerieEntrada,
  extra?: ExtraDeEscritura,
) =>
  api.put(`/sucursales/${sucursalId}/cajas/${cajaId}/series/${tipo}`, entrada, {
    esquema: cajaRespuestaSchema,
    ...extra,
  });

/**
 * Para saber de qué emisor es la sucursal (y con él, qué tasa de IGV le toca). Solo se lee el `emisorId`: un dato
 * de la sucursal que esta pantalla no usa (su horario, su WhatsApp) no debe dejarla sin guía.
 */
export const leerEmisorDeLaSucursal = (sucursalId: string, senal?: AbortSignal) =>
  api.get<{ emisorId: string }>(`/sucursales/${sucursalId}`, {
    esquema: {
      parse(entrada: unknown) {
        const emisorId = (entrada as { emisorId?: unknown } | null)?.emisorId;
        if (typeof emisorId !== 'string') throw new TypeError('La sucursal no trae su emisor');
        return { emisorId };
      },
    },
    ...(senal ? { senal } : {}),
  });

export const listarEmisores = (senal?: AbortSignal) =>
  api.get<EmisorRespuesta[]>('/emisores', {
    esquema: listaDe(emisorRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const listarTasas = (emisorId: string, senal?: AbortSignal) =>
  api.get<TasaIgvRespuesta[]>(`/emisores/${emisorId}/tasas-igv`, {
    esquema: listaDe(tasaIgvRespuestaSchema),
    ...(senal ? { senal } : {}),
  });

export const guardarTasa = (
  emisorId: string,
  desde: string,
  tasa: string,
  extra?: ExtraDeEscritura,
) =>
  api.put(
    `/emisores/${emisorId}/tasas-igv/${desde}`,
    { tasa },
    { esquema: tasaIgvRespuestaSchema, ...extra },
  );

// --- Caché: lo que devuelve cada escritura se refleja sin volver a pedir la lista -------------------

export function conCajaGuardada(
  lista: readonly CajaRespuesta[],
  guardada: CajaRespuesta,
): CajaRespuesta[] {
  return lista.some((c) => c.id === guardada.id)
    ? lista.map((c) => (c.id === guardada.id ? guardada : c))
    : [...lista, guardada];
}

/** Activas primero y por nombre: la lista no cambia de orden cuando el servidor cambia el suyo. */
export function cajasOrdenadas(lista: readonly CajaRespuesta[]): CajaRespuesta[] {
  return [...lista].sort(
    (a, b) =>
      Number(b.activa) - Number(a.activa) ||
      a.nombre.localeCompare(b.nombre, 'es-PE', { numeric: true }),
  );
}

export function conTasaGuardada(
  lista: readonly TasaIgvRespuesta[],
  guardada: TasaIgvRespuesta,
): TasaIgvRespuesta[] {
  const sin = lista.filter((t) => t.desde !== guardada.desde);
  return [...sin, guardada].sort((a, b) => a.desde.localeCompare(b.desde));
}

// --- Textos y lecturas de una caja ------------------------------------------------------------------

export const NOMBRE_DE_TIPO: Record<TipoSerie, { plural: string; singular: string }> = {
  BOLETA: { plural: 'Boletas', singular: 'boletas' },
  FACTURA: { plural: 'Facturas', singular: 'facturas' },
  NOTA_CREDITO_BOLETA: {
    plural: 'Notas de crédito de boletas',
    singular: 'notas de crédito de boletas',
  },
  NOTA_CREDITO_FACTURA: {
    plural: 'Notas de crédito de facturas',
    singular: 'notas de crédito de facturas',
  },
};

/** Los comprobantes que se cobran: de sus series depende que la caja emita (la lista y los primeros pasos solo miran estas). */
export const TIPOS: readonly TipoSerie[] = ['BOLETA', 'FACTURA'];
/** Las series de las notas de crédito (6b): sin ellas la caja cobra igual, pero no puede emitir notas (409 `SIN_SERIE`). */
export const TIPOS_DE_NOTA: readonly TipoSerie[] = ['NOTA_CREDITO_BOLETA', 'NOTA_CREDITO_FACTURA'];
/** Todas las series que se escriben al crear o editar una caja. */
export const TIPOS_DE_SERIE: readonly TipoSerie[] = [...TIPOS, ...TIPOS_DE_NOTA];

/** La serie que hoy emite ese tipo en la caja, si hay. */
export const serieActiva = (caja: CajaRespuesta, tipo: TipoSerie) =>
  caja.series.find((s) => s.tipo === tipo && s.activa);

/**
 * La serie es de un emisor anterior de la sucursal (la sucursal cambió de emisor, criterio 5 de 006): sigue activa
 * pero ya no emite y el cobro responde `SIN_SERIE`. Sin saber el emisor de la sucursal, no se afirma nada.
 */
export function serieDeEmisorAnterior(
  serie: Pick<SerieRespuesta, 'emisorId'> | undefined,
  emisorId: string | undefined,
): boolean {
  return serie !== undefined && emisorId !== undefined && serie.emisorId !== emisorId;
}

/** Texto de esa serie vieja, para la etiqueta y el aviso. */
export const textoDeSerieAnterior = (serie: string): string =>
  `${serie}: serie de un emisor anterior, no emite`;

/** Una serie de la caja (activa o no) con ese texto: reactivarla no pide "Primer número". */
export const serieDeLaCaja = (caja: CajaRespuesta, tipo: TipoSerie, serie: string) =>
  caja.series.find((s) => s.tipo === tipo && s.serie === serie);

/** "B001-00000130": serie y número con los ceros de siempre. */
export const numeroDeComprobante = (serie: string, numero: number): string =>
  `${serie}-${String(numero).padStart(8, '0')}`;

/** "Último emitido: B001-00000130" o la frase de una serie sin uso. */
export function textoDeUltimoNumero(serie: { serie: string; ultimoNumero: number }): string {
  return serie.ultimoNumero === 0
    ? 'Aún no emitió comprobantes'
    : `Último emitido: ${numeroDeComprobante(serie.serie, serie.ultimoNumero)}`;
}

export const textoDeImpresora = (caja: CajaRespuesta): string =>
  caja.impresora ? `Impresora: ${caja.impresora.nombre}` : 'Impresora de la sucursal';

/** "Abierta por Ana desde las 18:02" o "Libre" (misma frase que la apertura de turno, criterio 109). */
export function textoDeTurno(caja: CajaRespuesta): string {
  return caja.turnoAbierto
    ? `Abierta por ${caja.turnoAbierto.responsable.nombre} desde las ${horaDeLima(caja.turnoAbierto.abiertoEn)}`
    : 'Libre';
}

export const textoDeCantidad = (activas: number, total: number): string => {
  const a = activas === 1 ? '1 caja activa' : `${activas} cajas activas`;
  const inactivas = total - activas;
  return inactivas > 0 ? `${a} · ${inactivas === 1 ? '1 inactiva' : `${inactivas} inactivas`}` : a;
};

// --- Primeros pasos (pregunta 19) --------------------------------------------------------------------

/** La fecha de hoy en Lima (AAAA-MM-DD). */
export function hoyEnLima(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/** La tasa que rige hoy: la de la fecha `desde` más reciente que ya llegó. */
export function tasaVigente(
  tasas: readonly TasaIgvRespuesta[],
  hoy: string = hoyEnLima(),
): TasaIgvRespuesta | undefined {
  return [...tasas]
    .filter((t) => t.desde <= hoy)
    .sort((a, b) => a.desde.localeCompare(b.desde))
    .at(-1);
}

export type IdDePaso = 'caja' | 'series' | 'tasa';

export interface PasoDeInicio {
  id: IdDePaso;
  texto: string;
  hecho: boolean;
}

/** Lo que el emisor de la sucursal pide para cobrar: `necesaria` es falso en el Nuevo RUS (no usa tasa). */
export interface EstadoDeTasa {
  necesaria: boolean;
  /** Hay una tasa que ya rige hoy. */
  configurada: boolean;
}

/**
 * Lo que falta para poder cobrar en una sucursal: una caja activa, una serie activa en alguna caja y la tasa de IGV
 * del emisor (pregunta 19). Con `tasa` sin saber (todavía cargando) o que no se necesita, ese paso no aparece.
 */
export function pasosDeInicio(
  cajas: readonly CajaRespuesta[],
  tasa: EstadoDeTasa | undefined,
): PasoDeInicio[] {
  const activas = cajas.filter((c) => c.activa);
  const pasos: PasoDeInicio[] = [
    { id: 'caja', texto: 'Crear una caja', hecho: activas.length > 0 },
    {
      id: 'series',
      texto: 'Darle una serie de boletas o de facturas',
      hecho: activas.some((c) => c.series.some((s) => s.activa)),
    },
  ];
  if (tasa?.necesaria) {
    pasos.push({ id: 'tasa', texto: 'Poner la tasa de IGV del emisor', hecho: tasa.configurada });
  }
  return pasos;
}

// --- Borrador y validación de una caja ---------------------------------------------------------------

export interface BorradorDeCaja {
  nombre: string;
  /** Id de la impresora o `''` para usar la de caja de la sucursal. */
  impresoraId: string;
  serieBoleta: string;
  /** Texto del campo: se valida como entero al guardar. */
  primerBoleta: string;
  serieFactura: string;
  primerFactura: string;
  serieNotaBoleta: string;
  primerNotaBoleta: string;
  serieNotaFactura: string;
  primerNotaFactura: string;
}

export type CampoDeCaja =
  | 'nombre'
  | 'impresoraId'
  | 'serieBoleta'
  | 'primerBoleta'
  | 'serieFactura'
  | 'primerFactura'
  | 'serieNotaBoleta'
  | 'primerNotaBoleta'
  | 'serieNotaFactura'
  | 'primerNotaFactura';

export type ErroresDeCaja = Partial<Record<CampoDeCaja, string>>;

export const CAJA_VACIA: BorradorDeCaja = {
  nombre: '',
  impresoraId: '',
  serieBoleta: '',
  primerBoleta: '',
  serieFactura: '',
  primerFactura: '',
  serieNotaBoleta: '',
  primerNotaBoleta: '',
  serieNotaFactura: '',
  primerNotaFactura: '',
};

export const borradorDeCaja = (caja: CajaRespuesta): BorradorDeCaja => ({
  nombre: caja.nombre,
  impresoraId: caja.impresora?.id ?? '',
  serieBoleta: serieActiva(caja, 'BOLETA')?.serie ?? '',
  primerBoleta: '',
  serieFactura: serieActiva(caja, 'FACTURA')?.serie ?? '',
  primerFactura: '',
  serieNotaBoleta: serieActiva(caja, 'NOTA_CREDITO_BOLETA')?.serie ?? '',
  primerNotaBoleta: '',
  serieNotaFactura: serieActiva(caja, 'NOTA_CREDITO_FACTURA')?.serie ?? '',
  primerNotaFactura: '',
});

export const CAMPOS_DE_SERIE: Record<
  TipoSerie,
  {
    serie: 'serieBoleta' | 'serieFactura' | 'serieNotaBoleta' | 'serieNotaFactura';
    primero: 'primerBoleta' | 'primerFactura' | 'primerNotaBoleta' | 'primerNotaFactura';
  }
> = {
  BOLETA: { serie: 'serieBoleta', primero: 'primerBoleta' },
  FACTURA: { serie: 'serieFactura', primero: 'primerFactura' },
  NOTA_CREDITO_BOLETA: { serie: 'serieNotaBoleta', primero: 'primerNotaBoleta' },
  NOTA_CREDITO_FACTURA: { serie: 'serieNotaFactura', primero: 'primerNotaFactura' },
};

/** La serie de una nota de crédito lleva el prefijo del documento que modifica: `B…` para boletas, `F…` para facturas. */
export const PREFIJO_DE_TIPO: Record<TipoSerie, 'B' | 'F'> = {
  BOLETA: 'B',
  FACTURA: 'F',
  NOTA_CREDITO_BOLETA: 'B',
  NOTA_CREDITO_FACTURA: 'F',
};

/** Lo que se escribe en una serie queda en mayúsculas y sin espacios (`b001 ` es `B001`). */
export const serieEscrita = (texto: string): string => texto.replace(/\s/g, '').toUpperCase();

const largo = (texto: string) => Array.from(texto).length;

const mismoNombre = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('es-PE') === b.trim().toLocaleLowerCase('es-PE');

export const MAXIMO_CORRELATIVO = 99_999_999;

/** Entero de 1 a 99999999 escrito solo con dígitos, o `null`. */
export function primerNumeroEscrito(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,8}$/.test(limpio)) return null;
  const n = Number(limpio);
  return n >= 1 && n <= MAXIMO_CORRELATIVO ? n : null;
}

/**
 * ¿Pide "Primer número" ese tipo? Solo si lo escrito es una serie nueva para la caja: la que ya está activa no
 * cambia y una inactiva de la misma caja se reactiva donde se quedó (criterio 5).
 */
export function pideElPrimerNumero(
  caja: CajaRespuesta | undefined,
  tipo: TipoSerie,
  escrita: string,
): boolean {
  const serie = serieEscrita(escrita);
  if (serie === '') return false;
  if (!caja) return true;
  return serieDeLaCaja(caja, tipo, serie) === undefined;
}

/** Cuánto cuesta saber qué hará el guardado con una serie: nada, reactivar una vieja o crear una nueva. */
export type AccionDeSerie = 'nada' | 'reactivar' | 'nueva';

export function accionDeSerie(
  caja: CajaRespuesta | undefined,
  tipo: TipoSerie,
  escrita: string,
): AccionDeSerie {
  const serie = serieEscrita(escrita);
  if (serie === '') return 'nada';
  if (!caja) return 'nueva';
  const existente = serieDeLaCaja(caja, tipo, serie);
  if (!existente) return 'nueva';
  return existente.activa ? 'nada' : 'reactivar';
}

export interface SerieAGuardar {
  tipo: TipoSerie;
  entrada: SerieEntrada;
}

export type ResultadoDeCaja =
  | { ok: true; nombre: string; impresoraId: string | null; series: SerieAGuardar[] }
  | { ok: false; errores: ErroresDeCaja };

/**
 * Valida el borrador antes de enviarlo. `guardada` es la caja que se edita (sin ella, es una caja nueva). Las series
 * que no cambian no se envían; una serie que ya existe en la caja no lleva "Primer número".
 */
export function validarCaja(
  borrador: BorradorDeCaja,
  cajas: readonly CajaRespuesta[],
  guardada?: CajaRespuesta,
): ResultadoDeCaja {
  const errores: ErroresDeCaja = {};
  const nombre = borrador.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre de la caja';
  else if (largo(nombre) > 40) errores.nombre = 'Usa 40 caracteres como máximo';
  else if (cajas.some((c) => c.id !== guardada?.id && mismoNombre(c.nombre, nombre))) {
    errores.nombre = 'Ya hay una caja con ese nombre en esta sucursal. Usa otro.';
  }

  const series: SerieAGuardar[] = [];
  for (const tipo of TIPOS_DE_SERIE) {
    const { serie: campoSerie, primero: campoPrimero } = CAMPOS_DE_SERIE[tipo];
    const serie = serieEscrita(borrador[campoSerie]);
    const activa = guardada ? serieActiva(guardada, tipo) : undefined;
    if (serie === '') {
      if (activa) {
        errores[campoSerie] =
          `Una serie no se quita: escribe otra para cambiarla o deja ${activa.serie}.`;
      }
      continue;
    }
    const prefijo = PREFIJO_DE_TIPO[tipo];
    if (!new RegExp(`^${prefijo}[A-Z0-9]{3}$`).test(serie)) {
      errores[campoSerie] =
        `La serie de ${NOMBRE_DE_TIPO[tipo].singular} empieza con ${prefijo} y tiene 4 caracteres, por ejemplo ${prefijo}001. Solo letras y números.`;
      continue;
    }
    const accion = accionDeSerie(guardada, tipo, serie);
    if (accion === 'nada') continue;
    const entrada: SerieEntrada = { serie };
    if (accion === 'nueva' && borrador[campoPrimero].trim() !== '') {
      const primero = primerNumeroEscrito(borrador[campoPrimero]);
      if (primero === null) {
        errores[campoPrimero] = 'Escribe un número entero de 1 a 99,999,999';
        continue;
      }
      entrada.primerNumero = primero;
    }
    series.push({ tipo, entrada });
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, nombre, impresoraId: borrador.impresoraId || null, series };
}

/** Solo lo que cambió respecto de la caja guardada (el `PATCH` pide al menos un campo). */
export function cambiosDeCaja(
  guardada: CajaRespuesta,
  nombre: string,
  impresoraId: string | null,
): CajaModificarEntrada {
  const cambios: CajaModificarEntrada = {};
  if (nombre !== guardada.nombre) cambios.nombre = nombre;
  if (impresoraId !== (guardada.impresora?.id ?? null)) cambios.impresoraId = impresoraId;
  return cambios;
}

/** `true` si el borrador difiere de lo guardado o si con errores conviene dejar guardar para mostrarlos. */
export function cajaCambio(
  guardada: CajaRespuesta,
  borrador: BorradorDeCaja,
  cajas: readonly CajaRespuesta[],
): boolean {
  const resultado = validarCaja(borrador, cajas, guardada);
  if (!resultado.ok) return true;
  return (
    Object.keys(cambiosDeCaja(guardada, resultado.nombre, resultado.impresoraId)).length > 0 ||
    resultado.series.length > 0
  );
}

// --- Errores del servidor ---------------------------------------------------------------------------

const AVISO_DE_REINTENTO =
  'La conexión se cortó y es posible que ya se haya guardado. Revisa la lista antes de intentarlo otra vez.';

export interface FalloDeCaja {
  /** Aviso general sobre el formulario. */
  general?: string;
  campos: ErroresDeCaja;
}

const MENSAJE_DE_NOMBRE = 'Ya hay una caja con ese nombre en esta sucursal. Usa otro.';
const MENSAJE_DE_LIMITE =
  'Esta sucursal ya tiene 10 cajas activas, que es el máximo. Desactiva una que no uses y vuelve a intentarlo.';
const MENSAJE_DE_IMPRESORA =
  'Esa impresora ya no está activa en esta sucursal. Elige otra o deja la de caja de la sucursal.';

/** Traduce el error de crear o modificar una caja a un mensaje general y, si se puede, a un campo. */
export function falloDeCaja(error: unknown): FalloDeCaja {
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  const porCampo = erroresPorCampo(error);
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    if (porCampo.nombre !== undefined) return { campos: { nombre: MENSAJE_DE_NOMBRE } };
    return { general: MENSAJE_DE_LIMITE, campos: {} };
  }
  if (error.codigo === 'REFERENCIA_INVALIDA' && porCampo.impresoraId !== undefined) {
    return { campos: { impresoraId: MENSAJE_DE_IMPRESORA } };
  }
  if (error.codigo === 'DATOS_INVALIDOS' && porCampo.nombre !== undefined) {
    return { campos: { nombre: mensajeDeCampo(porCampo.nombre) } };
  }
  return { general: mensajeDeError(error), campos: {} };
}

/** Traduce el error de poner una serie: la serie ocupada o el primer número distinto, cada uno en su campo. */
export function falloDeSerie(error: unknown, tipo: TipoSerie): FalloDeCaja {
  const { serie, primero } = CAMPOS_DE_SERIE[tipo];
  const nombre = NOMBRE_DE_TIPO[tipo].singular;
  if (!(error instanceof ErrorApi)) return { general: mensajeDeError(error), campos: {} };
  const porCampo = erroresPorCampo(error);
  if (error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
    if (porCampo.serie !== undefined) {
      return {
        campos: {
          [serie]: `Esa serie de ${nombre} ya la usa otra caja de este RUC. Escribe una distinta, por ejemplo la siguiente.`,
        },
      };
    }
    if (porCampo.primerNumero !== undefined) {
      return {
        campos: {
          [primero]:
            'Esa serie ya existe y su primer número no se cambia. Si quieres seguir donde se quedó, deja este campo vacío.',
        },
      };
    }
  }
  if (error.codigo === 'DATOS_INVALIDOS') {
    if (porCampo.serie !== undefined) {
      return { campos: { [serie]: mensajeDeCampo(porCampo.serie) } };
    }
    if (porCampo.primerNumero !== undefined) {
      return { campos: { [primero]: mensajeDeCampo(porCampo.primerNumero) } };
    }
  }
  return { general: mensajeDeError(error), campos: {} };
}

/** Por qué no se pudo desactivar o activar una caja, con palabras. */
export function falloDeCambiarActiva(
  error: unknown,
  caja: CajaRespuesta,
): { titulo: string; mensaje: string } {
  if (error instanceof ErrorApi && error.codigo === 'EN_USO') {
    return {
      titulo: 'No se puede desactivar: tiene un turno abierto',
      mensaje: caja.turnoAbierto
        ? `${textoDeTurno(caja)}. Ciérrala primero y vuelve a desactivarla.`
        : 'Alguien tiene esta caja abierta. Ciérrala primero y vuelve a desactivarla.',
    };
  }
  if (error instanceof ErrorApi && error.codigo === 'CONFLICTO') {
    if (error.reintentada) return { titulo: 'No pudimos cambiarla', mensaje: AVISO_DE_REINTENTO };
    return { titulo: 'No se puede activar', mensaje: MENSAJE_DE_LIMITE };
  }
  return {
    titulo: caja.activa ? 'No pudimos desactivarla' : 'No pudimos reactivarla',
    mensaje: mensajeDeError(error),
  };
}

// --- Tasa de IGV -----------------------------------------------------------------------------------

export interface BorradorDeTasa {
  /** AAAA-MM-DD, como lo escribe el campo de fecha. */
  desde: string;
  /** Porcentaje tal como lo escribe la persona (`18`, `10,5`). */
  tasa: string;
}

export type ErroresDeTasa = Partial<Record<'desde' | 'tasa', string>>;

/** El texto de una tasa a 2 decimales ("18" es "18.00"; "10,5" es "10.50"), o `null` si no es un porcentaje válido. */
export function tasaEscrita(texto: string): string | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros = '0', decimales = ''] = limpio.split('.');
  const centesimas = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  if (centesimas < 1 || centesimas > 3000) return null;
  return `${Number(enteros)}.${decimales.padEnd(2, '0')}`;
}

function esFechaReal(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

export type ResultadoDeTasa =
  { ok: true; desde: string; tasa: string } | { ok: false; errores: ErroresDeTasa };

export function validarTasa(
  borrador: BorradorDeTasa,
  tasas: readonly TasaIgvRespuesta[],
  editando: boolean,
): ResultadoDeTasa {
  const errores: ErroresDeTasa = {};
  if (!esFechaReal(borrador.desde)) errores.desde = 'Elige la fecha desde la que rige la tasa';
  else if (!editando && tasas.some((t) => t.desde === borrador.desde)) {
    errores.desde = 'Ya hay una tasa desde esa fecha. Tócala en la lista para cambiarla.';
  }
  const tasa = tasaEscrita(borrador.tasa);
  if (borrador.tasa.trim() === '') errores.tasa = 'Escribe la tasa, por ejemplo 18';
  else if (tasa === null) {
    errores.tasa =
      'Escribe un porcentaje de 0.01 a 30, con hasta 2 decimales. Por ejemplo, 18 o 10.5.';
  }
  if (Object.keys(errores).length > 0 || tasa === null) return { ok: false, errores };
  return { ok: true, desde: borrador.desde, tasa };
}

export const TEXTO_DE_FECHA_EMITIDA =
  'Este emisor ya emitió comprobantes en esa fecha o después, y las ventas ya hechas no se recalculan. Pon una fecha posterior.';

/** Traduce el error de guardar una tasa; el choque con comprobantes ya emitidos va en el campo "Desde". */
export function falloDeTasa(error: unknown): {
  general?: string;
  campos: ErroresDeTasa;
} {
  if (error instanceof ErrorApi) {
    const porCampo = erroresPorCampo(error);
    if (error.codigo === 'CONFLICTO') {
      if (error.reintentada) return { general: AVISO_DE_REINTENTO, campos: {} };
      if (porCampo.desde !== undefined) return { campos: { desde: TEXTO_DE_FECHA_EMITIDA } };
    }
    if (error.codigo === 'DATOS_INVALIDOS') {
      const campos: ErroresDeTasa = {};
      if (porCampo.tasa !== undefined) campos.tasa = mensajeDeCampo(porCampo.tasa);
      if (Object.keys(campos).length > 0) return { campos };
    }
  }
  return { general: mensajeDeError(error), campos: {} };
}

/** "18.00 %": el número y el signo no se separan al partir la línea. */
export const textoDeTasa = (tasa: string): string => `${tasa}\u00a0%`;

export type EstadoDeFecha = 'VIGENTE' | 'PROGRAMADA' | 'ANTERIOR';

/** Cada tasa frente a hoy: la que rige, las que vendrán y las que ya se reemplazaron. */
export function estadoDeTasa(
  tasa: TasaIgvRespuesta,
  tasas: readonly TasaIgvRespuesta[],
  hoy: string = hoyEnLima(),
): EstadoDeFecha {
  if (tasa.desde > hoy) return 'PROGRAMADA';
  return tasaVigente(tasas, hoy)?.desde === tasa.desde ? 'VIGENTE' : 'ANTERIOR';
}
