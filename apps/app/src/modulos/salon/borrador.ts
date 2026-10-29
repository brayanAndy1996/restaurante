import type { LineaEnvioEntrada } from '@restaurante/contratos';
import { totalOrden } from '@restaurante/dominio';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * El borrador de una cuenta (criterios 91 y 92 de 004): lo que el mozo arma en el comandero y todavía no
 * envió. Vive solo en este equipo, en `localStorage`, por empresa, persona y orden, y sobrevive a una recarga.
 * Lo escrito por otra persona en el mismo equipo no se ve (la clave lleva a la persona). Nunca guarda una
 * credencial.
 *
 * Además de las líneas guarda `envioId`: el id del envío que se generó al pulsar "Enviar". Se conserva hasta
 * que el envío termina, para que "Reintentar el envío" use el mismo id y el servidor lo reconozca como el
 * mismo envío (criterio 26) en vez de mandar el pedido dos veces a cocina. Mientras haya `envioId`, las
 * líneas no se tocan: cambiarlas con el mismo id sería otro pedido con el mismo nombre.
 */

const PREFIJO = 'restaurante.borrador.';

/** Una línea del borrador: lo que se eligió y el precio con que se calculó (`calcularLinea`). */
export interface LineaBorrador {
  /** Identifica la línea en este equipo (editar, quitar, marcar un rechazo); no viaja a la API. */
  clave: string;
  productoId: string;
  nombre: string;
  modificadores: { id: string; nombre: string; precioExtra: string }[];
  cantidad: number;
  /** `''` si no hay observación. */
  observacion: string;
  tiempo: 1 | 2;
  paraLlevar: boolean;
  /** Precio de una unidad con los extras elegidos, ya calculado con `calcularLinea`. */
  precioUnitario: string;
  /** Por qué la API rechazó esta línea en el último envío ("Agotado"); desaparece al editarla. */
  rechazo?: string;
}

export interface BorradorGuardado {
  lineas: LineaBorrador[];
  /** El id del envío en curso o sin terminar; `null` si no se pulsó "Enviar" o ya terminó. */
  envioId: string | null;
}

const VACIO: BorradorGuardado = Object.freeze({ lineas: [], envioId: null }) as BorradorGuardado;

/** Clave de este borrador: de la empresa, de la persona (o `soporte`) y de la orden. */
export function claveDeBorrador(
  empresaId: string,
  usuarioId: string | null,
  ordenId: string,
): string {
  return `${PREFIJO}${empresaId}.${usuarioId ?? 'soporte'}.${ordenId}`;
}

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

function esLinea(dato: unknown): dato is LineaBorrador {
  if (typeof dato !== 'object' || dato === null) return false;
  const l = dato as Record<string, unknown>;
  return (
    typeof l.clave === 'string' &&
    typeof l.productoId === 'string' &&
    typeof l.nombre === 'string' &&
    Array.isArray(l.modificadores) &&
    typeof l.cantidad === 'number' &&
    Number.isInteger(l.cantidad) &&
    typeof l.observacion === 'string' &&
    (l.tiempo === 1 || l.tiempo === 2) &&
    typeof l.paraLlevar === 'boolean' &&
    typeof l.precioUnitario === 'string'
  );
}

function analizar(texto: string | null | undefined): BorradorGuardado {
  if (!texto) return VACIO;
  try {
    const dato = JSON.parse(texto) as { lineas?: unknown; envioId?: unknown };
    const lineas = Array.isArray(dato.lineas) ? dato.lineas.filter(esLinea) : [];
    const envioId = typeof dato.envioId === 'string' ? dato.envioId : null;
    return lineas.length === 0 && envioId === null ? VACIO : { lineas, envioId };
  } catch {
    // Un borrador ilegible (almacenamiento dañado) se trata como vacío: no rompe la pantalla.
    return VACIO;
  }
}

/** Lo último leído de cada clave: mientras el texto guardado no cambie, se devuelve el mismo objeto. */
const memo = new Map<string, { texto: string | null; valor: BorradorGuardado }>();

