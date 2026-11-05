import {
  CANTIDAD_MAXIMA_LINEA,
  CORRELATIVO_MAXIMO,
  ESTADOS_TURNO,
  MAXIMO_ITEMS_PARTE,
  MAXIMO_LINEAS_ENVIO,
  MAXIMO_PAGOS_COBRO,
  MAXIMO_PARTES_IGUALES,
  MEDIOS_PAGO,
  MODOS_COBRO,
  TIPOS_COMPROBANTE,
  TIPOS_DESCUENTO,
  TIPOS_MOVIMIENTO_CAJA,
  TIPOS_PARTE,
} from '@restaurante/dominio';
import { z } from 'zod';
import {
  comprobanteEntradaSchema,
  comprobanteRespuestaSchema,
  formatoComprobanteSchema,
  totalesCuentaSchema,
} from './comprobantes';
import { afectacionIgvSchema } from './carta';
import {
  fechaSchema,
  montoNoNegativoSchema,
  montoSchema,
  motivoSchema,
  regimenTributarioSchema,
  textoSchema,
  uuidSchema,
} from './comunes';
import {
  envioRespuestaSchema,
  estadoOrdenSchema,
  lineaEnvioEntradaSchema,
  mesaRefSchema,
  personaRefSchema,
  tipoOrdenSchema,
} from './salon';

/**
 * Contratos de Caja y cobro (historia 006, entrega 6a): cajas y series, tasa de IGV del emisor, turnos, movimientos,
 * reporte X y cierre Z, la cuenta, descuentos y cortesías, cobros y venta de mostrador. Las entradas son estrictas
 * (un campo desconocido es 400) y ninguna acepta `empresaId`, `creadoPor*` ni `actualizadoPor*`. Los montos viajan
 * como texto decimal con 2 decimales; los ids que genera la PWA (`id` de turno, movimiento, cobro, descuento,
 * cortesía y venta) son UUID y la API devuelve todos los ids en minúsculas.
 */

const instanteSchema = z.iso.datetime();

export const medioPagoSchema = z.enum(MEDIOS_PAGO);
export const tipoDescuentoSchema = z.enum(TIPOS_DESCUENTO);
export const tipoParteSchema = z.enum(TIPOS_PARTE);
export const modoCobroSchema = z.enum(MODOS_COBRO);
export const estadoTurnoSchema = z.enum(ESTADOS_TURNO);
export const tipoMovimientoCajaSchema = z.enum(TIPOS_MOVIMIENTO_CAJA);
/** El tipo de una serie en 6a: `BOLETA` o `FACTURA` (6b agrega las notas de crédito). */
export const tipoSerieSchema = z.enum(TIPOS_COMPROBANTE);

/**
 * Monto de un total, un pago o un `recibido` que escribe el cliente: hasta 12 enteros y 2 decimales. Lo que pase de
 * `"99999999.99"` lo rechaza el servicio con 422 `MONTO_FUERA_DE_RANGO` (criterio 62), no este esquema.
 */
export const montoDeCobroSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Debe ser un monto con hasta 2 decimales');
const montoDeCobroPositivoSchema = montoDeCobroSchema.refine(
  (texto) => /[1-9]/.test(texto),
  'Debe ser mayor que 0',
);

// ---------------------------------------------------------------------------------------------------
// Cajas y series (criterios 1 a 5)
// ---------------------------------------------------------------------------------------------------

/** `POST /sucursales/:sucursalId/cajas` (criterio 1): `nombre` de 1 a 40; `impresoraId` opcional. */
export const cajaEntradaSchema = z.strictObject({
  nombre: textoSchema(40),
  impresoraId: uuidSchema.nullable().optional(),
});

/** `PATCH /sucursales/:sucursalId/cajas/:id`: al menos un campo. `impresoraId: null` quita la impresora. */
export const cajaModificarEntradaSchema = z
  .strictObject({
    nombre: textoSchema(40).optional(),
    impresoraId: uuidSchema.nullable().optional(),
    activa: z.boolean().optional(),
  })
  .refine(
    (cambio) =>
      cambio.nombre !== undefined ||
      cambio.impresoraId !== undefined ||
      cambio.activa !== undefined,
    'Indica al menos un campo para modificar',
  );

/**
 * `PUT /sucursales/:sucursalId/cajas/:cajaId/series/:tipo` (criterio 3): `serie` de 4 caracteres que empieza con
 * `B` (boleta) o `F` (factura); `primerNumero` de 1 a 99999999 (por defecto 1). Como el `tipo` va en la ruta, la
 * coincidencia del prefijo con el tipo la comprueba `serieEntradaDeTipoSchema`.
 */
