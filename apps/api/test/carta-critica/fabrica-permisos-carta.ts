// spec: 003-carta (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P2 (permisos y auditoría de la carta, con el Cajero) y P3 (aislamiento
// entre empresas) de la historia 003. Solo usan contratos públicos: la API real con `RelojManual`,
// `PublicadorEnMemoria` y `AlmacenEnMemoria`, las empresas dadas de alta con `POST /plataforma/empresas`, los
// usuarios creados con `POST /usuarios` y las rutas de `/carta` de la tabla de endpoints de `spec.md`. Para
// leer filas usan un cliente administrador (solo lectura). No leen la implementación de la historia.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Client } from 'pg';
import request from 'supertest';
import { expect } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { PublicadorEnMemoria } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import {
  altaEmpresa,
  bearer,
  crearUsuarioConSesion,
  elegirSucursal,
  exigirEstado,
  ingresarOk,
  INICIO_POR_DEFECTO,
  nuevoSuperadmin,
  recordarEquipo,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from '../acceso/fabrica-plataforma';
import { fijarEntornoDePrueba } from '../utilidades';

export { bearer, exigirEstado, INICIO_POR_DEFECTO };

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

export interface AppCarta extends AppDePrueba {
  publicador: PublicadorEnMemoria;
  almacen: AlmacenEnMemoria;
}

/**
 * Arranca la API real con un `RelojManual`, un `PublicadorEnMemoria` y un `AlmacenEnMemoria`, sin
 * `EMPRESA_POR_HEADER`, y la deja escuchando en un puerto propio (admite peticiones concurrentes).
 */
export async function arrancarCarta(
  opciones: { poolMax?: number; inicio?: string } = {},
): Promise<AppCarta> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 2, empresaPorHeader: false });
  const reloj = new RelojManual(opciones.inicio ?? INICIO_POR_DEFECTO);
  const publicador = new PublicadorEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: publicador,
    almacenArchivos: almacen,
  });
  await app.listen(0);
  return {
    app,
    reloj,
    publicador,
    almacen,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}

// ------------------------------------------------------------------------------------------------
// Datos únicos y archivos de muestra
// ------------------------------------------------------------------------------------------------

/** Texto único por llamada (los nombres de la carta son únicos por empresa sin distinguir mayúsculas). */
export const unico = (prefijo: string): string => `${prefijo} ${randomUUID().slice(0, 12)}`;

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozoPng(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(4);
  cabecera.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([cabecera, cuerpo, crc]);
}

