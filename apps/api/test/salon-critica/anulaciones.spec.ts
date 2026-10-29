// spec: 004-salon-cocina (pruebas protegidas)
//
// P3 (parte 1) · Anular un ítem enviado, anular la orden y liberar la mesa (ruta crítica), criterios 35 a 44
// (con las decisiones 6, 7 y 10):
// - 35 y 36: anular parte y todo; la clave del Supervisor para Mozo y Cajero (sin cabecera 403
//   `CLAVE_REQUERIDA`, con autorización válida 201 y consumida, de otra acción o vencida 403), sin clave para
//   Supervisor y Administrador, Cocina/Barra 403, y el consumo que se revierte si la anulación falla;
// - 37: la réplica con la misma `Idempotency-Key` y la misma autorización no anula ni consume de nuevo; el
//   mismo `id` con otra clave; el mismo `id` con otra cantidad, otro ítem u otro destino;
// - 35: cantidad, estado e ítem inválidos;
// - 38 y 39: una comanda `ANULACION` por estación con la cantidad de cada parte y una llamada al inventario;
// - 40: la pre-cuenta se invalida también con una anulación parcial (decisión 10);
// - 41: una fila `anular_item` con el autorizador y el detalle exacto, y la de `ANULAR_ITEM_ENVIADO` de 002
//   solo cuando hubo clave;
// - 42 y 43: anular la orden (una fila `anular_orden`, mesas libres, todos los ítems anulados);
// - 44: liberar una mesa sin consumo, sin clave, con su fila `liberar_mesa` (decisión 7), y su rechazo con consumo.
// Hoy las rutas no existen: las pruebas fallan con 500 `ERROR_INTERNO` ("No implementado") en lugar de 201/200 o
// 403, y por las tablas inexistentes.
import { randomUUID } from 'node:crypto';
import { anulacionRespuestaSchema, ordenRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { abrirCliente } from '../utilidades';
import {
  MINUTO,
  PRECIO,
  PoolDeMesas,
  abrirOrden,
  anulacionesDelItem,
  anularItem,
  anularOrden,
  arrancarP3,
  asentar,
  auditoriaNueva,
  cerca,
  auditoriaSalon,
  autorizacionGuardada,
  comandasDeAnulacion,
  comandasDelKds,
  crearEscenarioP3,
  cuerpoDeAnulacion,
  enviar,
  esperarError,
  eventosDe,
  exigirEstado,
  filasDe,
  instantaneaSalon,
  leerCocina,
  leerOrden,
  liberarMesa,
  lineaGaseosa,
  llamar,
  mesaEnSalon,
  ordenConItems,
  pedirAutorizacion,
  pedirPrecuenta,
  sembrarCartaSalon,
  sesiones,
  TIPOS_DE_SESION,
  unaFilaDe,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
  type OrdenConItems,
  type PersonaConSesion,
  type TipoDeSesion,
} from './fabrica-p3';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP3;
let admin: Client;
let escPendiente: Promise<EscenarioP3> | undefined;
let cartaPendiente: Promise<CartaSalon> | undefined;
let mesasPendientes: Promise<PoolDeMesas> | undefined;
let mesasS2Pendientes: Promise<PoolDeMesas> | undefined;

beforeAll(async () => {
  ctx = await arrancarP3();
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  ctx?.inventario.lanzarAlAnular(null);
  await ctx?.cerrar();
  await admin?.end();
});

const esc = () => (escPendiente ??= crearEscenarioP3(ctx));
const carta = () => (cartaPendiente ??= esc().then((e) => sembrarCartaSalon(ctx, e.A.tokenAdmin)));
const mesasS1 = () =>
  (mesasPendientes ??= esc().then((e) => new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1)));
const mesasS2 = () =>
  (mesasS2Pendientes ??= esc().then((e) => new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S2)));

type Rol = 'MOZO' | 'CAJERO' | 'SUPERVISOR' | 'ADMINISTRADOR' | 'COCINA_BARRA';

interface Actor {
  rol: Rol;
  token: string;
  persona: PersonaConSesion;
  equipoId: string;
}

/** Una sesión (de contraseña o de PIN) del rol en S1, con S1 activa. */
async function actor(rol: Rol, tipo: TipoDeSesion): Promise<Actor> {
  const e = await esc();
  const persona: PersonaConSesion = {
    MOZO: e.A.mozo,
    CAJERO: e.A.cajero,
    SUPERVISOR: e.A.supervisor,
    ADMINISTRADOR: e.A.base.admin,
    COCINA_BARRA: e.A.cocina,
  }[rol];
  const s = await sesiones(ctx, persona, e.A.S1);
  return { rol, token: s[tipo], persona, equipoId: s.equipoId };
}

/** Una orden nueva con el lomo × 2, el combo × 3 y la gaseosa × 2, abierta y enviada por el Mozo. */
async function ordenNueva(): Promise<OrdenConItems> {
  const mozo = await actor('MOZO', 'contrasena');
  return ordenConItems(ctx, await mesasS1(), await carta(), mozo.token);
}

/** Autorización de clave del Supervisor para el actor (queda atada a su sesión). */
async function clave(
  quien: Actor,
  accion: 'ANULAR_ITEM_ENVIADO' | 'ANULAR_ORDEN' = 'ANULAR_ITEM_ENVIADO',
  motivo = 'Autorizo la anulación',
) {
  const e = await esc();
  return pedirAutorizacion(ctx, quien.token, e.A.supervisor.pin, accion, motivo);
}

/** Lo que no puede cambiar en un rechazo: las tablas, la auditoría y las llamadas al inventario. */
async function foto() {
  const e = await esc();
  return {
    tablas: await instantaneaSalon(admin, e.A.empresaId),
    auditoria: await auditoriaSalon(admin, e.A.empresaId),
    inventario: ctx.inventario.llamadas(),
  };
}

async function exigirSinCambios(antes: Awaited<ReturnType<typeof foto>>, contexto = '') {
  expect(await foto(), contexto).toEqual(antes);
  await asentar();
  expect(ctx.publicador.eventos(), `${contexto}: eventos`).toEqual([]);
}

async function prepararRechazo() {
  await asentar();
  ctx.publicador.limpiar();
  return foto();
}

const nombreDe = (persona: PersonaConSesion): string =>
  (persona as unknown as { respuesta: { nombre: string } }).respuesta.nombre;

/** Líneas de una comanda del KDS como `nombre → cantidad`, ordenadas. */
const lineasComo = (lineas: { nombre: string; cantidad: number }[]) =>
  lineas
    .map((l) => ({ nombre: l.nombre, cantidad: l.cantidad }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

const porNombre = (a: { nombre: string }, b: { nombre: string }) =>
  a.nombre.localeCompare(b.nombre);

// ------------------------------------------------------------------------------------------------
// 35 · Anular parte y todo (decisión 6)
// ------------------------------------------------------------------------------------------------
describe('criterio 35 · anular parte de la cantidad y toda (decisión 6)', () => {
  it('anula 2 de 3: el ítem queda con 1 vigente y sigue enviado; la respuesta cumple el contrato', async () => {
    const e = await esc();
    const c = await carta();
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo);
    const cuerpo = cuerpoDeAnulacion({
      cantidad: 2,
      destinoStock: 'VUELVE',
      motivo: 'Se equivocaron de plato',
    });
    const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
      autorizacion: auth.autorizacionId,
    });
    exigirEstado(res, 201, 'anular 2 de 3');
    const anulacion = anulacionRespuestaSchema.parse(res.body);
    expect(anulacion).toMatchObject({
      id: cuerpo.id,
      itemId: o.combo.id,
      cantidad: 2,
      motivo: 'Se equivocaron de plato',
      destinoStock: 'VUELVE',
      autorizadoPor: { id: e.A.supervisor.id, nombre: nombreDe(e.A.supervisor) },
    });
    expect(anulacion.item).toMatchObject({
      id: o.combo.id,
      productoId: c.comboId,
      cantidad: 3,
      cantidadAnulada: 2,
      cantidadVigente: 1,
      estado: 'ENVIADO',
      precioUnitario: PRECIO.combo,
      totalVigente: PRECIO.combo,
    });

    // La orden refleja el total vigente: 61.00 + 27.40 + 18.00.
    const orden = ordenRespuestaSchema.parse(await leerOrden(ctx, mozo.token, o.ordenId));
    expect(orden.total).toBe('106.40');
    expect(orden.estado).toBe('ABIERTA');
    const guardadas = await anulacionesDelItem(admin, o.combo.id);
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({
      id: cuerpo.id,
      cantidad: 2,
      motivo: 'Se equivocaron de plato',
      destino_stock: 'VUELVE',
      autorizado_por_id: e.A.supervisor.id,
      autorizacion_id: auth.autorizacionId,
      de_orden: false,
    });
  });

  it('anula el resto: con la vigente en 0 el ítem pasa a ANULADO y su total vigente es 0.00', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const primera = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
      { autorizacion: (await clave(mozo)).autorizacionId },
    );
    exigirEstado(primera, 201, 'primera anulación');
    const segunda = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
      { autorizacion: (await clave(mozo)).autorizacionId },
    );
    exigirEstado(segunda, 201, 'segunda anulación');
    expect(segunda.body.item).toMatchObject({
      cantidad: 3,
      cantidadAnulada: 3,
      cantidadVigente: 0,
      estado: 'ANULADO',
      totalVigente: '0.00',
    });
    expect((await leerOrden(ctx, mozo.token, o.ordenId)).total).toBe('79.00');
    expect(await anulacionesDelItem(admin, o.combo.id)).toHaveLength(2);
  });

  it('anula toda la cantidad de una vez (la que propone la PWA)', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const res = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.gaseosa.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
    );
    exigirEstado(res, 201, 'anular toda la gaseosa');
    expect(res.body.cantidad).toBe(2);
    expect(res.body.item).toMatchObject({
      cantidadAnulada: 2,
      cantidadVigente: 0,
      estado: 'ANULADO',
    });
  });

  it('un ítem que ya está Listo en el KDS se anula igual y su línea pasa a ANULADO', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const o = await ordenNueva();
    const kds = comandasDelKds(await leerCocina(ctx, cocina));
    const lineaDelLomo = kds.flatMap((c) => c.lineas).find((l) => l.itemId === o.lomo.id);
    expect(lineaDelLomo, 'el KDS muestra la línea del lomo').toBeDefined();
    exigirEstado(
      await llamar(ctx, cocina, {
        metodo: 'put',
        ruta: `/cocina/lineas/${lineaDelLomo!.id}/estado`,
        cuerpo: { estado: 'LISTO' },
      }),
      200,
      'marcar Listo',
    );
    const res = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.lomo.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
    );
    exigirEstado(res, 201, 'anular un ítem que ya está Listo');
    const despues = comandasDelKds(await leerCocina(ctx, cocina))
      .flatMap((c) => c.lineas)
      .find((l) => l.id === lineaDelLomo!.id);
    expect(despues?.estado).toBe('ANULADO');
  });
});

