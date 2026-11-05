import type { CortesiaRespuesta, DescuentoRespuesta } from '@restaurante/contratos';
import type { AfectacionIgv } from '@restaurante/dominio';
import {
  calcularCuenta,
  validarDescuento,
  type CuentaEntrada,
  type DescuentoEntrada as DescuentoDeCuenta,
  type LineaDeCuentaEntrada,
} from '@restaurante/dominio/caja';
import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * La cuenta de una orden tal como la guarda pedidos (historia 006, criterios 36 a 46 y 45a): los ítems vigentes con
 * sus descuentos y cortesías vigentes. Pedidos es dueño de `item`, `descuento` y `cortesia`; nadie más las lee. Las
 * funciones de aquí corren en la transacción de la petición (la conexión de la API) y no escriben nada.
 *
 * Los montos de los descuentos que pedidos necesita (el `monto` de cada uno, la base de un descuento nuevo, la
 * comprobación del criterio 45a) no dependen del IGV ni del ICBPER: se calculan con `calcularCuenta` con parámetros
 * neutros (sin tasa y sin bolsas), sin leer lo que es de plataforma.
 */

/** Un ítem con cantidad vigente (la enviada menos la anulada). */
export interface ItemDeCuenta {
  id: string;
  nombre: string;
  modificadores: string[];
  precioUnitario: string;
  /** Cantidad vigente. */
  cantidad: number;
  cantidadFacturada: number;
  afectacion: AfectacionIgv;
  aplicaIcbper: boolean;
}

export interface DescuentoGuardado {
  id: string;
  /** `null`: el descuento de toda la cuenta. */
  itemId: string | null;
  tipo: 'PORCENTAJE' | 'MONTO';
  valor: string;
  motivo: string;
  autorizadoPorId: string | null;
  creadoEn: Date;
  creadoPorId: string | null;
}

export interface CortesiaGuardada {
  id: string;
  itemId: string;
  cantidad: number;
  motivo: string;
  autorizadoPorId: string | null;
  creadoEn: Date;
  creadoPorId: string | null;
}

/** Lo que pedidos guarda de la cuenta de una orden. */
export interface DatosDeCuenta {
  /** Los ítems con cantidad vigente, en el orden en que se enviaron. */
  items: ItemDeCuenta[];
  /** Los descuentos vigentes de ítems que siguen en la cuenta. */
  descuentosDeItem: DescuentoGuardado[];
  descuentoCuenta: DescuentoGuardado | null;
  /** Las cortesías vigentes de ítems que siguen en la cuenta. */
  cortesias: CortesiaGuardada[];
}

interface FilaItem {
  orden_id: string;
  id: string;
  nombre: string;
  linea: { modificadores?: { nombre: string }[] };
  precio_unitario: string;
  cantidad: number;
  cantidad_anulada: number;
  cantidad_facturada: number;
  afectacion_igv: AfectacionIgv;
  aplica_icbper: boolean;
}

interface FilaDescuento {
  orden_id: string;
  id: string;
  item_id: string | null;
  tipo: 'PORCENTAJE' | 'MONTO';
  valor: string;
  motivo: string;
  autorizado_por_id: string | null;
  creado_en: Date;
  creado_por_usuario_id: string | null;
}

interface FilaCortesia {
  orden_id: string;
  id: string;
  item_id: string;
  cantidad: number;
  motivo: string;
  autorizado_por_id: string | null;
  creado_en: Date;
  creado_por_usuario_id: string | null;
}

/** La cuenta de una orden: sus ítems vigentes, descuentos y cortesías vigentes. */
export async function leerDatosDeCuenta(
  conexion: Sequelize,
  ordenId: string,
): Promise<DatosDeCuenta> {
  const datos = await leerDatosDeCuentas(conexion, [ordenId]);
  return (
    datos.get(ordenId) ?? { items: [], descuentosDeItem: [], descuentoCuenta: null, cortesias: [] }
  );
}

