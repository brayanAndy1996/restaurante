import {
  ALERTAS_COMPROBANTE,
  ESTADOS_COMPROBANTE,
  ESTADOS_ENVIO_PSE,
  MAXIMO_ITEMS_PARTE,
  CANTIDAD_MAXIMA_LINEA,
  MODOS_PSE,
  OPERACIONES_INTENTO_PSE,
  RESULTADOS_ENVIO_PSE,
  TIPOS_NOTA_CREDITO,
  validarRuc,
} from '@restaurante/dominio';
import { z } from 'zod';
import { medioPagoSchema, montoDeCobroPositivoSchema, montoDeCobroSchema } from './caja';
import {
  clienteComprobanteEntradaSchema,
  comprobanteRespuestaSchema,
  estadoComprobanteSchema,
  tipoDocumentoElectronicoSchema,
} from './comprobantes';
import {
  fechaSchema,
  montoNoNegativoSchema,
  motivoSchema,
  textoSchema,
  uuidSchema,
} from './comunes';

/**
 * Contratos de la facturación electrónica (historia 006, entrega 6b): envío al PSE, panel y alertas, reemisión, notas
 * de crédito, padrón de RUC y configuración del PSE por emisor. Las entradas son estrictas (un campo desconocido es
 * 400) y ninguna acepta `empresaId`, `creadoPor*` ni `actualizadoPor*`. Los montos viajan como texto decimal con 2
 * decimales; ningún esquema de respuesta tiene un campo para la credencial del PSE (criterio 123).
 *
 * Nombres: `envioPseRespuestaSchema` e `intentoPseRespuestaSchema` son el `envioRespuesta` y el `intentoRespuesta` de
 * `spec.md`; el prefijo evita chocar con `envioRespuestaSchema` de `salon.ts` (el envío de comandas de 004).
 */

const instanteSchema = z.iso.datetime();

export { tipoDocumentoElectronicoSchema };
export const estadoEnvioPseSchema = z.enum(ESTADOS_ENVIO_PSE);
export const modoPseSchema = z.enum(MODOS_PSE);
export const tipoNotaCreditoSchema = z.enum(TIPOS_NOTA_CREDITO);
export const resultadoEnvioPseSchema = z.enum(RESULTADOS_ENVIO_PSE);
export const alertaComprobanteSchema = z.enum(ALERTAS_COMPROBANTE);

// ---------------------------------------------------------------------------------------------------
// Envío al PSE (criterios 124 a 133)
// ---------------------------------------------------------------------------------------------------

/** El estado del envío de un comprobante (criterios 124 y 132). */
export const envioPseRespuestaSchema = z.object({
  estado: estadoEnvioPseSchema,
  intentos: z.number().int().min(0),
  proximoIntentoEn: instanteSchema.nullable(),
  plazoHasta: instanteSchema,
  ultimoResultado: resultadoEnvioPseSchema.nullable(),
  ultimoError: z.string().nullable(),
});

/** Un intento contra el PSE (criterio 135): nunca el documento enviado, la respuesta completa ni la credencial. */
export const intentoPseRespuestaSchema = z.object({
  numero: z.number().int().min(1),
  operacion: z.enum(OPERACIONES_INTENTO_PSE),
  iniciadoEn: instanteSchema,
  terminadoEn: instanteSchema,
  resultado: z.enum([...RESULTADOS_ENVIO_PSE, 'NO_EXISTE']),
  codigo: z.string().nullable(),
  mensaje: z.string().nullable(),
});

/** `GET /facturacion/comprobantes/:id` (criterio 135): el comprobante con su envío y hasta 50 intentos, del más nuevo. */
export const comprobanteDetalleSchema = comprobanteRespuestaSchema.extend({
  envio: envioPseRespuestaSchema.nullable(),
  intentos: z.array(intentoPseRespuestaSchema).max(50),
});

// ---------------------------------------------------------------------------------------------------
// Panel y alertas (criterios 133 y 135)
// ---------------------------------------------------------------------------------------------------

