// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P2 (Enviar comanda, marchar y el enganche del inventario) de la historia
// 004. Solo usan contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`,
// las empresas dadas de alta con `POST /plataforma/empresas`, los usuarios creados con `POST /usuarios`, la
// carta de ejemplo de `spec.md` creada por las rutas de `/carta` de 003 y las rutas de la tabla de endpoints de
// 3a. Para contar filas y leer las líneas de comanda usan un cliente administrador (solo lectura), con los
// nombres de tabla y columna de "Cambios al modelo de datos". No leen la implementación de la historia.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { PublicadorEnMemoria, type EventoPublicable } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import type { AlAnularEntrada, AlEnviarEntrada } from '../../src/modulos/pedidos/inventario';
import { ingresarOk, INICIO_POR_DEFECTO, recordarEquipo } from '../acceso/fabrica-plataforma';
import {
  asentar,
  bearer,
  crearEscenarioCarta,
  crearPersona,
  equipoDe,
  esperarError,
  exigirEstado,
  llamar,
  sesionContrasena,
  sesionPin,
  type AppCarta,
  type EscenarioCarta,
  type PersonaCarta,
} from '../carta-critica/fabrica-permisos-carta';
import { InventarioDePrueba } from '../soporte';
import { fijarEntornoDePrueba } from '../utilidades';

export {
  asentar,
  bearer,
  equipoDe,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  llamar,
  sesionContrasena,
  sesionPin,
};
export type { PersonaCarta };

export type Res = request.Response;

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

/**
 * Inventario de prueba que, además de registrar cada llamada, anota cuántos eventos tenía publicados el
 * publicador en memoria en el instante de la llamada. Como el envío y las anulaciones llaman al puerto dentro
 * de su transacción y los eventos salen después de confirmarla, ese número no puede haber crecido por la
 * petición que está en curso.
 */
export class InventarioObservador extends InventarioDePrueba {
  /** Eventos publicados en el momento de cada llamada, en orden. */
  readonly eventosAlLlamar: number[] = [];

  constructor(private readonly publicador: PublicadorEnMemoria) {
    super();
  }

  override async alEnviar(entrada: AlEnviarEntrada): Promise<void> {
    this.eventosAlLlamar.push(this.publicador.eventos().length);
    return super.alEnviar(entrada);
  }

  override async alAnular(entrada: AlAnularEntrada): Promise<void> {
    this.eventosAlLlamar.push(this.publicador.eventos().length);
    return super.alAnular(entrada);
  }

  /** Olvida las llamadas y los conteos anotados. */
  override limpiar(): void {
    super.limpiar();
    this.eventosAlLlamar.length = 0;
  }
}

export interface AppP2 extends AppCarta {
  inventario: InventarioObservador;
}

/**
 * Arranca la API real con `RelojManual`, `PublicadorEnMemoria` e `InventarioObservador`, sin
 * `EMPRESA_POR_HEADER`, escuchando en un puerto propio (admite peticiones concurrentes). El pool es de 5
 * conexiones por defecto: los casos concurrentes necesitan que varias peticiones avancen a la vez.
 */
export async function arrancarP2(
  opciones: { poolMax?: number; inicio?: string } = {},
): Promise<AppP2> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 5, empresaPorHeader: false });
  const reloj = new RelojManual(opciones.inicio ?? INICIO_POR_DEFECTO);
  const publicador = new PublicadorEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const inventario = new InventarioObservador(publicador);
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
// La carta de ejemplo de `spec.md`, creada por las rutas de 003
// ------------------------------------------------------------------------------------------------

export interface CartaEjemplo {
  cocinaId: string;
  barraId: string;
  familiaId: string;
  /** Productos que se venden. */
  lomo: string;
  combo: string;
  menu: string;
  gaseosa: string;
  /** Componentes y productos ligados (no se venden solos). */
  hamburguesa: string;
  refresco: string;
  huevoFrito: string;
  platanoFrito: string;
  chichaMorada: string;
  incaKola500: string;
  cervezaPilsen: string;
  papasFritas: string;
  sopaDeCasa: string;
  ajiDeGallina: string;
  /** Id de cada modificador por su nombre (Jugoso, 3/4, Huevo, Cerveza, Sopa, …). */
  mod: Record<NombreModificador, string>;
  grupos: {
    termino: string;
    extras: string;
    bebida: string;
    acompanamiento: string;
    entrada: string;
    segundo: string;
  };
}

