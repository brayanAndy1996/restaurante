// spec: 005-carta-web-mesa (pruebas protegidas)
//
// Ayudantes de las pruebas protegidas P2 (llamados) y P3 (paso a la cuenta) de la historia 005. Solo usan
// contratos públicos: la API real con `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, las empresas
// dadas de alta con `POST /plataforma/empresas`, los usuarios creados con `POST /usuarios`, la carta de ejemplo
// de 004 creada por las rutas de `/carta` de 003, las mesas creadas por las rutas de zonas y mesas, la carta web
// y los QR configurados por sus rutas (`PUT /carta-web…`, `GET /sucursales/:id/qr-mesas`) y las rutas de la tabla
// de endpoints de `spec.md` (`/publico/*` y `/llamados`). Para leer filas usan un cliente administrador (solo
// lectura). No leen la implementación de la historia.
//
// Todo lo que depende de la funcionalidad nueva (publicar la carta, obtener el código de una mesa) se hace de
// forma perezosa en `publicarCartas` y `mesasConCodigo`, así cada prueba falla por su propio motivo y no en el
// `beforeAll` de todo el archivo.
import {
  llamadoPublicoSchema,
  qrMesasRespuestaSchema,
  type LlamadoPublico,
  type QrMesasRespuesta,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { ClientePublico } from '../soporte';
import {
  abrirOrden,
  arrancarP2,
  asentar,
  clave,
  conEventos,
  crearEnCarta,
  eventosPublicados,
  exigirEstado,
  lineasDe,
  llamar,
  nombreUnico,
  prepararEscenarioP2,
  sesionContrasena,
  simpleNuevo,
  SalonDePrueba,
  type AppP2,
  type EscenarioP2,
  type LineaCuerpo,
  type Res,
} from '../salon-critica/fabrica-p2';

export {
  abrirOrden,
  asentar,
  clave,
  conEventos,
  crearEnCarta,
  eventosPublicados,
  exigirEstado,
  lineasDe,
  llamar,
  nombreUnico,
  SalonDePrueba,
};
export { ClientePublico };
export type { LineaCuerpo, LlamadoPublico, Res };
export { esperarError, INICIO_POR_DEFECTO } from '../salon-critica/fabrica-p2';

export const SEGUNDO = 1_000;
export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;

/** Lunes 2 de noviembre de 2026, 14:00 en Lima: dentro del horario de servicio de S1 (12:00 a 23:00). */
export const HORA_DE_SERVICIO = '2026-11-02T14:00:00-05:00';
/** El mismo lunes a las 10:00 (S1 todavía no abre) y a las 23:30 (S1 ya cerró). */
export const ANTES_DE_ABRIR = '2026-11-02T10:00:00-05:00';
export const DESPUES_DE_CERRAR = '2026-11-02T23:30:00-05:00';

export const TODOS_LOS_DIAS = (desde: string, hasta: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, desde, hasta }));
/** El horario de S1 del criterio "Datos de ejemplo": lunes a domingo de 12:00 a 23:00. */
export const HORARIO_DE_SERVICIO = TODOS_LOS_DIAS('12:00', '23:00');
/** Un horario que NO contiene las 14:00 del lunes (abre a las 20:00). */
export const HORARIO_DE_NOCHE = TODOS_LOS_DIAS('20:00', '23:00');

export const MENSAJE_NO_DISPONIBLE = 'La carta no está disponible';

// ------------------------------------------------------------------------------------------------
// La aplicación y el escenario
// ------------------------------------------------------------------------------------------------

export type AppLlamados = AppP2;

/**
 * Arranca la API real con el reloj en una hora de servicio (las sesiones de contraseña se abren a esa hora y
 * duran 30 minutos sin actividad: las pruebas que adelantan el reloj más de 25 minutos seguidos llaman antes a
 * `renovarSesiones`).
 */
