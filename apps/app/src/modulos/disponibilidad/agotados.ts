import type { CartaSucursalRespuesta, ProductoDeVenta } from '@restaurante/contratos';
import { vendibilidad, type HastaAgotado } from '@restaurante/dominio';
import { paraBuscar } from '../../lib/formato';
import { etiquetaDeTipo } from '../carta/tipos';

/**
 * Lógica de la sección "Agotados" (003, criterios 77 a 80), sin React: qué se muestra, cómo se dice cada
 * motivo y qué ve la persona mientras un cambio todavía viaja al servidor. Las reglas de "se puede vender"
 * son las de `packages/dominio` (`vendibilidad`); aquí solo se vuelven a aplicar a un producto que ya
 * llegó en la vista.
 */

export type Familia = CartaSucursalRespuesta['familias'][number];
export type AgotadoDeVista = NonNullable<ProductoDeVenta['agotado']>;

/** Lo que la persona acaba de pedir para un producto y el servidor aún no confirmó. */
export type Intencion = {
  /** Distingue dos pedidos seguidos del mismo producto: solo el último puede borrar la intención. */
  version: number;
  /** Instante (ISO, hora del servidor) en que se pidió; es el "desde" provisional de un agotado. */
  en: string;
} & ({ accion: 'marcar'; hasta: HastaAgotado } | { accion: 'reactivar' });

/** Cuánto tiempo antes de la hora de corte avisa la pantalla (minutos). */
export const MINUTOS_DE_AVISO_DE_CORTE = 60;

// --- Un producto con o sin agotado --------------------------------------------------------------------

/**
 * El producto tal como quedaría con (o sin) un agotado: `vendible` y `motivo` se recalculan con
 * `vendibilidad` de `packages/dominio`. Para un menú del día se supone armado salvo que la vista ya lo
 * dijera sin armar; si el servidor opina distinto, la consulta que sigue a cada cambio lo corrige.
 */
export function conAgotado(
  producto: ProductoDeVenta,
  agotado: AgotadoDeVista | null,
): ProductoDeVenta {
  const resultado = vendibilidad({
    activo: true,
    disponibleEnSucursal: true,
    agotado: agotado !== null,
    tipo: producto.tipo,
    precio: producto.precio,
    componentes: producto.componentes,
    grupos: producto.grupos,
    opcionesDelDia:
      producto.tipo === 'MENU_DEL_DIA' && producto.motivo !== 'MENU_SIN_ARMAR' ? 1 : 0,
  });
  return { ...producto, agotado, vendible: resultado.vendible, motivo: resultado.motivo };
}

/** El producto con lo que se pidió ya aplicado (cambio optimista). */
export function conIntencion(
  producto: ProductoDeVenta,
  intencion: Intencion | undefined,
): ProductoDeVenta {
  if (!intencion) return producto;
  if (intencion.accion === 'reactivar') return conAgotado(producto, null);
  return conAgotado(producto, {
    desde: producto.agotado?.desde ?? intencion.en,
    hasta: intencion.hasta,
    origen: 'MANUAL',
  });
}

/** La vista con las intenciones aplicadas; sin ninguna, la misma vista (misma referencia). */
export function vistaConIntenciones(
  familias: readonly Familia[],
  intenciones: Readonly<Record<string, Intencion>>,
): readonly Familia[] {
  if (Object.keys(intenciones).length === 0) return familias;
  return familias.map((familia) => ({
    ...familia,
    productos: familia.productos.map((p) => conIntencion(p, intenciones[p.id])),
  }));
}

/** Cambia el agotado de un producto en la vista que se guarda (lo que el servidor acaba de confirmar). */
export function conAgotadoConfirmado(
  vista: CartaSucursalRespuesta,
  productoId: string,
  agotado: AgotadoDeVista | null,
): CartaSucursalRespuesta {
  return {
    ...vista,
    familias: vista.familias.map((familia) => ({
      ...familia,
      productos: familia.productos.map((p) => (p.id === productoId ? conAgotado(p, agotado) : p)),
    })),
  };
}

// --- Filtros ------------------------------------------------------------------------------------------

export interface Filtros {
  /** `null` = todas las estaciones. */
  estacionId: string | null;
  texto: string;
  soloAgotados: boolean;
}

