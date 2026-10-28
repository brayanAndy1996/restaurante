import {
  MAXIMO_COMPONENTES_POR_COMBO,
  type ComponenteEntrada,
  type ProductoCrearEntrada,
  type ProductoModificarEntrada,
  type ProductoRespuesta,
  type SeQuita,
  type UsadoEn,
} from '@restaurante/contratos';
import { CANTIDAD_MAXIMA_COMPONENTE } from '@restaurante/dominio';
import type { AfectacionIgv, TipoControlStock, TipoProducto } from '@restaurante/dominio';
import { comoDecimal, diaConFecha, montoComoTexto } from '../../lib/formato';
import { definicionDeTipo, tipoEnFrase } from './tipos';

/** Valor de la opción "Ninguna" de la estación (el producto no va a cocina ni a barra). */
export const SIN_ESTACION = 'ninguna';

/** Un grupo de modificadores asignado al producto (003, criterio 6): su id y su nombre, en el orden en que se muestran. */
export interface GrupoDeProducto {
  id: string;
  nombre: string;
}

/** Un componente fijo de un combo o un menú: un producto simple y cuántas unidades lleva (1 a 99). */
export interface ComponenteDeProducto {
  productoId: string;
  nombre: string;
  cantidad: number;
}

export interface EstadoDelProducto {
  tipo: TipoProducto;
  nombre: string;
  descripcion: string;
  familiaId: string;
  seVendeSolo: boolean;
  /** Precio tal como se escribe ("28.5"). */
  precio: string;
  /** Id de la estación, `SIN_ESTACION` o `''` si todavía no se eligió (se elige siempre). */
  estacionId: string;
  /** `''` si todavía no se eligió (no tiene valor por defecto, HU-05). */
  tipoControlStock: TipoControlStock | '';
  afectacionIgv: AfectacionIgv;
  aplicaIcbper: boolean;
  /** Grupos de modificadores, en orden. */
  grupos: GrupoDeProducto[];
  /** Componentes fijos (solo un combo o un menú del día), en orden. */
  componentes: ComponenteDeProducto[];
  /** Por sucursal: si el producto nace disponible. Solo en el alta. */
  disponibleEn: Record<string, boolean>;
}

export type CampoDelProducto =
  | 'nombre'
  | 'descripcion'
  | 'familiaId'
  | 'precio'
  | 'estacionId'
  | 'tipoControlStock'
  | 'gruposModificadores'
  | 'componentes'
  | 'noDisponibleEn';

export type ErroresDelProducto = Partial<Record<CampoDelProducto, string>>;

export const MAXIMO_NOMBRE = 100;
export const MAXIMO_DESCRIPCION = 500;

/** Formulario de un producto nuevo: simple, que se vende solo, gravado, y todo lo demás por elegir. */
export function formularioVacio(sucursalIds: readonly string[]): EstadoDelProducto {
  return {
    tipo: 'SIMPLE',
    nombre: '',
    descripcion: '',
    familiaId: '',
    seVendeSolo: true,
    precio: '',
    estacionId: '',
    tipoControlStock: '',
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    grupos: [],
    componentes: [],
    disponibleEn: Object.fromEntries(sucursalIds.map((id) => [id, true])),
  };
}

export function formularioDeProducto(producto: ProductoRespuesta): EstadoDelProducto {
  return {
    tipo: producto.tipo,
    nombre: producto.nombre,
    descripcion: producto.descripcion ?? '',
    familiaId: producto.familiaId,
    seVendeSolo: producto.seVendeSolo,
    precio: producto.precio ?? '',
    estacionId: producto.estacionId ?? SIN_ESTACION,
    tipoControlStock: producto.tipoControlStock,
    afectacionIgv: producto.afectacionIgv,
    aplicaIcbper: producto.aplicaIcbper,
    grupos: producto.grupos.map((g) => ({ id: g.id, nombre: g.nombre })),
    componentes: producto.componentes.map((c) => ({ ...c })),
    disponibleEn: {},
  };
}

const largo = (texto: string) => Array.from(texto).length;

