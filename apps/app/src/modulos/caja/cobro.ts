import {
  cobroRespuestaSchema,
  type ClienteComprobanteEntrada,
  type CobroEntrada,
  type CobroRespuesta,
  type CuentaRespuesta,
  type PagoCobroEntrada,
} from '@restaurante/contratos';
import { MONTO_BOLETA_SIN_DOCUMENTO, validarRuc, type MedioPago } from '@restaurante/dominio';
import {
  calcularParte,
  redondeoEfectivo,
  validarPagos,
  type CuentaEntrada,
  type ParteCalculada,
  type ParteEntrada,
} from '@restaurante/dominio/caja';
import { api } from '../../lib/api';
import type { ExtraDeEscritura } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { comoDecimal, montoComoTexto, montoEnSoles } from '../../lib/monto';
import { mensajeDeCaja } from './turno';

/**
 * El cobro de una cuenta en la PWA (historia 006, criterios 47 a 68 y 111 a 114). Aquí van la llamada a la API, la
 * parte que se cobra, los pagos y el cliente que se escriben, y los errores dichos en palabras. Ningún monto se
 * decide aquí: la parte la calcula `calcularParte`, el efectivo y su redondeo `redondeoEfectivo` y la validación
 * final `validarPagos`, las mismas funciones de `packages/dominio` que usa la API al cobrar.
 */

// --- Llamada a la API ----------------------------------------------------------------------------------

/** `Idempotency-Key` y reintentos vienen de `extra` (`enviarSinPerder`); el `id` del cuerpo es el del cobro. */
export const cobrar = (ordenId: string, entrada: CobroEntrada, extra?: ExtraDeEscritura) =>
  api.post<CobroRespuesta>(`/cuentas/${ordenId}/cobros`, entrada, {
    esquema: cobroRespuestaSchema,
    ...extra,
  });

/** La ruta del cobro de una cuenta, que se abre desde «Por cobrar» y desde la cuenta de la mesa. */
export const rutaDeCobro = (ordenId: string) => `/caja/cuentas/${ordenId}/cobrar`;

// --- La cuenta como la entiende el dominio ---------------------------------------------------------------

/** La `CuentaEntrada` de `packages/dominio` armada con lo que dijo `GET /cuentas/:ordenId`. */
export function entradaDeCuenta(cuenta: CuentaRespuesta): CuentaEntrada {
  return {
    lineas: cuenta.lineas.map((l) => ({
      itemId: l.itemId,
      precioUnitario: l.precioUnitario,
      cantidad: l.cantidad,
      cantidadCortesia: l.cantidadCortesia,
      afectacion: l.afectacion,
      aplicaIcbper: l.aplicaIcbper,
      descuento: l.descuento ? { tipo: l.descuento.tipo, valor: l.descuento.valor } : null,
    })),
    descuentoCuenta: cuenta.descuentoCuenta
      ? { tipo: cuenta.descuentoCuenta.tipo, valor: cuenta.descuentoCuenta.valor }
      : null,
    tasaIgv: cuenta.parametros.tasaIgv,
    montoIcbper: cuenta.parametros.montoIcbper,
  };
}

/** Los detalles de las partes ya cobradas de la cuenta, en orden: las `partesAnteriores` de `calcularParte`. */
export const partesCobradas = (cuenta: CuentaRespuesta): ParteCalculada[] =>
  cuenta.cobros.map((c) => c.detalleParte);

/** Unidades de una línea que todavía no se cobran en ninguna parte (las vigentes, sin cortesía ni facturadas). */
export const unidadesPorCobrar = (linea: CuentaRespuesta['lineas'][number]): number =>
  Math.max(0, linea.cantidad - linea.cantidadCortesia - linea.cantidadFacturada);

// --- La parte que se cobra -------------------------------------------------------------------------------

/** Lo que la persona eligió cobrar. En `ITEMS`, las unidades de cada línea (las que están en 0 no cuentan). */
export type Seleccion =
  | { tipo: 'TOTAL' }
  | { tipo: 'ITEMS'; unidades: Readonly<Record<string, number>> }
  | { tipo: 'IGUALES'; partesRestantes: number };