export const serieEntradaSchema = z.strictObject({
  serie: z
    .string()
    .regex(/^[BF][A-Z0-9]{3}$/, 'Debe tener 4 caracteres: B o F y tres letras o números'),
  primerNumero: z.number().int().min(1).max(CORRELATIVO_MAXIMO).optional(),
});

/** La entrada de una serie para el `tipo` de la ruta: `B…` para `BOLETA`, `F…` para `FACTURA`. */
export function serieEntradaDeTipoSchema(tipo: (typeof TIPOS_COMPROBANTE)[number]) {
  const prefijo = tipo === 'BOLETA' ? 'B' : 'F';
  return z.strictObject({
    serie: z
      .string()
      .regex(
        new RegExp(`^${prefijo}[A-Z0-9]{3}$`),
        `Debe empezar con ${prefijo} y tener 4 caracteres: letras mayúsculas o números`,
      ),
    primerNumero: z.number().int().min(1).max(CORRELATIVO_MAXIMO).optional(),
  });
}

export const serieRespuestaSchema = z.object({
  tipo: tipoSerieSchema,
  serie: z.string(),
  ultimoNumero: z.number().int().min(0),
  activa: z.boolean(),
  /**
   * El emisor con que se creó la serie. Si la sucursal cambió de emisor, las series del emisor anterior siguen
   * `activa` pero ya no emiten (el cobro responde 409 `SIN_SERIE`): la PWA lo avisa comparando con el emisor de la
   * sucursal.
   */
  emisorId: uuidSchema,
});

