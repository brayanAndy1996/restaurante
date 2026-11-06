import {
  notaCreditoRespuestaSchema,
  type CajaRespuesta,
  type ClienteComprobanteEntrada,
  type ComprobanteDetalle,
  type NotaCreditoEntrada,
  type NotaCreditoRespuesta,
  type ObjetivoAutorizacion,
  type TurnoRespuesta,
} from '@restaurante/contratos';
import type { MedioPago, TipoNotaCredito } from '@restaurante/dominio';
import {
  calcularNotaCredito,
  sumarMontos,
  type LineaAcreditada,
  type LineaDeNotaCalculada,
  type OriginalDeNota,
  type PedidoDeNota,
  type TotalesCuenta,
} from '@restaurante/dominio/caja';
import { api } from '../../lib/api';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { montoEnSoles } from '../../lib/monto';
import { NOMBRE_DE_MEDIO_DE_PAGO } from '../caja/cobro';
import type { ExtraConClave } from '../caja/cuenta';
import { horaDelTurno } from '../caja/turno';

/**
 * La nota de crédito en la PWA (historia 006, entrega 6b, criterios 143 a 153 y 177): qué tipos admite un comprobante,
 * qué le falta por acreditar, la nota que se arma con lo que la persona elige, lo que se autoriza con la clave del
 * supervisor y los errores dichos en palabras. Ningún monto se decide aquí: la nota la calcula `calcularNotaCredito`,
 * el efectivo de la devolución y su redondeo `redondeoEfectivo` y la validación final `validarPagos`, las mismas
 * funciones de `packages/dominio` que usa la API al emitir.
 */

// --- Llamada a la API ----------------------------------------------------------------------------------

/**
 * `POST /notas-credito` (criterio 144). `Idempotency-Key` y reintentos vienen de `extra` (`enviarSinPerder`); la clave
 * del supervisor, de las personas que la necesitan, va en `X-Autorizacion` (criterio 145).
 */
export const emitirNotaCredito = (entrada: NotaCreditoEntrada, extra?: ExtraConClave) =>
  api.post<NotaCreditoRespuesta>('/notas-credito', entrada, {
    esquema: notaCreditoRespuestaSchema,
    ...extra,
  });

// --- Qué se puede acreditar ----------------------------------------------------------------------------

export const NOMBRE_DE_TIPO_DE_NOTA: Record<TipoNotaCredito, string> = {
  ANULACION: 'Anular',
  DEVOLUCION: 'Devolver ítems',
  CAMBIO_A_FACTURA: 'Cambiar a factura',
};

/** Cómo se dice el tipo en el título de la ventana y del resultado. */
export const TITULO_DE_TIPO_DE_NOTA: Record<TipoNotaCredito, string> = {
  ANULACION: 'Anulación',
  DEVOLUCION: 'Devolución',
  CAMBIO_A_FACTURA: 'Cambio a factura',
};

export interface LineaPorAcreditar {
  posicion: number;
  descripcion: string;
  /** Lo que se cobró. */
  cantidad: number;
  /** Lo que ya acreditaron las notas que cuentan. */
  acreditadas: number;
  /** Lo que todavía se puede devolver; cero en una línea gratuita (una cortesía no se devuelve). */
  faltan: number;
  gratuita: boolean;
  precioUnitario: string;
}

/** Cada línea del comprobante con lo que le falta por acreditar (criterio 148). */
export function lineasPorAcreditar(comprobante: ComprobanteDetalle): LineaPorAcreditar[] {
  const acreditado = new Map((comprobante.acreditado ?? []).map((a) => [a.posicion, a]));
  return comprobante.lineas.map((l) => {
    const acreditadas = acreditado.get(l.posicion)?.cantidad ?? 0;
    return {
      posicion: l.posicion,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      acreditadas,
      faltan: l.gratuita ? 0 : Math.max(0, l.cantidad - acreditadas),
      gratuita: l.gratuita,
      precioUnitario: l.precioUnitario,
    };
  });
}

/**
 * Los tipos de nota que admite el comprobante: la devolución mientras quede algo por devolver; la anulación y el cambio
 * a factura solo si ninguna nota cuenta todavía (pregunta 32: lo que queda después de una devolución se devuelve con
 * otra devolución); el cambio, además, solo de una boleta de un emisor que emite facturas (criterio 146).
 */