export type NombreModificador =
  | 'Jugoso'
  | '3/4'
  | 'Bien cocido'
  | 'Huevo'
  | 'Plátano'
  | 'Queso'
  | 'Chicha'
  | 'Inca Kola'
  | 'Cerveza'
  | 'Papas'
  | 'Ensalada'
  | 'Sopa'
  | 'Ají de gallina'
  | 'Lomo saltado';

interface Creado {
  id: string;
  modificadores?: { id: string; nombre: string }[];
}

/**
 * Siembra la carta de ejemplo en la empresa: estaciones Cocina y Barra; "Lomo saltado", "Combo hamburguesa",
 * "Menú del día" y "Gaseosa 1 L" con sus grupos, componentes y productos ligados; y el menú del día armado
 * para hoy en S1. `tokenAdmin` es el Administrador sin sucursal activa; `tokenAdminS1`, el mismo con S1 activa
 * (el menú del día se arma en la sucursal activa).
 */
export async function sembrarCartaEjemplo(
  ctx: AppCarta,
  tokenAdmin: string,
  tokenAdminS1: string,
): Promise<CartaEjemplo> {
  const crear = async (ruta: string, cuerpo: unknown): Promise<Creado> => {
    const res = await llamar(ctx, tokenAdmin, { metodo: 'post', ruta, cuerpo });
    exigirEstado(res, 201, `POST ${ruta}`);
    return res.body as Creado;
  };
  const cocina = await crear('/carta/estaciones', { nombre: 'Cocina' });
  const barra = await crear('/carta/estaciones', { nombre: 'Barra' });
  const familia = await crear('/carta/familias', { nombre: 'Carta' });

  const auxiliar = (nombre: string, estacionId: string, control: string) =>
    crear('/carta/productos', {
      tipo: 'SIMPLE',
      nombre,
      familiaId: familia.id,
      seVendeSolo: false,
      estacionId,
      tipoControlStock: control,
    });
  const huevoFrito = await auxiliar('Huevo frito', cocina.id, 'UNIDADES');
  const platanoFrito = await auxiliar('Plátano frito', cocina.id, 'SIN_CONTROL');
  const hamburguesa = await auxiliar('Hamburguesa clásica', cocina.id, 'PORCIONES');
  const chichaMorada = await auxiliar('Chicha morada', barra.id, 'PORCIONES');
  const incaKola500 = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Inca Kola 500 ml',
    familiaId: familia.id,
    seVendeSolo: false,
    estacionId: null,
    tipoControlStock: 'UNIDADES',
  });
  const cervezaPilsen = await auxiliar('Cerveza Pilsen', barra.id, 'UNIDADES');
  const papasFritas = await auxiliar('Papas fritas', cocina.id, 'SIN_CONTROL');
  const refresco = await auxiliar('Refresco del día', barra.id, 'PORCIONES');
  const sopaDeCasa = await auxiliar('Sopa de casa', cocina.id, 'PORCIONES');
  const ajiDeGallina = await auxiliar('Ají de gallina', cocina.id, 'PORCIONES');

  const gaseosa = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Gaseosa 1 L',
    familiaId: familia.id,
    precio: '9.00',
    estacionId: null,
    tipoControlStock: 'UNIDADES',
  });

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
      { nombre: 'Plátano', precioExtra: '3.00', productoId: platanoFrito.id },
      { nombre: 'Queso', precioExtra: '2.00' },
    ],
  });
  const bebida = await crear('/carta/grupos-modificadores', {
    nombre: 'Bebida',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Chicha', precioExtra: '0.00', productoId: chichaMorada.id },
      { nombre: 'Inca Kola', precioExtra: '0.00', productoId: incaKola500.id },
      { nombre: 'Cerveza', precioExtra: '4.50', productoId: cervezaPilsen.id },
    ],
  });
  const acompanamiento = await crear('/carta/grupos-modificadores', {
    nombre: 'Acompañamiento',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Papas', precioExtra: '0.00', productoId: papasFritas.id },
      { nombre: 'Ensalada', precioExtra: '1.00' },
    ],
  });
  const entrada = await crear('/carta/grupos-modificadores', {
    nombre: 'Entrada',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [{ nombre: 'Sopa', precioExtra: '0.00', productoId: sopaDeCasa.id }],
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
  const segundo = await crear('/carta/grupos-modificadores', {
    nombre: 'Segundo',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Ají de gallina', precioExtra: '0.00', productoId: ajiDeGallina.id },
      { nombre: 'Lomo saltado', precioExtra: '5.00', productoId: lomo.id },
    ],
  });

  const combo = await crear('/carta/productos', {
    tipo: 'COMBO',
    nombre: 'Combo hamburguesa',
    familiaId: familia.id,
    precio: '22.90',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    gruposModificadores: [bebida.id, acompanamiento.id],
  });
  const menu = await crear('/carta/productos', {
    tipo: 'MENU_DEL_DIA',
    nombre: 'Menú del día',
    familiaId: familia.id,
    precio: '12.00',
    tipoControlStock: 'PORCIONES',
    componentes: [{ productoId: refresco.id, cantidad: 1 }],
    gruposModificadores: [entrada.id, segundo.id],
  });

  const mod = {} as Record<NombreModificador, string>;
  for (const grupo of [termino, extras, bebida, acompanamiento, entrada, segundo]) {
    for (const m of grupo.modificadores ?? []) mod[m.nombre as NombreModificador] = m.id;
  }

  const armar = await llamar(ctx, tokenAdminS1, {
    metodo: 'put',
    ruta: `/carta/sucursal/menu-del-dia/${menu.id}`,
    cuerpo: { opciones: [mod['Sopa'], mod['Ají de gallina'], mod['Lomo saltado']] },
  });
  exigirEstado(armar, 200, 'armar el menú del día de hoy en S1');

  return {
    cocinaId: cocina.id,
    barraId: barra.id,
    familiaId: familia.id,
    lomo: lomo.id,
    combo: combo.id,
    menu: menu.id,
    gaseosa: gaseosa.id,
    hamburguesa: hamburguesa.id,
    refresco: refresco.id,
    huevoFrito: huevoFrito.id,
    platanoFrito: platanoFrito.id,
    chichaMorada: chichaMorada.id,
    incaKola500: incaKola500.id,
    cervezaPilsen: cervezaPilsen.id,
    papasFritas: papasFritas.id,
    sopaDeCasa: sopaDeCasa.id,
    ajiDeGallina: ajiDeGallina.id,
    mod,
    grupos: {
      termino: termino.id,
      extras: extras.id,
      bebida: bebida.id,
      acompanamiento: acompanamiento.id,
      entrada: entrada.id,
      segundo: segundo.id,
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Productos propios de una prueba (para cambiar la carta sin tocar la carta de ejemplo)
// ------------------------------------------------------------------------------------------------

/** Texto único por llamada. */
export const nombreUnico = (prefijo: string): string =>
  `${prefijo} ${randomUUID().replace(/-/g, '').slice(0, 10)}`;

/** `POST` a una ruta de `/carta` con el Administrador (exige 201) y devuelve lo creado. */
export async function crearEnCarta(
  ctx: AppCarta,
  token: string,
  ruta: string,
  cuerpo: unknown,
): Promise<{ id: string; nombre: string; modificadores?: { id: string; nombre: string }[] }> {
  const res = await llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
  exigirEstado(res, 201, `POST ${ruta}`);
  return res.body as {
    id: string;
    nombre: string;
    modificadores?: { id: string; nombre: string }[];
  };
}

/** `PATCH` a una ruta de `/carta` con el Administrador (exige 200). */
export async function modificarEnCarta(
  ctx: AppCarta,
  token: string,
  ruta: string,
  cuerpo: unknown,
): Promise<Res> {
  const res = await llamar(ctx, token, { metodo: 'patch', ruta, cuerpo });
  exigirEstado(res, 200, `PATCH ${ruta}`);
  return res;
}

/** Un producto simple propio de la prueba: `"10.00"`, en Cocina, por unidades, que se vende solo. */
export function simpleNuevo(
  carta: CartaEjemplo,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tipo: 'SIMPLE',
    nombre: nombreUnico('Producto de prueba'),
    familiaId: carta.familiaId,
    precio: '10.00',
    estacionId: carta.cocinaId,
    tipoControlStock: 'UNIDADES',
    ...extra,
  };
}

// ------------------------------------------------------------------------------------------------
// Zonas, mesas y órdenes
// ------------------------------------------------------------------------------------------------

const CELDAS_POR_ZONA = 12 * 30;

/**
 * Salón de pruebas de una sucursal: crea zonas de 12 × 30 y una mesa nueva (en una celda libre) cada vez que se
 * pide, con el Administrador (`ADMINISTRAR`, sin sucursal activa; la sucursal va en la ruta).
 */
export class SalonDePrueba {
  private cuantas = 0;
  private zonaId: string | null = null;

  constructor(
    private readonly ctx: AppCarta,
    private readonly tokenAdmin: string,
    readonly sucursalId: string,
    private readonly etiqueta = 'Zona',
  ) {}

  /** Una mesa nueva, activa y libre; devuelve su id. */
  async mesaNueva(): Promise<string> {
    const celda = this.cuantas % CELDAS_POR_ZONA;
    if (celda === 0) {
      const zona = await llamar(this.ctx, this.tokenAdmin, {
        metodo: 'post',
        ruta: `/sucursales/${this.sucursalId}/zonas`,
        cuerpo: {
          nombre: `${this.etiqueta} ${Math.floor(this.cuantas / CELDAS_POR_ZONA) + 1}`,
          columnas: 12,
          filas: 30,
        },
      });
      exigirEstado(zona, 201, 'crear una zona');
      this.zonaId = zona.body.id as string;
    }
    this.cuantas += 1;
    const mesa = await llamar(this.ctx, this.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${this.sucursalId}/zonas/${this.zonaId}/mesas`,
      cuerpo: {
        nombre: `${this.etiqueta[0]}${this.cuantas}`,
        capacidad: 4,
        forma: 'CUADRADA',
        columna: (celda % 12) + 1,
        fila: Math.floor(celda / 12) + 1,
      },
    });
    exigirEstado(mesa, 201, 'crear una mesa');
    return mesa.body.id as string;
  }
}

export interface OrdenAbierta {
  id: string;
  mesaId: string;
  body: Record<string, unknown>;
}

/** Cabecera `Idempotency-Key` con una clave nueva (o la dada). */
export const clave = (k: string = randomUUID()) => ({ 'Idempotency-Key': k });

/** Abre una mesa nueva con el token dado (exige 201). */
export async function abrirOrden(
  ctx: AppCarta,
  salon: SalonDePrueba,
  token: string,
  opciones: { mesaId?: string; comensales?: number; mozoId?: string } = {},
): Promise<OrdenAbierta> {
  const mesaId = opciones.mesaId ?? (await salon.mesaNueva());
  const id = randomUUID();
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/ordenes',
    cuerpo: {
      id,
      mesaId,
      comensales: opciones.comensales ?? 2,
      ...(opciones.mozoId !== undefined ? { mozoId: opciones.mozoId } : {}),
    },
    cabeceras: clave(),
  });
  exigirEstado(res, 201, 'abrir una mesa');
  return { id, mesaId, body: res.body as Record<string, unknown> };
}

/** `GET /ordenes/:id`. */
export const verOrden = (ctx: AppCarta, token: string, ordenId: string) =>
  llamar(ctx, token, { metodo: 'get', ruta: `/ordenes/${ordenId}` });

// ------------------------------------------------------------------------------------------------
// Líneas, envíos y marchas
// ------------------------------------------------------------------------------------------------

export interface LineaCuerpo {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion?: string;
  tiempo?: 1 | 2;
  paraLlevar?: boolean;
}

export type ExtraDeLinea = Partial<Pick<LineaCuerpo, 'observacion' | 'tiempo' | 'paraLlevar'>>;

/** Constructores de líneas de la carta de ejemplo: `L.lomo(['3/4', 'Huevo'], 2)`. */
export function lineasDe(c: CartaEjemplo) {
  const con =
    (productoId: string) =>
    (mods: NombreModificador[] = [], cantidad = 1, extra: ExtraDeLinea = {}): LineaCuerpo => ({
      productoId,
      modificadorIds: mods.map((m) => c.mod[m]),
      cantidad,
      ...extra,
    });
  return {
    lomo: con(c.lomo),
    combo: con(c.combo),
    menu: con(c.menu),
    gaseosa: (cantidad = 1, extra: ExtraDeLinea = {}): LineaCuerpo => ({
      productoId: c.gaseosa,
      modificadorIds: [],
      cantidad,
      ...extra,
    }),
  };
}

export interface EnvioCuerpo {
  id: string;
  lineas: LineaCuerpo[];
}

/** El cuerpo de un envío con un id nuevo (o el dado). */
export const envio = (lineas: LineaCuerpo[], id: string = randomUUID()): EnvioCuerpo => ({
  id,
  lineas,
});

/** `POST /ordenes/:id/envios` con una `Idempotency-Key` nueva (o la dada). */
export function enviarComanda(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  cuerpo: unknown,
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/envios`,
    cuerpo,
    cabeceras: clave(k),
  });
}

/** Envía y exige 201. */
export async function enviarOk(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  lineas: LineaCuerpo[],
  id: string = randomUUID(),
): Promise<EnvioRespuestaDePrueba> {
  const res = await enviarComanda(ctx, token, ordenId, envio(lineas, id));
  exigirEstado(res, 201, 'enviar la comanda');
  return res.body as EnvioRespuestaDePrueba;
}

export interface ItemDePrueba {
  id: string;
  envioNumero: number;
  esAdicion: boolean;
  productoId: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  cantidadAnulada: number;
  cantidadVigente: number;
  precioUnitario: string;
  totalVigente: string;
  modificadores: { nombre: string; precioExtra: string }[];
  componentes: { nombre: string; cantidad: number }[];
  observacion: string | null;
  tiempo: 1 | 2;
  paraLlevar: boolean;
  marchadoEn: string | null;
  estado: string;
  cocina: { enviado: number; enPreparacion: number; listo: number; anulado: number };
  comandadoPor: { id: string; nombre: string } | null;
  enviadoEn: string;
}

export interface ComandaDePrueba {
  id: string;
  estacionId: string;
  estacionNombre: string;
  tipo: 'COMANDA' | 'ADICION' | 'MARCHAR' | 'ANULACION';
  destino: 'KDS' | 'IMPRESORA';
}

export interface EnvioRespuestaDePrueba {
  id: string;
  ordenId: string;
  numero: number;
  esAdicion: boolean;
  items: ItemDePrueba[];
  comandas: ComandaDePrueba[];
}

/** `POST /ordenes/:id/marchas` con una `Idempotency-Key` nueva (o la dada). */
export function marchar(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  cuerpo: unknown,
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/marchas`,
    cuerpo,
    cabeceras: clave(k),
  });
}

/** `POST /ordenes/:id/precuentas`. */
export function pedirPrecuenta(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  id: string = randomUUID(),
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/precuentas`,
    cuerpo: { id },
    cabeceras: clave(k),
  });
}

