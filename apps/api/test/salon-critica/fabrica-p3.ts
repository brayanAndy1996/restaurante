// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P3 (permisos, clave de supervisor, auditoría y atribución) de la historia
// 004. Solo usan contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`,
// las empresas dadas de alta con `POST /plataforma/empresas`, los usuarios creados con `POST /usuarios`, la carta
// de ejemplo de `spec.md` sembrada con las rutas de `/carta` (003), el mapa de mesas con las rutas de zonas y
// mesas, y las rutas de órdenes, envíos, anulaciones y cocina de la tabla de endpoints. Para leer filas usan un
// cliente administrador (solo lectura). No leen la implementación de la historia.
import { randomUUID } from 'node:crypto';
import {
  cocinaRespuestaSchema,
  type CocinaRespuesta,
  type ComandaKds,
  type EnvioRespuesta,
  type ItemRespuesta,
  type OrdenRespuesta,
  type SalonRespuesta,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import request from 'supertest';
import { expect } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { PublicadorEnMemoria } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import {
  bearer,
  exigirEstado,
  ingresarOk,
  INICIO_POR_DEFECTO,
  recordarEquipo,
} from '../acceso/fabrica-plataforma';
import {
  crearEscenarioCarta,
  crearPersona,
  esperarError,
  llamar,
  sesionContrasena,
  sesionPin,
  unico,
  type AppCarta,
  type EscenarioCarta,
  type Llamada,
  type PersonaCarta,
} from '../carta-critica/fabrica-permisos-carta';
import { InventarioDePrueba } from '../soporte';
import { fijarEntornoDePrueba } from '../utilidades';

export { bearer, crearPersona, esperarError, exigirEstado, llamar, unico };
export type { AppCarta, EscenarioCarta, Llamada, PersonaCarta };
export { asentar, exigirSinFallos } from '../carta-critica/fabrica-permisos-carta';

export const MINUTO = 60_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

export interface AppP3 extends AppCarta {
  inventario: InventarioDePrueba;
}

/**
 * Arranca la API real con `RelojManual`, `PublicadorEnMemoria`, `AlmacenEnMemoria` e `InventarioDePrueba`, sin
 * `EMPRESA_POR_HEADER`, y la deja escuchando en un puerto propio (admite peticiones concurrentes).
 */
export async function arrancarP3(
  opciones: { poolMax?: number; inicio?: string } = {},
): Promise<AppP3> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 4, empresaPorHeader: false });
  const reloj = new RelojManual(opciones.inicio ?? INICIO_POR_DEFECTO);
  const publicador = new PublicadorEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const inventario = new InventarioDePrueba();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: publicador,
    almacenArchivos: almacen,
    inventario,
  });
  await app.listen(0);
  return {
    app,
    reloj,
    publicador,
    almacen,
    inventario,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}

// ------------------------------------------------------------------------------------------------
// Sesiones de contraseña y de PIN (cada persona tiene su propio equipo recordado)
// ------------------------------------------------------------------------------------------------

export type TipoDeSesion = 'contrasena' | 'pin';
export const TIPOS_DE_SESION: readonly TipoDeSesion[] = ['contrasena', 'pin'];

/** Lo que hace falta de una persona para abrirle sesión (sirve también al Administrador del alta). */
export type PersonaConSesion = Pick<PersonaCarta, 'id' | 'usuario' | 'contrasena' | 'pin'>;

export interface SesionesP3 {
  contrasena: string;
  pin: string;
  /** Id del equipo recordado de la sesión de PIN (el que queda en la trazabilidad y en la auditoría). */
  equipoId: string;
  tokenEquipo: string;
}

/** Registra un equipo recordado nuevo para la persona y devuelve su id y su token. */
export async function equipoRecordadoDe(
  ctx: AppCarta,
  persona: Pick<PersonaCarta, 'usuario' | 'contrasena'>,
): Promise<{ equipoId: string; tokenEquipo: string }> {
  const { token } = await ingresarOk(ctx, persona.usuario, persona.contrasena);
  const r = await recordarEquipo(ctx, token, { nombre: unico('Equipo') });
  if (!r.tokenEquipo) throw new Error('El equipo recordado no devolvió su token');
  return { equipoId: r.equipo.id, tokenEquipo: r.tokenEquipo };
}