/** Un PNG válido de escala de grises (por defecto 240 × 240 px, unos pocos cientos de bytes). */
export function pngValido(ancho = 240, alto = 240): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 0; // escala de grises
  const fila = Buffer.alloc(1 + ancho); // filtro 0 y píxeles negros
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozoPng('IHDR', ihdr),
    trozoPng('IDAT', deflateSync(crudo)),
    trozoPng('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------------------------------------
// Peticiones
// ------------------------------------------------------------------------------------------------

export type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Llamada {
  metodo: Metodo;
  ruta: string;
  cuerpo?: unknown;
  binario?: { tipo: string; datos: Buffer };
  cabeceras?: Record<string, string>;
}

/**
 * Las sesiones de PIN van atadas al equipo (002): cada petición lleva también `X-Equipo`. Aquí se recuerda
 * el equipo de cada token de PIN para que `llamar` lo envíe sola.
 */
const EQUIPO_DE_LA_SESION = new Map<string, string>();

/** Envía una `Llamada` con el token de sesión (y el equipo, si es una sesión de PIN). */
export function llamar(ctx: Pick<AppDePrueba, 'http'>, token: string | undefined, l: Llamada) {
  let peticion = ctx.http()[l.metodo](l.ruta);
  if (token !== undefined) peticion = peticion.set(bearer(token));
  const equipo = token === undefined ? undefined : EQUIPO_DE_LA_SESION.get(token);
  if (equipo !== undefined) peticion = peticion.set('X-Equipo', equipo);
  for (const [nombre, valor] of Object.entries(l.cabeceras ?? {})) {
    peticion = peticion.set(nombre, valor);
  }
  if (l.binario) return peticion.set('Content-Type', l.binario.tipo).send(l.binario.datos);
  if (l.cuerpo !== undefined) return peticion.send(l.cuerpo as object);
  return peticion;
}

/** Comprueba estado y código de error (`{ codigo, mensaje, campos? }`) sin detalles de PostgreSQL. */
export function esperarError(
  res: { status: number; body: unknown; text: string },
  estado: number,
  codigo: string,
): void {
  expect(res.status, `${res.status} ${res.text}`).toBe(estado);
  expect(res.body).toMatchObject({ codigo });
  expect(typeof (res.body as { mensaje: unknown }).mensaje).toBe('string');
  expect(res.text).not.toMatch(
    /SQLSTATE|violates|duplicate key|syntax error|relation "|pg_catalog|restaurante_(api|plataforma|migrador)|at Object\./i,
  );
}

// ------------------------------------------------------------------------------------------------
// Escenario: empresas, usuarios y sesiones
// ------------------------------------------------------------------------------------------------

export type RolCarta = 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR';
export type RolOAdmin = RolCarta | 'ADMINISTRADOR';
export type Acceso = { sucursalId: string; rol: RolCarta };

export type PersonaCarta = UsuarioDePrueba;

export interface EmpresaCarta {
  base: EmpresaDePrueba;
  empresaId: string;
  /** Sucursales de la empresa en el orden del alta: S1, S2 y (en A) S3. */
  S1: string;
  S2: string;
  S3: string | null;
  /** Token de sesión de contraseña del Administrador (sin sucursal activa). */
  tokenAdmin: string;
  mozo: PersonaCarta;
  cocina: PersonaCarta;
  supervisor: PersonaCarta;
  /** Cajero en S1 y Mozo en S2 (el "Cajero" de los criterios). */
  cajero: PersonaCarta;
}

export interface EscenarioCarta {
  ctx: AppCarta;
  sa: SuperadminDePrueba;
  A: EmpresaCarta;
  B: EmpresaCarta;
}

/** Crea una persona con acceso a las sucursales indicadas y la deja con la cuenta activa. */
export function crearPersona(
  ctx: AppCarta,
  tokenAdmin: string,
  accesos: Acceso[],
  extra: { esAdministrador?: boolean } = {},
): Promise<PersonaCarta> {
  return crearUsuarioConSesion(ctx, tokenAdmin, { accesos, ...extra });
}

async function prepararEmpresa(
  ctx: AppCarta,
  sa: SuperadminDePrueba,
  sucursales: number,
): Promise<EmpresaCarta> {
  const base = await altaEmpresa(ctx, sa, { sucursalesPorEmisor: sucursales });
  const [S1, S2, S3] = base.sucursales.map((s) => s.id) as [string, string, string | undefined];
  const t = base.admin.token;
  return {
    base,
    empresaId: base.empresaId,
    S1,
    S2,
    S3: S3 ?? null,
    tokenAdmin: t,
    mozo: await crearPersona(ctx, t, [{ sucursalId: S1, rol: 'MOZO' }]),
    cocina: await crearPersona(ctx, t, [{ sucursalId: S1, rol: 'COCINA_BARRA' }]),
    supervisor: await crearPersona(ctx, t, [{ sucursalId: S1, rol: 'SUPERVISOR' }]),
    cajero: await crearPersona(ctx, t, [
      { sucursalId: S1, rol: 'CAJERO' },
      { sucursalId: S2, rol: 'MOZO' },
    ]),
  };
}

/** El superadministrador y las empresas A (tres sucursales) y B (dos), cada una con sus usuarios. */
export async function crearEscenarioCarta(ctx: AppCarta): Promise<EscenarioCarta> {
  const sa = await nuevoSuperadmin(ctx);
  const A = await prepararEmpresa(ctx, sa, 3);
  const B = await prepararEmpresa(ctx, sa, 2);
  return { ctx, sa, A, B };
}

/**
 * Abre una sesión de contraseña de la persona y, si se pide, elige esa sucursal activa. Con `sucursalId`
 * `null` no elige ninguna (una persona con varias sucursales entra sin sucursal activa).
 */
export async function sesionContrasena(
  ctx: AppCarta,
  persona: Pick<PersonaCarta, 'usuario' | 'contrasena'>,
  sucursalId: string | null,
): Promise<string> {
  const { token, sesion } = await ingresarOk(ctx, persona.usuario, persona.contrasena);
  const activa = (sesion as { sucursal?: { id: string } | null }).sucursal?.id ?? null;
  if (sucursalId !== null && activa !== sucursalId) await elegirSucursal(ctx, token, sucursalId);
  return token;
}

/** Registra un equipo recordado nuevo para la persona y devuelve su token de equipo. */
export async function equipoDe(
  ctx: AppCarta,
  persona: Pick<PersonaCarta, 'usuario' | 'contrasena'>,
): Promise<string> {
  const { token } = await ingresarOk(ctx, persona.usuario, persona.contrasena);
  const { tokenEquipo } = await recordarEquipo(ctx, token, { nombre: unico('Equipo') });
  if (!tokenEquipo) throw new Error('El equipo recordado no devolvió su token');
  return tokenEquipo;
}

/** Abre una sesión de PIN en el equipo y, si se pide, elige esa sucursal activa. */
export async function sesionPin(
  ctx: AppCarta,
  persona: Pick<PersonaCarta, 'id' | 'pin'>,
  tokenEquipo: string,
  sucursalId: string | null,
): Promise<string> {
  const res = await ctx
    .http()
    .post('/sesiones/pin')
    .set('X-Equipo', tokenEquipo)
    .send({ usuarioId: persona.id, pin: persona.pin });
  exigirEstado(res, 201, `ingreso con PIN de ${persona.id}`);
  const token = res.body.token as string;
  EQUIPO_DE_LA_SESION.set(token, tokenEquipo);
  const activa = (res.body.sesion as { sucursal?: { id: string } | null }).sucursal?.id ?? null;
  if (sucursalId !== null && activa !== sucursalId) {
    const elegir = await llamar(ctx, token, {
      metodo: 'put',
      ruta: '/sesion/sucursal',
      cuerpo: { sucursalId },
    });
    exigirEstado(elegir, 200, 'elegir sucursal con una sesión de PIN');
  }
  return token;
}

/** Una sesión de cada clase (contraseña y PIN) con la sucursal activa pedida. */
export interface SesionesDe {
  contrasena: string;
  pin: string;
}

export async function sesionesDe(
  ctx: AppCarta,
  persona: PersonaCarta,
  sucursalId: string | null,
): Promise<SesionesDe> {
  const equipo = await equipoDe(ctx, persona);
  return {
    contrasena: await sesionContrasena(ctx, persona, sucursalId),
    pin: await sesionPin(ctx, persona, equipo, sucursalId),
  };
}

// ------------------------------------------------------------------------------------------------
// Datos de la carta de una empresa, sembrados por la API como el Administrador
// ------------------------------------------------------------------------------------------------

export interface DatosCarta {
  estacionId: string;
  familiaId: string;
  /** Simple, `"25.00"`, en la estación, que se vende solo. */
  productoId: string;
  /** Simple que no se vende solo (producto ligado). */
  ligadoId: string;
  /** Combo `"22.90"` con el simple como componente y el grupo de opciones. */
  comboId: string;
  /** Menú del día `"12.00"` con el grupo del menú. */
  menuId: string;
  grupoId: string;
  /** Modificadores del grupo `grupoId` (el primero, ligado a `ligadoId`). */
  modificadorIds: string[];
  grupoMenuId: string;
  /** Modificadores del grupo del menú. */
  opcionesMenuIds: string[];
}

/** Siembra una carta mínima en la empresa con el token del Administrador (exige 201 en cada alta). */
export async function sembrarCarta(ctx: AppCarta, token: string): Promise<DatosCarta> {
  const crear = async (ruta: string, cuerpo: unknown) => {
    const res = await llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
    exigirEstado(res, 201, `POST ${ruta}`);
    return res.body as { id: string; modificadores?: { id: string }[] };
  };
  const estacion = await crear('/carta/estaciones', { nombre: unico('Cocina') });
  const familia = await crear('/carta/familias', { nombre: unico('Fondos') });
  const producto = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: unico('Lomo saltado'),
    familiaId: familia.id,
    precio: '25.00',
    estacionId: estacion.id,
    tipoControlStock: 'UNIDADES',
  });
  const ligado = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: unico('Ají de gallina'),
    familiaId: familia.id,
    seVendeSolo: false,
    estacionId: estacion.id,
    tipoControlStock: 'PORCIONES',
  });
  const grupo = await crear('/carta/grupos-modificadores', {
    nombre: unico('Bebida'),
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Chicha', precioExtra: '2.50', productoId: ligado.id },
      { nombre: 'Inca Kola', precioExtra: '0.00' },
    ],
  });
  const combo = await crear('/carta/productos', {
    tipo: 'COMBO',
    nombre: unico('Combo hamburguesa'),
    familiaId: familia.id,
    precio: '22.90',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: producto.id, cantidad: 1 }],
    gruposModificadores: [grupo.id],
  });
  const grupoMenu = await crear('/carta/grupos-modificadores', {
    nombre: unico('Entrada'),
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Sopa', precioExtra: '0.00', productoId: ligado.id },
      { nombre: 'Papa a la huancaína', precioExtra: '1.50' },
    ],
  });
  const menu = await crear('/carta/productos', {
    tipo: 'MENU_DEL_DIA',
    nombre: unico('Menú del día'),
    familiaId: familia.id,
    precio: '12.00',
    tipoControlStock: 'PORCIONES',
    gruposModificadores: [grupoMenu.id],
  });
  return {
    estacionId: estacion.id,
    familiaId: familia.id,
    productoId: producto.id,
    ligadoId: ligado.id,
    comboId: combo.id,
    menuId: menu.id,
    grupoId: grupo.id,
    modificadorIds: (grupo.modificadores ?? []).map((m) => m.id),
    grupoMenuId: grupoMenu.id,
    opcionesMenuIds: (grupoMenu.modificadores ?? []).map((m) => m.id),
  };
}

