// spec: 006-caja-cobro (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P2 a P6 de la historia 006, entrega 6a (caja, cobro y comprobantes). Solo usan
// contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` (anota los eventos y los entrega también
// a Socket.IO), `InventarioDePrueba`, el simulador del puente y el emulador de impresora de 3b donde se mira el papel
// o la gaveta; las empresas dadas de alta con `POST /plataforma/empresas`, los usuarios con `POST /usuarios`, la carta
// de ejemplo de 004 (más la Bolsa plástica de `"0.10"` y la Mandarina exonerada) por las rutas de `/carta` de 003, el
// salón y las órdenes por las rutas de 004, y las cajas, las series y las tasas por las rutas de la tabla de
// endpoints de 6a. Para leer filas usan un cliente administrador (solo lectura); toda escritura por SQL fija antes un
// actor. No leen la implementación de la historia.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type request from 'supertest';
import {
  altaEmpresa,
  nuevoSuperadmin,
  crearUsuarioConSesion,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from '../acceso/fabrica-plataforma';
import {
  esperarError,
  exigirEstado,
  llamar,
  sesionContrasena,
  sesionPin,
  equipoDe,
} from '../carta-critica/fabrica-permisos-carta';
import {
  arrancarP5,
  Cierres,
  crearImpresora,
  esperarHasta,
  vincularPuente,
  type AppP5,
  type ImpresoraDePrueba,
} from '../impresion-critica/fabrica-p5';
import { crearZona } from '../salon-critica/fabrica-p0p1';
import { abrirCliente } from '../utilidades';

export { Cierres, esperarError, esperarHasta, exigirEstado, vincularPuente };
export type { AppP5, ImpresoraDePrueba };
export type Res = request.Response;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Libre = Record<string, any>;

/** Lunes 2 de noviembre de 2026, 10:00 en Lima: el instante inicial del reloj de la API. */
export const INICIO = '2026-11-02T10:00:00-05:00';
export const MINUTO = 60_000;

// ------------------------------------------------------------------------------------------------
// HTTP
// ------------------------------------------------------------------------------------------------

export const ik = (clave: string = randomUUID()) => ({ 'Idempotency-Key': clave });

/** Una petición con el token (y su equipo, si es una sesión de PIN). */
export function api(
  ctx: AppP5,
  token: string | undefined,
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
  ruta: string,
  cuerpo?: unknown,
  cabeceras?: Record<string, string>,
): Promise<Res> {
  return llamar(ctx, token, {
    metodo,
    ruta,
    ...(cuerpo !== undefined ? { cuerpo } : {}),
    ...(cabeceras ? { cabeceras } : {}),
  }) as unknown as Promise<Res>;
}

/** Una escritura con una clave de idempotencia nueva (o la dada). */
export const escribir = (
  ctx: AppP5,
  token: string | undefined,
  metodo: 'post' | 'put' | 'patch',
  ruta: string,
  cuerpo?: unknown,
  extra: Record<string, string> = {},
): Promise<Res> => api(ctx, token, metodo, ruta, cuerpo, { ...ik(), ...extra });

export function exigir(res: Res, estado: number, que: string): Res {
  exigirEstado(res, estado, que);
  return res;
}

export const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

/** La API real con Socket.IO, el publicador en memoria y el reloj manual. Pool de 5 conexiones salvo que se pida otro. */
export function arrancarCaja(opciones: { poolMax?: number } = {}): Promise<AppP5> {
  return arrancarP5({ poolMax: opciones.poolMax ?? 5 });
}

let adminPendiente: Promise<Client> | undefined;
/** Un cliente administrador de PostgreSQL (solo lectura) compartido por el archivo. */
export function admin(): Promise<Client> {
  adminPendiente ??= abrirCliente('admin');
  return adminPendiente;
}
export async function cerrarAdmin(): Promise<void> {
  if (adminPendiente) await (await adminPendiente).end();
  adminPendiente = undefined;
}

/** Filas de una consulta como administrador. */
export async function filas<T extends Libre = Libre>(sql: string, p: unknown[] = []): Promise<T[]> {
  return (await (await admin()).query(sql, p)).rows as T[];
}

export async function contar(sql: string, p: unknown[] = []): Promise<number> {
  const r = await filas<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) q`, p);
  return Number(r[0]?.n ?? 0);
}

/** `orden.version` (la versión que ve la cuenta, criterio 44). */
export async function versionDe(ordenId: string): Promise<number> {
  return Number((await filas('SELECT version FROM orden WHERE id = $1', [ordenId]))[0]?.version);
}

// ------------------------------------------------------------------------------------------------
// Las empresas: A (E1 general en S1 y S3, E2 Nuevo RUS en S2, E3 general sin tasa en S4) y B
// ------------------------------------------------------------------------------------------------

export interface CartaCaja {
  estacionCocinaId: string;
  estacionBarraId: string;
  lomo: { id: string; tresCuartos: string };
  gaseosa: string;
  bolsa: string;
  mandarina: string;
  /** Simple gravado de `"5.34"` (con el Lomo suma `"33.34"`, el ejemplo del redondeo). */
  tostada: string;
  /** Simple gravado de `"12.00"` en la estación Barra. */
  pisco: string;
  /** Simple gravado de `"0.01"` (para llegar a un céntimo sobre `"700.00"`). */
  dulce: string;
}

export interface LineaPlana {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
}

export type Sucursal = 'S1' | 'S2' | 'S3' | 'S4';
type PersonaCaja = UsuarioDePrueba;

export interface CajasDe {
  caja1: string;
  caja2: string;
  /** Una caja con solo la serie de boletas. */
  caja3: string;
}

export interface EmpresaCaja {
  base: EmpresaDePrueba;
  id: string;
  S1: string;
  S2: string;
  S3: string;
  S4: string | null;
  emisor1: string;
  emisor2: string | null;
  emisor3: string | null;
  personas: Record<string, PersonaCaja>;
  /** Sesiones de contraseña con su sucursal activa. */
  token: Record<string, string>;
  carta: CartaCaja;
  /** Cajas y series configuradas (se arma al primer uso). */
  cajas(): Promise<Record<'S1' | 'S2' | 'S3' | 'S4', CajasDe | null>>;
  /** Quién opera el salón (mozo o supervisor) en cada sucursal. */
  operador(s: Sucursal): string;
  mesaNueva(s: Sucursal): Promise<string>;
  sucursalId(s: Sucursal): string;
  /**
   * Abre de nuevo la sesión de contraseña de cada persona (y del Administrador) y actualiza `token` en su sitio. Se
   * usa después de mover el reloj de la API con `fijar`, porque las sesiones anteriores ya expiraron. Las mesas
   * nuevas se crean desde entonces con la sesión nueva del Administrador.
   */
  refrescarSesiones(): Promise<void>;
}

export interface Escenario {
  ctx: AppP5;
  sa: SuperadminDePrueba;
  A: EmpresaCaja;
  B: EmpresaCaja;
}

async function crearEnCarta(
  ctx: AppP5,
  token: string,
  ruta: string,
  cuerpo: unknown,
): Promise<Libre> {
  const res = await api(ctx, token, 'post', ruta, cuerpo);
  exigirEstado(res, 201, `POST ${ruta} (carta de 003)`);
  return res.body as Libre;
}

/** La carta de ejemplo de 004 que usa 006 y los dos productos que 006 suma (criterio "Datos de ejemplo"). */
export async function sembrarCartaCaja(ctx: AppP5, tokenAdmin: string): Promise<CartaCaja> {
  const cocina = await crearEnCarta(ctx, tokenAdmin, '/carta/estaciones', { nombre: 'Cocina' });
  const barra = await crearEnCarta(ctx, tokenAdmin, '/carta/estaciones', { nombre: 'Barra' });
  const familia = await crearEnCarta(ctx, tokenAdmin, '/carta/familias', { nombre: 'Platos' });
  const producto = (c: Record<string, unknown>) =>
    crearEnCarta(ctx, tokenAdmin, '/carta/productos', {
      familiaId: familia.id,
      tipo: 'SIMPLE',
      ...c,
    });
  const termino = await crearEnCarta(ctx, tokenAdmin, '/carta/grupos-modificadores', {
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Jugoso', precioExtra: '0.00', productoId: null },
      { nombre: '3/4', precioExtra: '0.00', productoId: null },
    ],
  });
  const lomo = await producto({
    nombre: 'Lomo saltado',
    precio: '28.00',
    estacionId: cocina.id,
    tipoControlStock: 'SIN_CONTROL',
    gruposModificadores: [termino.id],
  });
  const gaseosa = await producto({
    nombre: 'Gaseosa 1 L',
    precio: '9.00',
    estacionId: null,
    tipoControlStock: 'UNIDADES',
  });
  const bolsa = await producto({
    nombre: 'Bolsa plástica',
    precio: '0.10',
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
    aplicaIcbper: true,
  });
  const mandarina = await producto({
    nombre: 'Mandarina',
    precio: '3.00',
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
    afectacionIgv: 'EXONERADO',
  });
  const tostada = await producto({
    nombre: 'Tostada',
    precio: '5.34',
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
  });
  const pisco = await producto({
    nombre: 'Pisco sour',
    precio: '12.00',
    estacionId: barra.id,
    tipoControlStock: 'SIN_CONTROL',
  });
  const dulce = await producto({
    nombre: 'Dulce',
    precio: '0.01',
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
  });
  const tres = (termino.modificadores as Libre[]).find((m) => m.nombre === '3/4')!;
  return {
    estacionCocinaId: cocina.id,
    estacionBarraId: barra.id,
    lomo: { id: lomo.id, tresCuartos: tres.id },
    gaseosa: gaseosa.id,
    bolsa: bolsa.id,
    mandarina: mandarina.id,
    tostada: tostada.id,
    pisco: pisco.id,
    dulce: dulce.id,
  };
}

type Accesos = { sucursalId: string; rol: 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR' }[];

async function prepararEmpresa(
  ctx: AppP5,
  sa: SuperadminDePrueba,
  esA: boolean,
): Promise<EmpresaCaja> {
  const base = await altaEmpresa(
    ctx,
    sa,
    esA
      ? {
          emisores: 3,
          sucursalesPorEmisor: 2,
          ajustar: (cuerpo) => {
            const c = cuerpo as unknown as { emisores: Libre[]; sucursales: Libre[] };
            c.emisores[1]!.regimen = 'NUEVO_RUS';
            // S1 y S3 de E1, S2 de E2 (Nuevo RUS) y S4 de E3 (sin tasa).
            c.sucursales = [c.sucursales[0]!, c.sucursales[2]!, c.sucursales[1]!, c.sucursales[4]!];
          },
        }
      : { sucursalesPorEmisor: 2 },
  );
  const [S1, S2, S3, S4] = base.sucursales.map((s) => s.id) as [string, string, string?, string?];
  const t = base.admin.token;
  const alta = async (clave: string, accesos: Accesos) => ({
    clave,
    persona: await crearUsuarioConSesion(ctx, t, { accesos }),
  });
  const altas = esA
    ? [
        await alta('cajero', [
          { sucursalId: S1, rol: 'CAJERO' },
          { sucursalId: S2, rol: 'MOZO' },
        ]),
        await alta('cajero2', [{ sucursalId: S1, rol: 'CAJERO' }]),
        await alta('supervisor', [{ sucursalId: S1, rol: 'SUPERVISOR' }]),
        await alta('mozo', [{ sucursalId: S1, rol: 'MOZO' }]),
        await alta('mozoMulti', [
          { sucursalId: S1, rol: 'MOZO' },
          { sucursalId: S2, rol: 'MOZO' },
        ]),
        await alta('cocina', [{ sucursalId: S1, rol: 'COCINA_BARRA' }]),
        await alta('supervisorS2', [{ sucursalId: S2, rol: 'SUPERVISOR' }]),
        await alta('supervisorS3', [{ sucursalId: S3!, rol: 'SUPERVISOR' }]),
        await alta('cajeroS3', [{ sucursalId: S3!, rol: 'CAJERO' }]),
        await alta('supervisorS4', [{ sucursalId: S4!, rol: 'SUPERVISOR' }]),
      ]
    : [
        await alta('cajero', [{ sucursalId: S1, rol: 'CAJERO' }]),
        await alta('supervisor', [{ sucursalId: S1, rol: 'SUPERVISOR' }]),
        await alta('mozo', [{ sucursalId: S1, rol: 'MOZO' }]),
      ];
  const personas: Record<string, PersonaCaja> = {};
  const token: Record<string, string> = { admin: t };
  const sucursalDe: Record<string, string> = {
    supervisorS2: S2,
    supervisorS3: S3!,
    cajeroS3: S3!,
    supervisorS4: S4!,
  };
  for (const { clave, persona } of altas) {
    personas[clave] = persona;
    token[clave] = await sesionContrasena(ctx, persona, sucursalDe[clave] ?? S1);
  }
  const carta = await sembrarCartaCaja(ctx, t);
  // Quién opera el salón en cada sucursal; se lee de `token` en cada uso para ver las sesiones refrescadas.
  const operadores: Record<Sucursal, () => string> = {
    S1: () => token.mozo!,
    S2: () => token.supervisorS2 ?? token.mozo!,
    S3: () => token.supervisorS3 ?? token.mozo!,
    S4: () => token.supervisorS4 ?? token.mozo!,
  };
  const id = (s: Sucursal): string => ({ S1, S2, S3: S3 ?? S1, S4: S4 ?? S1 })[s];
  const zonas = new Map<Sucursal, Promise<string>>();
  const mesasCreadas = new Map<Sucursal, number>();
  const e: EmpresaCaja = {
    base,
    id: base.empresaId,
    S1,
    S2,
    S3: S3 ?? S1,
    S4: S4 ?? null,
    emisor1: base.emisores[0]!.id,
    emisor2: esA ? base.emisores[1]!.id : null,
    emisor3: esA ? base.emisores[2]!.id : null,
    personas,
    token,
    carta,
    operador: (s) => operadores[s](),
    sucursalId: id,
    mesaNueva: async (s) => {
      if (!zonas.has(s))
        zonas.set(
          s,
          crearZona(ctx.app, token.admin!, id(s)).then((z) => z.zonaId),
        );
      const zonaId = await zonas.get(s)!;
      const n = mesasCreadas.get(s) ?? 0;
      mesasCreadas.set(s, n + 1);
      // Como `crearZona(...).nuevaMesa()` de 004, pero con la sesión vigente del Administrador (`token.admin`).
      const mesa = await api(
        ctx,
        token.admin,
        'post',
        `/sucursales/${id(s)}/zonas/${zonaId}/mesas`,
        {
          nombre: `M${n + 1}`,
          capacidad: 4,
          forma: 'CUADRADA',
          columna: (n % 12) + 1,
          fila: Math.floor(n / 12) + 1,
        },
      );
      exigirEstado(mesa, 201, 'Crear la mesa (004, criterio 3)');
      return mesa.body.id as string;
    },
    refrescarSesiones: async () => {
      token.admin = await sesionContrasena(ctx, base.admin, null);
      for (const { clave, persona } of altas) {
        token[clave] = await sesionContrasena(ctx, persona, sucursalDe[clave] ?? S1);
      }
    },
    cajas: async () => {
      throw new Error('se asigna abajo');
    },
  };
  let configuradas: Promise<Record<'S1' | 'S2' | 'S3' | 'S4', CajasDe | null>> | undefined;
  e.cajas = () => (configuradas ??= configurarCajas(ctx, e));
  return e;
}

/** El superadministrador y las empresas A y B con sus personas y su carta. */
export async function crearEscenario(ctx: AppP5): Promise<Escenario> {
  const sa = await nuevoSuperadmin(ctx);
  const A = await prepararEmpresa(ctx, sa, true);
  const B = await prepararEmpresa(ctx, sa, false);
  return { ctx, sa, A, B };
}

// ------------------------------------------------------------------------------------------------
// Cajas, series y tasas (rutas de configuración de 6a)
// ------------------------------------------------------------------------------------------------

export async function crearCaja(
  ctx: AppP5,
  token: string,
  sucursalId: string,
  nombre: string,
  impresoraId?: string | null,
): Promise<Libre> {
  const res = await api(ctx, token, 'post', `/sucursales/${sucursalId}/cajas`, {
    nombre,
    ...(impresoraId !== undefined ? { impresoraId } : {}),
  });
  exigirEstado(res, 201, `Crear la caja ${nombre} (006, criterio 1)`);
  return res.body as Libre;
}

export const ponerSerie = (
  ctx: AppP5,
  token: string,
  sucursalId: string,
  cajaId: string,
  tipo: 'BOLETA' | 'FACTURA',
  serie: string,
  primerNumero?: number,
): Promise<Res> =>
  api(ctx, token, 'put', `/sucursales/${sucursalId}/cajas/${cajaId}/series/${tipo}`, {
    serie,
    ...(primerNumero !== undefined ? { primerNumero } : {}),
  });

export const ponerTasa = (
  ctx: AppP5,
  token: string,
  emisorId: string,
  desde: string,
  tasa: string,
): Promise<Res> => api(ctx, token, 'put', `/emisores/${emisorId}/tasas-igv/${desde}`, { tasa });

export async function caja(
  ctx: AppP5,
  token: string,
  sucursalId: string,
  nombre: string,
  series: { boleta?: string; factura?: string },
  impresoraId?: string | null,
): Promise<string> {
  const c = await crearCaja(ctx, token, sucursalId, nombre, impresoraId);
  if (series.boleta) {
    exigirEstado(
      await ponerSerie(ctx, token, sucursalId, c.id, 'BOLETA', series.boleta),
      200,
      'Serie de boletas',
    );
  }
  if (series.factura) {
    exigirEstado(
      await ponerSerie(ctx, token, sucursalId, c.id, 'FACTURA', series.factura),
      200,
      'Serie de facturas',
    );
  }
  return c.id as string;
}

async function configurarCajas(
  ctx: AppP5,
  e: EmpresaCaja,
): Promise<Record<'S1' | 'S2' | 'S3' | 'S4', CajasDe | null>> {
  const t = e.token.admin!;
  exigirEstado(await ponerTasa(ctx, t, e.emisor1, '2026-01-01', '18.00'), 200, 'Tasa de IGV de E1');
  const esA = e.emisor2 !== null;
  const s1: CajasDe = {
    caja1: await caja(ctx, t, e.S1, 'Caja 1', { boleta: 'B001', factura: 'F001' }),
    caja2: await caja(ctx, t, e.S1, 'Caja 2', { boleta: 'B002', factura: 'F002' }),
    caja3: await caja(ctx, t, e.S1, 'Caja 3', { boleta: 'B003' }),
  };
  if (!esA) return { S1: s1, S2: null, S3: null, S4: null };
  // S2: Nuevo RUS (sin tasa). S3: otra sucursal de E1 con sus propias series. S4: emisor sin tasa.
  const s2: CajasDe = {
    caja1: await caja(ctx, t, e.S2, 'Caja 1', { boleta: 'B001', factura: 'F001' }),
    caja2: await caja(ctx, t, e.S2, 'Caja 2', { boleta: 'B002' }),
    caja3: await caja(ctx, t, e.S2, 'Caja 3', { boleta: 'B003' }),
  };
  const s3: CajasDe = {
    caja1: await caja(ctx, t, e.S3, 'Caja 1', { boleta: 'B301', factura: 'F301' }),
    caja2: await caja(ctx, t, e.S3, 'Caja 2', { boleta: 'B302', factura: 'F302' }),
    caja3: await caja(ctx, t, e.S3, 'Caja 3', { boleta: 'B303' }),
  };
  const s4: CajasDe = {
    caja1: await caja(ctx, t, e.S4!, 'Caja 1', { boleta: 'B401', factura: 'F401' }),
    caja2: await caja(ctx, t, e.S4!, 'Caja 2', { boleta: 'B402' }),
    caja3: await caja(ctx, t, e.S4!, 'Caja 3', { boleta: 'B403' }),
  };
  return { S1: s1, S2: s2, S3: s3, S4: s4 };
}

// ------------------------------------------------------------------------------------------------
// Turnos
// ------------------------------------------------------------------------------------------------

export const abrirTurnoCrudo = (
  ctx: AppP5,
  token: string,
  cajaId: string,
  fondo = '200.00',
  id: string = randomUUID(),
  clave?: string,
): Promise<Res> =>
  escribir(ctx, token, 'post', '/turnos', { id, cajaId, fondo }, clave ? ik(clave) : {});

/** Abre un turno (exige 201) y devuelve su id. */
export async function abrirTurno(
  ctx: AppP5,
  token: string,
  cajaId: string,
  fondo = '200.00',
): Promise<string> {
  const res = await abrirTurnoCrudo(ctx, token, cajaId, fondo);
  exigirEstado(res, 201, 'Abrir el turno (006, criterio 24)');
  return res.body.id as string;
}

export const MEDIOS = ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'] as const;

/** El conteo de los cinco medios con lo contado por medio (los demás en cero). */
export function conteo(
  contado: Partial<Record<(typeof MEDIOS)[number], string>>,
  motivos: Libre = {},
) {
  return {
    conteo: MEDIOS.map((medio) => ({
      medio,
      contado: contado[medio] ?? '0.00',
      ...(motivos[medio] ? { motivo: motivos[medio] as string } : {}),
    })),
  };
}

export const cerrarTurnoCrudo = (
  ctx: AppP5,
  token: string,
  turnoId: string,
  cuerpo: unknown,
  clave?: string,
): Promise<Res> =>
  escribir(ctx, token, 'post', `/turnos/${turnoId}/cierre`, cuerpo, clave ? ik(clave) : {});

// ------------------------------------------------------------------------------------------------
// Cuentas: órdenes con ítems enviados
// ------------------------------------------------------------------------------------------------

export interface Cuenta {
  ordenId: string;
  mesaId: string;
  sucursal: Sucursal;
  token: string;
  /** `itemId` por producto enviado: lomo, gaseosa, bolsa, mandarina, tostada, pisco. */
  item: Record<string, string>;
}

export type NombreLinea =
  'lomo' | 'gaseosa' | 'bolsa' | 'mandarina' | 'tostada' | 'pisco' | 'dulce';

export function lineaDe(c: CartaCaja, nombre: NombreLinea, cantidad: number): LineaPlana {
  return nombre === 'lomo'
    ? { productoId: c.lomo.id, modificadorIds: [c.lomo.tresCuartos], cantidad }
    : { productoId: c[nombre], modificadorIds: [], cantidad };
}

/** Abre una mesa nueva y envía las líneas (exige 201 en los dos pasos). */
export async function cuentaCon(
  ctx: AppP5,
  e: EmpresaCaja,
  sucursal: Sucursal,
  lineas: Array<[NombreLinea, number]>,
): Promise<Cuenta> {
  const token = e.operador(sucursal);
  const mesaId = await e.mesaNueva(sucursal);
  const abrir = await escribir(ctx, token, 'post', '/ordenes', {
    id: randomUUID(),
    mesaId,
    comensales: 2,
  });
  exigirEstado(abrir, 201, 'Abrir la mesa (004)');
  const ordenId = abrir.body.id as string;
  const cuenta: Cuenta = { ordenId, mesaId, sucursal, token, item: {} };
  if (lineas.length > 0) await agregar(ctx, e, cuenta, lineas);
  return cuenta;
}

/** Envía más líneas a una cuenta (exige 201). */
export async function agregar(
  ctx: AppP5,
  e: EmpresaCaja,
  cuenta: Cuenta,
  lineas: Array<[NombreLinea, number]>,
): Promise<Res> {
  const res = await enviarLineas(ctx, e, cuenta, lineas);
  exigirEstado(res, 201, 'Enviar la comanda (004)');
  registrarItems(e, cuenta, res.body.items as Libre[]);
  return res;
}

export function enviarLineas(
  ctx: AppP5,
  e: EmpresaCaja,
  cuenta: Cuenta,
  lineas: Array<[NombreLinea, number]>,
): Promise<Res> {
  return escribir(ctx, cuenta.token, 'post', `/ordenes/${cuenta.ordenId}/envios`, {
    id: randomUUID(),
    lineas: lineas.map(([n, q]) => lineaDe(e.carta, n, q)),
  });
}

export function registrarItems(e: EmpresaCaja, cuenta: Cuenta, items: Libre[]): void {
  const porProducto: Record<string, NombreLinea> = {
    [e.carta.lomo.id]: 'lomo',
    [e.carta.gaseosa]: 'gaseosa',
    [e.carta.bolsa]: 'bolsa',
    [e.carta.mandarina]: 'mandarina',
    [e.carta.tostada]: 'tostada',
    [e.carta.pisco]: 'pisco',
    [e.carta.dulce]: 'dulce',
  };
  for (const item of items) {
    const nombre = porProducto[item.productoId as string];
    if (nombre) cuenta.item[nombre] = item.id as string;
  }
}

/** Una cuenta con líneas ya armadas (modificadores a la medida): abre la mesa y envía; devuelve los ítems creados. */
export async function cuentaConLineas(
  ctx: AppP5,
  e: EmpresaCaja,
  sucursal: Sucursal,
  lineas: LineaPlana[],
): Promise<{ ordenId: string; mesaId: string; token: string; items: Libre[] }> {
  const token = e.operador(sucursal);
  const mesaId = await e.mesaNueva(sucursal);
  const abrir = await escribir(ctx, token, 'post', '/ordenes', {
    id: randomUUID(),
    mesaId,
    comensales: 2,
  });
  exigirEstado(abrir, 201, 'Abrir la mesa (004)');
  const ordenId = abrir.body.id as string;
  const envio = await escribir(ctx, token, 'post', `/ordenes/${ordenId}/envios`, {
    id: randomUUID(),
    lineas,
  });
  exigirEstado(envio, 201, 'Enviar la comanda (004)');
  return { ordenId, mesaId, token, items: envio.body.items as Libre[] };
}

/** La cuenta C de la especificación: Lomo [3/4] × 2, Gaseosa × 1, Bolsa × 2 y Mandarina × 1 (total `"69.20"`). */
export const cuentaC = (ctx: AppP5, e: EmpresaCaja, sucursal: Sucursal = 'S1') =>
  cuentaCon(ctx, e, sucursal, [
    ['lomo', 2],
    ['gaseosa', 1],
    ['bolsa', 2],
    ['mandarina', 1],
  ]);

// ------------------------------------------------------------------------------------------------
// Cobros
// ------------------------------------------------------------------------------------------------

export const efectivo = (monto: string, recibido?: string) => ({
  medio: 'EFECTIVO' as const,
  monto,
  ...(recibido ? { recibido } : {}),
});
export const yape = (monto: string, operacion = 'OP-0001') => ({
  medio: 'YAPE' as const,
  monto,
  operacion,
});
export const tarjeta = (monto: string, operacion = 'VCH-0001') => ({
  medio: 'TARJETA_CREDITO' as const,
  monto,
  operacion,
});

export interface OpcionesCobro {
  id?: string;
  turnoId: string;
  version: number;
  total: string;
  parte?: Libre;
  tipo?: 'BOLETA' | 'FACTURA';
  formato?: 'DETALLADO' | 'CONSUMO';
  cliente?: Libre;
  pagos?: Libre[];
  redondeo?: string;
}

/** El cuerpo de `POST /cuentas/:ordenId/cobros`; sin `pagos`, todo en efectivo exacto. */
export function cuerpoDeCobro(o: OpcionesCobro): Libre {
  return {
    id: o.id ?? randomUUID(),
    turnoId: o.turnoId,
    version: o.version,
    total: o.total,
    parte: o.parte ?? { tipo: 'TOTAL' },
    comprobante: {
      tipo: o.tipo ?? 'BOLETA',
      formato: o.formato ?? 'DETALLADO',
      ...(o.cliente ? { cliente: o.cliente } : {}),
    },
    pagos: o.pagos ?? [efectivo(o.total)],
    redondeo: o.redondeo ?? '0.00',
  };
}

export const cobrarCrudo = (
  ctx: AppP5,
  token: string,
  ordenId: string,
  cuerpo: Libre,
  clave?: string,
): Promise<Res> =>
  escribir(ctx, token, 'post', `/cuentas/${ordenId}/cobros`, cuerpo, clave ? ik(clave) : {});

/** Cobra con la versión actual de la orden (exige 201). */
export async function cobrar(
  ctx: AppP5,
  token: string,
  cuenta: Pick<Cuenta, 'ordenId'>,
  o: Omit<OpcionesCobro, 'version'> & { version?: number },
): Promise<Libre> {
  const version = o.version ?? (await versionDe(cuenta.ordenId));
  const res = await cobrarCrudo(ctx, token, cuenta.ordenId, cuerpoDeCobro({ ...o, version }));
  exigirEstado(res, 201, 'Cobrar (006, criterio 47)');
  return res.body as Libre;
}

export const CLIENTE_RUC = {
  tipoDocumento: 'RUC',
  numero: '20100070970',
  nombre: 'Supermercados Peruanos S.A.',
  direccion: 'Av. Prueba 123, Lima',
};
export const CLIENTE_DNI = { tipoDocumento: 'DNI', numero: '45678912', nombre: 'Ana Quispe' };

// ------------------------------------------------------------------------------------------------
// Lectura de filas y eventos
// ------------------------------------------------------------------------------------------------

export async function ultimoNumero(cajaId: string, tipo: 'BOLETA' | 'FACTURA'): Promise<number> {
  const r = await filas(
    'SELECT ultimo_numero FROM serie WHERE caja_id = $1 AND tipo = $2 AND activa',
    [cajaId, tipo],
  );
  return Number(r[0]?.ultimo_numero);
}

export const comprobantesDeLaOrden = (ordenId: string) =>
  filas('SELECT * FROM comprobante WHERE orden_id = $1 ORDER BY numero_parte', [ordenId]);

export const cobrosDeLaOrden = (ordenId: string) =>
  filas('SELECT * FROM cobro WHERE orden_id = $1 ORDER BY creado_en, id', [ordenId]);

export const estadoDeOrden = async (ordenId: string): Promise<string> =>
  (await filas('SELECT estado FROM orden WHERE id = $1', [ordenId]))[0]?.estado;

export const estadoDeMesa = async (ctx: AppP5, token: string, mesaId: string): Promise<string> => {
  const res = await api(ctx, token, 'get', '/salon');
  exigirEstado(res, 200, 'GET /salon (004)');
  for (const z of res.body.zonas as Libre[]) {
    const m = (z.mesas as Libre[]).find((x) => x.id === mesaId);
    if (m) return m.estado as string;
  }
  throw new Error('La mesa no está en el salón');
};

export const eventosDe = (ctx: AppP5, nombre: string) =>
  ctx.publicador.eventos().filter((ev) => ev.nombre === nombre);

export async function trabajosDe(sucursalId: string, tipo?: string): Promise<Libre[]> {
  return filas(
    `SELECT * FROM trabajo_impresion WHERE sucursal_id = $1 AND ($2::text IS NULL OR tipo = $2) ORDER BY creado_en, id`,
    [sucursalId, tipo ?? null],
  );
}

// ------------------------------------------------------------------------------------------------
// Impresora de caja con gaveta (emulador) y puente
// ------------------------------------------------------------------------------------------------

/**
 * Una impresora de red con gaveta (su emulador), fijada como impresora de caja de la sucursal. Si se pide,
 * también queda como la impresora propia de la caja.
 */
export async function impresoraDeCaja(
  ctx: AppP5,
  cierres: Cierres,
  tokenAdmin: string,
  sucursalId: string,
  nombre: string,
  opciones: { gaveta?: boolean; cajaId?: string } = {},
): Promise<ImpresoraDePrueba> {
  const imp = await crearImpresora(ctx, cierres, tokenAdmin, sucursalId, nombre);
  if (opciones.gaveta !== false) {
    const res = await api(
      ctx,
      tokenAdmin,
      'patch',
      `/sucursales/${sucursalId}/impresoras/${imp.id}`,
      {
        gaveta: true,
      },
    );
    exigirEstado(res, 200, 'Poner gaveta a la impresora (3b)');
  }
  const caja = await api(ctx, tokenAdmin, 'put', `/sucursales/${sucursalId}/impresion`, {
    impresoraCajaId: imp.id,
  });
  exigirEstado(caja, 200, 'Fijar la impresora de caja (3b)');
  if (opciones.cajaId) {
    const r = await api(
      ctx,
      tokenAdmin,
      'patch',
      `/sucursales/${sucursalId}/cajas/${opciones.cajaId}`,
      {
        impresoraId: imp.id,
      },
    );
    exigirEstado(r, 200, 'Impresora propia de la caja (006, criterio 2)');
  }
  return imp;
}

/** Los pulsos de gaveta que recibió el emulador (en tickets completos y en los que no llevan corte). */
export function pulsosRecibidos(emulador: ImpresoraDePrueba['emulador']): number {
  return [...emulador.tickets, ...emulador.parciales].reduce((s, t) => s + t.pulsosGaveta, 0);
}

// ------------------------------------------------------------------------------------------------
// Fallas inyectadas por la base (el puerto de impresión no se puede reemplazar desde fuera)
// ------------------------------------------------------------------------------------------------

/**
 * Hace fallar el `INSERT` del trabajo de impresión del comprobante de un cobro concreto (el último paso antes de
 * confirmar): un trigger temporal creado como administrador que lanza un error si el comprobante pertenece al
 * `cobroId`. Devuelve cómo quitarlo. Solo afecta a ese cobro, así que no estorba a las demás pruebas.
 */
export async function fallarElTicketDelCobro(cobroId: string): Promise<() => Promise<void>> {
  const nombre = `fallo_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const c = await admin();
  await c.query(`
    CREATE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.tipo = 'COMPROBANTE'
         AND EXISTS (SELECT 1 FROM comprobante k WHERE k.id = NEW.comprobante_id AND k.cobro_id = '${cobroId}') THEN
        RAISE EXCEPTION 'falla inyectada por la prueba';
      END IF;
      RETURN NEW;
    END $f$`);
  await c.query(
    `CREATE TRIGGER ${nombre} BEFORE INSERT ON trabajo_impresion FOR EACH ROW EXECUTE FUNCTION ${nombre}()`,
  );
  return async () => {
    await c.query(`DROP TRIGGER IF EXISTS ${nombre} ON trabajo_impresion`);
    await c.query(`DROP FUNCTION IF EXISTS ${nombre}()`);
  };
}

