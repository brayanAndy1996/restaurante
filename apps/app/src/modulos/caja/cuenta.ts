import {
  cortesiaRespuestaSchema,
  cuentaRespuestaSchema,
  cuentaResumenSchema,
  descuentoRespuestaSchema,
  type CortesiaEntrada,
  type CuentaRespuesta,
  type CuentaResumen,
  type DescuentoEntrada,
  type ObjetivoAutorizacion,
} from '@restaurante/contratos';
import { calcularCuenta, validarDescuento } from '@restaurante/dominio/caja';
import { api, listaDe } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { montoComoTexto, textoDeDescuento } from '../../lib/monto';
import { CLAVES_TIEMPO_REAL } from '../../lib/tiempo-real';
import { tituloDeMesas } from '../salon/ordenes';

/**
 * La cuenta vista para cobrar con sus descuentos y cortesías (historia 006, criterios 36 a 46 y 111): las llamadas a
 * la API, los objetivos de la clave del supervisor, la vista previa y los mensajes de error. Los montos que se
 * muestran son los que calcula la API (`GET /cuentas/:ordenId`); la vista previa de antes de aplicar usa las mismas
 * funciones de `packages/dominio` y nunca decide: la API valida otra vez.
 */

// --- Claves de las consultas ---------------------------------------------------------------------------

/** Cuelga de `['orden', id]`: el evento `orden.cambio` y cada escritura la vuelven a pedir con la cuenta de la mesa. */
export const claveDeCuenta = (ordenId: string) =>
  [...CLAVES_TIEMPO_REAL.orden(ordenId), 'cuenta'] as const;
/** Cuelga de `['turno']`, que invalida `turno.cambio`. */
export const claveDePorCobrar = (sucursalId: string) =>
  [...CLAVES_TIEMPO_REAL.turno, 'por-cobrar', sucursalId] as const;

/** La ruta de la cuenta con sus descuentos y cortesías, que se abre desde la mesa y desde «Por cobrar». */
export const rutaDeCuenta = (ordenId: string) => `/caja/cuentas/${ordenId}`;

// --- Llamadas a la API ---------------------------------------------------------------------------------

/** Solo la primera lectura cuenta como actividad de la persona; las del sondeo mandan `X-Actividad: segundo-plano`. */
export const leerCuenta = (ordenId: string, senal?: AbortSignal, segundoPlano = false) =>
  api.get(`/cuentas/${ordenId}`, {
    esquema: cuentaRespuestaSchema,
    ...(senal ? { senal } : {}),
    ...(segundoPlano ? { segundoPlano } : {}),
  });

export const listarPorCobrar = (senal?: AbortSignal, segundoPlano = false) =>
  api.get<CuentaResumen[]>('/cuentas', {
    esquema: listaDe(cuentaResumenSchema),
    ...(senal ? { senal } : {}),
    ...(segundoPlano ? { segundoPlano } : {}),
  });

/** `autorizacion` es el `X-Autorizacion` de la clave del supervisor, que el Mozo y el Cajero necesitan. */
export type ExtraConClave = ExtraDeEscritura & { autorizacion?: string };

export const aplicarDescuento = (
  ordenId: string,
  entrada: DescuentoEntrada,
  extra?: ExtraConClave,
) =>
  api.post(`/cuentas/${ordenId}/descuentos`, entrada, {
    esquema: descuentoRespuestaSchema,
    ...extra,
  });

export const aplicarCortesia = (ordenId: string, entrada: CortesiaEntrada, extra?: ExtraConClave) =>
  api.post(`/cuentas/${ordenId}/cortesias`, entrada, {
    esquema: cortesiaRespuestaSchema,
    ...extra,
  });

/** Quitar no pide clave ni clave de idempotencia (criterio 42): repetirlo responde 204 sin efecto. */
export const quitarDescuento = (ordenId: string, id: string) =>
  api.delete(`/cuentas/${ordenId}/descuentos/${id}`);
