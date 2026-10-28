import type { MenuDelDiaRespuesta } from '@restaurante/contratos';
import { reglaEnPalabras } from '../carta/grupo-form';

type Grupo = MenuDelDiaRespuesta['grupos'][number];

/** Los ids de las opciones elegidas de un menú (lo que está guardado). */
export function elegidasDe(menu: MenuDelDiaRespuesta): Set<string> {
  return new Set(
    menu.grupos.flatMap((g) => g.opciones.filter((o) => o.elegida).map((o) => o.modificadorId)),
  );
}

/** Todos los candidatos del menú, para saber cuáles ids de otro día todavía existen. */
function candidatosDe(menu: MenuDelDiaRespuesta): Set<string> {
  return new Set(menu.grupos.flatMap((g) => g.opciones.map((o) => o.modificadorId)));
}

const mismoConjunto = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** `true` si lo que está marcado difiere de lo guardado. */
export function hayCambiosDeMenu(
  menu: MenuDelDiaRespuesta,
  marcadas: ReadonlySet<string>,
): boolean {
  return !mismoConjunto(elegidasDe(menu), marcadas);
}

/** Un menú sin ninguna opción armada para el día: no se puede vender (criterio 36, `MENU_SIN_ARMAR`). */
export function estaSinArmar(menu: MenuDelDiaRespuesta): boolean {
  return elegidasDe(menu).size === 0;
}

/** Lo que hace el cliente en un grupo del menú, dicho como en la carta ("Elige 1, obligatorio"). */
export function reglaDeTiempo(grupo: Pick<Grupo, 'minimo' | 'maximo'>): string {
  return reglaEnPalabras({
    seleccion: grupo.maximo === 1 ? 'UNICA' : 'MULTIPLE',
    minimo: grupo.minimo,
    maximo: grupo.maximo,
    obligatorio: grupo.minimo >= 1,
  });
}

/** Cuántas opciones marcadas (y disponibles) le faltan a un grupo para llegar a su mínimo; 0 si ya llega. */
export function opcionesQueFaltan(grupo: Grupo, marcadas: ReadonlySet<string>): number {
  const utiles = grupo.opciones.filter((o) => marcadas.has(o.modificadorId) && o.disponible).length;
  return Math.max(0, grupo.minimo - utiles);
}

/** "Elige al menos 1 plato", "Elige al menos 2 platos". */
export function textoDeFaltantes(faltan: number): string {
  return faltan === 1 ? 'Elige al menos 1 plato' : `Elige al menos ${faltan} platos`;
}

/**
 * "Repetir las de ayer": de las opciones que tenía `origen` (otro día del mismo menú), las que siguen
 * siendo candidatas hoy. Un candidato nuevo no se marca y uno que ya no existe se ignora.
 */
export function copiarDeOtroDia(
  actual: MenuDelDiaRespuesta,
  origen: MenuDelDiaRespuesta | undefined,
): Set<string> {
  if (!origen) return new Set();
  const validos = candidatosDe(actual);
  return new Set([...elegidasDe(origen)].filter((id) => validos.has(id)));
}

/** "1 plato", "4 platos". */
export function pluralPlatos(cantidad: number): string {
  return cantidad === 1 ? '1 plato' : `${cantidad} platos`;
}