export function arrancarLlamados(opciones: { poolMax?: number } = {}): Promise<AppLlamados> {
  return arrancarP2({ poolMax: opciones.poolMax ?? 5, inicio: HORA_DE_SERVICIO });
}

export type Lugar = 'S1' | 'S2' | 'B1';

export interface EscenarioLlamados extends EscenarioP2 {
  /** Direcciones (slugs) de la carta web: únicas por ejecución para no chocar con otras pruebas. */
  slugs: {
    empresaA: string;
    empresaB: string;
    sucursalS1: string;
    sucursalS2: string;
    sucursalB1: string;
  };
  /** `true` cuando la carta web de A y de B ya se configuró y se publicó (ver `publicarCartas`). */
  publicado: boolean;
}

export async function prepararEscenarioLlamados(ctx: AppLlamados): Promise<EscenarioLlamados> {
  const base = await prepararEscenarioP2(ctx);
  const sufijo = randomUUID().replace(/-/g, '').slice(0, 10);
  return {
    ...base,
    slugs: {
      empresaA: `sabor-${sufijo}`,
      empresaB: `norte-${sufijo}`,
      sucursalS1: 'miraflores',
      sucursalS2: 'surco',
      sucursalB1: 'barranco',
    },
    publicado: false,
  };
}

/**
 * Abre sesiones nuevas de todas las personas del escenario (con la misma sucursal activa que tenían). Se llama
 * después de adelantar el reloj mucho tiempo, porque una sesión de contraseña caduca a los 30 minutos sin uso.
 */
export async function renovarSesiones(ctx: AppLlamados, esc: EscenarioLlamados): Promise<void> {
  const { A, B } = esc.e;
  esc.token.adminA = await sesionContrasena(ctx, A.base.admin, null);
  esc.token.adminS1 = await sesionContrasena(ctx, A.base.admin, A.S1);
  esc.token.mozo = await sesionContrasena(ctx, A.mozo, A.S1);
  esc.token.mozo2 = await sesionContrasena(ctx, esc.mozo2, A.S1);
  esc.token.cocina = await sesionContrasena(ctx, A.cocina, A.S1);
  esc.token.supervisor = await sesionContrasena(ctx, A.supervisor, A.S1);
  esc.token.cajero = await sesionContrasena(ctx, A.cajero, A.S1);
  esc.token.mozoS2 = await sesionContrasena(ctx, A.cajero, A.S2);
  esc.token.adminS1B = await sesionContrasena(ctx, B.base.admin, B.S1);
  esc.e.A.tokenAdmin = esc.token.adminA;
  esc.e.B.tokenAdmin = await sesionContrasena(ctx, B.base.admin, null);
}

/** Nombre con el que las respuestas muestran a una persona del escenario. */
export const nombreDe = (persona: { respuesta: Record<string, unknown> }): string =>
  persona.respuesta.nombre as string;

// ------------------------------------------------------------------------------------------------
// La carta web y las mesas con su código
// ------------------------------------------------------------------------------------------------

async function ponerOk(
  ctx: AppLlamados,
  token: string,
  ruta: string,
  cuerpo: unknown,
  que: string,
): Promise<void> {
  const res = await llamar(ctx, token, { metodo: 'put', ruta, cuerpo });
  exigirEstado(res, 200, que);
}

/** `PATCH /sucursales/:id` con un horario (Administrador). `[]` deja la sucursal sin horario. */
export async function ponerHorario(
  ctx: AppLlamados,
  token: string,
  sucursalId: string,
  horario: { dia: number; desde: string; hasta: string }[],
): Promise<void> {
  const res = await llamar(ctx, token, {
    metodo: 'patch',
    ruta: `/sucursales/${sucursalId}`,
    cuerpo: { horario },
  });
  exigirEstado(res, 200, 'poner el horario de la sucursal (002)');
}