// ------------------------------------------------------------------------------------------------
// Autorizaciones de supervisor
// ------------------------------------------------------------------------------------------------

/** `POST /autorizaciones` con el PIN del supervisor (exige 201) y, si se da, el objetivo atado. */
export async function autorizar(
  ctx: AppP5,
  token: string,
  pin: string,
  accion: 'APLICAR_DESCUENTO' | 'APLICAR_CORTESIA' | 'ANULAR_ITEM_ENVIADO' | 'ANULAR_ORDEN',
  objetivo?: Libre,
): Promise<{ autorizacionId: string; expiraEn: string }> {
  const res = await api(ctx, token, 'post', '/autorizaciones', {
    accion,
    motivo: 'Autoriza el supervisor',
    pin,
    ...(objetivo ? { objetivo } : {}),
  });
  exigirEstado(res, 201, `POST /autorizaciones (${accion})`);
  return res.body as { autorizacionId: string; expiraEn: string };
}

// ------------------------------------------------------------------------------------------------
// Ronda 2 del ataque: peticiones en curso, retenciones deterministas y lecturas de la cuenta
// ------------------------------------------------------------------------------------------------

/** Lanza la petición ya (supertest es perezoso: no envía hasta que alguien espera el resultado). */
export const enCurso = <T>(p: PromiseLike<T>): Promise<T> =>
  new Promise<T>((resolver, rechazar) => {
    p.then(resolver, rechazar);
  });