// ------------------------------------------------------------------------------------------------
// 36 · La clave del Supervisor
// ------------------------------------------------------------------------------------------------
describe.each(['MOZO', 'CAJERO'] as const)(
  'criterio 36 · %s necesita la clave del Supervisor',
  (rol) => {
    describe.each(TIPOS_DE_SESION)('con sesión de %s', (tipo) => {
      it('sin X-Autorizacion responde 403 CLAVE_REQUERIDA y no cambia nada', async () => {
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const antes = await prepararRechazo();
        const res = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpoDeAnulacion());
        esperarError(res, 403, 'CLAVE_REQUERIDA');
        await exigirSinCambios(antes, 'sin clave');
      });

      it('con una autorización válida responde 201, la deja usada y deja la fila de 002 con quién pidió y quién autorizó', async () => {
        const e = await esc();
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const auth = await clave(quien, 'ANULAR_ITEM_ENVIADO', 'Autorizo el ceviche');
        const antes = await auditoriaSalon(admin, e.A.empresaId);
        const res = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: auth.autorizacionId,
        });
        exigirEstado(res, 201, 'anular con clave');
        expect(res.body.autorizadoPor).toMatchObject({ id: e.A.supervisor.id });

        const guardada = await autorizacionGuardada(admin, auth.autorizacionId);
        expect(guardada.usada_en).not.toBeNull();
        expect(cerca(guardada.usada_en!, ctx.reloj.ahora().getTime())).toBe(true);

        const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
        expect(nuevas.map((f) => f.accion).sort()).toEqual(['ANULAR_ITEM_ENVIADO', 'anular_item']);
        const consumo = nuevas.find((f) => f.accion === 'ANULAR_ITEM_ENVIADO')!;
        expect(consumo).toMatchObject({
          actor_usuario_id: quien.persona.id,
          autorizado_por_id: e.A.supervisor.id,
          autorizacion_id: auth.autorizacionId,
          motivo: 'Autorizo el ceviche',
          sucursal_id: e.A.S1,
        });
      });

      it('una autorización de otra acción (ANULAR_ORDEN) responde 403 AUTORIZACION_INVALIDA, no cambia nada y no se consume', async () => {
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const deOtraAccion = await clave(quien, 'ANULAR_ORDEN');
        const antes = await prepararRechazo();
        const res = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: deOtraAccion.autorizacionId,
        });
        esperarError(res, 403, 'AUTORIZACION_INVALIDA');
        await exigirSinCambios(antes, 'autorización de otra acción');
        expect(
          (await autorizacionGuardada(admin, deOtraAccion.autorizacionId)).usada_en,
        ).toBeNull();
      });

      it('una autorización inexistente responde 403 AUTORIZACION_INVALIDA con el mismo cuerpo', async () => {
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const deOtraAccion = await clave(quien, 'ANULAR_ORDEN');
        const a = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: randomUUID(),
        });
        const b = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: deOtraAccion.autorizacionId,
        });
        esperarError(a, 403, 'AUTORIZACION_INVALIDA');
        expect(a.body).toEqual(b.body);
      });

      it('una autorización vencida (a los 2 minutos exactos) responde 403; con una nueva y la misma clave la anulación sale', async () => {
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const vieja = await clave(quien);
        ctx.reloj.avanzar(2 * MINUTO);
        const antes = await prepararRechazo();
        const cuerpo = cuerpoDeAnulacion({ cantidad: 2 });
        const claveDeIdempotencia = randomUUID();
        const vencida = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpo, {
          clave: claveDeIdempotencia,
          autorizacion: vieja.autorizacionId,
        });
        esperarError(vencida, 403, 'AUTORIZACION_INVALIDA');
        await exigirSinCambios(antes, 'autorización vencida');

        // La PWA pide la clave otra vez y conserva lo elegido (misma clave, mismo cuerpo): el error no se guardó.
        const nueva = await clave(quien);
        const reintento = await anularItem(ctx, quien.token, o.ordenId, o.combo.id, cuerpo, {
          clave: claveDeIdempotencia,
          autorizacion: nueva.autorizacionId,
        });
        exigirEstado(reintento, 201, 'reintento con la autorización nueva');
        expect(reintento.body).toMatchObject({ id: cuerpo.id, cantidad: 2 });
      });
    });
  },
);

describe.each(['SUPERVISOR', 'ADMINISTRADOR'] as const)(
  'criterio 36 · %s anula sin clave',
  (rol) => {
    it.each(TIPOS_DE_SESION)(
      'con sesión de %s: 201, sin autorizador y sin consumo de autorización',
      async (tipo) => {
        const e = await esc();
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const antes = await auditoriaSalon(admin, e.A.empresaId);
        const res = await anularItem(
          ctx,
          quien.token,
          o.ordenId,
          o.lomo.id,
          cuerpoDeAnulacion({ cantidad: 2 }),
        );
        exigirEstado(res, 201, `${rol} anula sin clave`);
        expect(anulacionRespuestaSchema.parse(res.body).autorizadoPor).toBeNull();
        const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
        const fila = unaFilaDe(nuevas, 'anular_item');
        expect(fila).toMatchObject({
          actor_usuario_id: quien.persona.id,
          autorizado_por_id: null,
          autorizacion_id: null,
        });
        const [guardada] = await anulacionesDelItem(admin, o.lomo.id);
        expect(guardada).toMatchObject({ autorizado_por_id: null, autorizacion_id: null });
      },
    );
  },
);

describe('criterio 36 · Cocina/Barra no anula', () => {
  it.each(TIPOS_DE_SESION)(
    'con sesión de %s: 403 PROHIBIDO, con o sin autorización, y no cambia nada',
    async (tipo) => {
      const cocina = await actor('COCINA_BARRA', tipo);
      const o = await ordenNueva();
      // Una autorización de otra persona en poder de Cocina/Barra tampoco le sirve.
      const mozo = await actor('MOZO', 'contrasena');
      const ajena = await clave(mozo);
      const antes = await prepararRechazo();
      for (const autorizacion of [null, ajena.autorizacionId]) {
        const res = await anularItem(
          ctx,
          cocina.token,
          o.ordenId,
          o.combo.id,
          cuerpoDeAnulacion(),
          { autorizacion },
        );
        esperarError(res, 403, 'PROHIBIDO');
      }
      const ids = await anularItem(
        ctx,
        cocina.token,
        randomUUID(),
        randomUUID(),
        cuerpoDeAnulacion(),
      );
      esperarError(ids, 403, 'PROHIBIDO');
      await exigirSinCambios(antes, 'Cocina/Barra');
      expect((await autorizacionGuardada(admin, ajena.autorizacionId)).usada_en).toBeNull();
    },
  );
});

describe('criterio 36 · el orden de los rechazos', () => {
  it('sin Idempotency-Key responde 400 DATOS_INVALIDOS (campos en Idempotency-Key) antes que 403, sin consumir la autorización', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo);
    const antes = await prepararRechazo();
    const sinClave = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
      clave: null,
    });
    esperarError(sinClave, 400, 'DATOS_INVALIDOS');
    expect(JSON.stringify(sinClave.body.campos)).toContain('Idempotency-Key');
    const conAutorizacion = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion(),
      { clave: null, autorizacion: auth.autorizacionId },
    );
    esperarError(conAutorizacion, 400, 'DATOS_INVALIDOS');
    await exigirSinCambios(antes, 'sin Idempotency-Key');
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
  });

  it('un cuerpo inválido responde 400 antes que 403 CLAVE_REQUERIDA', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, {
      ...cuerpoDeAnulacion(),
      cantidad: 0,
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
  });

  it('el 403 de clave va antes que el 404: sin autorización, un ítem inexistente responde CLAVE_REQUERIDA', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const res = await anularItem(ctx, mozo.token, randomUUID(), randomUUID(), cuerpoDeAnulacion());
    esperarError(res, 403, 'CLAVE_REQUERIDA');
  });
});

