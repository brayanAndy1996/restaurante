// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P6 (puente de impresión: credenciales y aislamiento) de la historia 004,
// entrega 3b. Solo usan contratos públicos: la API real con `RelojManual` y el tiempo real habilitado
// (`crearAplicacion({ tiempoReal })`), las empresas dadas de alta con `POST /plataforma/empresas`, los usuarios
// con `POST /usuarios`, las rutas de la tabla de endpoints de 3b (impresoras, vinculación del puente, página de
// prueba) y las del puente (`/puente/*`), y un cliente administrador de PostgreSQL (solo lectura) para ver
// filas. Las tablas nuevas de 3b se siembran por SQL con el nombre de tabla y de columna de "Cambios al modelo
// de datos" de `spec.md`. No leen la implementación de la historia.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CABECERA_PROTOCOLO_PUENTE,
  VERSION_PROTOCOLO_PUENTE,
  vincularPuenteRespuestaSchema,
  type ImpresoraRespuesta,
  type VinculacionRespuesta,
  type VincularPuenteEntrada,
  type VincularPuenteRespuesta,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { PublicadorEnMemoria } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import {
  altaEmpresa,
  filasDeAuditoria,
  INICIO_POR_DEFECTO,
  type EmpresaDePrueba,
  type FilaAuditoria,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  crearPersona,
  exigirEstado,
  llamar,
  sembrarCarta,
  sesionContrasena,
  sesionesDe,
  unico,
  type AppCarta,
  type Llamada,
  type Metodo,
  type PersonaCarta,
  type RolCarta,
} from '../carta-critica/fabrica-permisos-carta';
import { sembrarFilasSalon, type FilasSalon } from '../salon-critica/fabrica-p4';
import { fijarEntornoDePrueba } from '../utilidades';

export { exigirEstado, exigirSinFallos, llamar, unico } from '../carta-critica/fabrica-permisos-carta';
export type { Metodo } from '../carta-critica/fabrica-permisos-carta';

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

/** URL pública de la API que va en el texto del QR de vinculación (`API_URL_PUBLICA`, criterio 106). */
export const URL_API_PUBLICA = 'https://api.prueba.restaurante.example';

export type AppP6 = AppCarta;

/**
 * Arranca la API real con `RelojManual` y `AlmacenEnMemoria`, sin `EMPRESA_POR_HEADER`, con el tiempo real
 * habilitado (Socket.IO, sin el publicador en memoria) y `API_URL_PUBLICA` fijada; la deja escuchando en un
 * puerto propio (admite peticiones concurrentes y clientes de Socket.IO).
 */
export async function arrancarP6(
  opciones: { poolMax?: number; reloj?: RelojManual } = {},
): Promise<AppP6> {
  fijarEntornoDePrueba({
    poolMax: opciones.poolMax ?? 2,
    empresaPorHeader: false,
    extra: { API_URL_PUBLICA: URL_API_PUBLICA },
  });
  const reloj = opciones.reloj ?? new RelojManual(INICIO_POR_DEFECTO);
  const almacen = new AlmacenEnMemoria();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    almacenArchivos: almacen,
    tiempoReal: { habilitado: true },
  });
  await app.listen(0, '127.0.0.1');
  return {
    app,
    reloj,
    // Con el tiempo real habilitado los eventos salen por el transporte real; este publicador no está conectado.
    publicador: new PublicadorEnMemoria(),
    almacen,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}

// ------------------------------------------------------------------------------------------------
// Tokens del puente: `vi.<empresaId>.<id>.<secreto>` y `pu.<empresaId>.<id>.<secreto>` (criterios 106 y 107)
// ------------------------------------------------------------------------------------------------

export const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** 32 bytes aleatorios en base64url sin relleno. */
export const SECRETO_43 = '[A-Za-z0-9_-]{43}';

export const regexToken = (prefijo: 'vi' | 'pu', empresaId: string): RegExp =>
  new RegExp(`^${prefijo}\\.${empresaId}\\.(${UUID})\\.(${SECRETO_43})$`);

export interface PartesTokenPuente {
  prefijo: string;
  empresaId: string;
  id: string;
  secreto: string;
}