/**
 * Una retención de PostgreSQL hecha por un cliente administrador, para ensanchar a voluntad la ventana de una
 * operación de la API sin depender de tiempos: mientras no se libera, lo que choque con ella queda esperando.
 */
export class Retencion {
  private liberada = false;
  private constructor(private readonly cliente: Client) {}

  /** Bloquea la tabla `auditoria` en modo SHARE: toda operación que deba dejar una fila de auditoría queda esperando. */
  static async deAuditoria(): Promise<Retencion> {
    const c = await abrirCliente('admin');
    await c.query('BEGIN');
    await c.query('LOCK TABLE auditoria IN SHARE MODE');
    return new Retencion(c);
  }

  /** Bloquea la fila de la serie activa de ese tipo en la caja: el cobro que numere con ella queda esperando. */
  static async deSerieActiva(
    cajaId: string,
    tipo: 'BOLETA' | 'FACTURA' = 'BOLETA',
  ): Promise<Retencion> {
    const c = await abrirCliente('admin');
    await c.query('BEGIN');
    await c.query('SELECT id FROM serie WHERE caja_id = $1 AND tipo = $2 AND activa FOR UPDATE', [
      cajaId,
      tipo,
    ]);
    return new Retencion(c);
  }

  /** Confirma y suelta la retención (se puede llamar más de una vez). */
  async liberar(): Promise<void> {
    if (this.liberada) return;
    this.liberada = true;
    try {
      await this.cliente.query('COMMIT');
    } finally {
      await this.cliente.end();
    }
  }
}