export function tiposDeNota(comprobante: ComprobanteDetalle): TipoNotaCredito[] {
  if (comprobante.estado !== 'ACEPTADO') return [];
  if (comprobante.tipo !== 'BOLETA' && comprobante.tipo !== 'FACTURA') return [];
  const sinNotas = (comprobante.notasCredito ?? []).length === 0;
  const tipos: TipoNotaCredito[] = [];
  if (sinNotas) tipos.push('ANULACION');
  if (lineasPorAcreditar(comprobante).some((l) => l.faltan > 0)) tipos.push('DEVOLUCION');
  if (sinNotas && comprobante.tipo === 'BOLETA' && comprobante.emisor.regimen !== 'NUEVO_RUS') {
    tipos.push('CAMBIO_A_FACTURA');
  }
  return tipos;
}

/** El detalle ofrece «Nota de crédito» solo si el comprobante admite al menos un tipo. */
export const sePuedeEmitirNota = (comprobante: ComprobanteDetalle): boolean =>
  tiposDeNota(comprobante).length > 0;

// --- La nota que se arma ---------------------------------------------------------------------------------

/**
 * El comprobante como lo entiende el dominio. Las líneas gratuitas llevan el valor, la base y el IGV referenciales tal
 * como la API los guardó (criterio 69): no se derivan aquí.
 */
function originalDe(comprobante: ComprobanteDetalle): OriginalDeNota {
  return {
    tasaIgv: comprobante.tasaIgv,
    lineas: comprobante.lineas.map((l) => ({
      posicion: l.posicion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      afectacion: l.afectacion,
      bruto: l.bruto,
      descuento: l.descuento,
      neto: l.neto,
      base: l.base,
      igv: l.igv,
      bolsas: l.bolsas,
      icbper: l.icbper,
      gratuita: l.gratuita,
      ...(l.gratuita
        ? {
            valorReferencial: l.valorReferencial,
            baseReferencial: l.baseReferencial,
            igvReferencial: l.igvReferencial,
          }
        : {}),
    })),
  };
}

/** Lo que ya acreditaron las notas que cuentan, con el nombre que lleva en el dominio (`posicionOrigen`). */
const acreditadasDe = (comprobante: ComprobanteDetalle): LineaAcreditada[] =>
  (comprobante.acreditado ?? []).map(({ posicion, ...resto }) => ({
    posicionOrigen: posicion,
    ...resto,
  }));

export type NotaCalculada =
  | {
      ok: true;
      lineas: LineaDeNotaCalculada[];
      totales: TotalesCuenta;
      total: string;
      /** Las unidades que se devuelven; `null` si la nota no es una devolución. */
      devueltas: { posicion: number; cantidad: number }[] | null;
    }
  | {
      ok: false;
      /**
       * `SIN_UNIDADES`: todavía no se eligió nada. `NADA_QUE_ACREDITAR` e `INVALIDA`: el dominio no la admite (el
       * comprobante cambió). `DATOS`: los montos del comprobante no se pudieron leer.
       */
      motivo: 'SIN_UNIDADES' | 'NADA_QUE_ACREDITAR' | 'INVALIDA' | 'DATOS';
    };

/** Las unidades elegidas por posición, sin ceros ni pasarse de lo que falta, en el orden de las líneas. */
export function unidadesElegidas(
  comprobante: ComprobanteDetalle,
  unidades: Readonly<Record<number, number>>,
): { posicion: number; cantidad: number }[] {
  return lineasPorAcreditar(comprobante)
    .map((l) => ({ posicion: l.posicion, cantidad: Math.min(unidades[l.posicion] ?? 0, l.faltan) }))
    .filter((l) => l.cantidad > 0);
}

/**
 * La nota que sale de lo elegido, con `calcularNotaCredito` (criterio 147). La anulación y el cambio a factura acreditan
 * todo el comprobante; la devolución, las unidades elegidas.
 */