// ------------------------------------------------------------------------------------------------
// Las 25 rutas de `/carta` (tabla de endpoints de `spec.md`) y su clase de permiso (criterio 60)
// ------------------------------------------------------------------------------------------------

export type ClaseDePermiso =
  'EDITAR_CARTA' | 'ADMINISTRAR' | 'GESTIONAR_DISPONIBILIDAD' | 'NINGUNA';

/** Ids que usan las rutas con parámetros; pueden ser reales o aleatorios. */
export interface IdsDeRuta {
  estacionId: string;
  familiaId: string;
  productoId: string;
  /** Menú del día de las rutas `/carta/sucursal/menu-del-dia/:productoId`. */
  menuId: string;
  grupoId: string;
  /** Opción (modificador) de un grupo del menú. */
  modificadorId: string;
  /** Sucursal del `PUT /carta/productos/:id/sucursales/:sucursalId`. */
  sucursalId: string;
}

export interface RutaCarta {
  /** `MÉTODO /ruta` con los parámetros como los registra Nest. */
  clave: string;
  clase: ClaseDePermiso;
  construir: (ids: IdsDeRuta) => Llamada;
}

/** Cuerpo válido de un `POST /carta/productos` simple. */
export function productoSimpleNuevo(
  ids: Pick<IdsDeRuta, 'familiaId' | 'estacionId'>,
  extra: Record<string, unknown> = {},
) {
  return {
    tipo: 'SIMPLE',
    nombre: unico('Producto de prueba'),
    familiaId: ids.familiaId,
    precio: '10.00',
    estacionId: ids.estacionId,
    tipoControlStock: 'UNIDADES',
    ...extra,
  };
}

