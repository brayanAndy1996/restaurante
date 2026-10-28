import type {
  GrupoEntrada,
  GrupoModificarEntrada,
  GrupoRespuesta,
  ModificadorEntrada,
} from '@restaurante/contratos';
import type { Seleccion } from '@restaurante/dominio';
import { ErrorApi, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { comoDecimal, montoComoTexto } from '../../lib/formato';

/** Lo que fija la API (003, criterios 24 y 25). */
export const MAXIMO_NOMBRE_GRUPO = 60;
export const MAXIMO_NOMBRE_OPCION = 60;
export const MAXIMO_OPCIONES = 50;
/** Un producto admite hasta 10 grupos (criterio 6). */
export const MAXIMO_GRUPOS_POR_PRODUCTO = 10;

/** Una opción del grupo tal como se edita. `id` solo existe si ya está guardada. */
export interface OpcionEditable {
  /** Identidad local, para que la fila no cambie de sitio al ordenar o quitar. */
  clave: string;
  id?: string;
  nombre: string;
  /** Precio extra tal como se escribe ("2.5"); vacío vale 0. */
  precioExtra: string;
  /** Producto ligado; `''` si no tiene. */
  productoId: string;
}

export interface EstadoDelGrupo {
  nombre: string;
  seleccion: Seleccion;
  /** Solo con selección única. */
  obligatorio: boolean;
  /** Solo con selección múltiple, tal como se escriben. */
  minimo: string;
  maximo: string;
  opciones: OpcionEditable[];
}

export interface ErroresDeOpcion {
  nombre?: string;
  precioExtra?: string;
  producto?: string;
}

export interface ErroresDelGrupo {
  nombre?: string;
  minimo?: string;
  maximo?: string;
  /** Error de la lista entera ("Agrega al menos una opción"). */
  opciones?: string;
  /** Por la `clave` de cada opción. */
  porOpcion: Record<string, ErroresDeOpcion>;
}

let contador = 0;
export function claveNueva(): string {
  contador += 1;
  return `opcion-${contador}`;
}

export function opcionVacia(): OpcionEditable {
  return { clave: claveNueva(), nombre: '', precioExtra: '', productoId: '' }; // el precio vacío vale 0
}

/** Grupo nuevo: una sola respuesta, opcional y con dos filas en blanco para empezar. */
export function grupoVacio(): EstadoDelGrupo {
  return {
    nombre: '',
    seleccion: 'UNICA',
    obligatorio: false,
    minimo: '0',
    maximo: '',
    opciones: [opcionVacia(), opcionVacia()],
  };
}

export function formularioDeGrupo(grupo: GrupoRespuesta): EstadoDelGrupo {
  return {
    nombre: grupo.nombre,
    seleccion: grupo.seleccion,
    obligatorio: grupo.obligatorio,
    minimo: String(grupo.minimo),
    maximo: String(grupo.maximo),
    opciones: grupo.modificadores.map((m) => ({
      clave: claveNueva(),
      id: m.id,
      nombre: m.nombre,
      precioExtra: m.precioExtra,
      productoId: m.producto?.id ?? '',
    })),
  };
}

// --- La regla en palabras -------------------------------------------------------------------------

interface ReglaDeGrupo {
  seleccion: Seleccion;
  minimo: number;
  maximo: number;
  obligatorio: boolean;
}

/**
 * La regla de un grupo dicha como la dice el negocio ("Elige 1, obligatorio", "Elige de 1 a 2,
 * obligatorio", "Hasta 3, opcional"). Es obligatorio cuando el mínimo es 1 o más (criterio 25).
 */
export function reglaEnPalabras(regla: ReglaDeGrupo): string {
  if (regla.seleccion === 'UNICA') {
    return `Elige 1, ${regla.obligatorio ? 'obligatorio' : 'opcional'}`;
  }
  if (regla.minimo >= 1) {
    return regla.minimo === regla.maximo
      ? `Elige ${regla.maximo}, obligatorio`
      : `Elige de ${regla.minimo} a ${regla.maximo}, obligatorio`;
  }
  return `Hasta ${regla.maximo}, opcional`;
}

export const reglaDeRespuesta = (g: GrupoRespuesta): string => reglaEnPalabras(g);

const ENTERO = /^\d{1,3}$/;

/** La regla de lo que se está escribiendo; `null` mientras el mínimo o el máximo no sean números válidos. */
export function reglaDelBorrador(estado: EstadoDelGrupo): string | null {
  if (estado.seleccion === 'UNICA') {
    return reglaEnPalabras({
      seleccion: 'UNICA',
      minimo: 0,
      maximo: 1,
      obligatorio: estado.obligatorio,
    });
  }
  if (!ENTERO.test(estado.minimo.trim()) || !ENTERO.test(estado.maximo.trim())) return null;
  const minimo = Number(estado.minimo);
  const maximo = Number(estado.maximo);
  if (maximo < 1 || minimo > maximo) return null;
  return reglaEnPalabras({ seleccion: 'MULTIPLE', minimo, maximo, obligatorio: minimo >= 1 });
}

/** "1 opción", "4 opciones". */
export function pluralOpciones(cantidad: number): string {
  return cantidad === 1 ? '1 opción' : `${cantidad} opciones`;
}

/** "Lo usa 1 producto", "Lo usan 3 productos". */
export function usoEnProductos(cantidad: number): string {
  if (cantidad === 0) return 'Ningún producto lo usa';
  return cantidad === 1 ? 'Lo usa 1 producto' : `Lo usan ${cantidad} productos`;
}

// --- Validación -----------------------------------------------------------------------------------

const largo = (texto: string) => Array.from(texto).length;

/** Una fila sin tocar (sin nombre, precio ni producto y que no estaba guardada) no cuenta como opción. */
export function estaEnBlanco(o: OpcionEditable): boolean {
  return (
    o.id === undefined &&
    o.nombre.trim() === '' &&
    o.precioExtra.trim() === '' &&
    o.productoId === ''
  );
}

/** Las opciones que de verdad se envían: sin las filas en blanco. */
export function opcionesParaEnviar(estado: EstadoDelGrupo): OpcionEditable[] {
  return estado.opciones.filter((o) => !estaEnBlanco(o));
}

export function hayErrores(errores: ErroresDelGrupo): boolean {
  return (
    errores.nombre !== undefined ||
    errores.minimo !== undefined ||
    errores.maximo !== undefined ||
    errores.opciones !== undefined ||
    Object.values(errores.porOpcion).some((e) => Object.keys(e).length > 0)
  );
}

/** Errores de cada campo, en español y con la salida ("Escribe el nombre del grupo"). */
export function validarGrupo(estado: EstadoDelGrupo): ErroresDelGrupo {
  const errores: ErroresDelGrupo = { porOpcion: {} };
  const nombre = estado.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre del grupo';
  else if (largo(nombre) > MAXIMO_NOMBRE_GRUPO) {
    errores.nombre = `Usa ${MAXIMO_NOMBRE_GRUPO} caracteres como máximo`;
  }

  const opciones = opcionesParaEnviar(estado);
  if (opciones.length === 0)
    errores.opciones = 'Agrega al menos una opción, por ejemplo «Término medio»';
  else if (opciones.length > MAXIMO_OPCIONES) {
    errores.opciones = `Un grupo admite hasta ${MAXIMO_OPCIONES} opciones`;
  }

  const vistos = new Set<string>();
  for (const o of opciones) {
    const fallas: ErroresDeOpcion = {};
    const texto = o.nombre.trim();
    if (texto === '') fallas.nombre = 'Escribe el nombre de la opción';
    else if (largo(texto) > MAXIMO_NOMBRE_OPCION) {
      fallas.nombre = `Usa ${MAXIMO_NOMBRE_OPCION} caracteres como máximo`;
    } else if (vistos.has(texto.toLowerCase())) {
      fallas.nombre = 'Ya hay una opción con este nombre. Usa otro.';
    }
    if (texto !== '') vistos.add(texto.toLowerCase());
    if (
      o.precioExtra.trim() !== '' &&
      montoComoTexto(o.precioExtra, { permitirCero: true }) === null
    ) {
      fallas.precioExtra = 'Escribe un monto válido, por ejemplo 2.50, o 0 si no cuesta más';
    }
    if (Object.keys(fallas).length > 0) errores.porOpcion[o.clave] = fallas;
  }

  if (estado.seleccion === 'MULTIPLE') {
    const min = estado.minimo.trim();
    const max = estado.maximo.trim();
    let minimo: number | null = null;
    let maximo: number | null = null;
    if (!ENTERO.test(min)) errores.minimo = 'Escribe cuántas como mínimo, o 0 si no es obligatorio';
    else minimo = Number(min);
    if (!ENTERO.test(max) || Number(max) < 1) {
      errores.maximo = 'Escribe cuántas se pueden elegir como máximo (1 o más)';
    } else if (Number(max) > MAXIMO_OPCIONES) {
      errores.maximo = `El máximo es ${MAXIMO_OPCIONES}`;
    } else maximo = Number(max);
    if (minimo !== null && maximo !== null && minimo > maximo) {
      errores.minimo = 'El mínimo no puede ser mayor que el máximo';
    } else if (minimo !== null && minimo > Math.max(opciones.length, 0) && opciones.length > 0) {
      errores.minimo = `El mínimo no puede ser mayor que las opciones que agregaste (${opciones.length})`;
    }
  }
  return errores;
}

// --- Lo que se envía ------------------------------------------------------------------------------

function modificadoresParaApi(estado: EstadoDelGrupo): ModificadorEntrada[] {
  return opcionesParaEnviar(estado).map((o) => ({
    ...(o.id === undefined ? {} : { id: o.id }),
    nombre: o.nombre.trim(),
    precioExtra: montoComoTexto(o.precioExtra, { permitirCero: true }) ?? '0.00',
    productoId: o.productoId === '' ? null : o.productoId,
  }));
}

/** Entrada de `POST /carta/grupos-modificadores` con lo que hay en el formulario (ya validado). */
export function entradaDeGrupo(estado: EstadoDelGrupo): GrupoEntrada {
  const nombre = estado.nombre.trim();
  const modificadores = modificadoresParaApi(estado);
  if (estado.seleccion === 'UNICA') {
    return { nombre, seleccion: 'UNICA', obligatorio: estado.obligatorio, modificadores };
  }
  return {
    nombre,
    seleccion: 'MULTIPLE',
    minimo: Number(estado.minimo),
    maximo: Number(estado.maximo),
    modificadores,
  };
}

function mismasOpciones(original: GrupoRespuesta, estado: EstadoDelGrupo): boolean {
  const enviadas = modificadoresParaApi(estado);
  if (enviadas.length !== original.modificadores.length) return false;
  return enviadas.every((e, i) => {
    const guardada = original.modificadores[i];
    if (!guardada) return false;
    const mismoPrecio = comoDecimal(e.precioExtra ?? '0.00')?.equals(
      comoDecimal(guardada.precioExtra) ?? 0,
    );
    return (
      e.id === guardada.id &&
      e.nombre === guardada.nombre &&
      mismoPrecio === true &&
      (e.productoId ?? null) === (guardada.producto?.id ?? null)
    );
  });
}

/**
 * Solo lo que cambió respecto del grupo guardado (`PATCH`, criterio 27). Si cambia la selección van sus
 * campos; si cambia cualquier opción, su orden o su precio, va la lista completa (la API la toma como la
 * lista nueva y pasa a inactivas las que no aparecen).
 */
export function cambiosDelGrupo(
  original: GrupoRespuesta,
  estado: EstadoDelGrupo,
): GrupoModificarEntrada {
  const cambios: GrupoModificarEntrada = {};
  const nombre = estado.nombre.trim();
  if (nombre !== original.nombre) cambios.nombre = nombre;

  if (estado.seleccion !== original.seleccion) {
    cambios.seleccion = estado.seleccion;
    if (estado.seleccion === 'UNICA') cambios.obligatorio = estado.obligatorio;
    else {
      cambios.minimo = Number(estado.minimo);
      cambios.maximo = Number(estado.maximo);
    }
  } else if (estado.seleccion === 'UNICA') {
    if (estado.obligatorio !== original.obligatorio) cambios.obligatorio = estado.obligatorio;
  } else if (
    Number(estado.minimo) !== original.minimo ||
    Number(estado.maximo) !== original.maximo
  ) {
    cambios.minimo = Number(estado.minimo);
    cambios.maximo = Number(estado.maximo);
  }

  if (!mismasOpciones(original, estado)) cambios.modificadores = modificadoresParaApi(estado);
  return cambios;
}

export function hayCambiosDeGrupo(cambios: GrupoModificarEntrada): boolean {
  return Object.keys(cambios).length > 0;
}

// --- Los errores de la API ------------------------------------------------------------------------

export interface FalloDeGrupo {
  /** Aviso general sobre el formulario; `null` si todo se dijo en sus campos. */
  mensaje: string | null;
  errores: ErroresDelGrupo;
}

/** `modificadores.2.nombre` → `{ indice: 2, campo: 'nombre' }`. */
function campoDeOpcion(campo: string): { indice: number; campo: string } | null {
  const m = /^modificadores\.(\d+)\.(\w+)$/.exec(campo);
  return m ? { indice: Number(m[1]), campo: m[2] ?? '' } : null;
}

/**
 * Lo que dice la API cuando rechaza el grupo, llevado a los campos del formulario. Los errores de una
 * opción llegan con su posición en la lista enviada (sin las filas en blanco): aquí se vuelve a su fila.
 */
export function falloDeGrupo(
  e: unknown,
  estado: EstadoDelGrupo,
  modo: 'crear' | 'editar',
): FalloDeGrupo {
  const errores: ErroresDelGrupo = { porOpcion: {} };
  if (!(e instanceof ErrorApi)) return { mensaje: mensajeDeError(e), errores };

  if (e.codigo === 'CONFLICTO') {
    if (modo === 'crear' && e.reintentada) {
      return {
        mensaje:
          'La conexión se cortó mientras se guardaba y es posible que el grupo ya se haya creado. Revisa la lista de grupos antes de intentarlo otra vez.',
        errores,
      };
    }
    errores.nombre = 'Ya tienes un grupo con ese nombre. Usa otro.';
    return { mensaje: null, errores };
  }

  if (e.codigo === 'DATOS_INVALIDOS' || e.codigo === 'REFERENCIA_INVALIDA') {
    const enviadas = opcionesParaEnviar(estado);
    for (const { campo, mensaje } of e.campos) {
      const deOpcion = campoDeOpcion(campo);
      if (deOpcion) {
        const fila = enviadas[deOpcion.indice];
        if (!fila) continue;
        const previos = errores.porOpcion[fila.clave] ?? {};
        if (deOpcion.campo === 'productoId') {
          previos.producto = 'Este producto ya no está disponible. Elige otro.';
        } else if (deOpcion.campo === 'precioExtra') {
          previos.precioExtra = mensajeDeCampo(mensaje);
        } else previos.nombre = mensajeDeCampo(mensaje);
        errores.porOpcion[fila.clave] = previos;
      } else if (campo === 'nombre') errores.nombre = mensajeDeCampo(mensaje);
      else if (campo === 'minimo' || campo === 'obligatorio')
        errores.minimo = mensajeDeCampo(mensaje);
      else if (campo === 'maximo') errores.maximo = mensajeDeCampo(mensaje);
      else if (campo === 'modificadores') errores.opciones = mensajeDeCampo(mensaje);
    }
    return { mensaje: mensajeDeError(e), errores };
  }

  return {
    mensaje: mensajeDeError(e, {
      PROHIBIDO: 'No tienes permiso para cambiar los grupos de modificadores.',
      NO_ENCONTRADO: 'Este grupo ya no existe. Vuelve a la lista de grupos.',
    }),
    errores,
  };
}

/**
 * Los productos que impiden desactivar un grupo: los que dijo la API en `usadoEn` y los que ya
 * conocíamos del grupo, sin repetir. La API es la que decide; esto solo sirve para nombrarlos.
 */
export function productosEnUso(
  e: unknown,
  grupo: Pick<GrupoRespuesta, 'productos'>,
): { id: string; nombre: string }[] {
  const porId = new Map<string, { id: string; nombre: string }>();
  if (e instanceof ErrorApi && e.usadoEn) {
    for (const c of e.usadoEn.combos) porId.set(c.id, { id: c.id, nombre: c.nombre });
  }
  for (const p of grupo.productos) porId.set(p.id, { id: p.id, nombre: p.nombre });
  return [...porId.values()];
}

/** "A", "A y B", "A, B y C": lista para una frase. */
export function listaEnFrase(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}