/** Las cuentas de varias órdenes con tres consultas, sin importar cuántas órdenes sean. */
export async function leerDatosDeCuentas(
  conexion: Sequelize,
  ordenIds: readonly string[],
): Promise<Map<string, DatosDeCuenta>> {
  const items = await conexion.query<FilaItem>(
    `SELECT i.orden_id, i.id, i.nombre, i.linea, i.precio_unitario::text AS precio_unitario, i.cantidad,
            i.cantidad_anulada, i.cantidad_facturada, i.afectacion_igv, i.aplica_icbper
       FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
      WHERE i.orden_id = ANY($1::uuid[]) AND i.cantidad > i.cantidad_anulada
      ORDER BY e.numero, i.posicion, i.id`,
    { bind: [ordenIds], type: QueryTypes.SELECT },
  );
  const descuentos = await conexion.query<FilaDescuento>(
    `SELECT coalesce(i.orden_id, d.orden_id) AS orden_id, d.id, d.item_id, d.tipo, d.valor::text AS valor,
            d.motivo, d.autorizado_por_id, d.creado_en, d.creado_por_usuario_id
       FROM descuento d LEFT JOIN item i ON i.id = d.item_id AND i.empresa_id = d.empresa_id
      WHERE d.quitado_en IS NULL
        AND ((d.item_id IS NULL AND d.orden_id = ANY($1::uuid[])) OR i.orden_id = ANY($1::uuid[]))
      ORDER BY d.creado_en, d.id`,
    { bind: [ordenIds], type: QueryTypes.SELECT },
  );
  const cortesias = await conexion.query<FilaCortesia>(
    `SELECT i.orden_id, c.id, c.item_id, c.cantidad, c.motivo, c.autorizado_por_id, c.creado_en,
            c.creado_por_usuario_id
       FROM cortesia c JOIN item i ON i.id = c.item_id AND i.empresa_id = c.empresa_id
      WHERE c.quitada_en IS NULL AND i.orden_id = ANY($1::uuid[])
      ORDER BY c.creado_en, c.id`,
    { bind: [ordenIds], type: QueryTypes.SELECT },
  );

  const vigentes = new Set(items.map((i) => i.id));
  const aDescuento = (d: FilaDescuento): DescuentoGuardado => ({
    id: d.id,
    itemId: d.item_id,
    tipo: d.tipo,
    valor: d.valor,
    motivo: d.motivo,
    autorizadoPorId: d.autorizado_por_id,
    creadoEn: new Date(d.creado_en),
    creadoPorId: d.creado_por_usuario_id,
  });
  return new Map(
    ordenIds.map((ordenId): [string, DatosDeCuenta] => [
      ordenId,
      {
        items: items
          .filter((i) => i.orden_id === ordenId)
          .map((i) => ({
            id: i.id,
            nombre: i.nombre,
            modificadores: (i.linea.modificadores ?? []).map((m) => m.nombre),
            precioUnitario: i.precio_unitario,
            cantidad: i.cantidad - i.cantidad_anulada,
            cantidadFacturada: i.cantidad_facturada,
            afectacion: i.afectacion_igv,
            aplicaIcbper: i.aplica_icbper,
          })),
        // Un descuento o una cortesía de un ítem anulado del todo queda guardado pero ya no cuenta.
        descuentosDeItem: descuentos
          .filter((d) => d.orden_id === ordenId && d.item_id !== null && vigentes.has(d.item_id))
          .map(aDescuento),
        descuentoCuenta:
          descuentos
            .filter((d) => d.orden_id === ordenId && d.item_id === null)
            .map(aDescuento)[0] ?? null,
        cortesias: cortesias
          .filter((c) => c.orden_id === ordenId && vigentes.has(c.item_id))
          .map((c) => ({
            id: c.id,
            itemId: c.item_id,
            cantidad: c.cantidad,
            motivo: c.motivo,
            autorizadoPorId: c.autorizado_por_id,
            creadoEn: new Date(c.creado_en),
            creadoPorId: c.creado_por_usuario_id,
          })),
      },
    ]),
  );
}

/** Parámetros neutros: los descuentos no dependen del IGV ni del ICBPER. */
const NEUTROS = { tasaIgv: null, montoIcbper: '0.00' } as const;

const comoDescuento = (d: DescuentoGuardado | null): DescuentoDeCuenta | null =>
  d === null ? null : { tipo: d.tipo, valor: d.valor };

/**
 * La entrada de `calcularCuenta` de la cuenta. Sin `parametros` usa los neutros (solo sirve para los montos de los
 * descuentos). Las cortesías se acotan a la cantidad vigente: quien anula las comprueba antes de escribir.
 */
export function cuentaDeDatos(
  datos: DatosDeCuenta,
  parametros: { tasaIgv: string | null; montoIcbper: string } = NEUTROS,
): CuentaEntrada {
  const lineas: LineaDeCuentaEntrada[] = datos.items.map((i) => {
    const cortesia = datos.cortesias.find((c) => c.itemId === i.id)?.cantidad ?? 0;
    return {
      itemId: i.id,
      precioUnitario: i.precioUnitario,
      cantidad: i.cantidad,
      cantidadCortesia: Math.min(cortesia, i.cantidad),
      afectacion: i.afectacion,
      aplicaIcbper: i.aplicaIcbper,
      descuento: comoDescuento(datos.descuentosDeItem.find((d) => d.itemId === i.id) ?? null),
    };
  });
  return {
    lineas,
    descuentoCuenta: comoDescuento(datos.descuentoCuenta),
    tasaIgv: parametros.tasaIgv,
    montoIcbper: parametros.montoIcbper,
  };
}

