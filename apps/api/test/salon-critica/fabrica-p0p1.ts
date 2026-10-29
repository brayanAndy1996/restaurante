// spec: 004-salon-cocina (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P0 (inactividad de Cocina/Barra) y P1 (montos) de la historia 004. Solo
// usan contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, las
// empresas dadas de alta con `POST /plataforma/empresas`, los usuarios creados con `POST /usuarios`, las
// rutas de `/carta` de 003 y las rutas de zonas, mesas y órdenes de la tabla de endpoints de `spec.md`. Para
// leer filas usan un cliente administrador (solo lectura). No leen la implementación de la historia.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { expect } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { PublicadorEnMemoria } from '../../src/nucleo/eventos';
import { RelojManual } from '../../src/nucleo/reloj';
import {
  altaEmpresa,
  consultar,
  crearPersona,
  crearSuperadminDePrueba,
  elegirSucursal,
  ingresarSuperadmin,
  INSTANTE_INICIAL,
  llamar,
  loginContrasena,
  tokenAdmin,
  type Empresa,
  type Libre,
  type Persona,
  type Superadmin,
} from '../acceso/fabrica-equipos';
import { InventarioDePrueba } from '../soporte';
import { fijarEntornoDePrueba } from '../utilidades';

export { INSTANTE_INICIAL, MINUTO } from '../acceso/fabrica-equipos';

export const HORA = 60 * 60_000;

// ---------------------------------------------------------------------------------------------
// La aplicación
// ---------------------------------------------------------------------------------------------

export interface EntornoSalon {
  app: INestApplication;
  reloj: RelojManual;
  publicador: PublicadorEnMemoria;
  inventario: InventarioDePrueba;
  cerrar(): Promise<void>;
}

/**
 * Arranca la API real con un `RelojManual`, un `PublicadorEnMemoria` y un `InventarioDePrueba`, sin
 * `EMPRESA_POR_HEADER`, y la deja escuchando en un puerto propio (admite peticiones concurrentes y clientes de
 * Socket.IO cuando `tiempoReal` está habilitado).
 */