export const cajaRespuestaSchema = z.object({
  id: uuidSchema,
  sucursalId: uuidSchema,
  nombre: z.string(),
  activa: z.boolean(),
  impresora: z.object({ id: uuidSchema, nombre: z.string(), gaveta: z.boolean() }).nullable(),
  series: z.array(serieRespuestaSchema),
  /** Quién tiene la caja abierta y desde cuándo (sin montos); `null` si está libre. */
  turnoAbierto: z
    .object({ id: uuidSchema, responsable: personaRefSchema, abiertoEn: instanteSchema })
    .nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Tasa de IGV del emisor (criterio 6)
// ---------------------------------------------------------------------------------------------------

/** Cantidad de céntimos (o centésimas) de un texto decimal con hasta 2 decimales ya validado por regex. */
function centesimas(texto: string): number {
  const [enteros = '0', decimales = ''] = texto.split('.');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

/** Tasa de IGV en porcentaje: de `"0.01"` a `"30.00"`, con hasta 2 decimales. */
export const tasaIgvSchema = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'Debe ser un porcentaje con hasta 2 decimales')
  .refine((t) => centesimas(t) >= 1 && centesimas(t) <= 3000, 'Debe estar entre 0.01 y 30.00');

/** `PUT /emisores/:id/tasas-igv/:desde`. */
export const tasaIgvEntradaSchema = z.strictObject({ tasa: tasaIgvSchema });

/** El `:desde` de la ruta: una fecha `AAAA-MM-DD` que existe. */
export const tasaIgvDesdeSchema = fechaSchema;

export const tasaIgvRespuestaSchema = z.object({ desde: fechaSchema, tasa: z.string() });

// ---------------------------------------------------------------------------------------------------
// Turno (criterios 24 a 35)
// ---------------------------------------------------------------------------------------------------

/** `POST /turnos`: `id` lo genera la PWA; `fondo` de `"0.00"` a `"99999999.99"`. */
export const abrirTurnoEntradaSchema = z.strictObject({
  id: uuidSchema,
  cajaId: uuidSchema,
  fondo: montoNoNegativoSchema,
});

export const turnoRespuestaSchema = z.object({
  id: uuidSchema,
  caja: z.object({ id: uuidSchema, nombre: z.string() }),
  responsable: personaRefSchema,
  estado: estadoTurnoSchema,
  abiertoEn: instanteSchema,
  diaOperativo: z.string(),
  fondo: z.string(),
  cerradoEn: instanteSchema.nullable(),
  cerradoPor: personaRefSchema.nullable(),
});

/** `POST /turnos/:id/movimientos`: siempre en efectivo; `monto` de `"0.01"` a `"99999999.99"`. */
export const movimientoEntradaSchema = z.strictObject({
  id: uuidSchema,
  tipo: tipoMovimientoCajaSchema,
  monto: montoSchema,
  motivo: motivoSchema,
});

export const movimientoRespuestaSchema = z.object({
  id: uuidSchema,
  tipo: tipoMovimientoCajaSchema,
  monto: z.string(),
  motivo: z.string(),
  creadoEn: instanteSchema,
  creadoPor: personaRefSchema.nullable(),
});

/**
 * `POST /turnos/:id/cierre` (criterio 31): el conteo de los cinco medios, una vez cada uno, con `contado` de
 * `"0.00"` a `"99999999.99"`. El `motivo` de cada diferencia lo exige el servicio (422 `DIFERENCIA_SIN_MOTIVO`).
 */
export const cierreEntradaSchema = z.strictObject({
  conteo: z
    .array(
      z.strictObject({
        medio: medioPagoSchema,
        contado: montoNoNegativoSchema,
        motivo: motivoSchema.optional(),
      }),
    )
    .length(MEDIOS_PAGO.length)
    .superRefine((conteo, ctx) => {
      const vistos = new Set<string>();
      conteo.forEach((fila, indice) => {
        if (vistos.has(fila.medio)) {
          ctx.addIssue({ code: 'custom', message: 'Medio repetido', path: [indice, 'medio'] });
        }
        vistos.add(fila.medio);
      });
    }),
});

/** El conteo guardado al cerrar: por medio, lo esperado, lo contado y la diferencia (`contado − esperado`). */
export const conteoCierreRespuestaSchema = z.object({
  medio: medioPagoSchema,
  esperado: z.string(),
  contado: z.string(),
  diferencia: z.string(),
  motivo: z.string().nullable(),
});

/** Las diferencias que trae el 422 `DIFERENCIA_SIN_MOTIVO` (criterio 32): sin el esperado. */
export const diferenciaDeArqueoSchema = z.object({
  medio: medioPagoSchema,
  contado: z.string(),
  diferencia: z.string(),
});

/** `reporteCaja` (criterio 29): el reporte X de un turno abierto o el Z de uno cerrado (con `cierre`). */
export const reporteCajaSchema = z.object({
  turno: turnoRespuestaSchema,
  generadoEn: instanteSchema,
  fondo: z.string(),
  ventas: z.object({
    total: z.string(),
    cantidad: z.number().int(),
    porTipo: z.array(
      z.object({ tipo: z.enum(TIPOS_COMPROBANTE), cantidad: z.number().int(), total: z.string() }),
    ),
    porMedio: z.array(
      z.object({ medio: medioPagoSchema, cantidad: z.number().int(), monto: z.string() }),
    ),
    descuentos: z.string(),
    cortesias: z.string(),
    igv: z.string(),
    icbper: z.string(),
    redondeos: z.string(),
    vueltos: z.string(),
  }),
  movimientos: z.object({
    ingresos: z.string(),
    egresos: z.string(),
    lista: z.array(movimientoRespuestaSchema),
  }),
  /** Lo que debería haber de cada medio según el sistema (`esperadoDelTurno`), en el orden de `MEDIOS_PAGO`. */
  esperado: z.array(z.object({ medio: medioPagoSchema, monto: z.string() })),
  /** Solo en un turno cerrado. */
  cierre: z
    .object({
      cerradoEn: instanteSchema,
      cerradoPor: personaRefSchema,
      conteo: z.array(conteoCierreRespuestaSchema),
    })
    .optional(),
});

// ---------------------------------------------------------------------------------------------------
// Descuentos y cortesías (criterios 38 a 46)
// ---------------------------------------------------------------------------------------------------

/**
 * `POST /cuentas/:ordenId/descuentos`: `itemId` `null` aplica el descuento a la cuenta. `valor` es el porcentaje o
 * el monto; el rango de cada tipo lo valida el servicio con `validarDescuento` (422 `DESCUENTO_INVALIDO`).
 */
export const descuentoEntradaSchema = z.strictObject({
  id: uuidSchema,
  itemId: uuidSchema.nullable(),
  tipo: tipoDescuentoSchema,
  valor: montoSchema,
  motivo: motivoSchema,
});

export const descuentoRespuestaSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema.nullable(),
  tipo: tipoDescuentoSchema,
  valor: z.string(),
  /** Lo que descuenta en soles según la cuenta al aplicarlo. */
  monto: z.string(),
  motivo: z.string(),
  autorizadoPor: personaRefSchema.nullable(),
  creadoEn: instanteSchema,
  creadoPor: personaRefSchema.nullable(),
});