// ------------------------------------------------------------------------------------------------
// 36 · El consumo se revierte si la anulación falla
// ------------------------------------------------------------------------------------------------
describe.each(TIPOS_DE_SESION)(
  'criterio 36 · si la anulación falla después de consumir la autorización, el consumo se revierte (sesión de %s)',
  (tipo) => {
    /** La autorización sigue disponible, no quedó nada guardado y un intento válido después sale. */
    async function exigirRevertido(
      quien: Actor,
      o: OrdenConItems,
      auth: { autorizacionId: string },
      antes: Awaited<ReturnType<typeof foto>>,
      ordenId = o.ordenId,
    ) {
      const guardada = await autorizacionGuardada(admin, auth.autorizacionId);
      expect(guardada.usada_en, 'la autorización sigue sin usar').toBeNull();
      expect(
        await filasDe(admin, 'auditoria', `autorizacion_id = $1 AND accion = ANY($2::text[])`, [
          auth.autorizacionId,
          ['ANULAR_ITEM_ENVIADO', 'ANULAR_ORDEN', 'anular_item', 'anular_orden'],
        ]),
        'ninguna fila de auditoría con esa autorización',
      ).toHaveLength(0);
      expect((await foto()).tablas).toEqual(antes.tablas);
      expect((await foto()).auditoria).toEqual(antes.auditoria);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
      // Sigue disponible hasta que venza (002, criterio 50).
      const bien = await anularItem(ctx, quien.token, ordenId, o.combo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(bien, 201, 'la misma autorización sirve después del fallo');
    }

    it('422 por una cantidad mayor que la vigente', async () => {
      const mozo = await actor('MOZO', tipo);
      const o = await ordenNueva();
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      const res = await anularItem(
        ctx,
        mozo.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 4 }),
        { autorizacion: auth.autorizacionId },
      );
      esperarError(res, 422, 'DATOS_INVALIDOS');
      await exigirRevertido(mozo, o, auth, antes);
    });

    it('409 por un ítem ya anulado', async () => {
      const mozo = await actor('MOZO', tipo);
      const supervisor = await actor('SUPERVISOR', 'contrasena');
      const o = await ordenNueva();
      exigirEstado(
        await anularItem(
          ctx,
          supervisor.token,
          o.ordenId,
          o.combo.id,
          cuerpoDeAnulacion({ cantidad: 3 }),
        ),
        201,
        'anular todo el combo',
      );
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      esperarError(res, 409, 'ITEM_NO_ANULABLE');
      // El intento válido de `exigirRevertido` anula un ítem distinto: el lomo.
      expect((await foto()).tablas).toEqual(antes.tablas);
      expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
      const bien = await anularItem(ctx, mozo.token, o.ordenId, o.lomo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(bien, 201, 'la misma autorización sirve en otro ítem');
    });

    it('409 por una orden que ya no está abierta', async () => {
      const mozo = await actor('MOZO', tipo);
      const supervisor = await actor('SUPERVISOR', 'contrasena');
      const o = await ordenNueva();
      exigirEstado(await anularOrden(ctx, supervisor.token, o.ordenId), 200, 'anular la orden');
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      esperarError(res, 409, 'ORDEN_NO_ABIERTA');
      await exigirSinCambios(antes, 'orden no abierta');
      expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
    });

    it('404 por un ítem de otra orden de la misma sucursal', async () => {
      const mozo = await actor('MOZO', tipo);
      const o1 = await ordenNueva();
      const o2 = await ordenNueva();
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      const res = await anularItem(ctx, mozo.token, o1.ordenId, o2.combo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      esperarError(res, 404, 'NO_ENCONTRADO');
      await exigirSinCambios(antes, 'ítem de otra orden');
      expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
    });

    it('el puerto de inventario lanza un ErrorAplicacion: la respuesta es ese error y nada queda guardado ni publicado', async () => {
      const mozo = await actor('MOZO', tipo);
      const o = await ordenNueva();
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      ctx.inventario.lanzarAlAnular(
        new ErrorAplicacion(422, 'DATOS_INVALIDOS', 'El inventario no permite la anulación'),
      );
      try {
        const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: auth.autorizacionId,
        });
        esperarError(res, 422, 'DATOS_INVALIDOS');
        expect(res.body.mensaje).toBe('El inventario no permite la anulación');
      } finally {
        ctx.inventario.lanzarAlAnular(null);
      }
      expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
      expect((await foto()).tablas).toEqual(antes.tablas);
      expect((await foto()).auditoria).toEqual(antes.auditoria);
      await asentar();
      expect(ctx.publicador.eventos()).toEqual([]);
      ctx.inventario.limpiar();
      const bien = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(bien, 201, 'la misma autorización sirve después del fallo del inventario');
    });

    it('el puerto de inventario lanza un error cualquiera: 500 sin detalles y el consumo se revierte', async () => {
      const mozo = await actor('MOZO', tipo);
      const o = await ordenNueva();
      const auth = await clave(mozo);
      const antes = await prepararRechazo();
      ctx.inventario.lanzarAlAnular(new Error('Falla del inventario'));
      try {
        const res = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion(), {
          autorizacion: auth.autorizacionId,
        });
        esperarError(res, 500, 'ERROR_INTERNO');
        expect(res.text).not.toContain('Falla del inventario');
      } finally {
        ctx.inventario.lanzarAlAnular(null);
      }
      await exigirRevertido(mozo, o, auth, antes);
    });
  },
);

// ------------------------------------------------------------------------------------------------
// 37 · Réplicas
// ------------------------------------------------------------------------------------------------
describe('criterio 37 · la réplica no anula ni consume de nuevo', () => {
  it.each(TIPOS_DE_SESION)(
    'la misma Idempotency-Key, el mismo cuerpo y la misma autorización devuelven lo guardado sin otra anulación (Mozo, sesión de %s)',
    async (tipo) => {
      const mozo = await actor('MOZO', tipo);
      const o = await ordenNueva();
      const auth = await clave(mozo);
      const cuerpo = cuerpoDeAnulacion({ cantidad: 2 });
      const claveDeIdempotencia = randomUUID();
      const primera = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
        clave: claveDeIdempotencia,
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(primera, 201, 'primera petición');
      const usadaEn = (await autorizacionGuardada(admin, auth.autorizacionId)).usada_en;
      expect(usadaEn).not.toBeNull();

      ctx.reloj.avanzar(30_000);
      const antes = await prepararRechazo();
      for (let i = 0; i < 3; i++) {
        const replica = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
          clave: claveDeIdempotencia,
          autorizacion: auth.autorizacionId,
        });
        expect(replica.status, JSON.stringify(replica.body)).toBe(201);
        expect(replica.body).toEqual(primera.body);
      }
      await exigirSinCambios(antes, 'réplica');
      expect(
        (await autorizacionGuardada(admin, auth.autorizacionId)).usada_en,
        'la autorización no se consumió otra vez',
      ).toEqual(usadaEn);
      expect(ctx.inventario.alAnularLlamadas(), 'una sola llamada al inventario').toHaveLength(1);
      expect(await anulacionesDelItem(admin, o.combo.id)).toHaveLength(1);
      expect(
        await filasDe(
          admin,
          'auditoria',
          `autorizacion_id = $1 AND accion = 'ANULAR_ITEM_ENVIADO'`,
          [auth.autorizacionId],
        ),
      ).toHaveLength(1);
      expect(await comandasDeAnulacion(admin, o.ordenId)).toHaveLength(2);
      const orden = await leerOrden(ctx, mozo.token, o.ordenId);
      expect(orden.items.find((i) => i.id === o.combo.id)).toMatchObject({
        cantidadAnulada: 2,
        cantidadVigente: 1,
      });
    },
  );

  it('el Supervisor (sin clave) repite la petición con la misma clave: devuelve lo guardado, sin otra fila de auditoría', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const claveDeIdempotencia = randomUUID();
    const primera = await anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpo, {
      clave: claveDeIdempotencia,
    });
    exigirEstado(primera, 201, 'primera petición');
    const antes = await prepararRechazo();
    const replica = await anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpo, {
      clave: claveDeIdempotencia,
    });
    expect(replica.status).toBe(201);
    expect(replica.body).toEqual(primera.body);
    await exigirSinCambios(antes, 'réplica del Supervisor');
    expect(
      (await auditoriaSalon(admin, e.A.empresaId, { entidadId: o.lomo.id })).filter(
        (f) => f.accion === 'anular_item',
      ),
    ).toHaveLength(1);
  });

  it('la réplica se reconoce antes de mirar el estado: llega aunque la orden ya se haya anulado', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo);
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const claveDeIdempotencia = randomUUID();
    const primera = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
      clave: claveDeIdempotencia,
      autorizacion: auth.autorizacionId,
    });
    exigirEstado(primera, 201, 'primera petición');
    exigirEstado(await anularOrden(ctx, supervisor.token, o.ordenId), 200, 'anular la orden');
    const replica = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
      clave: claveDeIdempotencia,
      autorizacion: auth.autorizacionId,
    });
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body).toEqual(primera.body);
  });

  it('seis réplicas simultáneas con la misma clave y la misma autorización dejan una sola anulación y un solo consumo', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo);
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const claveDeIdempotencia = randomUUID();
    const peticion = () =>
      anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
        clave: claveDeIdempotencia,
        autorizacion: auth.autorizacionId,
      });
    const respuestas = await Promise.all(Array.from({ length: 6 }, peticion));
    const exitosas = respuestas.filter((r) => r.status === 201);
    expect(exitosas.length, JSON.stringify(respuestas.map((r) => r.body))).toBeGreaterThanOrEqual(
      1,
    );
    for (const r of respuestas) {
      if (r.status === 201) expect(r.body).toEqual(exitosas[0]!.body);
      else esperarError(r, 409, 'CONFLICTO');
    }
    expect(await anulacionesDelItem(admin, o.combo.id)).toHaveLength(1);
    expect(
      await filasDe(admin, 'auditoria', `autorizacion_id = $1 AND accion = 'ANULAR_ITEM_ENVIADO'`, [
        auth.autorizacionId,
      ]),
    ).toHaveLength(1);
    expect(
      ctx.inventario.alAnularLlamadas().filter((l) => l.anulacionId === cuerpo.id),
    ).toHaveLength(1);
    const repetida = await peticion();
    expect(repetida.status).toBe(201);
    expect(repetida.body).toEqual(exitosas[0]!.body);
    expect(
      (await leerOrden(ctx, mozo.token, o.ordenId)).items.find((i) => i.id === o.combo.id),
    ).toMatchObject({ cantidadAnulada: 1 });
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA sin consumir la autorización nueva', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const claveDeIdempotencia = randomUUID();
    const primera = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
      { clave: claveDeIdempotencia, autorizacion: (await clave(mozo)).autorizacionId },
    );
    exigirEstado(primera, 201, 'primera petición');
    const nueva = await clave(mozo);
    const antes = await prepararRechazo();
    const otraCantidad = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
      { clave: claveDeIdempotencia, autorizacion: nueva.autorizacionId },
    );
    esperarError(otraCantidad, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    await exigirSinCambios(antes, 'misma clave, otro cuerpo');
    expect((await autorizacionGuardada(admin, nueva.autorizacionId)).usada_en).toBeNull();
  });
});