export type FormatoDeCobro = 'DETALLADO' | 'CONSUMO';

export type ParteDePantalla =
  | {
      ok: true;
      /** Lo que viaja en `parte` del cobro. */
      entrada: CobroEntrada['parte'];
      /** El total de la parte con ICBPER (lo que vio la persona y se manda como `total`). */
      total: string;
      /** El detalle calculado por `calcularParte`. */
      calculada: ParteCalculada;
    }
  | { ok: false; motivo: 'VACIA' | 'INVALIDA' | 'NADA_QUE_COBRAR' | 'DESCUADRADA' };

/** La parte de dominio de una selección de la pantalla. */
export function parteDeSeleccion(seleccion: Seleccion): ParteEntrada | null {
  if (seleccion.tipo === 'TOTAL') return { tipo: 'TOTAL' };
  if (seleccion.tipo === 'IGUALES') {
    return { tipo: 'IGUALES', partesRestantes: seleccion.partesRestantes };
  }
  const items = Object.entries(seleccion.unidades)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([itemId, cantidad]) => ({ itemId, cantidad }));
  return items.length === 0 ? null : { tipo: 'ITEMS', items };
}

/**
 * Calcula la parte con `calcularParte` sobre la cuenta de la API y el detalle de cada cobro que ya trae (`detalleParte`,
 * en el orden de las partes): sirve desde cualquier equipo, sin recordar nada de lo cobrado antes.
 */
export function calcularLaParte(
  cuenta: CuentaRespuesta,
  anteriores: readonly ParteCalculada[],
  seleccion: Seleccion,
  formato: FormatoDeCobro,
): ParteDePantalla {
  const parte = parteDeSeleccion(seleccion);
  if (parte === null) return { ok: false, motivo: 'VACIA' };
  try {
    const resultado = calcularParte(entradaDeCuenta(cuenta), anteriores, parte, formato);
    if (!resultado.valida) {
      return {
        ok: false,
        motivo: resultado.codigo === 'NADA_QUE_COBRAR' ? 'NADA_QUE_COBRAR' : 'INVALIDA',
      };
    }
    const { valida: _valida, ...calculada } = resultado;
    return {
      ok: true,
      entrada: parte as CobroEntrada['parte'],
      total: calculada.totales.total,
      calculada,
    };
  } catch (error) {
    // Las partes anteriores ya no cuadran con la cuenta: la API lo dirá con su código; aquí no se inventa nada.
    if (error instanceof RangeError) return { ok: false, motivo: 'DESCUADRADA' };
    throw error;
  }
}

// --- Comprobante y cliente -------------------------------------------------------------------------------

export type TipoDeDocumento = ClienteComprobanteEntrada['tipoDocumento'];

export const NOMBRE_DE_DOCUMENTO: Record<TipoDeDocumento, string> = {
  DNI: 'DNI',
  CE: 'Carné de extranjería',
  PASAPORTE: 'Pasaporte',
  RUC: 'RUC',
};

export interface ClienteEscrito {
  tipoDocumento: TipoDeDocumento;
  numero: string;
  nombre: string;
  direccion: string;
}

export const CLIENTE_VACIO: ClienteEscrito = {
  tipoDocumento: 'DNI',
  numero: '',
  nombre: '',
  direccion: '',
};

/** Una boleta de más de S/ 700.00 exige documento y nombre del cliente (RF-59, criterio 51). */
export function boletaExigeCliente(total: string): boolean {
  const t = comoDecimal(total);
  const tope = comoDecimal(MONTO_BOLETA_SIN_DOCUMENTO);
  return t !== null && tope !== null && t.gt(tope);
}

export function textoDeNumeroDeDocumento(tipo: TipoDeDocumento): string {
  return tipo === 'DNI'
    ? 'Escribe los 8 dígitos del DNI'
    : tipo === 'RUC'
      ? 'Escribe un RUC válido de 11 dígitos'
      : 'Escribe de 6 a 12 letras o números';
}