export function partesDe(token: string): PartesTokenPuente {
  const [prefijo, empresaId, id, secreto] = token.split('.') as [string, string, string, string];
  return { prefijo, empresaId, id, secreto };
}

const armar = (p: PartesTokenPuente): string => `${p.prefijo}.${p.empresaId}.${p.id}.${p.secreto}`;

/** El mismo token con la empresa cambiada (por ejemplo a la de B). */
export const conEmpresaDe = (token: string, empresaId: string): string =>
  armar({ ...partesDe(token), empresaId });

/** El mismo token con el id cambiado. */
export const conIdDe = (token: string, id: string): string => armar({ ...partesDe(token), id });

/** El mismo token con el secreto de otro token (bien formado, distinto). */
export const conSecretoDe = (token: string, otro: string): string =>
  armar({ ...partesDe(token), secreto: partesDe(otro).secreto });

/**
 * El mismo token con un carácter del principio del secreto cambiado (el último carácter de 43 en base64url solo
 * lleva cuatro bits útiles: cambiarlo puede dejar los mismos 32 bytes). Sigue bien formado.
 */
export function conSecretoAdulterado(token: string): string {
  const p = partesDe(token);
  const primero = p.secreto[0] === 'A' ? 'B' : 'A';
  return armar({ ...p, secreto: primero + p.secreto.slice(1) });
}

/** Un token bien formado que no existe. */
export const tokenAleatorio = (prefijo: 'vi' | 'pu', empresaId: string): string =>
  `${prefijo}.${empresaId}.${randomUUID()}.${randomBytes(32).toString('base64url')}`;

// ------------------------------------------------------------------------------------------------
// Peticiones del puente y de la configuración
// ------------------------------------------------------------------------------------------------

const CABECERA_PROTOCOLO = { [CABECERA_PROTOCOLO_PUENTE]: String(VERSION_PROTOCOLO_PUENTE) };

/** Una petición del puente: `Authorization: Bearer <token>` (o ninguna) y `X-Puente-Protocolo: 1`. */
export function llamarPuente(
  ctx: Pick<AppP6, 'http'>,
  token: string | undefined,
  metodo: Metodo,
  ruta: string,
  cuerpo?: unknown,
  cabeceras: Record<string, string> = {},
) {
  const llamada: Llamada = {
    metodo,
    ruta,
    cabeceras: { ...CABECERA_PROTOCOLO, ...cabeceras },
    ...(cuerpo === undefined ? {} : { cuerpo }),
  };
  return llamar(ctx, token, llamada);
}

/** Una escritura de la API de la PWA con `Idempotency-Key` (nueva por defecto). */
export function conClave(
  ctx: Pick<AppP6, 'http'>,
  token: string | undefined,
  metodo: Metodo,
  ruta: string,
  cuerpo?: unknown,
  clave: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo,
    ruta,
    ...(cuerpo === undefined ? {} : { cuerpo }),
    cabeceras: { 'Idempotency-Key': clave },
  });
}

// ------------------------------------------------------------------------------------------------
// Empresas y personas
// ------------------------------------------------------------------------------------------------

export interface EmpresaP6 {
  base: EmpresaDePrueba;
  empresaId: string;
  /** Sucursales en el orden del alta. */
  S1: string;
  S2: string;
  S3: string | null;
  nombreS1: string;
  adminId: string;
  /** Sesión de contraseña del Administrador sin sucursal activa. */
  tokenAdmin: string;
  /** Sesión de contraseña del Administrador con S1 activa. */
  tokenS1: string;
}

/** Da de alta una empresa con `sucursales` sucursales (2 o 3) y abre dos sesiones de su Administrador. */
export async function crearEmpresaP6(
  ctx: AppP6,
  sa: SuperadminDePrueba,
  sucursales = 2,
): Promise<EmpresaP6> {
  const base = await altaEmpresa(ctx, sa, { sucursalesPorEmisor: sucursales });
  const [S1, S2, S3] = base.sucursales.map((s) => s.id) as [string, string, string | undefined];
  return {
    base,
    empresaId: base.empresaId,
    S1,
    S2,
    S3: S3 ?? null,
    nombreS1: base.sucursales[0]!.nombre,
    adminId: base.admin.id,
    tokenAdmin: base.admin.token,
    tokenS1: await sesionContrasena(ctx, base.admin, S1),
  };
}

