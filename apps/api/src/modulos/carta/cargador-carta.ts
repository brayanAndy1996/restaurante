import type {
  AfectacionIgv,
  HastaAgotado,
  OrigenAgotado,
  Seleccion,
  TipoControlStock,
  TipoProducto,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Carga de la carta de una sucursal (criterios 47 a 52): seis consultas fijas, sin importar cuántos productos
 * haya (RNF-03). Corre dentro de la transacción de la petición (la RLS limita todo a la empresa del contexto).
 * Solo lee y devuelve filas ya tipadas; las reglas (precio efectivo, agotados, vendibilidad) las aplica
 * `armador-carta.ts` con `packages/dominio`.
 *
 * 1. Productos de la empresa con el ajuste y el agotado de la sucursal (los activos de familias activas entran
 *    en la vista; también se cargan los inactivos, porque un componente o un producto ligado inactivo cuenta
 *    para la disponibilidad de quien lo usa).
 * 2. Familias activas, en orden.
 * 3. Estaciones activas.
 * 4. Grupos asignados con sus modificadores activos, en orden.
 * 5. Componentes de combos y menús.
 * 6. Opciones del día de la sucursal para el día operativo actual.
 *
 * Con `productoId` (para `prepararLinea`) las consultas 1, 4, 5 y 6 se restringen a ese producto, sus
 * componentes y sus productos ligados: son las mismas seis consultas, con menos filas.
 */

export interface AgotadoCargado {
  desde: Date;
  diaOperativo: string;
  hasta: HastaAgotado;
  origen: OrigenAgotado;
}

export interface ProductoCargado {
  id: string;
  familiaId: string;
  familiaActiva: boolean;
  tipo: TipoProducto;
  nombre: string;
  descripcion: string | null;
  fotoClave: string | null;
  precio: string | null;
  precioSucursal: string | null;
  seVendeSolo: boolean;
  afectacionIgv: AfectacionIgv;
  aplicaIcbper: boolean;
  estacionId: string | null;
  tipoControlStock: TipoControlStock;
  activo: boolean;
  /** Se ofrece en la sucursal. */
  disponible: boolean;
  agotado: AgotadoCargado | null;
}

export interface ModificadorCargado {
  id: string;
  nombre: string;
  precioExtra: string;
  productoLigadoId: string | null;
}

export interface GrupoCargado {
  id: string;
  nombre: string;
  seleccion: Seleccion;
  minimo: number;
  maximo: number;
  modificadores: ModificadorCargado[];
}

export interface ComponenteCargado {
  productoId: string;
  cantidad: number;
}

export interface CartaCargada {
  sucursalId: string;
  /** Día operativo actual de la sucursal. */
  diaOperativo: string;
  /** Todos los productos cargados, en el orden de la carta (`orden`, `id`). */
  productos: ProductoCargado[];
  porId: Map<string, ProductoCargado>;
  /** Familias activas, en su orden. */
  familias: { id: string; nombre: string }[];
  estaciones: { id: string; nombre: string }[];
  gruposDe: Map<string, GrupoCargado[]>;
  componentesDe: Map<string, ComponenteCargado[]>;
  /** Por menú del día, los modificadores elegidos para `diaOperativo`. */
  opcionesDelDia: Map<string, Set<string>>;
}

interface FilaProducto {
  id: string;
  familia_id: string;
  familia_activa: boolean;
  tipo: TipoProducto;
  nombre: string;
  descripcion: string | null;
  foto_clave: string | null;
  precio: string | null;
  precio_sucursal: string | null;
  se_vende_solo: boolean;
  afectacion_igv: AfectacionIgv;
  aplica_icbper: boolean;
  estacion_id: string | null;
  tipo_control_stock: TipoControlStock;
  activo: boolean;
  disponible: boolean;
  ag_desde: Date | null;
  ag_dia: string | null;
  ag_hasta: HastaAgotado | null;
  ag_origen: OrigenAgotado | null;
}

interface FilaGrupo {
  producto_id: string;
  grupo_id: string;
  grupo_nombre: string;
  seleccion: Seleccion;
  minimo: number;
  maximo: number;
  modificador_id: string | null;
  modificador_nombre: string | null;
  precio_extra: string | null;
  ligado_id: string | null;
}

interface FilaComponente {
  combo_id: string;
  producto_id: string;
  cantidad: number;
}

export interface OpcionesDeCarga {
  sucursalId: string;
  diaOperativo: string;
  /** Solo este producto, sus componentes y sus productos ligados. */
  productoId?: string;
}

/** Las seis consultas fijas de la carta de una sucursal. */
export async function cargarCarta(
  conexion: Pick<Sequelize, 'query'>,
  { sucursalId, diaOperativo, productoId }: OpcionesDeCarga,
): Promise<CartaCargada> {
  const filtro = productoId ?? null;

  // 1. Productos con el ajuste y el agotado de la sucursal.
  const filas = await conexion.query<FilaProducto>(
    `SELECT p.id, p.familia_id, f.activa AS familia_activa, p.tipo, p.nombre, p.descripcion, p.foto_clave,
            p.precio, ps.precio AS precio_sucursal, p.se_vende_solo, p.afectacion_igv, p.aplica_icbper,
            p.estacion_id, p.tipo_control_stock, p.activo,
            coalesce(ps.disponible, true) AS disponible,
            ag.desde AS ag_desde, ag.dia_operativo::text AS ag_dia, ag.hasta AS ag_hasta,
            ag.origen AS ag_origen
       FROM producto p
       JOIN familia f ON f.id = p.familia_id
       LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = $1
       LEFT JOIN producto_agotado ag ON ag.producto_id = p.id AND ag.sucursal_id = $1
      WHERE $2::uuid IS NULL
         OR p.id = $2::uuid
         OR p.id IN (SELECT cc.producto_id FROM componente_combo cc WHERE cc.combo_id = $2::uuid)
         OR p.id IN (SELECT m.producto_id
                       FROM producto_grupo pg
                       JOIN modificador m ON m.grupo_id = pg.grupo_id AND m.activo
                      WHERE pg.producto_id = $2::uuid AND m.producto_id IS NOT NULL)
      ORDER BY p.orden, p.id`,
    { bind: [sucursalId, filtro], type: QueryTypes.SELECT },
  );

  // 2. Familias activas, en su orden.
  const familias = await conexion.query<{ id: string; nombre: string }>(
    'SELECT id, nombre FROM familia WHERE activa ORDER BY orden, id',
    { type: QueryTypes.SELECT },
  );

  // 3. Estaciones activas.
  const estaciones = await conexion.query<{ id: string; nombre: string }>(
    'SELECT id, nombre FROM estacion WHERE activa ORDER BY nombre, id',
    { type: QueryTypes.SELECT },
  );

  // 4. Grupos asignados con sus modificadores activos.
  const filasGrupo = await conexion.query<FilaGrupo>(
    `SELECT pg.producto_id, g.id AS grupo_id, g.nombre AS grupo_nombre, g.seleccion, g.minimo, g.maximo,
            m.id AS modificador_id, m.nombre AS modificador_nombre, m.precio_extra, m.producto_id AS ligado_id
       FROM producto_grupo pg
       JOIN grupo_modificadores g ON g.id = pg.grupo_id AND g.activo
       LEFT JOIN modificador m ON m.grupo_id = g.id AND m.activo
      WHERE $1::uuid IS NULL OR pg.producto_id = $1::uuid
      ORDER BY pg.producto_id, pg.orden, g.id, m.orden, m.id`,
    { bind: [filtro], type: QueryTypes.SELECT },
  );

  // 5. Componentes de combos y menús.
  const filasComponente = await conexion.query<FilaComponente>(
    `SELECT combo_id, producto_id, cantidad FROM componente_combo
      WHERE $1::uuid IS NULL OR combo_id = $1::uuid
      ORDER BY combo_id, orden, producto_id`,
    { bind: [filtro], type: QueryTypes.SELECT },
  );

  // 6. Opciones del día operativo actual.
  const filasOpcion = await conexion.query<{ producto_id: string; modificador_id: string }>(
    `SELECT producto_id, modificador_id FROM menu_del_dia_opcion
      WHERE sucursal_id = $1 AND dia_operativo = $2::date AND ($3::uuid IS NULL OR producto_id = $3::uuid)`,
    { bind: [sucursalId, diaOperativo, filtro], type: QueryTypes.SELECT },
  );

  const productos = filas.map(aProducto);
  const gruposDe = new Map<string, GrupoCargado[]>();
  for (const fila of filasGrupo) {
    const grupos = gruposDe.get(fila.producto_id) ?? [];
    let grupo = grupos[grupos.length - 1];
    if (grupo === undefined || grupo.id !== fila.grupo_id) {
      grupo = {
        id: fila.grupo_id,
        nombre: fila.grupo_nombre,
        seleccion: fila.seleccion,
        minimo: fila.minimo,
        maximo: fila.maximo,
        modificadores: [],
      };
      grupos.push(grupo);
    }
    if (fila.modificador_id !== null) {
      grupo.modificadores.push({
        id: fila.modificador_id,
        nombre: fila.modificador_nombre ?? '',
        precioExtra: fila.precio_extra ?? '0.00',
        productoLigadoId: fila.ligado_id,
      });
    }
    gruposDe.set(fila.producto_id, grupos);
  }
  const componentesDe = new Map<string, ComponenteCargado[]>();
  for (const fila of filasComponente) {
    const lista = componentesDe.get(fila.combo_id) ?? [];
    lista.push({ productoId: fila.producto_id, cantidad: fila.cantidad });
    componentesDe.set(fila.combo_id, lista);
  }
  const opcionesDelDia = new Map<string, Set<string>>();
  for (const fila of filasOpcion) {
    const elegidas = opcionesDelDia.get(fila.producto_id) ?? new Set<string>();
    elegidas.add(fila.modificador_id);
    opcionesDelDia.set(fila.producto_id, elegidas);
  }
  return {
    sucursalId,
    diaOperativo,
    productos,
    porId: new Map(productos.map((p) => [p.id, p])),
    familias,
    estaciones,
    gruposDe,
    componentesDe,
    opcionesDelDia,
  };
}

function aProducto(f: FilaProducto): ProductoCargado {
  return {
    id: f.id,
    familiaId: f.familia_id,
    familiaActiva: f.familia_activa,
    tipo: f.tipo,
    nombre: f.nombre,
    descripcion: f.descripcion,
    fotoClave: f.foto_clave,
    precio: f.precio,
    precioSucursal: f.precio_sucursal,
    seVendeSolo: f.se_vende_solo,
    afectacionIgv: f.afectacion_igv,
    aplicaIcbper: f.aplica_icbper,
    estacionId: f.estacion_id,
    tipoControlStock: f.tipo_control_stock,
    activo: f.activo,
    disponible: f.disponible,
    agotado:
      f.ag_desde === null || f.ag_dia === null || f.ag_hasta === null || f.ag_origen === null
        ? null
        : {
            desde: new Date(f.ag_desde),
            diaOperativo: f.ag_dia,
            hasta: f.ag_hasta,
            origen: f.ag_origen,
          },
  };
}