export async function crearEntornoSalon(
  opciones: { tiempoReal?: boolean; poolMax?: number } = {},
): Promise<EntornoSalon> {
  fijarEntornoDePrueba({ poolMax: opciones.poolMax ?? 2, empresaPorHeader: false });
  const reloj = new RelojManual(INSTANTE_INICIAL);
  const publicador = new PublicadorEnMemoria();
  const inventario = new InventarioDePrueba();
  const app = await crearAplicacion({
    reloj,
    logger: false,
    publicadorEventos: publicador,
    inventario,
    tiempoReal: { habilitado: opciones.tiempoReal ?? false },
  });
  try {
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return { app, reloj, publicador, inventario, cerrar: () => app.close() };
}

// ---------------------------------------------------------------------------------------------
// Utilidades de comprobación
// ---------------------------------------------------------------------------------------------

/** Exige un estado y, si no llega, falla con lo que respondió la API (así se ve qué falta). */
export function exigir(res: { status: number; text: string }, estado: number, que: string): void {
  if (res.status !== estado) {
    throw new Error(`${que}: se esperaba ${estado} y llegó ${res.status} ${res.text}`);
  }
}

/** Comprueba estado y código de error (`{ codigo, mensaje, campos? }`) sin detalles de PostgreSQL. */
export function esperarErrorDe(
  res: { status: number; body: Libre; text: string },
  estado: number,
  codigo: string,
): void {
  expect(res.status, `${res.status} ${res.text}`).toBe(estado);
  expect(res.body).toMatchObject({ codigo });
  expect(typeof res.body.mensaje).toBe('string');
  expect(res.text).not.toMatch(
    /SQLSTATE|violates|duplicate key|syntax error|relation "|pg_catalog|restaurante_(api|plataforma|migrador)|at Object\./i,
  );
}

/** Instante del reloj más `ms`, en milisegundos desde 1970. */
export const enMs = (reloj: RelojManual, ms = 0): number => reloj.ahora().getTime() + ms;

// ---------------------------------------------------------------------------------------------
// Empresas y personas
// ---------------------------------------------------------------------------------------------

export interface EmpresasDePrueba {
  sa: Superadmin;
  tokenSa: string;
  A: Empresa;
  B: Empresa;
}

/** El superadministrador y las empresas A (con `sucursalesA` sucursales) y B (con `sucursalesB`). */
export async function crearEmpresas(
  entorno: Pick<EntornoSalon, 'app'>,
  sucursalesA: number,
  sucursalesB = 2,
): Promise<EmpresasDePrueba> {
  const sa = await crearSuperadminDePrueba();
  const tokenSa = await ingresarSuperadmin(entorno.app, sa);
  const A = await altaEmpresa(entorno.app, tokenSa, { sucursales: sucursalesA });
  const B = await altaEmpresa(entorno.app, tokenSa, { sucursales: sucursalesB });
  return { sa, tokenSa, A, B };
}

export type RolPrueba = 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR';

/** Una persona con un solo rol en una sucursal. */
export function personaConRol(
  entorno: Pick<EntornoSalon, 'app'>,
  empresa: Empresa,
  rol: RolPrueba,
  sucursalId: string,
): Promise<Persona> {
  return crearPersona(entorno.app, empresa, { accesos: [{ sucursalId, rol }] });
}

/** Sesión de contraseña de la persona con esa sucursal activa (la elige si no es la única). */
export async function sesionConSucursal(
  entorno: Pick<EntornoSalon, 'app'>,
  persona: Persona,
  sucursalId: string,
): Promise<string> {
  const { token, sesion } = await loginContrasena(entorno.app, persona);
  if (sesion.sucursal?.id !== sucursalId) {
    const res = await elegirSucursal(entorno.app, token, sucursalId);
    exigir(res, 200, 'Elegir la sucursal activa');
  }
  return token;
}

/** Sesión de contraseña del Administrador de la empresa con esa sucursal activa. */
export async function sesionAdminEn(
  entorno: Pick<EntornoSalon, 'app'>,
  empresa: Empresa,
  sucursalId: string,
): Promise<string> {
  const token = await tokenAdmin(entorno.app, empresa);
  const res = await elegirSucursal(entorno.app, token, sucursalId);
  exigir(res, 200, 'Elegir la sucursal activa del Administrador');
  return token;
}

// ---------------------------------------------------------------------------------------------
// La carta de ejemplo de `spec.md`, armada con las rutas de 003
// ---------------------------------------------------------------------------------------------

export interface CartaDeEjemplo {
  estacionCocinaId: string;
  estacionBarraId: string;
  lomo: { id: string; tresCuartos: string; huevo: string; platano: string };
  combo: { id: string; cerveza: string; ensalada: string };
  menu: { id: string; sopa: string; lomoDelMenu: string };
  gaseosa: { id: string };
  /** Productos sencillos para probar montos: `{ id }` de cada uno. */
  joya: { id: string };
  tesoro: { id: string };
  caramelo: { id: string };
  moneda: { id: string };
  chicle: { id: string };
  bocadito: { id: string };
  bolsa: { id: string };
}

async function crearEnCarta(
  app: INestApplication,
  token: string,
  ruta: string,
  cuerpo: unknown,
): Promise<Libre> {
  const res = await llamar(app, 'post', ruta, { token, cuerpo });
  exigir(res, 201, `POST ${ruta} (carta de 003)`);
  return res.body as Libre;
}

/**
 * Crea en la empresa la carta de ejemplo de la especificación (Lomo saltado, Combo hamburguesa, Menú del día
 * armado hoy en la sucursal activa del token y Gaseosa) y unos productos de precio extremo para los montos.
 * El token es el del Administrador con la sucursal activa elegida.
 */
export async function sembrarCartaDeEjemplo(
  app: INestApplication,
  tokenAdminConSucursal: string,
): Promise<CartaDeEjemplo> {
  const t = tokenAdminConSucursal;
  const cocina = await crearEnCarta(app, t, '/carta/estaciones', { nombre: 'Cocina' });
  const barra = await crearEnCarta(app, t, '/carta/estaciones', { nombre: 'Barra' });
  const familia = await crearEnCarta(app, t, '/carta/familias', { nombre: 'Platos' });
  const producto = (cuerpo: Record<string, unknown>) =>
    crearEnCarta(app, t, '/carta/productos', { familiaId: familia.id, ...cuerpo });
  /** Producto simple que no se vende solo (componente u opción ligada). */
  const auxiliar = (nombre: string, estacionId: string | null, tipoControlStock: string) =>
    producto({ tipo: 'SIMPLE', nombre, seVendeSolo: false, estacionId, tipoControlStock });
  const grupo = (cuerpo: Record<string, unknown>) =>
    crearEnCarta(app, t, '/carta/grupos-modificadores', cuerpo);
  const m = (nombre: string, precioExtra = '0.00', productoId: string | null = null) => ({
    nombre,
    precioExtra,
    productoId,
  });
  const idDe = (g: Libre, nombre: string): string => {
    const encontrado = (g.modificadores as Libre[]).find((x) => x.nombre === nombre);
    if (!encontrado) throw new Error(`El grupo ${g.nombre} no tiene el modificador ${nombre}`);
    return encontrado.id as string;
  };

  // Lomo saltado: Término (única, obligatoria) y Extras (múltiple, 0 a 2).
  const huevoFrito = await auxiliar('Huevo frito', cocina.id, 'UNIDADES');
  const platanoFrito = await auxiliar('Plátano frito', cocina.id, 'SIN_CONTROL');
  const termino = await grupo({
    nombre: 'Término',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Jugoso'), m('3/4'), m('Bien cocido')],
  });
  const extras = await grupo({
    nombre: 'Extras',
    seleccion: 'MULTIPLE',
    minimo: 0,
    maximo: 2,
    modificadores: [
      m('Huevo', '2.50', huevoFrito.id),
      m('Plátano', '3.00', platanoFrito.id),
      m('Queso', '2.00'),
    ],
  });
  const lomo = await producto({
    tipo: 'SIMPLE',
    nombre: 'Lomo saltado',
    precio: '28.00',
    estacionId: cocina.id,
    tipoControlStock: 'SIN_CONTROL',
    gruposModificadores: [termino.id, extras.id],
  });

  // Combo hamburguesa.
  const hamburguesa = await auxiliar('Hamburguesa clásica', cocina.id, 'PORCIONES');
  const chichaMorada = await auxiliar('Chicha morada', barra.id, 'PORCIONES');
  const incaKola = await auxiliar('Inca Kola 500 ml', null, 'UNIDADES');
  const cerveza = await auxiliar('Cerveza Pilsen', barra.id, 'UNIDADES');
  const papasFritas = await auxiliar('Papas fritas', cocina.id, 'SIN_CONTROL');
  const bebida = await grupo({
    nombre: 'Bebida',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      m('Chicha', '0.00', chichaMorada.id),
      m('Inca Kola', '0.00', incaKola.id),
      m('Cerveza', '4.50', cerveza.id),
    ],
  });
  const acompanamiento = await grupo({
    nombre: 'Acompañamiento',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Papas', '0.00', papasFritas.id), m('Ensalada', '1.00')],
  });
  const combo = await producto({
    tipo: 'COMBO',
    nombre: 'Combo hamburguesa',
    precio: '22.90',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [{ productoId: hamburguesa.id, cantidad: 1 }],
    gruposModificadores: [bebida.id, acompanamiento.id],
  });

  // Menú del día.
  const refresco = await auxiliar('Refresco del día', barra.id, 'PORCIONES');
  const sopaDeCasa = await auxiliar('Sopa de casa', cocina.id, 'PORCIONES');
  const ajiDeGallina = await auxiliar('Ají de gallina', cocina.id, 'PORCIONES');
  const entrada = await grupo({
    nombre: 'Entrada',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [m('Sopa', '0.00', sopaDeCasa.id)],
  });
  const segundo = await grupo({
    nombre: 'Segundo',
    seleccion: 'UNICA',
    obligatorio: true,
    modificadores: [
      m('Ají de gallina', '0.00', ajiDeGallina.id),
      m('Lomo saltado', '5.00', lomo.id),
    ],
  });
  const menu = await producto({
    tipo: 'MENU_DEL_DIA',
    nombre: 'Menú del día',
    precio: '12.00',
    tipoControlStock: 'PORCIONES',
    componentes: [{ productoId: refresco.id, cantidad: 1 }],
    gruposModificadores: [entrada.id, segundo.id],
  });
  const opciones = [
    idDe(entrada, 'Sopa'),
    idDe(segundo, 'Ají de gallina'),
    idDe(segundo, 'Lomo saltado'),
  ];
  const armar = await llamar(app, 'put', `/carta/sucursal/menu-del-dia/${menu.id}`, {
    token: t,
    cuerpo: { opciones },
  });
  exigir(armar, 200, 'Armar el menú del día (carta de 003)');

  // La gaseosa y los productos de precio extremo para los montos.
  const gaseosa = await producto({
    tipo: 'SIMPLE',
    nombre: 'Gaseosa 1 L',
    precio: '9.00',
    estacionId: null,
    tipoControlStock: 'UNIDADES',
  });
  const sencillo = (nombre: string, precio: string, extra: Record<string, unknown> = {}) =>
    producto({
      tipo: 'SIMPLE',
      nombre,
      precio,
      estacionId: cocina.id,
      tipoControlStock: 'SIN_CONTROL',
      ...extra,
    });
  const joya = await sencillo('Joya', '99999999.00');
  const tesoro = await sencillo('Tesoro', '99999999.99');
  const caramelo = await sencillo('Caramelo', '0.99');
  const moneda = await sencillo('Moneda', '1.00');
  const chicle = await sencillo('Chicle', '0.10');
  const bocadito = await sencillo('Bocadito', '19.99');
  const bolsa = await producto({
    tipo: 'SIMPLE',
    nombre: 'Bolsa plástica',
    precio: '0.50',
    estacionId: null,
    tipoControlStock: 'SIN_CONTROL',
    aplicaIcbper: true,
  });

  return {
    estacionCocinaId: cocina.id,
    estacionBarraId: barra.id,
    lomo: {
      id: lomo.id,
      tresCuartos: idDe(termino, '3/4'),
      huevo: idDe(extras, 'Huevo'),
      platano: idDe(extras, 'Plátano'),
    },
    combo: {
      id: combo.id,
      cerveza: idDe(bebida, 'Cerveza'),
      ensalada: idDe(acompanamiento, 'Ensalada'),
    },
    menu: { id: menu.id, sopa: idDe(entrada, 'Sopa'), lomoDelMenu: idDe(segundo, 'Lomo saltado') },
    gaseosa: { id: gaseosa.id },
    joya: { id: joya.id },
    tesoro: { id: tesoro.id },
    caramelo: { id: caramelo.id },
    moneda: { id: moneda.id },
    chicle: { id: chicle.id },
    bocadito: { id: bocadito.id },
    bolsa: { id: bolsa.id },
  };
}