/** Lee el borrador guardado; el mismo texto da siempre el mismo objeto (lo pide `useSyncExternalStore`). */
export function leerBorrador(clave: string): BorradorGuardado {
  let texto: string | null = null;
  try {
    texto = local()?.getItem(clave) ?? null;
  } catch {
    texto = null;
  }
  const previo = memo.get(clave);
  if (previo && previo.texto === texto) return previo.valor;
  const valor = analizar(texto);
  memo.set(clave, { texto, valor });
  return valor;
}

const oyentes = new Set<() => void>();

function avisar(): void {
  oyentes.forEach((oyente) => oyente());
}

/** Guarda el borrador. Sin líneas ni envío en curso se borra la clave. */
export function guardarBorrador(clave: string, borrador: BorradorGuardado): void {
  try {
    if (borrador.lineas.length === 0 && borrador.envioId === null) local()?.removeItem(clave);
    else local()?.setItem(clave, JSON.stringify(borrador));
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado): el borrador vale solo mientras la pantalla esté abierta.
    memo.set(clave, { texto: null, valor: borrador });
  }
  avisar();
}

/** Cambia el borrador a partir de lo guardado. */
export function cambiarBorrador(
  clave: string,
  cambio: (actual: BorradorGuardado) => BorradorGuardado,
): void {
  guardarBorrador(clave, cambio(leerBorrador(clave)));
}

export function borrarBorrador(clave: string): void {
  guardarBorrador(clave, VACIO);
}

/**
 * La cuenta a la que se unió esta (criterio 29): el borrador pasa a la orden nueva, después de lo que ya
 * hubiera allí. Como el servidor no guardó nada, el envío en curso se olvida y el próximo lleva un id nuevo.
 */
export function pasarBorrador(desde: string, hacia: string): void {
  const origen = leerBorrador(desde);
  const destino = leerBorrador(hacia);
  guardarBorrador(hacia, {
    lineas: [...destino.lineas, ...origen.lineas.map(({ rechazo: _quitado, ...l }) => l)],
    envioId: destino.envioId,
  });
  borrarBorrador(desde);
}

function suscribirAlAlmacenamiento(avisarCambio: () => void): () => void {
  oyentes.add(avisarCambio);
  // Otra pestaña del mismo equipo escribió el borrador.
  const alAlmacenar = (evento: StorageEvent) => {
    if (evento.key === null || evento.key.startsWith(PREFIJO)) avisarCambio();
  };
  window.addEventListener('storage', alAlmacenar);
  return () => {
    oyentes.delete(avisarCambio);
    window.removeEventListener('storage', alAlmacenar);
  };
}

// --- Estado de un envío en este momento (solo memoria) ----------------------------------------------------

/** `enviando`: la petición está en vuelo; `esperando-red`: no llegó y se sigue intentando con la misma clave. */
export type FaseDeEnvio = 'enviando' | 'esperando-red';

/** Lo que se le dice a la persona tras un envío que no terminó bien. */
export interface AvisoDeEnvio {
  tipo: 'error' | 'alerta';
  titulo: string;
  detalle: string;
}

interface EstadoEfimero {
  fase: FaseDeEnvio | null;
  aviso: AvisoDeEnvio | null;
}

const SIN_ESTADO: EstadoEfimero = Object.freeze({ fase: null, aviso: null }) as EstadoEfimero;
const efimeros = new Map<string, EstadoEfimero>();
const oyentesEfimeros = new Set<() => void>();

export function leerEstadoDeEnvio(clave: string): EstadoEfimero {
  return efimeros.get(clave) ?? SIN_ESTADO;
}

export function cambiarEstadoDeEnvio(clave: string, cambio: Partial<EstadoEfimero>): void {
  const nuevo = { ...leerEstadoDeEnvio(clave), ...cambio };
  if (nuevo.fase === null && nuevo.aviso === null) efimeros.delete(clave);
  else efimeros.set(clave, nuevo);
  oyentesEfimeros.forEach((oyente) => oyente());
}

