// spec: 004-salon-cocina (pruebas protegidas)
//
// P4 (parte 2) · Aislamiento entre empresas de 3a por HTTP (ruta crítica), criterios 85 y 86:
// - 85: en toda ruta de 3a, un id de B en la ruta responde 404 y, en el cuerpo, 422 (`REFERENCIA_INVALIDA`,
//   `PRODUCTO_NO_VENDIBLE` o `SELECCION_INVALIDA`) o el 400/404 que fije su criterio, con el mismo cuerpo que
//   un id inexistente y sin cambiar nada de B ni de A; `GET /salon`, `GET /ordenes/:id` y
//   `GET /cocina/comandas` solo traen datos de A y de la sucursal activa (también con `ETag`); los ids de
//   cliente (`id` de orden, envío, marcha, anulación y pre-cuenta) son únicos por empresa: el mismo id usado
//   en B crea su propia fila y nunca devuelve la de A;
// - 86: con un pool de 2 conexiones, 100 peticiones concurrentes alternando A y B a `GET /salon`,
//   `POST /ordenes/:id/envios` y `GET /cocina/comandas` devuelven y cambian solo datos de su empresa, y cada
//   evento publicado lleva la empresa y la sala de su empresa (el reparto por Socket.IO lo prueba
//   `tiempo-real-aislamiento.spec.ts`).
// Hoy las rutas de 3a responden 500 "No implementado" y no existen las tablas: las pruebas fallan por eso.
// Las empresas se dan de alta por la API real, con la carta de ejemplo de `spec.md` creada por las rutas de
// 003, el salón y las órdenes por las rutas de 3a, y un cliente administrador de PostgreSQL solo para leer.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { crearEscenarioCarta, type Llamada } from '../carta-critica/fabrica-permisos-carta';
import {
  abrirOrden,
  arrancarP4,
  asentar,
  construirMundo,
  enviar,
  exigirEstado,
  exigirSinFallos,
  idsDeEmpresaSalon,
  instantaneaSalon,
  lineaGaseosa,
  lineaLomo,
  llamar,
  postConClave,
  uuidsEn,
  type AppP4,
  type MundoEmpresa,
} from './fabrica-p4';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP4;
let admin: Client;

interface Mundo {
  A: MundoEmpresa;
  B: MundoEmpresa;
}

let mundoPendiente: Promise<Mundo> | undefined;
function mundo(): Promise<Mundo> {
  mundoPendiente ??= (async () => {
    const e = await crearEscenarioCarta(ctx);
    const A = await construirMundo(ctx, admin, e.A, `a${randomUUID().slice(0, 5)}`);
    const B = await construirMundo(ctx, admin, e.B, `b${randomUUID().slice(0, 5)}`);
    return { A, B };
  })();
  return mundoPendiente;
}

/**
 * Un mundo aparte (otras dos empresas) para los casos de ids de cliente repetidos: esos casos crean a propósito, en
 * B, órdenes con los mismos ids que las de A, y no deben contaminar el mundo compartido (donde cada id existe en una
 * sola empresa y el criterio 86 lo comprueba).
 */
let mundoAparte: Promise<Mundo> | undefined;
function mundoDeIdsRepetidos(): Promise<Mundo> {
  mundoAparte ??= (async () => {
    const e = await crearEscenarioCarta(ctx);
    const A = await construirMundo(ctx, admin, e.A, `a${randomUUID().slice(0, 5)}`);
    const B = await construirMundo(ctx, admin, e.B, `b${randomUUID().slice(0, 5)}`);
    return { A, B };
  })();
  return mundoAparte;
}

