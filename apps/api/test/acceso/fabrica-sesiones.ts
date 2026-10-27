// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ayudantes de las pruebas de acceso del grupo 1 (sesiones, ingreso con contraseña, usuarios y
// horario). Solo usan los contratos públicos de la sección: HTTP (supertest), `crearSuperadministrador`
// y consultas de inspección a la base como administrador (solo lectura, para comprobar filas).
//
// Convenciones de estas pruebas:
// - La aplicación real corre con un `RelojManual` y sin `EMPRESA_POR_HEADER`.
// - Las empresas A y B se dan de alta con `POST /plataforma/empresas`, con la sesión de un
//   superadministrador creado con `crearSuperadministrador`; los usuarios, con `POST /usuarios`.
// - Cada prueba crea sus propios usuarios (nombres únicos): las pruebas comparten la base.
// - Las pruebas que dependen de funciones de grupos posteriores de la fase C llevan una etiqueta en su
//   nombre: `[C1]` (suscripciones y alta del Administrador), `[C2]` (equipos recordados y PIN) o
//   `[C3]` (clave de supervisor). Sin etiqueta, valen al cerrar el grupo C0.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { validarRuc, type TramoHorario } from '@restaurante/dominio';
import request from 'supertest';
import { expect } from 'vitest';
import { crearSuperadministrador } from '../../scripts/lib/superadministrador';
import { crearAplicacion } from '../../src/aplicacion';
import { RelojManual } from '../../src/nucleo/reloj';
import { conCliente, fijarEntornoDePrueba } from '../utilidades';

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Lunes 2 de noviembre de 2026, 10:00 en Lima. */
export const HORA_INICIAL = '2026-11-02T10:00:00-05:00';
export const CONTRASENA_TEMPORAL = 'Temporal-Prueba-1';
export const CONTRASENA_DEFINITIVA = 'Definitiva-Prueba-1';
export const CONTRASENA_SUPERADMIN = 'Superadmin-Prueba-1';
export const UUID_CERO = '00000000-0000-4000-8000-000000000000';

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;

/** Lista cerrada de rutas públicas (criterio 1). */
export const RUTAS_PUBLICAS = [
  'GET /health',
  'POST /sesiones/contrasena',
  'POST /sesiones/pin',
  'GET /equipo',
  'POST /plataforma/sesiones',
];

export type RolDeAcceso = 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR';

// ---------------------------------------------------------------------------------------------
// Datos aleatorios
// ---------------------------------------------------------------------------------------------

const FACTORES_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** RUC válido y aleatorio (único entre archivos paralelos). */
export function rucAleatorio(): string {
  const cuerpo = '20' + String(randomInt(0, 100_000_000)).padStart(8, '0');
  let suma = 0;
  for (let i = 0; i < FACTORES_RUC.length; i++) suma += Number(cuerpo[i]) * FACTORES_RUC[i]!;
  const resto = 11 - (suma % 11);
  const ruc = cuerpo + String(resto >= 10 ? resto - 10 : resto);
  if (!validarRuc(ruc)) throw new Error(`El ayudante generó un RUC inválido: ${ruc}`);
  return ruc;
}

/** Texto único por llamada. */
export function textoUnico(prefijo: string): string {
  return `${prefijo}-${randomUUID().slice(0, 12)}`;
}