/**
 * `GET /facturacion/comprobantes` (criterio 135). `estado` acepta uno o varios (repetido o separado por comas);
 * `desde` y `hasta` son fechas de emisión `AAAA-MM-DD` (el servidor limita el rango a 93 días y usa los últimos 7 por
 * defecto); `alerta=true` deja los que tienen alerta; `texto` es el número (`B001-00000124` o `B001-124`) o el
 * documento exacto del cliente; `sucursalId` solo lo usa el Administrador; `cursor` es opaco.
 */
export const panelConsultaSchema = z.strictObject({
  estado: z
    .preprocess(
      (valor) => (typeof valor === 'string' ? valor.split(',') : valor),
      z.array(estadoComprobanteSchema).min(1).max(ESTADOS_COMPROBANTE.length),
    )
    .optional(),
  tipo: tipoDocumentoElectronicoSchema.optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  alerta: z
    .enum(['true', 'false'])
    .transform((valor) => valor === 'true')
    .optional(),
  texto: textoSchema(50).optional(),
  sucursalId: uuidSchema.optional(),
  cursor: z.string().min(1).max(300).optional(),
});

export const panelItemSchema = z.object({
  id: uuidSchema,
  tipo: tipoDocumentoElectronicoSchema,
  numero: z.string(),
  estado: estadoComprobanteSchema,
  simulado: z.boolean(),
  total: z.string(),
  fechaEmision: z.string(),
  emitidoEn: instanteSchema,
  /** El nombre del cliente; `null` sin cliente. */
  cliente: z.string().nullable(),
  sucursal: z.object({ id: uuidSchema, nombre: z.string() }),
  alerta: alertaComprobanteSchema.nullable(),
  /** `null` en un comprobante emitido antes de 6b (no tiene envío). */
  envio: envioPseRespuestaSchema.nullable(),
  sunat: z.object({ codigo: z.string().nullable(), mensaje: z.string().nullable() }).nullable(),
  afectaA: z.object({ id: uuidSchema, numero: z.string() }).nullable(),
  reemplazaA: z.object({ id: uuidSchema, numero: z.string() }).nullable(),
  reemplazadoPor: z.object({ id: uuidSchema, numero: z.string() }).nullable(),
});

export const panelComprobantesSchema = z.object({
  /** Los conteos usan los mismos filtros salvo el estado. */
  conteos: z.object({
    POR_ENVIAR: z.number().int().min(0),
    ENVIADO: z.number().int().min(0),
    ACEPTADO: z.number().int().min(0),
    RECHAZADO: z.number().int().min(0),
    ANULADO: z.number().int().min(0),
  }),
  items: z.array(panelItemSchema).max(50),
  /** El cursor de la página siguiente; `null` en la última. */
  siguiente: z.string().nullable(),
});

/** `GET /facturacion/alertas` (criterio 133). `sucursalId` solo lo usa el Administrador. */
export const alertasConsultaSchema = z.strictObject({ sucursalId: uuidSchema.optional() });

export const alertasRespuestaSchema = z.object({
  rechazados: z.number().int().min(0),
  demorados: z.number().int().min(0),
  detenidos: z.number().int().min(0),
  sinConfiguracion: z.number().int().min(0),
  /** Algún emisor de la sucursal está en `SIMULADO` (criterio 122). */
  modoSimulado: z.boolean(),
});

/** `GET /plataforma/facturacion/alertas` (criterio 133, pregunta 37). */
export const alertasPlataformaRespuestaSchema = z.array(
  z.object({
    empresaId: uuidSchema,
    empresa: z.string(),
    rechazados: z.number().int().min(0),
    demorados: z.number().int().min(0),
    detenidos: z.number().int().min(0),
    sinConfiguracion: z.number().int().min(0),
  }),
);

// ---------------------------------------------------------------------------------------------------
// Reemisión ("Emitir otro", criterio 134)
// ---------------------------------------------------------------------------------------------------