/** `POST /cuentas/:ordenId/cortesias`: `cantidad` de 1 a la cantidad vigente del ítem (lo comprueba el servicio). */
export const cortesiaEntradaSchema = z.strictObject({
  id: uuidSchema,
  itemId: uuidSchema,
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
  motivo: motivoSchema,
});

export const cortesiaRespuestaSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  cantidad: z.number().int(),
  valorReferencial: z.string(),
  motivo: z.string(),
  autorizadoPor: personaRefSchema.nullable(),
  creadoEn: instanteSchema,
  creadoPor: personaRefSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// La cuenta (criterios 36 y 37)
// ---------------------------------------------------------------------------------------------------

export const cuentaLineaRespuestaSchema = z.object({
  itemId: uuidSchema,
  nombre: z.string(),
  modificadores: z.array(z.string()),
  precioUnitario: z.string(),
  cantidad: z.number().int(),
  cantidadCortesia: z.number().int(),
  cantidadFacturada: z.number().int(),
  afectacion: afectacionIgvSchema,
  aplicaIcbper: z.boolean(),
  bruto: z.string(),
  descuento: descuentoRespuestaSchema.nullable(),
  /** Lo que le tocó a la línea del descuento por cuenta (prorrateo). */
  descuentoCuenta: z.string(),
  neto: z.string(),
  icbper: z.string(),
});

/** Una línea del comprobante de una parte (`LineaDeParte` de `packages/dominio/caja`); los montos van como texto. */
export const lineaDeParteSchema = z.object({
  /** `null` en las líneas "Por consumo" (una por afectación). */
  itemId: uuidSchema.nullable(),
  cantidad: z.number().int(),
  afectacion: afectacionIgvSchema,
  bruto: z.string(),
  descuento: z.string(),
  neto: z.string(),
  base: z.string(),
  igv: z.string(),
  bolsas: z.number().int(),
  icbper: z.string(),
  gratuita: z
    .object({
      cantidad: z.number().int(),
      valorReferencial: z.string(),
      base: z.string(),
      igv: z.string(),
    })
    .nullable(),
});

/** Lo que una parte toma de un ítem (`ItemDeParte`). */
export const itemDeParteSchema = z.object({
  itemId: uuidSchema,
  cantidad: z.number().int(),
  neto: z.string(),
  bolsas: z.number().int(),
});

/**
 * Una parte cobrada tal como la devolvió `calcularParte` y la guardó facturación (`ParteCalculada` de
 * `packages/dominio/caja`): la `partesAnteriores` de la siguiente parte.
 */
export const parteCalculadaSchema = z.object({
  tipo: tipoParteSchema,
  formato: formatoComprobanteSchema,
  lineas: z.array(lineaDeParteSchema),
  porItem: z.array(itemDeParteSchema),
  totales: totalesCuentaSchema,
  cierraLaCuenta: z.boolean(),
});

export const cobroDeCuentaSchema = z.object({
  id: uuidSchema,
  comprobante: z.object({ id: uuidSchema, tipo: z.enum(TIPOS_COMPROBANTE), numero: z.string() }),
  total: z.string(),
  cobradoEn: instanteSchema,
  cobradoPor: personaRefSchema.nullable(),
  /** La parte completa de este cobro (la del comprobante): permite calcular la siguiente desde cualquier equipo. */
  detalleParte: parteCalculadaSchema,
});

/** `GET /cuentas/:ordenId`: la orden vista para cobrar. */
export const cuentaRespuestaSchema = z.object({
  ordenId: uuidSchema,
  tipo: tipoOrdenSchema,
  estado: estadoOrdenSchema,
  mesas: z.array(mesaRefSchema),
  /** `null` en la venta de mostrador. */
  mozo: personaRefSchema.nullable(),
  numeroLlamado: z.number().int().nullable(),
  version: z.number().int().min(1),
  lineas: z.array(cuentaLineaRespuestaSchema),
  descuentoCuenta: descuentoRespuestaSchema.nullable(),
  cortesias: z.array(cortesiaRespuestaSchema),
  totales: totalesCuentaSchema,
  cobrado: z.string(),
  saldo: z.string(),
  modo: modoCobroSchema.nullable(),
  cobros: z.array(cobroDeCuentaSchema),
  parametros: z.object({
    /** `null` con un emisor Nuevo RUS. */
    tasaIgv: z.string().nullable(),
    montoIcbper: z.string(),
    regimen: regimenTributarioSchema,
    tiposPermitidos: z.array(z.enum(TIPOS_COMPROBANTE)),
  }),
});

