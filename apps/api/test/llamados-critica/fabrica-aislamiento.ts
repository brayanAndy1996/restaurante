// spec: 005-carta-web-mesa (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P1 (aislamiento de las rutas públicas) y P4 (permisos y trazabilidad) de la
// historia 005. Solo usan contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` (o el tiempo
// real habilitado) e `InventarioDePrueba`, las empresas dadas de alta con `POST /plataforma/empresas`, los usuarios
// creados con `POST /usuarios`, la carta de ejemplo de 004 creada con las rutas de `/carta`, el mapa de mesas con
// las rutas de zonas y mesas, y la carta web y los QR configurados por sus propias rutas (nunca por SQL). Para leer
// filas usan un cliente administrador (solo lectura). No leen la implementación de la historia.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import type request from 'supertest';
import { vi } from 'vitest';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { RelojManual } from '../../src/nucleo/reloj';
import { pngValido } from '../carta-critica/fabrica-permisos-carta';
import { ClientePublico } from '../soporte';
import {
  PoolDeMesas,
  crearEscenarioP3,
  sesiones,
  sembrarCartaSalon,
  type CartaSalon,
  type EscenarioP3,
  type PersonaConSesion,
} from '../salon-critica/fabrica-p3';
import {
  arrancarP4,
  asentar,
  exigirEstado,
  exigirSinFallos,
  llamar,
  postConClave,
  unico,
  type AppP4,
} from '../salon-critica/fabrica-p4';
import { esperarError, equipoRecordadoDe } from '../salon-critica/fabrica-p3';

export {
  asentar,
  esperarError,
  equipoRecordadoDe,
  exigirEstado,
  exigirSinFallos,
  llamar,
  postConClave,
  sesiones,
  unico,
};
export type { AppP4, CartaSalon, EscenarioP3, PersonaConSesion };
export { ClientePublico };

export const MINUTO = 60_000;

/** Lunes 2 de noviembre de 2026, 14:00 en Lima: dentro del horario de 12:00 a 23:00 de los datos de ejemplo. */
export const INICIO_TARDE = '2026-11-02T14:00:00-05:00';

/** `CARTA_WEB_URL` de las pruebas (`fijarEntornoDePrueba`). */
export const CARTA_WEB_URL = 'http://localhost:3001';

/** El `ORIGENES_PERMITIDOS` de las pruebas. */
export const ORIGEN_DE_LA_PWA = 'http://localhost:5173';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cuerpo de todos los 404 públicos (criterio 14). */
export const CUERPO_404_PUBLICO = {
  codigo: 'NO_ENCONTRADO',
  mensaje: 'La carta no está disponible',
} as const;

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

/**
 * Arranca la API real con `RelojManual` (a las 14:00 del lunes por defecto), sin `EMPRESA_POR_HEADER`, con el
 * `PublicadorEnMemoria` o con el tiempo real habilitado (`tiempoReal`), y la deja escuchando un puerto.
 */
export function arrancarAislamiento(
  opciones: { poolMax?: number; tiempoReal?: boolean; reloj?: RelojManual } = {},
): Promise<AppP4> {
  return arrancarP4({
    poolMax: opciones.poolMax ?? 4,
    ...(opciones.tiempoReal === undefined ? {} : { tiempoReal: opciones.tiempoReal }),
    reloj: opciones.reloj ?? new RelojManual(INICIO_TARDE),
  });
}

/** Un cliente público (sin sesión) con su propia IP. */
export const clientePublico = (ctx: Pick<AppP4, 'app'>, ip?: string): ClientePublico =>
  new ClientePublico(ctx.app, ip === undefined ? {} : { ip });

// ------------------------------------------------------------------------------------------------
// El mundo: dos empresas con carta, mapa de mesas, carta web publicada y QR
// ------------------------------------------------------------------------------------------------

export interface MesaDelMundo {
  id: string;
  nombre: string;
  zonaId: string;
  /** Código del QR, tal como lo da `GET /sucursales/:sucursalId/qr-mesas`. */
  codigo: string;
}