/**
 * Un producto simple es de su estación; un combo o un menú del día, de las estaciones de sus componentes
 * (cada componente se prepara en la suya).
 */
export function estacionesDe(producto: ProductoDeVenta): string[] {
  const ids = new Set<string>();
  if (producto.estacionId) ids.add(producto.estacionId);
  for (const componente of producto.componentes) {
    if (componente.estacionId) ids.add(componente.estacionId);
  }
  return [...ids];
}

/** Las familias con solo los productos que cumplen los filtros; una familia sin productos se omite. */
export function filtrarFamilias(familias: readonly Familia[], filtros: Filtros): Familia[] {
  const texto = paraBuscar(filtros.texto);
  return familias
    .map((familia) => ({
      ...familia,
      productos: familia.productos.filter(
        (p) =>
          (!filtros.soloAgotados || p.agotado !== null) &&
          (filtros.estacionId === null || estacionesDe(p).includes(filtros.estacionId)) &&
          (texto === '' || paraBuscar(p.nombre).includes(texto)),
      ),
    }))
    .filter((familia) => familia.productos.length > 0);
}

/** Cuántos productos hay y cuántos están agotados entre los que cumplen la estación (sin texto ni "solo agotados"). */
export function contar(
  familias: readonly Familia[],
  estacionId: string | null,
): { productos: number; agotados: number } {
  let productos = 0;
  let agotados = 0;
  for (const familia of familias) {
    for (const p of familia.productos) {
      if (estacionId !== null && !estacionesDe(p).includes(estacionId)) continue;
      productos += 1;
      if (p.agotado !== null) agotados += 1;
    }
  }
  return { productos, agotados };
}

// --- Lo que se dice de cada producto ------------------------------------------------------------------

/** Segunda línea de una fila: el tipo si no es simple y la estación ("Combo · Cocina, Barra"). */
export function ayudaDeFila(
  producto: ProductoDeVenta,
  estaciones: ReadonlyMap<string, string>,
): string {
  const nombres = estacionesDe(producto).map((id) => estaciones.get(id) ?? 'Estación');
  const partes: string[] = [];
  if (producto.tipo !== 'SIMPLE') partes.push(etiquetaDeTipo(producto.tipo));
  if (nombres.length > 0) partes.push(nombres.join(', '));
  else if (producto.tipo === 'SIMPLE') partes.push('Sin estación');
  return partes.join(' · ');
}

/** "Agotado hoy", "Agotado hasta que lo reactiven". */
export function etiquetaDeAgotado(agotado: AgotadoDeVista): string {
  if (agotado.origen === 'SIN_STOCK') return 'Agotado: sin stock';
  return agotado.hasta === 'REACTIVAR' ? 'Agotado hasta que lo reactiven' : 'Agotado hoy';
}

const plural = (cantidad: number, uno: string, varios: string) =>
  cantidad === 1 ? `${cantidad} ${uno}` : `${cantidad} ${varios}`;

/**
 * Por qué un producto no se puede vender, con palabras (la fila ya dice "No se puede vender") y con el dato concreto (qué componente, qué grupo).
 * `null` cuando se puede vender o cuando el motivo es el propio agotado, que la fila ya dice con su etiqueta.
 */
export function motivoEnPalabras(producto: ProductoDeVenta): string | null {
  switch (producto.motivo) {
    case 'COMPONENTE_NO_DISPONIBLE': {
      const faltan = producto.componentes.filter((c) => !c.disponible).map((c) => c.nombre);
      if (faltan.length === 0) return 'Uno de sus componentes no está disponible.';
      return faltan.length === 1
        ? `${faltan[0]} no está disponible.`
        : `${faltan.join(', ')} no están disponibles.`;
    }
    case 'MENU_SIN_ARMAR':
      return 'El menú de hoy no está armado.';
    case 'OPCIONES_INSUFICIENTES': {
      const grupo = producto.grupos.find(
        (g) => g.modificadores.filter((m) => m.disponible).length < g.minimo,
      );
      if (!grupo) return 'Le faltan opciones disponibles.';
      const hay = grupo.modificadores.filter((m) => m.disponible).length;
      return `En «${grupo.nombre}» hacen falta ${plural(grupo.minimo, 'opción', 'opciones')} y ${hay === 0 ? 'no hay ninguna' : `hay ${hay}`}.`;
    }
    case 'INACTIVO':
      return 'Está desactivado en la carta.';
    case 'NO_DISPONIBLE':
      return 'No se ofrece en esta sucursal.';
    default:
      return null;
  }
}