export function calcularLaNota(
  comprobante: ComprobanteDetalle,
  tipo: TipoNotaCredito,
  unidades: Readonly<Record<number, number>>,
): NotaCalculada {
  const devueltas = tipo === 'DEVOLUCION' ? unidadesElegidas(comprobante, unidades) : null;
  if (devueltas !== null && devueltas.length === 0) return { ok: false, motivo: 'SIN_UNIDADES' };
  const pedido: PedidoDeNota =
    devueltas === null ? { tipo: 'ANULACION' } : { tipo: 'DEVOLUCION', lineas: devueltas };
  try {
    const nota = calcularNotaCredito(originalDe(comprobante), acreditadasDe(comprobante), pedido);
    if (!nota.valida) {
      return { ok: false, motivo: nota.codigo === 'NADA_QUE_ACREDITAR' ? nota.codigo : 'INVALIDA' };
    }
    return {
      ok: true,
      lineas: nota.lineas,
      totales: nota.totales,
      total: nota.totales.total,
      devueltas,
    };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, motivo: 'DATOS' };
    throw error;
  }
}

// --- El turno del que sale la devolución -----------------------------------------------------------------

/** Un turno abierto del que puede salir el dinero de una devolución (criterio 150). */
export interface TurnoDeDevolucion {
  id: string;
  caja: string;
  /** Quién es responsable del turno. */
  responsable: string;
  abiertoEn: string;
  /** Es el turno de quien emite la nota. */
  propio: boolean;
}

/** El turno propio de quien emite (el Cajero devuelve solo desde el suyo); ninguno si no tiene la caja abierta. */
export const turnoPropio = (turno: TurnoRespuesta | null | undefined): TurnoDeDevolucion[] =>
  turno
    ? [
        {
          id: turno.id,
          caja: turno.caja.nombre,
          responsable: turno.responsable.nombre,
          abiertoEn: turno.abiertoEn,
          propio: true,
        },
      ]
    : [];

/**
 * Los turnos abiertos de la sucursal, de las cajas activas (el Supervisor y el Administrador pueden devolver desde el de
 * cualquiera, criterio 150), con el propio primero.
 */
export function turnosAbiertos(
  cajas: readonly Pick<CajaRespuesta, 'nombre' | 'turnoAbierto'>[],
  usuarioId: string,
): TurnoDeDevolucion[] {
  return cajas
    .flatMap((c) =>
      c.turnoAbierto
        ? [
            {
              id: c.turnoAbierto.id,
              caja: c.nombre,
              responsable: c.turnoAbierto.responsable.nombre,
              abiertoEn: c.turnoAbierto.abiertoEn,
              propio: c.turnoAbierto.responsable.id === usuarioId,
            },
          ]
        : [],
    )
    .sort((a, b) => Number(b.propio) - Number(a.propio));
}

/** «Caja 1 · tu turno, desde 18:02» o «Caja 2 · turno de Ana, desde 08:00». */
export const etiquetaDeTurno = (t: TurnoDeDevolucion): string =>
  `${t.caja} · ${t.propio ? 'tu turno' : `turno de ${t.responsable}`}, desde ${horaDelTurno(t.abiertoEn)}`;

// --- Lo que se manda y lo que se autoriza ----------------------------------------------------------------

/** La suma de lo devuelto por medio (`"0.00"` sin devolución): es el `devuelto` que la clave del supervisor autoriza. */
export const devueltoDe = (pagos: readonly { monto: string }[] | null | undefined): string =>
  sumarMontos((pagos ?? []).map((p) => p.monto));

/**
 * Lo que la clave del supervisor autoriza (criterio 145): el comprobante, el tipo, el total de la nota y lo devuelto.
 * Es el mismo objeto que se muestra en la ventana y el que viaja a `POST /autorizaciones`.
 */
export const objetivoDeNota = (
  comprobanteId: string,
  tipoNota: TipoNotaCredito,
  total: string,
  devuelto: string,
): ObjetivoAutorizacion => ({
  tipo: 'NOTA_CREDITO',
  comprobanteId: comprobanteId.toLowerCase(),
  tipoNota,
  total,
  devuelto,
});

/** «en efectivo», «en efectivo y Yape», «en efectivo, Yape y Plin»: con qué se devuelve (para la ventana de la clave). */
export function textoDeMedios(medios: readonly MedioPago[]): string {
  const nombres = medios.map((m) => (m === 'EFECTIVO' ? 'efectivo' : NOMBRE_DE_MEDIO_DE_PAGO[m]));
  const ultimo = nombres.pop();
  if (ultimo === undefined) return '';
  return `en ${nombres.length > 0 ? `${nombres.join(', ')} y ` : ''}${ultimo}`;
}