/** Una sesión de contraseña y una de PIN de la persona, con esa sucursal activa (o ninguna con `null`). */
export async function abrirSesiones(
  ctx: AppCarta,
  persona: PersonaConSesion,
  sucursalId: string | null,
): Promise<SesionesP3> {
  const equipo = await equipoRecordadoDe(ctx, persona);
  return {
    contrasena: await sesionContrasena(ctx, persona, sucursalId),
    pin: await sesionPin(ctx, persona, equipo.tokenEquipo, sucursalId),
    ...equipo,
  };
}

const MEMO_SESIONES = new Map<string, Promise<SesionesP3>>();

/** Como `abrirSesiones`, pero las abre una sola vez por persona y sucursal en todo el archivo de pruebas. */
export function sesiones(
  ctx: AppCarta,
  persona: PersonaConSesion,
  sucursalId: string | null,
): Promise<SesionesP3> {
  const clave = `${persona.id}:${sucursalId}`;
  let p = MEMO_SESIONES.get(clave);
  if (!p) {
    p = abrirSesiones(ctx, persona, sucursalId);
    MEMO_SESIONES.set(clave, p);
  }
  return p;
}

// ------------------------------------------------------------------------------------------------
// Escenario: empresas A y B con sus usuarios, más un segundo Mozo y la inactividad alargada
// ------------------------------------------------------------------------------------------------

export interface EscenarioP3 extends EscenarioCarta {
  /** Otro Mozo de S1 (los dos Mozos de la atribución). */
  mozo2: PersonaCarta;
}

/**
 * Crea las empresas A (S1, S2 y S3) y B, con un Mozo, un Cocina/Barra, un Supervisor y un Cajero (Cajero en S1 y
 * Mozo en S2) en cada una, y un segundo Mozo de S1 en A. Alarga la inactividad de las sucursales de A a 120
 * minutos (el máximo de 002) para que las sesiones que se reutilizan entre pruebas no venzan cuando una prueba
 * mueve el reloj unos minutos.
 */
export async function crearEscenarioP3(ctx: AppCarta): Promise<EscenarioP3> {
  const e = await crearEscenarioCarta(ctx);
  const mozo2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S1, rol: 'MOZO' }]);
  for (const sucursalId of [e.A.S1, e.A.S2, e.A.S3!]) {
    const res = await llamar(ctx, e.A.tokenAdmin, {
      metodo: 'patch',
      ruta: `/sucursales/${sucursalId}/acceso`,
      cuerpo: { minutosInactividad: 120 },
    });
    exigirEstado(res, 200, 'alargar la inactividad de la sucursal');
  }
  return { ...e, mozo2 };
}

// ------------------------------------------------------------------------------------------------
// La carta de ejemplo de `spec.md` (la parte que necesitan las anulaciones y la atribución)
// ------------------------------------------------------------------------------------------------

export interface CartaSalon {
  cocinaId: string;
  barraId: string;
  familiaId: string;
  /** "Lomo saltado", simple, `"28.00"`, Cocina, `SIN_CONTROL`. */
  lomoId: string;
  /** Opciones del grupo Término (Jugoso, 3/4, Bien cocido). */
  terminoIds: { jugoso: string; tresCuartos: string; bienCocido: string };
  /** Opciones del grupo Extras: Huevo (`"2.50"`, ligado a "Huevo frito") y Queso (`"2.00"`). */
  extrasIds: { huevo: string; queso: string };
  huevoFritoId: string;
  /** "Combo hamburguesa", `"22.90"`, con "Hamburguesa clásica" (Cocina) y la bebida del grupo Bebida. */
  comboId: string;
  hamburguesaId: string;
  cervezaPilsenId: string;
  /** Opciones del grupo Bebida: Cerveza (`"4.50"`, ligada a "Cerveza Pilsen", Barra) e Inca Kola (`"0.00"`). */
  bebidaIds: { cerveza: string; incaKola: string };
  /** "Gaseosa 1 L", simple, `"9.00"`, sin estación, `UNIDADES`. */
  gaseosaId: string;
}

/** Precios unitarios de las líneas de uso común (con sus modificadores incluidos). */
export const PRECIO = {
  /** Lomo saltado con 3/4 y Huevo: 28.00 + 2.50. */
  lomoConHuevo: '30.50',
  /** Lomo saltado con 3/4. */
  lomo: '28.00',
  /** Combo hamburguesa con Cerveza: 22.90 + 4.50. */
  combo: '27.40',
  gaseosa: '9.00',
} as const;

