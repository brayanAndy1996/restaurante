// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ayudantes de las pruebas de equipos recordados, PIN y clave de supervisor (P4, P5 y P6). No
// dependen de la implementación de la API: usan solo los contratos públicos (rutas HTTP,
// `@restaurante/contratos`, `crearSuperadministrador`, `crearAplicacion` y `RelojManual`) y, para
// inspeccionar filas, un cliente administrador de PostgreSQL (que salta la RLS; solo se lee).
import type { INestApplication, LogLevel, Type } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { crearSuperadministrador } from '../../scripts/lib/superadministrador';
import { crearAplicacion } from '../../src/aplicacion';
import { RelojManual } from '../../src/nucleo/reloj';
import { generarRucUnico } from '../aislamiento/ruc-unico';
import { conCliente, fijarEntornoDePrueba } from '../utilidades';

/** Lunes 2 de noviembre de 2026, 10:00 en Lima (sin horarios de acceso en estas pruebas). */
export const INSTANTE_INICIAL = '2026-11-02T10:00:00-05:00';

export const MINUTO = 60_000;

/** Cuerpos JSON de las respuestas y filas de SQL: no tienen un tipo fijo en las pruebas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Libre = Record<string, any>;

/** Contraseña definitiva de todas las personas de prueba (la temporal es otra). */
export const CONTRASENA_FINAL = 'Definitiva-2026-ok';
export const CONTRASENA_TEMPORAL = 'Temporal-2026-ok';

// ---------------------------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------------------------

export interface Entorno {
  app: INestApplication;
  reloj: RelojManual;
  cerrar(): Promise<void>;
}

