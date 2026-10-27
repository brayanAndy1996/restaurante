// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ayudantes compartidos por las pruebas del grupo 3 de la fase B (auditoría, plataforma y soporte,
// catálogo y RLS de las tablas nuevas, trazabilidad). Solo usan contratos públicos: la API real con
// `RelojManual`, el superadministrador creado con `crearSuperadministrador`, las empresas dadas de alta con
// `POST /plataforma/empresas` y los usuarios creados con `POST /usuarios`. No leen la implementación.
import type { INestApplication, Type } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { Sequelize } from 'sequelize';
import request from 'supertest';
import { crearUmzug } from '../../scripts/lib/migraciones';
import { prepararBaseDeDatos } from '../../scripts/lib/preparar-bd';
import { exigirUrlAdmin, urlAdminDeMantenimiento } from '../../scripts/lib/roles';
import {
  crearSuperadministrador,
  desactivarSuperadministrador,
} from '../../scripts/lib/superadministrador';
import { crearAplicacion } from '../../src/aplicacion';
import { RelojManual } from '../../src/nucleo/reloj';
import { fijarEntornoDePrueba, urlDeRol } from '../utilidades';
import { datosDeEmpresa } from '../aislamiento/fabrica';

/** Lunes 2 de noviembre de 2026, 10:00 en Lima: dentro de cualquier horario razonable de la semana. */
export const INICIO_POR_DEFECTO = '2026-11-02T10:00:00-05:00';

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

export interface AppDePrueba {
  app: INestApplication;
  reloj: RelojManual;
  /** Agente HTTP de `supertest` sobre la aplicación (sin puerto). */
  http: () => ReturnType<typeof request>;
  cerrar: () => Promise<void>;
}

export interface OpcionesApp {
  poolMax?: number;
  /** Instante inicial del reloj de la API; por defecto `INICIO_POR_DEFECTO`. */
  inicio?: string;
  controladoresExtra?: Type<unknown>[];
}

/**
 * Arranca la API real con un `RelojManual` y sin `EMPRESA_POR_HEADER` (la empresa sale de la sesión).
 * Hay que cerrarla con `cerrar()`.
 */
export async function arrancar(opciones: OpcionesApp = {}): Promise<AppDePrueba> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 2, empresaPorHeader: false });
  const reloj = new RelojManual(opciones.inicio ?? INICIO_POR_DEFECTO);
  const app = await crearAplicacion({
    reloj,
    logger: false,
    ...(opciones.controladoresExtra ? { controladoresExtra: opciones.controladoresExtra } : {}),
  });
  return {
    app,
    reloj,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Falla con el cuerpo de la respuesta si el estado no es el esperado (mensajes que ayudan a depurar). */
export function exigirEstado(
  respuesta: { status: number; body: unknown },
  esperado: number,
  contexto = '',
): void {
  if (respuesta.status !== esperado) {
    throw new Error(
      `${contexto} se esperaba ${esperado} y fue ${respuesta.status}: ${JSON.stringify(respuesta.body)}`,
    );
  }
}

// ------------------------------------------------------------------------------------------------
// Tokens (formato público del contrato: `se.<empresa>.<sesion>.<secreto>`, `sa.<sesion>.<secreto>`)
// ------------------------------------------------------------------------------------------------

export interface PartesDeToken {
  prefijo: string;
  empresaId?: string;
  sesionId: string;
  secreto: string;
}

export function partesDeToken(token: string): PartesDeToken {
  const partes = token.split('.');
  if (partes[0] === 'sa') {
    return { prefijo: 'sa', sesionId: partes[1]!, secreto: partes[2]! };
  }
  return { prefijo: partes[0]!, empresaId: partes[1]!, sesionId: partes[2]!, secreto: partes[3]! };
}

/** Token de empresa con la parte de la empresa reemplazada. */
export function conEmpresa(token: string, empresaId: string): string {
  const p = partesDeToken(token);
  return `${p.prefijo}.${empresaId}.${p.sesionId}.${p.secreto}`;
}

// ------------------------------------------------------------------------------------------------
// Superadministrador
// ------------------------------------------------------------------------------------------------

export interface SuperadminDePrueba {
  id: string;
  usuario: string;
  nombre: string;
  contrasena: string;
  token: string;
}

export const usuarioUnico = (prefijo: string) => `${prefijo}-${randomUUID().slice(0, 10)}`;
export const contrasenaUnica = () => `Clave-${randomUUID()}`;

/** Crea un superadministrador con la función pública (actor `cli:superadmin`) y abre su sesión. */
export async function nuevoSuperadmin(ctx: AppDePrueba): Promise<SuperadminDePrueba> {
  const usuario = usuarioUnico('sa');
  const nombre = `Superadmin ${usuario}`;
  const contrasena = contrasenaUnica();
  const { id } = await crearSuperadministrador({ usuario, nombre, contrasena });
  const res = await ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena });
  exigirEstado(res, 201, 'ingreso del superadministrador');
  return { id, usuario, nombre, contrasena, token: res.body.token as string };
}

