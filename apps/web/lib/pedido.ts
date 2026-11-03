import type {
  DisponibilidadPublica,
  LlamadoEntrada,
  ProductoPublico,
} from '@restaurante/contratos';
import type { EstadoLlamado, TipoLlamado } from '@restaurante/dominio';

/**
 * El pedido que arma el cliente en el modo mesa y el llamado en curso (criterios 84 a 87). Todo vive en el
 * navegador de ese cliente, en `sessionStorage` y por código de mesa: sobrevive a una recarga y se pierde al
 * cerrar la pestaña. Los montos salen de `packages/dominio` (`calcularLinea`, `totalOrden`); aquí no se suma nada.
 * Es código de navegador: no importa `zod`.
 */

/** Lo que la hoja de producto necesita de un producto de la carta. */
export type ProductoMesa = Pick<
  ProductoPublico,
  'id' | 'nombre' | 'descripcion' | 'fotoUrl' | 'precio' | 'grupos'
>;

/** Una línea del pedido: lo que se manda a la API. Nombres y precios se calculan con la carta de cada momento. */
export interface LineaPedido {
  /** Identificador local de la línea (no viaja a la API). */
  clave: string;
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  /** Vacía si el cliente no puso indicaciones. */
  observacion: string;
}

export interface PedidoGuardado {
  lineas: LineaPedido[];
  /** Nota para el mozo; vacía si no hay. */
  nota: string;
  /** Líneas que la API rechazó (clave → motivo en palabras), hasta que se editen o se quiten. */
  rechazos: Record<string, string>;
}

/** Un envío en curso: el `id` se genera al pulsar "Enviar" y se conserva hasta una respuesta final (criterio 87). */
export interface EnvioGuardado {
  id: string;
  cuerpo: LlamadoEntrada;
}

/** El llamado que ya llegó al mozo y cuyo estado se consulta (criterio 86). `id` es `null` si solo se sabe por la mesa. */
export interface SeguimientoGuardado {
  id: string | null;
  tipo: TipoLlamado;
  estado: EstadoLlamado;
  venceEn: string;
}

export interface LlamadoGuardado {
  envio: EnvioGuardado | null;
  seguimiento: SeguimientoGuardado | null;
}

export const PEDIDO_VACIO: PedidoGuardado = { lineas: [], nota: '', rechazos: {} };
export const LLAMADO_VACIO: LlamadoGuardado = { envio: null, seguimiento: null };

const clavePedido = (codigo: string) => `pedido:${codigo}`;
const claveLlamado = (codigo: string) => `llamado:${codigo}`;

function leerJson(clave: string): unknown {
  try {
    const texto = sessionStorage.getItem(clave);
    return texto === null ? null : JSON.parse(texto);
  } catch {
    return null;
  }
}

function guardarJson(clave: string, valor: unknown): void {
  try {
    sessionStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento (navegación privada, cuota): el pedido sigue en la pantalla, pero no sobrevive a la recarga.
  }
}

const esObjeto = (dato: unknown): dato is Record<string, unknown> =>
  typeof dato === 'object' && dato !== null;

function esLinea(dato: unknown): dato is LineaPedido {
  return (
    esObjeto(dato) &&
    typeof dato.clave === 'string' &&
    typeof dato.productoId === 'string' &&
    Array.isArray(dato.modificadorIds) &&
    dato.modificadorIds.every((id) => typeof id === 'string') &&
    typeof dato.cantidad === 'number' &&
    typeof dato.observacion === 'string'
  );
}

export function leerPedido(codigo: string): PedidoGuardado {
  const dato = leerJson(clavePedido(codigo));
  if (!esObjeto(dato) || !Array.isArray(dato.lineas)) return PEDIDO_VACIO;
  return {
    lineas: dato.lineas.filter(esLinea),
    nota: typeof dato.nota === 'string' ? dato.nota : '',
    rechazos: esObjeto(dato.rechazos) ? (dato.rechazos as Record<string, string>) : {},
  };
}

export function guardarPedido(codigo: string, pedido: PedidoGuardado): void {
  if (pedido.lineas.length === 0 && pedido.nota === '') {
    try {
      sessionStorage.removeItem(clavePedido(codigo));
    } catch {
      // Ver `guardarJson`.
    }
    return;
  }
  guardarJson(clavePedido(codigo), pedido);
}