export interface EmpresaDelMundo {
  empresaId: string;
  nombreCarta: string;
  /** Dirección (slug) de la empresa en la carta web. */
  slug: string;
  colorPrincipal: string;
  S1: string;
  S2: string;
  S3: string | null;
  /** Direcciones de las sucursales S1 y S2 (la misma en las dos empresas). */
  slugS1: string;
  slugS2: string;
  /** Sesión de contraseña del Administrador sin sucursal activa y con S1 activa. */
  tokenAdmin: string;
  tokenAdminS1: string;
  carta: CartaSalon;
  /** Ids de los grupos de modificadores (Término, Extras y Bebida). */
  grupoIds: string[];
  familiaId: string;
  /** Mesas "4" (capacidad 4) y "12" (capacidad 2) de S1, y "S2-1" de S2. */
  mesa4: MesaDelMundo;
  mesa12: MesaDelMundo;
  mesaS2: MesaDelMundo;
  /** Un producto que solo se vende en S2 (A) o un producto exclusivo de la empresa (B). */
  productoExclusivo: { id: string; nombre: string };
  /** Id del emisor, del Mozo, etc., para comparar con lo que sale en las respuestas. */
  mozo: PersonaConSesion;
  cocina: PersonaConSesion;
  cajero: PersonaConSesion;
  supervisor: PersonaConSesion;
}

export interface Mundo {
  e: EscenarioP3;
  A: EmpresaDelMundo;
  B: EmpresaDelMundo;
}

const aleatorio = (): string => randomBytes(5).toString('hex');

/** Tramos de lunes a domingo, de 12:00 a 23:00 (dato de ejemplo de `spec.md`). */
export const HORARIO_DE_EJEMPLO = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
  dia,
  desde: '12:00',
  hasta: '23:00',
}));

async function crearZona(
  ctx: AppP4,
  token: string,
  sucursalId: string,
  nombre: string,
): Promise<string> {
  const zona = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/zonas`,
    cuerpo: { nombre, columnas: 10, filas: 10 },
  });
  exigirEstado(zona, 201, 'crear una zona');
  return zona.body.id as string;
}

async function crearMesa(
  ctx: AppP4,
  token: string,
  sucursalId: string,
  zonaId: string,
  datos: { nombre: string; capacidad: number; columna: number; fila: number },
): Promise<{ id: string; nombre: string; zonaId: string }> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/zonas/${zonaId}/mesas`,
    cuerpo: { ...datos, forma: 'CUADRADA' },
  });
  exigirEstado(res, 201, `crear la mesa ${datos.nombre}`);
  return { id: res.body.id as string, nombre: datos.nombre, zonaId };
}

/** Los códigos de QR de una sucursal por nombre de mesa (`GET /sucursales/:sucursalId/qr-mesas`). */
export async function codigosDeQr(
  ctx: AppP4,
  token: string,
  sucursalId: string,
): Promise<Map<string, { mesaId: string; codigo: string; url: string }>> {
  const res = await llamar(ctx, token, {
    metodo: 'get',
    ruta: `/sucursales/${sucursalId}/qr-mesas`,
  });
  exigirEstado(res, 200, 'la hoja de QR');
  const mapa = new Map<string, { mesaId: string; codigo: string; url: string }>();
  for (const m of res.body.mesas as {
    mesaId: string;
    nombre: string;
    codigo: string | null;
    url: string | null;
  }[]) {
    if (m.codigo === null || m.url === null) {
      throw new Error(`La mesa ${m.nombre} no tiene código de QR (criterio 6)`);
    }
    mapa.set(m.nombre, { mesaId: m.mesaId, codigo: m.codigo, url: m.url });
  }
  return mapa;
}

/** Crea `cantidad` mesas nuevas en una zona nueva de la sucursal y devuelve sus códigos. */
export async function mesasNuevas(
  ctx: AppP4,
  tokenAdmin: string,
  sucursalId: string,
  cantidad: number,
): Promise<MesaDelMundo[]> {
  const pool = new PoolDeMesas(ctx, tokenAdmin, sucursalId);
  const creadas = [];
  for (let i = 0; i < cantidad; i++) creadas.push(await pool.siguiente());
  const codigos = await codigosDeQr(ctx, tokenAdmin, sucursalId);
  return creadas.map((m) => {
    const q = codigos.get(m.nombre);
    if (q === undefined) throw new Error(`La mesa ${m.nombre} no aparece en la hoja de QR`);
    return { id: m.id, nombre: m.nombre, zonaId: m.zonaId, codigo: q.codigo };
  });
}