export const ROLES_SIN_ADMINISTRAR: RolCarta[] = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'];

export interface SesionesDeRol {
  persona: PersonaCarta;
  /** Sesión de contraseña con S1 activa. */
  contrasena: string;
  /** Sesión de PIN con S1 activa (el equipo viaja solo en las llamadas de `llamar`). */
  pin: string;
}

/** Una persona de cada rol con acceso a S1, con una sesión de contraseña y otra de PIN. */
export async function crearRolesP6(
  ctx: AppP6,
  e: EmpresaP6,
): Promise<Record<RolCarta, SesionesDeRol>> {
  const resultado = {} as Record<RolCarta, SesionesDeRol>;
  for (const rol of ROLES_SIN_ADMINISTRAR) {
    const persona = await crearPersona(ctx, e.tokenAdmin, [{ sucursalId: e.S1, rol }]);
    const sesiones = await sesionesDe(ctx, persona, e.S1);
    resultado[rol] = { persona, ...sesiones };
  }
  return resultado;
}

/** Crea una estación en la carta de la empresa (`POST /carta/estaciones`). */
export async function crearEstacion(ctx: AppP6, token: string): Promise<string> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/estaciones',
    cuerpo: { nombre: unico('Estación') },
  });
  exigirEstado(res, 201, 'crear una estación');
  return res.body.id as string;
}

// ------------------------------------------------------------------------------------------------
// Impresoras, vinculación y trabajos por las rutas de 3b
// ------------------------------------------------------------------------------------------------

/** Cuerpo válido de `POST /sucursales/:sucursalId/impresoras` (impresora de red). */
export const cuerpoImpresora = (extra: Record<string, unknown> = {}) => ({
  nombre: unico('Impresora'),
  conexion: { tipo: 'RED', host: '127.0.0.1', puerto: 9100 },
  anchoMm: 80,
  juegoCaracteres: 'PC850',
  gaveta: false,
  ...extra,
});

export async function crearImpresora(
  ctx: AppP6,
  token: string,
  sucursalId: string,
  extra: Record<string, unknown> = {},
): Promise<ImpresoraRespuesta> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/impresoras`,
    cuerpo: cuerpoImpresora(extra),
  });
  exigirEstado(res, 201, 'crear una impresora');
  return res.body as ImpresoraRespuesta;
}

export async function desactivarImpresora(
  ctx: AppP6,
  token: string,
  sucursalId: string,
  impresoraId: string,
): Promise<void> {
  const res = await llamar(ctx, token, {
    metodo: 'patch',
    ruta: `/sucursales/${sucursalId}/impresoras/${impresoraId}`,
    cuerpo: { activa: false },
  });
  exigirEstado(res, 200, 'desactivar la impresora');
}

/** `POST /sucursales/:sucursalId/vinculaciones-puente`. */
export async function crearVinculacion(
  ctx: AppP6,
  token: string,
  sucursalId: string,
): Promise<VinculacionRespuesta> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/vinculaciones-puente`,
  });
  exigirEstado(res, 201, 'crear el código de vinculación');
  return res.body as VinculacionRespuesta;
}

export const ENTRADA_PUENTE: VincularPuenteEntrada = {
  nombreEquipo: 'Tablet de cocina',
  modelo: 'Galaxy Tab A9',
  versionApp: '1.0.3',
};

/** `POST /puente/vinculacion` con el código `vi.…` (sin comprobar el resultado). */
export function vincular(
  ctx: AppP6,
  tokenVinculacion: string | undefined,
  cuerpo: unknown = ENTRADA_PUENTE,
) {
  return llamarPuente(ctx, tokenVinculacion, 'post', '/puente/vinculacion', cuerpo);
}

export interface PuenteVinculado {
  /** Token `pu.…`. */
  token: string;
  id: string;
  empresaId: string;
  sucursalId: string;
  nombre: string;
  /** Código `vi.…` con el que se vinculó. */
  codigo: string;
  respuesta: VincularPuenteRespuesta;
}