// ---------------------------------------------------------------------------------------------
// Zonas, mesas, órdenes y envíos (rutas de la tabla de endpoints de 3a)
// ---------------------------------------------------------------------------------------------

export interface LineaDeEnvio {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion?: string;
  tiempo?: 1 | 2;
  paraLlevar?: boolean;
}

/** Una línea de un producto sin modificadores. */
export const lineaSimple = (productoId: string, cantidad = 1): LineaDeEnvio => ({
  productoId,
  modificadorIds: [],
  cantidad,
});

/** Las tres líneas de la orden de ejemplo del criterio 76 (suma `169.20`). */
export function lineasDelEjemplo(carta: CartaDeEjemplo): LineaDeEnvio[] {
  return [
    {
      productoId: carta.lomo.id,
      modificadorIds: [carta.lomo.tresCuartos, carta.lomo.huevo, carta.lomo.platano],
      cantidad: 2,
    },
    {
      productoId: carta.combo.id,
      modificadorIds: [carta.combo.cerveza, carta.combo.ensalada],
      cantidad: 3,
    },
    {
      productoId: carta.menu.id,
      modificadorIds: [carta.menu.sopa, carta.menu.lomoDelMenu],
      cantidad: 1,
    },
  ];
}

/** Zona con una cuadrícula grande y un generador de mesas nuevas (una celda cada una). */
export async function crearZona(
  app: INestApplication,
  tokenAdminDeLaEmpresa: string,
  sucursalId: string,
): Promise<{ zonaId: string; nuevaMesa: () => Promise<string> }> {
  const zona = await llamar(app, 'post', `/sucursales/${sucursalId}/zonas`, {
    token: tokenAdminDeLaEmpresa,
    cuerpo: { nombre: `Salón ${randomUUID().slice(0, 8)}`, columnas: 12, filas: 30 },
  });
  exigir(zona, 201, 'Crear la zona (004, criterio 1)');
  let siguiente = 0;
  return {
    zonaId: zona.body.id as string,
    nuevaMesa: async () => {
      const n = siguiente++;
      const mesa = await llamar(
        app,
        'post',
        `/sucursales/${sucursalId}/zonas/${zona.body.id as string}/mesas`,
        {
          token: tokenAdminDeLaEmpresa,
          cuerpo: {
            nombre: `M${n + 1}`,
            capacidad: 4,
            forma: 'CUADRADA',
            columna: (n % 12) + 1,
            fila: Math.floor(n / 12) + 1,
          },
        },
      );
      exigir(mesa, 201, 'Crear la mesa (004, criterio 3)');
      return mesa.body.id as string;
    },
  };
}