/**
 * Configura y publica la carta web de A (S1 `miraflores` con horario de 12:00 a 23:00 y S2 `surco` sin horario) y
 * la de B (S1 `barranco`, sin horario), por sus rutas (criterios 2 y 4). Es perezosa: la primera llamada
 * configura y las demás no hacen nada; si falla, no se recuerda y la siguiente prueba vuelve a intentarlo.
 */
export async function publicarCartas(ctx: AppLlamados, esc: EscenarioLlamados): Promise<void> {
  if (esc.publicado) return;
  const { A, B } = esc.e;
  await ponerOk(
    ctx,
    A.tokenAdmin,
    '/carta-web',
    { nombre: 'Sabor Norteño', slug: esc.slugs.empresaA, colorPrincipal: '#B3261E' },
    'configurar la carta web de A (005, criterio 2)',
  );
  await ponerOk(
    ctx,
    A.tokenAdmin,
    `/carta-web/sucursales/${A.S1}`,
    { slug: esc.slugs.sucursalS1, publicada: true },
    'publicar S1 de A (005, criterio 4)',
  );
  await ponerOk(
    ctx,
    A.tokenAdmin,
    `/carta-web/sucursales/${A.S2}`,
    { slug: esc.slugs.sucursalS2, publicada: true },
    'publicar S2 de A (005, criterio 4)',
  );
  await ponerHorario(ctx, A.tokenAdmin, A.S1, HORARIO_DE_SERVICIO);
  await ponerOk(
    ctx,
    B.tokenAdmin,
    '/carta-web',
    { nombre: 'Norte Chico', slug: esc.slugs.empresaB, colorPrincipal: '#1D4A9E' },
    'configurar la carta web de B (005, criterio 2)',
  );
  await ponerOk(
    ctx,
    B.tokenAdmin,
    `/carta-web/sucursales/${B.S1}`,
    { slug: esc.slugs.sucursalB1, publicada: true },
    'publicar S1 de B (005, criterio 4)',
  );
  esc.publicado = true;
}

export interface MesaLlamados {
  id: string;
  nombre: string;
  codigo: string;
  lugar: Lugar;
  sucursalId: string;
  empresaId: string;
}

function dondeEs(esc: EscenarioLlamados, lugar: Lugar) {
  switch (lugar) {
    case 'S1':
      return {
        salon: esc.salon,
        tokenAdmin: esc.e.A.tokenAdmin,
        sucursalId: esc.e.A.S1,
        empresaId: esc.e.A.empresaId,
      };
    case 'S2':
      return {
        salon: esc.salonS2,
        tokenAdmin: esc.e.A.tokenAdmin,
        sucursalId: esc.e.A.S2,
        empresaId: esc.e.A.empresaId,
      };
    case 'B1':
      return {
        salon: esc.salonB,
        tokenAdmin: esc.e.B.tokenAdmin,
        sucursalId: esc.e.B.S1,
        empresaId: esc.e.B.empresaId,
      };
  }
}

/** `GET /sucursales/:sucursalId/qr-mesas` (criterio 7) con el Administrador de la empresa de ese lugar. */
export function hojaDeQr(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  lugar: Lugar = 'S1',
): Promise<Res> {
  const d = dondeEs(esc, lugar);
  return llamar(ctx, d.tokenAdmin, { metodo: 'get', ruta: `/sucursales/${d.sucursalId}/qr-mesas` });
}

/** La hoja de QR ya validada con el contrato `qrMesasRespuesta` (exige 200). */
export async function leerHoja(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  lugar: Lugar = 'S1',
): Promise<QrMesasRespuesta> {
  const res = await hojaDeQr(ctx, esc, lugar);
  exigirEstado(res, 200, 'la hoja de QR de la sucursal (005, criterio 7)');
  return qrMesasRespuestaSchema.parse(res.body);
}

/**
 * Crea `cantidad` mesas nuevas, activas y libres en el lugar (por las rutas de 004) y devuelve cada una con su
 * código, leído de la hoja de QR. Publica antes la carta web de A y de B. Las mesas se crean con el token del
 * Administrador de la apertura del escenario: hay que crearlas antes de adelantar el reloj más de 25 minutos.
 */
