import type { CampoError, SeQuita, UsadoEn } from '@restaurante/contratos';
import { diaOperativo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import type { Reloj } from '../../nucleo/reloj';
import type { SucursalesConsultaService } from '../plataforma';

/**
 * Lo que depende del tipo de un producto (`SIMPLE`, `COMBO`, `MENU_DEL_DIA`): las reglas del criterio 7, dónde
 * se usa un producto (criterios 10c y 12) y qué se quita al cambiar el tipo (criterio 10b). Las consultas son
 * de las tablas del módulo (`componente_combo`, `modificador`, `menu_del_dia_opcion`) y corren en la
 * transacción de la petición, bajo RLS.
 */

export type TipoProducto = 'SIMPLE' | 'COMBO' | 'MENU_DEL_DIA';

/** Un componente de un combo tal como se guarda y se muestra. */
export interface ComponenteGuardado {
  productoId: string;
  nombre: string;
  cantidad: number;
}

/** El producto ya mezclado (lo guardado con lo enviado), sobre el que se comprueban las reglas del criterio 7. */
export interface ProductoParaReglas {
  tipo: TipoProducto;
  seVendeSolo: boolean;
  precio: string | null;
  estacionId: string | null;
  /** Cuántos componentes y grupos tendría el producto con el cambio. */
  componentes: number;
  grupos: number;
  /** Cuántos componentes envió quien edita (un `SIMPLE` no los admite). */
  componentesEnviados: number;
  /** Al pasar a `SIMPLE` desde otro tipo, la estación es obligatoria en el mismo `PATCH` (criterio 10b). */
  faltaEstacion: boolean;
}

/** Criterio 7: devuelve los campos que no cumplen las reglas del tipo (400 `DATOS_INVALIDOS`); vacío si cumple. */
export function reglasDelTipo(p: ProductoParaReglas): CampoError[] {
  const campos: CampoError[] = [];
  const falla = (campo: string, mensaje: string) => campos.push({ campo, mensaje });
  if (p.tipo === 'SIMPLE') {
    if (p.faltaEstacion) {
      falla(
        'estacionId',
        'Elige la estación o indica que no tiene (null) al pasar a producto simple',
      );
    }
    if (p.componentesEnviados > 0) falla('componentes', 'Un producto simple no lleva componentes');
    if (p.seVendeSolo && p.precio === null) {
      falla('precio', 'El precio es obligatorio si el producto se vende solo');
    }
    if (!p.seVendeSolo && p.precio !== null) {
      falla('precio', 'Un producto que no se vende solo no lleva precio');
    }
    return campos;
  }
  if (!p.seVendeSolo) falla('seVendeSolo', 'Un combo o un menú del día siempre se vende solo');
  if (p.precio === null) falla('precio', 'El precio es obligatorio en un combo o un menú del día');
  if (p.estacionId !== null) {
    falla('estacionId', 'Un combo o un menú del día no tiene estación propia');
  }
  if (p.tipo === 'COMBO' && p.componentes + p.grupos === 0) {
    falla('componentes', 'Un combo necesita al menos un componente o un grupo de opciones');
  }
  if (p.tipo === 'MENU_DEL_DIA' && p.grupos === 0) {
    falla('gruposModificadores', 'Un menú del día necesita al menos un grupo (un tiempo)');
  }
  return campos;
}

// ---- Dónde se usa un producto ---------------------------------------------------------------------------

/**
 * Dónde se usa un producto (criterios 10c y 12): los combos y menús de los que es componente, activos o no, y
 * los modificadores activos (de un grupo activo o no) que lo tienen como producto ligado. Dos consultas.
 */
export async function usadoEnDe(conexion: Sequelize, productoId: string): Promise<UsadoEn> {
  const combos = await conexion.query<{ id: string; nombre: string }>(
    `SELECT c.id, c.nombre FROM componente_combo cc JOIN producto c ON c.id = cc.combo_id
      WHERE cc.producto_id = $1 ORDER BY lower(c.nombre), c.id`,
    { bind: [productoId], type: QueryTypes.SELECT },
  );
  const modificadores = await conexion.query<UsadoEn['modificadores'][number]>(
    `SELECT m.id, m.nombre, g.id AS "grupoId", g.nombre AS "grupoNombre"
       FROM modificador m JOIN grupo_modificadores g ON g.id = m.grupo_id
      WHERE m.producto_id = $1 AND m.activo ORDER BY lower(g.nombre), g.id, m.orden, m.id`,
    { bind: [productoId], type: QueryTypes.SELECT },
  );
  return { combos, modificadores };
}

/** `true` si el producto se usa en algún combo o modificador. */
export const seUsa = (usadoEn: UsadoEn): boolean =>
  usadoEn.combos.length > 0 || usadoEn.modificadores.length > 0;

/** El mensaje del 409 `EN_USO` del criterio 10c: dice dónde se usa el producto y qué hacer. */
export function mensajeEnUso(usadoEn: UsadoEn, hacia: Exclude<TipoProducto, 'SIMPLE'>): string {
  const lugares = [
    ...usadoEn.combos.map((c) => c.nombre),
    ...usadoEn.modificadores.map((m) => `${m.grupoNombre} › ${m.nombre}`),
  ];
  const destino = hacia === 'COMBO' ? 'un combo' : 'un menú del día';
  return `Se usa en: ${lugares.join('; ')}. Quítalo de ahí antes de convertirlo en ${destino}`;
}

// ---- Lo que se quita al cambiar el tipo ---------------------------------------------------------------

/** Dependencias de `calcularSeQuita`: la conexión de la petición, las sucursales y el reloj de la API. */
export interface DependenciasSeQuita {
  conexion: Sequelize;
  sucursales: SucursalesConsultaService;
  reloj: Reloj;
}

/** El producto que cambia de tipo, con lo que el cambio podría quitarle. */
export interface CambioDeTipo {
  productoId: string;
  desde: TipoProducto;
  hacia: TipoProducto;
  /** Estación guardada (solo la quita el paso de `SIMPLE` a combo o menú). */
  estacionId: string | null;
  /** Componentes guardados (solo los quita el paso a `SIMPLE`). */
  componentes: readonly ComponenteGuardado[];
}

/**
 * Criterio 10b: lo que el cambio de tipo quitaría, sin escribir nada. `estacion`: la guardada, si pasa de
 * `SIMPLE` a combo o menú. `componentes`: los guardados, si pasa a `SIMPLE`. `opcionesDelDia`: si deja de ser
 * menú del día, por sucursal y día, la cantidad de opciones armadas para el día operativo actual de esa
 * sucursal (con el reloj de la API y su hora de corte) o uno posterior; las de días anteriores también se
 * borran, pero no se listan.
 */
export async function calcularSeQuita(
  { conexion, sucursales, reloj }: DependenciasSeQuita,
  cambio: CambioDeTipo,
): Promise<SeQuita> {
  const seQuita: SeQuita = { estacion: null, componentes: [], opcionesDelDia: [] };
  if (cambio.desde === 'SIMPLE' && cambio.hacia !== 'SIMPLE' && cambio.estacionId !== null) {
    const filas = await conexion.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM estacion WHERE id = $1',
      { bind: [cambio.estacionId], type: QueryTypes.SELECT },
    );
    if (filas[0] !== undefined) seQuita.estacion = filas[0];
  }
  if (cambio.hacia === 'SIMPLE' && cambio.desde !== 'SIMPLE') {
    seQuita.componentes = cambio.componentes.map((c) => ({ ...c }));
  }
  if (cambio.desde === 'MENU_DEL_DIA' && cambio.hacia !== 'MENU_DEL_DIA') {
    const filas = await conexion.query<{ sucursal_id: string; dia: string; opciones: number }>(
      `SELECT sucursal_id, dia_operativo::text AS dia, count(*)::int AS opciones
         FROM menu_del_dia_opcion WHERE producto_id = $1
        GROUP BY sucursal_id, dia_operativo ORDER BY sucursal_id, dia_operativo`,
      { bind: [cambio.productoId], type: QueryTypes.SELECT },
    );
    const ids = [...new Set(filas.map((f) => f.sucursal_id))];
    const nombres = new Map((await sucursales.listar(ids)).map((s) => [s.id, s.nombre]));
    const hoyDe = new Map<string, string>();
    for (const id of ids) {
      hoyDe.set(id, diaOperativo(reloj.ahora(), (await sucursales.horaCorte(id)) ?? '05:00'));
    }
    seQuita.opcionesDelDia = filas
      .filter((f) => f.dia >= hoyDe.get(f.sucursal_id)!)
      .map((f) => ({
        sucursalId: f.sucursal_id,
        sucursalNombre: nombres.get(f.sucursal_id) ?? '',
        dia: f.dia,
        opciones: f.opciones,
      }))
      .sort(
        (a, b) =>
          a.sucursalNombre.localeCompare(b.sucursalNombre, 'es') ||
          a.sucursalId.localeCompare(b.sucursalId) ||
          a.dia.localeCompare(b.dia),
      );
  }
  return seQuita;
}