/**
 * `POST /facturacion/comprobantes/:id/reemision`: `tipo` boleta o factura (o, en una nota de crédito rechazada, el
 * mismo tipo de nota, sin `cliente`); las reglas del cliente (criterio 51) las aplica el servicio.
 */
export const reemisionEntradaSchema = z
  .strictObject({
    tipo: tipoDocumentoElectronicoSchema,
    cliente: clienteComprobanteEntradaSchema.optional(),
  })
  .superRefine((entrada, ctx) => {
    if (entrada.cliente !== undefined && entrada.tipo.startsWith('NOTA_CREDITO')) {
      ctx.addIssue({
        code: 'custom',
        path: ['cliente'],
        message: 'Una nota de crédito conserva el cliente del documento que modifica',
      });
    }
  });

const impresionDeDocumentoSchema = z.enum(['EN_COLA', 'SIN_IMPRESORA']);

export const reemisionRespuestaSchema = z.object({
  comprobante: comprobanteRespuestaSchema,
  impresion: impresionDeDocumentoSchema,
  trabajoId: uuidSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Notas de crédito (criterios 143 a 157)
// ---------------------------------------------------------------------------------------------------

/**
 * Un pago de lo que se devuelve (criterio 150): `operacion` obligatoria fuera del efectivo y prohibida en el efectivo
 * (400 con `campos`); no hay `recibido` ni vuelto. Que Σ `monto` + `redondeo` sea el total de la nota lo valida el
 * servicio con `validarPagos` (422 `DEVOLUCION_INVALIDA`).
 */
export const pagoDevolucionEntradaSchema = z
  .strictObject({
    medio: medioPagoSchema,
    monto: montoDeCobroPositivoSchema,
    operacion: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,30}$/, 'Solo letras, números y guiones, de 1 a 30 caracteres')
      .optional(),
  })
  .superRefine((pago, ctx) => {
    if (pago.medio === 'EFECTIVO' && pago.operacion !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['operacion'],
        message: 'El efectivo no lleva número de operación',
      });
    }
    if (pago.medio !== 'EFECTIVO' && pago.operacion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['operacion'],
        message: 'Escribe el número de operación o de voucher',
      });
    }
  });

export const devolucionEntradaSchema = z.strictObject({
  turnoId: uuidSchema,
  pagos: z.array(pagoDevolucionEntradaSchema).min(1).max(5),
  redondeo: montoNoNegativoSchema,
});

/** Una línea del comprobante original que se devuelve: su `posicion` y las unidades (criterio 144). */
export const lineaNotaEntradaSchema = z.strictObject({
  posicion: z.number().int().min(1),
  cantidad: z.number().int().min(1).max(CANTIDAD_MAXIMA_LINEA),
});

/**
 * `POST /notas-credito` (criterio 144). `id` lo genera la PWA y se conserva hasta una respuesta final; `total` es el
 * de la nota que vio la persona (el servidor recalcula; si no coincide, 409 `NOTA_CREDITO_CAMBIO`). `lineas` va solo
 * y obligatoria en `DEVOLUCION`; `devolucion` (o `null`) está prohibida en `CAMBIO_A_FACTURA`; `cliente` va solo y
 * obligatorio en `CAMBIO_A_FACTURA`. Las formas incorrectas son 400.
 */