/** `GET /cuentas`: una fila por orden abierta de la sucursal. */
export const cuentaResumenSchema = z.object({
  ordenId: uuidSchema,
  tipo: tipoOrdenSchema,
  mesas: z.array(mesaRefSchema),
  mozo: personaRefSchema.nullable(),
  abiertaEn: instanteSchema,
  estado: estadoOrdenSchema,
  total: z.string(),
  saldo: z.string(),
  modo: modoCobroSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Cobro (criterios 47 a 63)
// ---------------------------------------------------------------------------------------------------

/**
 * Qué se cobra (criterio 47): todo lo que falta, de 1 a 200 ítems con su cantidad, o el saldo dividido (de 1 a 50
 * partes restantes). Que un ítem exista, no se repita o no pida más de lo que falta lo valida el servicio con el
 * dominio (422 `PARTE_INVALIDA`).
 */
export const parteEntradaSchema = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('TOTAL') }),
  z.strictObject({
    tipo: z.literal('ITEMS'),
    items: z
      .array(
        z.strictObject({
          itemId: uuidSchema,
          cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
        }),
      )
      .min(1)
      .max(MAXIMO_ITEMS_PARTE),
  }),
  z.strictObject({
    tipo: z.literal('IGUALES'),
    partesRestantes: z.number().int().min(1).max(MAXIMO_PARTES_IGUALES),
  }),
]);

/**
 * Un pago (criterio 50): `operacion` (número de operación o de voucher) obligatoria fuera del efectivo y prohibida
 * en el efectivo (400 con `campos`). Que `recibido` solo vaya en efectivo y sea mayor o igual que `monto` lo valida
 * `validarPagos` (422 `PAGOS_NO_CUADRAN`).
 */
export const pagoCobroEntradaSchema = z
  .strictObject({
    medio: medioPagoSchema,
    monto: montoDeCobroPositivoSchema,
    recibido: montoDeCobroPositivoSchema.optional(),
    operacion: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,30}$/, 'Solo letras, números y guiones, de 1 a 30 caracteres')
      .optional(),
  })
  .superRefine((pago, ctx) => {
    if (pago.medio === 'EFECTIVO') {
      if (pago.operacion !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['operacion'],
          message: 'El efectivo no lleva número de operación',
        });
      }
    } else {
      if (pago.operacion === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['operacion'],
          message: 'Escribe el número de operación o de voucher',
        });
      }
    }
  });

/**
 * `POST /cuentas/:ordenId/cobros`: `id` lo genera la PWA y se conserva hasta una respuesta final. `version` y
 * `total` son lo que vio la persona (el servidor recalcula todo, criterio 49); `redondeo` debe ser el que
 * corresponde al efectivo (criterio 50).
 */
export const cobroEntradaSchema = z.strictObject({
  id: uuidSchema,
  turnoId: uuidSchema,
  version: z.number().int().min(1),
  total: montoDeCobroSchema,
  parte: parteEntradaSchema,
  comprobante: comprobanteEntradaSchema,
  pagos: z.array(pagoCobroEntradaSchema).max(MAXIMO_PAGOS_COBRO),
  redondeo: montoNoNegativoSchema,
});

export const pagoCobroRespuestaSchema = z.object({
  medio: medioPagoSchema,
  monto: z.string(),
  recibido: z.string().nullable(),
  operacion: z.string().nullable(),
});

