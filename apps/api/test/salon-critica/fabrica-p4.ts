// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P4 (aislamiento entre empresas) de la historia 004, entrega 3a. Solo usan
// contratos públicos: la API real con `RelojManual`, `InventarioDePrueba` y, según la prueba, el
// `PublicadorEnMemoria` o el tiempo real habilitado (`crearAplicacion({ tiempoReal })`); las empresas dadas de
// alta con `POST /plataforma/empresas`, los usuarios con `POST /usuarios`, la carta de ejemplo de `spec.md`
// creada por las rutas de `/carta` (003), el salón y las órdenes por las rutas de la tabla de endpoints de
// 3a, y un cliente administrador de PostgreSQL (solo lectura) para ver filas. Las tablas nuevas se siembran
// por SQL con el nombre de tabla y de columna de "Cambios al modelo de datos" de `spec.md`. No leen la
// implementación de la historia.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { crearAplicacion } from '../../src/aplicacion';
import { AlmacenEnMemoria } from '../../src/nucleo/archivos';
import { PublicadorEnMemoria } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import { enTransaccion } from '../aislamiento/fabrica';
import { INICIO_POR_DEFECTO } from '../acceso/fabrica-plataforma';
import {
  bearer,
  exigirEstado,
  llamar,
  sesionContrasena,
  unico,
  uuidsEn,
  type AppCarta,
  type EmpresaCarta,
} from '../carta-critica/fabrica-permisos-carta';
import { InventarioDePrueba } from '../soporte';
import { fijarEntornoDePrueba } from '../utilidades';

export { bearer, exigirEstado, llamar, sesionContrasena, unico, uuidsEn };
export { asentar, exigirSinFallos, TABLAS_CARTA } from '../carta-critica/fabrica-permisos-carta';

// ------------------------------------------------------------------------------------------------
// La aplicación
// ------------------------------------------------------------------------------------------------

export interface AppP4 extends AppCarta {
  inventario: InventarioDePrueba;
  /** `true` si Socket.IO está habilitado; entonces `publicador` no está conectado (los eventos salen por el transporte real). */
  tiempoReal: boolean;
}

export interface OpcionesAppP4 {
  poolMax?: number;
  /** Habilita Socket.IO y no instala el publicador en memoria (el transporte real publica). */
  tiempoReal?: boolean;
  /** Reloj compartido (por ejemplo entre dos instancias). */
  reloj?: RelojManual;
  inicio?: string;
}

/**
 * Arranca la API real con `RelojManual`, `InventarioDePrueba` y `AlmacenEnMemoria`, sin `EMPRESA_POR_HEADER`, y la
 * deja escuchando en un puerto propio (admite peticiones concurrentes y clientes de Socket.IO). Sin
 * `tiempoReal` instala un `PublicadorEnMemoria`; con `tiempoReal` no instala ninguno.
 */