/** `true` si el cambio de tipo quitaría algo (y por lo tanto pide confirmación). */
export const hayQueQuitar = (seQuita: SeQuita): boolean =>
  seQuita.estacion !== null || seQuita.componentes.length > 0 || seQuita.opcionesDelDia.length > 0;

/** El mensaje del 409 `CONFIRMACION_REQUERIDA`, con lo que se quitaría en palabras. */
export function mensajeDeConfirmacion(seQuita: SeQuita): string {
  const partes: string[] = [];
  if (seQuita.estacion !== null) partes.push(`la estación ${seQuita.estacion.nombre}`);
  if (seQuita.componentes.length > 0) {
    partes.push(
      `los componentes: ${seQuita.componentes.map((c) => `${c.nombre} × ${c.cantidad}`).join(', ')}`,
    );
  }
  for (const o of seQuita.opcionesDelDia) {
    partes.push(`las opciones del menú del ${o.dia} en ${o.sucursalNombre} (${o.opciones})`);
  }
  return `El cambio quita ${partes.join('; ')}. Confirma para continuar`;
}

/** Lo que se borró del menú del día, por sucursal y día (para la auditoría). */
export interface OpcionesBorradas {
  sucursalId: string;
  dia: string;
  modificadorIds: string[];
}

/**
 * Borra todas las opciones del día del menú, en todas las sucursales y días (también las de días pasados), y
 * devuelve lo realmente borrado.
 */
export async function borrarOpcionesDelDia(
  conexion: Sequelize,
  productoId: string,
): Promise<OpcionesBorradas[]> {
  const filas = await conexion.query<{
    sucursal_id: string;
    dia: string;
    modificador_id: string;
  }>(
    `DELETE FROM menu_del_dia_opcion WHERE producto_id = $1
     RETURNING sucursal_id, dia_operativo::text AS dia, modificador_id`,
    { bind: [productoId], type: QueryTypes.SELECT },
  );
  const grupos = new Map<string, OpcionesBorradas>();
  for (const f of filas) {
    const clave = `${f.sucursal_id}|${f.dia}`;
    const grupo = grupos.get(clave) ?? {
      sucursalId: f.sucursal_id,
      dia: f.dia,
      modificadorIds: [],
    };
    grupo.modificadorIds.push(f.modificador_id);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, modificadorIds: g.modificadorIds.sort() }))
    .sort((a, b) => a.sucursalId.localeCompare(b.sucursalId) || a.dia.localeCompare(b.dia));
}