/** Errores de cada campo, en español y con la salida ("Escribe el nombre del producto"). */
export function validarProducto(estado: EstadoDelProducto): ErroresDelProducto {
  const errores: ErroresDelProducto = {};
  const nombre = estado.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre del producto';
  else if (largo(nombre) > MAXIMO_NOMBRE) {
    errores.nombre = `Usa ${MAXIMO_NOMBRE} caracteres como máximo`;
  }
  if (largo(estado.descripcion.trim()) > MAXIMO_DESCRIPCION) {
    errores.descripcion = `Usa ${MAXIMO_DESCRIPCION} caracteres como máximo`;
  }
  if (estado.familiaId === '') errores.familiaId = 'Elige la familia del producto';

  const campos = definicionDeTipo(estado.tipo).campos;
  const llevaPrecio = !campos.seVendeSolo || estado.seVendeSolo;
  if (llevaPrecio) {
    const texto = estado.precio.trim();
    if (texto === '') errores.precio = 'Escribe el precio con IGV';
    else if (montoComoTexto(texto) === null) {
      const d = comoDecimal(texto);
      errores.precio =
        d !== null && d.isZero()
          ? 'El precio debe ser mayor que 0'
          : 'Escribe un monto válido, por ejemplo 28.50';
    }
  }
  if (campos.estacion && estado.estacionId === '') {
    errores.estacionId = 'Elige la estación, o "Ninguna" si no va a cocina ni a barra';
  }
  if (estado.tipoControlStock === '') {
    errores.tipoControlStock = 'Elige cómo se controla el stock';
  }
  if (campos.componentes) {
    // Un combo necesita algo que ofrecer; un menú del día, al menos un tiempo (criterio 7).
    if (estado.componentes.length > MAXIMO_COMPONENTES_POR_COMBO) {
      errores.componentes = `Un combo admite hasta ${MAXIMO_COMPONENTES_POR_COMBO} componentes. Quita alguno.`;
    } else if (estado.tipo === 'COMBO' && estado.componentes.length + estado.grupos.length === 0) {
      errores.componentes = 'Agrega al menos un componente o un grupo de opciones';
    }
    if (estado.tipo === 'MENU_DEL_DIA' && estado.grupos.length === 0) {
      errores.gruposModificadores =
        'Agrega al menos un grupo: cada grupo es un tiempo del menú, como Entrada o Segundo';
    }
  }
  return errores;
}

const componentesParaApi = (lista: readonly ComponenteDeProducto[]): ComponenteEntrada[] =>
  lista.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad }));

/** Id de la estación para la API: `null` es "ninguna". Solo se llama con la estación ya elegida. */
function estacionParaApi(estado: EstadoDelProducto): string | null {
  return estado.estacionId === SIN_ESTACION || estado.estacionId === '' ? null : estado.estacionId;
}

/**
 * Entrada de `POST /carta/productos` con lo que hay en el formulario. `noDisponibleEn` son las
 * sucursales desmarcadas; las bloqueadas (donde la persona no puede decidir) siguen marcadas y no van.
 */
export function entradaDeCreacion(estado: EstadoDelProducto): ProductoCrearEntrada {
  const campos = definicionDeTipo(estado.tipo).campos;
  const seVendeSolo = campos.seVendeSolo ? estado.seVendeSolo : true;
  const noDisponibleEn = Object.entries(estado.disponibleEn)
    .filter(([, disponible]) => !disponible)
    .map(([id]) => id);
  const descripcion = estado.descripcion.trim();
  return {
    tipo: estado.tipo,
    nombre: estado.nombre.trim(),
    ...(descripcion === '' ? {} : { descripcion }),
    familiaId: estado.familiaId,
    seVendeSolo,
    ...(seVendeSolo ? { precio: montoComoTexto(estado.precio) } : {}),
    afectacionIgv: estado.afectacionIgv,
    aplicaIcbper: estado.aplicaIcbper,
    ...(campos.estacion ? { estacionId: estacionParaApi(estado) } : {}),
    tipoControlStock: estado.tipoControlStock as TipoControlStock,
    ...(estado.grupos.length > 0 ? { gruposModificadores: estado.grupos.map((g) => g.id) } : {}),
    ...(campos.componentes && estado.componentes.length > 0
      ? { componentes: componentesParaApi(estado.componentes) }
      : {}),
    ...(noDisponibleEn.length > 0 ? { noDisponibleEn } : {}),
  };
}