export interface ErroresDeCliente {
  numero?: string;
  nombre?: string;
  direccion?: string;
}

export type ResultadoDeCliente =
  | { ok: true; cliente: ClienteComprobanteEntrada | undefined }
  | { ok: false; errores: ErroresDeCliente };

/**
 * El cliente que se manda según el comprobante (criterio 51): la factura exige RUC, razón social y dirección; la
 * boleta de más de S/ 700.00 exige documento y nombre; en las demás el cliente es opcional, pero si se empieza a
 * escribir tiene que estar completo.
 */
export function validarCliente(
  tipo: 'BOLETA' | 'FACTURA',
  total: string,
  escrito: ClienteEscrito,
): ResultadoDeCliente {
  const exigido = tipo === 'FACTURA' || boletaExigeCliente(total);
  const numero = escrito.numero.trim();
  const nombre = escrito.nombre.trim();
  const direccion = escrito.direccion.trim();
  const tipoDocumento: TipoDeDocumento = tipo === 'FACTURA' ? 'RUC' : escrito.tipoDocumento;
  const algo = numero !== '' || nombre !== '' || (tipo === 'FACTURA' && direccion !== '');
  if (!exigido && !algo) return { ok: true, cliente: undefined };

  const errores: ErroresDeCliente = {};
  const valido =
    tipoDocumento === 'DNI'
      ? /^\d{8}$/.test(numero)
      : tipoDocumento === 'RUC'
        ? validarRuc(numero)
        : /^[A-Za-z0-9]{6,12}$/.test(numero);
  if (!valido) errores.numero = textoDeNumeroDeDocumento(tipoDocumento);
  if (nombre === '' || nombre.length > 200) {
    errores.nombre =
      nombre === ''
        ? tipo === 'FACTURA'
          ? 'Escribe la razón social'
          : 'Escribe el nombre del cliente'
        : 'Usa 200 caracteres como máximo';
  }
  if (tipo === 'FACTURA' && direccion === '') errores.direccion = 'Escribe la dirección fiscal';
  else if (direccion.length > 300) errores.direccion = 'Usa 300 caracteres como máximo';
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return {
    ok: true,
    cliente: {
      tipoDocumento,
      numero,
      nombre,
      ...(direccion === '' ? {} : { direccion }),
    },
  };
}

// --- Pagos -------------------------------------------------------------------------------------------------

export const MEDIOS: readonly { medio: MedioPago; nombre: string }[] = [
  { medio: 'EFECTIVO', nombre: 'Efectivo' },
  { medio: 'TARJETA_CREDITO', nombre: 'Tarjeta de crédito' },
  { medio: 'TARJETA_DEBITO', nombre: 'Tarjeta de débito' },
  { medio: 'YAPE', nombre: 'Yape' },
  { medio: 'PLIN', nombre: 'Plin' },
];

export const NOMBRE_DE_MEDIO_DE_PAGO = Object.fromEntries(
  MEDIOS.map((m) => [m.medio, m.nombre]),
) as Record<MedioPago, string>;

/** Los billetes de los atajos de «Recibido». */
export const BILLETES = ['10.00', '20.00', '50.00', '100.00', '200.00'] as const;

export interface PagoEscrito {
  /** Identifica la fila en pantalla; no viaja. */
  clave: string;
  medio: MedioPago;
  /** Lo escrito. Se ignora en la fila que cubre el resto (el efectivo, o la primera si no hay efectivo). */
  monto: string;
  /** Solo en efectivo; vacío es «Exacto». */
  recibido: string;
  /** Número de operación o de voucher, fuera del efectivo. */
  operacion: string;
}

export const OPERACION_VALIDA = /^[A-Za-z0-9-]{1,30}$/;

/** Qué fila cubre el resto: el efectivo si hay (su redondeo depende de lo demás) y, si no, la primera. */
export function indiceDelResto(filas: readonly PagoEscrito[]): number {
  const efectivo = filas.findIndex((f) => f.medio === 'EFECTIVO');
  return efectivo >= 0 ? efectivo : 0;
}