export async function mesasConCodigo(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  cantidad: number,
  lugar: Lugar = 'S1',
): Promise<MesaLlamados[]> {
  await publicarCartas(ctx, esc);
  const d = dondeEs(esc, lugar);
  const ids: string[] = [];
  for (let i = 0; i < cantidad; i += 1) ids.push(await d.salon.mesaNueva());
  const res = await hojaDeQr(ctx, esc, lugar);
  exigirEstado(res, 200, 'la hoja de QR de la sucursal (005, criterio 7)');
  const filas = res.body.mesas as { mesaId: string; nombre: string; codigo: string | null }[];
  return ids.map((id) => {
    const fila = filas.find((f) => f.mesaId === id);
    if (!fila || fila.codigo === null) {
      throw new Error(
        `La mesa ${id} no tiene código en la hoja de QR (005, criterio 6): ${JSON.stringify(fila)}`,
      );
    }
    return {
      id,
      nombre: fila.nombre,
      codigo: fila.codigo,
      lugar,
      sucursalId: d.sucursalId,
      empresaId: d.empresaId,
    };
  });
}

export async function mesaConCodigo(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  lugar: Lugar = 'S1',
): Promise<MesaLlamados> {
  const [mesa] = await mesasConCodigo(ctx, esc, 1, lugar);
  return mesa!;
}

/** Desactiva o reactiva una mesa (004, criterio 4) con el Administrador de la empresa de ese lugar. */
export async function ponerActiva(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  mesa: MesaLlamados,
  activa: boolean,
): Promise<void> {
  const d = dondeEs(esc, mesa.lugar);
  const res = await llamar(ctx, d.tokenAdmin, {
    metodo: 'patch',
    ruta: `/sucursales/${mesa.sucursalId}/mesas/${mesa.id}`,
    cuerpo: { activa },
  });
  exigirEstado(res, 200, activa ? 'reactivar la mesa' : 'desactivar la mesa');
}

// ------------------------------------------------------------------------------------------------
// El cliente: rutas públicas
// ------------------------------------------------------------------------------------------------

/** Un cliente sin sesión con su propia IP (cada instancia, una distinta). */
export const clienteNuevo = (ctx: AppLlamados): ClientePublico => new ClientePublico(ctx.app);

export const rutaDeMesa = (codigo: string): string => `/publico/mesas/${codigo}`;
export const rutaDeLlamados = (codigo: string): string => `/publico/mesas/${codigo}/llamados`;

export interface CuerpoPedido {
  id: string;
  tipo: 'PEDIDO';
  lineas: LineaCuerpo[];
  nota?: string;
}
export interface CuerpoAviso {
  id: string;
  tipo: 'LLAMAR_MOZO' | 'PEDIR_CUENTA';
}
export type CuerpoLlamado = CuerpoPedido | CuerpoAviso;

export function cuerpoPedido(
  lineas: LineaCuerpo[],
  extra: { id?: string; nota?: string } = {},
): CuerpoPedido {
  return {
    id: extra.id ?? randomUUID(),
    tipo: 'PEDIDO',
    lineas,
    ...(extra.nota !== undefined ? { nota: extra.nota } : {}),
  };
}
export const cuerpoLlamarMozo = (id: string = randomUUID()): CuerpoAviso => ({
  id,
  tipo: 'LLAMAR_MOZO',
});
export const cuerpoPedirCuenta = (id: string = randomUUID()): CuerpoAviso => ({
  id,
  tipo: 'PEDIR_CUENTA',
});

/** `POST /publico/mesas/:codigo/llamados`. */
export function enviarLlamado(cliente: ClientePublico, codigo: string, cuerpo: unknown) {
  return cliente.post(rutaDeLlamados(codigo), cuerpo);
}