/** Siembra la carta de ejemplo en la empresa con el token del Administrador (exige 201 en cada alta). */
export async function sembrarCartaSalon(ctx: AppCarta, token: string): Promise<CartaSalon> {
  const crear = async (ruta: string, cuerpo: unknown) => {
    const res = await llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
    exigirEstado(res, 201, `POST ${ruta}`);
    return res.body as { id: string; modificadores?: { id: string; nombre: string }[] };
  };
  const cocina = await crear('/carta/estaciones', { nombre: 'Cocina' });
  const barra = await crear('/carta/estaciones', { nombre: 'Barra' });
  const familia = await crear('/carta/familias', { nombre: 'Platos' });
  const ligado = (nombre: string, estacionId: string | null, control: string) =>
    crear('/carta/productos', {
      tipo: 'SIMPLE',
      nombre,
      familiaId: familia.id,
      seVendeSolo: false,
      estacionId,
      tipoControlStock: control,
    });
  const huevoFrito = await ligado('Huevo frito', cocina.id, 'UNIDADES');
  const hamburguesa = await ligado('Hamburguesa clásica', cocina.id, 'PORCIONES');
  const cervezaPilsen = await ligado('Cerveza Pilsen', barra.id, 'UNIDADES');

  const termino = await crear('/carta/grupos-modificadores', {
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [{ nombre: 'Jugoso' }, { nombre: '3/4' }, { nombre: 'Bien cocido' }],
  });
  const extras = await crear('/carta/grupos-modificadores', {
    nombre: 'Extras',
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 2,
    modificadores: [
      { nombre: 'Huevo', precioExtra: '2.50', productoId: huevoFrito.id },
      { nombre: 'Queso', precioExtra: '2.00' },
    ],
  });
  const lomo = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    familiaId: familia.id,
    precio: '28.00',
    estacionId: cocina.id,
    tipoControlStock: 'SIN_CONTROL',
    gruposModificadores: [termino.id, extras.id],
  });
  const bebida = await crear('/carta/grupos-modificadores', {
    nombre: 'Bebida',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Cerveza', precioExtra: '4.50', productoId: cervezaPilsen.id },
      { nombre: 'Inca Kola', precioExtra: '0.00' },
    ],
  });
  const combo = await crear('/carta/productos', {
    tipo: 'COMBO',
    nombre: 'Combo hamburguesa',
    familiaId: familia.id,
    precio: '22.90',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    gruposModificadores: [bebida.id],
  });
  const gaseosa = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Gaseosa 1 L',
    familiaId: familia.id,
    precio: '9.00',
    estacionId: null,
    tipoControlStock: 'UNIDADES',
  });
  const [jugoso, tresCuartos, bienCocido] = (termino.modificadores ?? []).map((m) => m.id) as [
    string,
    string,
    string,
  ];
  const [huevo, queso] = (extras.modificadores ?? []).map((m) => m.id) as [string, string];
  const [cerveza, incaKola] = (bebida.modificadores ?? []).map((m) => m.id) as [string, string];
  return {
    cocinaId: cocina.id,
    barraId: barra.id,
    familiaId: familia.id,
    lomoId: lomo.id,
    terminoIds: { jugoso, tresCuartos, bienCocido },
    extrasIds: { huevo, queso },
    huevoFritoId: huevoFrito.id,
    comboId: combo.id,
    hamburguesaId: hamburguesa.id,
    cervezaPilsenId: cervezaPilsen.id,
    bebidaIds: { cerveza, incaKola },
    gaseosaId: gaseosa.id,
  };
}

export interface LineaDeEnvio {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion?: string;
  tiempo?: 1 | 2;
  paraLlevar?: boolean;
}

/** Lomo saltado con 3/4 y, por defecto, Huevo (`"30.50"` cada uno). */
export const lineaLomo = (
  c: CartaSalon,
  cantidad = 2,
  opciones: { conHuevo?: boolean } = {},
): LineaDeEnvio => ({
  productoId: c.lomoId,
  modificadorIds: [c.terminoIds.tresCuartos, ...(opciones.conHuevo === false ? [] : [c.extrasIds.huevo])],
  cantidad,
});

/** Combo hamburguesa con Cerveza (`"27.40"` cada uno). */
export const lineaCombo = (c: CartaSalon, cantidad = 3): LineaDeEnvio => ({
  productoId: c.comboId,
  modificadorIds: [c.bebidaIds.cerveza],
  cantidad,
});