export function leerLlamado(codigo: string): LlamadoGuardado {
  const dato = leerJson(claveLlamado(codigo));
  if (!esObjeto(dato)) return LLAMADO_VACIO;
  const envio = dato.envio;
  const seguimiento = dato.seguimiento;
  return {
    envio:
      esObjeto(envio) && typeof envio.id === 'string' && esObjeto(envio.cuerpo)
        ? (envio as unknown as EnvioGuardado)
        : null,
    seguimiento:
      esObjeto(seguimiento) && typeof seguimiento.estado === 'string' && esObjeto(seguimiento)
        ? (seguimiento as unknown as SeguimientoGuardado)
        : null,
  };
}

export function guardarLlamado(codigo: string, llamado: LlamadoGuardado): void {
  if (llamado.envio === null && llamado.seguimiento === null) {
    try {
      sessionStorage.removeItem(claveLlamado(codigo));
    } catch {
      // Ver `guardarJson`.
    }
    return;
  }
  guardarJson(claveLlamado(codigo), llamado);
}

/** UUID v4 para el `id` del llamado y las claves locales. Sin `randomUUID` (páginas sin HTTPS) se arma a mano. */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Cantidad de platos (unidades) del pedido. */
export function platosDelPedido(lineas: readonly LineaPedido[]): number {
  return lineas.reduce((suma, l) => suma + l.cantidad, 0);
}

// ---------------------------------------------------------------------------------------------------
// Disponibilidad y problemas de cada línea (criterios 82 y 84)
// ---------------------------------------------------------------------------------------------------

/** Producto → modificadores no disponibles, a partir de la última consulta; `null` si todavía no hay consulta. */
export function indiceDeDisponibilidad(
  disponibilidad: DisponibilidadPublica | null,
): ReadonlyMap<string, ReadonlySet<string>> | null {
  if (disponibilidad === null) return null;
  return new Map(
    disponibilidad.vendibles.map((v) => [v.id, new Set(v.modificadoresNoDisponibles)]),
  );
}

/** Los nombres de las opciones elegidas, en el orden de los grupos. */
export function nombresDeOpciones(producto: ProductoMesa, elegidos: readonly string[]): string[] {
  const nombres: string[] = [];
  for (const grupo of producto.grupos) {
    for (const modificador of grupo.modificadores) {
      if (elegidos.includes(modificador.id)) nombres.push(modificador.nombre);
    }
  }
  return nombres;
}

// ---------------------------------------------------------------------------------------------------
// Armar el pedido
// ---------------------------------------------------------------------------------------------------

export function reemplazarLinea(
  pedido: PedidoGuardado,
  clave: string,
  linea: Omit<LineaPedido, 'clave'>,
): PedidoGuardado {
  return {
    ...pedido,
    lineas: pedido.lineas.map((l) => (l.clave === clave ? { ...linea, clave } : l)),
    rechazos: quitarClave(pedido.rechazos, clave),
  };
}

export function quitarLinea(pedido: PedidoGuardado, clave: string): PedidoGuardado {
  return {
    ...pedido,
    lineas: pedido.lineas.filter((l) => l.clave !== clave),
    rechazos: quitarClave(pedido.rechazos, clave),
  };
}

export function quitarClave(
  rechazos: Record<string, string>,
  clave: string,
): Record<string, string> {
  const { [clave]: _quitada, ...resto } = rechazos;
  return resto;
}

/** El cuerpo de un pedido para la API (sin `id`: lo pone quien lo envía). */
export function cuerpoDelPedido(pedido: PedidoGuardado): Omit<LlamadoEntrada, 'id'> {
  const nota = pedido.nota.trim();
  return {
    tipo: 'PEDIDO',
    lineas: pedido.lineas.map((l) => {
      const observacion = l.observacion.trim();
      return {
        productoId: l.productoId,
        modificadorIds: l.modificadorIds,
        cantidad: l.cantidad,
        ...(observacion === '' ? {} : { observacion }),
      };
    }),
    ...(nota === '' ? {} : { nota }),
  } as Omit<LlamadoEntrada, 'id'>;
}

/** `true` si dos cuerpos (sin `id`) piden lo mismo: así un reintento conserva el `id` y un cambio lo renueva. */
export function mismoCuerpo(a: LlamadoEntrada, b: Omit<LlamadoEntrada, 'id'>): boolean {
  const { id: _id, ...sinId } = a;
  return JSON.stringify(sinId) === JSON.stringify(b);
}