/** Anula unidades de un ítem enviado (004, criterio 35) con la sesión del supervisor. */
export const anularUnidades = (
  ctx: AppP5,
  token: string,
  ordenId: string,
  itemId: string,
  cantidad: number,
): Promise<Res> =>
  escribir(ctx, token, 'post', `/ordenes/${ordenId}/items/${itemId}/anulaciones`, {
    id: randomUUID(),
    cantidad,
    motivo: 'Error de toma',
    destinoStock: 'VUELVE',
  });

/** `GET /cuentas/:ordenId` (exige 200). */
export async function cuentaDe(ctx: AppP5, token: string, ordenId: string): Promise<Libre> {
  const res = await api(ctx, token, 'get', `/cuentas/${ordenId}`);
  exigirEstado(res, 200, 'GET /cuentas/:ordenId (006, criterio 36)');
  return res.body as Libre;
}

/** `GET /cuentas` (exige 200): las cuentas por cobrar de la sucursal activa. */
export async function cuentasPorCobrar(ctx: AppP5, token: string): Promise<Libre[]> {
  const res = await api(ctx, token, 'get', '/cuentas');
  exigirEstado(res, 200, 'GET /cuentas (006, criterio 37)');
  return res.body as Libre[];
}

export interface NumeracionDeSerie {
  serie: string;
  /** El tipo de comprobante de la serie (`serie.tipo`). */
  tipo: string;
  activa: boolean;
  ultimo: number;
  numeros: number[];
  /** Los números emitidos van de `primer_numero` a `ultimo_numero` sin saltos ni repetidos. */
  consecutivos: boolean;
}

/** La numeración de todas las series de una caja y de los comprobantes emitidos con cada una. */
export async function numeracionDeLaCaja(cajaId: string): Promise<NumeracionDeSerie[]> {
  const series = await filas(
    'SELECT serie, tipo, activa, ultimo_numero, primer_numero FROM serie WHERE caja_id = $1 ORDER BY serie',
    [cajaId],
  );
  const resultado: NumeracionDeSerie[] = [];
  for (const s of series) {
    const numeros = (
      await filas(
        'SELECT numero FROM comprobante WHERE caja_id = $1 AND serie = $2 ORDER BY numero',
        [cajaId, s.serie],
      )
    ).map((f) => Number(f.numero));
    const primero = Number(s.primer_numero);
    const ultimo = Number(s.ultimo_numero);
    const esperados = Array.from(
      { length: Math.max(0, ultimo - primero + 1) },
      (_, i) => primero + i,
    );
    resultado.push({
      serie: s.serie as string,
      tipo: s.tipo as string,
      activa: s.activa as boolean,
      ultimo,
      numeros,
      consecutivos: JSON.stringify(numeros) === JSON.stringify(esperados),
    });
  }
  return resultado;
}

export { sesionContrasena, sesionPin, equipoDe };