/** Envía y exige 201; devuelve el cuerpo ya validado con el esquema estricto `llamadoPublico` (criterio 21). */
export async function crearOk(
  cliente: ClientePublico,
  codigo: string,
  cuerpo: unknown,
): Promise<LlamadoPublico> {
  const res = await enviarLlamado(cliente, codigo, cuerpo);
  exigirEstado(res, 201, 'crear un llamado (005, criterio 26)');
  return llamadoPublicoSchema.parse(res.body);
}

/** `GET /publico/mesas/:codigo`. */
export const verMesa = (cliente: ClientePublico, codigo: string) => cliente.get(rutaDeMesa(codigo));

/** `GET /publico/mesas/:codigo/llamados/:id`. */
export const verEstado = (cliente: ClientePublico, codigo: string, id: string) =>
  cliente.get(`${rutaDeLlamados(codigo)}/${id}`);

export interface LlamadoCreado {
  mesa: MesaLlamados;
  cliente: ClientePublico;
  id: string;
  cuerpo: CuerpoLlamado;
  respuesta: LlamadoPublico;
}

/** Crea un llamado en la mesa con un cliente nuevo (o el dado). */
export async function crearLlamado(
  ctx: AppLlamados,
  mesa: MesaLlamados,
  cuerpo: CuerpoLlamado,
  cliente: ClientePublico = clienteNuevo(ctx),
): Promise<LlamadoCreado> {
  const respuesta = await crearOk(cliente, mesa.codigo, cuerpo);
  return { mesa, cliente, id: cuerpo.id, cuerpo, respuesta };
}

/** El pedido de ejemplo: Lomo [3/4, Huevo] × 2 (S/ 61.00) y Gaseosa × 1 (S/ 9.00): total `70.00`. */
export function lineasDelPedido(esc: EscenarioLlamados): LineaCuerpo[] {
  const L = lineasDe(esc.carta);
  return [L.lomo(['3/4', 'Huevo'], 2), L.gaseosa(1)];
}

// ------------------------------------------------------------------------------------------------
// El mozo: rutas de la PWA
// ------------------------------------------------------------------------------------------------

export const listaDeLlamados = (
  ctx: AppLlamados,
  token: string,
  cabeceras?: Record<string, string>,
) => llamar(ctx, token, { metodo: 'get', ruta: '/llamados', ...(cabeceras ? { cabeceras } : {}) });

export const detalleDeLlamado = (ctx: AppLlamados, token: string, id: string) =>
  llamar(ctx, token, { metodo: 'get', ruta: `/llamados/${id}` });

/** `POST /llamados/:id/atencion` con una clave nueva (o la dada). */
export function atenderLlamado(
  ctx: AppLlamados,
  token: string,
  id: string,
  cuerpo: unknown = {},
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/llamados/${id}/atencion`,
    cuerpo,
    cabeceras: clave(k),
  });
}

/** `POST /llamados/:id/paso-a-cuenta` con una clave nueva (o la dada). */
export function pasarLlamado(
  ctx: AppLlamados,
  token: string,
  id: string,
  cuerpo: unknown,
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/llamados/${id}/paso-a-cuenta`,
    cuerpo,
    cabeceras: clave(k),
  });
}

/** `POST /llamados/:id/descarte` con una clave nueva (o la dada). */
export function descartarLlamado(
  ctx: AppLlamados,
  token: string,
  id: string,
  cuerpo: unknown = {},
  k: string = randomUUID(),
) {
  return llamar(ctx, token, {
    metodo: 'post',
    ruta: `/llamados/${id}/descarte`,
    cuerpo,
    cabeceras: clave(k),
  });
}

/** El cuerpo para atender una mesa libre: abre la orden con ese id y esos comensales. */
export const abriendo = (comensales = 2, ordenId: string = randomUUID()) => ({
  ordenId,
  comensales,
});