/** Para las pruebas: una página recién cargada no recuerda ningún envío en curso. */
export function olvidarEstadoDeEnvios(): void {
  efimeros.clear();
  memo.clear();
}

function suscribirAlEstado(avisarCambio: () => void): () => void {
  oyentesEfimeros.add(avisarCambio);
  return () => oyentesEfimeros.delete(avisarCambio);
}

// --- Hook --------------------------------------------------------------------------------------------------

export interface BorradorEnPantalla extends BorradorGuardado {
  /** Hay un envío en vuelo o esperando la red en esta pantalla. */
  fase: FaseDeEnvio | null;
  aviso: AvisoDeEnvio | null;
  /** Hay un envío sin terminar que no está en vuelo (se cortó o se recargó la página): "Reintentar el envío". */
  porReintentar: boolean;
  agregar: (linea: LineaBorrador) => void;
  reemplazar: (clave: string, linea: LineaBorrador) => void;
  quitar: (clave: string) => void;
}

/** El borrador de una cuenta, al día con lo guardado y con el estado del envío. */
export function useBorrador(clave: string): BorradorEnPantalla {
  const guardado = useSyncExternalStore(
    suscribirAlAlmacenamiento,
    () => leerBorrador(clave),
    () => VACIO,
  );
  const estado = useSyncExternalStore(
    suscribirAlEstado,
    () => leerEstadoDeEnvio(clave),
    () => SIN_ESTADO,
  );
  const agregar = useCallback(
    (linea: LineaBorrador) =>
      cambiarBorrador(clave, (b) => (b.envioId ? b : { ...b, lineas: [...b.lineas, linea] })),
    [clave],
  );
  const reemplazar = useCallback(
    (claveDeLinea: string, linea: LineaBorrador) =>
      cambiarBorrador(clave, (b) =>
        b.envioId
          ? b
          : { ...b, lineas: b.lineas.map((l) => (l.clave === claveDeLinea ? linea : l)) },
      ),
    [clave],
  );
  const quitar = useCallback(
    (claveDeLinea: string) =>
      cambiarBorrador(clave, (b) =>
        b.envioId ? b : { ...b, lineas: b.lineas.filter((l) => l.clave !== claveDeLinea) },
      ),
    [clave],
  );
  return {
    ...guardado,
    fase: estado.fase,
    aviso: estado.aviso,
    porReintentar: guardado.envioId !== null && estado.fase === null,
    agregar,
    reemplazar,
    quitar,
  };
}

// --- Lo que se manda y lo que se muestra --------------------------------------------------------------------

/** La línea como la espera `POST /ordenes/:id/envios` (criterio 15). */
export function aLineaDeEnvio(linea: LineaBorrador): LineaEnvioEntrada {
  const observacion = linea.observacion.trim();
  return {
    productoId: linea.productoId,
    modificadorIds: linea.modificadores.map((m) => m.id),
    cantidad: linea.cantidad,
    ...(observacion === '' ? {} : { observacion }),
    tiempo: linea.tiempo,
    paraLlevar: linea.paraLlevar,
  };
}

/** Total de una línea del borrador: `totalOrden` de `packages/dominio` sobre una sola línea. */
export function totalDeLinea(linea: LineaBorrador): string {
  return totalOrden([
    { precioUnitario: linea.precioUnitario, cantidad: linea.cantidad, cantidadAnulada: 0 },
  ]);
}

/** Total del borrador (`totalOrden`): la suma de sus líneas, sin sumar a mano. */
export function totalDelBorrador(lineas: readonly LineaBorrador[]): string {
  return totalOrden(
    lineas.map((l) => ({
      precioUnitario: l.precioUnitario,
      cantidad: l.cantidad,
      cantidadAnulada: 0,
    })),
  );
}

/** Cuántas unidades hay por enviar (la suma de las cantidades). */
export const unidadesDelBorrador = (lineas: readonly LineaBorrador[]): number =>
  lineas.reduce((suma, l) => suma + l.cantidad, 0);