function mismoMonto(a: string | null, b: string): boolean {
  const x = a === null ? null : comoDecimal(a);
  const y = comoDecimal(b);
  if (x === null || y === null) return x === y;
  return x.equals(y);
}

/**
 * Solo lo que cambió respecto del producto guardado (`PATCH`). Dejar de venderse solo manda también
 * `precio: null`; volver a venderse solo manda el precio, como pide la API (criterio 7).
 */
export function cambiosDelProducto(
  original: ProductoRespuesta,
  estado: EstadoDelProducto,
): ProductoModificarEntrada {
  const cambios: ProductoModificarEntrada = {};
  const cambiaElTipo = estado.tipo !== original.tipo;
  if (cambiaElTipo) cambios.tipo = estado.tipo;
  const nombre = estado.nombre.trim();
  if (nombre !== original.nombre) cambios.nombre = nombre;
  const descripcion = estado.descripcion.trim() === '' ? null : estado.descripcion.trim();
  if (descripcion !== original.descripcion) cambios.descripcion = descripcion;
  if (estado.familiaId !== original.familiaId) cambios.familiaId = estado.familiaId;

  const campos = definicionDeTipo(estado.tipo).campos;
  const seVendeSolo = campos.seVendeSolo ? estado.seVendeSolo : true;
  if (seVendeSolo !== original.seVendeSolo) {
    cambios.seVendeSolo = seVendeSolo;
    cambios.precio = seVendeSolo ? montoComoTexto(estado.precio) : null;
  } else if (seVendeSolo && !mismoMonto(original.precio, estado.precio)) {
    cambios.precio = montoComoTexto(estado.precio);
  }
  if (campos.estacion) {
    const estacion = estacionParaApi(estado);
    // Al pasar a simple la estación va siempre, aunque sea "Ninguna": la API la exige para que nadie
    // quede sin estación por omisión (criterio 10b).
    if (estacion !== original.estacionId || cambiaElTipo) cambios.estacionId = estacion;
  }
  if (estado.tipoControlStock !== '' && estado.tipoControlStock !== original.tipoControlStock) {
    cambios.tipoControlStock = estado.tipoControlStock;
  }
  if (estado.afectacionIgv !== original.afectacionIgv) cambios.afectacionIgv = estado.afectacionIgv;
  if (estado.aplicaIcbper !== original.aplicaIcbper) cambios.aplicaIcbper = estado.aplicaIcbper;
  // La lista de grupos reemplaza a la anterior completa; el orden cuenta.
  const grupos = estado.grupos.map((g) => g.id);
  const guardados = original.grupos.map((g) => g.id);
  if (grupos.length !== guardados.length || grupos.some((id, i) => id !== guardados[i])) {
    cambios.gruposModificadores = grupos;
  }
  // Los componentes reemplazan a los anteriores completos. Al pasar a simple no se mandan: la API los
  // quita (y los lista en `seQuita`); un simple no lleva componentes (criterio 7).
  if (campos.componentes) {
    const nuevos = estado.componentes;
    const previos = original.componentes;
    const igual =
      nuevos.length === previos.length &&
      nuevos.every(
        (c, i) => c.productoId === previos[i]?.productoId && c.cantidad === previos[i]?.cantidad,
      );
    if (!igual) cambios.componentes = componentesParaApi(nuevos);
  }
  return cambios;
}

/**
 * Lo que cambia el formulario al elegir otro tipo (criterio 72). Los datos que el tipo nuevo no usa se
 * conservan en el formulario (volver al tipo anterior los recupera); solo la estación se pide de nuevo al
 * pasar a simple un producto que no lo era, para que nadie quede "sin estación" por omisión (criterio 10b).
 */
export function cambiarDeTipo(
  estado: EstadoDelProducto,
  tipo: TipoProducto,
  original?: ProductoRespuesta,
): EstadoDelProducto {
  if (tipo === estado.tipo) return estado;
  const siguiente: EstadoDelProducto = { ...estado, tipo };
  if (tipo === 'SIMPLE' && original && original.tipo !== 'SIMPLE') {
    siguiente.estacionId = '';
  } else if (tipo === 'SIMPLE' && original) {
    siguiente.estacionId = original.estacionId ?? SIN_ESTACION;
  }
  return siguiente;
}