describe('criterio 37 · el mismo id de anulación', () => {
  it('con otra clave y sin autorización, el Mozo recibe 403 CLAVE_REQUERIDA (la clave se evalúa antes que la réplica por id)', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const auth = await clave(mozo);
    exigirEstado(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
        autorizacion: auth.autorizacionId,
      }),
      201,
      'primera anulación',
    );
    const antes = await prepararRechazo();
    esperarError(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo),
      403,
      'CLAVE_REQUERIDA',
    );
    // La misma autorización, ya usada, tampoco sirve para otra clave de idempotencia.
    esperarError(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
        autorizacion: auth.autorizacionId,
      }),
      403,
      'AUTORIZACION_INVALIDA',
    );
    await exigirSinCambios(antes, 'mismo id, otra clave, sin autorización nueva');
  });

  it('con otra clave y una autorización nueva devuelve la anulación existente, consume la autorización nueva y no anula de nuevo', async () => {
    const e = await esc();
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 2 });
    const primeraAuth = await clave(mozo);
    const primera = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
      autorizacion: primeraAuth.autorizacionId,
    });
    exigirEstado(primera, 201, 'primera anulación');

    const segundaAuth = await clave(mozo, 'ANULAR_ITEM_ENVIADO', 'Otra vez la clave');
    const antesAuditoria = await auditoriaSalon(admin, e.A.empresaId);
    await asentar();
    ctx.publicador.limpiar();
    const segunda = await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
      autorizacion: segundaAuth.autorizacionId,
    });
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
    expect(segunda.body).toMatchObject({
      id: cuerpo.id,
      itemId: o.combo.id,
      cantidad: 2,
      destinoStock: cuerpo.destinoStock,
    });
    expect(segunda.body.item).toMatchObject({ cantidadAnulada: 2, cantidadVigente: 1 });
    expect(segunda.body.comandas.map((c: { id: string }) => c.id).sort()).toEqual(
      primera.body.comandas.map((c: { id: string }) => c.id).sort(),
    );

    // La autorización nueva queda usada y lo dice su fila de 002; no hay otra anulación ni otro `anular_item`.
    expect((await autorizacionGuardada(admin, segundaAuth.autorizacionId)).usada_en).not.toBeNull();
    const nuevas = await auditoriaNueva(admin, e.A.empresaId, antesAuditoria);
    expect(nuevas.map((f) => f.accion)).toEqual(['ANULAR_ITEM_ENVIADO']);
    expect(nuevas[0]).toMatchObject({ autorizacion_id: segundaAuth.autorizacionId });
    expect(await anulacionesDelItem(admin, o.combo.id)).toHaveLength(1);
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(await comandasDeAnulacion(admin, o.ordenId)).toHaveLength(2);
    expect(eventosDe(ctx, 'cocina.comanda')).toEqual([]);
  });

  it('con otra clave, el Supervisor recibe la anulación existente sin anular de nuevo', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const primera = await anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpo);
    exigirEstado(primera, 201, 'primera anulación');
    const antes = await prepararRechazo();
    const segunda = await anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpo);
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
    expect(segunda.body).toMatchObject({ id: cuerpo.id, itemId: o.lomo.id, cantidad: 1 });
    await exigirSinCambios(antes, 'mismo id, otra clave');
  });

  it('con otra cantidad, otro ítem u otro destino responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no cambia nada', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1, destinoStock: 'MERMA' });
    exigirEstado(
      await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo),
      201,
      'primera anulación',
    );
    const antes = await prepararRechazo();
    const variantes: [string, Promise<{ status: number; body: unknown; text: string }>][] = [
      [
        'otra cantidad',
        anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, { ...cuerpo, cantidad: 2 }),
      ],
      ['otro ítem', anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpo)],
      [
        'otro destino',
        anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, {
          ...cuerpo,
          destinoStock: 'VUELVE',
        }),
      ],
    ];
    for (const [que, promesa] of variantes) {
      const res = await promesa;
      expect(res.status, `${que}: ${res.text}`).toBe(422);
      expect(res.body, que).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
    }
    await exigirSinCambios(antes, 'mismo id con otro cuerpo');
  });

  it('con otra cantidad y una autorización nueva el Mozo recibe 422 y la autorización nueva no se consume', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    exigirEstado(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpo, {
        autorizacion: (await clave(mozo)).autorizacionId,
      }),
      201,
      'primera anulación',
    );
    const nueva = await clave(mozo);
    const antes = await prepararRechazo();
    const res = await anularItem(
      ctx,
      mozo.token,
      o.ordenId,
      o.combo.id,
      { ...cuerpo, cantidad: 2 },
      { autorizacion: nueva.autorizacionId },
    );
    esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    await exigirSinCambios(antes, 'mismo id, otra cantidad, autorización nueva');
    expect((await autorizacionGuardada(admin, nueva.autorizacionId)).usada_en).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// 35 · Cantidad, estado e ítem inválidos
// ------------------------------------------------------------------------------------------------
describe('criterio 35 · cantidad, estado e ítem inválidos', () => {
  it('una cantidad mayor que la vigente responde 422 DATOS_INVALIDOS con campos en cantidad, también después de una anulación parcial', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const antes = await prepararRechazo();
    const mucha = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 4 }),
    );
    esperarError(mucha, 422, 'DATOS_INVALIDOS');
    expect(JSON.stringify(mucha.body.campos)).toContain('cantidad');
    await exigirSinCambios(antes, 'cantidad mayor que la vigente');

    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'anulación parcial',
    );
    const otraVez = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
    );
    esperarError(otraVez, 422, 'DATOS_INVALIDOS');
    expect(JSON.stringify(otraVez.body.campos)).toContain('cantidad');
  });

  it('un cuerpo mal formado responde 400 DATOS_INVALIDOS y no cambia nada', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const base = cuerpoDeAnulacion();
    const antes = await prepararRechazo();
    const malos: [string, unknown][] = [
      ['cantidad 0', { ...base, cantidad: 0 }],
      ['cantidad negativa', { ...base, cantidad: -1 }],
      ['cantidad decimal', { ...base, cantidad: 1.5 }],
      ['cantidad como texto', { ...base, cantidad: '1' }],
      ['cantidad 1000', { ...base, cantidad: 1000 }],
      ['sin cantidad', { id: base.id, motivo: base.motivo, destinoStock: base.destinoStock }],
      ['motivo vacío', { ...base, motivo: '' }],
      ['motivo de espacios', { ...base, motivo: '   ' }],
      ['motivo de 301 caracteres', { ...base, motivo: 'm'.repeat(301) }],
      ['sin motivo', { id: base.id, cantidad: 1, destinoStock: base.destinoStock }],
      ['destino desconocido', { ...base, destinoStock: 'BASURA' }],
      ['sin destino', { id: base.id, cantidad: 1, motivo: base.motivo }],
      ['id que no es UUID', { ...base, id: 'no-es-un-uuid' }],
      ['sin id', { cantidad: 1, motivo: base.motivo, destinoStock: base.destinoStock }],
      ['campo desconocido', { ...base, sucursalId: randomUUID() }],
      ['autorizadoPor en el cuerpo', { ...base, autorizadoPor: randomUUID() }],
    ];
    for (const [que, cuerpo] of malos) {
      const res = await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo);
      expect(res.status, `${que}: ${res.text}`).toBe(400);
      expect(res.body, que).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    }
    await exigirSinCambios(antes, 'cuerpos mal formados');
  });

  it('un ítem ya anulado responde 409 ITEM_NO_ANULABLE y una orden anulada, 409 ORDEN_NO_ABIERTA', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.gaseosa.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'anular la gaseosa',
    );
    const antes = await prepararRechazo();
    esperarError(
      await anularItem(ctx, supervisor.token, o.ordenId, o.gaseosa.id, cuerpoDeAnulacion()),
      409,
      'ITEM_NO_ANULABLE',
    );
    await exigirSinCambios(antes, 'ítem ya anulado');

    exigirEstado(await anularOrden(ctx, supervisor.token, o.ordenId), 200, 'anular la orden');
    const despues = await prepararRechazo();
    esperarError(
      await anularItem(ctx, supervisor.token, o.ordenId, o.lomo.id, cuerpoDeAnulacion()),
      409,
      'ORDEN_NO_ABIERTA',
    );
    await exigirSinCambios(despues, 'orden anulada');
  });

  it('un ítem de otra orden, de otra sucursal o inexistente responde 404 NO_ENCONTRADO con el mismo cuerpo', async () => {
    const e = await esc();
    const c = await carta();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o1 = await ordenNueva();
    const o2 = await ordenNueva();
    // Una orden de S2 abierta por la persona que es Mozo en S2.
    const mozoS2 = (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena;
    const deS2 = await ordenConItems(ctx, await mesasS2(), c, mozoS2);
    const admin1 = await actor('ADMINISTRADOR', 'contrasena');
    const antes = await prepararRechazo();

    const deOtraOrden = await anularItem(
      ctx,
      supervisor.token,
      o1.ordenId,
      o2.combo.id,
      cuerpoDeAnulacion(),
    );
    const deOtraSucursal = await anularItem(
      ctx,
      admin1.token,
      deS2.ordenId,
      deS2.combo.id,
      cuerpoDeAnulacion(),
    );
    const inexistente = await anularItem(
      ctx,
      supervisor.token,
      o1.ordenId,
      randomUUID(),
      cuerpoDeAnulacion(),
    );
    const ordenInexistente = await anularItem(
      ctx,
      supervisor.token,
      randomUUID(),
      o1.combo.id,
      cuerpoDeAnulacion(),
    );
    for (const res of [deOtraOrden, deOtraSucursal, inexistente, ordenInexistente]) {
      esperarError(res, 404, 'NO_ENCONTRADO');
    }
    expect(deOtraOrden.body).toEqual(inexistente.body);
    expect(deOtraSucursal.body).toEqual(inexistente.body);
    expect(ordenInexistente.body).toEqual(inexistente.body);
    await exigirSinCambios(antes, 'ítems ajenos');
  });
});