export async function arrancarP4(opciones: OpcionesAppP4 = {}): Promise<AppP4> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 2, empresaPorHeader: false });
  const reloj = opciones.reloj ?? new RelojManual(opciones.inicio ?? INICIO_POR_DEFECTO);
  const publicador = new PublicadorEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const inventario = new InventarioDePrueba();
  const tiempoReal = opciones.tiempoReal === true;
  const app = await crearAplicacion({
    reloj,
    logger: false,
    almacenArchivos: almacen,
    inventario,
    ...(tiempoReal
      ? { tiempoReal: { habilitado: true } }
      : { publicadorEventos: publicador, tiempoReal: { habilitado: false } }),
  });
  await app.listen(0, '127.0.0.1');
  return {
    app,
    reloj,
    publicador,
    almacen,
    inventario,
    tiempoReal,
    http: () => request(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}

// ------------------------------------------------------------------------------------------------
// Las tablas nuevas de 3a y los privilegios de `restaurante_api` ("Permisos" de `spec.md`)
// ------------------------------------------------------------------------------------------------

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
export type TablaSalon = (typeof TABLAS_SALON)[number];

export type Privilegio = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export const PRIVILEGIOS_SALON: Record<TablaSalon, Privilegio[]> = {
  zona: ['SELECT', 'INSERT', 'UPDATE'],
  mesa: ['SELECT', 'INSERT', 'UPDATE'],
  orden: ['SELECT', 'INSERT', 'UPDATE'],
  orden_mesa: ['SELECT', 'INSERT', 'UPDATE'],
  envio: ['SELECT', 'INSERT'],
  marcha: ['SELECT', 'INSERT'],
  item: ['SELECT', 'INSERT', 'UPDATE'],
  comanda: ['SELECT', 'INSERT', 'UPDATE'],
  comanda_linea: ['SELECT', 'INSERT', 'UPDATE'],
  anulacion_item: ['SELECT', 'INSERT'],
  precuenta: ['SELECT', 'INSERT', 'UPDATE'],
};

// ------------------------------------------------------------------------------------------------
// Siembra por SQL (como `restaurante_api` con el contexto y el actor fijados)
// ------------------------------------------------------------------------------------------------

/** Lo que la siembra por SQL necesita de una empresa dada de alta por la API. */
export interface BaseSql {
  empresaId: string;
  sucursal1: string;
  sucursal2: string;
  /** Un usuario de la empresa (el Administrador), para `orden.mozo_id`. */
  usuarioId: string;
  /** Una estación y un producto simple de la empresa (carta sembrada por las rutas de 003). */
  estacionId: string;
  productoId: string;
}

/** Ids de las filas sembradas, una por tabla (más una segunda mesa libre). */
export interface FilasSalon {
  zona: string;
  mesa: string;
  mesaLibre: string;
  orden: string;
  ordenMesa: string;
  envio: string;
  item: string;
  comanda: string;
  comandaLinea: string;
  marcha: string;
  anulacion: string;
  precuenta: string;
}

const HUELLA = "decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')";

/**
 * Siembra, con el contexto y el actor de la empresa, una fila como mínimo en cada una de las once tablas nuevas.
 * La orden está abierta en `mesa`, tiene un envío con un ítem de 2 unidades (1 anulada), una comanda de la
 * estación con su línea, una marcha, una anulación y una pre-cuenta vigente.
 */
export async function sembrarFilasSalon(apiCliente: Client, base: BaseSql): Promise<FilasSalon> {
  const f: FilasSalon = {
    zona: randomUUID(),
    mesa: randomUUID(),
    mesaLibre: randomUUID(),
    orden: randomUUID(),
    ordenMesa: randomUUID(),
    envio: randomUUID(),
    item: randomUUID(),
    comanda: randomUUID(),
    comandaLinea: randomUUID(),
    marcha: randomUUID(),
    anulacion: randomUUID(),
    precuenta: randomUUID(),
  };
  const E = base.empresaId;
  const q = (sql: string, parametros: unknown[]) => apiCliente.query(sql, parametros);
  await enTransaccion(
    apiCliente,
    E,
    async () => {
      await q(
        `INSERT INTO zona (id, empresa_id, sucursal_id, nombre, orden, columnas, filas, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 1, 4, 3, true, now(), now())`,
        [f.zona, E, base.sucursal1, unico('Zona')],
      );
      for (const [id, nombre, columna] of [
        [f.mesa, unico('M'), 1],
        [f.mesaLibre, unico('M'), 2],
      ] as const) {
        await q(
          `INSERT INTO mesa (id, empresa_id, sucursal_id, zona_id, nombre, capacidad, forma, columna, fila, activa,
                             creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, 4, 'CUADRADA', $6, 1, true, now(), now())`,
          [id, E, base.sucursal1, f.zona, nombre, columna],
        );
      }
      await q(
        `INSERT INTO orden (id, empresa_id, sucursal_id, tipo, canal, estado, mozo_id, comensales, abierta_en,
                            anulada_en, motivo_anulacion, sin_consumo, unida_a_orden_id, cerrada_en, version,
                            creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'MESA', 'SALON', 'EN_PRECUENTA', $4, 2, now(), NULL, NULL, false, NULL, NULL, 1,
                 now(), now())`,
        [f.orden, E, base.sucursal1, base.usuarioId],
      );
      await q(
        `INSERT INTO orden_mesa (id, empresa_id, orden_id, mesa_id, desde, hasta, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, now(), NULL, now(), now())`,
        [f.ordenMesa, E, f.orden, f.mesa],
      );
      await q(
        `INSERT INTO envio (id, empresa_id, orden_id, numero, es_adicion, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, false, ${HUELLA}, now(), now())`,
        [f.envio, E, f.orden],
      );
      await q(
        `INSERT INTO item (id, empresa_id, orden_id, envio_id, producto_id, nombre, tipo_producto, cantidad,
                           cantidad_anulada, precio_unitario, total, afectacion_igv, aplica_icbper, linea,
                           observacion, tiempo, para_llevar, es_adicion, marchado_en, estado, posicion,
                           creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'Lomo saltado', 'SIMPLE', 2, 1, '25.00', '50.00', 'GRAVADO', false,
                 $6::jsonb, NULL, 2, false, false, now(), 'ENVIADO', 1, now(), now())`,
        [f.item, E, f.orden, f.envio, base.productoId, JSON.stringify({ nombre: 'Lomo saltado' })],
      );
      await q(
        `INSERT INTO comanda (id, empresa_id, sucursal_id, orden_id, estacion_id, envio_id, tipo, destino, origen_id,
                              vista_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, 'COMANDA', 'KDS', NULL, NULL, now(), now())`,
        [f.comanda, E, base.sucursal1, f.orden, base.estacionId, f.envio],
      );
      await q(
        `INSERT INTO comanda_linea (id, empresa_id, comanda_id, item_id, rol, producto_id, nombre, contexto,
                                    cantidad_por_item, modificadores, observacion, tiempo, para_llevar, esperar,
                                    estado, estado_en, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, 'PRODUCTO', $5, 'Lomo saltado', NULL, 1, '[]'::jsonb, NULL, 2, false, false,
                 'ENVIADO', now(), now(), now())`,
        [f.comandaLinea, E, f.comanda, f.item, base.productoId],
      );
      await q(
        `INSERT INTO marcha (id, empresa_id, orden_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, ${HUELLA}, now(), now())`,
        [f.marcha, E, f.orden],
      );
      await q(
        `INSERT INTO anulacion_item (id, empresa_id, item_id, orden_id, cantidad, motivo, destino_stock,
                                     autorizado_por_id, autorizacion_id, de_orden, huella_entrada, creado_en,
                                     actualizado_en)
         VALUES ($1, $2, $3, $4, 1, 'Error de toma', 'VUELVE', NULL, NULL, false, ${HUELLA}, now(), now())`,
        [f.anulacion, E, f.item, f.orden],
      );
      await q(
        `INSERT INTO precuenta (id, empresa_id, orden_id, numero, lineas, total, emitida_en, invalidada_en,
                                version_orden, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, '[]'::jsonb, '25.00', now(), NULL, 1, now(), now())`,
        [f.precuenta, E, f.orden],
      );
    },
    { confirmar: true },
  );
  return f;
}

// ------------------------------------------------------------------------------------------------
// Lectura de la base (como administrador; solo para ver filas)
// ------------------------------------------------------------------------------------------------

/**
 * Foto de las tablas nuevas de una empresa. Una tabla que todavía no existe aparece como `'SIN_TABLA'`, así la
 * prueba compara antes y después y falla en lo que importa, no en la foto.
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
  const auditoria = await admin.query(
    `SELECT id, accion FROM auditoria WHERE empresa_id = $1 ORDER BY id::text`,
    [empresaId],
  );
  foto.auditoria = auditoria.rows;
  return foto;
}

/** Ids de las filas de una empresa en una tabla (que debe existir). */
export async function idsDe(admin: Client, tabla: string, empresaId: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`,
    [empresaId],
  );
  return rows.map((r) => r.id);
}

/**
 * Todos los ids (en minúsculas) de una empresa que puede ver una respuesta: ella misma, sus sucursales, usuarios,
 * tablas de la carta y tablas de 3a. Si `sucursalId` se pasa, solo las filas de 3a de esa sucursal (las demás
 * sucursales de la empresa quedan fuera).
 */
export async function idsDeEmpresaSalon(
  admin: Client,
  empresaId: string,
  sucursalId?: string,
): Promise<Set<string>> {
  const ids = new Set<string>([empresaId]);
  const tomar = async (sql: string, parametros: unknown[]) => {
    const { rows } = await admin.query<{ id: string }>(sql, parametros);
    for (const r of rows) ids.add(r.id.toLowerCase());
  };
  for (const tabla of [
    'sucursal',
    'usuario',
    'estacion',
    'familia',
    'producto',
    'grupo_modificadores',
    'modificador',
  ]) {
    await tomar(`SELECT id FROM ${tabla} WHERE empresa_id = $1`, [empresaId]);
  }
  const f = sucursalId === undefined ? '' : ' AND sucursal_id = $2';
  const p = sucursalId === undefined ? [empresaId] : [empresaId, sucursalId];
  await tomar(`SELECT id FROM zona WHERE empresa_id = $1${f}`, p);
  await tomar(`SELECT id FROM mesa WHERE empresa_id = $1${f}`, p);
  await tomar(`SELECT id FROM orden WHERE empresa_id = $1${f}`, p);
  await tomar(`SELECT id FROM comanda WHERE empresa_id = $1${f}`, p);
  const deOrdenes = sucursalId === undefined ? '' : ' AND orden_id IN (SELECT id FROM orden WHERE sucursal_id = $2)';
  for (const tabla of ['orden_mesa', 'envio', 'marcha', 'item', 'anulacion_item', 'precuenta']) {
    await tomar(`SELECT id FROM ${tabla} WHERE empresa_id = $1${deOrdenes}`, p);
  }
  await tomar(
    `SELECT l.id FROM comanda_linea l WHERE l.empresa_id = $1${
      sucursalId === undefined ? '' : ' AND l.comanda_id IN (SELECT id FROM comanda WHERE sucursal_id = $2)'
    }`,
    p,
  );
  return ids;
}

// ------------------------------------------------------------------------------------------------
// La carta de ejemplo de `spec.md`, creada por las rutas de 003
// ------------------------------------------------------------------------------------------------

export interface CartaEjemplo {
  familiaId: string;
  cocinaId: string;
  barraId: string;
  lomoId: string;
  comboId: string;
  gaseosaId: string;
  hamburguesaId: string;
  cervezaPilsenId: string;
  /** Modificadores del grupo Término del lomo. */
  termino: { jugoso: string; tresCuartos: string; bienCocido: string };
  /** Modificadores del grupo Extras del lomo. */
  extras: { huevo: string; platano: string; queso: string };
  /** Modificadores del grupo Bebida del combo. */
  bebida: { chicha: string; incaKola: string; cerveza: string };
  /** Modificadores del grupo Acompañamiento del combo. */
  acompanamiento: { papas: string; ensalada: string };
}

/**
 * Siembra, con el token del Administrador, la carta de ejemplo del encabezado de los criterios (sin el Menú del
 * día): estaciones Cocina y Barra, "Lomo saltado", "Combo hamburguesa" y "Gaseosa 1 L".
 */
export async function sembrarCartaEjemplo(ctx: AppCarta, token: string): Promise<CartaEjemplo> {
  const crear = async (ruta: string, cuerpo: unknown) => {
    const res = await llamar(ctx, token, { metodo: 'post', ruta, cuerpo });
    exigirEstado(res, 201, `POST ${ruta}`);
    return res.body as { id: string; modificadores?: { id: string; nombre: string }[] };
  };
  const cocina = await crear('/carta/estaciones', { nombre: 'Cocina' });
  const barra = await crear('/carta/estaciones', { nombre: 'Barra' });
  const familia = await crear('/carta/familias', { nombre: 'Platos y bebidas' });
  const ligado = (nombre: string, estacionId: string | null, control: string) =>
    crear('/carta/productos', {
      tipo: 'SIMPLE',
      nombre,
      familiaId: familia.id,
      seVendeSolo: false,
      ...(estacionId === null ? {} : { estacionId }),
      tipoControlStock: control,
    });
  const huevoFrito = await ligado('Huevo frito', cocina.id, 'UNIDADES');
  const platanoFrito = await ligado('Plátano frito', cocina.id, 'SIN_CONTROL');
  const hamburguesa = await ligado('Hamburguesa clásica', cocina.id, 'PORCIONES');
  const chichaMorada = await ligado('Chicha morada', barra.id, 'PORCIONES');
  const incaKola = await ligado('Inca Kola 500 ml', null, 'UNIDADES');
  const cervezaPilsen = await ligado('Cerveza Pilsen', barra.id, 'UNIDADES');
  const papasFritas = await ligado('Papas fritas', cocina.id, 'SIN_CONTROL');

  const idDe = (grupo: { modificadores?: { id: string; nombre: string }[] }, nombre: string) =>
    grupo.modificadores!.find((m) => m.nombre === nombre)!.id;
  const termino = await crear('/carta/grupos-modificadores', {
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      { nombre: 'Jugoso', precioExtra: '0.00' },
      { nombre: '3/4', precioExtra: '0.00' },
      { nombre: 'Bien cocido', precioExtra: '0.00' },
    ],
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
      { nombre: 'Inca Kola', precioExtra: '0.00', productoId: incaKola.id },
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
  const lomo = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    familiaId: familia.id,
    precio: '28.00',
    estacionId: cocina.id,
    tipoControlStock: 'SIN_CONTROL',
    gruposModificadores: [termino.id, extras.id],
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
  const gaseosa = await crear('/carta/productos', {
    tipo: 'SIMPLE',
    nombre: 'Gaseosa 1 L',
    familiaId: familia.id,
    precio: '9.00',
    tipoControlStock: 'UNIDADES',
  });
  return {
    familiaId: familia.id,
    cocinaId: cocina.id,
    barraId: barra.id,
    lomoId: lomo.id,
    comboId: combo.id,
    gaseosaId: gaseosa.id,
    hamburguesaId: hamburguesa.id,
    cervezaPilsenId: cervezaPilsen.id,
    termino: {
      jugoso: idDe(termino, 'Jugoso'),
      tresCuartos: idDe(termino, '3/4'),
      bienCocido: idDe(termino, 'Bien cocido'),
    },
    extras: {
      huevo: idDe(extras, 'Huevo'),
      platano: idDe(extras, 'Plátano'),
      queso: idDe(extras, 'Queso'),
    },
    bebida: {
      chicha: idDe(bebida, 'Chicha'),
      incaKola: idDe(bebida, 'Inca Kola'),
      cerveza: idDe(bebida, 'Cerveza'),
    },
    acompanamiento: {
      papas: idDe(acompanamiento, 'Papas'),
      ensalada: idDe(acompanamiento, 'Ensalada'),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Líneas de envío
// ------------------------------------------------------------------------------------------------

export interface LineaEnvio {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion?: string;
  tiempo?: 1 | 2;
  paraLlevar?: boolean;
}

/** "Lomo saltado" con el término y los extras elegidos (por defecto 3/4 y Huevo). */
export function lineaLomo(
  carta: CartaEjemplo,
  extra: Partial<LineaEnvio> & { termino?: string; extras?: string[] } = {},
): LineaEnvio {
  const { termino, extras, ...resto } = extra;
  return {
    productoId: carta.lomoId,
    modificadorIds: [termino ?? carta.termino.tresCuartos, ...(extras ?? [carta.extras.huevo])],
    cantidad: 1,
    ...resto,
  };
}

/** "Combo hamburguesa" con la bebida y el acompañamiento elegidos (por defecto Cerveza y Ensalada). */
export function lineaCombo(
  carta: CartaEjemplo,
  extra: Partial<LineaEnvio> & { bebida?: string; acompanamiento?: string } = {},
): LineaEnvio {
  const { bebida, acompanamiento, ...resto } = extra;
  return {
    productoId: carta.comboId,
    modificadorIds: [bebida ?? carta.bebida.cerveza, acompanamiento ?? carta.acompanamiento.ensalada],
    cantidad: 1,
    ...resto,
  };
}

export const lineaGaseosa = (carta: CartaEjemplo, extra: Partial<LineaEnvio> = {}): LineaEnvio => ({
  productoId: carta.gaseosaId,
  modificadorIds: [],
  cantidad: 1,
  ...extra,
});

// ------------------------------------------------------------------------------------------------
// El salón y las órdenes por HTTP
// ------------------------------------------------------------------------------------------------

export interface SalonSucursal {
  sucursalId: string;
  zonaId: string;
  mesas: { id: string; nombre: string }[];
}

/** Crea una zona de 4 × 3 con `cantidad` mesas en la sucursal (Administrador, sin sucursal activa). */
export async function sembrarSalon(
  ctx: AppCarta,
  tokenAdmin: string,
  sucursalId: string,
  etiqueta: string,
  cantidad: number,
): Promise<SalonSucursal> {
  const zona = await llamar(ctx, tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/zonas`,
    cuerpo: { nombre: `Zona ${etiqueta}`, columnas: 4, filas: 3 },
  });
  exigirEstado(zona, 201, 'crear la zona');
  const zonaId = zona.body.id as string;
  const mesas: { id: string; nombre: string }[] = [];
  for (let i = 0; i < cantidad; i++) {
    const nombre = `${etiqueta}-${i + 1}`;
    const res = await llamar(ctx, tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${sucursalId}/zonas/${zonaId}/mesas`,
      cuerpo: { nombre, capacidad: 4, forma: 'CUADRADA', columna: (i % 4) + 1, fila: Math.floor(i / 4) + 1 },
    });
    exigirEstado(res, 201, `crear la mesa ${nombre}`);
    mesas.push({ id: res.body.id as string, nombre });
  }
  return { sucursalId, zonaId, mesas };
}

export interface OpcionesLlamadaConClave {
  /** `Idempotency-Key` (por defecto una nueva). */
  clave?: string;
  cabeceras?: Record<string, string>;
}

/** `POST /ordenes` con `Idempotency-Key`. */
export function abrirOrden(
  ctx: AppCarta,
  token: string,
  cuerpo: { id?: string; mesaId: string; comensales?: number; mozoId?: string },
  opciones: OpcionesLlamadaConClave = {},
) {
  const id = cuerpo.id ?? randomUUID();
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: '/ordenes',
    cuerpo: { comensales: 2, ...cuerpo, id },
    cabeceras: { 'Idempotency-Key': opciones.clave ?? randomUUID(), ...opciones.cabeceras },
  }).then((res) => Object.assign(res, { idEnviado: id }));
}

/** `POST /ordenes/:id/envios` con `Idempotency-Key`. */
export function enviar(
  ctx: AppCarta,
  token: string,
  ordenId: string,
  lineas: LineaEnvio[],
  opciones: OpcionesLlamadaConClave & { id?: string } = {},
) {
  const id = opciones.id ?? randomUUID();
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/envios`,
    cuerpo: { id, lineas },
    cabeceras: { 'Idempotency-Key': opciones.clave ?? randomUUID(), ...opciones.cabeceras },
  }).then((res) => Object.assign(res, { idEnviado: id }));
}