async function prepararEmpresa(
  ctx: AppP4,
  e: EscenarioP3,
  clave: 'A' | 'B',
  nombreCarta: string,
  colorPrincipal: string,
): Promise<EmpresaDelMundo> {
  const x = e[clave];
  const token = x.tokenAdmin;
  const carta = await sembrarCartaSalon(ctx, token);

  // Grupos de modificadores de la empresa (el contrato de la carta pública los expone por id).
  const grupos = await llamar(ctx, token, { metodo: 'get', ruta: '/carta/grupos-modificadores' });
  exigirEstado(grupos, 200, 'listar los grupos de modificadores');
  const lista = (Array.isArray(grupos.body) ? grupos.body : (grupos.body.grupos ?? [])) as {
    id: string;
  }[];
  const grupoIds = lista.map((g) => g.id);

  // Horario de S1 y S2 (de lunes a domingo, de 12:00 a 23:00).
  for (const sucursalId of [x.S1, x.S2]) {
    const res = await llamar(ctx, token, {
      metodo: 'patch',
      ruta: `/sucursales/${sucursalId}`,
      cuerpo: { horario: HORARIO_DE_EJEMPLO },
    });
    exigirEstado(res, 200, 'cargar el horario de la sucursal');
  }

  // Mapa de mesas: "Salón principal" con las mesas 4 y 12 en S1, y una zona con una mesa en S2.
  const zonaS1 = await crearZona(ctx, token, x.S1, 'Salón principal');
  const m4 = await crearMesa(ctx, token, x.S1, zonaS1, {
    nombre: '4',
    capacidad: 4,
    columna: 1,
    fila: 1,
  });
  const m12 = await crearMesa(ctx, token, x.S1, zonaS1, {
    nombre: '12',
    capacidad: 2,
    columna: 2,
    fila: 1,
  });
  const zonaS2 = await crearZona(ctx, token, x.S2, 'Terraza');
  const mS2 = await crearMesa(ctx, token, x.S2, zonaS2, {
    nombre: 'S2-1',
    capacidad: 4,
    columna: 1,
    fila: 1,
  });

  // Un producto propio de la empresa: en A solo se vende en S2; en B es exclusivo (sin igual en A).
  const nombreExclusivo = `Plato exclusivo ${clave} ${aleatorio()}`;
  const exclusivo = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: {
      tipo: 'SIMPLE',
      nombre: nombreExclusivo,
      familiaId: carta.familiaId,
      precio: '31.00',
      estacionId: carta.cocinaId,
      tipoControlStock: 'SIN_CONTROL',
    },
  });
  exigirEstado(exclusivo, 201, 'crear el producto exclusivo');
  if (clave === 'A') {
    const ajuste = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${exclusivo.body.id as string}/sucursales/${x.S1}`,
      cuerpo: { precio: null, disponible: false },
    });
    exigirEstado(ajuste, 200, 'quitar el producto de S1');
  }

  // Carta web: nombre, dirección, color, logo y las sucursales publicadas.
  const slug = `${clave === 'A' ? 'sabor' : 'rincon'}-${aleatorio()}`;
  const config = await llamar(ctx, token, {
    metodo: 'put',
    ruta: '/carta-web',
    cuerpo: { nombre: nombreCarta, slug, colorPrincipal },
  });
  exigirEstado(config, 200, 'configurar la carta web');
  exigirEstado(
    await llamar(ctx, token, {
      metodo: 'put',
      ruta: '/carta-web/logo',
      binario: { tipo: 'image/png', datos: pngValido(240, 240) },
    }),
    200,
    'subir el logo',
  );
  const slugS1 = 'miraflores';
  const slugS2 = 'san-isidro';
  for (const [sucursalId, s] of [
    [x.S1, slugS1],
    [x.S2, slugS2],
  ] as const) {
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: `/carta-web/sucursales/${sucursalId}`,
        cuerpo: { slug: s, publicada: true },
      }),
      200,
      'publicar la sucursal',
    );
  }

  // Códigos de QR (se crean con la mesa, criterio 6).
  const qrS1 = await codigosDeQr(ctx, token, x.S1);
  const qrS2 = await codigosDeQr(ctx, token, x.S2);
  const con = (m: { id: string; nombre: string; zonaId: string }, q: typeof qrS1): MesaDelMundo => {
    const c = q.get(m.nombre);
    if (c === undefined) throw new Error(`La mesa ${m.nombre} no aparece en la hoja de QR`);
    return { ...m, codigo: c.codigo };
  };
  const tokenAdminS1 = (await sesiones(ctx, x.base.admin, x.S1)).contrasena;

  return {
    empresaId: x.empresaId,
    nombreCarta,
    slug,
    colorPrincipal,
    S1: x.S1,
    S2: x.S2,
    S3: x.S3,
    slugS1,
    slugS2,
    tokenAdmin: token,
    tokenAdminS1,
    carta,
    grupoIds,
    familiaId: carta.familiaId,
    mesa4: con(m4, qrS1),
    mesa12: con(m12, qrS1),
    mesaS2: con(mS2, qrS2),
    productoExclusivo: { id: exclusivo.body.id as string, nombre: nombreExclusivo },
    mozo: x.mozo,
    cocina: x.cocina,
    cajero: x.cajero,
    supervisor: x.supervisor,
  };
}

/**
 * Crea las empresas A (S1, S2, S3) y B (S1, S2) con sus usuarios y, en cada una: la carta de ejemplo de 004, el
 * horario de 12:00 a 23:00, el mapa de mesas, un producto propio, la carta web publicada (con logo) y los QR. Es
 * el escenario de `spec.md` ("Datos de ejemplo") con una segunda empresa de datos parecidos.
 */
export async function crearMundo(ctx: AppP4): Promise<Mundo> {
  const e = await crearEscenarioP3(ctx);
  const A = await prepararEmpresa(ctx, e, 'A', 'Sabor Norteño', '#B3261E');
  const B = await prepararEmpresa(ctx, e, 'B', 'Rincón de prueba', '#1D6B3A');
  return { e, A, B };
}

// ------------------------------------------------------------------------------------------------
// Llamados
// ------------------------------------------------------------------------------------------------

/** Un pedido de un lomo saltado con 3/4 (28.00). */
export function pedidoDeLomo(
  carta: CartaSalon,
  extra: { id?: string; cantidad?: number; nota?: string } = {},
) {
  return {
    id: extra.id ?? randomUUID(),
    tipo: 'PEDIDO' as const,
    lineas: [
      {
        productoId: carta.lomoId,
        modificadorIds: [carta.terminoIds.tresCuartos],
        cantidad: extra.cantidad ?? 1,
      },
    ],
    ...(extra.nota === undefined ? {} : { nota: extra.nota }),
  };
}

export const llamarAlMozo = (id: string = randomUUID()) => ({ id, tipo: 'LLAMAR_MOZO' as const });
export const pedirLaCuenta = (id: string = randomUUID()) => ({ id, tipo: 'PEDIR_CUENTA' as const });

export const rutaDeLlamados = (codigo: string): string => `/publico/mesas/${codigo}/llamados`;

/** `POST /publico/mesas/:codigo/llamados` desde un cliente sin sesión. */
export function enviarLlamado(cliente: ClientePublico, codigo: string, cuerpo: unknown) {
  return cliente.post(rutaDeLlamados(codigo), cuerpo);
}

/** Crea un llamado y exige 201. */
export async function crearLlamadoOk<T extends { id: string }>(
  cliente: ClientePublico,
  codigo: string,
  cuerpo: T,
  descripcion = 'crear el llamado',
): Promise<request.Response> {
  const res = await enviarLlamado(cliente, codigo, cuerpo);
  exigirEstado(res, 201, descripcion);
  return res;
}

/** `Idempotency-Key` nueva para las escrituras de la PWA. */
export const clave = (): Record<string, string> => ({ 'Idempotency-Key': randomUUID() });

/** Atiende un llamado con la sesión indicada (exige 200). */
export async function atenderLlamado(
  ctx: AppP4,
  token: string,
  llamadoId: string,
  cuerpo: { ordenId?: string; comensales?: number } = {},
): Promise<request.Response> {
  const res = await postConClave(ctx, token, `/llamados/${llamadoId}/atencion`, cuerpo);
  exigirEstado(res, 200, 'atender el llamado');
  return res;
}

export async function descartarLlamado(
  ctx: AppP4,
  token: string,
  llamadoId: string,
  cuerpo: { motivo?: string } = {},
): Promise<request.Response> {
  const res = await postConClave(ctx, token, `/llamados/${llamadoId}/descarte`, cuerpo);
  exigirEstado(res, 200, 'descartar el llamado');
  return res;
}

export interface LlamadosSembrados {
  /** Orden abierta por el Mozo en la mesa 4 antes del llamado. */
  ordenId: string;
  /** `PEDIDO` de la mesa 4 (ocupada): atendido por el Mozo y descartado por otra persona, con su equipo. */
  descartado: string;
  /** `LLAMAR_MOZO` de la mesa 12 (libre): sigue `PENDIENTE`. */
  pendiente: string;
}

/**
 * Siembra por las rutas de la historia (nunca por SQL) los tres llamados que usan las pruebas de la base: uno
 * `DESCARTADO` que pasó por todas las columnas de quién (destinatario, orden, atendido y cerrado, con equipos) y uno
 * `PENDIENTE`. El segundo Mozo es `mozo2` si se da; si no, el mismo. Las dos sesiones de PIN dejan el equipo.
 */
export async function sembrarLlamados(
  ctx: AppP4,
  empresa: EmpresaDelMundo,
  cliente: ClientePublico,
  mozo2: PersonaConSesion = empresa.mozo,
): Promise<LlamadosSembrados> {
  const tokenMozo = (await sesiones(ctx, empresa.mozo, empresa.S1)).pin;
  const tokenCierra = (await sesiones(ctx, mozo2, empresa.S1)).pin;
  const abrir = await postConClave(ctx, tokenMozo, '/ordenes', {
    id: randomUUID(),
    mesaId: empresa.mesa4.id,
    comensales: 2,
  });
  exigirEstado(abrir, 201, 'abrir la mesa 4');
  const ordenId = abrir.body.id as string;
  const descartado = randomUUID();
  await crearLlamadoOk(
    cliente,
    empresa.mesa4.codigo,
    pedidoDeLomo(empresa.carta, { id: descartado }),
  );
  await atenderLlamado(ctx, tokenMozo, descartado);
  await descartarLlamado(ctx, tokenCierra, descartado, { motivo: 'Pedido falso' });
  const pendiente = randomUUID();
  await crearLlamadoOk(cliente, empresa.mesa12.codigo, llamarAlMozo(pendiente));
  return { ordenId, descartado, pendiente };
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

/** Filas de `llamado` de una empresa como JSON, para comparar el antes y el después. */
export async function fotoDeLlamados(admin: Client, empresaId: string): Promise<unknown[]> {
  const { rows } = await admin.query(
    `SELECT to_jsonb(t) AS fila FROM llamado t WHERE empresa_id = $1 ORDER BY id::text`,
    [empresaId],
  );
  return rows.map((r) => r.fila);
}

/** Fila de una tabla de empresa como JSON (`null` si no existe). */
export async function filaComoJson(
  admin: Client,
  tabla: string,
  id: string,
  empresaId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await admin.query(
    `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE id = $1 AND empresa_id = $2`,
    [id, empresaId],
  );
  return (rows[0]?.fila as Record<string, unknown> | undefined) ?? null;
}

const TABLAS_QUE_EXISTEN = new Set<string>();

export async function existeTabla(admin: Client, tabla: string): Promise<boolean> {
  if (TABLAS_QUE_EXISTEN.has(tabla)) return true;
  const r = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
    `public.${tabla}`,
  ]);
  const existe = r.rows[0]!.t !== null;
  if (existe) TABLAS_QUE_EXISTEN.add(tabla);
  return existe;
}

/** Cuántas filas tiene la tabla de una empresa (`-1` si la tabla todavía no existe). */
export async function contarFilas(
  admin: Client,
  tabla: string,
  empresaId: string,
): Promise<number> {
  if (!(await existeTabla(admin, tabla))) return -1;
  const r = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${tabla} WHERE empresa_id = $1`,
    [empresaId],
  );
  return r.rows[0]!.n;
}