export { desactivarSuperadministrador };

// ------------------------------------------------------------------------------------------------
// Empresas, usuarios y sesiones por HTTP
// ------------------------------------------------------------------------------------------------

export interface SucursalDePrueba {
  id: string;
  nombre: string;
}

export interface AdminDePrueba {
  id: string;
  usuario: string;
  /** Contraseña definitiva (ya cambiada) cuando se pidió la sesión; si no, la temporal. */
  contrasena: string;
  contrasenaTemporal: string;
  pin: string;
  /** Token de sesión de contraseña; vacío si no se abrió sesión. */
  token: string;
}

export interface EmpresaDePrueba {
  empresaId: string;
  nombre: string;
  emisores: { id: string; ruc: string }[];
  sucursales: SucursalDePrueba[];
  /** Suscripciones por sucursal tal como las devolvió el alta. */
  suscripciones: Record<string, { id: string }>;
  admin: AdminDePrueba;
  respuestaAlta: Record<string, unknown>;
}

export interface OpcionesAlta {
  emisores?: number;
  sucursalesPorEmisor?: number;
  /** Cambios al cuerpo antes de enviarlo (por ejemplo `suscripcion` por sucursal). */
  ajustar?: (cuerpo: ReturnType<typeof cuerpoDeAlta>) => void;
  /** Abre la sesión del Administrador y cambia su contraseña temporal (por defecto sí). */
  conSesion?: boolean;
}

/** Cuerpo válido de `POST /plataforma/empresas`. */
export function cuerpoDeAlta(opciones: { emisores?: number; sucursalesPorEmisor?: number } = {}) {
  const datos = datosDeEmpresa({
    emisores: opciones.emisores ?? 1,
    sucursalesPorEmisor: opciones.sucursalesPorEmisor ?? 2,
  });
  return {
    ...datos,
    administrador: {
      nombre: 'Administrador de prueba',
      nombreUsuario: usuarioUnico('adm'),
      contrasenaTemporal: contrasenaUnica(),
    },
    motivo: 'Alta de empresa de prueba',
  } as Record<string, unknown> & {
    nombre: string;
    emisores: { ruc: string }[];
    sucursales: Record<string, unknown>[];
    administrador: { nombre: string; nombreUsuario: string; contrasenaTemporal: string };
    motivo: string;
  };
}

/** Ingreso con usuario y contraseña (sin comprobar el resultado). */
export function ingresar(ctx: AppDePrueba, usuario: string, contrasena: string) {
  return ctx.http().post('/sesiones/contrasena').send({ usuario, contrasena });
}

/** Ingreso que debe salir bien: devuelve el token. */
export async function ingresarOk(
  ctx: AppDePrueba,
  usuario: string,
  contrasena: string,
): Promise<{ token: string; sesion: Record<string, unknown> }> {
  const res = await ingresar(ctx, usuario, contrasena);
  exigirEstado(res, 201, `ingreso de ${usuario}`);
  return res.body as { token: string; sesion: Record<string, unknown> };
}

/** Cambia la contraseña de la propia sesión (`PUT /sesion/contrasena`) y exige 204. */
export async function cambiarContrasena(
  ctx: AppDePrueba,
  token: string,
  actual: string,
  nueva: string,
): Promise<void> {
  const res = await ctx.http().put('/sesion/contrasena').set(bearer(token)).send({ actual, nueva });
  exigirEstado(res, 204, 'cambio de contraseña');
}