/** Crea el código de vinculación y vincula; exige 201. */
export async function nuevoPuente(
  ctx: AppP6,
  tokenAdmin: string,
  e: Pick<EmpresaP6, 'empresaId'>,
  sucursalId: string,
  cuerpo: unknown = ENTRADA_PUENTE,
): Promise<PuenteVinculado> {
  const codigo = (await crearVinculacion(ctx, tokenAdmin, sucursalId)).token;
  const res = await vincular(ctx, codigo, cuerpo);
  exigirEstado(res, 201, 'vincular el puente');
  const respuesta = vincularPuenteRespuestaSchema.parse(res.body);
  return {
    token: respuesta.token,
    id: respuesta.puente.id,
    empresaId: e.empresaId,
    sucursalId,
    nombre: respuesta.puente.nombre,
    codigo,
    respuesta,
  };
}

/** `POST /sucursales/:sucursalId/impresoras/:id/prueba`: crea un trabajo `PRUEBA` y devuelve su id. */
export async function crearPrueba(
  ctx: AppP6,
  token: string,
  sucursalId: string,
  impresoraId: string,
): Promise<string> {
  const res = await conClave(
    ctx,
    token,
    'post',
    `/sucursales/${sucursalId}/impresoras/${impresoraId}/prueba`,
  );
  exigirEstado(res, 201, 'pedir la página de prueba');
  return res.body.trabajoId as string;
}

/** Ids de los puentes de una sucursal (activos y revocados) tal como los lista el Administrador. */
export async function listarPuentes(
  ctx: AppP6,
  token: string,
  sucursalId: string,
): Promise<
  {
    id: string;
    nombre: string;
    activo: boolean;
    modelo: string | null;
    versionApp: string | null;
    vinculadoEn: string;
    revocadoEn: string | null;
    ultimaSenalEn: string | null;
  }[]
> {
  const res = await llamar(ctx, token, {
    metodo: 'get',
    ruta: `/sucursales/${sucursalId}/puentes`,
  });
  exigirEstado(res, 200, 'listar los puentes');
  return res.body as never;
}

/** `GET /puente/trabajos` con exigencia de 200: los trabajos que ve el puente. */
export async function trabajosDelPuente(
  ctx: AppP6,
  puente: Pick<PuenteVinculado, 'token'>,
): Promise<{ id: string; impresoraId: string; tipo: string; creadoEn: string; bytes: string }[]> {
  const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
  exigirEstado(res, 200, 'pedir los trabajos del puente');
  return res.body as never;
}

/** Reporta `IMPRESO` todo lo que el puente ve, hasta que no quede nada (deja la cola vacía). */
export async function vaciarCola(
  ctx: AppP6,
  puente: Pick<PuenteVinculado, 'token'>,
): Promise<number> {
  let total = 0;
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const lista = await trabajosDelPuente(ctx, puente);
    if (lista.length === 0) return total;
    for (const t of lista) {
      const res = await llamarPuente(
        ctx,
        puente.token,
        'post',
        `/puente/trabajos/${t.id}/resultado`,
        { resultado: 'IMPRESO' },
      );
      exigirEstado(res, 200, 'reportar IMPRESO');
      total++;
    }
  }
  throw new Error('La cola del puente no se vació en 20 vueltas');
}

// ------------------------------------------------------------------------------------------------
// Auditoría y trazabilidad
// ------------------------------------------------------------------------------------------------

/** Las acciones auditadas de 3b (criterio 130). */
export const ACCIONES_IMPRESION = [
  'crear_impresora',
  'modificar_impresora',
  'configurar_destino_estacion',
  'configurar_impresion_sucursal',
  'crear_vinculacion_puente',
  'vincular_puente',
  'revocar_puente',
] as const;
export type AccionImpresion = (typeof ACCIONES_IMPRESION)[number];

/** Filas de auditoría de 3b de una empresa, en orden. */
export function auditoriaImpresion(admin: Client, empresaId: string): Promise<FilaAuditoria[]> {
  return filasDeAuditoria(admin, 'empresa_id = $1 AND accion = ANY($2::text[])', [
    empresaId,
    [...ACCIONES_IMPRESION],
  ]);
}