export async function crearEntorno(
  opciones: { controladoresExtra?: Type[]; logger?: false | LogLevel[]; instante?: string } = {},
): Promise<Entorno> {
  // Sin EMPRESA_POR_HEADER: la empresa sale siempre de la sesión (criterio 2).
  fijarEntornoDePrueba({ poolMax: 2, empresaPorHeader: false });
  const reloj = new RelojManual(opciones.instante ?? INSTANTE_INICIAL);
  const app = await crearAplicacion({
    reloj,
    ...(opciones.controladoresExtra ? { controladoresExtra: opciones.controladoresExtra } : {}),
    ...(opciones.logger !== undefined ? { logger: opciones.logger } : {}),
  });
  return { app, reloj, cerrar: () => app.close() };
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

export type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpcionesLlamada {
  /** Token de sesión (`se.…` o `sa.…`): va en `Authorization: Bearer`. */
  token?: string;
  /** Token de equipo (`eq.…`): va en `X-Equipo`. */
  equipo?: string;
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
}

export async function llamar(
  app: INestApplication,
  metodo: Metodo,
  ruta: string,
  opciones: OpcionesLlamada = {},
): Promise<request.Response> {
  let peticion = request(app.getHttpServer())[metodo](ruta);
  if (opciones.token !== undefined)
    peticion = peticion.set('Authorization', `Bearer ${opciones.token}`);
  if (opciones.equipo !== undefined) peticion = peticion.set('X-Equipo', opciones.equipo);
  for (const [nombre, valor] of Object.entries(opciones.cabeceras ?? {})) {
    peticion = peticion.set(nombre, valor);
  }
  if (opciones.cuerpo !== undefined) peticion = peticion.send(opciones.cuerpo as object);
  return peticion;
}

/** Comprueba estado y código de una respuesta de error (`{ codigo, mensaje }`, sin detalles de PostgreSQL). */
export function esperarError(res: request.Response, estado: number, codigo: string): void {
  expect({ estado: res.status, codigo: res.body?.codigo }).toEqual({ estado, codigo });
  expect(typeof res.body.mensaje).toBe('string');
  expect(JSON.stringify(res.body)).not.toMatch(/postgres|sqlstate|violates|relation "|constraint/i);
}

// ---------------------------------------------------------------------------------------------
// Secretos vistos (para comprobar que no llegan a la auditoría)
// ---------------------------------------------------------------------------------------------

export const SECRETOS_VISTOS = new Set<string>();

/** Registra un token o una contraseña y, de un token, también su secreto (última parte). */
export function registrarSecreto(valor: string | undefined): void {
  if (!valor) return;
  SECRETOS_VISTOS.add(valor);
  const partes = valor.split('.');
  if (partes.length >= 3) SECRETOS_VISTOS.add(partes[partes.length - 1] as string);
}

registrarSecreto(CONTRASENA_FINAL);
registrarSecreto(CONTRASENA_TEMPORAL);

export function secretosEn(texto: string): string[] {
  return [...SECRETOS_VISTOS].filter((secreto) => secreto.length >= 8 && texto.includes(secreto));
}

/** Claves de objeto que nunca deben aparecer en una fila de auditoría. */
export const CLAVES_SECRETAS =
  /"(pin|token|tokenEquipo|token_equipo|secreto|huella_pin|hash_contrasena)"\s*:/i;

/** `true` si el PIN aparece como número completo (no como parte de un UUID o de una fecha). */
export function contienePin(texto: string, pin: string): boolean {
  return new RegExp(`(?<![0-9a-fA-F])${pin}(?![0-9a-fA-F])`).test(texto);
}

// ---------------------------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------------------------

/** RUC válido y único entre archivos paralelos (bloques reservados por proceso, ver `ruc-unico.ts`). */
export function rucAleatorio(): string {
  return generarRucUnico();
}

export function sufijo(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function nombreDeUsuarioUnico(prefijo = 'u'): string {
  return `${prefijo}${sufijo()}`;
}

/** Secreto de equipo falso con el largo de uno real (32 bytes en base64url). */
export function secretoFalso(): string {
  return randomBytes(32).toString('base64url');
}

/** Un PIN del mismo largo que `pin`, distinto de él. */
export function pinDistinto(pin: string): string {
  const siguiente = (Number(pin) + 1) % 10 ** pin.length;
  return String(siguiente).padStart(pin.length, '0');
}

// ---------------------------------------------------------------------------------------------
// Superadministrador, empresas y personas
// ---------------------------------------------------------------------------------------------

export interface Superadmin {
  id: string;
  usuario: string;
  contrasena: string;
}

export async function crearSuperadminDePrueba(): Promise<Superadmin> {
  const usuario = nombreDeUsuarioUnico('sa');
  const contrasena = `Super-${sufijo()}-2026`;
  registrarSecreto(contrasena);
  const { id } = await crearSuperadministrador({
    usuario,
    nombre: 'Soporte de prueba',
    contrasena,
  });
  return { id, usuario, contrasena };
}

export async function ingresarSuperadmin(app: INestApplication, sa: Superadmin): Promise<string> {
  const res = await llamar(app, 'post', '/plataforma/sesiones', {
    cuerpo: { usuario: sa.usuario, contrasena: sa.contrasena },
  });
  if (res.status !== 201)
    throw new Error(`Ingreso del superadministrador: ${res.status} ${JSON.stringify(res.body)}`);
  registrarSecreto(res.body.token);
  return res.body.token as string;
}

export interface Persona {
  id: string;
  nombre: string;
  nombreUsuario: string;
  contrasena: string;
  pin: string;
  largoPin: 4 | 6;
  empresaId: string;
}

export interface Empresa {
  id: string;
  sucursales: { id: string; nombre: string }[];
  /** Primer Administrador, con su contraseña ya definitiva. */
  admin: Persona;
}

function exigir(res: request.Response, estado: number, que: string): void {
  if (res.status !== estado) {
    throw new Error(
      `${que}: se esperaba ${estado} y llegó ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/** Ingresa con usuario y contraseña. Lanza si no responde 201. */
export async function loginContrasena(
  app: INestApplication,
  persona: Pick<Persona, 'nombreUsuario' | 'contrasena'>,
): Promise<{ token: string; sesion: Libre }> {
  const res = await llamar(app, 'post', '/sesiones/contrasena', {
    cuerpo: { usuario: persona.nombreUsuario, contrasena: persona.contrasena },
  });
  exigir(res, 201, `Ingreso de ${persona.nombreUsuario}`);
  registrarSecreto(res.body.token);
  return res.body as { token: string; sesion: Libre };
}

/** Cambia la contraseña temporal por la definitiva en la sesión recién abierta. */
async function definirContrasena(
  app: INestApplication,
  token: string,
  actual: string,
  nueva: string,
): Promise<void> {
  const res = await llamar(app, 'put', '/sesion/contrasena', { token, cuerpo: { actual, nueva } });
  exigir(res, 204, 'Cambio de la contraseña temporal');
}

/** Alta de una empresa nueva por HTTP de plataforma, con `sucursales` sucursales de un solo emisor. */
export async function altaEmpresa(
  app: INestApplication,
  tokenSuperadmin: string,
  opciones: { sucursales?: number } = {},
): Promise<Empresa> {
  const cantidad = opciones.sucursales ?? 3;
  const ruc = rucAleatorio();
  const nombreUsuario = nombreDeUsuarioUnico('adm');
  const res = await llamar(app, 'post', '/plataforma/empresas', {
    token: tokenSuperadmin,
    cuerpo: {
      nombre: `Empresa ${sufijo()}`,
      emisores: [{ ruc, razonSocial: `Razón social ${sufijo()}`, regimen: 'GENERAL' }],
      sucursales: Array.from({ length: cantidad }, (_, i) => ({
        rucEmisor: ruc,
        nombre: `Sucursal ${i + 1} ${sufijo()}`,
        codigoEstablecimiento: String(i + 1).padStart(4, '0'),
        direccion: `Av. Prueba ${i + 1}, Lima`,
      })),
      administrador: {
        nombre: 'Administrador de prueba',
        nombreUsuario,
        contrasenaTemporal: CONTRASENA_TEMPORAL,
      },
      motivo: 'Alta de prueba',
    },
  });
  exigir(res, 201, 'Alta de empresa por HTTP');
  const admin: Persona = {
    id: res.body.administrador.id,
    nombre: 'Administrador de prueba',
    nombreUsuario,
    contrasena: CONTRASENA_FINAL,
    pin: res.body.administrador.pin,
    largoPin: 6,
    empresaId: res.body.empresaId,
  };
  const sesion = await loginContrasena(app, { nombreUsuario, contrasena: CONTRASENA_TEMPORAL });
  await definirContrasena(app, sesion.token, CONTRASENA_TEMPORAL, CONTRASENA_FINAL);
  return {
    id: res.body.empresaId,
    sucursales: (res.body.sucursales as { id: string; nombre: string }[]).map((s) => ({
      id: s.id,
      nombre: s.nombre,
    })),
    admin,
  };
}

/** Sesión nueva del Administrador de la empresa (se abre de nuevo cuando el reloj ya avanzó). */
export async function tokenAdmin(app: INestApplication, empresa: Empresa): Promise<string> {
  return (await loginContrasena(app, empresa.admin)).token;
}

export interface DatosPersona {
  nombre?: string;
  esAdministrador?: boolean;
  accesos?: { sucursalId: string; rol: 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR' }[];
}

/**
 * Crea un usuario con `POST /usuarios` (como Administrador) y deja su contraseña definitiva: ingresa
 * con la temporal y la cambia. Devuelve la persona con el PIN que mostró el alta.
 */
export async function crearPersona(
  app: INestApplication,
  empresa: Empresa,
  datos: DatosPersona,
): Promise<Persona> {
  const admin = await tokenAdmin(app, empresa);
  const nombreUsuario = nombreDeUsuarioUnico();
  const nombre = datos.nombre ?? `Persona ${sufijo()}`;
  const res = await llamar(app, 'post', '/usuarios', {
    token: admin,
    cuerpo: {
      nombre,
      nombreUsuario,
      esAdministrador: datos.esAdministrador ?? false,
      accesos: datos.esAdministrador ? [] : (datos.accesos ?? []),
      contrasenaTemporal: CONTRASENA_TEMPORAL,
    },
  });
  exigir(res, 201, `Alta de ${nombreUsuario}`);
  const persona: Persona = {
    id: res.body.id,
    nombre,
    nombreUsuario,
    contrasena: CONTRASENA_FINAL,
    pin: res.body.pin,
    largoPin: res.body.largoPin,
    empresaId: empresa.id,
  };
  const sesion = await loginContrasena(app, { nombreUsuario, contrasena: CONTRASENA_TEMPORAL });
  await definirContrasena(app, sesion.token, CONTRASENA_TEMPORAL, CONTRASENA_FINAL);
  return persona;
}

/** Como `crearPersona`, pero sin cambiar la contraseña temporal (sigue siendo temporal). */
export async function crearPersonaConContrasenaTemporal(
  app: INestApplication,
  empresa: Empresa,
  datos: DatosPersona,
): Promise<Persona> {
  const admin = await tokenAdmin(app, empresa);
  const nombreUsuario = nombreDeUsuarioUnico();
  const res = await llamar(app, 'post', '/usuarios', {
    token: admin,
    cuerpo: {
      nombre: datos.nombre ?? `Persona ${sufijo()}`,
      nombreUsuario,
      esAdministrador: datos.esAdministrador ?? false,
      accesos: datos.accesos ?? [],
      contrasenaTemporal: CONTRASENA_TEMPORAL,
    },
  });
  exigir(res, 201, `Alta de ${nombreUsuario}`);
  return {
    id: res.body.id,
    nombre: res.body.nombre,
    nombreUsuario,
    contrasena: CONTRASENA_TEMPORAL,
    pin: res.body.pin,
    largoPin: res.body.largoPin,
    empresaId: empresa.id,
  };
}

export async function elegirSucursal(
  app: INestApplication,
  token: string,
  sucursalId: string,
  equipo?: string,
): Promise<request.Response> {
  return llamar(app, 'put', '/sesion/sucursal', {
    token,
    ...(equipo ? { equipo } : {}),
    cuerpo: { sucursalId },
  });
}

/** Sesión de soporte del superadministrador en la empresa. */
export async function sesionDeSoporte(
  app: INestApplication,
  tokenSuperadmin: string,
  empresaId: string,
  sucursalId?: string,
): Promise<string> {
  const res = await llamar(app, 'post', `/plataforma/empresas/${empresaId}/soporte`, {
    token: tokenSuperadmin,
    cuerpo: { motivo: 'Soporte de prueba', ...(sucursalId ? { sucursalId } : {}) },
  });
  exigir(res, 201, 'Sesión de soporte');
  registrarSecreto(res.body.token);
  return res.body.token as string;
}

// ---------------------------------------------------------------------------------------------
// Equipos recordados
// ---------------------------------------------------------------------------------------------

export interface RegistroEnEquipo {
  /** Sesión de contraseña abierta para recordar el equipo (queda asociada a él). */
  sesion: string;
  equipoId: string;
  equipoRecordadoId: string;
  tokenEquipo: string;
}

/** Ingresa con contraseña, recuerda un equipo nuevo y devuelve su token. */
export async function nuevoEquipo(
  app: INestApplication,
  persona: Persona,
  nombre?: string,
): Promise<RegistroEnEquipo> {
  const { token } = await loginContrasena(app, persona);
  const res = await llamar(app, 'post', '/sesion/equipo', {
    token,
    cuerpo: nombre ? { nombre } : {},
  });
  exigir(res, 201, `Recordar equipo nuevo de ${persona.nombreUsuario}`);
  registrarSecreto(res.body.tokenEquipo);
  const equipoRecordadoId = await equipoRecordadoDeSesion(app, token);
  return {
    sesion: token,
    equipoId: res.body.equipo.id,
    equipoRecordadoId,
    tokenEquipo: res.body.tokenEquipo,
  };
}

/** Ingresa con contraseña y hace que un equipo ya existente recuerde a la persona. */
export async function agregarAEquipo(
  app: INestApplication,
  persona: Persona,
  tokenEquipo: string,
): Promise<RegistroEnEquipo> {
  const { token } = await loginContrasena(app, persona);
  const res = await llamar(app, 'post', '/sesion/equipo', {
    token,
    equipo: tokenEquipo,
    cuerpo: {},
  });
  exigir(res, 200, `Recordar a ${persona.nombreUsuario} en un equipo existente`);
  const equipoRecordadoId = await equipoRecordadoDeSesion(app, token);
  return { sesion: token, equipoId: res.body.equipo.id, equipoRecordadoId, tokenEquipo };
}

export async function equipoRecordadoDeSesion(
  app: INestApplication,
  token: string,
): Promise<string> {
  const res = await llamar(app, 'get', '/sesion', { token });
  exigir(res, 200, 'GET /sesion');
  return (res.body.equipo as { equipoRecordadoId: string }).equipoRecordadoId;
}

/**
 * Un equipo que recuerda a todas las `personas` (la primera lo crea, las demás se agregan). Devuelve
 * el token del equipo y, por persona, su sesión de contraseña y su equipo recordado.
 */
export async function equipoCon(
  app: INestApplication,
  personas: Persona[],
  nombre?: string,
): Promise<{
  tokenEquipo: string;
  equipoId: string;
  porPersona: Record<string, RegistroEnEquipo>;
}> {
  const [primera, ...resto] = personas;
  if (!primera) throw new Error('equipoCon necesita al menos una persona');
  const inicial = await nuevoEquipo(app, primera, nombre);
  const porPersona: Record<string, RegistroEnEquipo> = { [primera.id]: inicial };
  for (const persona of resto) {
    porPersona[persona.id] = await agregarAEquipo(app, persona, inicial.tokenEquipo);
  }
  return { tokenEquipo: inicial.tokenEquipo, equipoId: inicial.equipoId, porPersona };
}

export async function loginPin(
  app: INestApplication,
  tokenEquipo: string | undefined,
  usuarioId: string,
  pin: string,
): Promise<request.Response> {
  const res = await llamar(app, 'post', '/sesiones/pin', {
    ...(tokenEquipo !== undefined ? { equipo: tokenEquipo } : {}),
    cuerpo: { usuarioId, pin },
  });
  if (res.status === 201) registrarSecreto(res.body.token);
  return res;
}

/** Ingreso con PIN que debe salir bien; devuelve el token y la sesión. */
export async function pinOk(
  app: INestApplication,
  tokenEquipo: string,
  persona: Pick<Persona, 'id' | 'pin'>,
): Promise<{ token: string; sesion: Libre }> {
  const res = await loginPin(app, tokenEquipo, persona.id, persona.pin);
  exigir(res, 201, `Ingreso con PIN de ${persona.id}`);
  return res.body as { token: string; sesion: Libre };
}

/** Parte un token de equipo `eq.<empresaId>.<equipoId>.<secreto>`. */
export function partesDeToken(token: string): { empresaId: string; id: string; secreto: string } {
  const [, empresaId, id, secreto] = token.split('.');
  return { empresaId: empresaId as string, id: id as string, secreto: secreto as string };
}

// ---------------------------------------------------------------------------------------------
// Inspección de la base (cliente administrador: salta la RLS, solo se lee)
// ---------------------------------------------------------------------------------------------

export async function consultar<T extends Libre = Libre>(
  sql: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  return conCliente('admin', async (cliente) => (await cliente.query(sql, parametros)).rows as T[]);
}

export interface FilaAuditoria extends Libre {
  accion: string;
  texto: string;
}

/** Filas de `auditoria` de una empresa (con su texto JSON completo para buscar valores). */
export async function filasAuditoria(empresaId: string, accion?: string): Promise<FilaAuditoria[]> {
  return consultar<FilaAuditoria>(
    `SELECT a.*, row_to_json(a)::text AS texto
       FROM auditoria a
      WHERE a.empresa_id = $1 AND ($2::text IS NULL OR a.accion = $2)
      ORDER BY a.ocurrido_en, a.id`,
    [empresaId, accion ?? null],
  );
}

/** Todo el texto de la auditoría de una empresa (para buscar secretos). */
export async function textoAuditoria(empresaId: string): Promise<string> {
  const filas = await filasAuditoria(empresaId);
  return filas.map((f) => f.texto).join('\n');
}

export async function equiposRecordadosDe(usuarioId: string): Promise<
  {
    id: string;
    equipo_id: string;
    revocado_en: Date | null;
    motivo_revocacion: string | null;
  }[]
> {
  return consultar(
    `SELECT id, equipo_id, revocado_en, motivo_revocacion
       FROM equipo_recordado WHERE usuario_id = $1 ORDER BY recordado_en, id`,
    [usuarioId],
  );
}

export async function equipoRecordadoActivo(equipoId: string, usuarioId: string): Promise<boolean> {
  const filas = await consultar(
    `SELECT 1 FROM equipo_recordado
      WHERE equipo_id = $1 AND usuario_id = $2 AND revocado_en IS NULL`,
    [equipoId, usuarioId],
  );
  return filas.length > 0;
}

export async function motivoDeRevocacion(
  equipoId: string,
  usuarioId: string,
): Promise<string | null> {
  const filas = await consultar<{ motivo_revocacion: string | null }>(
    `SELECT motivo_revocacion FROM equipo_recordado
      WHERE equipo_id = $1 AND usuario_id = $2 AND revocado_en IS NOT NULL
      ORDER BY revocado_en DESC LIMIT 1`,
    [equipoId, usuarioId],
  );
  return filas[0]?.motivo_revocacion ?? null;
}

/** Cantidad de personas activas que el equipo recuerda. */
export async function personasActivasDelEquipo(equipoId: string): Promise<number> {
  const filas = await consultar<{ n: string }>(
    `SELECT count(*)::text AS n FROM equipo_recordado WHERE equipo_id = $1 AND revocado_en IS NULL`,
    [equipoId],
  );
  return Number(filas[0]?.n ?? 0);
}