// ---------------------------------------------------------------------------------------------------
// Montos en céntimos (enteros: sin coma flotante)
// ---------------------------------------------------------------------------------------------------

const centimos = (monto: string): bigint => BigInt(monto.replace('.', ''));
const comoMonto = (c: bigint): string => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

/** La suma de montos no negativos con 2 decimales. */
export function sumarMontos(montos: readonly string[]): string {
  return comoMonto(montos.reduce((suma, m) => suma + centimos(m), 0n));
}

/** `monto × cantidad`, con 2 decimales. */
export function multiplicarMonto(monto: string, cantidad: number): string {
  return comoMonto(centimos(monto) * BigInt(cantidad));
}

// ---------------------------------------------------------------------------------------------------
// Bases y montos de los descuentos
// ---------------------------------------------------------------------------------------------------

/** Lo que descuenta cada descuento vigente en soles, según la cuenta (criterio 36). */
export interface MontosDeDescuentos {
  porItem: Map<string, string>;
  cuenta: string;
}

/**
 * El monto en soles de cada descuento (el de cada ítem y lo repartido del de la cuenta). Debe llamarse con una cuenta
 * que `descuentoQueNoSeAdmite` ya aceptó: si no, `calcularCuenta` lanza `RangeError`.
 */
export function montosDeDescuentos(cuenta: CuentaEntrada): MontosDeDescuentos {
  const calculada = calcularCuenta({ ...cuenta, ...NEUTROS });
  return {
    porItem: new Map(
      calculada.lineas
        .filter((_, i) => cuenta.lineas[i]!.descuento !== null)
        .map((l) => [l.itemId, l.descuentoItem]),
    ),
    cuenta: sumarMontos(calculada.lineas.map((l) => l.descuentoCuenta)),
  };
}

/** La base de un descuento por ítem: el bruto de la línea sin sus unidades en cortesía (criterio 14). */
export function baseDeItem(item: ItemDeCuenta, cantidadCortesia: number): string {
  return multiplicarMonto(item.precioUnitario, item.cantidad - cantidadCortesia);
}

/**
 * La base de un descuento por cuenta: Σ(bruto − descuentoItem) de las líneas (criterio 14), con los descuentos de
 * ítem que tiene la cuenta.
 */
export function baseDeCuenta(cuenta: CuentaEntrada): string {
  return calcularCuenta({ ...cuenta, ...NEUTROS, descuentoCuenta: null }).totales.total;
}

/**
 * Criterio 45a (decisión del usuario del 2026-11-04): ¿la cuenta deja algún descuento por `MONTO`, de ítem o de la
 * cuenta, mayor o igual que su base? Un porcentaje se recalcula sobre la base nueva y nunca llega a la base. Devuelve
 * `true` si la cuenta no se admite; quien la arma rechaza el cambio con 422 `DESCUENTO_INVALIDO`, sin escribir nada, y
 * el descuento nunca se recorta ni se quita solo.
 */
export function descuentoQueNoSeAdmite(cuenta: CuentaEntrada): boolean {
  const sinDescuentos = calcularCuenta({
    ...cuenta,
    ...NEUTROS,
    lineas: cuenta.lineas.map((l) => ({ ...l, descuento: null })),
    descuentoCuenta: null,
  });
  const excedido = cuenta.lineas.some((linea, i) => {
    if (linea.descuento === null || linea.descuento.tipo !== 'MONTO') return false;
    return !validarDescuento(sinDescuentos.lineas[i]!.bruto, linea.descuento).valido;
  });
  if (excedido) return true;
  const descuentoCuenta = cuenta.descuentoCuenta;
  if (descuentoCuenta === null || descuentoCuenta.tipo !== 'MONTO') return false;
  return !validarDescuento(baseDeCuenta(cuenta), descuentoCuenta).valido;
}

// ---------------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------------

/** Los ids de las personas que nombran los descuentos y las cortesías de la cuenta. */
export function personasDeCuenta(datos: DatosDeCuenta): string[] {
  const ids = [
    ...datos.descuentosDeItem,
    ...(datos.descuentoCuenta === null ? [] : [datos.descuentoCuenta]),
    ...datos.cortesias,
  ].flatMap((x) => [x.autorizadoPorId, x.creadoPorId]);
  return ids.filter((id): id is string => id !== null);
}

export type NombresDePersonas = ReadonlyMap<string, string>;