/** Todas las filas de auditoría de una empresa (para comprobar que algo no dejó ninguna). */
export async function contarAuditoria(admin: Client, empresaId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM auditoria WHERE empresa_id = $1`,
    [empresaId],
  );
  return Number(rows[0]!.n);
}

/** Las filas de auditoría que aparecieron después de `antes` (ids ya vistos), solo de 3b. */
export async function auditoriaNueva(
  admin: Client,
  empresaId: string,
  antes: FilaAuditoria[],
): Promise<FilaAuditoria[]> {
  const vistos = new Set(antes.map((f) => f.id));
  return (await auditoriaImpresion(admin, empresaId)).filter((f) => !vistos.has(f.id));
}

export interface AutorDeFila {
  creadoPorUsuarioId: string | null;
  creadoPorEquipoId: string | null;
  creadoPorSistema: string | null;
  actualizadoPorUsuarioId: string | null;
  actualizadoPorSistema: string | null;
}

/** El autor de creación y de la última escritura de una fila (trazabilidad, criterio 81 de 3a). */
export async function autorDe(admin: Client, tabla: string, id: string): Promise<AutorDeFila> {
  const { rows } = await admin.query(
    `SELECT creado_por_usuario_id, creado_por_equipo_id, creado_por_sistema,
            actualizado_por_usuario_id, actualizado_por_sistema
       FROM ${tabla} WHERE id = $1`,
    [id],
  );
  if (rows.length !== 1) throw new Error(`Se esperaba una fila en ${tabla} con id ${id}`);
  const f = rows[0] as Record<string, string | null>;
  return {
    creadoPorUsuarioId: f.creado_por_usuario_id ?? null,
    creadoPorEquipoId: f.creado_por_equipo_id ?? null,
    creadoPorSistema: f.creado_por_sistema ?? null,
    actualizadoPorUsuarioId: f.actualizado_por_usuario_id ?? null,
    actualizadoPorSistema: f.actualizado_por_sistema ?? null,
  };
}

// ------------------------------------------------------------------------------------------------
// Las tablas nuevas de 3b y los privilegios de `restaurante_api` ("Permisos" de `spec.md`)
// ------------------------------------------------------------------------------------------------

export const TABLAS_IMPRESION = [
  'impresora',
  'estacion_destino',
  'impresion_sucursal',
  'vinculacion_puente',
  'puente',
  'trabajo_impresion',
] as const;
export type TablaImpresion = (typeof TABLAS_IMPRESION)[number];

export type Privilegio = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export const PRIVILEGIOS_IMPRESION: Record<TablaImpresion, Privilegio[]> = {
  impresora: ['SELECT', 'INSERT', 'UPDATE'],
  estacion_destino: ['SELECT', 'INSERT', 'UPDATE'],
  impresion_sucursal: ['SELECT', 'INSERT', 'UPDATE'],
  vinculacion_puente: ['SELECT', 'INSERT', 'UPDATE'],
  puente: ['SELECT', 'INSERT', 'UPDATE'],
  trabajo_impresion: ['SELECT', 'INSERT', 'UPDATE'],
};

/** `true` si la tabla existe en `public`. */
export async function existeTabla(admin: Client, tabla: string): Promise<boolean> {
  const r = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
    `public.${tabla}`,
  ]);
  return r.rows[0]!.t !== null;
}

/**
 * Foto de las tablas de 3b de una empresa y de su auditoría. Una tabla que todavía no existe aparece como
 * `'SIN_TABLA'`, así la prueba compara antes y después y falla en lo que importa, no en la foto.
 */
export async function instantaneaImpresion(
  admin: Client,
  empresaId: string,
): Promise<Record<string, unknown>> {
  const foto: Record<string, unknown> = {};
  for (const tabla of TABLAS_IMPRESION) {
    if (!(await existeTabla(admin, tabla))) {
      foto[tabla] = 'SIN_TABLA';
      continue;
    }
    const { rows } = await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    );
    foto[tabla] = rows.map((r) => r.fila);
  }
  const auditoria = await admin.query(
    `SELECT id, accion FROM auditoria WHERE empresa_id = $1 ORDER BY id::text`,
    [empresaId],
  );
  foto.auditoria = auditoria.rows;
  return foto;
}

/** Filas de una tabla de 3b de una empresa (la tabla debe existir). */
export async function filasDe(
  admin: Client,
  tabla: TablaImpresion,
  empresaId: string,
): Promise<Record<string, unknown>[]> {
  const { rows } = await admin.query(
    `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
    [empresaId],
  );
  return rows.map((r) => r.fila as Record<string, unknown>);
}