/** Anula la orden con un Supervisor o Administrador (sin clave) y exige 200. */
export async function anularOrdenOk(
  ctx: AppCarta,
  tokenSupervisor: string,
  ordenId: string,
  destinoStock: 'VUELVE' | 'MERMA' = 'VUELVE',
): Promise<Res> {
  const res = await llamar(ctx, tokenSupervisor, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/anulacion`,
    cuerpo: { motivo: 'Anulación de prueba', destinoStock },
    cabeceras: clave(),
  });
  exigirEstado(res, 200, 'anular la orden');
  return res;
}

/** Anula parte de un ítem con un Supervisor o Administrador (sin clave) y exige 201. */
export async function anularItemOk(
  ctx: AppCarta,
  tokenSupervisor: string,
  ordenId: string,
  itemId: string,
  cantidad: number,
  destinoStock: 'VUELVE' | 'MERMA' = 'VUELVE',
  id: string = randomUUID(),
): Promise<Res> {
  const res = await llamar(ctx, tokenSupervisor, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
    cuerpo: { id, cantidad, motivo: 'Anulación de prueba', destinoStock },
    cabeceras: clave(),
  });
  exigirEstado(res, 201, 'anular un ítem');
  return res;
}

/** Une mesas a la orden (`MOVER_UNIR_MESAS`) y exige 200. */
export async function unirMesasOk(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  mesaIds: string[],
): Promise<Res> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/union`,
    cuerpo: { mesaIds },
  });
  exigirEstado(res, 200, 'unir mesas');
  return res;
}