export const cobroRespuestaSchema = z.object({
  id: uuidSchema,
  ordenId: uuidSchema,
  turnoId: uuidSchema,
  parte: parteEntradaSchema,
  total: z.string(),
  redondeo: z.string(),
  vuelto: z.string(),
  pagos: z.array(pagoCobroRespuestaSchema),
  comprobante: comprobanteRespuestaSchema,
  cuenta: z.object({
    estado: estadoOrdenSchema,
    saldo: z.string(),
    version: z.number().int().min(1),
  }),
  impresion: z.enum(['EN_COLA', 'SIN_IMPRESORA']),
  trabajoId: uuidSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Venta de mostrador (criterios 79 a 85)
// ---------------------------------------------------------------------------------------------------

/**
 * `POST /ventas-mostrador`: `id` es el de la orden que se crea; `lineas` como en el envío de 004; `total` es el
 * que vio el cajero (si el calculado con la carta vigente es otro, 409 `CUENTA_CAMBIO`, criterio 84). Sin
 * descuentos ni cortesías (criterio 85).
 */
export const ventaMostradorEntradaSchema = z.strictObject({
  id: uuidSchema,
  turnoId: uuidSchema,
  lineas: z.array(lineaEnvioEntradaSchema).min(1).max(MAXIMO_LINEAS_ENVIO),
  total: montoDeCobroSchema,
  comprobante: comprobanteEntradaSchema,
  pagos: z.array(pagoCobroEntradaSchema).max(MAXIMO_PAGOS_COBRO),
  redondeo: montoNoNegativoSchema,
});

export const ventaMostradorRespuestaSchema = z.object({
  venta: z.object({ id: uuidSchema, ordenId: uuidSchema, numeroLlamado: z.number().int().min(1) }),
  cobro: cobroRespuestaSchema,
  envio: envioRespuestaSchema,
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterio 97)
// ---------------------------------------------------------------------------------------------------

export const eventoTurnoCambioDatosSchema = z.object({ turnoId: uuidSchema, cajaId: uuidSchema });

export const eventoTurnoCambioSchema = z.object({
  empresaId: uuidSchema,
  sala: z.object({ tipo: z.literal('sucursal'), sucursalId: uuidSchema }),
  nombre: z.literal('turno.cambio'),
  datos: eventoTurnoCambioDatosSchema,
});

export type CajaEntrada = z.input<typeof cajaEntradaSchema>;
export type CajaModificarEntrada = z.input<typeof cajaModificarEntradaSchema>;
export type SerieEntrada = z.input<typeof serieEntradaSchema>;
export type SerieRespuesta = z.infer<typeof serieRespuestaSchema>;
export type CajaRespuesta = z.infer<typeof cajaRespuestaSchema>;
export type TasaIgvEntrada = z.input<typeof tasaIgvEntradaSchema>;
export type TasaIgvRespuesta = z.infer<typeof tasaIgvRespuestaSchema>;
export type AbrirTurnoEntrada = z.input<typeof abrirTurnoEntradaSchema>;
export type TurnoRespuesta = z.infer<typeof turnoRespuestaSchema>;
export type MovimientoEntrada = z.input<typeof movimientoEntradaSchema>;
export type MovimientoRespuesta = z.infer<typeof movimientoRespuestaSchema>;
export type CierreEntrada = z.input<typeof cierreEntradaSchema>;
export type CierreEntradaValidada = z.output<typeof cierreEntradaSchema>;
export type ConteoCierreRespuesta = z.infer<typeof conteoCierreRespuestaSchema>;
export type DiferenciaDeArqueo = z.infer<typeof diferenciaDeArqueoSchema>;
export type ReporteCaja = z.infer<typeof reporteCajaSchema>;
export type DescuentoEntrada = z.input<typeof descuentoEntradaSchema>;
export type DescuentoRespuesta = z.infer<typeof descuentoRespuestaSchema>;
export type CortesiaEntrada = z.input<typeof cortesiaEntradaSchema>;
export type CortesiaRespuesta = z.infer<typeof cortesiaRespuestaSchema>;
export type CuentaLineaRespuesta = z.infer<typeof cuentaLineaRespuestaSchema>;
export type CuentaRespuesta = z.infer<typeof cuentaRespuestaSchema>;
export type CuentaResumen = z.infer<typeof cuentaResumenSchema>;
export type ParteEntradaCobro = z.input<typeof parteEntradaSchema>;
export type PagoCobroEntrada = z.input<typeof pagoCobroEntradaSchema>;
export type CobroEntrada = z.input<typeof cobroEntradaSchema>;
export type CobroEntradaValidada = z.output<typeof cobroEntradaSchema>;
export type PagoCobroRespuesta = z.infer<typeof pagoCobroRespuestaSchema>;
export type CobroRespuesta = z.infer<typeof cobroRespuestaSchema>;
export type VentaMostradorEntrada = z.input<typeof ventaMostradorEntradaSchema>;
export type VentaMostradorEntradaValidada = z.output<typeof ventaMostradorEntradaSchema>;
export type VentaMostradorRespuesta = z.infer<typeof ventaMostradorRespuestaSchema>;
export type EventoTurnoCambio = z.infer<typeof eventoTurnoCambioSchema>;