const persona = (id: string | null, nombres: NombresDePersonas) =>
  id === null ? null : { id, nombre: nombres.get(id) ?? '' };

export function descuentoRespuesta(
  d: DescuentoGuardado,
  monto: string,
  nombres: NombresDePersonas,
): DescuentoRespuesta {
  return {
    id: d.id,
    itemId: d.itemId,
    tipo: d.tipo,
    valor: d.valor,
    monto,
    motivo: d.motivo,
    autorizadoPor: persona(d.autorizadoPorId, nombres),
    creadoEn: d.creadoEn.toISOString(),
    creadoPor: persona(d.creadoPorId, nombres),
  };
}

export function cortesiaRespuesta(
  c: CortesiaGuardada,
  item: ItemDeCuenta,
  nombres: NombresDePersonas,
): CortesiaRespuesta {
  return {
    id: c.id,
    itemId: c.itemId,
    cantidad: c.cantidad,
    valorReferencial: multiplicarMonto(item.precioUnitario, c.cantidad),
    motivo: c.motivo,
    autorizadoPor: persona(c.autorizadoPorId, nombres),
    creadoEn: c.creadoEn.toISOString(),
    creadoPor: persona(c.creadoPorId, nombres),
  };
}

/** Los descuentos y las cortesías de la cuenta listos para la respuesta, con sus montos. */
export function respuestasDeCuenta(
  datos: DatosDeCuenta,
  nombres: NombresDePersonas,
): {
  descuentoDeItem: Map<string, DescuentoRespuesta>;
  descuentoCuenta: DescuentoRespuesta | null;
  cortesias: CortesiaRespuesta[];
} {
  const montos = montosDeDescuentos(cuentaDeDatos(datos));
  const descuentoDeItem = new Map<string, DescuentoRespuesta>();
  for (const d of datos.descuentosDeItem) {
    descuentoDeItem.set(
      d.itemId!,
      descuentoRespuesta(d, montos.porItem.get(d.itemId!) ?? '0.00', nombres),
    );
  }
  return {
    descuentoDeItem,
    descuentoCuenta:
      datos.descuentoCuenta === null
        ? null
        : descuentoRespuesta(datos.descuentoCuenta, montos.cuenta, nombres),
    cortesias: datos.cortesias.map((c) =>
      cortesiaRespuesta(
        c,
        datos.items.find((i) => i.id === c.itemId)!,
        nombres,
      ),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Cambios que reducen la cuenta (criterio 45a)
// ---------------------------------------------------------------------------------------------------

/** Lo que impide anular unidades de un ítem sin tocar un descuento o una cortesía. */
export type ProblemaDeAnulacion = 'DESCUENTO_NO_ADMITIDO' | 'CORTESIA_SUPERA_LA_CANTIDAD';

/**
 * La cuenta tal como quedaría al anular `cantidad` unidades del ítem, y si así se admite (criterio 45a, decisión del
 * usuario del 2026-11-04). Ni el descuento ni la cortesía se recortan, se quitan o se mueven solos: si una cortesía
 * quedaría con más unidades que las vigentes, o un descuento por `MONTO` de ítem o de cuenta quedaría mayor o igual
 * que su base, el cambio no se admite. Un porcentaje se recalcula sobre la base nueva. Un ítem anulado del todo sale de
 * la cuenta con su descuento y su cortesía. Devuelve `null` si se admite.
 */
export function problemaAlAnular(
  datos: DatosDeCuenta,
  itemId: string,
  cantidad: number,
): ProblemaDeAnulacion | null {
  const item = datos.items.find((i) => i.id === itemId);
  if (item === undefined) return null;
  const quedan = item.cantidad - cantidad;
  const cortesia = datos.cortesias.find((c) => c.itemId === itemId);
  if (quedan > 0 && cortesia !== undefined && cortesia.cantidad > quedan) {
    return 'CORTESIA_SUPERA_LA_CANTIDAD';
  }
  const despues: DatosDeCuenta = {
    items:
      quedan === 0
        ? datos.items.filter((i) => i.id !== itemId)
        : datos.items.map((i) => (i.id === itemId ? { ...i, cantidad: quedan } : i)),
    descuentosDeItem:
      quedan === 0
        ? datos.descuentosDeItem.filter((d) => d.itemId !== itemId)
        : datos.descuentosDeItem,
    descuentoCuenta: datos.descuentoCuenta,
    cortesias: quedan === 0 ? datos.cortesias.filter((c) => c.itemId !== itemId) : datos.cortesias,
  };
  return descuentoQueNoSeAdmite(cuentaDeDatos(despues)) ? 'DESCUENTO_NO_ADMITIDO' : null;
}