export const notaCreditoEntradaSchema = z
  .strictObject({
    id: uuidSchema,
    comprobanteId: uuidSchema,
    tipo: tipoNotaCreditoSchema,
    motivo: motivoSchema,
    total: montoDeCobroSchema,
    lineas: z.array(lineaNotaEntradaSchema).min(1).max(MAXIMO_ITEMS_PARTE).optional(),
    devolucion: devolucionEntradaSchema.nullable().optional(),
    cliente: clienteComprobanteEntradaSchema.optional(),
  })
  .superRefine((nota, ctx) => {
    if (nota.tipo === 'DEVOLUCION' && nota.lineas === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineas'],
        message: 'Indica las líneas que se devuelven',
      });
    }
    if (nota.tipo !== 'DEVOLUCION' && nota.lineas !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineas'],
        message: 'Solo una devolución lleva líneas',
      });
    }
    if (
      nota.tipo === 'CAMBIO_A_FACTURA' &&
      nota.devolucion !== undefined &&
      nota.devolucion !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['devolucion'],
        message: 'El cambio a factura no devuelve dinero',
      });
    }
    if (nota.tipo === 'CAMBIO_A_FACTURA' && nota.cliente === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['cliente'],
        message: 'Indica el cliente de la factura',
      });
    }
    if (nota.tipo !== 'CAMBIO_A_FACTURA' && nota.cliente !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['cliente'],
        message: 'Solo el cambio a factura lleva cliente',
      });
    }
  });

export const pagoDevolucionRespuestaSchema = z.object({
  medio: medioPagoSchema,
  monto: z.string(),
  operacion: z.string().nullable(),
});

export const notaCreditoRespuestaSchema = z.object({
  id: uuidSchema,
  nota: comprobanteRespuestaSchema,
  /** La factura nueva de un cambio; `null` en los demás tipos. */
  factura: comprobanteRespuestaSchema.nullable(),
  /** Lo devuelto; `null` sin devolución (criterio 150). */
  devolucion: z
    .object({
      total: z.string(),
      redondeo: z.string(),
      pagos: z.array(pagoDevolucionRespuestaSchema),
      movimientoIds: z.array(uuidSchema),
    })
    .nullable(),
  impresion: impresionDeDocumentoSchema,
  trabajoIds: z.array(uuidSchema),
});

// ---------------------------------------------------------------------------------------------------
// Enlace público y PDF (criterios 159 y 160)
// ---------------------------------------------------------------------------------------------------

export const enlaceComprobanteRespuestaSchema = z.object({
  url: z.string(),
  expiraEn: instanteSchema,
});

// ---------------------------------------------------------------------------------------------------
// Padrón de RUC (criterios 138 a 142)
// ---------------------------------------------------------------------------------------------------

/** El `:ruc` de `GET /padron/ruc/:ruc`: 11 dígitos con dígito verificador válido (si no, 400 con `campos.ruc`). */
export const padronRucParametroSchema = z
  .string()
  .refine((ruc) => /^\d{11}$/.test(ruc) && validarRuc(ruc), {
    // El esquema es de un texto suelto: sin `path`, el error saldría con el campo vacío en lugar de `ruc`.
    path: ['ruc'],
    message: 'El RUC debe tener 11 dígitos, con prefijo y dígito verificador válidos',
  });

export const padronRucRespuestaSchema = z.object({
  ruc: z.string(),
  razonSocial: z.string(),
  direccion: z.string().nullable(),
  estado: z.string(),
  condicion: z.string(),
  /** `estado` = `ACTIVO`. */
  activo: z.boolean(),
  /** `condicion` = `HABIDO`. */
  habido: z.boolean(),
  /** La fecha de la carga del padrón. */
  padronAl: z.string(),
});

