import type {
  ProductoCrearEntrada,
  ProductoModificarEntrada,
  ProductoRespuesta,
} from '@restaurante/contratos';
import type { AfectacionIgv, TipoControlStock, TipoProducto } from '@restaurante/dominio';
import Decimal from 'decimal.js';
import { comoDecimal, montoComoTexto } from '../../lib/formato';
import { definicionDeTipo } from './tipos';

/** Valor de la opción "Ninguna" de la estación (el producto no va a cocina ni a barra). */
export const SIN_ESTACION = 'ninguna';

/** Un grupo de modificadores asignado al producto (003, criterio 6): su id y su nombre, en el orden en que se muestran. */
export interface GrupoDeProducto {
  id: string;
  nombre: string;
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
  return errores;
}

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
    ...(noDisponibleEn.length > 0 ? { noDisponibleEn } : {}),
  };
}

function mismoMonto(a: string | null, b: string): boolean {
  const x = a === null ? null : comoDecimal(a);
  const y = comoDecimal(b);
  if (x === null || y === null) return x === y;
  return x.equals(new Decimal(y));
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
    if (estacion !== original.estacionId) cambios.estacionId = estacion;
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
  return cambios;
}

export function hayCambios(cambios: ProductoModificarEntrada): boolean {
  return Object.keys(cambios).length > 0;
}

export const ETIQUETA_DE_AFECTACION: Record<AfectacionIgv, string> = {
  GRAVADO: 'Gravado con IGV',
  EXONERADO: 'Exonerado',
  INAFECTO: 'Inafecto',
};