beforeAll(async () => {
  ctx = await arrancarP4({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** Foto de todo lo que una petición rechazada no debe cambiar: las tablas de las dos empresas y su auditoría. */
async function foto(m: Mundo) {
  return {
    A: await instantaneaSalon(admin, m.A.E.empresaId),
    B: await instantaneaSalon(admin, m.B.E.empresaId),
  };
}

const cuerpoDe = (res: { body: unknown }) => JSON.stringify(res.body);
const codigoDe = (res: { body: unknown }) => (res.body as { codigo?: string } | undefined)?.codigo;

// ------------------------------------------------------------------------------------------------
// 85 · Un id de otra empresa (o de otra sucursal) en la ruta o en el cuerpo
// ------------------------------------------------------------------------------------------------

/** Los ids ajenos que un caso reemplaza: los de B, los de S2 de A, o inexistentes. */
interface Ajenos {
  sucursal: string;
  zona: string;
  mesa: string;
  orden: string;
  item: string;
  comanda: string;
  linea: string;
}

type Sesion = 'config' | 'S1';

interface CasoDeRuta {
  nombre: string;
  sesion: Sesion;
  /** También se prueba con los ids de la otra sucursal de A (S2), con la misma respuesta que un inexistente. */
  tambienS2?: boolean;
  construir: (m: Mundo, ids: Ajenos) => Llamada;
}

const unaClave = () => ({ 'Idempotency-Key': randomUUID() });

const casosDeRuta = (): CasoDeRuta[] => [
  {
    nombre: 'GET /sucursales/:sucursalId/zonas',
    sesion: 'config',
    construir: (_m, ids) => ({ metodo: 'get', ruta: `/sucursales/${ids.sucursal}/zonas` }),
  },
  {
    nombre: 'POST /sucursales/:sucursalId/zonas',
    sesion: 'config',
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${ids.sucursal}/zonas`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 8)}`, columnas: 4, filas: 3 },
    }),
  },
  {
    nombre: 'PATCH /sucursales/:sucursalId/zonas/:id (sucursal ajena)',
    sesion: 'config',
    construir: (m, ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${ids.sucursal}/zonas/${m.A.salon1.zonaId}`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 8)}` },
    }),
  },
  {
    nombre: 'PATCH /sucursales/:sucursalId/zonas/:id (zona ajena)',
    sesion: 'config',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${m.A.E.S1}/zonas/${ids.zona}`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 8)}` },
    }),
  },
  {
    nombre: 'PUT /sucursales/:sucursalId/zonas/orden (sucursal ajena)',
    sesion: 'config',
    construir: (_m, ids) => ({
      metodo: 'put',
      ruta: `/sucursales/${ids.sucursal}/zonas/orden`,
      cuerpo: { ids: [] },
    }),
  },
  {
    nombre: 'POST /sucursales/:sucursalId/zonas/:zonaId/mesas (sucursal ajena)',
    sesion: 'config',
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${ids.sucursal}/zonas/${m.A.salon1.zonaId}/mesas`,
      cuerpo: {
        nombre: `X${randomUUID().slice(0, 6)}`,
        capacidad: 4,
        forma: 'REDONDA',
        columna: 4,
        fila: 3,
      },
    }),
  },
  {
    nombre: 'POST /sucursales/:sucursalId/zonas/:zonaId/mesas (zona ajena)',
    sesion: 'config',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/sucursales/${m.A.E.S1}/zonas/${ids.zona}/mesas`,
      cuerpo: {
        nombre: `X${randomUUID().slice(0, 6)}`,
        capacidad: 4,
        forma: 'REDONDA',
        columna: 4,
        fila: 3,
      },
    }),
  },
  {
    nombre: 'PATCH /sucursales/:sucursalId/mesas/:id (sucursal ajena)',
    sesion: 'config',
    construir: (m, ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${ids.sucursal}/mesas/${m.A.salon1.mesas[5]!.id}`,
      cuerpo: { capacidad: 6 },
    }),
  },
  {
    nombre: 'PATCH /sucursales/:sucursalId/mesas/:id (mesa ajena)',
    sesion: 'config',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'patch',
      ruta: `/sucursales/${m.A.E.S1}/mesas/${ids.mesa}`,
      cuerpo: { capacidad: 6 },
    }),
  },
  {
    nombre: 'POST /ordenes (mesa ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: '/ordenes',
      cuerpo: { id: randomUUID(), mesaId: ids.mesa, comensales: 2 },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'GET /ordenes/:id',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({ metodo: 'get', ruta: `/ordenes/${ids.orden}` }),
  },
  {
    nombre: 'PATCH /ordenes/:id',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'patch',
      ruta: `/ordenes/${ids.orden}`,
      cuerpo: { comensales: 5 },
    }),
  },
  {
    nombre: 'POST /ordenes/:id/envios',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/envios`,
      cuerpo: { id: randomUUID(), lineas: [lineaLomo(m.A.carta)] },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/marchas',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/marchas`,
      cuerpo: { id: randomUUID() },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/precuentas',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/precuentas`,
      cuerpo: { id: randomUUID() },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/movimiento (orden ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/movimiento`,
      cuerpo: { mesaDestinoId: m.A.mesasLibres[0]!.id },
    }),
  },
  {
    nombre: 'POST /ordenes/:id/movimiento (mesa de destino ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/movimiento`,
      cuerpo: { mesaDestinoId: ids.mesa },
    }),
  },
  {
    nombre: 'POST /ordenes/:id/union (orden ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/union`,
      cuerpo: { mesaIds: [m.A.mesasLibres[0]!.id] },
    }),
  },
  {
    nombre: 'POST /ordenes/:id/union (mesa ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/union`,
      cuerpo: { mesaIds: [ids.mesa] },
    }),
  },
  {
    nombre: 'POST /ordenes/:id/items/:itemId/anulaciones (orden ajena)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/items/${m.A.segunda.itemLomoId}/anulaciones`,
      cuerpo: { id: randomUUID(), cantidad: 1, motivo: 'Error de toma', destinoStock: 'VUELVE' },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/items/:itemId/anulaciones (ítem ajeno)',
    sesion: 'S1',
    tambienS2: true,
    construir: (m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/items/${ids.item}/anulaciones`,
      cuerpo: { id: randomUUID(), cantidad: 1, motivo: 'Error de toma', destinoStock: 'VUELVE' },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/anulacion',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/anulacion`,
      cuerpo: { motivo: 'Error de toma', destinoStock: 'MERMA' },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/liberacion',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'post',
      ruta: `/ordenes/${ids.orden}/liberacion`,
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'PUT /cocina/lineas/:id/estado',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({
      metodo: 'put',
      ruta: `/cocina/lineas/${ids.linea}/estado`,
      cuerpo: { estado: 'EN_PREPARACION' },
    }),
  },
  {
    nombre: 'PUT /cocina/comandas/:id/listo',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({ metodo: 'put', ruta: `/cocina/comandas/${ids.comanda}/listo` }),
  },
  {
    nombre: 'PUT /cocina/comandas/:id/visto',
    sesion: 'S1',
    tambienS2: true,
    construir: (_m, ids) => ({ metodo: 'put', ruta: `/cocina/comandas/${ids.comanda}/visto` }),
  },
];