/** Da de alta una empresa por HTTP con el superadministrador y, por defecto, abre la sesión de su Administrador. */
export async function altaEmpresa(
  ctx: AppDePrueba,
  sa: SuperadminDePrueba,
  opciones: OpcionesAlta = {},
): Promise<EmpresaDePrueba> {
  const cuerpo = cuerpoDeAlta(opciones);
  opciones.ajustar?.(cuerpo);
  const res = await ctx.http().post('/plataforma/empresas').set(bearer(sa.token)).send(cuerpo);
  exigirEstado(res, 201, 'alta de empresa');
  const r = res.body as {
    empresaId: string;
    emisores: { id: string; ruc: string }[];
    sucursales: { id: string; nombre: string; suscripcion: { id: string } }[];
    administrador: { id: string; pin: string };
  };
  const admin: AdminDePrueba = {
    id: r.administrador.id,
    usuario: cuerpo.administrador.nombreUsuario,
    contrasena: cuerpo.administrador.contrasenaTemporal,
    contrasenaTemporal: cuerpo.administrador.contrasenaTemporal,
    pin: r.administrador.pin,
    token: '',
  };
  if (opciones.conSesion !== false) {
    const { token } = await ingresarOk(ctx, admin.usuario, admin.contrasenaTemporal);
    const nueva = contrasenaUnica();
    await cambiarContrasena(ctx, token, admin.contrasenaTemporal, nueva);
    admin.contrasena = nueva;
    admin.token = token;
  }
  return {
    empresaId: r.empresaId,
    nombre: cuerpo.nombre,
    emisores: r.emisores,
    sucursales: r.sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
    suscripciones: Object.fromEntries(r.sucursales.map((s) => [s.id, { id: s.suscripcion?.id }])),
    admin,
    respuestaAlta: res.body as Record<string, unknown>,
  };
}