/** Gaseosa 1 L (`"9.00"` cada una; no va a ninguna estación). */
export const lineaGaseosa = (c: CartaSalon, cantidad = 2): LineaDeEnvio => ({
  productoId: c.gaseosaId,
  modificadorIds: [],
  cantidad,
});

// ------------------------------------------------------------------------------------------------
// El mapa de mesas: zonas y mesas creadas por la API como el Administrador
// ------------------------------------------------------------------------------------------------

export interface MesaDePrueba {
  id: string;
  nombre: string;
  zonaId: string;
}

/**
 * Entrega mesas nuevas de una sucursal (una celda cada una, en zonas de 12 × 30) creándolas por la API cuando
 * hacen falta. Las mesas se piden en serie.
 */
export class PoolDeMesas {
  private indice = 0;
  private zonaId: string | null = null;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: AppCarta,
    private readonly tokenAdmin: string,
    readonly sucursalId: string,
  ) {}

  siguiente(): Promise<MesaDePrueba> {
    const tarea = this.cola.then(() => this.crear());
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async crear(): Promise<MesaDePrueba> {
    const columnas = 12;
    const filas = 30;
    if (this.zonaId === null || this.indice >= columnas * filas) {
      const zona = await llamar(this.ctx, this.tokenAdmin, {
        metodo: 'post',
        ruta: `/sucursales/${this.sucursalId}/zonas`,
        cuerpo: { nombre: unico('Zona'), columnas, filas },
      });
      exigirEstado(zona, 201, 'crear una zona');
      this.zonaId = zona.body.id as string;
      this.indice = 0;
    }
    const columna = (this.indice % columnas) + 1;
    const fila = Math.floor(this.indice / columnas) + 1;
    this.indice++;
    const nombre = `M${randomUUID().slice(0, 8)}`;
    const res = await llamar(this.ctx, this.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${this.sucursalId}/zonas/${this.zonaId}/mesas`,
      cuerpo: { nombre, capacidad: 4, forma: 'CUADRADA', columna, fila },
    });
    exigirEstado(res, 201, 'crear una mesa');
    return { id: res.body.id as string, nombre, zonaId: this.zonaId };
  }
}

// ------------------------------------------------------------------------------------------------
// Peticiones de la historia
// ------------------------------------------------------------------------------------------------

/** Cabeceras de una escritura idempotente: la clave (nueva si no se da) y, si hay, la autorización. */
export function cabeceras(
  clave: string | null = randomUUID(),
  autorizacion?: string | null,
): Record<string, string> {
  return {
    ...(clave === null ? {} : { 'Idempotency-Key': clave }),
    ...(autorizacion ? { 'X-Autorizacion': autorizacion } : {}),
  };
}

export interface OpcionesDeEscritura {
  /** `Idempotency-Key`; por defecto una nueva. `null` la omite. */
  clave?: string | null;
  /** `X-Autorizacion`. */
  autorizacion?: string | null;
}

export function abrirOrden(
  ctx: AppCarta,
  token: string,
  cuerpo: { id?: string; mesaId: string; comensales?: number; mozoId?: string },
  o: OpcionesDeEscritura = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: '/ordenes',
    cuerpo: { id: randomUUID(), comensales: 2, ...cuerpo },
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export function enviar(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  lineas: LineaDeEnvio[],
  o: OpcionesDeEscritura & { id?: string } = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/envios`,
    cuerpo: { id: o.id ?? randomUUID(), lineas },
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export interface CuerpoDeAnulacion {
  id: string;
  cantidad: number;
  motivo: string;
  destinoStock: 'VUELVE' | 'MERMA';
}

export const cuerpoDeAnulacion = (parcial: Partial<CuerpoDeAnulacion> = {}): CuerpoDeAnulacion => ({
  id: randomUUID(),
  cantidad: 1,
  motivo: 'El cliente no lo quiso',
  destinoStock: 'MERMA',
  ...parcial,
});

export function anularItem(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  itemId: string,
  cuerpo: unknown,
  o: OpcionesDeEscritura = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
    cuerpo,
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export function anularOrden(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  cuerpo: unknown = { motivo: 'Se fueron sin pedir', destinoStock: 'VUELVE' },
  o: OpcionesDeEscritura = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/anulacion`,
    cuerpo,
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export function liberarMesa(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  o: OpcionesDeEscritura = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/liberacion`,
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export function pedirPrecuenta(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  o: OpcionesDeEscritura & { id?: string } = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/precuentas`,
    cuerpo: { id: o.id ?? randomUUID() },
    cabeceras: cabeceras(o.clave, o.autorizacion),
  });
}

export async function leerOrden(
  ctx: AppCarta,
  token: string,
  ordenId: string,
): Promise<OrdenRespuesta> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
  exigirEstado(res, 200, 'GET /ordenes/:id');
  return res.body as OrdenRespuesta;
}

export async function leerSalon(ctx: AppCarta, token: string): Promise<SalonRespuesta> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/salon' });
  exigirEstado(res, 200, 'GET /salon');
  return res.body as SalonRespuesta;
}

/** La mesa tal como la ve el mapa de la sucursal activa. */
export async function mesaEnSalon(ctx: AppCarta, token: string, mesaId: string) {
  const salon = await leerSalon(ctx, token);
  const mesa = salon.zonas.flatMap((z) => z.mesas).find((m) => m.id === mesaId);
  if (!mesa) throw new Error(`La mesa ${mesaId} no aparece en GET /salon`);
  return mesa;
}

export async function leerCocina(ctx: AppCarta, token: string): Promise<CocinaRespuesta> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/cocina/comandas' });
  exigirEstado(res, 200, 'GET /cocina/comandas');
  return cocinaRespuestaSchema.parse(res.body);
}

/** Todas las comandas que ve el KDS (pendientes y recientes). */
export const comandasDelKds = (r: CocinaRespuesta): ComandaKds[] => [
  ...r.pendientes,
  ...r.recientes,
];

/** Autorización de clave de supervisor (`POST /autorizaciones`) con el PIN del Supervisor o del Administrador. */
export async function pedirAutorizacion(
  ctx: AppCarta,
  token: string,
  pin: string,
  accion: 'ANULAR_ITEM_ENVIADO' | 'ANULAR_ORDEN',
  motivo = 'El cliente reclamó',
): Promise<{ autorizacionId: string; expiraEn: string }> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/autorizaciones',
    cuerpo: { accion, motivo, pin },
  });
  exigirEstado(res, 201, `POST /autorizaciones (${accion})`);
  return res.body as { autorizacionId: string; expiraEn: string };
}

// ------------------------------------------------------------------------------------------------
// Una orden lista para anular
// ------------------------------------------------------------------------------------------------

export interface OrdenConItems {
  ordenId: string;
  mesa: MesaDePrueba;
  envio: EnvioRespuesta;
  /** Lomo saltado × 2 con 3/4 y Huevo. */
  lomo: ItemRespuesta;
  /** Combo hamburguesa × 3 con Cerveza. */
  combo: ItemRespuesta;
  /** Gaseosa 1 L × 2. */
  gaseosa: ItemRespuesta;
}

/**
 * Abre una mesa nueva con `tokenApertura` y envía con `tokenEnvio` el lomo × 2, el combo × 3 y la gaseosa × 2
 * (total `"161.20"`). Exige 201 en la apertura y en el envío.
 */
export async function ordenConItems(
  ctx: AppCarta,
  mesas: PoolDeMesas,
  carta: CartaSalon,
  tokenApertura: string,
  tokenEnvio: string = tokenApertura,
  opciones: { mozoId?: string } = {},
): Promise<OrdenConItems> {
  const mesa = await mesas.siguiente();
  const abrir = await abrirOrden(ctx, tokenApertura, {
    mesaId: mesa.id,
    ...(opciones.mozoId ? { mozoId: opciones.mozoId } : {}),
  });
  exigirEstado(abrir, 201, 'abrir la mesa');
  const ordenId = abrir.body.id as string;
  const envio = await enviar(ctx, tokenEnvio, ordenId, [
    lineaLomo(carta, 2),
    lineaCombo(carta, 3),
    lineaGaseosa(carta, 2),
  ]);
  exigirEstado(envio, 201, 'enviar la comanda');
  const cuerpo = envio.body as EnvioRespuesta;
  const de = (productoId: string) => {
    const item = cuerpo.items.find((i) => i.productoId === productoId);
    if (!item) throw new Error(`El envío no trae el producto ${productoId}`);
    return item;
  };
  return {
    ordenId,
    mesa,
    envio: cuerpo,
    lomo: de(carta.lomoId),
    combo: de(carta.comboId),
    gaseosa: de(carta.gaseosaId),
  };
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

/** Las tablas de pedidos y de salón de 3a, para comparar el antes y el después. */
export const TABLAS_SALON = [
  'zona',
  'mesa',
  'orden',
  'orden_mesa',
  'envio',
  'marcha',
  'item',
  'comanda',
  'comanda_linea',
  'anulacion_item',
  'precuenta',
] as const;

/** Acciones auditadas de 3a que importan a P3 (tabla "Acciones auditadas en esta sección" y las de 002). */
export const ACCIONES_SALON = [
  'crear_zona',
  'modificar_zona',
  'ordenar_zonas',
  'crear_mesa',
  'modificar_mesa',
  'anular_item',
  'ANULAR_ITEM_ENVIADO',
  'ANULAR_ORDEN',
  'anular_orden',
  'liberar_mesa',
  'unir_ordenes',
];

export interface FilaDeAuditoria {
  id: string;
  empresa_id: string | null;
  sucursal_id: string | null;
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
  detalle: Record<string, unknown> | null;
  ocurrido_en: Date;
  [columna: string]: unknown;
}

/** Filas de auditoría de las acciones de salón de una empresa, de la más antigua a la más nueva. */
export async function auditoriaSalon(
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
    [empresaId, ACCIONES_SALON, filtro.accion ?? null, filtro.entidadId ?? null],
  );
  return rows;
}

/**
 * Foto de las tablas de pedidos y de salón de una empresa. Una tabla que todavía no existe aparece como
 * `'SIN_TABLA'` (así la prueba compara antes y después y falla en lo que importa, no en la foto).
 */
export async function instantaneaSalon(
  admin: Client,
  empresaId: string,
): Promise<Record<string, unknown>> {
  const foto: Record<string, unknown> = {};
  for (const tabla of TABLAS_SALON) {
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

/** Filas de una tabla con una condición libre (`$1`, `$2`…), vistas por el administrador. */
export async function filasDe(
  admin: Client,
  tabla: string,
  condicion: string,
  parametros: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const { rows } = await admin.query(
    `SELECT * FROM ${tabla} WHERE ${condicion} ORDER BY creado_en, id::text`,
    parametros,
  );
  return rows;
}

/** La autorización de 002 tal como está guardada (`usada_en` nulo si sigue disponible). */
export async function autorizacionGuardada(
  admin: Client,
  autorizacionId: string,
): Promise<{ usada_en: Date | null; expira_en: Date }> {
  const { rows } = await admin.query<{ usada_en: Date | null; expira_en: Date }>(
    `SELECT usada_en, expira_en FROM autorizacion WHERE id = $1`,
    [autorizacionId],
  );
  expect(rows, `la autorización ${autorizacionId} existe`).toHaveLength(1);
  return rows[0]!;
}

/** Filas de `anulacion_item` de un ítem. */
export const anulacionesDelItem = (admin: Client, itemId: string) =>
  filasDe(admin, 'anulacion_item', 'item_id = $1', [itemId]);

/** Filas de `comanda` de tipo `ANULACION` de una orden, de la más antigua a la más nueva. */
export const comandasDeAnulacion = (admin: Client, ordenId: string) =>
  filasDe(admin, 'comanda', `orden_id = $1 AND tipo = 'ANULACION'`, [ordenId]);

/** Quién creó una fila (usuario, equipo y superadministrador), tal como queda en la trazabilidad. */
export async function autorDeFila(
  admin: Client,
  tabla: string,
  id: string,
): Promise<{
  usuarioId: string | null;
  equipoId: string | null;
  superadministradorId: string | null;
  sistema: string | null;
}> {
  const { rows } = await admin.query(
    `SELECT creado_por_usuario_id, creado_por_equipo_id, creado_por_superadministrador_id,
            creado_por_sistema
       FROM ${tabla} WHERE id = $1`,
    [id],
  );
  expect(rows, `fila ${tabla} ${id}`).toHaveLength(1);
  const f = rows[0] as Record<string, string | null>;
  return {
    usuarioId: f.creado_por_usuario_id ?? null,
    equipoId: f.creado_por_equipo_id ?? null,
    superadministradorId: f.creado_por_superadministrador_id ?? null,
    sistema: f.creado_por_sistema ?? null,
  };
}

/** El `mozo_id` guardado en la orden. */
export async function mozoGuardado(admin: Client, ordenId: string): Promise<string | null> {
  const { rows } = await admin.query<{ mozo_id: string | null }>(
    `SELECT mozo_id FROM orden WHERE id = $1`,
    [ordenId],
  );
  expect(rows, `orden ${ordenId}`).toHaveLength(1);
  return rows[0]!.mozo_id;
}

/** Comprueba que apareció exactamente una fila, de esa acción, y la devuelve. */
export function unaFilaDe(filas: FilaDeAuditoria[], accion: string): FilaDeAuditoria {
  expect(
    filas.map((f) => f.accion),
    'filas de auditoría de salón nuevas',
  ).toEqual([accion]);
  return filas[0]!;
}

/** Las filas de auditoría de salón que aparecieron después de `antes`. */
export async function auditoriaNueva(
  admin: Client,
  empresaId: string,
  antes: FilaDeAuditoria[],
): Promise<FilaDeAuditoria[]> {
  const vistas = new Set(antes.map((f) => f.id));
  return (await auditoriaSalon(admin, empresaId)).filter((f) => !vistas.has(f.id));
}

/** Los eventos publicados con ese nombre, con sus datos. */
export function eventosDe(ctx: AppP3, nombre: string): { empresaId: string; datos: unknown }[] {
  return ctx.publicador
    .eventos()
    .filter((e) => (e as { nombre: string }).nombre === nombre)
    .map((e) => ({
      empresaId: (e as { empresaId: string }).empresaId,
      datos: (e as { datos: unknown }).datos,
    }));
}

// ------------------------------------------------------------------------------------------------
// Las rutas de 3a de la tabla de endpoints de `spec.md` y su acción (criterio 78)
// ------------------------------------------------------------------------------------------------

export type AccionDeSalon =
  | 'ADMINISTRAR'
  | 'ATENDER_MESA'
  | 'MOVER_UNIR_MESAS'
  | 'ANULAR_ITEM_ENVIADO'
  | 'ANULAR_ORDEN'
  | 'USAR_KDS';

/** Ids que usan las rutas con parámetros; pueden ser reales o aleatorios. */
export interface IdsDeRutaSalon {
  sucursalId: string;
  zonaId: string;
  mesaId: string;
  otraMesaId: string;
  ordenId: string;
  itemId: string;
  lineaId: string;
  comandaId: string;
  productoId: string;
}

export interface RutaSalon {
  /** `MÉTODO /ruta` con todos los parámetros escritos `:p` (así se comparan con las que registra Nest). */
  clave: string;
  accion: AccionDeSalon;
  /** El módulo del plan que exige la ruta (`null` en las de configuración). */
  modulo: 'SALON' | 'COCINA' | null;
  construir: (ids: IdsDeRutaSalon) => Llamada;
}

const conClave = (): Record<string, string> => ({ 'Idempotency-Key': randomUUID() });

/** Las 23 rutas de 3a (zonas y mesas, salón, órdenes y cocina) con una petición de forma válida cada una. */
export const RUTAS_SALON: RutaSalon[] = [
  {
    clave: 'GET /sucursales/:p/zonas',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({ metodo: 'get', ruta: `/sucursales/${ids.sucursalId}/zonas` }),
  },
  {
    clave: 'POST /sucursales/:p/zonas',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${ids.sucursalId}/zonas`,
      cuerpo: { nombre: unico('Zona'), columnas: 4, filas: 4 },
    }),
  },
  {
    clave: 'PATCH /sucursales/:p/zonas/:p',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${ids.sucursalId}/zonas/${ids.zonaId}`,
      cuerpo: { nombre: unico('Zona') },
    }),
  },
  {
    clave: 'PUT /sucursales/:p/zonas/orden',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/sucursales/${ids.sucursalId}/zonas/orden`,
      cuerpo: { ids: [ids.zonaId] },
    }),
  },
  {
    clave: 'POST /sucursales/:p/zonas/:p/mesas',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${ids.sucursalId}/zonas/${ids.zonaId}/mesas`,
      cuerpo: { nombre: `X${randomUUID().slice(0, 6)}`, capacidad: 4, forma: 'REDONDA', columna: 1, fila: 1 },
    }),
  },
  {
    clave: 'PATCH /sucursales/:p/mesas/:p',
    accion: 'ADMINISTRAR',
    modulo: null,
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${ids.sucursalId}/mesas/${ids.mesaId}`,
      cuerpo: { capacidad: 6 },
    }),
  },
  {
    clave: 'GET /salon',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: () => ({ metodo: 'get', ruta: '/salon' }),
  },
  {
    clave: 'GET /salon/stock',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({ metodo: 'get', ruta: `/salon/stock?productoIds=${ids.productoId}` }),
  },
  {
    clave: 'POST /ordenes',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: '/ordenes',
      cuerpo: { id: randomUUID(), mesaId: ids.otraMesaId, comensales: 2 },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'GET /ordenes/:p',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({ metodo: 'get', ruta: `/ordenes/${ids.ordenId}` }),
  },
  {
    clave: 'PATCH /ordenes/:p',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'patch',
      ruta: `/ordenes/${ids.ordenId}`,
      cuerpo: { comensales: 7 },
    }),
  },
  {
    clave: 'POST /ordenes/:p/envios',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/envios`,
      cuerpo: {
        id: randomUUID(),
        lineas: [{ productoId: ids.productoId, modificadorIds: [], cantidad: 1 }],
      },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /ordenes/:p/marchas',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/marchas`,
      cuerpo: { id: randomUUID() },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /ordenes/:p/precuentas',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/precuentas`,
      cuerpo: { id: randomUUID() },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /ordenes/:p/liberacion',
    accion: 'ATENDER_MESA',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/liberacion`,
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /ordenes/:p/movimiento',
    accion: 'MOVER_UNIR_MESAS',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/movimiento`,
      cuerpo: { mesaDestinoId: ids.otraMesaId },
    }),
  },
  {
    clave: 'POST /ordenes/:p/union',
    accion: 'MOVER_UNIR_MESAS',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/union`,
      cuerpo: { mesaIds: [ids.otraMesaId] },
    }),
  },
  {
    clave: 'POST /ordenes/:p/items/:p/anulaciones',
    accion: 'ANULAR_ITEM_ENVIADO',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/items/${ids.itemId}/anulaciones`,
      cuerpo: cuerpoDeAnulacion(),
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'POST /ordenes/:p/anulacion',
    accion: 'ANULAR_ORDEN',
    modulo: 'SALON',
    construir: (ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.ordenId}/anulacion`,
      cuerpo: { motivo: 'Se fueron', destinoStock: 'VUELVE' },
      cabeceras: conClave(),
    }),
  },
  {
    clave: 'GET /cocina/comandas',
    accion: 'USAR_KDS',
    modulo: 'COCINA',
    construir: () => ({ metodo: 'get', ruta: '/cocina/comandas' }),
  },
  {
    clave: 'PUT /cocina/lineas/:p/estado',
    accion: 'USAR_KDS',
    modulo: 'COCINA',
    construir: (ids) => ({
      metodo: 'put',
      ruta: `/cocina/lineas/${ids.lineaId}/estado`,
      cuerpo: { estado: 'LISTO' },
    }),
  },
  {
    clave: 'PUT /cocina/comandas/:p/listo',
    accion: 'USAR_KDS',
    modulo: 'COCINA',
    construir: (ids) => ({ metodo: 'put', ruta: `/cocina/comandas/${ids.comandaId}/listo` }),
  },
  {
    clave: 'PUT /cocina/comandas/:p/visto',
    accion: 'USAR_KDS',
    modulo: 'COCINA',
    construir: (ids) => ({ metodo: 'put', ruta: `/cocina/comandas/${ids.comandaId}/visto` }),
  },
];

/** Ids con formato de UUID que no existen en ninguna empresa. */
export function idsAleatoriosSalon(sucursalId: string = randomUUID()): IdsDeRutaSalon {
  return {
    sucursalId,
    zonaId: randomUUID(),
    mesaId: randomUUID(),
    otraMesaId: randomUUID(),
    ordenId: randomUUID(),
    itemId: randomUUID(),
    lineaId: randomUUID(),
    comandaId: randomUUID(),
    productoId: randomUUID(),
  };
}

/** Ids reales de una orden con ítems enviados y de otra mesa libre, para que un permiso que se salte cambie algo. */
export async function idsRealesSalon(
  admin: Client,
  sucursalId: string,
  orden: OrdenConItems,
  otraMesa: MesaDePrueba,
  productoId: string,
): Promise<IdsDeRutaSalon> {
  const comandaId = orden.envio.comandas[0]!.id;
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM comanda_linea WHERE comanda_id = $1 ORDER BY id LIMIT 1`,
    [comandaId],
  );
  if (rows.length === 0) throw new Error('La comanda del envío no tiene líneas');
  return {
    sucursalId,
    zonaId: orden.mesa.zonaId,
    mesaId: orden.mesa.id,
    otraMesaId: otraMesa.id,
    ordenId: orden.ordenId,
    itemId: orden.lomo.id,
    lineaId: rows[0]!.id,
    comandaId,
    productoId,
  };
}