/** Ids de otra empresa (B), de la otra sucursal de A (S2) o inexistentes. */
function idsDeB(m: Mundo): Ajenos {
  return {
    sucursal: m.B.E.S1,
    zona: m.B.salon1.zonaId,
    mesa: m.B.salon1.mesas[0]!.id,
    orden: m.B.principal.id,
    item: m.B.principal.itemIds[0]!,
    comanda: m.B.principal.comandaIds[0]!,
    linea: m.B.principal.lineaIds[0]!,
  };
}
function idsDeS2(m: Mundo): Ajenos {
  return {
    sucursal: m.A.E.S2,
    zona: m.A.salon2.zonaId,
    mesa: m.A.salon2.mesas[0]!.id,
    orden: m.A.deS2.id,
    item: m.A.deS2.itemIds[0]!,
    comanda: m.A.deS2.comandaIds[0]!,
    linea: m.A.deS2.lineaIds[0]!,
  };
}
const idsInexistentes = (): Ajenos => ({
  sucursal: randomUUID(),
  zona: randomUUID(),
  mesa: randomUUID(),
  orden: randomUUID(),
  item: randomUUID(),
  comanda: randomUUID(),
  linea: randomUUID(),
});

const tokenDe = (m: Mundo, sesion: Sesion) => (sesion === 'config' ? m.A.tokenAdmin : m.A.tokenS1);

describe('criterio 85 · un id de B (o de otra sucursal de A) en la ruta responde 404 con el mismo cuerpo que un inexistente', () => {
  it('cada ruta de 3a con id: 404 NO_ENCONTRADO, mismo cuerpo que un inexistente, y nada cambia en A ni en B ni se publica', async () => {
    const m = await mundo();
    const fallos: string[] = [];
    for (const caso of casosDeRuta()) {
      const variantes: [string, Ajenos][] = [['de B', idsDeB(m)]];
      if (caso.tambienS2) variantes.push(['de S2', idsDeS2(m)]);
      for (const [etiqueta, ajenos] of variantes) {
        const token = tokenDe(m, caso.sesion);
        const antes = await foto(m);
        await asentar();
        ctx.publicador.limpiar();
        const resAjeno = await llamar(ctx, token, caso.construir(m, ajenos));
        const resX = await llamar(ctx, token, caso.construir(m, idsInexistentes()));
        if (resAjeno.status !== 404 || codigoDe(resAjeno) !== 'NO_ENCONTRADO') {
          fallos.push(
            `${caso.nombre} (${etiqueta}): se esperaba 404 NO_ENCONTRADO y fue ${resAjeno.status} ${codigoDe(resAjeno)}`,
          );
        }
        if (resX.status !== 404) {
          fallos.push(`${caso.nombre}: con un id inexistente se esperaba 404 y fue ${resX.status}`);
        }
        if (cuerpoDe(resAjeno) !== cuerpoDe(resX)) {
          fallos.push(
            `${caso.nombre} (${etiqueta}): el cuerpo (${cuerpoDe(resAjeno)}) se distingue del de un inexistente (${cuerpoDe(resX)})`,
          );
        }
        if (JSON.stringify(await foto(m)) !== JSON.stringify(antes)) {
          fallos.push(`${caso.nombre} (${etiqueta}): cambió una fila o la auditoría (en A o en B)`);
        }
        await asentar();
        if (ctx.publicador.eventos().length > 0) {
          fallos.push(`${caso.nombre} (${etiqueta}): publicó un evento`);
        }
      }
    }
    exigirSinFallos(fallos);
  });
});

interface CasoDeCuerpo {
  nombre: string;
  sesion: Sesion;
  estado: number;
  codigo: string;
  /** Campo de `campos` que debe señalarse. */
  campo?: string;
  /** `valor` es el id de B o uno inexistente. */
  construir: (m: Mundo, valor: string) => Llamada;
  /** Qué id de B se usa. */
  ref: 'mozo' | 'producto' | 'modificador' | 'item' | 'zona' | 'zonaOrden';
}