export interface FilaCalculada {
  /** Lo que cobra esta fila (en el resto, ya calculado). `null` si todavía no hay un monto válido. */
  monto: string | null;
  /** Lo que dice debajo de la fila cuando no está bien. */
  problema?: string;
}

export interface ResumenDePagos {
  filas: FilaCalculada[];
  /** Lo que se deja de cobrar en efectivo para llegar a la décima (a favor del cliente); `"0.00"` sin efectivo. */
  redondeo: string;
  vuelto: string;
  /** Los pagos listos para mandar; `null` si algo no está bien. */
  pagos: PagoCobroEntrada[] | null;
  /** Por qué todavía no se puede cobrar, en palabras; `null` si está todo bien. */
  problema: string | null;
}

const SIN_PAGOS: ResumenDePagos = {
  filas: [],
  redondeo: '0.00',
  vuelto: '0.00',
  pagos: [],
  problema: null,
};

/**
 * Los pagos escritos contra el total de la parte. El efectivo y su redondeo salen de `redondeoEfectivo`; el vuelto y
 * la validación final, de `validarPagos`: si algo no cuadra se dice en palabras y el botón de cobrar espera.
 */
export function resumirPagos(total: string, filas: readonly PagoEscrito[]): ResumenDePagos {
  const t = comoDecimal(total);
  if (t === null) return { ...SIN_PAGOS, pagos: null, problema: 'No se pudo leer el total.' };
  if (t.isZero()) return SIN_PAGOS;
  if (filas.length === 0) {
    return { ...SIN_PAGOS, pagos: null, problema: 'Elige cómo paga el cliente.' };
  }

  const resto = indiceDelResto(filas);
  const calculadas: FilaCalculada[] = filas.map(() => ({ monto: null }));
  let problema: string | null = null;
  const marcar = (i: number, texto: string) => {
    const fila = calculadas[i];
    if (fila) fila.problema = texto;
    problema ??= texto;
  };

  // Lo escrito en las filas que no cubren el resto.
  const escritos: { i: number; monto: string }[] = [];
  filas.forEach((f, i) => {
    if (i === resto) return;
    const monto = montoComoTexto(f.monto);
    const fila = calculadas[i];
    if (monto === null) {
      marcar(i, `Escribe cuánto paga con ${NOMBRE_DE_MEDIO_DE_PAGO[f.medio]}.`);
    } else if (fila) {
      fila.monto = monto;
      escritos.push({ i, monto });
    }
  });

  const filaResto = filas[resto]!;
  let redondeo = '0.00';
  if (escritos.length === filas.length - 1 && problema === null) {
    try {
      if (filaResto.medio === 'EFECTIVO') {
        const r = redondeoEfectivo(
          total,
          escritos.map((e) => ({ monto: e.monto })),
        );
        calculadas[resto]!.monto = r.efectivo;
        redondeo = r.redondeo;
      } else {
        // Sin efectivo, todo se cobra al centavo: el resto es el total menos lo escrito.
        const r = redondeoEfectivo(
          total,
          escritos.map((e) => ({ monto: e.monto })),
        );
        const sobra = comoDecimal(r.efectivo)?.plus(r.redondeo);
        calculadas[resto]!.monto = sobra ? sobra.toFixed(2) : null;
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      marcar(resto, 'Lo escrito en los otros pagos pasa del total. Baja algún monto.');
    }
  }
  const montoResto = calculadas[resto]?.monto ?? null;
  if (montoResto !== null && !(comoDecimal(montoResto)?.gt(0) ?? false)) {
    calculadas[resto]!.monto = null;
    marcar(
      resto,
      filaResto.medio === 'EFECTIVO'
        ? 'No queda efectivo por cobrar. Quita el efectivo o baja los otros pagos.'
        : 'No queda nada por cobrar aquí. Quita este pago o baja los otros.',
    );
  }

  // Número de operación y recibido.
  filas.forEach((f, i) => {
    if (f.medio !== 'EFECTIVO') {
      if (!OPERACION_VALIDA.test(f.operacion.trim())) {
        marcar(i, `Escribe el número de operación del ${NOMBRE_DE_MEDIO_DE_PAGO[f.medio]}.`);
      }
    } else if (f.recibido.trim() !== '') {
      const recibido = montoComoTexto(f.recibido);
      const monto = calculadas[i]?.monto ?? null;
      if (recibido === null) marcar(i, 'Escribe cuánto recibiste, por ejemplo 50.');
      else if (monto !== null && (comoDecimal(recibido)?.lt(monto) ?? false)) {
        marcar(i, `Recibiste menos que el efectivo (${montoEnSoles(monto) ?? monto}).`);
      }
    }
  });
  if (problema !== null)
    return { filas: calculadas, redondeo, vuelto: '0.00', pagos: null, problema };

  const pagos: PagoCobroEntrada[] = filas.map((f, i) => {
    const monto = calculadas[i]?.monto ?? '0.00';
    if (f.medio === 'EFECTIVO') {
      const recibido = f.recibido.trim() === '' ? null : montoComoTexto(f.recibido);
      return { medio: f.medio, monto, ...(recibido ? { recibido } : {}) };
    }
    return { medio: f.medio, monto, operacion: f.operacion.trim() };
  });
  const validado = validarPagos(
    total,
    pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto,
      ...(p.recibido ? { recibido: p.recibido } : {}),
    })),
    redondeo,
  );
  if (!validado.valido) {
    return {
      filas: calculadas,
      redondeo,
      vuelto: '0.00',
      pagos: null,
      problema: 'Los pagos no cuadran con el total. Revisa los montos.',
    };
  }
  return { filas: calculadas, redondeo, vuelto: validado.vuelto, pagos, problema: null };
}