/** Tablas de la carta y del mapa de las que puede salir un UUID de una respuesta pública. */
const TABLAS_DE_LA_CARTA = ['familia', 'producto', 'grupo_modificadores', 'modificador'] as const;

/** Tablas cuyo id nunca debe salir en una respuesta pública (criterio 21). */
const TABLAS_PROHIBIDAS = [
  'estacion',
  'sucursal',
  'emisor',
  'zona',
  'mesa',
  'orden',
  'orden_mesa',
  'envio',
  'item',
  'comanda',
  'usuario',
  'equipo',
  'componente_combo',
  'producto_grupo',
  'producto_sucursal',
  'carta_web',
  'carta_web_sucursal',
  'mesa_qr',
] as const;

export interface DuenoDeUuid {
  tabla: string;
  empresaId: string | null;
}

/** En qué tablas de la base aparece un UUID como `id` y de qué empresa es. */
export async function duenosDeUuid(admin: Client, uuid: string): Promise<DuenoDeUuid[]> {
  const duenos: DuenoDeUuid[] = [];
  const empresa = await admin.query(`SELECT 1 FROM empresa WHERE id = $1`, [uuid]);
  if (empresa.rows.length > 0) duenos.push({ tabla: 'empresa', empresaId: uuid });
  for (const tabla of [...TABLAS_DE_LA_CARTA, ...TABLAS_PROHIBIDAS]) {
    if (!(await existeTabla(admin, tabla))) continue;
    const r = await admin.query<{ empresa_id: string }>(
      `SELECT empresa_id FROM ${tabla} WHERE id = $1`,
      [uuid],
    );
    for (const f of r.rows) duenos.push({ tabla, empresaId: f.empresa_id });
  }
  return duenos;
}