/** `POST` con `Idempotency-Key` y cuerpo opcional. */
export function postConClave(
  ctx: AppCarta,
  token: string,
  ruta: string,
  cuerpo?: unknown,
  opciones: OpcionesLlamadaConClave = {},
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta,
    ...(cuerpo === undefined ? {} : { cuerpo }),
    cabeceras: { 'Idempotency-Key': opciones.clave ?? randomUUID(), ...opciones.cabeceras },
  });
}

// ------------------------------------------------------------------------------------------------
// El mundo de una empresa para las pruebas por HTTP
// ------------------------------------------------------------------------------------------------

export interface OrdenSembrada {
  id: string;
  mesaId: string;
  sucursalId: string;
  envioId: string;
  itemIds: string[];
  /** Ítem del "Lomo saltado" (tiempo 2) del primer envío. */
  itemLomoId: string;
  comandaIds: string[];
  lineaIds: string[];
  /** Solo en la orden principal. */
  marchaId?: string;
  anulacionId?: string;
  precuentaId?: string;
}

export interface MundoEmpresa {
  E: EmpresaCarta;
  carta: CartaEjemplo;
  etiqueta: string;
  salon1: SalonSucursal;
  salon2: SalonSucursal;
  /** Administrador sin sucursal activa. */
  tokenAdmin: string;
  /** Administrador con S1 activa. */
  tokenS1: string;
  /** Administrador con S2 activa. */
  tokenS2: string;
  /** Cocina/Barra con S1 activa. */
  tokenCocinaS1: string;
  /** Mesas de S1 sin orden (para aperturas y movimientos). */
  mesasLibres: { id: string; nombre: string }[];
  /** Orden con envío, marcha, anulación parcial y pre-cuenta (S1). */
  principal: OrdenSembrada;
  /** Orden con un envío sin marchar (S1). */
  segunda: OrdenSembrada;
  /** Orden con un envío en la otra sucursal (S2). */
  deS2: OrdenSembrada;
}