/** Los atajos de «Recibido»: los billetes que alcanzan para el efectivo, más «Exacto» (que es dejarlo vacío). */
export function billetesQueAlcanzan(efectivo: string | null): string[] {
  const monto = efectivo === null ? null : comoDecimal(efectivo);
  if (monto === null) return [...BILLETES];
  return BILLETES.filter((b) => comoDecimal(b)?.gte(monto) ?? false);
}

// --- El cobro que se manda ------------------------------------------------------------------------------------

/**
 * Lo que identifica un cobro para conservar su `id`: la misma orden, parte, comprobante y pagos son el mismo cobro
 * (el criterio 55 pide que el mismo `id` no cambie de cuerpo; sin `version` ni `total`, que pueden moverse).
 */
export function huellaDeCobro(entrada: Omit<CobroEntrada, 'id' | 'version' | 'total'>): string {
  return JSON.stringify([
    entrada.turnoId,
    entrada.parte,
    entrada.comprobante,
    entrada.pagos,
    entrada.redondeo,
  ]);
}

// --- Errores en palabras -----------------------------------------------------------------------------------------

export interface FalloDeCobro {
  /** El problema y la salida. */
  texto: string;
  /** La cuenta cambió: hay que leerla otra vez y dejar confirmar con el total nuevo; los pagos escritos se conservan. */
  cuentaCambio?: boolean;
  /** La cuenta ya no se puede cobrar aquí (cerrada, anulada, unida). */
  cuentaCerrada?: boolean;
  /** La principal si la cuenta se unió a otra. */
  ordenPrincipalId?: string;
  /** El turno ya no sirve: hay que volver a «Caja». */
  turno?: boolean;
  /** La API no llegó a contestar: lo mismo se puede repetir con el mismo `id`. */
  repetir?: boolean;
  /** Errores por campo del cuerpo (400), para marcarlos en el formulario. */
  campos?: Record<string, string>;
}