/** Marca agotado un producto en la sucursal activa del token (Cocina/Barra, Supervisor o Administrador). */
export async function agotar(ctx: AppCarta, token: string, productoId: string): Promise<void> {
  const res = await llamar(ctx, token, {
    metodo: 'put',
    ruta: `/carta/sucursal/agotados/${productoId}`,
    cuerpo: { hasta: 'FIN_DEL_DIA' },
  });
  exigirEstado(res, 200, 'marcar agotado');
}

/** Reactiva un producto agotado en la sucursal activa del token. */
export async function reactivar(ctx: AppCarta, token: string, productoId: string): Promise<void> {
  const res = await llamar(ctx, token, {
    metodo: 'delete',
    ruta: `/carta/sucursal/agotados/${productoId}`,
  });
  exigirEstado(res, 204, 'reactivar un agotado');
}

// ------------------------------------------------------------------------------------------------
// Escenario: dos empresas con su carta, su salón y sus personas
// ------------------------------------------------------------------------------------------------

export interface EscenarioP2 {
  e: EscenarioCarta;
  carta: CartaEjemplo;
  cartaB: CartaEjemplo;
  /** Salón de S1 de A, de S2 de A y de S1 de B. */
  salon: SalonDePrueba;
  salonS2: SalonDePrueba;
  salonB: SalonDePrueba;
  /** Sesiones de contraseña de A con S1 activa (salvo `adminA`, sin sucursal activa). */
  token: {
    adminA: string;
    adminS1: string;
    mozo: string;
    mozo2: string;
    cocina: string;
    supervisor: string;
    cajero: string;
    /** El Cajero de S1 que es Mozo en S2, con S2 activa. */
    mozoS2: string;
    /** Un Mozo de B con S1 de B activa. */
    mozoB: string;
    adminS1B: string;
  };
  /** Otra persona con el rol Mozo en S1 de A (para los cambios de usuario). */
  mozo2: PersonaCarta;
}

