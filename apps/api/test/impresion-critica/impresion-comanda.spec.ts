// spec: 004-salon-cocina (pruebas protegidas)
//
// P5 · Impresión de la comanda (entrega 3b, ruta crítica), criterios 101, 112, 113 y 116:
// - 101: cada comanda (`COMANDA`, `ADICION`, `MARCHAR` o `ANULACION`) de una estación con destino `IMPRESORA` crea,
//   en la misma transacción, exactamente un trabajo `PENDIENTE` para esa impresora, con `comandaId`; la de una
//   estación al KDS, ninguno. Una réplica (misma clave, mismo id, diez simultáneas), un rechazo o una reversión (un
//   error del puerto de inventario) no crean trabajos;
// - 112: el aviso `trabajo.nuevo` sale después de confirmar y solo a la sala del puente activo de la sucursal de
//   la comanda (no a otra sucursal, ni a otra empresa, ni a la PWA); sin puente no se publica nada;
// - 113: `GET /puente/trabajos` entrega los pendientes de su sucursal en el orden de creación y con los bytes de la
//   comanda correcta; el emulador de la impresora correcta recibe el ticket de la comanda correcta (criterio 135);
// - 116: con el puente desconectado, tres comandas a Cocina quedan `PENDIENTE`; al reconectarse el simulador las
//   imprime en el orden en que se crearon y quedan `IMPRESO`.
//
// La API real corre con `RelojManual`, un `InventarioDePrueba` y Socket.IO habilitado (los eventos se anotan en
// memoria y también se entregan por Socket.IO). Las impresoras, los destinos y la vinculación se configuran por las
// rutas de 3b; el puente es el `SimuladorPuente` vinculado con el texto del QR; las impresoras son
// `EmuladorEscPos`. La carta es la de ejemplo de `spec.md` (fábricas protegidas de 3a).
//
// Interpretaciones (ver el informe de entrega):
// - "Sin puente o sin conexión, no se publica nada" (112) se lee como: no hay a quién avisar. Con el puente
//   vinculado y su socket del espacio `/puente` conectado se publica y se entrega; sin puente en la sucursal, no
//   se publica nada y el trabajo queda `PENDIENTE`.
// - Un trabajo `PENDIENTE` no deja de entregarse por haberse entregado: sigue en `GET /puente/trabajos` hasta que
//   el puente lo reporta `IMPRESO` (113).
// - Los textos de los tickets se comprueban solo en lo que fija el criterio 124 para identificar la comanda
//   (estación y tipo en mayúsculas, y los nombres de los productos); el formato fino es de otra prueba.
//
// Hoy falla por "No implementado": las rutas de impresoras, destinos y vinculación responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import {
  eventoTrabajoNuevoDatosSchema,
  eventoTrabajoNuevoSchema,
  trabajoParaImprimirSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores';
import { INICIO_POR_DEFECTO } from '../acceso/fabrica-plataforma';
import {
  asentar,
  esperarError,
  exigirEstado,
  llamar,
  sesionContrasena,
} from '../carta-critica/fabrica-permisos-carta';
import {
  abrirOrden,
  agotar,
  anularOrdenOk,
  clave,
  comandaDe,
  conteoDeOrden,
  crearEnCarta,
  enviarComanda,
  enviarOk,
  envio,
  lineasDe,
  marchar,
  nombreUnico,
  prepararEscenarioP2,
  reactivar,
  SalonDePrueba,
  simpleNuevo,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
} from '../salon-critica/fabrica-p2';
import { ClienteTiempoReal } from '../soporte';
import { interpretarEscPos } from '../soporte/puente';
import { abrirCliente } from '../utilidades';
import {
  arrancarP5,
  avisosDeTrabajo,
  Cierres,
  comandasBd,
  contarTrabajos,
  crearImpresora,
  esperarHasta,
  fijarDestino,
  memorizar,
  prepararSucursalP5,
  simuladorVinculado,
  trabajosDeComandas,
  trabajosDeSucursal,
  type AppP5,
  type SucursalP5,
} from './fabrica-p5';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;
let LB: ReturnType<typeof lineasDe>;
const cierres = new Cierres();
const preparadas: SucursalP5[] = [];

const A = () => esc.e.A;
const B = () => esc.e.B;

/** Arma una sucursal una sola vez; si falla, cada prueba que la usa ve el mismo error. */
const sucursal = (preparar: () => Promise<SucursalP5>) =>
  memorizar(async () => {
    const s = await preparar();
    preparadas.push(s);
    return s;
  });

const S = {
  /** S1 de A: Cocina a una impresora, Barra al KDS (con un `PUT` explícito), puente vinculado y conectado. */
  s1: sucursal(() =>
    prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S1',
      sucursalId: A().S1,
      carta: esc.carta,
      salon: esc.salon,
      tokenAdmin: esc.token.adminA,
      tokenMozo: esc.token.mozo,
      tokenSupervisor: esc.token.supervisor,
      tokenCocina: esc.token.cocina,
      barraAlKdsExplicito: true,
      conPuente: true,
      conSocket: true,
    }),
  ),
  /** S2 de A: Cocina a una impresora, Barra sin configurar (el KDS por defecto), puente conectado. */
  s2: sucursal(async () => {
    const adminS2 = await sesionContrasena(ctx, A().base.admin, A().S2);
    return prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S2',
      sucursalId: A().S2,
      carta: esc.carta,
      salon: esc.salonS2,
      tokenAdmin: esc.token.adminA,
      tokenMozo: esc.token.mozoS2,
      tokenSupervisor: adminS2,
      tokenCocina: adminS2,
      barraAlKdsExplicito: false,
      conPuente: true,
      conSocket: true,
    });
  }),
  /** S1 de B, con su propia carta, su puente y su impresora. */
  b1: sucursal(() =>
    prepararSucursalP5(ctx, cierres, {
      etiqueta: 'B1',
      sucursalId: B().S1,
      carta: esc.cartaB,
      salon: esc.salonB,
      tokenAdmin: B().tokenAdmin,
      tokenMozo: esc.token.mozoB,
      tokenSupervisor: esc.token.adminS1B,
      tokenCocina: esc.token.adminS1B,
      barraAlKdsExplicito: false,
      conPuente: true,
      conSocket: true,
    }),
  ),
  /** S2 de B: con impresora y destino, pero sin ningún puente vinculado. */
  b2: sucursal(async () => {
    const adminB2 = await sesionContrasena(ctx, B().base.admin, B().S2);
    return prepararSucursalP5(ctx, cierres, {
      etiqueta: 'B2',
      sucursalId: B().S2,
      carta: esc.cartaB,
      salon: new SalonDePrueba(ctx, B().tokenAdmin, B().S2, 'Terraza'),
      tokenAdmin: B().tokenAdmin,
      tokenMozo: adminB2,
      tokenSupervisor: adminB2,
      tokenCocina: adminB2,
      barraAlKdsExplicito: false,
      conPuente: false,
      conSocket: false,
    });
  }),
  /** S3 de A: para los casos de punta a punta; el puente está vinculado y cada prueba lo inicia como quiere. */
  s3: sucursal(async () => {
    const adminS3 = await sesionContrasena(ctx, A().base.admin, A().S3!);
    return prepararSucursalP5(ctx, cierres, {
      etiqueta: 'S3',
      sucursalId: A().S3!,
      carta: esc.carta,
      salon: new SalonDePrueba(ctx, esc.token.adminA, A().S3!, 'Patio'),
      tokenAdmin: esc.token.adminA,
      tokenMozo: adminS3,
      tokenSupervisor: adminS3,
      tokenCocina: adminS3,
      barraAlKdsExplicito: true,
      conPuente: true,
      conSocket: false,
    });
  }),
};