export const RUTAS_CARTA: RutaCarta[] = [
  {
    clave: 'GET /carta/estaciones',
    clase: 'EDITAR_CARTA',
    construir: () => ({ metodo: 'get', ruta: '/carta/estaciones' }),
  },
  {
    clave: 'POST /carta/estaciones',
    clase: 'ADMINISTRAR',
    construir: () => ({
      metodo: 'post',
      ruta: '/carta/estaciones',
      cuerpo: { nombre: unico('Estación') },
    }),
  },
  {
    clave: 'PATCH /carta/estaciones/:id',
    clase: 'ADMINISTRAR',
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/carta/estaciones/${ids.estacionId}`,
      cuerpo: { nombre: unico('Estación') },
    }),
  },
  {
    clave: 'GET /carta/familias',
    clase: 'EDITAR_CARTA',
    construir: () => ({ metodo: 'get', ruta: '/carta/familias' }),
  },
  {
    clave: 'POST /carta/familias',
    clase: 'EDITAR_CARTA',
    construir: () => ({
      metodo: 'post',
      ruta: '/carta/familias',
      cuerpo: { nombre: unico('Familia') },
    }),
  },
  {
    clave: 'PATCH /carta/familias/:id',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/carta/familias/${ids.familiaId}`,
      cuerpo: { nombre: unico('Familia') },
    }),
  },
  {
    clave: 'PUT /carta/familias/orden',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'put',
      ruta: '/carta/familias/orden',
      cuerpo: { ids: [ids.familiaId] },
    }),
  },
  {
    clave: 'PUT /carta/familias/:id/productos/orden',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta/familias/${ids.familiaId}/productos/orden`,
      cuerpo: { ids: [ids.productoId] },
    }),
  },
  {
    clave: 'GET /carta/productos',
    clase: 'EDITAR_CARTA',
    construir: () => ({ metodo: 'get', ruta: '/carta/productos' }),
  },
  {
    clave: 'GET /carta/productos/:id',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({ metodo: 'get', ruta: `/carta/productos/${ids.productoId}` }),
  },
  {
    clave: 'POST /carta/productos',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'post',
      ruta: '/carta/productos',
      cuerpo: productoSimpleNuevo(ids),
    }),
  },
  {
    clave: 'PATCH /carta/productos/:id',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/carta/productos/${ids.productoId}`,
      cuerpo: { precio: '26.00' },
    }),
  },
  {
    clave: 'PUT /carta/productos/:id/foto',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta/productos/${ids.productoId}/foto`,
      binario: { tipo: 'image/png', datos: pngValido() },
    }),
  },
  {
    clave: 'DELETE /carta/productos/:id/foto',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({ metodo: 'delete', ruta: `/carta/productos/${ids.productoId}/foto` }),
  },
  {
    clave: 'GET /carta/productos/:id/sucursales',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({ metodo: 'get', ruta: `/carta/productos/${ids.productoId}/sucursales` }),
  },
  {
    clave: 'PUT /carta/productos/:id/sucursales/:sucursalId',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta/productos/${ids.productoId}/sucursales/${ids.sucursalId}`,
      cuerpo: { precio: '27.50', disponible: false },
    }),
  },
  {
    clave: 'GET /carta/grupos-modificadores',
    clase: 'EDITAR_CARTA',
    construir: () => ({ metodo: 'get', ruta: '/carta/grupos-modificadores' }),
  },
  {
    clave: 'GET /carta/grupos-modificadores/:id',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({ metodo: 'get', ruta: `/carta/grupos-modificadores/${ids.grupoId}` }),
  },
  {
    clave: 'POST /carta/grupos-modificadores',
    clase: 'EDITAR_CARTA',
    construir: () => ({
      metodo: 'post',
      ruta: '/carta/grupos-modificadores',
      cuerpo: {
        nombre: unico('Término'),
        seleccion: 'UNICA',
        obligatorio: true,
        modificadores: [{ nombre: 'Jugoso' }, { nombre: '3/4' }],
      },
    }),
  },
  {
    clave: 'PATCH /carta/grupos-modificadores/:id',
    clase: 'EDITAR_CARTA',
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/carta/grupos-modificadores/${ids.grupoId}`,
      cuerpo: { nombre: unico('Término') },
    }),
  },
  {
    clave: 'GET /carta/sucursal',
    clase: 'NINGUNA',
    construir: () => ({ metodo: 'get', ruta: '/carta/sucursal' }),
  },
  {
    clave: 'GET /carta/sucursal/menu-del-dia',
    clase: 'GESTIONAR_DISPONIBILIDAD',
    construir: () => ({ metodo: 'get', ruta: '/carta/sucursal/menu-del-dia' }),
  },
  {
    clave: 'PUT /carta/sucursal/menu-del-dia/:productoId',
    clase: 'GESTIONAR_DISPONIBILIDAD',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta/sucursal/menu-del-dia/${ids.menuId}`,
      cuerpo: { opciones: [ids.modificadorId] },
    }),
  },
  {
    clave: 'PUT /carta/sucursal/agotados/:productoId',
    clase: 'GESTIONAR_DISPONIBILIDAD',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/carta/sucursal/agotados/${ids.productoId}`,
      cuerpo: { hasta: 'FIN_DEL_DIA' },
    }),
  },
  {
    clave: 'DELETE /carta/sucursal/agotados/:productoId',
    clase: 'GESTIONAR_DISPONIBILIDAD',
    construir: (ids) => ({
      metodo: 'delete',
      ruta: `/carta/sucursal/agotados/${ids.productoId}`,
    }),
  },
];

export const rutasDeClase = (clase: ClaseDePermiso): RutaCarta[] =>
  RUTAS_CARTA.filter((r) => r.clase === clase);

/** Ids reales de la carta sembrada, para las rutas con parámetros. */
export function idsDe(datos: DatosCarta, sucursalId: string): IdsDeRuta {
  return {
    estacionId: datos.estacionId,
    familiaId: datos.familiaId,
    productoId: datos.productoId,
    menuId: datos.menuId,
    grupoId: datos.grupoId,
    modificadorId: datos.opcionesMenuIds[0]!,
    sucursalId,
  };
}

/** Ids con formato de UUID que no existen en ninguna empresa. */
export function idsAleatorios(sucursalId: string = randomUUID()): IdsDeRuta {
  return {
    estacionId: randomUUID(),
    familiaId: randomUUID(),
    productoId: randomUUID(),
    menuId: randomUUID(),
    grupoId: randomUUID(),
    modificadorId: randomUUID(),
    sucursalId,
  };
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

/** Las diez tablas nuevas de la carta, con su orden de lectura. */
export const TABLAS_CARTA = [
  'estacion',
  'familia',
  'producto',
  'producto_sucursal',
  'producto_agotado',
  'grupo_modificadores',
  'modificador',
  'producto_grupo',
  'componente_combo',
  'menu_del_dia_opcion',
] as const;
export type TablaCarta = (typeof TABLAS_CARTA)[number];

/** Acciones auditadas de la sección (tabla "Acciones auditadas en esta sección"). */
export const ACCIONES_CARTA = [
  'crear_estacion',
  'modificar_estacion',
  'crear_familia',
  'modificar_familia',
  'ordenar_familias',
  'crear_producto',
  'modificar_producto',
  'ordenar_productos',
  'cambiar_foto_producto',
  'quitar_foto_producto',
  'ajustar_producto_sucursal',
  'crear_grupo_modificadores',
  'modificar_grupo_modificadores',
  'armar_menu_del_dia',
  'marcar_agotado',
  'reactivar_agotado',
];

export interface FilaDeAuditoria {
  id: string;
  empresa_id: string | null;
  sucursal_id: string | null;
  accion: string;
  actor_usuario_id: string | null;
  actor_superadministrador_id: string | null;
  actor_sistema: string | null;
  sesion_id: string | null;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  [columna: string]: unknown;
}

/** Filas de auditoría de la carta de una empresa, de la más antigua a la más nueva. */
export async function auditoriaCarta(
  admin: Client,
  empresaId: string,
  filtro: { accion?: string; entidadId?: string } = {},
): Promise<FilaDeAuditoria[]> {
  const { rows } = await admin.query<FilaDeAuditoria>(
    `SELECT * FROM auditoria
      WHERE empresa_id = $1 AND accion = ANY($2::text[])
        AND ($3::text IS NULL OR accion = $3)
        AND ($4::uuid IS NULL OR entidad_id = $4)
      ORDER BY ocurrido_en, id`,
    [empresaId, ACCIONES_CARTA, filtro.accion ?? null, filtro.entidadId ?? null],
  );
  return rows;
}

/**
 * Foto de las tablas de la carta de una empresa. Una tabla que todavía no existe aparece como
 * `'SIN_TABLA'` (así la prueba compara antes y después y falla en lo que importa, no en la foto).
 */
export async function instantaneaCarta(
  admin: Client,
  empresaId: string,
): Promise<Record<string, unknown>> {
  const foto: Record<string, unknown> = {};
  for (const tabla of TABLAS_CARTA) {
    const existe = await admin.query<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [
      `public.${tabla}`,
    ]);
    if (existe.rows[0]!.t === null) {
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

/** Cantidad de filas de una tabla de la carta en la empresa (exige que la tabla exista). */
export async function contarFilas(
  admin: Client,
  tabla: TablaCarta,
  empresaId: string,
): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${tabla} WHERE empresa_id = $1`,
    [empresaId],
  );
  return rows[0]!.n;
}