/** Arma las dos empresas, sus cartas de ejemplo, sus salones y las sesiones que usan las pruebas. */
export async function prepararEscenarioP2(ctx: AppP2): Promise<EscenarioP2> {
  const e = await crearEscenarioCarta(ctx);
  const mozo2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S1, rol: 'MOZO' }]);
  const mozoDeB = await crearPersona(ctx, e.B.tokenAdmin, [{ sucursalId: e.B.S1, rol: 'MOZO' }]);
  const adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
  const adminS1B = await sesionContrasena(ctx, e.B.base.admin, e.B.S1);
  const carta = await sembrarCartaEjemplo(ctx, e.A.tokenAdmin, adminS1);
  const cartaB = await sembrarCartaEjemplo(ctx, e.B.tokenAdmin, adminS1B);
  return {
    e,
    carta,
    cartaB,
    salon: new SalonDePrueba(ctx, e.A.tokenAdmin, e.A.S1, 'Salón'),
    salonS2: new SalonDePrueba(ctx, e.A.tokenAdmin, e.A.S2, 'Terraza'),
    salonB: new SalonDePrueba(ctx, e.B.tokenAdmin, e.B.S1, 'Salón'),
    token: {
      adminA: e.A.tokenAdmin,
      adminS1,
      mozo: await sesionContrasena(ctx, e.A.mozo, e.A.S1),
      mozo2: await sesionContrasena(ctx, mozo2, e.A.S1),
      cocina: await sesionContrasena(ctx, e.A.cocina, e.A.S1),
      supervisor: await sesionContrasena(ctx, e.A.supervisor, e.A.S1),
      cajero: await sesionContrasena(ctx, e.A.cajero, e.A.S1),
      mozoS2: await sesionContrasena(ctx, e.A.cajero, e.A.S2),
      mozoB: await sesionContrasena(ctx, mozoDeB, e.B.S1),
      adminS1B,
    },
    mozo2,
  };
}