beforeAll(async () => {
  ctx = await arrancarP5();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
  LB = lineasDe(esc.cartaB);
});

beforeEach(async () => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
  ctx.inventario.lanzarAlEnviar(null);
  ctx.inventario.lanzarAlAnular(null);
  await asentar();
  ctx.inventario.limpiar();
  ctx.publicador.limpiar();
  for (const s of preparadas) s.socket?.limpiar();
});

afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await admin?.end();
});

// ---------------------------------------------------------------------------------------------------
// Ayudantes de la prueba
// ---------------------------------------------------------------------------------------------------

const abrir = (s: SucursalP5): Promise<OrdenAbierta> => abrirOrden(ctx, s.salon, s.tokenMozo);

const enviar = (
  s: SucursalP5,
  o: OrdenAbierta,
  lineas: LineaCuerpo[],
  id?: string,
): Promise<EnvioRespuestaDePrueba> => enviarOk(ctx, s.tokenMozo, o.id, lineas, id);

interface PlatoPropio {
  id: string;
  nombre: string;
  /** La última palabra del nombre, única por producto: identifica la comanda en un ticket. */
  marca: string;
  linea: (
    cantidad?: number,
    extra?: Partial<Pick<LineaCuerpo, 'tiempo' | 'paraLlevar'>>,
  ) => LineaCuerpo;
}

/** Un producto nuevo de una estación, sin control de stock, con un nombre único. */
async function platoNuevo(estacion: 'cocina' | 'barra', precio = '10.00'): Promise<PlatoPropio> {
  const nombre = nombreUnico('Plato');
  const creado = await crearEnCarta(
    ctx,
    esc.token.adminA,
    '/carta/productos',
    simpleNuevo(esc.carta, {
      nombre,
      precio,
      estacionId: estacion === 'cocina' ? esc.carta.cocinaId : esc.carta.barraId,
      tipoControlStock: 'SIN_CONTROL',
    }),
  );
  return {
    id: creado.id,
    nombre,
    marca: nombre.split(' ').at(-1)!,
    linea: (cantidad = 1, extra = {}) => ({
      productoId: creado.id,
      modificadorIds: [],
      cantidad,
      ...extra,
    }),
  };
}

/**
 * Criterio 101 sobre todas las comandas de una orden: la de una estación con impresora (Cocina) tiene destino
 * `IMPRESORA` y exactamente un trabajo `PENDIENTE` para la impresora de esa estación, de su mismo tipo y sin ser
 * reimpresión; la de una estación al KDS (Barra) tiene destino `KDS` y ningún trabajo.
 */
async function verificarUnTrabajoPorComanda(s: SucursalP5, ordenId: string) {
  const comandas = await comandasBd(admin, ordenId);
  const trabajos = await trabajosDeComandas(
    admin,
    comandas.map((c) => c.id),
  );
  for (const c of comandas) {
    const propios = trabajos.filter((t) => t.comanda_id === c.id);
    if (c.estacion_id === s.carta.cocinaId) {
      expect(c.destino, `comanda ${c.tipo} de Cocina`).toBe('IMPRESORA');
      expect(propios, `trabajos de la comanda ${c.tipo} de Cocina`).toHaveLength(1);
      expect(propios[0]).toMatchObject({
        sucursal_id: s.id,
        impresora_id: s.cocina.id,
        tipo: c.tipo,
        estado: 'PENDIENTE',
        reimpresion_de_id: null,
      });
    } else {
      expect(c.estacion_id).toBe(s.carta.barraId);
      expect(c.destino, `comanda ${c.tipo} de Barra`).toBe('KDS');
      expect(propios, `trabajos de la comanda ${c.tipo} de Barra`).toHaveLength(0);
    }
  }
  return { comandas, trabajos };
}

/** Los avisos `trabajo.nuevo` publicados hasta ahora, después de dejar pasar los efectos de después de confirmar. */
async function avisos() {
  await asentar();
  return avisosDeTrabajo(ctx);
}

const idsDeAvisos = (eventos: Awaited<ReturnType<typeof avisos>>): string[] =>
  eventos.map((e) => (e.datos as { trabajoId: string }).trabajoId);

const solo = <T>(valores: readonly T[]): T => {
  expect(valores).toHaveLength(1);
  return valores[0]!;
};

/** Anula un ítem con el Supervisor (sin clave) con el `id` y la `Idempotency-Key` dados. */
const anularItem = (
  s: SucursalP5,
  ordenId: string,
  itemId: string,
  cuerpo: { id: string; cantidad: number },
  k: string = randomUUID(),
) =>
  llamar(ctx, s.tokenSupervisor, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
    cuerpo: { ...cuerpo, motivo: 'Anulación de prueba', destinoStock: 'VUELVE' },
    cabeceras: clave(k),
  });