// ------------------------------------------------------------------------------------------------
// 38 y 39 · El ticket de anulación por estación y el inventario
// ------------------------------------------------------------------------------------------------
describe('criterio 38 · una comanda ANULACION por estación, con la cantidad de cada parte', () => {
  it('anular 2 de 3 combos: Cocina recibe la hamburguesa × 2 y Barra la cerveza × 2; la línea original muestra la vigente', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const o = await ordenNueva();
    const motivo = 'Se enfrió esperando';
    await asentar();
    ctx.publicador.limpiar();
    const cuerpo = cuerpoDeAnulacion({ cantidad: 2, motivo });
    const res = await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo);
    exigirEstado(res, 201, 'anular 2 de 3 combos');
    const anulacion = anulacionRespuestaSchema.parse(res.body);

    // Una comanda por estación: Cocina y Barra, de tipo ANULACION y para el KDS.
    expect(anulacion.comandas).toHaveLength(2);
    expect(anulacion.comandas.map((x) => x.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    for (const x of anulacion.comandas) {
      expect(x).toMatchObject({ tipo: 'ANULACION', destino: 'KDS' });
    }

    const kds = comandasDelKds(await leerCocina(ctx, cocina));
    const porEstacion = Object.fromEntries(
      anulacion.comandas.map((x) => [x.estacionNombre, kds.find((k) => k.id === x.id)]),
    );
    expect(porEstacion.Cocina, 'la comanda de Cocina está en el KDS').toBeDefined();
    expect(porEstacion.Barra, 'la comanda de Barra está en el KDS').toBeDefined();
    expect(lineasComo(porEstacion.Cocina!.lineas)).toEqual([
      { nombre: 'Hamburguesa clásica', cantidad: 2 },
    ]);
    expect(lineasComo(porEstacion.Barra!.lineas)).toEqual([
      { nombre: 'Cerveza Pilsen', cantidad: 2 },
    ]);
    for (const k of Object.values(porEstacion)) {
      expect(k!.tipo).toBe('ANULACION');
      expect(k!.orden.id).toBe(o.ordenId);
      expect(k!.orden.mesas.map((m) => m.id)).toEqual([o.mesa.id]);
      expect(k!.orden.mesas.map((m) => m.nombre)).toEqual([o.mesa.nombre]);
    }

    // El motivo del ticket: `comandaKds` no lo trae (el contrato de la fase A no tiene `motivo`), así que se
    // comprueba el vínculo con la anulación que lo guarda: la comanda nace de la anulación (`origen_id`).
    const filas = await comandasDeAnulacion(admin, o.ordenId);
    expect(filas.map((f) => f.id).sort()).toEqual(anulacion.comandas.map((x) => x.id).sort());
    for (const f of filas) expect(f.origen_id).toBe(cuerpo.id);
    const [guardada] = await anulacionesDelItem(admin, o.combo.id);
    expect(guardada).toMatchObject({ id: cuerpo.id, motivo });

    // En el KDS, la línea original muestra la cantidad vigente (1) y sigue sin anularse.
    const originales = kds
      .filter((k) => k.tipo === 'COMANDA' && k.orden.id === o.ordenId)
      .flatMap((k) => k.lineas)
      .filter((l) => l.itemId === o.combo.id);
    expect(lineasComo(originales)).toEqual([
      { nombre: 'Cerveza Pilsen', cantidad: 1 },
      { nombre: 'Hamburguesa clásica', cantidad: 1 },
    ]);
    for (const l of originales) expect(l.estado).not.toBe('ANULADO');

    // Eventos: una `cocina.comanda` por comanda, `orden.cambio` y nada de otra empresa.
    await asentar();
    const comandas = eventosDe(ctx, 'cocina.comanda');
    expect(
      comandas
        .map((x) => x.datos)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      anulacion.comandas
        .map((x) => ({ comandaId: x.id, estacionId: x.estacionId, tipo: 'ANULACION' }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect(eventosDe(ctx, 'orden.cambio').map((x) => x.datos)).toEqual([{ ordenId: o.ordenId }]);
    for (const ev of ctx.publicador.eventos()) {
      expect(ev).toMatchObject({
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
      });
    }
  });

  it('anular el resto de los combos: las dos líneas originales pasan a ANULADO y el ítem las cuenta anuladas', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const o = await ordenNueva();
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'primera anulación',
    );
    const res = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.combo.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
    );
    exigirEstado(res, 201, 'segunda anulación');
    const kds = comandasDelKds(await leerCocina(ctx, cocina));
    const segundaPorEstacion = res.body.comandas.map((x: { id: string }) =>
      kds.find((k) => k.id === x.id)!,
    );
    for (const k of segundaPorEstacion) {
      expect(k.lineas).toHaveLength(1);
      expect(k.lineas[0]!.cantidad).toBe(1);
    }
    const originales = kds
      .filter((k) => k.tipo === 'COMANDA' && k.orden.id === o.ordenId)
      .flatMap((k) => k.lineas)
      .filter((l) => l.itemId === o.combo.id);
    expect(originales).toHaveLength(2);
    for (const l of originales) expect(l.estado).toBe('ANULADO');
    const item = (await leerOrden(ctx, supervisor.token, o.ordenId)).items.find(
      (i) => i.id === o.combo.id,
    )!;
    expect(item.cocina).toMatchObject({ anulado: 2, enviado: 0, enPreparacion: 0, listo: 0 });
  });

  it('el lomo con Huevo (la misma estación) da una sola comanda de Cocina; la gaseosa, sin estación, no da ninguna', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const e = await esc();
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const o = await ordenNueva();
    const lomo = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.lomo.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
    );
    exigirEstado(lomo, 201, 'anular el lomo');
    expect(lomo.body.comandas).toHaveLength(1);
    expect(lomo.body.comandas[0]).toMatchObject({ estacionNombre: 'Cocina', tipo: 'ANULACION' });
    const kds = comandasDelKds(await leerCocina(ctx, cocina));
    const comanda = kds.find((k) => k.id === lomo.body.comandas[0].id)!;
    expect(lineasComo(comanda.lineas)).toEqual([{ nombre: 'Lomo saltado', cantidad: 1 }]);

    ctx.inventario.limpiar();
    const gaseosa = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.gaseosa.id,
      cuerpoDeAnulacion({ cantidad: 2 }),
    );
    exigirEstado(gaseosa, 201, 'anular la gaseosa');
    expect(gaseosa.body.comandas).toEqual([]);
    // Igual se llama al inventario: la gaseosa tiene control por unidades.
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(ctx.inventario.alAnularLlamadas()[0]!.partes).toEqual([
      {
        productoId: (await carta()).gaseosaId,
        nombre: 'Gaseosa 1 L',
        cantidad: 2,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });
});

