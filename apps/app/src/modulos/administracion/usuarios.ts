import {
  pinRespuestaSchema,
  usuarioCreadoRespuestaSchema,
  usuarioModificadoRespuestaSchema,
  usuarioRespuestaSchema,
  type UsuarioCrearEntrada,
  type UsuarioModificarEntrada,
  type UsuarioRespuesta,
} from '@restaurante/contratos';
import { largoPin, type Rol, type RolDeAcceso, type TramoHorario } from '@restaurante/dominio';
import { erroresDeHorario, mismoHorario, ordenarTramos } from '@restaurante/ui';
import { api, listaDe } from '../../lib/api';
import { etiquetaDeRol } from '../../lib/formato';

export const CLAVE_USUARIOS = ['usuarios'] as const;

export const ROLES_ASIGNABLES: readonly RolDeAcceso[] = [
  'MOZO',
  'CAJERO',
  'COCINA_BARRA',
  'SUPERVISOR',
];

// --- Llamadas a la API ----------------------------------------------------------------------------

export const listarUsuarios = (senal?: AbortSignal) =>
  api.get('/usuarios', { esquema: listaDe(usuarioRespuestaSchema), ...(senal ? { senal } : {}) });

export const obtenerUsuario = (id: string, senal?: AbortSignal) =>
  api.get(`/usuarios/${id}`, { esquema: usuarioRespuestaSchema, ...(senal ? { senal } : {}) });

export const crearUsuario = (entrada: UsuarioCrearEntrada) =>
  api.post('/usuarios', entrada, { esquema: usuarioCreadoRespuestaSchema });

export const modificarUsuario = (id: string, cambios: UsuarioModificarEntrada) =>
  api.patch(`/usuarios/${id}`, cambios, { esquema: usuarioModificadoRespuestaSchema });

export const regenerarPin = (id: string) =>
  api.post(`/usuarios/${id}/pin`, undefined, { esquema: pinRespuestaSchema });

export const restablecerContrasena = (id: string, contrasenaTemporal: string) =>
  api.post(`/usuarios/${id}/contrasena`, { contrasenaTemporal });

// --- Reglas de presentación -----------------------------------------------------------------------

/** Nombre de una sucursal por su id; si no se conoce (otra empresa, borrada), un texto neutro. */
export type NombresDeSucursal = ReadonlyMap<string, string>;

/**
 * Resumen de los accesos para la segunda línea de una fila: "Administrador · todas las sucursales",
 * "Mozo · Miraflores", "Mozo en Miraflores, Cajero en Surco".
 */
export function resumenDeAccesos(usuario: UsuarioRespuesta, sucursales: NombresDeSucursal): string {
  if (usuario.esAdministrador) return 'Administrador · todas las sucursales';
  const nombre = (id: string) => sucursales.get(id) ?? 'otra sucursal';
  const accesos = usuario.accesos;
  if (accesos.length === 0) return 'Sin acceso a ninguna sucursal';
  const roles = new Set(accesos.map((a) => a.rol));
  if (roles.size === 1) {
    const rol = etiquetaDeRol(accesos[0]?.rol as Rol);
    return accesos.length === 1
      ? `${rol} · ${nombre(accesos[0]?.sucursalId ?? '')}`
      : `${rol} · ${accesos.length} sucursales`;
  }
  return accesos
    .slice(0, 2)
    .map((a) => `${etiquetaDeRol(a.rol)} en ${nombre(a.sucursalId)}`)
    .join(', ')
    .concat(accesos.length > 2 ? ` y ${accesos.length - 2} más` : '');
}

/** Contraseña temporal legible: sin 0/O ni 1/l/I, que se confunden al dictarse. */
export function generarContrasenaTemporal(largo = 10): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(largo);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

// --- Formulario ---------------------------------------------------------------------------------

export interface EstadoDelFormulario {
  nombre: string;
  /** Solo al crear: no se puede cambiar después. */
  nombreUsuario: string;
  /** Solo al crear. */
  contrasenaTemporal: string;
  esAdministrador: boolean;
  /** Rol por sucursal; vacío = sin acceso. */
  accesos: Record<string, RolDeAcceso | ''>;
  limitarHorario: boolean;
  horario: TramoHorario[];
}

export type ErroresDelFormulario = Partial<
  Record<'nombre' | 'nombreUsuario' | 'contrasenaTemporal' | 'accesos' | 'horario', string>
>;

export function formularioVacio(): EstadoDelFormulario {
  return {
    nombre: '',
    nombreUsuario: '',
    contrasenaTemporal: '',
    esAdministrador: false,
    accesos: {},
    limitarHorario: false,
    horario: [],
  };
}