/**
 * Un equipo recordado por todas las personas dadas (la primera lo crea, las demás se agregan) y, por persona, su
 * sesión de PIN con S1 activa. Abrir la sesión de PIN de una cierra la anterior del equipo (cambio rápido).
 */
export async function equipoCompartido(
  ctx: AppCarta,
  personas: PersonaCarta[],
): Promise<{ tokenEquipo: string }> {
  const [primera, ...resto] = personas;
  if (!primera) throw new Error('equipoCompartido necesita al menos una persona');
  const tokenEquipo = await equipoDe(ctx, primera);
  for (const persona of resto) {
    const { token } = await ingresarOk(ctx, persona.usuario, persona.contrasena);
    await recordarEquipo(ctx, token, { tokenEquipo });
  }
  return { tokenEquipo };
}

// ------------------------------------------------------------------------------------------------
// Eventos publicados
// ------------------------------------------------------------------------------------------------

/** Deja pasar los efectos de después de confirmar y devuelve los eventos publicados (de un nombre, o todos). */
export async function eventosPublicados(ctx: AppP2, nombre?: string): Promise<EventoPublicable[]> {
  await asentar();
  const todos = ctx.publicador.eventos();
  return nombre === undefined ? todos : todos.filter((ev) => ev.nombre === nombre);
}