// ------------------------------------------------------------------------------------------------
// Siembra por SQL (como `restaurante_api` con el contexto y el actor fijados)
// ------------------------------------------------------------------------------------------------

/** Lo que la siembra por SQL necesita de una empresa dada de alta por la API. */
export interface BaseImpresion {
  empresaId: string;
  sucursal1: string;
  sucursal2: string;
  /** Un usuario de la empresa (el Administrador). */
  usuarioId: string;
  /** Dos estaciones de la carta de la empresa. */
  estacion1: string;
  estacion2: string;
  /** Una comanda y una pre-cuenta de la empresa (de las tablas de 3a). */
  comandaId: string;
  precuentaId: string;
}

/** Ids de las filas sembradas, una por tabla (más una segunda impresora, de S2). */
export interface FilasImpresion {
  impresora: string;
  impresoraS2: string;
  estacionDestino: string;
  impresionSucursal: string;
  puente: string;
  vinculacion: string;
  trabajo: string;
}

const HUELLA = "decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')";

const DOCUMENTO_PRUEBA = JSON.stringify({
  version: 1,
  tipo: 'PRUEBA',
  bloques: [{ tipo: 'titulo', texto: 'Prueba' }],
});

/**
 * Siembra, con el contexto y el actor de la empresa, las filas de las seis tablas de 3b: dos impresoras (S1 y
 * S2), el destino de una estación a la impresora de S1, la impresora de caja de S1, un puente activo de S1, la
 * vinculación con la que se vinculó (usada) y un trabajo de prueba pendiente sin comanda.
 */
export async function sembrarFilasImpresion(
  apiCliente: Client,
  base: BaseImpresion,
): Promise<FilasImpresion> {
  const f: FilasImpresion = {
    impresora: randomUUID(),
    impresoraS2: randomUUID(),
    estacionDestino: randomUUID(),
    impresionSucursal: randomUUID(),
    puente: randomUUID(),
    vinculacion: randomUUID(),
    trabajo: randomUUID(),
  };
  const E = base.empresaId;
  const q = (sql: string, parametros: unknown[]) => apiCliente.query(sql, parametros);
  await enTransaccion(
    apiCliente,
    E,
    async () => {
      for (const [id, sucursal] of [
        [f.impresora, base.sucursal1],
        [f.impresoraS2, base.sucursal2],
      ] as const) {
        await q(
          `INSERT INTO impresora (id, empresa_id, sucursal_id, nombre, conexion_tipo, host, puerto, mac, ancho_mm,
                                  juego_caracteres, gaveta, activa, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, 'RED', '192.168.1.50', 9100, NULL, 80, 'PC850', false, true, now(), now())`,
          [id, E, sucursal, unico('Impresora')],
        );
      }
      await q(
        `INSERT INTO estacion_destino (id, empresa_id, sucursal_id, estacion_id, destino, impresora_id, creado_en,
                                       actualizado_en)
         VALUES ($1, $2, $3, $4, 'IMPRESORA', $5, now(), now())`,
        [f.estacionDestino, E, base.sucursal1, base.estacion1, f.impresora],
      );
      await q(
        `INSERT INTO impresion_sucursal (id, empresa_id, sucursal_id, impresora_caja_id, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, now(), now())`,
        [f.impresionSucursal, E, base.sucursal1, f.impresora],
      );
      await q(
        `INSERT INTO puente (id, empresa_id, sucursal_id, nombre, modelo, version_app, huella_secreto, activo,
                             revocado_en, ultima_senal_en, estado_impresoras, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'Galaxy Tab A9', '1.0.3', ${HUELLA}, true, NULL, NULL, '{}'::jsonb, now(), now())`,
        [f.puente, E, base.sucursal1, unico('Puente')],
      );
      await q(
        `INSERT INTO vinculacion_puente (id, empresa_id, sucursal_id, huella_secreto, expira_en, usada_en,
                                         invalidada_en, puente_id, creado_en, actualizado_en)
         VALUES ($1, $2, $3, ${HUELLA}, now() + interval '10 minutes', now(), NULL, $4, now(), now())`,
        [f.vinculacion, E, base.sucursal1, f.puente],
      );
      await q(
        `INSERT INTO trabajo_impresion (id, empresa_id, sucursal_id, impresora_id, tipo, documento, comanda_id,
                                        precuenta_id, reimpresion_de_id, estado, dia_operativo, intentos,
                                        ultimo_error, entregado_en, impreso_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'PRUEBA', $5::jsonb, NULL, NULL, NULL, 'PENDIENTE', '2026-11-02', 0, NULL, NULL,
                 NULL, now(), now())`,
        [f.trabajo, E, base.sucursal1, f.impresora, DOCUMENTO_PRUEBA],
      );
    },
    { confirmar: true },
  );
  return f;
}