/**
 * Lo que la sección "Menú del día" dice de un plato que no está disponible, a partir del producto ligado
 * en la vista de la sucursal. `undefined` en la vista = el plato no está en la carta de la sucursal
 * (desactivado o no ofrecido); `null` = la vista aún no llegó y se queda el texto genérico.
 */
export function motivoDeOpcionDelMenu(producto: ProductoDeVenta | undefined | null): string {
  if (producto === null) return 'No disponible hoy';
  if (producto === undefined) return 'No está en la carta de esta sucursal';
  if (producto.agotado) return etiquetaDeAgotado(producto.agotado);
  switch (producto.motivo) {
    case 'COMPONENTE_NO_DISPONIBLE':
      return 'Le falta un componente';
    case 'MENU_SIN_ARMAR':
      return 'Su menú no está armado';
    case 'OPCIONES_INSUFICIENTES':
      return 'Le faltan opciones';
    case 'INACTIVO':
    case 'NO_DISPONIBLE':
      return 'No está en la carta de esta sucursal';
    default:
      return 'No disponible hoy';
  }
}

/** Los productos que dejan de poder venderse (como componente) o de elegirse (como opción) si se agota `productoId`. */
export function afectadosPorAgotar(
  familias: readonly Familia[],
  productoId: string,
): { combos: string[]; comoOpcion: string[] } {
  const combos: string[] = [];
  const comoOpcion: string[] = [];
  for (const familia of familias) {
    for (const p of familia.productos) {
      if (p.id === productoId) continue;
      if (p.componentes.some((c) => c.productoId === productoId)) combos.push(p.nombre);
      else if (p.grupos.some((g) => g.modificadores.some((m) => m.productoId === productoId))) {
        comoOpcion.push(p.nombre);
      }
    }
  }
  return { combos, comoOpcion };
}

// --- Hora de corte ------------------------------------------------------------------------------------

function minutosDelDiaEnLima(instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return (valor('hour') % 24) * 60 + valor('minute');
}

/** Minutos que faltan para la siguiente hora de corte (`HH:MM`, hora de Lima); entre 0 y 1439. */
export function minutosParaElCorte(horaCorte: string, ahora: Date): number {
  const [horas = 0, minutos = 0] = horaCorte.split(':').map(Number);
  return (horas * 60 + minutos - minutosDelDiaEnLima(ahora) + 1440) % 1440;
}

/** "1 minuto", "40 minutos", "1 hora". */
export function textoDeMinutos(minutos: number): string {
  if (minutos >= 60 && minutos % 60 === 0) return plural(minutos / 60, 'hora', 'horas');
  return plural(minutos, 'minuto', 'minutos');
}

/** `true` si la hora de corte está cerca (y todavía no llegó). */
export function cercaDelCorte(horaCorte: string, ahora: Date): boolean {
  const faltan = minutosParaElCorte(horaCorte, ahora);
  return faltan > 0 && faltan <= MINUTOS_DE_AVISO_DE_CORTE;
}

// --- Estación recordada en el equipo ------------------------------------------------------------------

const prefijoDeEstacion = 'restaurante.disponibilidad.estacion.';

/** La última estación elegida en este equipo para la empresa; `null` = todas. Un almacenamiento bloqueado no rompe nada. */
export function estacionRecordada(empresaId: string): string | null {
  try {
    const guardada = localStorage.getItem(`${prefijoDeEstacion}${empresaId}`);
    return guardada && guardada !== 'todas' ? guardada : null;
  } catch {
    return null;
  }
}

export function recordarEstacion(empresaId: string, estacionId: string | null): void {
  try {
    localStorage.setItem(`${prefijoDeEstacion}${empresaId}`, estacionId ?? 'todas');
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado): el filtro vale solo en esta pantalla.
  }
}