/** Ejecuta `hacer` con el publicador y el inventario limpios y devuelve la respuesta y lo que publicó. */
export async function conEventos<T>(
  ctx: AppP2,
  hacer: () => Promise<T>,
): Promise<{ resultado: T; eventos: EventoPublicable[] }> {
  await asentar();
  ctx.publicador.limpiar();
  ctx.inventario.limpiar();
  const resultado = await hacer();
  return { resultado, eventos: await eventosPublicados(ctx) };
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

export interface ConteoDeOrden {
  envios: number;
  items: number;
  comandas: number;
  lineas: number;
  marchas: number;
}

/** Cuántas filas de envío, ítem, comanda, línea de comanda y marcha tiene una orden. */
export async function conteoDeOrden(admin: Client, ordenId: string): Promise<ConteoDeOrden> {
  const { rows } = await admin.query<ConteoDeOrden>(
    `SELECT
       (SELECT count(*)::int FROM envio WHERE orden_id = $1) AS envios,
       (SELECT count(*)::int FROM item WHERE orden_id = $1) AS items,
       (SELECT count(*)::int FROM comanda WHERE orden_id = $1) AS comandas,
       (SELECT count(*)::int FROM comanda_linea
         WHERE comanda_id IN (SELECT id FROM comanda WHERE orden_id = $1)) AS lineas,
       (SELECT count(*)::int FROM marcha WHERE orden_id = $1) AS marchas`,
    [ordenId],
  );
  return rows[0]!;
}

/** Lo mismo, de toda la empresa (para comprobar que un rechazo no guardó nada en ninguna orden). */
export async function conteoDeEmpresa(admin: Client, empresaId: string): Promise<ConteoDeOrden> {
  const { rows } = await admin.query<ConteoDeOrden>(
    `SELECT
       (SELECT count(*)::int FROM envio WHERE empresa_id = $1) AS envios,
       (SELECT count(*)::int FROM item WHERE empresa_id = $1) AS items,
       (SELECT count(*)::int FROM comanda WHERE empresa_id = $1) AS comandas,
       (SELECT count(*)::int FROM comanda_linea WHERE empresa_id = $1) AS lineas,
       (SELECT count(*)::int FROM marcha WHERE empresa_id = $1) AS marchas`,
    [empresaId],
  );
  return rows[0]!;
}

/** Una línea de comanda tal como la guarda la base, con lo que el KDS y el ticket muestran. */
export interface LineaDeComandaBd {
  comandaId: string;
  itemId: string;
  /** Posición del ítem dentro del envío (para ordenar las líneas por el orden de los ítems). */
  posicion: number;
  rol: 'PRODUCTO' | 'COMPONENTE' | 'LIGADO';
  productoId: string;
  nombre: string;
  contexto: string | null;
  /** La cantidad de la parte: la fija de la línea, o `cantidad_por_item × cantidad vigente` del ítem. */
  cantidad: number;
  modificadores: string[];
  observacion: string | null;
  tiempo: number;
  paraLlevar: boolean;
  esperar: boolean;
  estado: string;
}

const nombresDe = (valor: unknown): string[] =>
  Array.isArray(valor)
    ? valor.map((m) =>
        typeof m === 'string' ? m : String((m as { nombre?: unknown }).nombre ?? ''),
      )
    : [];

/** Las líneas de una comanda, ordenadas por la posición de su ítem y luego por rol y nombre. */
export async function lineasDeComanda(
  admin: Client,
  comandaId: string,
): Promise<LineaDeComandaBd[]> {
  const { rows } = await admin.query<{
    linea: Record<string, unknown>;
    item: Record<string, unknown>;
  }>(
    `SELECT to_jsonb(cl) AS linea, to_jsonb(i) AS item
       FROM comanda_linea cl
       JOIN item i ON i.id = cl.item_id AND i.empresa_id = cl.empresa_id
      WHERE cl.comanda_id = $1`,
    [comandaId],
  );
  const lineas = rows.map(({ linea, item }): LineaDeComandaBd => {
    const fija = linea.cantidad as number | null | undefined;
    const vigente = (item.cantidad as number) - (item.cantidad_anulada as number);
    return {
      comandaId,
      itemId: linea.item_id as string,
      posicion: item.posicion as number,
      rol: linea.rol as LineaDeComandaBd['rol'],
      productoId: linea.producto_id as string,
      nombre: linea.nombre as string,
      contexto: (linea.contexto as string | null) ?? null,
      cantidad: fija ?? (linea.cantidad_por_item as number) * vigente,
      modificadores: nombresDe(linea.modificadores),
      observacion: (linea.observacion as string | null) ?? null,
      tiempo: linea.tiempo as number,
      paraLlevar: linea.para_llevar as boolean,
      esperar: linea.esperar as boolean,
      estado: linea.estado as string,
    };
  });
  return lineas.sort(
    (a, b) =>
      a.posicion - b.posicion || a.rol.localeCompare(b.rol) || a.nombre.localeCompare(b.nombre),
  );
}

/** La comanda de la respuesta que corresponde a la estación (por su nombre); falla si no está. */
export function comandaDe(
  comandas: ComandaDePrueba[],
  estacionNombre: string,
  tipo?: ComandaDePrueba['tipo'],
): ComandaDePrueba {
  const c = comandas.find(
    (x) => x.estacionNombre === estacionNombre && (tipo === undefined || x.tipo === tipo),
  );
  if (!c) {
    throw new Error(
      `No hay una comanda de ${estacionNombre}${tipo ? ` (${tipo})` : ''} en ${JSON.stringify(comandas)}`,
    );
  }
  return c;
}

/** Cuántas filas de `comanda` hay para la orden de un tipo. */
export async function comandasDeOrden(
  admin: Client,
  ordenId: string,
  tipo?: ComandaDePrueba['tipo'],
): Promise<{ id: string; estacion_id: string; tipo: string; destino: string }[]> {
  const { rows } = await admin.query(
    `SELECT id, estacion_id, tipo, destino FROM comanda
      WHERE orden_id = $1 AND ($2::text IS NULL OR tipo = $2) ORDER BY id`,
    [ordenId, tipo ?? null],
  );
  return rows;
}

/**
 * Pasa una orden a `CERRADA` como lo hará el cobro de la sección 4 (que todavía no existe): fija un actor de
 * sistema en la transacción y actualiza el estado y la hora de cierre. Es lo único que escribe la base por SQL.
 */
export async function cerrarOrdenPorSql(admin: Client, ordenId: string): Promise<void> {
  await admin.query('BEGIN');
  try {
    await admin.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba-004-p2']);
    const { rowCount } = await admin.query(
      `UPDATE orden SET estado = 'CERRADA', cerrada_en = now() WHERE id = $1`,
      [ordenId],
    );
    if (rowCount !== 1) throw new Error(`La orden ${ordenId} no existe`);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

/**
 * El cuerpo de una respuesta de error con los ids dados reemplazados por `<id>`: sirve para comprobar que un
 * id de otra empresa se rechaza con el mismo cuerpo que uno inexistente aunque el mensaje nombre el id.
 */
export function cuerpoSinIds(res: Res, ids: string[]): unknown {
  let texto = JSON.stringify(res.body);
  for (const id of ids) texto = texto.split(id).join('<id>').split(id.toUpperCase()).join('<id>');
  return JSON.parse(texto);
}

/** Los nombres de campo (`campos[].campo`) de una respuesta 400 o 422. */
export const camposDe = (res: Res): string[] =>
  ((res.body as { campos?: { campo: string }[] }).campos ?? []).map((c) => c.campo);

/** Suma de dinero exacta en céntimos para armar totales esperados sin números de coma flotante. */
export function monto(...partes: string[]): string {
  const centimos = partes.reduce((suma, p) => suma + Math.round(Number(p) * 100), 0);
  return `${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, '0')}`;
}