export const quitarCortesia = (ordenId: string, id: string) =>
  api.delete(`/cuentas/${ordenId}/cortesias/${id}`);

// --- Qué se puede hacer con la cuenta ------------------------------------------------------------------

type Linea = CuentaRespuesta['lineas'][number];

/** Descuentos y cortesías se cambian solo con la cuenta abierta y sin cobros (criterio 45). */
export const sePuedeAjustar = (cuenta: Pick<CuentaRespuesta, 'estado' | 'cobros'>): boolean =>
  (cuenta.estado === 'ABIERTA' || cuenta.estado === 'EN_PRECUENTA') && cuenta.cobros.length === 0;

/** «Descuento» en un ítem: sin otro descuento y con alguna unidad que no sea cortesía (criterio 38). */
export const admiteDescuento = (linea: Linea): boolean =>
  linea.descuento === null && linea.cantidadCortesia < linea.cantidad;

/** «Cortesía» en un ítem: sin ICBPER, sin descuento y sin otra cortesía (criterio 43). */
export const admiteCortesia = (linea: Linea): boolean =>
  !linea.aplicaIcbper && linea.descuento === null && linea.cantidadCortesia === 0;

export const cortesiaDeLinea = (cuenta: CuentaRespuesta, itemId: string) =>
  cuenta.cortesias.find((c) => c.itemId === itemId) ?? null;

/** «Mesa 4», «Mesas 4 y 5» o, en un mostrador, «Llamado 23». */
export function tituloDeCuenta(cuenta: Pick<CuentaRespuesta, 'mesas' | 'numeroLlamado'>): string {
  if (cuenta.mesas.length > 0) return tituloDeMesas(cuenta.mesas);
  return cuenta.numeroLlamado === null ? 'Cuenta' : `Llamado ${cuenta.numeroLlamado}`;
}

/** Las unidades que se cobran de la línea: las vigentes menos las que van de cortesía. */
export const unidadesCobrables = (linea: Pick<Linea, 'cantidad' | 'cantidadCortesia'>): number =>
  linea.cantidad - linea.cantidadCortesia;

// --- Objetivos de la clave del supervisor (criterio 40, pregunta 9) --------------------------------------

export interface ValoresDeDescuento {
  tipo: 'PORCENTAJE' | 'MONTO';
  /** Texto decimal con 2 decimales ("10.00"). */
  valor: string;
}

/** Lo que se autoriza y lo que se manda al aplicar salen de este mismo objeto: no hay dos copias que puedan separarse. */
export const objetivoDeDescuento = (
  ordenId: string,
  itemId: string | null,
  descuento: ValoresDeDescuento,
): ObjetivoAutorizacion => ({
  tipo: 'DESCUENTO',
  ordenId: ordenId.toLowerCase(),
  itemId: itemId === null ? null : itemId.toLowerCase(),
  descuento: { tipo: descuento.tipo, valor: descuento.valor },
});

export const objetivoDeCortesia = (
  ordenId: string,
  itemId: string,
  cantidad: number,
): ObjetivoAutorizacion => ({
  tipo: 'CORTESIA',
  ordenId: ordenId.toLowerCase(),
  itemId: itemId.toLowerCase(),
  cantidad,
});

/** El valor escrito del descuento como la API lo espera ("10" → "10.00"), o `null` si no es un valor. */
export const valorEscrito = (texto: string): string | null => montoComoTexto(texto);

// --- Vista previa --------------------------------------------------------------------------------------

export type Cambio =
  | { tipo: 'DESCUENTO'; itemId: string | null; descuento: ValoresDeDescuento }
  | { tipo: 'CORTESIA'; itemId: string; cantidad: number }
  | { tipo: 'QUITAR_DESCUENTO'; itemId: string | null }
  | { tipo: 'QUITAR_CORTESIA'; itemId: string };