/** `POST /ordenes` (abre la mesa) con una clave de idempotencia nueva; devuelve la respuesta cruda. */
export function abrirOrdenCruda(
  app: INestApplication,
  token: string,
  mesaId: string,
  extra: { id?: string; clave?: string; comensales?: number } = {},
): Promise<request.Response> {
  return llamar(app, 'post', '/ordenes', {
    token,
    cabeceras: { 'Idempotency-Key': extra.clave ?? randomUUID() },
    cuerpo: { id: extra.id ?? randomUUID(), mesaId, comensales: extra.comensales ?? 2 },
  });
}

/** Abre la mesa y devuelve el id de la orden (exige 201). */
export async function abrirOrden(
  app: INestApplication,
  token: string,
  mesaId: string,
): Promise<string> {
  const res = await abrirOrdenCruda(app, token, mesaId);
  exigir(res, 201, 'Abrir la mesa (004, criterio 9)');
  return res.body.id as string;
}

/** `POST /ordenes/:id/envios` con ids y clave nuevos (o los dados); devuelve la respuesta cruda. */
export function enviarCrudo(
  app: INestApplication,
  token: string,
  ordenId: string,
  lineas: LineaDeEnvio[],
  extra: { id?: string; clave?: string } = {},
): Promise<request.Response> {
  return llamar(app, 'post', `/ordenes/${ordenId}/envios`, {
    token,
    cabeceras: { 'Idempotency-Key': extra.clave ?? randomUUID() },
    cuerpo: { id: extra.id ?? randomUUID(), lineas },
  });
}

