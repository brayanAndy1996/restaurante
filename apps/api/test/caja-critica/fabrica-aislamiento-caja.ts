// spec: 006-caja-cobro (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P6 (aislamiento entre empresas) de la historia 006, entrega 6a: la lista de las
// trece tablas nuevas con los privilegios de `restaurante_api` de "Permisos" de `spec.md` y la siembra por SQL (como
// `restaurante_api` con el contexto y el actor fijados) de una fila como mínimo en cada una. Los nombres de tabla y de
// columna salen de "Cambios al modelo de datos". Solo usan contratos públicos: no leen la implementación.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { enTransaccion } from '../aislamiento/fabrica';
import { impresoraCreada } from '../impresion/ayudas-impresion';
import { sembrarFilasSalon, type BaseSql, type FilasSalon } from '../salon-critica/fabrica-p4';
import type { AppP5 } from '../impresion-critica/fabrica-p5';

export const TABLAS_CAJA = [
  'caja',
  'turno',
  'turno_conteo',
  'movimiento_caja',
  'cobro',
  'pago',
  'serie',
  'comprobante',
  'comprobante_linea',
  'emisor_tasa_igv',
  'descuento',
  'cortesia',
  'contador_llamado',
] as const;
export type TablaCaja = (typeof TABLAS_CAJA)[number];

export type Privilegio = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** Los privilegios de `restaurante_api` según la tabla "Permisos" de `spec.md` (ninguna tiene DELETE). */
export const PRIVILEGIOS_CAJA: Record<TablaCaja, Privilegio[]> = {
  caja: ['SELECT', 'INSERT', 'UPDATE'],
  turno: ['SELECT', 'INSERT', 'UPDATE'],
  turno_conteo: ['SELECT', 'INSERT'],
  movimiento_caja: ['SELECT', 'INSERT'],
  cobro: ['SELECT', 'INSERT'],
  pago: ['SELECT', 'INSERT'],
  serie: ['SELECT', 'INSERT', 'UPDATE'],
  // UPDATE solo sobre `estado` y `actualizado_*` (privilegio por columna).
  comprobante: ['SELECT', 'INSERT', 'UPDATE'],
  comprobante_linea: ['SELECT', 'INSERT'],
  emisor_tasa_igv: ['SELECT', 'INSERT', 'UPDATE'],
  descuento: ['SELECT', 'INSERT', 'UPDATE'],
  cortesia: ['SELECT', 'INSERT', 'UPDATE'],
  contador_llamado: ['SELECT', 'INSERT', 'UPDATE'],
};

const HUELLA = "decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')";

/** Lo que la siembra necesita de una empresa dada de alta por la API (y su carta sembrada por las rutas de 003). */
export interface BaseCaja extends BaseSql {
  emisorId: string;
  impresoraId: string;
}

/** Una impresora por la API de 3b (host y puerto fijos: no se imprime nada). */
export async function impresoraDeSiembra(
  ctx: AppP5,
  token: string,
  sucursalId: string,
): Promise<string> {
  return (await impresoraCreada(ctx, token, sucursalId)).id;
}

export interface FilasCaja extends FilasSalon {
  caja: string;
  cajaCerrada: string;
  turno: string;
  turnoCerrado: string;
  conteo: string;
  movimiento: string;
  serie: string;
  comprobante: string;
  comprobante2: string;
  linea: string;
  cobro: string;
  pago: string;
  tasa: string;
  descuento: string;
  cortesia: string;
  contador: string;
}

/**
 * Siembra, con el contexto y el actor de la empresa, una fila como mínimo en cada una de las trece tablas nuevas (y las
 * de 3a de las que dependen): dos cajas, un turno abierto y uno cerrado, el conteo, un movimiento, una serie, dos
 * comprobantes (el primero con su línea, su cobro y su pago), la tasa, un descuento, una cortesía y el contador.
 */