export function formularioDeUsuario(usuario: UsuarioRespuesta): EstadoDelFormulario {
  return {
    nombre: usuario.nombre,
    nombreUsuario: usuario.nombreUsuario,
    contrasenaTemporal: '',
    esAdministrador: usuario.esAdministrador,
    accesos: Object.fromEntries(usuario.accesos.map((a) => [a.sucursalId, a.rol])),
    limitarHorario: usuario.horario !== null,
    horario: usuario.horario ?? [],
  };
}

const FORMATO_NOMBRE_USUARIO = /^[a-z0-9._-]{3,50}$/;

export function accesosDelFormulario(
  estado: EstadoDelFormulario,
): { sucursalId: string; rol: RolDeAcceso }[] {
  if (estado.esAdministrador) return [];
  return Object.entries(estado.accesos).flatMap(([sucursalId, rol]) =>
    rol ? [{ sucursalId, rol }] : [],
  );
}

/** Largo del PIN que tendrá la persona con estos datos, calculado por `packages/dominio`. */
export function largoDePinDelFormulario(estado: EstadoDelFormulario): 4 | 6 {
  return largoPin({
    esAdministrador: estado.esAdministrador,
    roles: accesosDelFormulario(estado).map((a) => a.rol),
  });
}

export function validarFormulario(
  estado: EstadoDelFormulario,
  modo: 'crear' | 'editar',
): ErroresDelFormulario {
  const errores: ErroresDelFormulario = {};
  const nombre = estado.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe el nombre de la persona';
  else if (Array.from(nombre).length > 100) errores.nombre = 'Usa 100 caracteres como máximo';

  if (modo === 'crear') {
    const usuario = estado.nombreUsuario.trim().toLowerCase();
    if (usuario === '') errores.nombreUsuario = 'Escribe un nombre de usuario';
    else if (!FORMATO_NOMBRE_USUARIO.test(usuario)) {
      errores.nombreUsuario =
        'Usa de 3 a 50 caracteres: letras, números, punto, guion o guion bajo';
    }
    const largo = Array.from(estado.contrasenaTemporal).length;
    if (largo === 0) errores.contrasenaTemporal = 'Escribe una contraseña temporal o genera una';
    else if (largo < 8) errores.contrasenaTemporal = 'Usa al menos 8 caracteres';
    else if (largo > 128) errores.contrasenaTemporal = 'Usa 128 caracteres como máximo';
  }

  if (!estado.esAdministrador && accesosDelFormulario(estado).length === 0) {
    errores.accesos = 'Elige el rol en al menos una sucursal';
  }

  if (!estado.esAdministrador && estado.limitarHorario) {
    if (estado.horario.length === 0) {
      errores.horario = 'Agrega al menos un tramo, o quita el límite de horario';
    } else if (erroresDeHorario(ordenarTramos(estado.horario)).length > 0) {
      errores.horario = 'Corrige los tramos marcados en rojo';
    }
  }
  return errores;
}

export function entradaDeCreacion(estado: EstadoDelFormulario): UsuarioCrearEntrada {
  return {
    nombre: estado.nombre.trim(),
    nombreUsuario: estado.nombreUsuario.trim().toLowerCase(),
    esAdministrador: estado.esAdministrador,
    accesos: accesosDelFormulario(estado),
    contrasenaTemporal: estado.contrasenaTemporal,
    ...(estado.esAdministrador || !estado.limitarHorario
      ? {}
      : { horario: ordenarTramos(estado.horario) }),
  };
}

function mismosAccesos(
  a: { sucursalId: string; rol: string }[],
  b: { sucursalId: string; rol: string }[],
): boolean {
  if (a.length !== b.length) return false;
  const mapa = new Map(a.map((x) => [x.sucursalId, x.rol]));
  return b.every((x) => mapa.get(x.sucursalId) === x.rol);
}

/**
 * Solo lo que cambió respecto del usuario guardado (`PATCH` reemplaza lo enviado). Hacer Administrador
 * a alguien que tenía horario envía también `horario: null`, como exige la API (criterio 106).
 */
export function cambiosDelUsuario(
  original: UsuarioRespuesta,
  estado: EstadoDelFormulario,
): UsuarioModificarEntrada {
  const cambios: UsuarioModificarEntrada = {};
  if (estado.nombre.trim() !== original.nombre) cambios.nombre = estado.nombre.trim();
  if (estado.esAdministrador !== original.esAdministrador)
    cambios.esAdministrador = estado.esAdministrador;
  const accesos = accesosDelFormulario(estado);
  if (!mismosAccesos(accesos, original.accesos)) cambios.accesos = accesos;
  if (estado.esAdministrador) {
    if (original.horario !== null) cambios.horario = null;
  } else {
    const horarioNuevo = estado.limitarHorario ? ordenarTramos(estado.horario) : null;
    if (!mismoHorario(horarioNuevo, original.horario)) cambios.horario = horarioNuevo;
  }
  return cambios;
}

export function hayCambios(cambios: UsuarioModificarEntrada): boolean {
  return Object.keys(cambios).length > 0;
}