async function idsDeEnvio(
  admin: Client,
  empresaId: string,
  ordenId: string,
  envioId: string,
): Promise<Pick<OrdenSembrada, 'itemIds' | 'comandaIds' | 'lineaIds'>> {
  const items = await admin.query<{ id: string }>(
    `SELECT id FROM item WHERE empresa_id = $1 AND orden_id = $2 AND envio_id = $3 ORDER BY posicion, id`,
    [empresaId, ordenId, envioId],
  );
  const comandas = await admin.query<{ id: string }>(
    `SELECT id FROM comanda WHERE empresa_id = $1 AND orden_id = $2 ORDER BY creado_en, id`,
    [empresaId, ordenId],
  );
  const lineas = await admin.query<{ id: string }>(
    `SELECT l.id FROM comanda_linea l JOIN comanda c ON c.id = l.comanda_id AND c.empresa_id = l.empresa_id
      WHERE l.empresa_id = $1 AND c.orden_id = $2 ORDER BY l.creado_en, l.id`,
    [empresaId, ordenId],
  );
  return {
    itemIds: items.rows.map((r) => r.id),
    comandaIds: comandas.rows.map((r) => r.id),
    lineaIds: lineas.rows.map((r) => r.id),
  };
}

/** Abre la mesa, envía un pedido con lomo (tiempo 2), combo y gaseosa, y devuelve los ids. */
async function sembrarOrden(
  ctx: AppCarta,
  admin: Client,
  token: string,
  mundo: Pick<MundoEmpresa, 'E' | 'carta'>,
  sucursalId: string,
  mesaId: string,
): Promise<OrdenSembrada> {
  const apertura = await abrirOrden(ctx, token, { mesaId, comensales: 3 });
  exigirEstado(apertura, 201, 'abrir la mesa');
  const ordenId = apertura.body.id as string;
  const envio = await enviar(ctx, token, ordenId, [
    lineaCombo(mundo.carta, { cantidad: 2 }),
    lineaLomo(mundo.carta, { cantidad: 2, tiempo: 2 }),
    lineaGaseosa(mundo.carta),
  ]);
  exigirEstado(envio, 201, 'enviar la comanda');
  const itemLomoId = (envio.body.items as { id: string; productoId: string }[]).find(
    (i) => i.productoId === mundo.carta.lomoId,
  )!.id;
  const ids = await idsDeEnvio(admin, mundo.E.empresaId, ordenId, envio.idEnviado);
  return { id: ordenId, mesaId, sucursalId, envioId: envio.idEnviado, itemLomoId, ...ids };
}