export type DevolucionEntrada = NonNullable<NotaCreditoEntrada['devolucion']>;

export interface DatosDeNota {
  id: string;
  comprobanteId: string;
  tipo: TipoNotaCredito;
  motivo: string;
  total: string;
  devueltas: { posicion: number; cantidad: number }[] | null;
  /** `null`: sin devolución. Un cambio a factura no la lleva (criterio 144). */
  devolucion: DevolucionEntrada | null;
  cliente: ClienteComprobanteEntrada | undefined;
}

/** El cuerpo de `POST /notas-credito` (criterio 144). */
export function entradaDeNota(d: DatosDeNota): NotaCreditoEntrada {
  return {
    id: d.id,
    comprobanteId: d.comprobanteId,
    tipo: d.tipo,
    motivo: d.motivo,
    total: d.total,
    ...(d.tipo === 'DEVOLUCION' && d.devueltas ? { lineas: d.devueltas } : {}),
    ...(d.tipo === 'CAMBIO_A_FACTURA' ? {} : { devolucion: d.devolucion }),
    ...(d.tipo === 'CAMBIO_A_FACTURA' && d.cliente ? { cliente: d.cliente } : {}),
  };
}

/**
 * Lo que hace que dos intentos sean la misma nota (criterios 153 y 177): el comprobante. El `id` de la nota se conserva
 * hasta una respuesta final aunque la persona cambie las líneas, la devolución o el cliente: si el primer envío sí llegó
 * a la API y se emitiera con otro `id`, saldrían dos notas por una misma devolución. Si el `id` ya se usó con otro cuerpo,
 * la API lo dice (422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`) y la hoja manda a revisar el comprobante.
 */
export const huellaDeIntento = (comprobanteId: string): string => `nota:${comprobanteId}`;

/**
 * Todo el cuerpo menos el `id`: la clave de idempotencia solo se repite si el cuerpo es el mismo (la API rechaza otra
 * clave con otro cuerpo).
 */
export const huellaDelCuerpoDeNota = (entrada: NotaCreditoEntrada): string =>
  JSON.stringify([
    entrada.comprobanteId,
    entrada.tipo,
    entrada.lineas ?? null,
    entrada.devolucion ?? null,
    entrada.cliente ?? null,
    entrada.total,
    entrada.motivo,
  ]);

/**
 * La API contestó que no, y no por un corte ni por un cruce con otra operación: el `id` ya no hace falta. Un 422
 * `CLAVE_IDEMPOTENCIA_REUTILIZADA` no cuenta: dice que el `id` ya se usó, es decir, que la nota puede ya estar emitida, y
 * el `id` se conserva hasta que la persona revise el comprobante.
 */
export function esRespuestaFinal(error: unknown): boolean {
  return (
    error instanceof ErrorApi &&
    !error.sinConexion &&
    error.codigo !== 'CONFLICTO' &&
    error.codigo !== 'ENVIO_CANCELADO' &&
    error.codigo !== 'CLAVE_IDEMPOTENCIA_REUTILIZADA' &&
    error.estado < 500
  );
}

// --- Errores en palabras ---------------------------------------------------------------------------------

export interface FalloDeNota {
  titulo: string;
  /** El problema y la salida. */
  texto: string;
  /** Lo que se ve en pantalla estaba viejo: hay que volver a leer el comprobante. */
  releer?: boolean;
  /** La nota puede ya estar emitida: se ofrece «Revisar el comprobante» (vuelve a leerlo) en lugar de emitir otra. */
  revisar?: boolean;
  /** La revisión ya se intentó y no funcionó: el botón dice «Intentar otra vez». */
  revisarDeNuevo?: boolean;
  /** El turno elegido ya no sirve: hay que volver a leer los turnos abiertos y elegir otro. */
  releerTurnos?: boolean;
}