/** `GET /plataforma/padron` (criterio 138). */
export const padronEstadoRespuestaSchema = z.object({
  cargadoEn: instanteSchema.nullable(),
  filas: z.number().int().min(0).nullable(),
  fechaArchivo: z.string().nullable(),
  ultimoIntentoEn: instanteSchema.nullable(),
  ultimoError: z.string().nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Configuración del PSE por emisor (criterios 122 y 123)
// ---------------------------------------------------------------------------------------------------

/**
 * La credencial del PSE: de 1 a 5 pares `nombre: valor` (cada PSE pide algo distinto); nombres
 * `^[a-z][a-zA-Z0-9_]{0,39}$` y valores de 1 a 2000 caracteres (criterio 123).
 */
export const credencialPseEntradaSchema = z
  .record(
    z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Nombre inválido'),
    z.string().min(1).max(2000),
  )
  .refine((credencial) => {
    const cantidad = Object.keys(credencial).length;
    return cantidad >= 1 && cantidad <= 5;
  }, 'La credencial lleva de 1 a 5 campos');

/**
 * `PUT /plataforma/empresas/:empresaId/emisores/:emisorId/pse`: `credencial` `null` la borra y ausente la conserva.
 */
export const configuracionPseEntradaSchema = z.strictObject({
  modo: modoPseSchema,
  credencial: credencialPseEntradaSchema.nullable().optional(),
});

/** Nunca los valores de la credencial, solo los nombres de sus campos (criterios 122 y 123). */
export const configuracionPseRespuestaSchema = z.object({
  emisorId: uuidSchema,
  /** `null` si el emisor todavía no tiene configuración (`GET`): sus envíos esperan (criterio 122). */
  modo: modoPseSchema.nullable(),
  conector: z.string().nullable(),
  credencialConfigurada: z.boolean(),
  camposCredencial: z.array(z.string()),
  actualizadaEn: instanteSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------------
// Eventos en tiempo real (criterio 172)
// ---------------------------------------------------------------------------------------------------

export const eventoComprobanteEstadoSchema = z.object({
  empresaId: uuidSchema,
  sala: z.object({ tipo: z.literal('sucursal'), sucursalId: uuidSchema }),
  nombre: z.literal('comprobante.estado'),
  datos: z.object({
    comprobanteId: uuidSchema,
    estado: estadoComprobanteSchema,
    sucursalId: uuidSchema,
  }),
});

export const eventoFacturacionAlertaSchema = z.object({
  empresaId: uuidSchema,
  sala: z.object({ tipo: z.literal('sucursal'), sucursalId: uuidSchema }),
  nombre: z.literal('facturacion.alerta'),
  datos: z.object({ sucursalId: uuidSchema }),
});

export type EnvioPseRespuesta = z.infer<typeof envioPseRespuestaSchema>;
export type IntentoPseRespuesta = z.infer<typeof intentoPseRespuestaSchema>;
export type ComprobanteDetalle = z.infer<typeof comprobanteDetalleSchema>;
export type PanelConsulta = z.input<typeof panelConsultaSchema>;
export type PanelConsultaValidada = z.output<typeof panelConsultaSchema>;
export type PanelItem = z.infer<typeof panelItemSchema>;
export type PanelComprobantes = z.infer<typeof panelComprobantesSchema>;
export type AlertasRespuesta = z.infer<typeof alertasRespuestaSchema>;
export type AlertasPlataformaRespuesta = z.infer<typeof alertasPlataformaRespuestaSchema>;
export type ReemisionEntrada = z.input<typeof reemisionEntradaSchema>;
export type ReemisionRespuesta = z.infer<typeof reemisionRespuestaSchema>;
export type PagoDevolucionEntrada = z.input<typeof pagoDevolucionEntradaSchema>;
export type NotaCreditoEntrada = z.input<typeof notaCreditoEntradaSchema>;
export type NotaCreditoEntradaValidada = z.output<typeof notaCreditoEntradaSchema>;
export type NotaCreditoRespuesta = z.infer<typeof notaCreditoRespuestaSchema>;
export type EnlaceComprobanteRespuesta = z.infer<typeof enlaceComprobanteRespuestaSchema>;
export type PadronRucRespuesta = z.infer<typeof padronRucRespuestaSchema>;
export type PadronEstadoRespuesta = z.infer<typeof padronEstadoRespuestaSchema>;
export type ConfiguracionPseEntrada = z.input<typeof configuracionPseEntradaSchema>;
export type ConfiguracionPseRespuesta = z.infer<typeof configuracionPseRespuestaSchema>;
export type EventoComprobanteEstado = z.infer<typeof eventoComprobanteEstadoSchema>;
export type EventoFacturacionAlerta = z.infer<typeof eventoFacturacionAlertaSchema>;