describe('criterio 39 · el destino del stock y la llamada al inventario', () => {
  it.each(['VUELVE', 'MERMA'] as const)(
    'anular con destino %s llama una vez a alAnular con las partes de stock por la cantidad anulada',
    async (destinoStock) => {
      const e = await esc();
      const c = await carta();
      const supervisor = await actor('SUPERVISOR', 'contrasena');
      const o = await ordenNueva();
      ctx.inventario.limpiar();
      const cuerpo = cuerpoDeAnulacion({ cantidad: 2, destinoStock });
      const res = await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo);
      exigirEstado(res, 201, 'anular');
      const llamadas = ctx.inventario.alAnularLlamadas();
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0]).toMatchObject({
        sucursalId: e.A.S1,
        anulacionId: cuerpo.id,
        destino: destinoStock,
      });
      expect([...llamadas[0]!.partes].sort(porNombre)).toEqual(
        [
          {
            productoId: c.cervezaPilsenId,
            nombre: 'Cerveza Pilsen',
            cantidad: 2,
            tipoControlStock: 'UNIDADES',
          },
          {
            productoId: c.hamburguesaId,
            nombre: 'Hamburguesa clásica',
            cantidad: 2,
            tipoControlStock: 'PORCIONES',
          },
        ].sort(porNombre),
      );
      const [guardada] = await anulacionesDelItem(admin, o.combo.id);
      expect(guardada!.destino_stock).toBe(destinoStock);
      expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(0);
    },
  );

  it('el lomo con Huevo descuenta solo el Huevo frito (el lomo no tiene control de stock)', async () => {
    const c = await carta();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    ctx.inventario.limpiar();
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.lomo.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'anular el lomo',
    );
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(ctx.inventario.alAnularLlamadas()[0]!.partes).toEqual([
      {
        productoId: c.huevoFritoId,
        nombre: 'Huevo frito',
        cantidad: 2,
        tipoControlStock: 'UNIDADES',
      },
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
// 40 · Totales y pre-cuenta (decisión 10)
// ------------------------------------------------------------------------------------------------
describe('criterio 40 · la pre-cuenta se invalida también con una anulación parcial (decisión 10)', () => {
  it.each(['parcial', 'total'] as const)(
    'una anulación %s de un ítem devuelve la orden a ABIERTA, invalida la pre-cuenta y la mesa vuelve a rojo',
    async (alcance) => {
      const e = await esc();
      const mozo = await actor('MOZO', 'contrasena');
      const supervisor = await actor('SUPERVISOR', 'contrasena');
      const o = await ordenNueva();
      const precuenta = await pedirPrecuenta(ctx, mozo.token, o.ordenId);
      exigirEstado(precuenta, 201, 'pedir la pre-cuenta');
      expect(precuenta.body).toMatchObject({ numero: 1, total: '161.20' });
      expect((await mesaEnSalon(ctx, mozo.token, o.mesa.id)).estado).toBe('EN_PRECUENTA');
      expect((await leerOrden(ctx, mozo.token, o.ordenId)).estado).toBe('EN_PRECUENTA');

      await asentar();
      ctx.publicador.limpiar();
      const cantidad = alcance === 'parcial' ? 1 : 2;
      const res = await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.gaseosa.id,
        cuerpoDeAnulacion({ cantidad }),
      );
      exigirEstado(res, 201, 'anular');

      const orden = await leerOrden(ctx, mozo.token, o.ordenId);
      expect(orden.estado).toBe('ABIERTA');
      expect(orden.precuentaVigente).toBeNull();
      expect(orden.total).toBe(alcance === 'parcial' ? '152.20' : '143.20');
      expect((await mesaEnSalon(ctx, mozo.token, o.mesa.id)).estado).toBe('OCUPADA');
      const guardadas = await filasDe(admin, 'precuenta', 'orden_id = $1', [o.ordenId]);
      expect(guardadas).toHaveLength(1);
      expect(guardadas[0]!.invalidada_en).not.toBeNull();

      // La mesa cambió de estado: `salon.cambio` con la mesa y la orden.
      await asentar();
      expect(eventosDe(ctx, 'salon.cambio').map((x) => x.datos)).toEqual([
        { mesaIds: [o.mesa.id], ordenId: o.ordenId },
      ]);
      for (const ev of ctx.publicador.eventos()) {
        expect(ev).toMatchObject({
          empresaId: e.A.empresaId,
          sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        });
      }

      // La siguiente pre-cuenta tiene el número siguiente y el total nuevo.
      const otra = await pedirPrecuenta(ctx, mozo.token, o.ordenId);
      exigirEstado(otra, 201, 'pedir otra pre-cuenta');
      expect(otra.body).toMatchObject({
        numero: 2,
        total: alcance === 'parcial' ? '152.20' : '143.20',
      });
    },
  );

  it('el total vigente del ítem y el de la orden salen de packages/dominio: precio × vigente y la suma', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const res = await anularItem(
      ctx,
      supervisor.token,
      o.ordenId,
      o.lomo.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
    );
    exigirEstado(res, 201, 'anular un lomo');
    expect(res.body.item).toMatchObject({
      precioUnitario: PRECIO.lomoConHuevo,
      cantidadVigente: 1,
      totalVigente: PRECIO.lomoConHuevo,
    });
    const orden = await leerOrden(ctx, supervisor.token, o.ordenId);
    // 30.50 + 82.20 + 18.00
    expect(orden.total).toBe('130.70');
  });
});

// ------------------------------------------------------------------------------------------------
// 41 · Auditoría de la anulación de un ítem
// ------------------------------------------------------------------------------------------------
describe('criterio 41 · una fila anular_item con el autorizador y el detalle exacto', () => {
  it.each(TIPOS_DE_SESION)(
    'el Cajero con la clave del Supervisor (sesión de %s): el Cajero queda como autor, el Supervisor como autorizador y el equipo en la fila',
    async (tipo) => {
      const e = await esc();
      const c = await carta();
      const cajero = await actor('CAJERO', tipo);
      const o = await ordenNueva();
      const auth = await clave(cajero, 'ANULAR_ITEM_ENVIADO', 'Autorizo al cajero');
      const antes = await auditoriaSalon(admin, e.A.empresaId);
      const cuerpo = cuerpoDeAnulacion({
        cantidad: 1,
        motivo: 'Cliente alérgico al huevo',
        destinoStock: 'VUELVE',
      });
      const res = await anularItem(ctx, cajero.token, o.ordenId, o.lomo.id, cuerpo, {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(res, 201, 'anular con clave');

      const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
      expect(nuevas.map((f) => f.accion).sort()).toEqual(['ANULAR_ITEM_ENVIADO', 'anular_item']);
      const fila = nuevas.find((f) => f.accion === 'anular_item')!;
      expect(fila).toMatchObject({
        entidad: 'item',
        entidad_id: o.lomo.id,
        sucursal_id: e.A.S1,
        motivo: 'Cliente alérgico al huevo',
        actor_usuario_id: cajero.persona.id,
        actor_superadministrador_id: null,
        autorizado_por_id: e.A.supervisor.id,
        autorizacion_id: auth.autorizacionId,
        equipo_id: tipo === 'pin' ? cajero.equipoId : null,
      });
      expect(cerca(fila.ocurrido_en, ctx.reloj.ahora().getTime())).toBe(true);
      expect(fila.detalle).toEqual({
        ordenId: o.ordenId,
        productoId: c.lomoId,
        nombre: 'Lomo saltado',
        cantidadAnulada: 1,
        vigenteAntes: 2,
        vigenteDespues: 1,
        precioUnitario: PRECIO.lomoConHuevo,
        totalAnulado: PRECIO.lomoConHuevo,
        destinoStock: 'VUELVE',
      });
      const consumo = nuevas.find((f) => f.accion === 'ANULAR_ITEM_ENVIADO')!;
      expect(consumo).toMatchObject({
        actor_usuario_id: cajero.persona.id,
        autorizado_por_id: e.A.supervisor.id,
        autorizacion_id: auth.autorizacionId,
        motivo: 'Autorizo al cajero',
      });

      // La anulación del ítem, el ítem y la anulación guardada quedan a nombre del Cajero.
      const [guardada] = await anulacionesDelItem(admin, o.lomo.id);
      expect(guardada).toMatchObject({
        creado_por_usuario_id: cajero.persona.id,
        autorizado_por_id: e.A.supervisor.id,
      });
    },
  );

  it('el detalle de una anulación total de varios ítems de cantidad 3: vigenteAntes 3, vigenteDespues 0 y el total anulado exacto', async () => {
    const e = await esc();
    const c = await carta();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    const antes = await auditoriaSalon(admin, e.A.empresaId);
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 3, destinoStock: 'MERMA' }),
      ),
      201,
      'anular el combo',
    );
    const fila = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antes), 'anular_item');
    expect(fila.detalle).toEqual({
      ordenId: o.ordenId,
      productoId: c.comboId,
      nombre: 'Combo hamburguesa',
      cantidadAnulada: 3,
      vigenteAntes: 3,
      vigenteDespues: 0,
      precioUnitario: PRECIO.combo,
      totalAnulado: '82.20',
      destinoStock: 'MERMA',
    });
  });

  it('sin clave (Supervisor) no queda la fila ANULAR_ITEM_ENVIADO de 002, y la réplica no deja filas nuevas', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'pin');
    const o = await ordenNueva();
    const antes = await auditoriaSalon(admin, e.A.empresaId);
    const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
    const claveDeIdempotencia = randomUUID();
    exigirEstado(
      await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo, {
        clave: claveDeIdempotencia,
      }),
      201,
      'anular',
    );
    const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
    expect(nuevas.map((f) => f.accion)).toEqual(['anular_item']);
    expect(nuevas[0]).toMatchObject({
      actor_usuario_id: supervisor.persona.id,
      equipo_id: supervisor.equipoId,
    });
    exigirEstado(
      await anularItem(ctx, supervisor.token, o.ordenId, o.combo.id, cuerpo, {
        clave: claveDeIdempotencia,
      }),
      201,
      'réplica',
    );
    expect((await auditoriaNueva(admin, e.A.empresaId, antes)).map((f) => f.accion)).toEqual([
      'anular_item',
    ]);
  });

  it('los rechazos (409, 422, 403) no dejan fila de anular_item', async () => {
    const e = await esc();
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const antes = await auditoriaSalon(admin, e.A.empresaId);
    esperarError(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion()),
      403,
      'CLAVE_REQUERIDA',
    );
    const auth = await clave(mozo);
    esperarError(
      await anularItem(ctx, mozo.token, o.ordenId, o.combo.id, cuerpoDeAnulacion({ cantidad: 9 }), {
        autorizacion: auth.autorizacionId,
      }),
      422,
      'DATOS_INVALIDOS',
    );
    expect(await auditoriaNueva(admin, e.A.empresaId, antes)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
// 42 y 43 · Anular la orden
// ------------------------------------------------------------------------------------------------
describe('criterio 42 · anular la orden', () => {
  it.each(TIPOS_DE_SESION)(
    'el Mozo con la clave de ANULAR_ORDEN (sesión de %s): 200, orden ANULADA, mesa libre y todos los ítems anulados',
    async (tipo) => {
      const e = await esc();
      const mozo = await actor('MOZO', tipo);
      const o = await ordenNueva();
      const auth = await clave(mozo, 'ANULAR_ORDEN', 'Autorizo anular la mesa');
      const cuerpo = { motivo: 'Se fueron sin pagar', destinoStock: 'MERMA' as const };

      const res = await anularOrden(ctx, mozo.token, o.ordenId, cuerpo, {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(res, 200, 'anular la orden');
      const orden = ordenRespuestaSchema.parse(res.body);
      expect(orden).toMatchObject({
        id: o.ordenId,
        estado: 'ANULADA',
        sinConsumo: false,
        total: '0.00',
      });
      expect(cerca(orden.anuladaEn!, ctx.reloj.ahora().getTime())).toBe(true);
      expect(orden.items).toHaveLength(3);
      for (const item of orden.items) {
        expect(item, item.nombre).toMatchObject({
          cantidadVigente: 0,
          estado: 'ANULADO',
          totalVigente: '0.00',
        });
        expect(item.cantidadAnulada).toBe(item.cantidad);
      }

      // La mesa queda libre y vuelve a poder abrirse.
      const mesa = await mesaEnSalon(ctx, mozo.token, o.mesa.id);
      expect(mesa).toMatchObject({ estado: 'LIBRE', orden: null });
      const relaciones = await filasDe(admin, 'orden_mesa', 'orden_id = $1', [o.ordenId]);
      expect(relaciones.length).toBeGreaterThan(0);
      for (const r of relaciones) expect(r.hasta).not.toBeNull();
      exigirEstado(
        await abrirOrden(ctx, mozo.token, { mesaId: o.mesa.id }),
        201,
        'abrir de nuevo la mesa',
      );

      // La autorización quedó usada y la auditoría dice quién pidió y quién autorizó.
      expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).not.toBeNull();
      const consumo = await filasDe(
        admin,
        'auditoria',
        `autorizacion_id = $1 AND accion = 'ANULAR_ORDEN'`,
        [auth.autorizacionId],
      );
      expect(consumo).toHaveLength(1);
      expect(consumo[0]).toMatchObject({
        actor_usuario_id: mozo.persona.id,
        autorizado_por_id: e.A.supervisor.id,
        motivo: 'Autorizo anular la mesa',
      });
      // Los ítems se anulan con el motivo y el destino de la orden (decisión del usuario de 002).
      const anulaciones = await filasDe(admin, 'anulacion_item', 'orden_id = $1', [o.ordenId]);
      expect(anulaciones).toHaveLength(3);
      for (const a of anulaciones) {
        expect(a).toMatchObject({
          motivo: 'Se fueron sin pagar',
          destino_stock: 'MERMA',
          de_orden: true,
        });
      }
    },
  );

  it('crea las comandas ANULACION de los ítems por estación, llama una vez a alAnular con todas las partes y publica los eventos', async () => {
    const e = await esc();
    const c = await carta();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
    const o = await ordenNueva();
    // Un combo anulado en parte y la gaseosa anulada del todo: la orden se anula con lo que queda vigente.
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 1 }),
      ),
      201,
      'anulación parcial previa',
    );
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.gaseosa.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'anulación total previa',
    );
    const comandasAntes = new Set(
      (await comandasDeAnulacion(admin, o.ordenId)).map((f) => f.id as string),
    );
    await asentar();
    ctx.publicador.limpiar();
    ctx.inventario.limpiar();

    const res = await anularOrden(ctx, supervisor.token, o.ordenId, {
      motivo: 'Cierre del local',
      destinoStock: 'VUELVE',
    });
    exigirEstado(res, 200, 'anular la orden');
    const orden = ordenRespuestaSchema.parse(res.body);
    expect(orden.estado).toBe('ANULADA');
    const itemsPorId = new Map(orden.items.map((i) => [i.id, i]));
    expect(itemsPorId.get(o.lomo.id)).toMatchObject({
      cantidadAnulada: 2,
      cantidadVigente: 0,
      estado: 'ANULADO',
    });
    expect(itemsPorId.get(o.combo.id)).toMatchObject({
      cantidadAnulada: 3,
      cantidadVigente: 0,
      estado: 'ANULADO',
    });
    expect(itemsPorId.get(o.gaseosa.id)).toMatchObject({
      cantidadAnulada: 2,
      cantidadVigente: 0,
      estado: 'ANULADO',
    });

    // Las comandas nuevas, por estación, con la cantidad vigente que tenía cada parte.
    const nuevas = (await comandasDeAnulacion(admin, o.ordenId)).filter(
      (f) => !comandasAntes.has(f.id as string),
    );
    expect(nuevas.length).toBeGreaterThanOrEqual(2);
    const kds = comandasDelKds(await leerCocina(ctx, cocina));
    const lineasPorEstacion: Record<string, { nombre: string; cantidad: number }[]> = {};
    for (const fila of nuevas) {
      const k = kds.find((x) => x.id === fila.id)!;
      expect(k, `la comanda ${String(fila.id)} está en el KDS`).toBeDefined();
      expect(k.tipo).toBe('ANULACION');
      (lineasPorEstacion[k.estacion.nombre] ??= []).push(
        ...k.lineas.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad })),
      );
    }
    expect(Object.keys(lineasPorEstacion).sort()).toEqual(['Barra', 'Cocina']);
    expect(lineasComo(lineasPorEstacion.Cocina!)).toEqual([
      { nombre: 'Hamburguesa clásica', cantidad: 2 },
      { nombre: 'Lomo saltado', cantidad: 2 },
    ]);
    expect(lineasComo(lineasPorEstacion.Barra!)).toEqual([
      { nombre: 'Cerveza Pilsen', cantidad: 2 },
    ]);

    // Una sola llamada al inventario con todas las partes (la gaseosa ya estaba anulada).
    const llamadas = ctx.inventario.alAnularLlamadas();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ sucursalId: e.A.S1, destino: 'VUELVE' });
    expect([...llamadas[0]!.partes].sort(porNombre)).toEqual(
      [
        {
          productoId: c.huevoFritoId,
          nombre: 'Huevo frito',
          cantidad: 2,
          tipoControlStock: 'UNIDADES',
        },
        {
          productoId: c.hamburguesaId,
          nombre: 'Hamburguesa clásica',
          cantidad: 2,
          tipoControlStock: 'PORCIONES',
        },
        {
          productoId: c.cervezaPilsenId,
          nombre: 'Cerveza Pilsen',
          cantidad: 2,
          tipoControlStock: 'UNIDADES',
        },
      ].sort(porNombre),
    );

    // Eventos: salon.cambio (la mesa queda libre), orden.cambio y cocina.comanda por cada comanda.
    await asentar();
    expect(eventosDe(ctx, 'salon.cambio').map((x) => x.datos)).toEqual([
      { mesaIds: [o.mesa.id], ordenId: o.ordenId },
    ]);
    expect(eventosDe(ctx, 'orden.cambio').map((x) => x.datos)).toEqual([{ ordenId: o.ordenId }]);
    expect(
      eventosDe(ctx, 'cocina.comanda')
        .map((x) => (x.datos as { comandaId: string }).comandaId)
        .sort(),
    ).toEqual(nuevas.map((f) => f.id as string).sort());
    for (const ev of ctx.publicador.eventos()) {
      expect(ev).toMatchObject({
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
      });
    }
  });

  it('una orden en pre-cuenta también se anula y la pre-cuenta queda invalidada', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    exigirEstado(await pedirPrecuenta(ctx, mozo.token, o.ordenId), 201, 'pre-cuenta');
    exigirEstado(
      await anularOrden(ctx, supervisor.token, o.ordenId),
      200,
      'anular desde la pre-cuenta',
    );
    const guardada = await filasDe(admin, 'precuenta', 'orden_id = $1', [o.ordenId]);
    expect(guardada).toHaveLength(1);
    expect(guardada[0]!.invalidada_en).not.toBeNull();
    expect(await mesaEnSalon(ctx, mozo.token, o.mesa.id)).toMatchObject({
      estado: 'LIBRE',
      orden: null,
    });
  });

  it.each(['SUPERVISOR', 'ADMINISTRADOR'] as const)('%s anula la orden sin clave', async (rol) => {
    for (const tipo of TIPOS_DE_SESION) {
      const e = await esc();
      const quien = await actor(rol, tipo);
      const o = await ordenNueva();
      const antes = await auditoriaSalon(admin, e.A.empresaId);
      const res = await anularOrden(ctx, quien.token, o.ordenId);
      exigirEstado(res, 200, `${rol} con sesión de ${tipo}`);
      const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
      const fila = unaFilaDe(nuevas, 'anular_orden');
      expect(fila).toMatchObject({
        actor_usuario_id: quien.persona.id,
        autorizado_por_id: null,
        autorizacion_id: null,
      });
    }
  });

  describe.each(['MOZO', 'CAJERO'] as const)('%s necesita la clave', (rol) => {
    it.each(TIPOS_DE_SESION)(
      'sesión de %s: sin cabecera 403 CLAVE_REQUERIDA; con la clave de otra acción 403; sin cambios',
      async (tipo) => {
        const quien = await actor(rol, tipo);
        const o = await ordenNueva();
        const deItem = await clave(quien, 'ANULAR_ITEM_ENVIADO');
        const antes = await prepararRechazo();
        esperarError(await anularOrden(ctx, quien.token, o.ordenId), 403, 'CLAVE_REQUERIDA');
        esperarError(
          await anularOrden(ctx, quien.token, o.ordenId, undefined, {
            autorizacion: deItem.autorizacionId,
          }),
          403,
          'AUTORIZACION_INVALIDA',
        );
        await exigirSinCambios(antes, 'anular la orden sin la clave correcta');
        expect((await autorizacionGuardada(admin, deItem.autorizacionId)).usada_en).toBeNull();
      },
    );
  });

  it.each(TIPOS_DE_SESION)(
    'Cocina/Barra recibe 403 PROHIBIDO (sesión de %s) y no cambia nada',
    async (tipo) => {
      const cocina = await actor('COCINA_BARRA', tipo);
      const o = await ordenNueva();
      const antes = await prepararRechazo();
      esperarError(await anularOrden(ctx, cocina.token, o.ordenId), 403, 'PROHIBIDO');
      esperarError(await anularOrden(ctx, cocina.token, randomUUID()), 403, 'PROHIBIDO');
      await exigirSinCambios(antes, 'Cocina/Barra');
    },
  );

  it('una orden que ya no está abierta responde 409 ORDEN_NO_ABIERTA y el consumo de la autorización se revierte', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    exigirEstado(await anularOrden(ctx, supervisor.token, o.ordenId), 200, 'primera anulación');
    const auth = await clave(mozo, 'ANULAR_ORDEN');
    const antes = await prepararRechazo();
    esperarError(
      await anularOrden(ctx, mozo.token, o.ordenId, undefined, {
        autorizacion: auth.autorizacionId,
      }),
      409,
      'ORDEN_NO_ABIERTA',
    );
    await exigirSinCambios(antes, 'orden anulada');
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
  });

  it('un cuerpo mal formado responde 400 y una orden de otra sucursal, 404', async () => {
    const e = await esc();
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const adminS1 = await actor('ADMINISTRADOR', 'contrasena');
    const o = await ordenNueva();
    const deS2 = await ordenConItems(
      ctx,
      await mesasS2(),
      await carta(),
      (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena,
    );
    const antes = await prepararRechazo();
    for (const cuerpo of [
      {},
      { motivo: '', destinoStock: 'VUELVE' },
      { motivo: 'x', destinoStock: 'OTRO' },
      { motivo: 'x', destinoStock: 'VUELVE', sucursalId: randomUUID() },
      { motivo: 'm'.repeat(301), destinoStock: 'VUELVE' },
    ]) {
      esperarError(
        await anularOrden(ctx, supervisor.token, o.ordenId, cuerpo),
        400,
        'DATOS_INVALIDOS',
      );
    }
    esperarError(await anularOrden(ctx, adminS1.token, deS2.ordenId), 404, 'NO_ENCONTRADO');
    esperarError(await anularOrden(ctx, adminS1.token, randomUUID()), 404, 'NO_ENCONTRADO');
    await exigirSinCambios(antes, 'rechazos de anular la orden');
  });

  it('si el puerto de inventario lanza, la orden sigue abierta con sus ítems, la mesa ocupada y la autorización sin usar', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo, 'ANULAR_ORDEN');
    const antes = await prepararRechazo();
    ctx.inventario.lanzarAlAnular(
      new ErrorAplicacion(422, 'DATOS_INVALIDOS', 'Sin permiso del inventario'),
    );
    try {
      const res = await anularOrden(ctx, mozo.token, o.ordenId, undefined, {
        autorizacion: auth.autorizacionId,
      });
      esperarError(res, 422, 'DATOS_INVALIDOS');
    } finally {
      ctx.inventario.lanzarAlAnular(null);
    }
    expect((await foto()).tablas).toEqual(antes.tablas);
    expect((await foto()).auditoria).toEqual(antes.auditoria);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
    expect(await mesaEnSalon(ctx, mozo.token, o.mesa.id)).toMatchObject({ estado: 'OCUPADA' });
    // Y la misma autorización sirve después.
    exigirEstado(
      await anularOrden(ctx, mozo.token, o.ordenId, undefined, {
        autorizacion: auth.autorizacionId,
      }),
      200,
      'anular con la misma autorización',
    );
  });

  it('la réplica con la misma clave y la misma autorización devuelve lo guardado sin anular ni consumir de nuevo', async () => {
    const e = await esc();
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const auth = await clave(mozo, 'ANULAR_ORDEN');
    const claveDeIdempotencia = randomUUID();
    const cuerpo = { motivo: 'Se fueron', destinoStock: 'MERMA' as const };
    const primera = await anularOrden(ctx, mozo.token, o.ordenId, cuerpo, {
      clave: claveDeIdempotencia,
      autorizacion: auth.autorizacionId,
    });
    exigirEstado(primera, 200, 'primera anulación');
    const usadaEn = (await autorizacionGuardada(admin, auth.autorizacionId)).usada_en;
    ctx.reloj.avanzar(30_000);
    const antes = await prepararRechazo();
    const replica = await anularOrden(ctx, mozo.token, o.ordenId, cuerpo, {
      clave: claveDeIdempotencia,
      autorizacion: auth.autorizacionId,
    });
    expect(replica.status, JSON.stringify(replica.body)).toBe(200);
    expect(replica.body).toEqual(primera.body);
    await exigirSinCambios(antes, 'réplica de anular la orden');
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toEqual(usadaEn);
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(
      (await auditoriaSalon(admin, e.A.empresaId, { entidadId: o.ordenId })).filter(
        (f) => f.accion === 'anular_orden',
      ),
    ).toHaveLength(1);
  });
});