/**
 * Comprueba que cada UUID de `uuids` es el id de una fila de la carta (familia, producto, grupo o modificador) de
 * `empresaId` y de ninguna otra tabla ni empresa. Devuelve los problemas encontrados.
 */
export async function problemasDeUuidsPublicos(
  admin: Client,
  uuids: Iterable<string>,
  empresaId: string,
  permitidos: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const problemas: string[] = [];
  for (const uuid of uuids) {
    if (permitidos.has(uuid)) continue;
    const duenos = await duenosDeUuid(admin, uuid);
    if (duenos.length === 0) {
      problemas.push(`${uuid}: no es el id de nada de la carta (¿un id que no debía salir?)`);
      continue;
    }
    for (const d of duenos) {
      if (!(TABLAS_DE_LA_CARTA as readonly string[]).includes(d.tabla)) {
        problemas.push(`${uuid}: es un id de ${d.tabla} y no debía salir`);
      } else if (d.empresaId !== empresaId) {
        problemas.push(`${uuid}: es un id de ${d.tabla} de otra empresa (${d.empresaId})`);
      }
    }
  }
  return problemas;
}

// ------------------------------------------------------------------------------------------------
// Recorrer una respuesta JSON
// ------------------------------------------------------------------------------------------------

/** Nombres de campo que son direcciones de archivos: su ruta puede llevar el id de la empresa (`carta/<empresa>/…`). */
const CAMPOS_DE_URL = new Set(['logoUrl', 'fotoUrl']);