export async function sembrarFilasCaja(apiCliente: Client, base: BaseCaja): Promise<FilasCaja> {
  const salon = await sembrarFilasSalon(apiCliente, base);
  const f: FilasCaja = {
    ...salon,
    caja: randomUUID(),
    cajaCerrada: randomUUID(),
    turno: randomUUID(),
    turnoCerrado: randomUUID(),
    conteo: randomUUID(),
    movimiento: randomUUID(),
    serie: randomUUID(),
    comprobante: randomUUID(),
    comprobante2: randomUUID(),
    linea: randomUUID(),
    cobro: randomUUID(),
    pago: randomUUID(),
    tasa: randomUUID(),
    descuento: randomUUID(),
    cortesia: randomUUID(),
    contador: randomUUID(),
  };
  const E = base.empresaId;
  const q = (sql: string, parametros: unknown[]) => apiCliente.query(sql, parametros);
  const comprobante = (id: string, numero: number, cobroId: string) =>
    q(
      `INSERT INTO comprobante (id, empresa_id, sucursal_id, emisor_id, caja_id, turno_id, turno_responsable_id, cobro_id,
                                serie_id, tipo, serie, numero, formato, fecha_emision, emitido_en, dia_operativo, emisor,
                                sucursal, moneda, tasa_igv, subtotal, descuentos, op_gravadas, op_exoneradas, op_inafectas,
                                op_gratuitas, igv, igv_gratuitas, icbper, total, monto_en_letras, orden_id, numero_parte,
                                detalle_parte, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BOLETA', 'B001', $10, 'DETALLADO', '2026-11-02', now(), '2026-11-02',
               '{"ruc":"20100070970","razonSocial":"Prueba SAC","regimen":"GENERAL"}'::jsonb,
               '{"nombre":"Sede","direccion":"Av. Prueba 1","codigoEstablecimiento":"0001"}'::jsonb,
               'PEN', '18.00', '50.00', '0.00', '42.37', '0.00', '0.00', '0.00', '7.63', '0.00', '0.00', '50.00',
               'CINCUENTA CON 00/100 SOLES', $11, $12, '{}'::jsonb, 'POR_ENVIAR', now(), now())`,
      [
        id,
        E,
        base.sucursal1,
        base.emisorId,
        f.caja,
        f.turno,
        base.usuarioId,
        cobroId,
        f.serie,
        numero,
        salon.orden,
        numero,
      ],
    );
  await enTransaccion(
    apiCliente,
    E,
    async () => {
      for (const [id, nombre] of [
        [f.caja, `Caja ${randomUUID().slice(0, 8)}`],
        [f.cajaCerrada, `Caja ${randomUUID().slice(0, 8)}`],
      ] as const) {
        await q(
          `INSERT INTO caja (id, empresa_id, sucursal_id, nombre, impresora_id, activa, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, true, now(), now())`,
          [id, E, base.sucursal1, nombre, base.impresoraId],
        );
      }
      await q(
        `INSERT INTO turno (id, empresa_id, caja_id, sucursal_id, responsable_id, estado, abierto_en, dia_operativo, fondo,
                            cerrado_en, cerrado_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'ABIERTO', now(), '2026-11-02', '200.00', NULL, NULL, ${HUELLA}, now(), now())`,
        [f.turno, E, f.caja, base.sucursal1, base.usuarioId],
      );
      await q(
        `INSERT INTO turno (id, empresa_id, caja_id, sucursal_id, responsable_id, estado, abierto_en, dia_operativo, fondo,
                            cerrado_en, cerrado_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'CERRADO', now(), '2026-11-01', '100.00', now(), $5, ${HUELLA}, now(), now())`,
        [f.turnoCerrado, E, f.cajaCerrada, base.sucursal1, base.usuarioId],
      );
      await q(
        `INSERT INTO turno_conteo (id, empresa_id, turno_id, medio, esperado, contado, diferencia, motivo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'EFECTIVO', '100.00', '100.00', '0.00', NULL, now(), now())`,
        [f.conteo, E, f.turnoCerrado],
      );
      await q(
        `INSERT INTO movimiento_caja (id, empresa_id, turno_id, tipo, medio, monto, motivo, comprobante_id, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'INGRESO', 'EFECTIVO', '20.00', 'Cambio de billetes', NULL, now(), now())`,
        [f.movimiento, E, f.turno],
      );
      await q(
        `INSERT INTO serie (id, empresa_id, caja_id, emisor_id, tipo, serie, ultimo_numero, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'BOLETA', 'B001', 2, true, now(), now())`,
        [f.serie, E, f.caja, base.emisorId],
      );
      await comprobante(f.comprobante, 1, f.cobro);
      await comprobante(f.comprobante2, 2, randomUUID());
      await q(
        `INSERT INTO comprobante_linea (id, empresa_id, comprobante_id, posicion, item_id, descripcion, cantidad, unidad,
                                        precio_unitario, valor_unitario, bruto, descuento, neto, base, igv, bolsas, icbper,
                                        afectacion, gratuita, valor_referencial, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, NULL, 'Lomo saltado', 2, 'NIU', '25.00', '21.1864406780', '50.00', '0.00', '50.00',
                 '42.37', '7.63', 0, '0.00', 'GRAVADO', false, NULL, now(), now())`,
        [f.linea, E, f.comprobante],
      );
      await q(
        `INSERT INTO cobro (id, empresa_id, orden_id, turno_id, comprobante_id, modo, parte, total, redondeo, vuelto,
                            huella_entrada, respuesta, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'TOTAL', '{"tipo":"TOTAL"}'::jsonb, '50.00', '0.00', '0.00', ${HUELLA}, '{}'::jsonb, now(), now())`,
        [f.cobro, E, salon.orden, f.turno, f.comprobante],
      );
      await q(
        `INSERT INTO pago (id, empresa_id, cobro_id, turno_id, medio, monto, recibido, operacion, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'EFECTIVO', '50.00', '50.00', NULL, now(), now())`,
        [f.pago, E, f.cobro, f.turno],
      );
      await q(
        `INSERT INTO emisor_tasa_igv (id, empresa_id, emisor_id, desde, tasa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, '2026-01-01', '18.00', now(), now())`,
        [f.tasa, E, base.emisorId],
      );
      await q(
        `INSERT INTO descuento (id, empresa_id, orden_id, item_id, tipo, valor, motivo, autorizado_por_id, autorizacion_id,
                                quitado_en, quitado_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'PORCENTAJE', '10.00', 'Cliente frecuente', NULL, NULL, NULL, NULL, ${HUELLA}, now(), now())`,
        [f.descuento, E, salon.orden, salon.item],
      );
      await q(
        `INSERT INTO cortesia (id, empresa_id, orden_id, item_id, cantidad, motivo, autorizado_por_id, autorizacion_id,
                               quitada_en, quitada_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 1, 'Atención de la casa', NULL, NULL, now(), $5, ${HUELLA}, now(), now())`,
        [f.cortesia, E, salon.orden, salon.item, base.usuarioId],
      );
      await q(
        `INSERT INTO contador_llamado (id, empresa_id, sucursal_id, dia_operativo, ultimo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, '2026-11-02', 3, now(), now())`,
        [f.contador, E, base.sucursal1],
      );
    },
    { confirmar: true },
  );
  return f;
}