describe('criterio 43 · una fila anular_orden y ninguna anular_item por ítem', () => {
  it('guarda el motivo, el autorizador y el detalle exacto con los ítems anulados', async () => {
    const e = await esc();
    const cajero = await actor('CAJERO', 'pin');
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva(); // mozo responsable: el Mozo A.mozo
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.gaseosa.id,
        cuerpoDeAnulacion({ cantidad: 2 }),
      ),
      201,
      'anulación previa de la gaseosa',
    );
    exigirEstado(
      await anularItem(
        ctx,
        supervisor.token,
        o.ordenId,
        o.combo.id,
        cuerpoDeAnulacion({ cantidad: 1 }),
      ),
      201,
      'anulación previa de un combo',
    );
    const auth = await clave(cajero, 'ANULAR_ORDEN');
    const antes = await auditoriaSalon(admin, e.A.empresaId);
    const res = await anularOrden(
      ctx,
      cajero.token,
      o.ordenId,
      { motivo: 'El cliente se retiró', destinoStock: 'VUELVE' },
      { autorizacion: auth.autorizacionId },
    );
    exigirEstado(res, 200, 'anular la orden');

    const nuevas = await auditoriaNueva(admin, e.A.empresaId, antes);
    expect(nuevas.map((f) => f.accion).sort(), 'sin filas anular_item por ítem').toEqual([
      'ANULAR_ORDEN',
      'anular_orden',
    ]);
    const fila = nuevas.find((f) => f.accion === 'anular_orden')!;
    expect(fila).toMatchObject({
      entidad: 'orden',
      entidad_id: o.ordenId,
      sucursal_id: e.A.S1,
      motivo: 'El cliente se retiró',
      actor_usuario_id: cajero.persona.id,
      autorizado_por_id: e.A.supervisor.id,
      autorizacion_id: auth.autorizacionId,
      equipo_id: cajero.equipoId,
    });
    const detalle = fila.detalle as {
      mesas: unknown;
      mozoId: string;
      items: { itemId: string; nombre: string; cantidadAnulada: number; totalAnulado: string }[];
      totalAnulado: string;
      destinoStock: string;
    };
    expect(detalle.mozoId).toBe(e.A.mozo.id);
    expect(detalle.destinoStock).toBe('VUELVE');
    expect(detalle.totalAnulado).toBe('115.80');
    expect([...detalle.items].sort((a, b) => a.itemId.localeCompare(b.itemId))).toEqual(
      [
        { itemId: o.lomo.id, nombre: 'Lomo saltado', cantidadAnulada: 2, totalAnulado: '61.00' },
        {
          itemId: o.combo.id,
          nombre: 'Combo hamburguesa',
          cantidadAnulada: 2,
          totalAnulado: '54.80',
        },
      ].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    );
    // Las mesas de la orden: por id o por nombre, la mesa aparece.
    const textoMesas = JSON.stringify(detalle.mesas);
    expect(textoMesas.includes(o.mesa.id) || textoMesas.includes(o.mesa.nombre)).toBe(true);
  });

  it('las anulaciones guardadas por ítem se marcan como parte de una anulación de orden', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const o = await ordenNueva();
    exigirEstado(await anularOrden(ctx, supervisor.token, o.ordenId), 200, 'anular la orden');
    for (const item of [o.lomo, o.combo, o.gaseosa]) {
      const filas = await anulacionesDelItem(admin, item.id);
      expect(filas, item.nombre).toHaveLength(1);
      expect(filas[0]).toMatchObject({ de_orden: true, cantidad: item.cantidad });
    }
  });
});