/** Envía y exige 201. */
export async function enviar(
  app: INestApplication,
  token: string,
  ordenId: string,
  lineas: LineaDeEnvio[],
  extra: { id?: string; clave?: string } = {},
): Promise<Libre> {
  const res = await enviarCrudo(app, token, ordenId, lineas, extra);
  exigir(res, 201, 'Enviar la comanda (004, criterio 15)');
  return res.body as Libre;
}

/** `GET /ordenes/:id` (exige 200). */
export async function verOrden(
  app: INestApplication,
  token: string,
  ordenId: string,
): Promise<Libre> {
  const res = await llamar(app, 'get', `/ordenes/${ordenId}`, { token });
  exigir(res, 200, 'Consultar la orden (004, criterio 55)');
  return res.body as Libre;
}

/** `POST /ordenes/:id/precuentas` con ids y clave nuevos; devuelve la respuesta cruda. */
export function pedirPrecuenta(
  app: INestApplication,
  token: string,
  ordenId: string,
  extra: { id?: string; clave?: string } = {},
): Promise<request.Response> {
  return llamar(app, 'post', `/ordenes/${ordenId}/precuentas`, {
    token,
    cabeceras: { 'Idempotency-Key': extra.clave ?? randomUUID() },
    cuerpo: { id: extra.id ?? randomUUID() },
  });
}

/** `POST /ordenes/:id/items/:itemId/anulaciones` con ids y clave nuevos; devuelve la respuesta cruda. */
export function anularItemCrudo(
  app: INestApplication,
  token: string,
  ordenId: string,
  itemId: string,
  cuerpo: { cantidad: number; motivo?: string; destinoStock?: 'VUELVE' | 'MERMA' },
): Promise<request.Response> {
  return llamar(app, 'post', `/ordenes/${ordenId}/items/${itemId}/anulaciones`, {
    token,
    cabeceras: { 'Idempotency-Key': randomUUID() },
    cuerpo: {
      id: randomUUID(),
      cantidad: cuerpo.cantidad,
      motivo: cuerpo.motivo ?? 'Prueba de montos',
      destinoStock: cuerpo.destinoStock ?? 'VUELVE',
    },
  });
}

/** Cuántas filas tienen estas tablas de pedidos para la orden (para comprobar que no se guardó nada). */
export async function filasDeLaOrden(ordenId: string): Promise<{
  envios: number;
  items: number;
  comandas: number;
}> {
  const [envios] = await consultar<{ n: string }>(
    'SELECT count(*)::text AS n FROM envio WHERE orden_id = $1',
    [ordenId],
  );
  const [items] = await consultar<{ n: string }>(
    'SELECT count(*)::text AS n FROM item WHERE orden_id = $1',
    [ordenId],
  );
  const [comandas] = await consultar<{ n: string }>(
    'SELECT count(*)::text AS n FROM comanda WHERE orden_id = $1',
    [ordenId],
  );
  return {
    envios: Number(envios?.n ?? 0),
    items: Number(items?.n ?? 0),
    comandas: Number(comandas?.n ?? 0),
  };
}

/** Todas las claves (a cualquier profundidad) de un valor JSON, en minúsculas. */
export function clavesDe(valor: unknown, acumulado: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) {
    for (const elemento of valor) clavesDe(elemento, acumulado);
  } else if (valor !== null && typeof valor === 'object') {
    for (const [clave, interno] of Object.entries(valor)) {
      acumulado.add(clave.toLowerCase());
      clavesDe(interno, acumulado);
    }
  }
  return acumulado;
}