export interface EntradaUsuario {
  nombre?: string;
  nombreUsuario?: string;
  esAdministrador?: boolean;
  accesos?: { sucursalId: string; rol: 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR' }[];
  contrasenaTemporal?: string;
  horario?: { dia: number; desde: string; hasta: string }[] | null;
}

export interface UsuarioDePrueba {
  id: string;
  usuario: string;
  contrasenaTemporal: string;
  contrasena: string;
  pin: string;
  /** Token de la sesión de contraseña (vacío si no se abrió sesión). */
  token: string;
  respuesta: Record<string, unknown>;
}

/** `POST /usuarios` con el token del Administrador; devuelve el usuario y su PIN (se muestra una vez). */
export async function crearUsuario(
  ctx: AppDePrueba,
  tokenAdmin: string,
  entrada: EntradaUsuario,
): Promise<UsuarioDePrueba> {
  const usuario = entrada.nombreUsuario ?? usuarioUnico('u');
  const contrasenaTemporal = entrada.contrasenaTemporal ?? contrasenaUnica();
  const cuerpo: Record<string, unknown> = {
    nombre: entrada.nombre ?? `Persona ${usuario}`,
    nombreUsuario: usuario,
    esAdministrador: entrada.esAdministrador ?? false,
    accesos: entrada.accesos ?? [],
    contrasenaTemporal,
  };
  if (entrada.horario !== undefined) cuerpo.horario = entrada.horario;
  const res = await ctx.http().post('/usuarios').set(bearer(tokenAdmin)).send(cuerpo);
  exigirEstado(res, 201, `alta del usuario ${usuario}`);
  return {
    id: res.body.id as string,
    usuario,
    contrasenaTemporal,
    contrasena: contrasenaTemporal,
    pin: res.body.pin as string,
    token: '',
    respuesta: res.body as Record<string, unknown>,
  };
}

/** Crea el usuario, abre su sesión de contraseña y cambia la contraseña temporal. */
export async function crearUsuarioConSesion(
  ctx: AppDePrueba,
  tokenAdmin: string,
  entrada: EntradaUsuario,
): Promise<UsuarioDePrueba> {
  const u = await crearUsuario(ctx, tokenAdmin, entrada);
  const { token } = await ingresarOk(ctx, u.usuario, u.contrasenaTemporal);
  const nueva = contrasenaUnica();
  await cambiarContrasena(ctx, token, u.contrasenaTemporal, nueva);
  return { ...u, contrasena: nueva, token };
}

/** `PUT /sesion/sucursal` y exige 200. */
export async function elegirSucursal(
  ctx: AppDePrueba,
  token: string,
  sucursalId: string,
): Promise<void> {
  const res = await ctx.http().put('/sesion/sucursal').set(bearer(token)).send({ sucursalId });
  exigirEstado(res, 200, 'elegir sucursal');
}

/** `POST /sesion/equipo`; devuelve el equipo y, si es nuevo, el token del equipo. */
export async function recordarEquipo(
  ctx: AppDePrueba,
  token: string,
  opciones: { nombre?: string; tokenEquipo?: string } = {},
): Promise<{ equipo: { id: string; nombre: string }; tokenEquipo?: string }> {
  let peticion = ctx.http().post('/sesion/equipo').set(bearer(token));
  if (opciones.tokenEquipo) peticion = peticion.set('X-Equipo', opciones.tokenEquipo);
  const res = await peticion.send(opciones.nombre ? { nombre: opciones.nombre } : {});
  if (res.status !== 200 && res.status !== 201) exigirEstado(res, 201, 'recordar equipo');
  return res.body as { equipo: { id: string; nombre: string }; tokenEquipo?: string };
}

// ------------------------------------------------------------------------------------------------
// Base de datos
// ------------------------------------------------------------------------------------------------

export interface FilaAuditoria {
  id: string;
  empresa_id: string | null;
  sucursal_id: string | null;
  ocurrido_en: Date;
  origen: string;
  accion: string;
  actor_usuario_id: string | null;
  actor_superadministrador_id: string | null;
  actor_sistema: string | null;
  equipo_id: string | null;
  autorizado_por_id: string | null;
  autorizacion_id: string | null;
  sesion_id: string | null;
  motivo: string | null;
  entidad: string | null;
  entidad_id: string | null;
  detalle: unknown;
}

/**
 * Filas de `auditoria` (vistas por el administrador, que salta la RLS) con una condición libre. Los
 * parámetros van como `$1`, `$2`…
 */
export async function filasDeAuditoria(
  admin: Client,
  condicion: string,
  parametros: unknown[] = [],
): Promise<FilaAuditoria[]> {
  const { rows } = await admin.query<FilaAuditoria>(
    `SELECT * FROM auditoria WHERE ${condicion} ORDER BY ocurrido_en, id`,
    parametros,
  );
  return rows;
}

/** Texto completo de una fila (todas sus columnas), para buscar secretos. */
export async function textoDeAuditoria(admin: Client): Promise<string[]> {
  const { rows } = await admin.query<{ texto: string }>(
    `SELECT to_jsonb(a)::text AS texto FROM auditoria a`,
  );
  return rows.map((f) => f.texto);
}

/** Una fila de una tabla de empresa por id, vista por el administrador. */
export async function filaPorId(
  admin: Client,
  tabla: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const { rows } = await admin.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id]);
  return rows[0];
}

// ------------------------------------------------------------------------------------------------
// Bases de datos temporales (migraciones sobre una base con filas de 001)
// ------------------------------------------------------------------------------------------------

export interface BaseNueva {
  base: string;
  eliminar: () => Promise<void>;
}