/**
 * Avisos de lo que pasará al guardar un cambio de tipo, dichos antes de guardar (la hoja de confirmación
 * dice lo mismo con los datos exactos que da la API). Vacío si el tipo no cambia o no se pierde nada.
 */
export function avisosDeCambioDeTipo(
  original: ProductoRespuesta,
  tipo: TipoProducto,
  nombreDeEstacion: string | null,
): string[] {
  if (tipo === original.tipo) return [];
  const avisos: string[] = [];
  if (tipo === 'SIMPLE') {
    if (original.componentes.length > 0) {
      avisos.push(
        original.componentes.length === 1
          ? 'Se quitará su componente.'
          : `Se quitarán sus ${original.componentes.length} componentes.`,
      );
    }
    if (original.tipo === 'MENU_DEL_DIA') {
      avisos.push('Se borrarán las opciones del día ya armadas en todas las sucursales.');
    }
    avisos.push('Elige la estación donde se prepara.');
    return avisos;
  }
  if (original.tipo === 'SIMPLE') {
    avisos.push(
      nombreDeEstacion
        ? `Se quitará la estación ${nombreDeEstacion}: ${tipoEnFrase(tipo)} no tiene estación propia, cada componente y cada opción va a la suya.`
        : `Un ${tipoEnFrase(tipo)} no tiene estación propia: cada componente y cada opción va a la suya.`,
    );
    if (!original.seVendeSolo)
      avisos.push('Escribe su precio: un combo o un menú siempre se vende solo.');
  }
  if (original.tipo === 'MENU_DEL_DIA') {
    avisos.push('Se borrarán las opciones del día ya armadas en todas las sucursales.');
  }
  if (tipo === 'MENU_DEL_DIA') avisos.push(AVISO_MENU_SIN_ARMAR);
  return avisos;
}

/** Se dice al crear un menú del día y al pasar a él (criterio 72). */
export const AVISO_MENU_SIN_ARMAR =
  'No se podrá vender hasta armar sus opciones del día en cada sucursal, en Disponibilidad › Menú del día.';

// --- Lo que dice la API en palabras ----------------------------------------------------------------

/** "Se quitará la estación Cocina.", "Se quitarán los componentes: Hamburguesa clásica × 1." (criterio 10b). */
export function frasesDeSeQuita(seQuita: SeQuita): string[] {
  const frases: string[] = [];
  if (seQuita.estacion) frases.push(`Se quitará la estación ${seQuita.estacion.nombre}.`);
  if (seQuita.componentes.length > 0) {
    const lista = seQuita.componentes.map((c) => `${c.nombre} × ${c.cantidad}`).join(', ');
    frases.push(
      seQuita.componentes.length === 1
        ? `Se quitará el componente: ${lista}.`
        : `Se quitarán los componentes: ${lista}.`,
    );
  }
  for (const d of seQuita.opcionesDelDia) {
    frases.push(
      `${d.opciones === 1 ? 'Se borrará la opción' : 'Se borrarán las opciones'} del menú del ${diaConFecha(d.dia)} en ${d.sucursalNombre} (${d.opciones}).`,
    );
  }
  return frases;
}

/** Lo que `EN_USO` dice que lo usa: "Combo hamburguesa", "Bebida del combo › Inca Kola" (criterio 10c). */
export function usosDeProducto(usadoEn: UsadoEn): { combos: string[]; opciones: string[] } {
  return {
    combos: usadoEn.combos.map((c) => c.nombre),
    opciones: usadoEn.modificadores.map((m) => `${m.grupoNombre} › ${m.nombre}`),
  };
}

export { CANTIDAD_MAXIMA_COMPONENTE, MAXIMO_COMPONENTES_POR_COMBO };

export function hayCambios(cambios: ProductoModificarEntrada): boolean {
  return Object.keys(cambios).length > 0;
}

export const ETIQUETA_DE_AFECTACION: Record<AfectacionIgv, string> = {
  GRAVADO: 'Gravado con IGV',
  EXONERADO: 'Exonerado',
  INAFECTO: 'Inafecto',
};