/** Atiende abriendo la mesa (si estaba libre) y exige 200; devuelve el cuerpo y el id de la orden que se pidió. */
export async function atenderOk(
  ctx: AppLlamados,
  token: string,
  id: string,
  cuerpo: unknown = abriendo(),
): Promise<Res> {
  const res = await atenderLlamado(ctx, token, id, cuerpo);
  exigirEstado(res, 200, 'atender el llamado (005, criterio 41)');
  return res;
}

/** Descarta y exige 200. */
export async function descartarOk(
  ctx: AppLlamados,
  token: string,
  id: string,
  cuerpo: unknown = {},
): Promise<Res> {
  const res = await descartarLlamado(ctx, token, id, cuerpo);
  exigirEstado(res, 200, 'descartar el llamado (005, criterio 53)');
  return res;
}

/** Pasa a la cuenta y exige 200. */
export async function pasarOk(
  ctx: AppLlamados,
  token: string,
  id: string,
  lineas: { posicion: number; cantidad: number }[],
): Promise<Res> {
  const res = await pasarLlamado(ctx, token, id, { lineas });
  exigirEstado(res, 200, 'pasar el llamado a la cuenta (005, criterio 46)');
  return res;
}

export interface MesaDelMapa {
  id: string;
  estado: 'LIBRE' | 'OCUPADA' | 'EN_PRECUENTA';
  orden: {
    id: string;
    mozo: { id: string; nombre: string };
    comensales: number;
    total: string;
    mesas: { id: string; nombre: string }[];
  } | null;
}

/** `GET /salon` y la mesa dada tal como la ve el mapa de la sucursal activa del token. */
export async function mesaEnElMapa(
  ctx: AppLlamados,
  token: string,
  mesaId: string,
): Promise<MesaDelMapa> {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/salon' });
  exigirEstado(res, 200, 'GET /salon');
  const zonas = res.body.zonas as { mesas: MesaDelMapa[] }[];
  const mesa = zonas.flatMap((z) => z.mesas).find((m) => m.id === mesaId);
  if (!mesa) throw new Error(`La mesa ${mesaId} no aparece en GET /salon`);
  return mesa;
}

/** Abre una mesa con 004 (el mozo del token es el responsable salvo que se pase `mozoId`). */
export async function abrirMesa(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  mesa: MesaLlamados,
  token: string,
  opciones: { comensales?: number; mozoId?: string } = {},
): Promise<string> {
  const o = await abrirOrden(ctx, dondeEs(esc, mesa.lugar).salon, token, {
    mesaId: mesa.id,
    ...(opciones.comensales !== undefined ? { comensales: opciones.comensales } : {}),
    ...(opciones.mozoId !== undefined ? { mozoId: opciones.mozoId } : {}),
  });
  return o.id;
}

// ------------------------------------------------------------------------------------------------
// Eventos y registros que no deben crecer
// ------------------------------------------------------------------------------------------------

/** Deja pasar los efectos de después de confirmar y borra los eventos y las llamadas al inventario anotados. */
export async function limpiarRegistros(ctx: AppLlamados): Promise<void> {
  await asentar();
  ctx.publicador.limpiar();
  ctx.inventario.limpiar();
}

/** Los eventos `llamado.*` publicados hasta ahora (después de dejar pasar los efectos). */
export async function eventosDeLlamado(
  ctx: AppLlamados,
  nombre?: 'llamado.nuevo' | 'llamado.cambio',
) {
  const todos = await eventosPublicados(ctx);
  return todos.filter((e) => (nombre ? e.nombre === nombre : e.nombre.startsWith('llamado.')));
}

/** Los nombres de los eventos publicados que tocan a cocina, al salón o a la orden (no deben salir). */
export async function eventosDePedidos(ctx: AppLlamados): Promise<string[]> {
  const todos = await eventosPublicados(ctx);
  return todos
    .map((e) => e.nombre)
    .filter((n) => n.startsWith('cocina.') || n === 'salon.cambio' || n === 'orden.cambio');
}