/** Nombre de usuario válido (minúsculas) y único en todo el sistema. */
export function nombreUnico(prefijo: string): string {
  return `${prefijo}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Secreto con la forma de los tokens: 32 bytes en base64url (43 caracteres). */
export function secretoAleatorio(): string {
  return Buffer.from(Array.from({ length: 32 }, () => randomInt(0, 256))).toString('base64url');
}

// ---------------------------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------------------------

export type MetodoHttp = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpcionesPeticion {
  /** Token de sesión (`se.…` o `sa.…`), va en `Authorization: Bearer`. */
  token?: string;
  /** Token de equipo, va en `X-Equipo`. */
  equipo?: string;
  cuerpo?: unknown;
  /** Cuerpo JSON crudo (para enviar escapes que `JSON.stringify` no produce). */
  crudo?: string;
  segundoPlano?: boolean;
  /** `Idempotency-Key`. */
  clave?: string;
  /** `X-Autorizacion`. */
  autorizacion?: string;
  cabeceras?: Record<string, string>;
}

export interface Respuesta {
  status: number;
  body: any;
  text: string;
  headers: Record<string, any>;
}

/** Cliente de la aplicación de prueba. Escucha en un puerto propio para admitir peticiones concurrentes. */
export class Api {
  constructor(private readonly app: INestApplication) {}

  async llamar(metodo: MetodoHttp, ruta: string, op: OpcionesPeticion = {}): Promise<Respuesta> {
    let req = request(this.app.getHttpServer())[metodo](ruta);
    if (op.token !== undefined) req = req.set('Authorization', `Bearer ${op.token}`);
    if (op.equipo !== undefined) req = req.set('X-Equipo', op.equipo);
    if (op.segundoPlano) req = req.set('X-Actividad', 'segundo-plano');
    if (op.clave !== undefined) req = req.set('Idempotency-Key', op.clave);
    if (op.autorizacion !== undefined) req = req.set('X-Autorizacion', op.autorizacion);
    for (const [nombre, valor] of Object.entries(op.cabeceras ?? {})) req = req.set(nombre, valor);
    if (op.crudo !== undefined) req = req.set('Content-Type', 'application/json').send(op.crudo);
    else if (op.cuerpo !== undefined) req = req.send(op.cuerpo as object);
    const res = await req;
    return { status: res.status, body: res.body, text: res.text, headers: res.headers };
  }

  get(ruta: string, op?: OpcionesPeticion) {
    return this.llamar('get', ruta, op);
  }
  post(ruta: string, op?: OpcionesPeticion) {
    return this.llamar('post', ruta, op);
  }
  put(ruta: string, op?: OpcionesPeticion) {
    return this.llamar('put', ruta, op);
  }
  patch(ruta: string, op?: OpcionesPeticion) {
    return this.llamar('patch', ruta, op);
  }
  delete(ruta: string, op?: OpcionesPeticion) {
    return this.llamar('delete', ruta, op);
  }
}

/** Comprueba estado y código de error (la forma `{ codigo, mensaje, campos? }` de la historia 001). */
export function esperarError(res: Respuesta, status: number, codigo: string): void {
  expect(res.status, `${res.status} ${res.text}`).toBe(status);
  expect(res.body).toMatchObject({ codigo });
  expect(typeof res.body.mensaje).toBe('string');
  esperarSinDetallesDeBd(res);
}

/** Ninguna respuesta de error deja ver detalles de PostgreSQL. */
export function esperarSinDetallesDeBd(res: Respuesta): void {
  expect(res.text).not.toMatch(
    /SQLSTATE|violates|duplicate key|syntax error|relation "|constraint|pg_catalog|restaurante_(api|plataforma|migrador)|stack|at Object\./i,
  );
}

/** Reemplaza los parámetros de ruta (`:id`, `:equipoRecordadoId`…) por un UUID. */
export function rutaConId(ruta: string, id: string = UUID_CERO): string {
  return ruta.replace(/:[A-Za-z]+/g, id);
}

// ---------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ---------------------------------------------------------------------------------------------

export async function filas<T = Record<string, any>>(
  sql: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  return conCliente('admin', async (cliente) => {
    const resultado = await cliente.query(sql, parametros as any[]);
    return resultado.rows as T[];
  });
}

/** Sesiones de empresa de un usuario, de la más antigua a la más nueva. */
export async function sesionesDe(
  usuarioId: string,
): Promise<{ id: string; tipo: string; cerrada_en: Date | null; sucursal_id: string | null }[]> {
  return filas(
    'SELECT id, tipo, cerrada_en, sucursal_id FROM sesion WHERE usuario_id = $1 ORDER BY creado_en',
    [usuarioId],
  );
}

/** Filas de auditoría de una empresa (como JSON), de la más antigua a la más nueva. */
export async function auditoriaDe(
  empresaId: string | null,
  accion?: string,
): Promise<Record<string, any>[]> {
  const resultado = await filas<{ fila: Record<string, any> }>(
    `SELECT to_jsonb(a) AS fila FROM auditoria a
      WHERE a.empresa_id IS NOT DISTINCT FROM $1::uuid
        AND ($2::text IS NULL OR a.accion = $2)
      ORDER BY a.ocurrido_en, a.id`,
    [empresaId, accion ?? null],
  );
  return resultado.map((r) => r.fila);
}

/** Huellas SHA-256 admitidas para un secreto de token: sobre los bytes decodificados o sobre el texto. */
export function huellasPosibles(secreto: string): string[] {
  return [
    createHash('sha256').update(Buffer.from(secreto, 'base64url')).digest('hex'),
    createHash('sha256').update(secreto, 'utf8').digest('hex'),
  ];
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** Partes de un token: `se.<empresa>.<sesion>.<secreto>`, `eq.<empresa>.<equipo>.<secreto>` o `sa.<sesion>.<secreto>`. */
export function partesDeToken(token: string): {
  prefijo: string;
  empresaId: string | null;
  id: string;
  secreto: string;
} {
  const partes = token.split('.');
  if (partes[0] === 'sa')
    return { prefijo: 'sa', empresaId: null, id: partes[1]!, secreto: partes[2]! };
  return { prefijo: partes[0]!, empresaId: partes[1]!, id: partes[2]!, secreto: partes[3]! };
}

export function armarToken(
  prefijo: 'se' | 'eq',
  empresaId: string,
  id: string,
  secreto: string,
): string {
  return `${prefijo}.${empresaId}.${id}.${secreto}`;
}

// ---------------------------------------------------------------------------------------------
// Escenario: aplicación, reloj, superadministrador y empresas A y B
// ---------------------------------------------------------------------------------------------

export interface EmpresaDePrueba {
  id: string;
  nombre: string;
  emisores: { id: string; ruc: string }[];
  sucursales: { id: string; nombre: string }[];
  admin: { id: string; nombreUsuario: string; contrasena: string; pin: string };
}

export interface SuperadminDePrueba {
  id: string;
  usuario: string;
  contrasena: string;
}

export interface Escenario {
  app: INestApplication;
  api: Api;
  reloj: RelojManual;
  superadmin: SuperadminDePrueba;
  A: EmpresaDePrueba;
  B: EmpresaDePrueba;
}

export interface OpcionesEscenario {
  controladoresExtra?: Type[];
  poolMax?: number;
  sucursalesPorEmpresa?: number;
  logger?: false | ('log' | 'error' | 'warn' | 'debug' | 'verbose')[];
}

/** Crea un superadministrador con la vía de plataforma (`crearSuperadministrador`). */
export async function crearSuperadmin(): Promise<SuperadminDePrueba> {
  const usuario = nombreUnico('sa');
  const { id } = await crearSuperadministrador({
    usuario,
    nombre: 'Superadministrador de prueba',
    contrasena: CONTRASENA_SUPERADMIN,
  });
  return { id, usuario, contrasena: CONTRASENA_SUPERADMIN };
}

/** Ingresa como superadministrador y devuelve su token `sa.…`. */
export async function ingresarSuperadmin(api: Api, sa: SuperadminDePrueba): Promise<string> {
  const res = await api.post('/plataforma/sesiones', {
    cuerpo: { usuario: sa.usuario, contrasena: sa.contrasena },
  });
  if (res.status !== 201) {
    throw new Error(`No se pudo ingresar como superadministrador (${res.status}): ${res.text}`);
  }
  return res.body.token as string;
}

/** Ingresa con usuario y contraseña (respuesta cruda). */
export function ingresar(api: Api, usuario: string, contrasena: string, op: OpcionesPeticion = {}) {
  return api.post('/sesiones/contrasena', { ...op, cuerpo: { usuario, contrasena } });
}

/** Ingreso que debe salir bien; devuelve `{ token, sesion }`. */
export async function ingresarOk(
  api: Api,
  usuario: string,
  contrasena: string,
): Promise<{ token: string; sesion: any }> {
  const res = await ingresar(api, usuario, contrasena);
  if (res.status !== 201) {
    throw new Error(`No se pudo ingresar como ${usuario} (${res.status}): ${res.text}`);
  }
  return { token: res.body.token as string, sesion: res.body.sesion };
}

/**
 * Ingresa con la contraseña temporal y la cambia por la definitiva. Devuelve el token de esa sesión
 * (sigue válida después del cambio).
 */
export async function activarCuenta(
  api: Api,
  usuario: string,
  temporal: string,
  definitiva: string = CONTRASENA_DEFINITIVA,
): Promise<string> {
  const { token } = await ingresarOk(api, usuario, temporal);
  const cambio = await api.put('/sesion/contrasena', {
    token,
    cuerpo: { actual: temporal, nueva: definitiva },
  });
  if (cambio.status !== 204) {
    throw new Error(
      `No se pudo activar la cuenta de ${usuario} (${cambio.status}): ${cambio.text}`,
    );
  }
  return token;
}

/** Da de alta una empresa con `POST /plataforma/empresas` y deja activo a su primer Administrador. */
export async function altaEmpresa(
  api: Api,
  tokenSuperadmin: string,
  opciones: { sucursales?: number } = {},
): Promise<EmpresaDePrueba> {
  const ruc = rucAleatorio();
  const cantidad = opciones.sucursales ?? 2;
  const nombreUsuario = nombreUnico('admin');
  const sucursales = Array.from({ length: cantidad }, (_, i) => ({
    rucEmisor: ruc,
    nombre: textoUnico('Sucursal'),
    codigoEstablecimiento: String(i + 1).padStart(4, '0'),
    direccion: `Av. Prueba ${randomInt(1, 9999)}, Lima`,
  }));
  const cuerpo = {
    nombre: textoUnico('Empresa'),
    emisores: [{ ruc, razonSocial: textoUnico('Razón social'), regimen: 'GENERAL' }],
    sucursales,
    administrador: {
      nombre: 'Administradora de prueba',
      nombreUsuario,
      contrasenaTemporal: CONTRASENA_TEMPORAL,
    },
    motivo: 'Alta de prueba',
  };
  const res = await api.post('/plataforma/empresas', { token: tokenSuperadmin, cuerpo });
  if (res.status !== 201) {
    throw new Error(`No se pudo dar de alta la empresa de prueba (${res.status}): ${res.text}`);
  }
  await activarCuenta(api, nombreUsuario, CONTRASENA_TEMPORAL);
  const creadas = res.body.sucursales as { id: string; nombre: string }[];
  return {
    id: res.body.empresaId,
    nombre: cuerpo.nombre,
    emisores: res.body.emisores,
    // En el orden en que se enviaron.
    sucursales: sucursales.map((s) => {
      const creada = creadas.find((c) => c.nombre === s.nombre);
      if (!creada) throw new Error(`La sucursal ${s.nombre} no vino en la respuesta del alta`);
      return { id: creada.id, nombre: creada.nombre };
    }),
    admin: {
      id: res.body.administrador.id,
      nombreUsuario,
      contrasena: CONTRASENA_DEFINITIVA,
      pin: res.body.administrador.pin,
    },
  };
}

/** Prepara la aplicación, el reloj, el superadministrador y las empresas A y B. */
export async function prepararEscenario(opciones: OpcionesEscenario = {}): Promise<Escenario> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 2, empresaPorHeader: false });
  const reloj = new RelojManual(HORA_INICIAL);
  const app = await crearAplicacion({
    reloj,
    controladoresExtra: opciones.controladoresExtra,
    logger: opciones.logger ?? false,
  });
  try {
    await app.listen(0);
    const api = new Api(app);
    const superadmin = await crearSuperadmin();
    const token = await ingresarSuperadmin(api, superadmin);
    const A = await altaEmpresa(api, token, { sucursales: opciones.sucursalesPorEmpresa });
    const B = await altaEmpresa(api, token, { sucursales: opciones.sucursalesPorEmpresa });
    return { app, api, reloj, superadmin, A, B };
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Escenario que se arma al usarlo por primera vez. Si falta la funcionalidad (por ejemplo
 * `crearSuperadministrador` sin implementar), cada prueba que lo pide falla con ese mismo error, en
 * lugar de que falle el `beforeAll` completo.
 */
export function escenarioPerezoso(opciones: OpcionesEscenario = {}): {
  obtener: () => Promise<Escenario>;
  cerrar: () => Promise<void>;
} {
  let promesa: Promise<Escenario> | undefined;
  return {
    obtener: () => (promesa ??= prepararEscenario(opciones)),
    cerrar: async () => {
      if (!promesa) return;
      const escenario = await promesa.catch(() => undefined);
      await escenario?.app.close();
    },
  };
}

/** Nueva sesión del superadministrador del escenario. */
export function sesionSuperadmin(esc: Escenario): Promise<string> {
  return ingresarSuperadmin(esc.api, esc.superadmin);
}

/** Nueva sesión del primer Administrador de la empresa (un ingreso nuevo cada vez). */
export function sesionAdmin(esc: Escenario, empresa: EmpresaDePrueba) {
  return ingresarOk(esc.api, empresa.admin.nombreUsuario, empresa.admin.contrasena);
}

// ---------------------------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------------------------

export interface AccesoPrueba {
  /** Posición de la sucursal en `empresa.sucursales`. */
  sucursal: number;
  rol: RolDeAcceso;
}

export interface DatosUsuarioPrueba {
  nombre?: string;
  nombreUsuario?: string;
  esAdministrador?: boolean;
  accesos?: AccesoPrueba[];
  /** Se asigna después de activar la cuenta (el ingreso de activación no depende del horario). */
  horario?: TramoHorario[];
  /** Por defecto `true`: ingresa con la temporal y la cambia por `CONTRASENA_DEFINITIVA`. */
  activar?: boolean;
  /** Sesión de Administrador a reutilizar; si no, se abre una nueva. */
  tokenAdmin?: string;
}

export interface UsuarioPrueba {
  id: string;
  nombre: string;
  nombreUsuario: string;
  /** La definitiva si se activó; si no, la temporal. */
  contrasena: string;
  pin: string;
  empresa: EmpresaDePrueba;
  /** Sesión de contraseña de la activación (`null` si no se activó). */
  token: string | null;
  respuesta: any;
}

/** Cuerpo de `POST /usuarios` para los accesos indicados. */
export function accesosPorHttp(empresa: EmpresaDePrueba, accesos: AccesoPrueba[]) {
  return accesos.map((a) => ({ sucursalId: empresa.sucursales[a.sucursal]!.id, rol: a.rol }));
}

/** Crea un usuario con `POST /usuarios` (como el Administrador de la empresa) y, por defecto, lo activa. */
export async function crearUsuario(
  esc: Escenario,
  empresa: EmpresaDePrueba,
  datos: DatosUsuarioPrueba = {},
): Promise<UsuarioPrueba> {
  const tokenAdmin = datos.tokenAdmin ?? (await sesionAdmin(esc, empresa)).token;
  const nombre = datos.nombre ?? 'Persona de prueba';
  const nombreUsuario = datos.nombreUsuario ?? nombreUnico('u');
  const esAdministrador = datos.esAdministrador ?? false;
  const accesos = esAdministrador
    ? []
    : accesosPorHttp(empresa, datos.accesos ?? [{ sucursal: 0, rol: 'CAJERO' }]);
  const res = await esc.api.post('/usuarios', {
    token: tokenAdmin,
    cuerpo: {
      nombre,
      nombreUsuario,
      esAdministrador,
      accesos,
      contrasenaTemporal: CONTRASENA_TEMPORAL,
    },
  });
  if (res.status !== 201) {
    throw new Error(`No se pudo crear el usuario ${nombreUsuario} (${res.status}): ${res.text}`);
  }
  let token: string | null = null;
  let contrasena = CONTRASENA_TEMPORAL;
  if (datos.activar !== false) {
    token = await activarCuenta(esc.api, nombreUsuario, CONTRASENA_TEMPORAL);
    contrasena = CONTRASENA_DEFINITIVA;
  }
  if (datos.horario) {
    const horario = await esc.api.patch(`/usuarios/${res.body.id}`, {
      token: tokenAdmin,
      cuerpo: { horario: datos.horario },
    });
    if (horario.status !== 200) {
      throw new Error(`No se pudo asignar el horario (${horario.status}): ${horario.text}`);
    }
  }
  return {
    id: res.body.id,
    nombre,
    nombreUsuario,
    contrasena,
    pin: res.body.pin,
    empresa,
    token,
    respuesta: res.body,
  };
}

/** Un usuario activo con un solo rol en la sucursal indicada (o Administrador). */
export function crearUsuarioConRol(
  esc: Escenario,
  empresa: EmpresaDePrueba,
  rol: RolDeAcceso | 'ADMINISTRADOR',
  opciones: { sucursal?: number; tokenAdmin?: string } = {},
): Promise<UsuarioPrueba> {
  if (rol === 'ADMINISTRADOR') {
    return crearUsuario(esc, empresa, { esAdministrador: true, tokenAdmin: opciones.tokenAdmin });
  }
  return crearUsuario(esc, empresa, {
    accesos: [{ sucursal: opciones.sucursal ?? 0, rol }],
    tokenAdmin: opciones.tokenAdmin,
  });
}

// ---------------------------------------------------------------------------------------------
// Equipos recordados y PIN (grupo C2; se usan solo en pruebas etiquetadas [C2])
// ---------------------------------------------------------------------------------------------

/** `POST /sesion/equipo` con una sesión de contraseña; devuelve el token del equipo si llegó uno. */
export async function recordarEquipo(
  api: Api,
  token: string,
  opciones: { equipo?: string; nombre?: string } = {},
): Promise<{ res: Respuesta; tokenEquipo: string | undefined }> {
  const res = await api.post('/sesion/equipo', {
    token,
    equipo: opciones.equipo,
    cuerpo: opciones.nombre === undefined ? {} : { nombre: opciones.nombre },
  });
  return { res, tokenEquipo: res.body?.tokenEquipo };
}

/**
 * Activa al usuario (si hace falta), recuerda su equipo y devuelve el token del equipo y la sesión de
 * contraseña con que lo recordó.
 */
export async function recordarEquipoDe(
  esc: Escenario,
  usuario: UsuarioPrueba,
  opciones: { equipo?: string } = {},
): Promise<{ tokenEquipo: string; token: string }> {
  const { token } = await ingresarOk(esc.api, usuario.nombreUsuario, usuario.contrasena);
  const { res, tokenEquipo } = await recordarEquipo(esc.api, token, opciones);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`No se pudo recordar el equipo (${res.status}): ${res.text}`);
  }
  return { tokenEquipo: tokenEquipo ?? opciones.equipo!, token };
}

/** `POST /sesiones/pin` (respuesta cruda). */
export function ingresarConPin(api: Api, tokenEquipo: string, usuarioId: string, pin: string) {
  return api.post('/sesiones/pin', { equipo: tokenEquipo, cuerpo: { usuarioId, pin } });
}

// ---------------------------------------------------------------------------------------------
// Soporte
// ---------------------------------------------------------------------------------------------

/** `POST /plataforma/empresas/:id/soporte`: sesión de soporte del superadministrador en la empresa. */
export async function iniciarSoporte(
  esc: Escenario,
  empresa: EmpresaDePrueba,
  opciones: { motivo?: string; sucursalId?: string; tokenSuperadmin?: string } = {},
): Promise<{ token: string; sesion: any }> {
  const tokenSa = opciones.tokenSuperadmin ?? (await sesionSuperadmin(esc));
  const res = await esc.api.post(`/plataforma/empresas/${empresa.id}/soporte`, {
    token: tokenSa,
    cuerpo: {
      motivo: opciones.motivo ?? 'Soporte de prueba',
      ...(opciones.sucursalId ? { sucursalId: opciones.sucursalId } : {}),
    },
  });
  if (res.status !== 201) {
    throw new Error(`No se pudo iniciar el soporte (${res.status}): ${res.text}`);
  }
  return { token: res.body.token, sesion: res.body.sesion };
}

// ---------------------------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------------------------

/** Instante de `reloj` más `ms` milisegundos, en ISO. */
export function enIso(reloj: RelojManual, ms = 0): string {
  return new Date(reloj.ahora().getTime() + ms).toISOString();
}

/** Rutas de empresa registradas: todas salvo las públicas y las de `/plataforma/*` (criterio 1). */
export function rutasDeEmpresa(
  rutas: { metodo: string; ruta: string }[],
): { metodo: string; ruta: string }[] {
  const publicas = new Set(RUTAS_PUBLICAS);
  return rutas.filter(
    (r) => !publicas.has(`${r.metodo} ${r.ruta}`) && !r.ruta.startsWith('/plataforma'),
  );
}

/**
 * Captura todo lo que se escribe en la salida estándar y de errores mientras corre `fn` (para buscar
 * secretos en el registro de la API). No deja pasar la salida.
 */
export async function capturarSalida<T>(
  fn: () => Promise<T>,
): Promise<{ resultado: T; salida: string }> {
  const trozos: string[] = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  const interceptar = (chunk: unknown, ...resto: unknown[]): boolean => {
    trozos.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'),
    );
    const cb = resto.find((x) => typeof x === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  };
  process.stdout.write = interceptar as typeof process.stdout.write;
  process.stderr.write = interceptar as typeof process.stderr.write;
  try {
    const resultado = await fn();
    return { resultado, salida: trozos.join('') };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

/**
 * Levanta una segunda aplicación (otro `NODE_ENV` o con `EMPRESA_POR_HEADER`) sobre la misma base y el
 * mismo reloj, corre `fn` y la cierra; después restaura el entorno del escenario (sin la cabecera).
 */
export async function conAplicacionAparte<T>(
  esc: Escenario,
  entorno: { nodeEnv?: 'development' | 'test' | 'production'; empresaPorHeader?: boolean },
  fn: (api: Api) => Promise<T>,
): Promise<T> {
  fijarEntornoDePrueba({ nodeEnv: entorno.nodeEnv, empresaPorHeader: entorno.empresaPorHeader });
  let app: INestApplication | undefined;
  try {
    app = await crearAplicacion({ reloj: esc.reloj, logger: false });
    await app.listen(0);
    return await fn(new Api(app));
  } finally {
    await app?.close();
    fijarEntornoDePrueba({ empresaPorHeader: false });
  }
}