/**
 * Deja una empresa lista: carta de ejemplo, un salón por sucursal (S1 con 6 mesas, S2 con 2), tres órdenes con
 * su envío y, en la principal, una marcha, una anulación parcial y una pre-cuenta. Todo por las rutas de la
 * tabla de endpoints, con el Administrador (que anula y marcha sin clave).
 */
export async function construirMundo(
  ctx: AppCarta,
  admin: Client,
  E: EmpresaCarta,
  etiqueta: string,
): Promise<MundoEmpresa> {
  const tokenAdmin = E.tokenAdmin;
  const carta = await sembrarCartaEjemplo(ctx, tokenAdmin);
  const salon1 = await sembrarSalon(ctx, tokenAdmin, E.S1, `${etiqueta}1`, 6);
  const salon2 = await sembrarSalon(ctx, tokenAdmin, E.S2, `${etiqueta}2`, 2);
  const tokenS1 = await sesionContrasena(ctx, E.base.admin, E.S1);
  const tokenS2 = await sesionContrasena(ctx, E.base.admin, E.S2);
  const tokenCocinaS1 = await sesionContrasena(ctx, E.cocina, E.S1);
  const parcial = { E, carta };

  const principal = await sembrarOrden(ctx, admin, tokenS1, parcial, E.S1, salon1.mesas[0]!.id);
  const marchaId = randomUUID();
  const marcha = await postConClave(ctx, tokenS1, `/ordenes/${principal.id}/marchas`, { id: marchaId });
  exigirEstado(marcha, 201, 'marchar el segundo tiempo');
  const anulacionId = randomUUID();
  const anulacion = await postConClave(
    ctx,
    tokenS1,
    `/ordenes/${principal.id}/items/${principal.itemLomoId}/anulaciones`,
    { id: anulacionId, cantidad: 1, motivo: 'Error de toma', destinoStock: 'VUELVE' },
  );
  exigirEstado(anulacion, 201, 'anular una unidad del lomo');
  const precuentaId = randomUUID();
  const precuenta = await postConClave(ctx, tokenS1, `/ordenes/${principal.id}/precuentas`, {
    id: precuentaId,
  });
  exigirEstado(precuenta, 201, 'pedir la pre-cuenta');
  const refrescadas = await idsDeEnvio(admin, E.empresaId, principal.id, principal.envioId);

  const segunda = await sembrarOrden(ctx, admin, tokenS1, parcial, E.S1, salon1.mesas[1]!.id);
  const deS2 = await sembrarOrden(ctx, admin, tokenS2, parcial, E.S2, salon2.mesas[0]!.id);
  return {
    E,
    carta,
    etiqueta,
    salon1,
    salon2,
    tokenAdmin,
    tokenS1,
    tokenS2,
    tokenCocinaS1,
    mesasLibres: salon1.mesas.slice(2),
    principal: { ...principal, ...refrescadas, marchaId, anulacionId, precuentaId },
    segunda,
    deS2,
  };
}