/** Una fila de `producto_sucursal` (o `undefined`) vista por el administrador. */
export async function filaProductoSucursal(
  admin: Client,
  productoId: string,
  sucursalId: string,
): Promise<Record<string, unknown> | undefined> {
  const { rows } = await admin.query(
    `SELECT to_jsonb(t) AS fila FROM producto_sucursal t WHERE producto_id = $1 AND sucursal_id = $2`,
    [productoId, sucursalId],
  );
  return rows[0]?.fila;
}

/** Todos los UUID que aparecen en un texto (en minúsculas, sin repetir). */
export function uuidsEn(texto: string): string[] {
  return [
    ...new Set(
      (texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map(
        (u) => u.toLowerCase(),
      ),
    ),
  ];
}

/** Todos los ids (uuid) de las tablas de la carta de una empresa, más sus sucursales. */
export async function idsDeLaEmpresa(admin: Client, empresaId: string): Promise<Set<string>> {
  const ids = new Set<string>([empresaId]);
  for (const tabla of TABLAS_CARTA) {
    const { rows } = await admin.query<{ id: string }>(
      `SELECT id FROM ${tabla} WHERE empresa_id = $1`,
      [empresaId],
    );
    for (const r of rows) ids.add(r.id.toLowerCase());
  }
  const sucursales = await admin.query<{ id: string }>(
    `SELECT id FROM sucursal WHERE empresa_id = $1`,
    [empresaId],
  );
  for (const r of sucursales.rows) ids.add(r.id.toLowerCase());
  return ids;
}

// ------------------------------------------------------------------------------------------------
// Escribir y ver qué auditoría dejó
// ------------------------------------------------------------------------------------------------

export interface ResultadoAuditado {
  res: request.Response;
  /** Filas de auditoría de la carta que aparecieron con esta petición. */
  nuevas: FilaDeAuditoria[];
}

/** Envía la petición y devuelve la respuesta con las filas de auditoría de la carta que dejó. */
export async function ejecutarYAuditar(
  ctx: AppCarta,
  admin: Client,
  empresaId: string,
  token: string,
  llamada: Llamada,
): Promise<ResultadoAuditado> {
  const antes = new Set((await auditoriaCarta(admin, empresaId)).map((f) => f.id));
  const res = await llamar(ctx, token, llamada);
  const nuevas = (await auditoriaCarta(admin, empresaId)).filter((f) => !antes.has(f.id));
  return { res, nuevas };
}

/** Comprueba que apareció exactamente una fila, de esa acción y de ese autor, y la devuelve. */
export function unaFila(
  nuevas: FilaDeAuditoria[],
  esperado: {
    accion: string;
    actorUsuarioId?: string;
    actorSuperadministradorId?: string;
    entidad?: string;
    entidadId?: string;
    sucursalId?: string | null;
  },
): FilaDeAuditoria {
  expect(
    nuevas.map((f) => f.accion),
    'filas de auditoría nuevas',
  ).toEqual([esperado.accion]);
  const fila = nuevas[0]!;
  if (esperado.actorUsuarioId !== undefined) {
    expect(fila.actor_usuario_id).toBe(esperado.actorUsuarioId);
    expect(fila.actor_superadministrador_id).toBeNull();
  }
  if (esperado.actorSuperadministradorId !== undefined) {
    expect(fila.actor_superadministrador_id).toBe(esperado.actorSuperadministradorId);
    expect(fila.actor_usuario_id).toBeNull();
  }
  if (esperado.entidad !== undefined) expect(fila.entidad).toBe(esperado.entidad);
  if (esperado.entidadId !== undefined) expect(fila.entidad_id).toBe(esperado.entidadId);
  if (esperado.sucursalId !== undefined) expect(fila.sucursal_id).toBe(esperado.sucursalId);
  return fila;
}

/** Falla con la lista completa de problemas (legible en el resumen de la prueba) si hay alguno. */
export function exigirSinFallos(fallos: string[]): void {
  if (fallos.length > 0) {
    throw new Error(`${fallos.length} problema(s):\n${fallos.join('\n')}`);
  }
}

/**
 * Deja pasar un momento: los efectos de después de confirmar (borrar un archivo, publicar un evento) pueden
 * correr un instante después de la respuesta.
 */
export const asentar = (ms = 80): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));