/** Todas las rutas de claves de un valor JSON, con `[]` por cada nivel de lista (`familias[].productos[].id`). */
export function rutasDeClaves(valor: unknown, prefijo = ''): string[] {
  if (Array.isArray(valor)) {
    const dentro = valor.flatMap((v) => rutasDeClaves(v, `${prefijo}[]`));
    return [...new Set(dentro)];
  }
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => {
      const ruta = prefijo === '' ? k : `${prefijo}.${k}`;
      const hijos = rutasDeClaves(v, ruta);
      return hijos.length === 0 ? [ruta] : [ruta, ...hijos];
    });
  }
  return [];
}

/** Rutas de claves sin repetir y ordenadas. */
export const clavesOrdenadas = (valor: unknown): string[] =>
  [...new Set(rutasDeClaves(valor))].sort();

/** Todos los nombres de campo (sin la ruta) que aparecen en un valor JSON. */
export function nombresDeCampos(valor: unknown): Set<string> {
  const nombres = new Set<string>();
  const recorrer = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(recorrer);
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        nombres.add(k);
        recorrer(x);
      }
    }
  };
  recorrer(valor);
  return nombres;
}

/** Los textos de un valor JSON (sin las direcciones de archivos, que pueden llevar el id de la empresa). */
export function textosSinUrls(valor: unknown): string[] {
  const textos: string[] = [];
  const recorrer = (v: unknown): void => {
    if (typeof v === 'string') textos.push(v);
    else if (Array.isArray(v)) v.forEach(recorrer);
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (CAMPOS_DE_URL.has(k)) continue;
        recorrer(x);
      }
    }
  };
  recorrer(valor);
  return textos;
}