export function falloDeCobro(error: unknown): FalloDeCobro {
  if (!(error instanceof ErrorApi)) return { texto: mensajeDeError(error) };
  switch (error.codigo) {
    case 'CUENTA_CAMBIO':
      return {
        texto:
          'La cuenta cambió mientras cobrabas (alguien agregó, anuló o cambió algo). Ya la actualizamos: revisa el total nuevo y confirma otra vez. Lo que escribiste sigue aquí.',
        cuentaCambio: true,
      };
    case 'ORDEN_NO_ABIERTA':
      return {
        texto: error.ordenId
          ? 'Esta cuenta se unió a otra. Se cobra desde la cuenta principal.'
          : 'Esta cuenta ya no está abierta: puede que otra caja ya la cobrara. Revisa «Por cobrar».',
        cuentaCerrada: true,
        ...(error.ordenId ? { ordenPrincipalId: error.ordenId } : {}),
      };
    case 'NADA_QUE_COBRAR':
      return {
        texto: 'No queda nada por cobrar en esta cuenta.',
        cuentaCerrada: true,
      };
    case 'TURNO_CERRADO':
      return {
        texto:
          'Tu turno ya está cerrado, así que no se puede cobrar. Abre la caja otra vez desde «Caja».',
        turno: true,
      };
    case 'TURNO_AJENO':
      return {
        texto:
          'Este turno es de otra persona. Cobra en tu propio turno, o pídele a un supervisor que cobre.',
        turno: true,
      };
    case 'SIN_SERIE':
      return {
        texto:
          'Esta caja no tiene una serie activa para este comprobante. El administrador la configura en Ajustes › Cajas.',
      };
    case 'SERIE_AGOTADA':
      return {
        texto:
          'La serie de esta caja llegó a su último número. El administrador debe crear una serie nueva en Ajustes › Cajas.',
      };
    case 'TASA_IGV_NO_CONFIGURADA':
      return {
        texto:
          'Falta la tasa de IGV de la empresa. El administrador la agrega en Ajustes › Emisores.',
      };
    case 'CONFLICTO':
      return {
        texto:
          'Otra operación se estaba aplicando a esta cuenta. Vuelve a tocar «Cobrar»: se manda el mismo cobro y no se duplica.',
        repetir: true,
      };
    case 'PARTE_INVALIDA':
      return {
        texto:
          'Esa parte ya no se puede cobrar así. Actualizamos la cuenta; elige otra vez qué cobrar.',
        cuentaCambio: true,
      };
    case 'PAGOS_NO_CUADRAN':
      return {
        texto: 'Los pagos no cuadran con el total. Revisa los montos y el redondeo del efectivo.',
      };
    case 'COMPROBANTE_NO_PERMITIDO':
      return {
        texto:
          'Ese comprobante no se puede emitir aquí (el régimen del emisor, o el formato en partes iguales). Elige otro.',
      };
    case 'CLIENTE_REQUERIDO':
      return {
        texto:
          'Falta el cliente: la factura pide RUC, razón social y dirección, y la boleta de más de S/ 700.00 pide documento y nombre.',
      };
    case 'MONTO_FUERA_DE_RANGO':
      return { texto: 'Un monto pasa de S/ 99,999,999.99. Revísalo.' };
    case 'CLAVE_IDEMPOTENCIA_REUTILIZADA':
      return {
        texto:
          'Este cobro ya se había enviado con otros datos. Vuelve a abrir la cuenta para ver cómo quedó.',
        cuentaCambio: true,
      };
    case 'PROHIBIDO':
      return { texto: 'Tu rol no puede cobrar.' };
    case 'NO_ENCONTRADO':
      return {
        texto: 'No encontramos la cuenta o el turno. Puede que ya no exista: vuelve a «Caja».',
        cuentaCerrada: true,
      };
    case 'DATOS_INVALIDOS': {
      const campos = Object.fromEntries(error.campos.map((c) => [c.campo, c.mensaje]));
      return {
        texto: 'Revisa los datos marcados e inténtalo de nuevo.',
        campos,
      };
    }
    case 'SIN_CONEXION':
      return {
        texto:
          'No hay conexión con el servidor. El cobro sigue pendiente: toca «Reintentar» al volver la red y no se duplicará.',
        repetir: true,
      };
    default:
      if (error.estado >= 500) {
        return {
          texto:
            'Algo falló de nuestro lado y no sabemos si el cobro se hizo. Toca «Reintentar»: se manda el mismo cobro y no se duplica.',
          repetir: true,
        };
      }
      return { texto: mensajeDeCaja(error) };
  }
}
