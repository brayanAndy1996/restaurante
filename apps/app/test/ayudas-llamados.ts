import type {
  LineaDeLlamado,
  LlamadoDetalle,
  LlamadoResumen,
  LlamadosRespuesta,
} from '@restaurante/contratos';
import { AHORA, uuid } from './ayudas-salon';

/** El id del llamado `n`. */
export const idDeLlamado = (n: number) => uuid(7000 + n);

const MS = 60_000;
const haceMin = (minutos: number) => new Date(Date.parse(AHORA) - minutos * MS).toISOString();

/**
 * Un llamado de la lista: por defecto un `PEDIDO` pendiente de la mesa `mesa` (su id es `uuid(100 + mesa)`,
 * como en `mesa()` de `ayudas-salon`), creado hace 3 minutos, para todos (`destinatarios: null`).
 */
export function llamadoResumen(
  n: number,
  extra: Omit<Partial<LlamadoResumen>, 'mesa'> & {
    mesa?: { n: number; nombre: string };
    minutos?: number;
  } = {},
): LlamadoResumen {
  const { mesa, minutos, ...resto } = extra;
  const creadoEn = haceMin(minutos ?? 3);
  return {
    id: idDeLlamado(n),
    tipo: 'PEDIDO',
    estado: 'PENDIENTE',
    mesa: { id: uuid(100 + (mesa?.n ?? 4)), nombre: mesa?.nombre ?? '4' },
    creadoEn,
    venceEn: new Date(Date.parse(creadoEn) + 15 * MS).toISOString(),
    unidades: 3,
    total: '56.00',
    nota: null,
    destinatarios: null,
    atendidoPor: null,
    atendidoEn: null,
    cerradoPor: null,
    cerradoEn: null,
    ordenId: null,
    ...resto,
  };
}

/** `GET /llamados`. */
export function listaDeLlamados(
  llamados: LlamadoResumen[],
  ahora: string = AHORA,
): LlamadosRespuesta {
  return { ahora, llamados };
}

/** Una línea del detalle: «Combo hamburguesa × 2», disponible a S/ 28.00 (el cliente vio lo mismo). */
export function lineaDeLlamado(
  posicion: number,
  extra: Partial<LineaDeLlamado> = {},
): LineaDeLlamado {
  return {
    posicion,
    productoId: uuid(500 + posicion),
    nombre: 'Combo hamburguesa',
    modificadores: [{ id: uuid(600 + posicion), nombre: 'Ensalada', precioExtra: '0.00' }],
    cantidad: 2,
    observacion: null,
    precioCliente: '28.00',
    revision: { disponible: true, precioUnitario: '28.00', total: '56.00' },
    ...extra,
  };
}

/** `GET /llamados/:id`: el resumen del llamado `n` más sus líneas. */
export function llamadoDetalle(
  n: number,
  extra: Omit<Partial<LlamadoDetalle>, 'mesa'> & {
    mesa?: { n: number; nombre: string };
    minutos?: number;
  } = {},
): LlamadoDetalle {
  const { lineas, totalCliente, totalActual, motivoDescarte, lineasPasadas, ...resto } = extra;
  const lista = lineas ?? [
    lineaDeLlamado(0),
    lineaDeLlamado(1, {
      nombre: 'Gaseosa 1 L',
      cantidad: 1,
      modificadores: [],
      precioCliente: '8.00',
      revision: { disponible: true, precioUnitario: '8.00', total: '8.00' },
    }),
  ];
  return {
    ...llamadoResumen(n, resto),
    lineas: lista,
    totalCliente: totalCliente ?? '64.00',
    totalActual: totalActual ?? '64.00',
    motivoDescarte: motivoDescarte ?? null,
    lineasPasadas: lineasPasadas ?? null,
  };
}