const casosDeCuerpo = (): CasoDeCuerpo[] => [
  {
    nombre: 'POST /ordenes con mozoId de B',
    sesion: 'S1',
    estado: 422,
    codigo: 'REFERENCIA_INVALIDA',
    campo: 'mozoId',
    ref: 'mozo',
    construir: (m, v) => ({
      metodo: 'post',
      ruta: '/ordenes',
      cuerpo: { id: randomUUID(), mesaId: m.A.mesasLibres[0]!.id, comensales: 2, mozoId: v },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/envios con un producto de B',
    sesion: 'S1',
    estado: 422,
    codigo: 'PRODUCTO_NO_VENDIBLE',
    campo: 'lineas',
    ref: 'producto',
    construir: (m, v) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/envios`,
      cuerpo: { id: randomUUID(), lineas: [{ productoId: v, modificadorIds: [], cantidad: 1 }] },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/envios con un modificador de B',
    sesion: 'S1',
    estado: 422,
    codigo: 'SELECCION_INVALIDA',
    campo: 'lineas',
    ref: 'modificador',
    construir: (m, v) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/envios`,
      cuerpo: {
        id: randomUUID(),
        lineas: [
          {
            productoId: m.A.carta.lomoId,
            modificadorIds: [m.A.carta.termino.jugoso, v],
            cantidad: 1,
          },
        ],
      },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'POST /ordenes/:id/marchas con ítems de B',
    sesion: 'S1',
    estado: 422,
    codigo: 'DATOS_INVALIDOS',
    campo: 'itemIds',
    ref: 'item',
    construir: (m, v) => ({
      metodo: 'post',
      ruta: `/ordenes/${m.A.segunda.id}/marchas`,
      cuerpo: { id: randomUUID(), itemIds: [v] },
      cabeceras: unaClave(),
    }),
  },
  {
    nombre: 'PATCH /sucursales/:sucursalId/mesas/:id con zonaId de B',
    sesion: 'config',
    estado: 422,
    codigo: 'REFERENCIA_INVALIDA',
    campo: 'zonaId',
    ref: 'zona',
    construir: (m, v) => ({
      metodo: 'patch',
      ruta: `/sucursales/${m.A.E.S1}/mesas/${m.A.salon1.mesas[5]!.id}`,
      cuerpo: { zonaId: v },
    }),
  },
  {
    nombre: 'PUT /sucursales/:sucursalId/zonas/orden con una zona de B',
    sesion: 'config',
    estado: 400,
    codigo: 'DATOS_INVALIDOS',
    ref: 'zonaOrden',
    construir: (m, v) => ({
      metodo: 'put',
      ruta: `/sucursales/${m.A.E.S1}/zonas/orden`,
      cuerpo: { ids: [m.A.salon1.zonaId, v] },
    }),
  },
  {
    nombre: 'PUT /sucursales/:sucursalId/zonas/orden con una zona de B en lugar de la de A',
    sesion: 'config',
    estado: 400,
    codigo: 'DATOS_INVALIDOS',
    ref: 'zonaOrden',
    construir: (m, v) => ({
      metodo: 'put',
      ruta: `/sucursales/${m.A.E.S1}/zonas/orden`,
      cuerpo: { ids: [v] },
    }),
  },
];

describe('criterio 85 · un id de B en el cuerpo responde 422 (o el 400 del orden) como un id inexistente', () => {
  it('cada ruta de 3a con ids en el cuerpo: mismo cuerpo que un inexistente, campos que señalan el campo y nada cambia', async () => {
    const m = await mundo();
    const deB = (ref: CasoDeCuerpo['ref']): string =>
      ({
        mozo: m.B.E.mozo.id,
        producto: m.B.carta.lomoId,
        modificador: m.B.carta.termino.jugoso,
        item: m.B.principal.itemIds[0]!,
        zona: m.B.salon1.zonaId,
        zonaOrden: m.B.salon1.zonaId,
      })[ref];
    const fallos: string[] = [];
    for (const caso of casosDeCuerpo()) {
      const token = tokenDe(m, caso.sesion);
      const antes = await foto(m);
      await asentar();
      ctx.publicador.limpiar();
      const resB = await llamar(ctx, token, caso.construir(m, deB(caso.ref)));
      const resX = await llamar(ctx, token, caso.construir(m, randomUUID()));
      for (const [etiqueta, res] of [
        ['de B', resB],
        ['inexistente', resX],
      ] as const) {
        if (res.status !== caso.estado || codigoDe(res) !== caso.codigo) {
          fallos.push(
            `${caso.nombre} (${etiqueta}): se esperaba ${caso.estado} ${caso.codigo} y fue ${res.status} ${codigoDe(res)}`,
          );
        }
      }
      if (cuerpoDe(resB) !== cuerpoDe(resX)) {
        fallos.push(
          `${caso.nombre}: el cuerpo con id de B (${cuerpoDe(resB)}) se distingue del de un inexistente (${cuerpoDe(resX)})`,
        );
      }
      if (caso.campo !== undefined) {
        const campos = ((resB.body as { campos?: { campo: string }[] }).campos ?? []).map(
          (c) => c.campo,
        );
        const campo = caso.campo;
        if (
          !campos.some((c) => c === campo || c.startsWith(`${campo}.`) || c.startsWith(`${campo}[`))
        ) {
          fallos.push(`${caso.nombre}: campos ${JSON.stringify(campos)} no señala ${campo}`);
        }
      }
      if (JSON.stringify(await foto(m)) !== JSON.stringify(antes)) {
        fallos.push(`${caso.nombre}: cambió una fila o la auditoría (en A o en B)`);
      }
      await asentar();
      if (ctx.publicador.eventos().length > 0) fallos.push(`${caso.nombre}: publicó un evento`);
    }
    exigirSinFallos(fallos);
  });

  it('GET /cocina/comandas?estacionIds= con una estación de B responde como con una inexistente y no trae nada de B', async () => {
    const m = await mundo();
    const idsB = await idsDeEmpresaSalon(admin, m.B.E.empresaId);
    const conB = await llamar(ctx, m.A.tokenS1, {
      metodo: 'get',
      ruta: `/cocina/comandas?estacionIds=${m.B.carta.cocinaId}`,
    });
    const conX = await llamar(ctx, m.A.tokenS1, {
      metodo: 'get',
      ruta: `/cocina/comandas?estacionIds=${randomUUID()}`,
    });
    expect(conB.status, conB.text).toBe(conX.status);
    expect(uuidsEn(conB.text).filter((id) => idsB.has(id))).toEqual([]);
    expect(conB.status === 200 ? (conB.body.pendientes as unknown[]).length : 0).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
// 85 · Las vistas solo traen datos de A y de la sucursal activa
// ------------------------------------------------------------------------------------------------
describe('criterio 85 · GET /salon, GET /ordenes/:id y GET /cocina/comandas solo traen datos de A y de la sucursal activa', () => {
  it('GET /salon con S1 activa trae exactamente las zonas y mesas activas de S1 de A y ningún id de S2 ni de B', async () => {
    const m = await mundo();
    const propios = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S1);
    const todosA = await idsDeEmpresaSalon(admin, m.A.E.empresaId);
    const ajenos = new Set([...todosA].filter((id) => !propios.has(id)));
    for (const id of await idsDeEmpresaSalon(admin, m.B.E.empresaId)) ajenos.add(id);
    const res = await llamar(ctx, m.A.tokenS1, { metodo: 'get', ruta: '/salon' });
    exigirEstado(res, 200, 'GET /salon de A en S1');
    expect(res.body.sucursalId).toBe(m.A.E.S1);
    expect(uuidsEn(res.text).filter((id) => ajenos.has(id))).toEqual([]);
    const zonas = res.body.zonas as {
      id: string;
      mesas: { id: string; orden: { id: string } | null }[];
    }[];
    expect(zonas.map((z) => z.id)).toEqual([m.A.salon1.zonaId]);
    expect(zonas.flatMap((z) => z.mesas.map((mesa) => mesa.id)).sort()).toEqual(
      m.A.salon1.mesas.map((mesa) => mesa.id).sort(),
    );
    const ordenes = zonas.flatMap((z) =>
      z.mesas.flatMap((mesa) => (mesa.orden ? [mesa.orden.id] : [])),
    );
    expect(ordenes.sort()).toEqual([m.A.principal.id, m.A.segunda.id].sort());
    expect(res.text).not.toContain(m.B.salon1.mesas[0]!.nombre);
  });

  it('GET /salon con S2 activa trae solo las zonas, mesas y órdenes de S2', async () => {
    const m = await mundo();
    const ajenos = await idsDeEmpresaSalon(admin, m.B.E.empresaId);
    for (const id of await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S1)) {
      if (id !== m.A.E.empresaId) ajenos.add(id);
    }
    const propios = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S2);
    for (const id of propios) ajenos.delete(id);
    const res = await llamar(ctx, m.A.tokenS2, { metodo: 'get', ruta: '/salon' });
    exigirEstado(res, 200, 'GET /salon de A en S2');
    expect(res.body.sucursalId).toBe(m.A.E.S2);
    expect(uuidsEn(res.text).filter((id) => ajenos.has(id))).toEqual([]);
    const zonas = res.body.zonas as { id: string }[];
    expect(zonas.map((z) => z.id)).toEqual([m.A.salon2.zonaId]);
  });

  it('GET /ordenes/:id de A trae solo ids de A y de su sucursal', async () => {
    const m = await mundo();
    const ajenos = await idsDeEmpresaSalon(admin, m.B.E.empresaId);
    const deS2 = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S2);
    const deS1 = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S1);
    for (const id of deS2) if (!deS1.has(id)) ajenos.add(id);
    const res = await llamar(ctx, m.A.tokenS1, {
      metodo: 'get',
      ruta: `/ordenes/${m.A.principal.id}`,
    });
    exigirEstado(res, 200, 'GET /ordenes/:id de A');
    expect(res.body.id).toBe(m.A.principal.id);
    expect(res.body.sucursalId).toBe(m.A.E.S1);
    expect(uuidsEn(res.text).filter((id) => ajenos.has(id))).toEqual([]);
    expect((res.body.items as { id: string }[]).map((i) => i.id).sort()).toEqual(
      [...m.A.principal.itemIds].sort(),
    );
  });

  it('GET /cocina/comandas con Cocina/Barra de S1 trae solo las comandas de S1 de A', async () => {
    const m = await mundo();
    const ajenos = await idsDeEmpresaSalon(admin, m.B.E.empresaId);
    const deS2 = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S2);
    const deS1 = await idsDeEmpresaSalon(admin, m.A.E.empresaId, m.A.E.S1);
    for (const id of deS2) if (!deS1.has(id)) ajenos.add(id);
    const res = await llamar(ctx, m.A.tokenCocinaS1, { metodo: 'get', ruta: '/cocina/comandas' });
    exigirEstado(res, 200, 'GET /cocina/comandas de A en S1');
    expect(uuidsEn(res.text).filter((id) => ajenos.has(id))).toEqual([]);
    const ids = [
      ...(res.body.pendientes as { id: string }[]),
      ...(res.body.recientes as { id: string }[]),
    ].map((c) => c.id);
    const esperadas = new Set([...m.A.principal.comandaIds, ...m.A.segunda.comandaIds]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => esperadas.has(id))).toBe(true);
    for (const id of m.A.segunda.comandaIds) expect(ids).toContain(id);
  });

  it('el ETag de B no sirve para A (no hay 304) y los ETag de A y B difieren, en el salón y en la cocina', async () => {
    const m = await mundo();
    for (const [ruta, tokenA, tokenB] of [
      ['/salon', m.A.tokenS1, m.B.tokenS1],
      ['/cocina/comandas', m.A.tokenCocinaS1, m.B.tokenCocinaS1],
    ] as const) {
      const deB = await llamar(ctx, tokenB, { metodo: 'get', ruta });
      exigirEstado(deB, 200, `${ruta} de B`);
      const etagB = deB.headers.etag as string | undefined;
      expect(etagB, `${ruta} de B trae ETag`).toBeTruthy();
      const deA = await llamar(ctx, tokenA, { metodo: 'get', ruta });
      exigirEstado(deA, 200, `${ruta} de A`);
      expect(deA.headers.etag).toBeTruthy();
      expect(deA.headers.etag).not.toBe(etagB);
      const conEtagDeB = await llamar(ctx, tokenA, {
        metodo: 'get',
        ruta,
        cabeceras: { 'If-None-Match': etagB! },
      });
      exigirEstado(conEtagDeB, 200, `${ruta} de A con el ETag de B`);
      const conEtagPropio = await llamar(ctx, tokenA, {
        metodo: 'get',
        ruta,
        cabeceras: { 'If-None-Match': deA.headers.etag as string },
      });
      expect(conEtagPropio.status, `${ruta} de A con su propio ETag`).toBe(304);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 85 · Ids de cliente repetidos en B
// ------------------------------------------------------------------------------------------------
describe('criterio 85 · los ids de cliente son únicos por empresa: el mismo id en B crea su propia fila', () => {
  it('orden, envío, marcha, anulación y pre-cuenta con los ids de A, usados en B, crean filas de B y no devuelven las de A', async () => {
    const m = await mundoDeIdsRepetidos();
    const idsA = await idsDeEmpresaSalon(admin, m.A.E.empresaId);
    const antesA = await instantaneaSalon(admin, m.A.E.empresaId);
    const a = m.A.principal;
    const mesaDeB = m.B.mesasLibres[0]!;

    // La orden con el id de la orden de A.
    const apertura = await abrirOrden(ctx, m.B.tokenS1, {
      id: a.id,
      mesaId: mesaDeB.id,
      comensales: 4,
    });
    exigirEstado(apertura, 201, 'abrir en B una orden con el id de la de A');
    expect(apertura.body.id).toBe(a.id);
    expect(apertura.body.sucursalId).toBe(m.B.E.S1);
    expect(apertura.body.mesas).toEqual([{ id: mesaDeB.id, nombre: mesaDeB.nombre }]);
    expect(apertura.body.comensales).toBe(4);
    expect(uuidsEn(apertura.text).filter((id) => idsA.has(id) && id !== a.id)).toEqual([]);

    // El envío con el id del envío de A, con otras líneas.
    const envio = await enviar(
      ctx,
      m.B.tokenS1,
      a.id,
      [lineaLomo(m.B.carta, { cantidad: 2, tiempo: 2 }), lineaGaseosa(m.B.carta)],
      { id: a.envioId },
    );
    exigirEstado(envio, 201, 'enviar en B con el id del envío de A');
    expect(envio.body.id).toBe(a.envioId);
    expect(envio.body.ordenId).toBe(a.id);
    expect(envio.body.numero).toBe(1);
    expect((envio.body.items as { productoId: string }[]).map((i) => i.productoId).sort()).toEqual(
      [m.B.carta.lomoId, m.B.carta.gaseosaId].sort(),
    );
    const itemLomo = (envio.body.items as { id: string; productoId: string }[]).find(
      (i) => i.productoId === m.B.carta.lomoId,
    )!;

    // La marcha, la anulación y la pre-cuenta con los ids de A.
    const marcha = await postConClave(ctx, m.B.tokenS1, `/ordenes/${a.id}/marchas`, {
      id: a.marchaId,
    });
    exigirEstado(marcha, 201, 'marchar en B con el id de la marcha de A');
    expect(marcha.body.id).toBe(a.marchaId);
    const anulacion = await postConClave(
      ctx,
      m.B.tokenS1,
      `/ordenes/${a.id}/items/${itemLomo.id}/anulaciones`,
      {
        id: a.anulacionId,
        cantidad: 1,
        motivo: 'Error de toma',
        destinoStock: 'MERMA',
      },
    );
    exigirEstado(anulacion, 201, 'anular en B con el id de la anulación de A');
    expect(anulacion.body.id).toBe(a.anulacionId);
    expect(anulacion.body.itemId).toBe(itemLomo.id);
    const precuenta = await postConClave(ctx, m.B.tokenS1, `/ordenes/${a.id}/precuentas`, {
      id: a.precuentaId,
    });
    exigirEstado(precuenta, 201, 'pedir la pre-cuenta en B con el id de la de A');
    expect(precuenta.body.id).toBe(a.precuentaId);
    expect((precuenta.body.orden as { id: string }).id).toBe(a.id);

    // Ninguna respuesta de B nombra un id de A (salvo los de cliente que B eligió).
    const reutilizados = new Set([a.id, a.envioId, a.marchaId, a.anulacionId, a.precuentaId]);
    for (const res of [apertura, envio, marcha, anulacion, precuenta]) {
      expect(
        uuidsEn(res.text).filter((id) => idsA.has(id) && !reutilizados.has(id as string)),
      ).toEqual([]);
    }

    // En la base hay dos filas con cada id, una por empresa, y las de A no cambiaron.
    for (const [tabla, id] of [
      ['orden', a.id],
      ['envio', a.envioId],
      ['marcha', a.marchaId],
      ['anulacion_item', a.anulacionId],
      ['precuenta', a.precuentaId],
    ] as const) {
      const filas = await admin.query<{ empresa_id: string }>(
        `SELECT empresa_id FROM ${tabla} WHERE id = $1 ORDER BY empresa_id`,
        [id],
      );
      expect(
        filas.rows.map((f) => f.empresa_id).sort(),
        `filas de ${tabla} con el id repetido`,
      ).toEqual([m.A.E.empresaId, m.B.E.empresaId].sort());
    }
    expect(await instantaneaSalon(admin, m.A.E.empresaId)).toEqual(antesA);

    // Cada empresa ve la suya.
    const deA = await llamar(ctx, m.A.tokenS1, { metodo: 'get', ruta: `/ordenes/${a.id}` });
    exigirEstado(deA, 200, 'GET de la orden de A');
    expect(deA.body.sucursalId).toBe(m.A.E.S1);
    expect(deA.body.comensales).toBe(3);
    const deB = await llamar(ctx, m.B.tokenS1, { metodo: 'get', ruta: `/ordenes/${a.id}` });
    exigirEstado(deB, 200, 'GET de la orden con el mismo id en B');
    expect(deB.body.sucursalId).toBe(m.B.E.S1);
    expect(deB.body.comensales).toBe(4);
  });

  it('repetir en B el id de una orden que A ya tiene no devuelve 409 ni 422 ni la orden de A: el id nuevo y el repetido responden igual', async () => {
    const m = await mundoDeIdsRepetidos();
    const libres = m.B.mesasLibres;
    const conIdDeA = await abrirOrden(ctx, m.B.tokenS1, {
      id: m.A.segunda.id,
      mesaId: libres[1]!.id,
    });
    const conIdNuevo = await abrirOrden(ctx, m.B.tokenS1, { mesaId: libres[2]!.id });
    exigirEstado(conIdDeA, 201, 'abrir con un id que A ya usa');
    exigirEstado(conIdNuevo, 201, 'abrir con un id nuevo');
    expect(conIdDeA.body.estado).toBe(conIdNuevo.body.estado);
    expect(Object.keys(conIdDeA.body).sort()).toEqual(Object.keys(conIdNuevo.body).sort());
  });
});

// ------------------------------------------------------------------------------------------------
// 86 · Concurrencia con el pool de 2 conexiones
// ------------------------------------------------------------------------------------------------
describe('criterio 86 · 100 peticiones concurrentes alternando A y B con un pool de 2', () => {
  it('GET /salon, POST /ordenes/:id/envios y GET /cocina/comandas devuelven y cambian solo datos de su empresa', async () => {
    const m = await mundo();
    const empresas = [m.A, m.B] as const;
    const enviosAntes = await Promise.all(
      empresas.map(async (e) => {
        const r = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM envio WHERE empresa_id = $1 AND orden_id = $2`,
          [e.E.empresaId, e.segunda.id],
        );
        return r.rows[0]!.n;
      }),
    );
    await asentar();
    ctx.publicador.limpiar();

    const textos: { empresa: 0 | 1; ruta: string; texto: string }[] = [];
    const enviados: [number, number] = [0, 0];
    const peticiones = Array.from({ length: 100 }, (_, i) => {
      const quien = (i % 2) as 0 | 1;
      const e = empresas[quien];
      const tipo = Math.floor(i / 2) % 3;
      return (async (): Promise<string[]> => {
        const problemas: string[] = [];
        if (tipo === 0) {
          const res = await llamar(ctx, e.tokenS1, { metodo: 'get', ruta: '/salon' });
          if (res.status !== 200)
            return [`#${i} GET /salon de ${quien}: ${res.status} ${res.text.slice(0, 200)}`];
          if (res.body.sucursalId !== e.E.S1) problemas.push(`#${i} GET /salon con otra sucursal`);
          textos.push({ empresa: quien, ruta: '/salon', texto: res.text });
        } else if (tipo === 1) {
          const res = await enviar(ctx, e.tokenS1, e.segunda.id, [lineaGaseosa(e.carta)]);
          if (res.status !== 201)
            return [`#${i} envío de ${quien}: ${res.status} ${res.text.slice(0, 200)}`];
          enviados[quien]++;
          if (res.body.ordenId !== e.segunda.id) problemas.push(`#${i} envío con otra orden`);
          const productos = (res.body.items as { productoId: string }[]).map((x) => x.productoId);
          if (productos.some((p) => p !== e.carta.gaseosaId))
            problemas.push(`#${i} envío con otro producto`);
          textos.push({ empresa: quien, ruta: 'envio', texto: res.text });
        } else {
          const res = await llamar(ctx, e.tokenCocinaS1, {
            metodo: 'get',
            ruta: '/cocina/comandas',
          });
          if (res.status !== 200)
            return [
              `#${i} GET /cocina/comandas de ${quien}: ${res.status} ${res.text.slice(0, 200)}`,
            ];
          textos.push({ empresa: quien, ruta: '/cocina/comandas', texto: res.text });
        }
        return problemas;
      })();
    });
    exigirSinFallos((await Promise.all(peticiones)).flat());
    await asentar(200);

    // Cada respuesta nombra solo ids de su empresa (el conjunto se calcula al final, con todo lo creado).
    const ids = [
      await idsDeEmpresaSalon(admin, m.A.E.empresaId),
      await idsDeEmpresaSalon(admin, m.B.E.empresaId),
    ] as const;
    const fugas = textos.flatMap((t) =>
      uuidsEn(t.texto)
        .filter((id) => ids[t.empresa === 0 ? 1 : 0].has(id))
        .map(
          (id) =>
            `${t.ruta} de ${t.empresa === 0 ? 'A' : 'B'} nombra el id ${id} de la otra empresa`,
        ),
    );
    exigirSinFallos(fugas);

    // Cada empresa cambió solo lo suyo.
    for (const [indice, e] of empresas.entries()) {
      const r = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM envio WHERE empresa_id = $1 AND orden_id = $2`,
        [e.E.empresaId, e.segunda.id],
      );
      expect(r.rows[0]!.n, `envíos de la orden de ${indice === 0 ? 'A' : 'B'}`).toBe(
        enviosAntes[indice]! + enviados[indice]!,
      );
      const ajenos = await admin.query(
        `SELECT 1 FROM item i JOIN orden o ON o.id = i.orden_id AND o.empresa_id = i.empresa_id
          WHERE i.empresa_id = $1 AND o.empresa_id <> i.empresa_id`,
        [e.E.empresaId],
      );
      expect(ajenos.rowCount).toBe(0);
    }
    expect(enviados[0] + enviados[1]).toBeGreaterThan(0);

    // Cada evento lleva la empresa y una sala de su empresa, y solo ids de su empresa.
    const eventos = ctx.publicador.eventos();
    expect(eventos.length).toBeGreaterThan(0);
    for (const evento of eventos) {
      const indice = evento.empresaId === m.A.E.empresaId ? 0 : 1;
      expect(
        [m.A.E.empresaId, m.B.E.empresaId],
        `evento ${evento.nombre} de una empresa desconocida`,
      ).toContain(evento.empresaId);
      const propia = empresas[indice];
      if (evento.sala.tipo === 'sucursal') {
        expect([propia.E.S1, propia.E.S2, propia.E.S3]).toContain(evento.sala.sucursalId);
      }
      const ajenosDelEvento = uuidsEn(JSON.stringify(evento.datos)).filter(
        (id) => !ids[indice].has(id),
      );
      expect(ajenosDelEvento, `evento ${evento.nombre} con ids que no son de su empresa`).toEqual(
        [],
      );
    }
    const ordenCambio = (indice: 0 | 1) =>
      eventos.filter(
        (ev) =>
          ev.nombre === 'orden.cambio' &&
          (ev.datos as { ordenId?: string }).ordenId === empresas[indice].segunda.id,
      ).length;
    expect(ordenCambio(0)).toBe(enviados[0]);
    expect(ordenCambio(1)).toBe(enviados[1]);
  });
});