/** Los UUID que aparecen como valor en una respuesta (sin contar las direcciones de archivos). */
export function uuidsComoValores(valor: unknown): Set<string> {
  return new Set(textosSinUrls(valor).filter((t) => UUID_RE.test(t)));
}

/** Nombres de campo que ninguna respuesta pública puede traer (criterio 21). */
export const CAMPOS_PROHIBIDOS_EN_PUBLICO = [
  'empresaId',
  'empresa_id',
  'sucursalId',
  'sucursal_id',
  'mesaId',
  'ordenId',
  'usuarioId',
  'mozoId',
  'estacionId',
  'estacion',
  'tipoControlStock',
  'afectacionIgv',
  'aplicaIcbper',
  'agotado',
  'vendible',
  'motivo',
  'productoId',
  'diaOperativo',
  'horaCorte',
  'codigoEstablecimiento',
  'ruc',
  'emisor',
  'emisorId',
  'whatsapp',
  'costo',
  'stock',
  'destinatarios',
  'huellaIp',
  'huella_ip',
  'codigo',
  'atendidoPor',
  'cerradoPor',
] as const;

// ------------------------------------------------------------------------------------------------
// Registro de las consultas que hace la API (para contar fijaciones de contexto y consultas a la base)
// ------------------------------------------------------------------------------------------------

export interface ConsultaRegistrada {
  sql: string;
  opciones: Record<string, unknown> | undefined;
}

export interface RegistroDeConsultas {
  consultas: ConsultaRegistrada[];
  /** Cuántas consultas tienen un texto que cumple la expresión. */
  cuantas: (patron: RegExp) => number;
  limpiar: () => void;
  detener: () => void;
}

/** Espía `sequelize.query` de la API (por donde pasan todas las consultas, también las de transacción). */
export function registrarConsultas(app: INestApplication): RegistroDeConsultas {
  const sequelize = app.get<Sequelize>(CONEXION_API);
  const original = sequelize.query.bind(sequelize) as (...a: unknown[]) => unknown;
  const consultas: ConsultaRegistrada[] = [];
  const espia = vi.spyOn(sequelize, 'query').mockImplementation(((...args: unknown[]) => {
    const [sql, opciones] = args;
    const texto =
      typeof sql === 'string'
        ? sql
        : typeof (sql as { query?: unknown })?.query === 'string'
          ? (sql as { query: string }).query
          : '';
    consultas.push({
      sql: texto.trim(),
      opciones: opciones as Record<string, unknown> | undefined,
    });
    return original(...args);
  }) as never);
  return {
    consultas,
    cuantas: (patron) => consultas.filter((c) => patron.test(c.sql)).length,
    limpiar: () => {
      consultas.length = 0;
    },
    detener: () => espia.mockRestore(),
  };
}