// ------------------------------------------------------------------------------------------------
// 44 · Liberar una mesa sin consumo (decisión 7)
// ------------------------------------------------------------------------------------------------
describe('criterio 44 · liberar una mesa sin consumo', () => {
  async function ordenVacia(token: string) {
    const mesa = await (await mesasS1()).siguiente();
    const res = await abrirOrden(ctx, token, { mesaId: mesa.id });
    exigirEstado(res, 201, 'abrir la mesa');
    return { ordenId: res.body.id as string, mesa };
  }

  describe.each(['MOZO', 'CAJERO', 'SUPERVISOR', 'ADMINISTRADOR'] as const)('%s', (rol) => {
    it.each(TIPOS_DE_SESION)(
      'libera sin clave (sesión de %s): 200, ANULADA, sinConsumo y la mesa libre',
      async (tipo) => {
        const e = await esc();
        const quien = await actor(rol, tipo);
        const { ordenId, mesa } = await ordenVacia(quien.token);
        await asentar();
        ctx.publicador.limpiar();
        ctx.inventario.limpiar();
        const antes = await auditoriaSalon(admin, e.A.empresaId);
        const res = await liberarMesa(ctx, quien.token, ordenId);
        exigirEstado(res, 200, 'liberar la mesa');
        const orden = ordenRespuestaSchema.parse(res.body);
        expect(orden).toMatchObject({
          id: ordenId,
          estado: 'ANULADA',
          sinConsumo: true,
          items: [],
        });
        expect(await mesaEnSalon(ctx, quien.token, mesa.id)).toMatchObject({
          estado: 'LIBRE',
          orden: null,
        });

        const fila = unaFilaDe(await auditoriaNueva(admin, e.A.empresaId, antes), 'liberar_mesa');
        expect(fila).toMatchObject({
          entidad: 'orden',
          entidad_id: ordenId,
          sucursal_id: e.A.S1,
          actor_usuario_id: quien.persona.id,
          autorizado_por_id: null,
          equipo_id: tipo === 'pin' ? quien.equipoId : null,
        });
        expect(cerca(fila.ocurrido_en, ctx.reloj.ahora().getTime())).toBe(true);

        await asentar();
        expect(eventosDe(ctx, 'salon.cambio').map((x) => x.datos)).toEqual([
          { mesaIds: [mesa.id], ordenId },
        ]);
        expect(ctx.inventario.llamadas()).toEqual([]);
        // Sin comandas de anulación ni consumo de autorizaciones.
        expect(await comandasDeAnulacion(admin, ordenId)).toEqual([]);
      },
    );
  });

  it('la réplica con la misma clave devuelve lo guardado sin otra fila de auditoría ni otro evento', async () => {
    const e = await esc();
    const mozo = await actor('MOZO', 'contrasena');
    const { ordenId } = await ordenVacia(mozo.token);
    const claveDeIdempotencia = randomUUID();
    const primera = await liberarMesa(ctx, mozo.token, ordenId, { clave: claveDeIdempotencia });
    exigirEstado(primera, 200, 'liberar');
    const antes = await prepararRechazo();
    const replica = await liberarMesa(ctx, mozo.token, ordenId, { clave: claveDeIdempotencia });
    expect(replica.status).toBe(200);
    expect(replica.body).toEqual(primera.body);
    await exigirSinCambios(antes, 'réplica de liberar');
    expect(
      (await auditoriaSalon(admin, e.A.empresaId, { entidadId: ordenId })).filter(
        (f) => f.accion === 'liberar_mesa',
      ),
    ).toHaveLength(1);
  });

  it('con otra clave, una orden ya liberada responde 409 ORDEN_NO_ABIERTA', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const { ordenId } = await ordenVacia(mozo.token);
    exigirEstado(await liberarMesa(ctx, mozo.token, ordenId), 200, 'liberar');
    const antes = await prepararRechazo();
    esperarError(await liberarMesa(ctx, mozo.token, ordenId), 409, 'ORDEN_NO_ABIERTA');
    await exigirSinCambios(antes, 'liberar dos veces');
  });

  it('una orden con algún envío responde 409 ORDEN_CON_CONSUMO, aunque todo esté anulado, y no cambia nada', async () => {
    const supervisor = await actor('SUPERVISOR', 'contrasena');
    const mozo = await actor('MOZO', 'contrasena');
    const o = await ordenNueva();
    const antesConItems = await prepararRechazo();
    esperarError(await liberarMesa(ctx, mozo.token, o.ordenId), 409, 'ORDEN_CON_CONSUMO');
    await exigirSinCambios(antesConItems, 'orden con consumo');

    for (const item of [o.lomo, o.combo, o.gaseosa]) {
      exigirEstado(
        await anularItem(
          ctx,
          supervisor.token,
          o.ordenId,
          item.id,
          cuerpoDeAnulacion({ cantidad: item.cantidad }),
        ),
        201,
        `anular ${item.nombre}`,
      );
    }
    const antesTodoAnulado = await prepararRechazo();
    esperarError(await liberarMesa(ctx, mozo.token, o.ordenId), 409, 'ORDEN_CON_CONSUMO');
    await exigirSinCambios(antesTodoAnulado, 'todo anulado');
    expect((await leerOrden(ctx, mozo.token, o.ordenId)).estado).toBe('ABIERTA');
  });

  it('un envío rechazado por completo no cuenta como consumo; uno aceptado, sí', async () => {
    const mozo = await actor('MOZO', 'contrasena');
    const c = await carta();
    const { ordenId } = await ordenVacia(mozo.token);
    // Un producto inexistente: el envío se rechaza y no queda nada.
    const rechazado = await enviar(ctx, mozo.token, ordenId, [
      { productoId: randomUUID(), modificadorIds: [], cantidad: 1 },
    ]);
    expect(rechazado.status).toBe(422);
    exigirEstado(
      await liberarMesa(ctx, mozo.token, ordenId),
      200,
      'liberar tras un envío rechazado',
    );

    const otra = await ordenVacia(mozo.token);
    exigirEstado(await enviar(ctx, mozo.token, otra.ordenId, [lineaGaseosa(c, 1)]), 201, 'enviar');
    esperarError(await liberarMesa(ctx, mozo.token, otra.ordenId), 409, 'ORDEN_CON_CONSUMO');
  });

  it.each(TIPOS_DE_SESION)('Cocina/Barra recibe 403 PROHIBIDO (sesión de %s)', async (tipo) => {
    const mozo = await actor('MOZO', 'contrasena');
    const cocina = await actor('COCINA_BARRA', tipo);
    const { ordenId } = await ordenVacia(mozo.token);
    const antes = await prepararRechazo();
    esperarError(await liberarMesa(ctx, cocina.token, ordenId), 403, 'PROHIBIDO');
    await exigirSinCambios(antes, 'Cocina/Barra');
  });

  it('sin Idempotency-Key responde 400 y una orden de otra sucursal o inexistente, 404', async () => {
    const e = await esc();
    const mozo = await actor('MOZO', 'contrasena');
    const adminS1 = await actor('ADMINISTRADOR', 'contrasena');
    const { ordenId } = await ordenVacia(mozo.token);
    const mozoS2 = (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena;
    const mesaS2 = await (await mesasS2()).siguiente();
    const deS2 = await abrirOrden(ctx, mozoS2, { mesaId: mesaS2.id });
    exigirEstado(deS2, 201, 'abrir en S2');
    const antes = await prepararRechazo();
    esperarError(
      await liberarMesa(ctx, mozo.token, ordenId, { clave: null }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(await liberarMesa(ctx, adminS1.token, deS2.body.id), 404, 'NO_ENCONTRADO');
    esperarError(await liberarMesa(ctx, adminS1.token, randomUUID()), 404, 'NO_ENCONTRADO');
    await exigirSinCambios(antes, 'rechazos de liberar');
  });
});