export type VistaPrevia =
  | {
      ok: true;
      /** Lo que descuenta, solo en un descuento de ítem. */
      monto: string | null;
      totalAntes: string;
      totalDespues: string;
    }
  | { ok: false; codigo: 'DESCUENTO_EXCESIVO' | 'DESCUENTO_NULO'; tipo: 'PORCENTAJE' | 'MONTO' };

/**
 * Cómo quedaría la cuenta con el cambio, calculado con `packages/dominio` sobre las líneas que dio la API. Sirve
 * para que la persona vea el efecto (y para no gastar la clave del supervisor en un descuento que la API rechazaría);
 * la API vuelve a validar. `null` si no se puede calcular.
 */
export function vistaPrevia(cuenta: CuentaRespuesta, cambio: Cambio): VistaPrevia | null {
  let monto: string | null = null;
  if (cambio.tipo === 'DESCUENTO') {
    const { tipo, valor } = cambio.descuento;
    const linea =
      cambio.itemId === null ? null : cuenta.lineas.find((l) => l.itemId === cambio.itemId);
    if (cambio.itemId !== null && !linea) return null;
    // En la cuenta se prueba contra el subtotal (porcentaje excesivo o en cero); el monto que iguala o supera
    // la base lo detecta `calcularCuenta` más abajo.
    const base = linea ? linea.bruto : cuenta.totales.subtotal;
    const resultado = validarDescuento(base, { tipo, valor });
    if (!resultado.valido) return { ok: false, codigo: resultado.codigo, tipo };
    if (linea) monto = resultado.monto;
  }
  try {
    const calculada = calcularCuenta({
      lineas: cuenta.lineas.map((l) => {
        let descuento = l.descuento ? { tipo: l.descuento.tipo, valor: l.descuento.valor } : null;
        let cantidadCortesia = l.cantidadCortesia;
        if (cambio.itemId === l.itemId) {
          if (cambio.tipo === 'DESCUENTO') descuento = cambio.descuento;
          else if (cambio.tipo === 'QUITAR_DESCUENTO') descuento = null;
          else if (cambio.tipo === 'CORTESIA') cantidadCortesia = cambio.cantidad;
          else cantidadCortesia = 0;
        }
        return {
          itemId: l.itemId,
          precioUnitario: l.precioUnitario,
          cantidad: l.cantidad,
          cantidadCortesia,
          afectacion: l.afectacion,
          aplicaIcbper: l.aplicaIcbper,
          descuento,
        };
      }),
      descuentoCuenta:
        cambio.tipo === 'DESCUENTO' && cambio.itemId === null
          ? cambio.descuento
          : cambio.tipo === 'QUITAR_DESCUENTO' && cambio.itemId === null
            ? null
            : cuenta.descuentoCuenta
              ? { tipo: cuenta.descuentoCuenta.tipo, valor: cuenta.descuentoCuenta.valor }
              : null,
      tasaIgv: cuenta.parametros.tasaIgv,
      montoIcbper: cuenta.parametros.montoIcbper,
    });
    return {
      ok: true,
      monto,
      totalAntes: cuenta.totales.total,
      totalDespues: calculada.totales.total,
    };
  } catch (error) {
    if (error instanceof RangeError && cambio.tipo === 'DESCUENTO') {
      return { ok: false, codigo: 'DESCUENTO_EXCESIVO', tipo: cambio.descuento.tipo };
    }
    return null;
  }
}

export { textoDeDescuento };
export { falloDeCuenta, textoDeDescuentoRechazado, type FalloDeCuenta } from './fallos';

// --- Textos --------------------------------------------------------------------------------------------

/** Los atajos de motivo de un toque para descuentos y cortesías. */
export const ATAJOS_DE_DESCUENTO = [
  'Cliente frecuente',
  'Demora en el servicio',
  'Cumpleaños',
] as const;
export const ATAJOS_DE_CORTESIA = [
  'Cortesía de la casa',
  'Reclamo del cliente',
  'Cumpleaños',
] as const;