// ------------------------------------------------------------------------------------------------
// Inspección de la base (como administrador; solo para leer filas)
// ------------------------------------------------------------------------------------------------

export interface FilaLlamado {
  id: string;
  empresa_id: string;
  sucursal_id: string;
  mesa_id: string;
  tipo: string;
  estado: string;
  lineas: unknown;
  nota: string | null;
  total: string | null;
  huella_ip: Buffer | null;
  vence_en: Date;
  destinatario_mozo_id: string | null;
  orden_id: string | null;
  atendido_por_usuario_id: string | null;
  atendido_por_equipo_id: string | null;
  atendido_en: Date | null;
  cerrado_por_usuario_id: string | null;
  cerrado_por_equipo_id: string | null;
  cerrado_en: Date | null;
  motivo_descarte: string | null;
  lineas_pasadas: unknown;
  vencido_en: Date | null;
  creado_en: Date;
  creado_por_usuario_id: string | null;
  creado_por_sistema: string | null;
  texto: string;
}

export async function filaLlamado(
  admin: Client,
  empresaId: string,
  id: string,
): Promise<FilaLlamado | undefined> {
  const { rows } = await admin.query<FilaLlamado>(
    `SELECT l.*, row_to_json(l)::text AS texto FROM llamado l WHERE l.empresa_id = $1 AND l.id = $2`,
    [empresaId, id],
  );
  return rows[0];
}

export async function llamadosDeLaMesa(admin: Client, mesaId: string): Promise<FilaLlamado[]> {
  const { rows } = await admin.query<FilaLlamado>(
    `SELECT l.*, row_to_json(l)::text AS texto FROM llamado l WHERE l.mesa_id = $1 ORDER BY l.creado_en, l.id`,
    [mesaId],
  );
  return rows;
}

export async function contarLlamados(admin: Client, empresaId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM llamado WHERE empresa_id = $1`,
    [empresaId],
  );
  return rows[0]!.n;
}

/** Cuántas filas de `llamado` tiene una mesa. */
export async function contarLlamadosDeMesa(admin: Client, mesaId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM llamado WHERE mesa_id = $1`,
    [mesaId],
  );
  return rows[0]!.n;
}

export interface ConteoDePedidos {
  ordenes: number;
  envios: number;
  items: number;
  comandas: number;
  lineas: number;
  trabajosDeImpresion: number;
}

/** Cuántas filas de órdenes, envíos, ítems, comandas, líneas y trabajos de impresión tiene la empresa. */
export async function conteoDePedidos(admin: Client, empresaId: string): Promise<ConteoDePedidos> {
  const { rows } = await admin.query<ConteoDePedidos>(
    `SELECT
       (SELECT count(*)::int FROM orden WHERE empresa_id = $1) AS ordenes,
       (SELECT count(*)::int FROM envio WHERE empresa_id = $1) AS envios,
       (SELECT count(*)::int FROM item WHERE empresa_id = $1) AS items,
       (SELECT count(*)::int FROM comanda WHERE empresa_id = $1) AS comandas,
       (SELECT count(*)::int FROM comanda_linea WHERE empresa_id = $1) AS lineas,
       (SELECT count(*)::int FROM trabajo_impresion WHERE empresa_id = $1) AS "trabajosDeImpresion"`,
    [empresaId],
  );
  return rows[0]!;
}