const anularOrden = (s: SucursalP5, ordenId: string, k: string = randomUUID()) =>
  llamar(ctx, s.tokenSupervisor, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/anulacion`,
    cuerpo: { motivo: 'Anulación de prueba', destinoStock: 'VUELVE' },
    cabeceras: clave(k),
  });

const errorDelPuerto = () =>
  new ErrorAplicacion(409, 'CONFLICTO', 'El inventario rechazó la operación (simulado)');

// ===================================================================================================
// Criterio 101 · una comanda, un trabajo
// ===================================================================================================

describe('criterio 101 · cada comanda de una estación con impresora crea exactamente un trabajo', () => {
  it('con Cocina a una impresora y Barra al KDS, el envío del criterio 22 crea un trabajo para la comanda de Cocina y ninguno para la de Barra', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const antes = await contarTrabajos(admin, s.id);
    const r = await enviar(s, o, [
      L.combo(['Cerveza', 'Ensalada'], 3),
      L.lomo(['3/4', 'Huevo'], 1),
      L.gaseosa(2),
    ]);

    expect(r.comandas).toHaveLength(2);
    expect(comandaDe(r.comandas, 'Cocina')).toMatchObject({
      tipo: 'COMANDA',
      destino: 'IMPRESORA',
    });
    expect(comandaDe(r.comandas, 'Barra')).toMatchObject({ tipo: 'COMANDA', destino: 'KDS' });

    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]!.comanda_id).toBe(comandaDe(r.comandas, 'Cocina').id);
    expect(trabajos[0]!.tipo).toBe('COMANDA');
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
  });

  it('con Barra sin configurar (el KDS por defecto) pasa lo mismo: un trabajo para Cocina y ninguno para Barra', async () => {
    const s = await S.s2();
    const o = await abrir(s);
    const antes = await contarTrabajos(admin, s.id);
    const r = await enviar(s, o, [L.combo(['Cerveza', 'Ensalada'], 1), L.lomo(['3/4'], 2)]);

    expect(comandaDe(r.comandas, 'Cocina').destino).toBe('IMPRESORA');
    expect(comandaDe(r.comandas, 'Barra').destino).toBe('KDS');
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos).toHaveLength(1);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
  });

  it('una adición a Cocina crea su propio trabajo ADICION y la comanda anterior conserva el suyo', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const primera = await enviar(s, o, [L.lomo(['3/4'], 1)]);
    const adicion = await enviar(s, o, [
      L.lomo(['Jugoso', 'Huevo'], 2),
      L.combo(['Cerveza', 'Papas'], 1),
    ]);

    const cocinaPrimera = comandaDe(primera.comandas, 'Cocina');
    const cocinaAdicion = comandaDe(adicion.comandas, 'Cocina');
    expect(cocinaAdicion).toMatchObject({ tipo: 'ADICION', destino: 'IMPRESORA' });
    expect(comandaDe(adicion.comandas, 'Barra')).toMatchObject({ tipo: 'ADICION', destino: 'KDS' });

    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    const portipo = (tipo: string) =>
      trabajos.filter((t) => t.tipo === tipo).map((t) => t.comanda_id);
    expect(trabajos).toHaveLength(2);
    expect(portipo('COMANDA')).toEqual([cocinaPrimera.id]);
    expect(portipo('ADICION')).toEqual([cocinaAdicion.id]);
  });

  it('marchar el segundo tiempo crea un trabajo MARCHAR para la comanda de Cocina y ninguno para la de Barra', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    await enviar(s, o, [
      L.lomo(['3/4', 'Huevo'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    const antes = await contarTrabajos(admin, s.id);

    const res = await marchar(ctx, s.tokenMozo, o.id, { id: randomUUID() });
    exigirEstado(res, 201, 'marchar');

    const comandas = await comandasBd(admin, o.id);
    const marchas = comandas.filter((c) => c.tipo === 'MARCHAR');
    expect(marchas.map((c) => [c.estacion_id, c.destino]).sort()).toEqual(
      [
        [s.carta.cocinaId, 'IMPRESORA'],
        [s.carta.barraId, 'KDS'],
      ].sort(),
    );
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos.map((t) => t.tipo).sort()).toEqual(['COMANDA', 'MARCHAR']);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
  });

  it('anular parte de un ítem crea un trabajo ANULACION para la comanda de Cocina y ninguno para la de Barra', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const r = await enviar(s, o, [L.combo(['Cerveza', 'Ensalada'], 2)]);
    const antes = await contarTrabajos(admin, s.id);

    exigirEstado(
      await anularItem(s, o.id, r.items[0]!.id, { id: randomUUID(), cantidad: 1 }),
      201,
      'anular un ítem',
    );

    const comandas = await comandasBd(admin, o.id);
    const anulaciones = comandas.filter((c) => c.tipo === 'ANULACION');
    expect(anulaciones.map((c) => c.estacion_id).sort()).toEqual(
      [s.carta.cocinaId, s.carta.barraId].sort(),
    );
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos.map((t) => t.tipo).sort()).toEqual(['ANULACION', 'COMANDA']);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
  });

  it('anular la orden crea un trabajo ANULACION por cada comanda de anulación de Cocina y ninguno para Barra', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    await enviar(s, o, [L.combo(['Cerveza', 'Ensalada'], 2), L.lomo(['3/4', 'Huevo'], 1)]);
    const antes = await contarTrabajos(admin, s.id);

    await anularOrdenOk(ctx, s.tokenSupervisor, o.id);

    const comandas = await comandasBd(admin, o.id);
    const anulaciones = comandas.filter((c) => c.tipo === 'ANULACION');
    expect(anulaciones.some((c) => c.estacion_id === s.carta.cocinaId)).toBe(true);
    expect(anulaciones.some((c) => c.estacion_id === s.carta.barraId)).toBe(true);
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    const deCocina = anulaciones.filter((c) => c.estacion_id === s.carta.cocinaId);
    expect(trabajos.filter((t) => t.tipo === 'ANULACION')).toHaveLength(deCocina.length);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + deCocina.length);
  });

  it('lo que no llega a Cocina no crea trabajos: un producto sin estación y uno solo de Barra (KDS)', async () => {
    const s = await S.s1();
    const barra = await platoNuevo('barra');
    const o = await abrir(s);
    const antes = await contarTrabajos(admin, s.id);

    const soloGaseosa = await enviar(s, o, [L.gaseosa(2)]);
    expect(soloGaseosa.comandas).toEqual([]);
    const soloBarra = await enviar(s, o, [barra.linea(3)]);
    expect(soloBarra.comandas).toHaveLength(1);
    expect(soloBarra.comandas[0]).toMatchObject({ tipo: 'ADICION', destino: 'KDS' });

    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos).toEqual([]);
    expect(await contarTrabajos(admin, s.id)).toBe(antes);
    expect(await avisos()).toEqual([]);
  });
});

// ===================================================================================================
// Criterio 101 · réplicas, rechazos y reversiones
// ===================================================================================================

describe('criterio 101 · una réplica, un rechazo o una reversión no crean trabajos de más', () => {
  it('la misma Idempotency-Key con el mismo cuerpo devuelve lo mismo, sin otro trabajo ni otro aviso', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const cuerpo = envio([L.lomo(['3/4'], 1), L.combo(['Cerveza', 'Ensalada'], 1)]);
    const k = randomUUID();
    const primera = await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo, k);
    exigirEstado(primera, 201, 'el envío');
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    const trabajoId = solo(trabajos).id;
    expect(idsDeAvisos(await avisos())).toEqual([trabajoId]);

    const replica = await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo, k);
    exigirEstado(replica, 201, 'la réplica con la misma clave');
    expect(replica.body).toEqual(primera.body);

    expect((await verificarUnTrabajoPorComanda(s, o.id)).trabajos.map((t) => t.id)).toEqual([
      trabajoId,
    ]);
    expect(idsDeAvisos(await avisos())).toEqual([trabajoId]);
  });

  it('el mismo id de envío con otra clave, y desde otra sesión de la empresa, devuelve el envío ya guardado sin otro trabajo', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const cuerpo = envio([L.lomo(['Jugoso'], 2)]);
    const primera = await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo);
    exigirEstado(primera, 201, 'el envío');
    const trabajoId = solo((await verificarUnTrabajoPorComanda(s, o.id)).trabajos).id;

    const otraClave = await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo, randomUUID());
    exigirEstado(otraClave, 201, 'la réplica con otra clave');
    expect(otraClave.body).toEqual(primera.body);
    const otraSesion = await enviarComanda(ctx, esc.token.mozo2, o.id, cuerpo, randomUUID());
    exigirEstado(otraSesion, 201, 'la réplica desde otra sesión');
    expect(otraSesion.body).toEqual(primera.body);

    expect((await verificarUnTrabajoPorComanda(s, o.id)).trabajos.map((t) => t.id)).toEqual([
      trabajoId,
    ]);
    expect(idsDeAvisos(await avisos())).toEqual([trabajoId]);
  });

  it('diez réplicas simultáneas del mismo envío dejan un solo trabajo y un solo aviso', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const cuerpo = envio([
      L.lomo(['3/4', 'Huevo'], 1),
      L.combo(['Cerveza', 'Ensalada'], 2),
      L.gaseosa(1),
    ]);
    const antes = await contarTrabajos(admin, s.id);
    await asentar();
    ctx.publicador.limpiar();

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_v, i) =>
        enviarComanda(ctx, i % 2 === 0 ? s.tokenMozo : esc.token.mozo2, o.id, cuerpo, randomUUID()),
      ),
    );
    const cuerpos: unknown[] = [];
    let conflictos = 0;
    for (const r of respuestas) {
      if (r.status === 201) {
        cuerpos.push(r.body);
      } else {
        // Un bloqueo traducido a CONFLICTO se puede repetir y entonces responde con el mismo envío.
        esperarError(r, 409, 'CONFLICTO');
        conflictos += 1;
      }
    }
    for (let i = 0; i < conflictos; i++) {
      const repetida = await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo, randomUUID());
      expect(repetida.status, repetida.text).toBe(201);
      cuerpos.push(repetida.body);
    }
    expect(cuerpos.length).toBeGreaterThanOrEqual(10);
    for (const c of cuerpos) expect(c).toEqual(cuerpos[0]);

    const { comandas, trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(comandas).toHaveLength(2);
    const trabajo = solo(trabajos);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
    expect(idsDeAvisos(await avisos())).toEqual([trabajo.id]);
  });

  it('repetir la marcha (misma clave y mismo id con otra clave) no crea otro trabajo MARCHAR', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    await enviar(s, o, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const id = randomUUID();
    const k = randomUUID();
    const primera = await marchar(ctx, s.tokenMozo, o.id, { id }, k);
    exigirEstado(primera, 201, 'marchar');
    const antes = await contarTrabajos(admin, s.id);
    const avisosAntes = idsDeAvisos(await avisos());

    const mismaClave = await marchar(ctx, s.tokenMozo, o.id, { id }, k);
    exigirEstado(mismaClave, 201, 'repetir con la misma clave');
    expect(mismaClave.body).toEqual(primera.body);
    const otraClave = await marchar(ctx, s.tokenMozo, o.id, { id }, randomUUID());
    exigirEstado(otraClave, 201, 'repetir con otra clave');
    expect(otraClave.body).toEqual(primera.body);

    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos.map((t) => t.tipo).sort()).toEqual(['COMANDA', 'MARCHAR']);
    expect(await contarTrabajos(admin, s.id)).toBe(antes);
    expect(idsDeAvisos(await avisos())).toEqual(avisosAntes);
  });

  it('repetir la anulación de un ítem (mismo id con otra clave) y la de la orden (misma clave) no crean otro trabajo ANULACION', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const r = await enviar(s, o, [L.lomo(['3/4'], 2), L.combo(['Cerveza', 'Ensalada'], 1)]);

    const anulacion = { id: randomUUID(), cantidad: 1 };
    const primera = await anularItem(s, o.id, r.items[0]!.id, anulacion);
    exigirEstado(primera, 201, 'anular el ítem');
    const repetida = await anularItem(s, o.id, r.items[0]!.id, anulacion, randomUUID());
    exigirEstado(repetida, 201, 'repetir la anulación con otra clave');
    expect(repetida.body).toEqual(primera.body);
    const trasItem = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trasItem.trabajos.filter((t) => t.tipo === 'ANULACION')).toHaveLength(1);

    const k = randomUUID();
    const anulada = await anularOrden(s, o.id, k);
    exigirEstado(anulada, 200, 'anular la orden');
    const trasOrden = await verificarUnTrabajoPorComanda(s, o.id);
    const total = await contarTrabajos(admin, s.id);
    const avisosAntes = idsDeAvisos(await avisos());

    const repetidaOrden = await anularOrden(s, o.id, k);
    exigirEstado(repetidaOrden, 200, 'repetir la anulación de la orden');
    expect(repetidaOrden.body).toEqual(anulada.body);
    expect((await verificarUnTrabajoPorComanda(s, o.id)).trabajos).toHaveLength(
      trasOrden.trabajos.length,
    );
    expect(await contarTrabajos(admin, s.id)).toBe(total);
    expect(idsDeAvisos(await avisos())).toEqual(avisosAntes);
  });

  it('un envío rechazado (producto agotado, monto fuera de rango, orden que ya no está abierta) no deja comandas, trabajos ni avisos', async () => {
    const s = await S.s1();
    const agotado = await platoNuevo('cocina');
    const carisimo = await platoNuevo('cocina', '99999999.00');
    const o = await abrir(s);
    const antes = await contarTrabajos(admin, s.id);

    await agotar(ctx, s.tokenCocina, agotado.id);
    try {
      const res = await enviarComanda(
        ctx,
        s.tokenMozo,
        o.id,
        envio([L.lomo(['3/4'], 1), agotado.linea(1)]),
      );
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
    } finally {
      await reactivar(ctx, s.tokenCocina, agotado.id);
    }

    const monto = await enviarComanda(ctx, s.tokenMozo, o.id, envio([carisimo.linea(2)]));
    esperarError(monto, 422, 'MONTO_FUERA_DE_RANGO');

    const libre = await abrir(s);
    const liberada = await llamar(ctx, s.tokenMozo, {
      metodo: 'post',
      ruta: `/ordenes/${libre.id}/liberacion`,
      cabeceras: clave(),
    });
    exigirEstado(liberada, 200, 'liberar la mesa sin consumo');
    const cerrada = await enviarComanda(ctx, s.tokenMozo, libre.id, envio([L.lomo(['3/4'], 1)]));
    esperarError(cerrada, 409, 'ORDEN_NO_ABIERTA');

    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 0,
      items: 0,
      comandas: 0,
      lineas: 0,
      marchas: 0,
    });
    expect((await conteoDeOrden(admin, libre.id)).comandas).toBe(0);
    expect(await contarTrabajos(admin, s.id)).toBe(antes);
    expect(await avisos()).toEqual([]);
  });

  it('si el puerto de inventario lanza al enviar, no queda ningún trabajo ni aviso; al repetir el mismo envío se crea uno solo', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const cuerpo = envio([L.lomo(['3/4', 'Huevo'], 1), L.combo(['Cerveza', 'Ensalada'], 1)]);
    const antes = await contarTrabajos(admin, s.id);

    ctx.inventario.lanzarAlEnviar(errorDelPuerto());
    try {
      esperarError(await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo), 409, 'CONFLICTO');
    } finally {
      ctx.inventario.lanzarAlEnviar(null);
    }
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1);
    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 0,
      items: 0,
      comandas: 0,
      lineas: 0,
      marchas: 0,
    });
    expect(await contarTrabajos(admin, s.id)).toBe(antes);
    expect(await avisos()).toEqual([]);

    exigirEstado(
      await enviarComanda(ctx, s.tokenMozo, o.id, cuerpo),
      201,
      'el mismo envío después',
    );
    const trabajo = solo((await verificarUnTrabajoPorComanda(s, o.id)).trabajos);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
    expect(idsDeAvisos(await avisos())).toEqual([trabajo.id]);
  });

  it('si el puerto de inventario lanza al anular un ítem o la orden, no queda ningún trabajo ANULACION ni aviso', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const r = await enviar(s, o, [L.lomo(['3/4'], 2), L.combo(['Cerveza', 'Ensalada'], 1)]);
    const antes = await contarTrabajos(admin, s.id);
    const avisosAntes = idsDeAvisos(await avisos());
    const comandasAntes = (await comandasBd(admin, o.id)).length;

    ctx.inventario.lanzarAlAnular(errorDelPuerto());
    try {
      esperarError(
        await anularItem(s, o.id, r.items[0]!.id, { id: randomUUID(), cantidad: 1 }),
        409,
        'CONFLICTO',
      );
      esperarError(await anularOrden(s, o.id), 409, 'CONFLICTO');
    } finally {
      ctx.inventario.lanzarAlAnular(null);
    }
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(2);
    expect((await comandasBd(admin, o.id)).length).toBe(comandasAntes);
    expect(await contarTrabajos(admin, s.id)).toBe(antes);
    expect(idsDeAvisos(await avisos())).toEqual(avisosAntes);

    // Y la misma anulación, ya sin el error, crea exactamente un trabajo.
    exigirEstado(
      await anularItem(s, o.id, r.items[0]!.id, { id: randomUUID(), cantidad: 1 }),
      201,
      'anular el ítem después',
    );
    const { trabajos } = await verificarUnTrabajoPorComanda(s, o.id);
    expect(trabajos.filter((t) => t.tipo === 'ANULACION')).toHaveLength(1);
    expect(await contarTrabajos(admin, s.id)).toBe(antes + 1);
  });
});

// ===================================================================================================
// Criterio 112 · el aviso trabajo.nuevo
// ===================================================================================================

describe('criterio 112 · el aviso trabajo.nuevo sale después de confirmar y solo a la sala del puente de la sucursal', () => {
  it('al llamar al inventario (dentro de la transacción) todavía no se había publicado nada; después sale un aviso con el id del trabajo', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    await asentar();
    ctx.publicador.limpiar();
    ctx.inventario.limpiar();

    await enviar(s, o, [L.lomo(['3/4'], 1), L.combo(['Cerveza', 'Ensalada'], 1)]);

    // El puerto de inventario corre dentro de la transacción: ni el aviso ni ningún evento había salido.
    expect(ctx.inventario.eventosAlLlamar).toEqual([0]);
    const trabajo = solo((await verificarUnTrabajoPorComanda(s, o.id)).trabajos);
    const publicados = await avisos();
    expect(publicados).toHaveLength(1);
    const puenteId = s.puente!.puente!.id;
    expect(eventoTrabajoNuevoSchema.parse(publicados[0])).toEqual({
      empresaId: A().empresaId,
      sala: { tipo: 'puente', puenteId },
      nombre: 'trabajo.nuevo',
      datos: { trabajoId: trabajo.id },
    });
  });

  it('cada trabajo avisa una vez, también el de una adición, una marcha y una anulación; una comanda al KDS no avisa', async () => {
    const s = await S.s1();
    const o = await abrir(s);
    const puenteId = s.puente!.puente!.id;
    const conocidos = new Set((await trabajosDeSucursal(admin, s.id)).map((t) => t.id));
    const avisados = new Set<string>();

    /** Comprueba que desde la última vez se creó un solo trabajo, del tipo dado, y que salió un solo aviso para él. */
    const unAvisoNuevoPara = async (tipo: string) => {
      const nuevos = (await trabajosDeSucursal(admin, s.id)).filter((t) => !conocidos.has(t.id));
      const trabajo = solo(nuevos);
      expect(trabajo.tipo).toBe(tipo);
      conocidos.add(trabajo.id);
      const publicados = await avisos();
      const sinVer = publicados.filter(
        (e) => !avisados.has((e.datos as { trabajoId: string }).trabajoId),
      );
      const aviso = solo(sinVer);
      expect(aviso.sala).toEqual({ tipo: 'puente', puenteId });
      expect((aviso.datos as { trabajoId: string }).trabajoId).toBe(trabajo.id);
      avisados.add(trabajo.id);
    };

    const primera = await enviar(s, o, [
      L.lomo(['3/4'], 2, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1),
    ]);
    await unAvisoNuevoPara('COMANDA');

    await enviar(s, o, [L.lomo(['Jugoso'], 1)]);
    await unAvisoNuevoPara('ADICION');

    exigirEstado(await marchar(ctx, s.tokenMozo, o.id, { id: randomUUID() }), 201, 'marchar');
    await unAvisoNuevoPara('MARCHAR');

    exigirEstado(
      await anularItem(s, o.id, primera.items[0]!.id, { id: randomUUID(), cantidad: 1 }),
      201,
      'anular',
    );
    await unAvisoNuevoPara('ANULACION');

    // Una adición solo de Barra (KDS) no crea trabajo ni aviso.
    const barra = await platoNuevo('barra');
    await enviar(s, o, [barra.linea(1)]);
    expect((await avisos()).length).toBe(avisados.size);
    expect(await trabajosDeSucursal(admin, s.id)).toHaveLength(conocidos.size);
  });

  it('sin puente vinculado en la sucursal no se publica ningún aviso y el trabajo queda PENDIENTE', async () => {
    const s = await S.b2();
    const o = await abrir(s);
    await enviar(s, o, [LB.lomo(['3/4'], 1), LB.combo(['Cerveza', 'Ensalada'], 1)]);

    const trabajo = solo((await verificarUnTrabajoPorComanda(s, o.id)).trabajos);
    expect(trabajo.estado).toBe('PENDIENTE');
    expect(await avisos()).toEqual([]);
  });

  it('el aviso llega solo al puente de la sucursal de la comanda: no al de otra sucursal, ni al de otra empresa, ni a la PWA', async () => {
    const s1 = await S.s1();
    const s2 = await S.s2();
    const b1 = await S.b1();
    const pwa = await ClienteTiempoReal.conectar(ctx.app, { token: s1.tokenMozo });
    cierres.agregar(() => pwa.cerrar());
    const sockets = [s1, s2, b1].map((s) => ({ etiqueta: s.etiqueta, socket: s.socket! }));
    const lineasDeCada = new Map([
      [s1.id, L],
      [s2.id, L],
      [b1.id, LB],
    ]);

    for (const emisora of [s1, s2, b1]) {
      for (const { socket } of sockets) socket.limpiar();
      pwa.limpiar();
      ctx.publicador.limpiar();
      const lineas = lineasDeCada.get(emisora.id)!;
      const o = await abrir(emisora);
      await enviar(emisora, o, [lineas.lomo(['3/4'], 1)]);
      const trabajo = solo(
        await trabajosDeComandas(
          admin,
          (await comandasBd(admin, o.id)).map((c) => c.id),
        ),
      );

      // Llega al socket del puente de la sucursal que comandó, con solo el id del trabajo.
      const propio = sockets.find((x) => x.etiqueta === emisora.etiqueta)!.socket;
      const datos = eventoTrabajoNuevoDatosSchema.parse(
        await propio.esperarEvento('trabajo.nuevo'),
      );
      expect(datos).toEqual({ trabajoId: trabajo.id });
      // Y a ningún otro puente ni a la PWA.
      for (const otro of sockets.filter((x) => x.etiqueta !== emisora.etiqueta)) {
        await otro.socket.noRecibe('trabajo.nuevo', 300);
      }
      await pwa.noRecibe('trabajo.nuevo', 100);

      // En el publicador, un solo aviso, a la sala del puente de esa sucursal y de esa empresa.
      const publicados = await avisos();
      expect(publicados).toHaveLength(1);
      expect(publicados[0]).toMatchObject({
        empresaId: emisora === b1 ? B().empresaId : A().empresaId,
        sala: { tipo: 'puente', puenteId: emisora.puente!.puente!.id },
      });
    }
  });
});

// ===================================================================================================
// Criterio 113 · GET /puente/trabajos
// ===================================================================================================

describe('criterio 113 · GET /puente/trabajos entrega los pendientes en el orden de creación', () => {
  it('entrega los trabajos de la sucursal del puente en el orden en que se crearon, con los bytes de su comanda y sin las de Barra (KDS)', async () => {
    const s = await S.s2();
    const platos = [
      await platoNuevo('cocina'),
      await platoNuevo('cocina'),
      await platoNuevo('cocina'),
    ];
    const deBarra = await platoNuevo('barra');
    const adicional = await platoNuevo('cocina');

    // Cuatro envíos en tres órdenes, con el reloj de la API distinto en cada uno (un segundo entre ellos).
    const ordenes = [await abrir(s), await abrir(s), await abrir(s)];
    const esperados: Array<{ marca: string; comandaId: string }> = [];
    const mandar = async (o: OrdenAbierta, plato: PlatoPropio) => {
      const r = await enviar(s, o, [plato.linea(1)]);
      esperados.push({ marca: plato.marca, comandaId: comandaDe(r.comandas, 'Cocina').id });
      ctx.reloj.avanzar(1000);
    };
    await mandar(ordenes[1]!, platos[1]!);
    await mandar(ordenes[0]!, platos[0]!);
    await enviar(s, ordenes[2]!, [deBarra.linea(1)]);
    ctx.reloj.avanzar(1000);
    await mandar(ordenes[2]!, platos[2]!);
    await mandar(ordenes[1]!, adicional);

    const trabajosBd = await trabajosDeComandas(
      admin,
      esperados.map((e) => e.comandaId),
    );
    const idDeTrabajo = new Map(trabajosBd.map((t) => [t.comanda_id!, t.id]));
    const idsEsperados = esperados.map((e) => idDeTrabajo.get(e.comandaId)!);

    const pedir = () =>
      llamar(ctx, s.puente!.token!, {
        metodo: 'get',
        ruta: '/puente/trabajos',
        cabeceras: { 'X-Puente-Protocolo': '1' },
      });
    const res = await pedir();
    exigirEstado(res, 200, 'GET /puente/trabajos');
    const entregados = z.array(trabajoParaImprimirSchema).parse(res.body);
    expect(entregados.length).toBeLessThanOrEqual(50);

    // Orden de creación e id, y solo trabajos de impresoras de esta sucursal.
    for (let i = 1; i < entregados.length; i++) {
      const a = entregados[i - 1]!;
      const b = entregados[i]!;
      const ta = Date.parse(a.creadoEn);
      const tb = Date.parse(b.creadoEn);
      expect(ta < tb || (ta === tb && a.id < b.id), `orden de ${a.id} y ${b.id}`).toBe(true);
    }
    const mios = entregados.filter((t) => idsEsperados.includes(t.id));
    expect(mios.map((t) => t.id)).toEqual(idsEsperados);
    for (const t of mios) {
      expect(t.impresoraId).toBe(s.cocina.id);
      expect(t.tipo).toMatch(/^(COMANDA|ADICION)$/);
    }

    // Cada trabajo trae los bytes ESC/POS de su propia comanda (y de ninguna otra).
    const marcas = [...platos, deBarra, adicional].map((p) => p.marca);
    mios.forEach((t, i) => {
      const { tickets, parcial } = interpretarEscPos(Buffer.from(t.bytes, 'base64'), {
        columnas: 48,
      });
      expect(parcial).toBeNull();
      const ticket = solo(tickets);
      expect(ticket.texto).toContain(esperados[i]!.marca);
      for (const otra of marcas.filter((m) => m !== esperados[i]!.marca)) {
        expect(ticket.texto, `el ticket de ${esperados[i]!.marca} no lleva ${otra}`).not.toContain(
          otra,
        );
      }
    });

    // Entregar no cambia nada: mientras no se reporte IMPRESO, el trabajo sigue pendiente y se vuelve a entregar.
    const otraVez = z.array(trabajoParaImprimirSchema).parse((await pedir()).body);
    expect(otraVez.filter((t) => idsEsperados.includes(t.id)).map((t) => t.id)).toEqual(
      idsEsperados,
    );
    expect(
      (
        await trabajosDeComandas(
          admin,
          esperados.map((e) => e.comandaId),
        )
      ).map((t) => t.estado),
    ).toEqual(idsEsperados.map(() => 'PENDIENTE'));
  });
});

// ===================================================================================================
// Criterios 113 y 135 · el emulador recibe el ticket de la comanda correcta en la impresora correcta
// ===================================================================================================

describe('criterio 113 · el emulador de la impresora correcta recibe el ticket de la comanda correcta', () => {
  it('con Cocina y Barra en impresoras distintas, cada emulador recibe solo el ticket de su estación', async () => {
    const s = await S.s3();
    const barra = await crearImpresora(ctx, cierres, s.tokenAdmin, s.id, 'Barra S3');
    await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, {
      destino: 'IMPRESORA',
      impresoraId: barra.id,
    });
    const deCocina = await platoNuevo('cocina');
    const deBarra = await platoNuevo('barra');
    const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
    await simulador.iniciar();
    try {
      const o = await abrir(s);
      const r = await enviar(s, o, [deCocina.linea(2), deBarra.linea(1)]);
      expect(comandaDe(r.comandas, 'Cocina').destino).toBe('IMPRESORA');
      expect(comandaDe(r.comandas, 'Barra').destino).toBe('IMPRESORA');

      const enCocina = await s.cocina.emulador.esperarTicket(2000);
      const enBarra = await barra.emulador.esperarTicket(2000);
      expect(enCocina.completo).toBe(true);
      expect(enCocina.texto).toContain(deCocina.marca);
      expect(enCocina.texto).not.toContain(deBarra.marca);
      expect(enCocina.texto).toMatch(/COCINA/);
      expect(enBarra.completo).toBe(true);
      expect(enBarra.texto).toContain(deBarra.marca);
      expect(enBarra.texto).not.toContain(deCocina.marca);
      expect(enBarra.texto).toMatch(/BARRA/);
      // Ni un ticket de más en ninguna de las dos.
      await s.cocina.emulador.noRecibe(300);
      await barra.emulador.noRecibe(100);

      // El puente reportó los dos trabajos y quedaron IMPRESO, cada uno en su impresora.
      await simulador.esperarImpresos(2, 3000);
      const comandas = await comandasBd(admin, o.id);
      const trabajos = await trabajosDeComandas(
        admin,
        comandas.map((c) => c.id),
      );
      expect(trabajos).toHaveLength(2);
      for (const t of trabajos) {
        expect(t.estado).toBe('IMPRESO');
        expect(t.impreso_en).not.toBeNull();
      }
      expect(trabajos.map((t) => t.impresora_id).sort()).toEqual([s.cocina.id, barra.id].sort());
    } finally {
      await simulador.detener();
      await fijarDestino(ctx, s.tokenAdmin, s.id, s.carta.barraId, { destino: 'KDS' });
      s.cocina.emulador.limpiar();
      barra.emulador.limpiar();
    }
  });

  it('con Barra al KDS, la comanda, la adición, la marcha y la anulación llegan a la impresora de Cocina en el orden en que se crearon', async () => {
    const s = await S.s3();
    const primero = await platoNuevo('cocina');
    const segundo = await platoNuevo('cocina');
    const deBarra = await platoNuevo('barra');
    const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
    await simulador.iniciar();
    try {
      const o = await abrir(s);
      const r1 = await enviar(s, o, [
        primero.linea(1, { tiempo: 2 }),
        deBarra.linea(1, { tiempo: 2 }),
      ]);
      ctx.reloj.avanzar(1000);
      await enviar(s, o, [segundo.linea(2)]);
      ctx.reloj.avanzar(1000);
      exigirEstado(await marchar(ctx, s.tokenMozo, o.id, { id: randomUUID() }), 201, 'marchar');
      ctx.reloj.avanzar(1000);
      exigirEstado(
        await anularItem(s, o.id, r1.items[0]!.id, { id: randomUUID(), cantidad: 1 }),
        201,
        'anular',
      );

      const tickets = await s.cocina.emulador.esperarTickets(4, 4000);
      const tipos = [/COMANDA/, /ADICI.N/, /MARCHAR/, /ANULACI.N/];
      tickets.forEach((t, i) => {
        expect(t.completo).toBe(true);
        expect(t.texto, `ticket ${i + 1}`).toMatch(tipos[i]!);
        expect(t.texto).toMatch(/COCINA/);
        expect(t.texto).not.toContain(deBarra.marca);
      });
      expect(tickets[0]!.texto).toContain(primero.marca);
      expect(tickets[1]!.texto).toContain(segundo.marca);
      expect(tickets[2]!.texto).toContain(primero.marca);
      expect(tickets[2]!.texto).not.toContain(segundo.marca);
      expect(tickets[3]!.texto).toContain(primero.marca);
      await s.cocina.emulador.noRecibe(300);

      const { trabajos } = await verificarUnTrabajoPorComandaImpresos(s, o.id);
      expect(trabajos.map((t) => t.tipo)).toEqual(['COMANDA', 'ADICION', 'MARCHAR', 'ANULACION']);
    } finally {
      await simulador.detener();
      s.cocina.emulador.limpiar();
    }
  });
});

/** Como `verificarUnTrabajoPorComanda`, pero para trabajos que ya se imprimieron: solo cuenta y ordena. */
async function verificarUnTrabajoPorComandaImpresos(s: SucursalP5, ordenId: string) {
  const comandas = await comandasBd(admin, ordenId);
  const trabajos = await trabajosDeComandas(
    admin,
    comandas.map((c) => c.id),
  );
  for (const c of comandas) {
    const propios = trabajos.filter((t) => t.comanda_id === c.id);
    expect(propios, `trabajos de la comanda ${c.tipo} de ${c.estacion_id}`).toHaveLength(
      c.estacion_id === s.carta.cocinaId ? 1 : 0,
    );
  }
  await esperarHasta(
    async () =>
      (
        await trabajosDeComandas(
          admin,
          comandas.map((c) => c.id),
        )
      ).every((t) => t.estado === 'IMPRESO'),
    3000,
    'que los trabajos queden IMPRESO',
  );
  return { comandas, trabajos };
}

// ===================================================================================================
// Criterio 116 · reconexión
// ===================================================================================================

describe('criterio 116 · con el puente desconectado, las comandas esperan y al reconectarse se imprimen en orden', () => {
  it('tres comandas a Cocina quedan PENDIENTE; al reconectarse el simulador las imprime en el orden en que se crearon y quedan IMPRESO', async () => {
    const s = await S.s3();
    const platos = [
      await platoNuevo('cocina'),
      await platoNuevo('cocina'),
      await platoNuevo('cocina'),
    ];

    // El puente está desconectado: nadie corre el simulador.
    const comandaIds: string[] = [];
    for (const plato of platos) {
      const o = await abrir(s);
      const r = await enviar(s, o, [plato.linea(1)]);
      comandaIds.push(comandaDe(r.comandas, 'Cocina').id);
      ctx.reloj.avanzar(1000);
    }
    const pendientes = await trabajosDeComandas(admin, comandaIds);
    expect(pendientes).toHaveLength(3);
    expect(pendientes.map((t) => t.comanda_id)).toEqual(comandaIds);
    for (const t of pendientes) {
      expect(t).toMatchObject({ estado: 'PENDIENTE', impresora_id: s.cocina.id });
      expect(t.impreso_en).toBeNull();
    }
    await s.cocina.emulador.noRecibe(300);

    // El puente vuelve: pide los trabajos al conectarse y los imprime en orden.
    const simulador = simuladorVinculado(ctx, cierres, s.puente!.token!);
    await simulador.iniciar();
    try {
      const tickets = await s.cocina.emulador.esperarTickets(3, 5000);
      tickets.forEach((t, i) => {
        expect(t.completo).toBe(true);
        expect(t.texto).toContain(platos[i]!.marca);
        for (const otro of platos.filter((_p, j) => j !== i))
          expect(t.texto).not.toContain(otro.marca);
      });
      await simulador.esperarImpresos(3, 3000);
      expect(simulador.impresos).toEqual(pendientes.map((t) => t.id));
      expect(simulador.impresiones.map((i) => i.trabajoId)).toEqual(pendientes.map((t) => t.id));

      const impresos = await trabajosDeComandas(admin, comandaIds);
      for (const t of impresos) {
        expect(t.estado).toBe('IMPRESO');
        expect(t.impreso_en).not.toBeNull();
      }
      await s.cocina.emulador.noRecibe(300);

      // Lo ya impreso no se vuelve a entregar.
      const res = await llamar(ctx, simulador.token!, {
        metodo: 'get',
        ruta: '/puente/trabajos',
        cabeceras: { 'X-Puente-Protocolo': '1' },
      });
      exigirEstado(res, 200, 'GET /puente/trabajos');
      expect(res.body).toEqual([]);
    } finally {
      await simulador.detener();
      s.cocina.emulador.limpiar();
    }
  });
});