/** Crea una base vacía con sus roles y permisos (sin migraciones); nombre aleatorio. */
export async function crearBaseNueva(etiqueta: string): Promise<BaseNueva> {
  const base = `rest_${etiqueta}_${randomBytes(4).toString('hex')}`;
  // Los roles de clúster los modifica `db:preparar` y lo hacen también otros archivos de la suite en paralelo:
  // PostgreSQL puede responder "tuple concurrently updated"; solo por ese motivo se reintenta.
  for (let intento = 1; ; intento++) {
    try {
      await prepararBaseDeDatos({
        baseDeDatos: base,
        recrear: true,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      break;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (intento >= 5 || !/tuple concurrently updated|deadlock detected/i.test(mensaje))
        throw error;
      await new Promise((resolver) => setTimeout(resolver, 200 * intento));
    }
  }
  return {
    base,
    eliminar: async () => {
      const admin = exigirUrlAdmin();
      const cliente = new Client({ connectionString: urlAdminDeMantenimiento(admin, base) });
      cliente.on('error', () => undefined);
      await cliente.connect();
      try {
        await cliente.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
      } finally {
        await cliente.end();
      }
    },
  };
}

async function conUmzug<T>(
  base: string,
  fn: (umzug: ReturnType<typeof crearUmzug>) => Promise<T>,
): Promise<T> {
  const sequelize = new Sequelize(urlDeRol('migrador', base), {
    dialect: 'postgres',
    logging: false,
  });
  try {
    return await fn(crearUmzug(sequelize));
  } finally {
    await sequelize.close();
  }
}

/** Aplica las migraciones pendientes hasta la que empieza con `prefijo` (inclusive), o todas si no se da. */
export async function migrarHasta(base: string, prefijo?: string): Promise<string[]> {
  return conUmzug(base, async (umzug) => {
    if (prefijo === undefined) return (await umzug.up()).map((m) => m.name);
    const pendientes = await umzug.pending();
    const destino = pendientes.find((m) => m.name.startsWith(prefijo));
    if (!destino) throw new Error(`No hay una migración pendiente que empiece con ${prefijo}`);
    return (await umzug.up({ to: destino.name })).map((m) => m.name);
  });
}

/** Revierte, de la última hacia atrás, hasta la que empieza con `prefijo` (inclusive). */
export async function revertirHasta(base: string, prefijo: string): Promise<string[]> {
  return conUmzug(base, async (umzug) => {
    const ejecutadas = await umzug.executed();
    const destino = ejecutadas.find((m) => m.name.startsWith(prefijo));
    if (!destino) throw new Error(`No hay una migración ejecutada que empiece con ${prefijo}`);
    return (await umzug.down({ to: destino.name })).map((m) => m.name);
  });
}

/** Nombres de las migraciones ejecutadas. */
export async function migracionesEjecutadas(base: string): Promise<string[]> {
  return conUmzug(base, async (umzug) => (await umzug.executed()).map((m) => m.name));
}

export const PREFIJO_PLATAFORMA_BASE = '202610270001';
export const PREFIJO_CONTEXTO_UNICO = '202610270002';
export const PREFIJO_ACCESO_BASE = '202610280001';
export const PREFIJO_TRAZABILIDAD = '202610280002';
export const PREFIJO_AUDITORIA_GENERAL = '202610280003';

// ------------------------------------------------------------------------------------------------
// Restricciones CHECK de una tabla, comprobadas con una copia temporal
// ------------------------------------------------------------------------------------------------

/**
 * Intenta insertar una fila en una copia temporal de `tabla` (con sus restricciones `CHECK` y sin
 * `NOT NULL`, así que solo importan las columnas que se pasan) y dice si las restricciones la aceptan.
 * Sirve para comprobar el sentido de un `CHECK` sin depender de su texto ni de las demás columnas.
 * Corre como administrador y siempre revierte.
 */
export async function checkAcepta(
  admin: Client,
  tabla: string,
  valores: Record<string, unknown>,
): Promise<boolean> {
  await admin.query('BEGIN');
  try {
    await admin.query(
      `CREATE TEMP TABLE copia_check (LIKE ${tabla} INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP`,
    );
    const { rows } = await admin.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute
        WHERE attrelid = 'pg_temp.copia_check'::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull`,
    );
    for (const { attname } of rows) {
      await admin.query(`ALTER TABLE copia_check ALTER COLUMN "${attname}" DROP NOT NULL`);
    }
    const columnas = Object.keys(valores);
    const marcas = columnas.map((_, i) => `$${i + 1}`).join(', ');
    await admin.query(
      `INSERT INTO copia_check (${columnas.map((c) => `"${c}"`).join(', ')}) VALUES (${marcas})`,
      columnas.map((c) => valores[c]),
    );
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '23514') return false;
    throw error;
  } finally {
    await admin.query('ROLLBACK');
  }
}