/** Siembra la carta mínima, una segunda estación y las filas de 3a y de 3b de una empresa. */
export async function sembrarEmpresaSql(
  ctx: AppP6,
  apiCliente: Client,
  e: EmpresaP6,
): Promise<{ base: BaseImpresion; filas: FilasImpresion; salon: FilasSalon }> {
  const carta = await sembrarCarta(ctx, e.tokenAdmin);
  const estacion2 = await crearEstacion(ctx, e.tokenAdmin);
  const salon = await sembrarFilasSalon(apiCliente, {
    empresaId: e.empresaId,
    sucursal1: e.S1,
    sucursal2: e.S2,
    usuarioId: e.adminId,
    estacionId: carta.estacionId,
    productoId: carta.productoId,
  });
  const base: BaseImpresion = {
    empresaId: e.empresaId,
    sucursal1: e.S1,
    sucursal2: e.S2,
    usuarioId: e.adminId,
    estacion1: carta.estacionId,
    estacion2,
    comandaId: salon.comanda,
    precuentaId: salon.precuenta,
  };
  return { base, filas: await sembrarFilasImpresion(apiCliente, base), salon };
}

// ------------------------------------------------------------------------------------------------
// El mundo de dos empresas con puentes, impresoras y trabajos, por las rutas de 3b
// ------------------------------------------------------------------------------------------------

export interface MundoP6 {
  A: EmpresaP6;
  B: EmpresaP6;
  /** Impresoras de red: A en S1 (activa), A en S1 (desactivada), A en S2 y B en S1. */
  impA1: string;
  impA1Inactiva: string;
  impA2: string;
  impB1: string;
  /** Un puente vinculado en A S1, en A S2 y en B S1. */
  puA1: PuenteVinculado;
  puA2: PuenteVinculado;
  puB1: PuenteVinculado;
}

/**
 * Deja listas dos empresas (A con tres sucursales, B con dos), sus impresoras y un puente vinculado en A S1, A S2
 * y B S1. No crea trabajos: cada prueba crea los suyos con `crearPrueba`.
 */
export async function construirMundoP6(ctx: AppP6, sa: SuperadminDePrueba): Promise<MundoP6> {
  const A = await crearEmpresaP6(ctx, sa, 3);
  const B = await crearEmpresaP6(ctx, sa, 2);
  const impA1 = (await crearImpresora(ctx, A.tokenAdmin, A.S1)).id;
  const impA1Inactiva = (await crearImpresora(ctx, A.tokenAdmin, A.S1)).id;
  await desactivarImpresora(ctx, A.tokenAdmin, A.S1, impA1Inactiva);
  const impA2 = (await crearImpresora(ctx, A.tokenAdmin, A.S2)).id;
  const impB1 = (await crearImpresora(ctx, B.tokenAdmin, B.S1)).id;
  const puA1 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S1);
  const puA2 = await nuevoPuente(ctx, A.tokenAdmin, A, A.S2);
  const puB1 = await nuevoPuente(ctx, B.tokenAdmin, B, B.S1);
  return { A, B, impA1, impA1Inactiva, impA2, impB1, puA1, puA2, puB1 };
}

/** Comprueba que cada respuesta tiene el mismo cuerpo (y estado) que la primera. */
export function cuerpoDe(res: { status: number; body: unknown }): string {
  return JSON.stringify({ estado: res.status, cuerpo: res.body });
}