/** Las órdenes vigentes (ABIERTA o EN_PRECUENTA) de una mesa: debe haber una o ninguna. */
export async function ordenesAbiertasDeLaMesa(admin: Client, mesaId: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT o.id FROM orden o
       JOIN orden_mesa om ON om.orden_id = o.id AND om.empresa_id = o.empresa_id
      WHERE om.mesa_id = $1 AND om.hasta IS NULL AND o.estado IN ('ABIERTA', 'EN_PRECUENTA')
      ORDER BY o.id`,
    [mesaId],
  );
  return rows.map((r) => r.id);
}

export async function versionDeLaOrden(admin: Client, ordenId: string): Promise<number> {
  const { rows } = await admin.query<{ version: number }>(
    `SELECT version FROM orden WHERE id = $1`,
    [ordenId],
  );
  return rows[0]!.version;
}

// ------------------------------------------------------------------------------------------------
// Productos propios de una prueba (para cambiar la carta sin tocar la carta de ejemplo)
// ------------------------------------------------------------------------------------------------

/** Un producto simple nuevo de `precio` en S1 y en el resto de las sucursales, que se vende solo. */
export async function productoPropio(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  precio = '10.00',
): Promise<{ id: string; nombre: string; precio: string }> {
  const nombre = nombreUnico('Plato de prueba');
  const creado = await crearEnCarta(
    ctx,
    esc.e.A.tokenAdmin,
    '/carta/productos',
    simpleNuevo(esc.carta, { nombre, precio }),
  );
  return { id: creado.id, nombre, precio };
}

/** `PATCH /carta/productos/:id` con el Administrador (exige 200). */
export async function cambiarProducto(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  id: string,
  cambios: Record<string, unknown>,
): Promise<void> {
  const res = await llamar(ctx, esc.e.A.tokenAdmin, {
    metodo: 'patch',
    ruta: `/carta/productos/${id}`,
    cuerpo: cambios,
  });
  exigirEstado(res, 200, 'cambiar el producto (003)');
}

/** Una línea de `cantidad` unidades del producto, sin modificadores. */
export const lineaDe = (productoId: string, cantidad = 1, observacion?: string): LineaCuerpo => ({
  productoId,
  modificadorIds: [],
  cantidad,
  ...(observacion !== undefined ? { observacion } : {}),
});

/** Todas las claves (a cualquier profundidad) de un valor JSON. */
export function clavesEn(valor: unknown, acumulado: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) {
    for (const x of valor) clavesEn(x, acumulado);
  } else if (valor !== null && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.add(k);
      clavesEn(v, acumulado);
    }
  }
  return acumulado;
}

/** Texto de un cuerpo con los ids dados reemplazados, para comparar errores de dos casos distintos. */
export function sinIds(res: Res, ids: string[]): unknown {
  let texto = JSON.stringify(res.body);
  for (const id of ids) texto = texto.split(id).join('<id>');
  return JSON.parse(texto);
}

// ------------------------------------------------------------------------------------------------
// Comprobaciones comunes
// ------------------------------------------------------------------------------------------------

/** La URL base de la carta web de las pruebas (la que fija `fijarEntornoDePrueba`). */
export const URL_CARTA = 'http://localhost:3001';

/** El mismo 404 de todo lo que no se ve (criterio 14): estado, código y mensaje fijos. */
export function esperarNoDisponible(res: { status: number; body: unknown; text: string }): void {
  if (
    res.status !== 404 ||
    JSON.stringify(res.body) !==
      JSON.stringify({ codigo: 'NO_ENCONTRADO', mensaje: MENSAJE_NO_DISPONIBLE })
  ) {
    throw new Error(
      `Se esperaba el 404 "${MENSAJE_NO_DISPONIBLE}" y llegó ${res.status} ${res.text}`,
    );
  }
}

/** `POST /sucursales/:sucursalId/mesas/:mesaId/qr` con una clave nueva (o la dada); sin clave si es `null`. */
export function cambiarQr(
  ctx: AppLlamados,
  esc: EscenarioLlamados,
  mesa: Pick<MesaLlamados, 'id' | 'lugar' | 'sucursalId'>,
  k: string | null = randomUUID(),
  sucursalId: string = mesa.sucursalId,
) {
  const d = dondeEs(esc, mesa.lugar);
  return llamar(ctx, d.tokenAdmin, {
    metodo: 'post',
    ruta: `/sucursales/${sucursalId}/mesas/${mesa.id}/qr`,
    ...(k === null ? {} : { cabeceras: clave(k) }),
  });
}