/** Por qué no se pudo emitir la nota, con palabras y con la salida. Lo escrito se conserva siempre. */
export function falloDeNota(error: unknown): FalloDeNota {
  const titulo = 'No se pudo emitir la nota';
  if (error instanceof ErrorApi) {
    switch (error.codigo) {
      case 'NOTA_CREDITO_CAMBIO': {
        const nuevo = error.campos.find((c) => c.campo === 'total')?.mensaje;
        return {
          titulo: 'El total de la nota cambió',
          texto: `${nuevo ? `${nuevo}. ` : ''}Ya actualizamos el comprobante: revisa la nota y vuelve a emitirla. Lo que escribiste sigue aquí.`,
          releer: true,
        };
      }
      case 'NADA_QUE_ACREDITAR':
        return {
          titulo,
          texto:
            'A esa línea ya no le queda nada por acreditar (otra nota se emitió antes). Ya actualizamos el comprobante: elige de nuevo lo que devuelves.',
          releer: true,
        };
      case 'NOTA_CREDITO_INVALIDA':
        return {
          titulo,
          texto: `${error.message}. Ya actualizamos el comprobante: revisa lo que falta por acreditar.`,
          releer: true,
        };
      case 'DEVOLUCION_INVALIDA':
        return {
          titulo,
          texto:
            'Lo que devuelves no cuadra con el total de la nota. Revisa los montos y el redondeo del efectivo.',
        };
      case 'COMPROBANTE_NO_ACEPTADO':
        return {
          titulo,
          texto:
            'SUNAT todavía no acepta este comprobante, así que no admite notas de crédito. Si lo rechazó, emite otro; si no, espera su respuesta.',
          releer: true,
        };
      case 'COMPROBANTE_ANULADO':
        return { titulo, texto: 'Este comprobante ya está anulado.', releer: true };
      case 'SIN_SERIE':
        return {
          titulo,
          texto:
            'La caja no tiene serie de notas de crédito. Pide al Administrador que la ponga en Ajustes › Cajas.',
        };
      case 'SERIE_AGOTADA':
        return {
          titulo,
          texto:
            'La serie de notas de crédito llegó a su último número. Pide al Administrador una serie nueva en Ajustes › Cajas.',
        };
      case 'TURNO_CERRADO':
        return {
          titulo,
          texto:
            'Ese turno ya está cerrado, así que no se puede devolver dinero desde él. Elige otro turno abierto, o emite la nota sin devolución. Lo que escribiste sigue aquí.',
          releerTurnos: true,
        };
      case 'TURNO_AJENO':
        return {
          titulo,
          texto:
            'Ese turno es de otra persona. Devuelve el dinero desde tu propio turno, o pídele a un supervisor que lo haga.',
          releerTurnos: true,
        };
      case 'COMPROBANTE_NO_PERMITIDO':
        return {
          titulo,
          texto: 'Por su régimen tributario, esta empresa solo emite boletas.',
        };
      case 'CLIENTE_REQUERIDO':
        return {
          titulo,
          texto: 'Faltan los datos del cliente: la factura pide RUC, razón social y dirección.',
        };
      case 'AUTORIZACION_INVALIDA':
      case 'CLAVE_REQUERIDA':
        return {
          titulo,
          texto:
            'La clave del supervisor no sirvió para esta nota. Pídela otra vez; lo que escribiste sigue aquí.',
        };
      case 'CLAVE_IDEMPOTENCIA_REUTILIZADA':
        return {
          titulo: 'Revisa el comprobante antes de emitir otra',
          texto:
            'Esta nota ya se había enviado con otros datos, así que puede ya estar emitida. Revisa el comprobante: si la nota ya salió, no hace falta emitir otra.',
          revisar: true,
        };
      case 'MODULO_NO_INCLUIDO':
        return { titulo, texto: 'El plan de esta sucursal no incluye la facturación electrónica.' };
      case 'MONTO_FUERA_DE_RANGO':
        return { titulo, texto: 'Un monto pasa de S/ 99,999,999.99. Revísalo.' };
    }
  }
  return {
    titulo,
    texto: mensajeDeError(error, {
      PROHIBIDO: 'No puedes emitir notas de crédito de este comprobante.',
      NO_ENCONTRADO: 'Este comprobante ya no está disponible.',
    }),
  };
}

/** El total de la nota con su símbolo, o «—» mientras no se pueda calcular. */
export const totalEnSoles = (total: string | null): string =>
  (total === null ? null : montoEnSoles(total)) ?? '—';