/** Las consultas que fijan la empresa de la transacción (`fijar_contexto_empresa`). */
export const FIJA_CONTEXTO = /fijar_contexto_empresa/i;
/** Las que buscan la empresa de una dirección o de un código (criterio 13). */
export const BUSCA_EMPRESA = /empresa_de_(carta|codigo_mesa)/i;
/** Solo las consultas de datos: sin el control de transacción que genera Sequelize. */
export const ES_CONTROL_DE_TRANSACCION =
  /^(START TRANSACTION|COMMIT|ROLLBACK|SET TRANSACTION ISOLATION LEVEL [A-Z ]+);?$/i;

// ------------------------------------------------------------------------------------------------
// Varios
// ------------------------------------------------------------------------------------------------

/** Cambia mayúsculas por minúsculas y al revés (un código que difiere solo en la caja). */
export const invertirCaja = (texto: string): string =>
  texto
    .split('')
    .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
    .join('');

/** Un código de mesa bien formado (22 caracteres de base64url) que no existe. */
export const codigoInexistente = (): string => randomBytes(16).toString('base64url');

/** Un instante de la API más `ms` milisegundos, en ISO. */
export const enIso = (reloj: RelojManual, ms = 0): string =>
  new Date(reloj.ahora().getTime() + ms).toISOString();

export type { Client, INestApplication };

// ------------------------------------------------------------------------------------------------
// Fotos de las tablas y de la auditoría de 005 (para comprobar que un rechazo no cambia nada)
// ------------------------------------------------------------------------------------------------

/** Las tablas nuevas de 005. */
export const TABLAS_005 = ['carta_web', 'carta_web_sucursal', 'mesa_qr', 'llamado'] as const;

/** Acciones auditadas de la sección (tabla "Acciones auditadas en esta sección"). */
export const ACCIONES_AUDITADAS_005 = [
  'configurar_carta_web',
  'configurar_carta_web_sucursal',
  'cambiar_logo_carta_web',
  'quitar_logo_carta_web',
  'generar_qr_mesas',
  'cambiar_qr_mesa',
] as const;

/** Foto de las tablas de 005 de una empresa; una tabla que todavía no existe aparece como `'SIN_TABLA'`. */
export async function instantanea005(
  admin: Client,
  empresaId: string,
): Promise<Record<string, unknown>> {
  const foto: Record<string, unknown> = {};
  for (const tabla of TABLAS_005) {
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
  return foto;
}

export interface FilaAuditoria005 {
  id: string;
  empresa_id: string | null;
  sucursal_id: string | null;
  accion: string;
  actor_usuario_id: string | null;
  actor_superadministrador_id: string | null;
  actor_sistema: string | null;
  equipo_id: string | null;
  sesion_id: string | null;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  ocurrido_en: Date;
  [columna: string]: unknown;
}

/** Filas de auditoría de las acciones de 005 de una empresa, de la más antigua a la más nueva. */
export async function auditoria005(
  admin: Client,
  empresaId: string,
  filtro: { accion?: string } = {},
): Promise<FilaAuditoria005[]> {
  const { rows } = await admin.query<FilaAuditoria005>(
    `SELECT * FROM auditoria
      WHERE empresa_id = $1 AND accion = ANY($2::text[])
        AND ($3::text IS NULL OR accion = $3)
      ORDER BY ocurrido_en, id`,
    [empresaId, [...ACCIONES_AUDITADAS_005], filtro.accion ?? null],
  );
  return rows;
}

/** Las filas de auditoría de 005 que aparecieron después de `antes`. */
export async function auditoriaNueva005(
  admin: Client,
  empresaId: string,
  antes: FilaAuditoria005[],
): Promise<FilaAuditoria005[]> {
  const vistas = new Set(antes.map((f) => f.id));
  return (await auditoria005(admin, empresaId)).filter((f) => !vistas.has(f.id));
}

/** Los eventos publicados con ese nombre (solo con el `PublicadorEnMemoria`), con su empresa y su sala. */
export function eventosPublicados(
  ctx: Pick<AppP4, 'publicador'>,
  nombre?: string,
): { nombre: string; empresaId: string; sala: unknown; datos: unknown }[] {
  return (
    ctx.publicador.eventos() as unknown as {
      nombre: string;
      empresaId: string;
      sala: unknown;
      datos: unknown;
    }[]
  ).filter((e) => nombre === undefined || e.nombre === nombre);
}
