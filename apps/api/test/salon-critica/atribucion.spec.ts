// spec: 004-salon-cocina (pruebas protegidas)
//
// P3 (parte 3) · Atribución y trazabilidad de autor (ruta crítica), criterios 10, 30 y 81 (decisión 8):
// - 10: el mozo responsable es quien abre la mesa o, con `mozoId`, otra persona que atienda mesas en la sucursal
//   de la orden (Administrador, o `ATENDER_MESA` permitido con su rol allí); si no (Cocina/Barra, sin acceso a
//   S1, rol de Cocina/Barra en S1, inactivo, de B o inexistente), 422 `REFERENCIA_INVALIDA` con `campos` en
//   `mozoId` y el mismo cuerpo para uno de B y uno inexistente; una sesión de soporte tiene que enviar `mozoId`;
//   el mozo responsable no cambia después;
// - 30: el Mozo M1 abre, el Mozo M2 y el Cajero C envían adiciones: la orden sigue a nombre de M1 y cada ítem dice
//   quién lo comandó, con su equipo en la trazabilidad;
// - 81: la orden queda con `creado_por_usuario_id` = quien abrió y `mozo_id` = el responsable; cada ítem, con
//   quien lo comandó y su equipo; una anulación hecha por el Cajero con clave del Supervisor queda con el Cajero
//   como autor y el Supervisor como autorizador.
// Hoy las rutas no existen: las pruebas fallan con 500 `ERROR_INTERNO` ("No implementado") y por las tablas
// inexistentes.
import { randomUUID } from 'node:crypto';
import { ordenRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer } from '../acceso/fabrica-plataforma';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  TIPOS_DE_SESION,
  abrirOrden,
  anularItem,
  arrancarP3,
  asentar,
  autorDeFila,
  comandasDelKds,
  crearEscenarioP3,
  crearPersona,
  cuerpoDeAnulacion,
  enviar,
  esperarError,
  exigirEstado,
  filasDe,
  leerCocina,
  leerOrden,
  leerSalon,
  lineaCombo,
  lineaGaseosa,
  lineaLomo,
  llamar,
  mesaEnSalon,
  mozoGuardado,
  pedirAutorizacion,
  pedirPrecuenta,
  sembrarCartaSalon,
  sesiones,
  unico,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
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
  await ctx?.cerrar();
  await admin?.end();
});

const esc = () => (escPendiente ??= crearEscenarioP3(ctx));
const carta = () => (cartaPendiente ??= esc().then((e) => sembrarCartaSalon(ctx, e.A.tokenAdmin)));
const mesasS1 = () =>
  (mesasPendientes ??= esc().then((e) => new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1)));
const mesasS2 = () =>
  (mesasS2Pendientes ??= esc().then((e) => new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S2)));

const nombreDe = (persona: PersonaConSesion): string =>
  (persona as unknown as { respuesta: { nombre: string } }).respuesta.nombre;

/** Lo que dice la trazabilidad de una fila sobre quién la cambió por última vez. */
async function ultimoAutor(tabla: string, id: string) {
  const { rows } = await admin.query<Record<string, string | null>>(
    `SELECT actualizado_por_usuario_id, actualizado_por_equipo_id FROM ${tabla} WHERE id = $1`,
    [id],
  );
  expect(rows, `${tabla} ${id}`).toHaveLength(1);
  return {
    usuarioId: rows[0]!.actualizado_por_usuario_id ?? null,
    equipoId: rows[0]!.actualizado_por_equipo_id ?? null,
  };
}

/** Una apertura rechazada: 422 `REFERENCIA_INVALIDA` con `campos` en `mozoId`, y la mesa sigue libre. */
async function exigirMozoRechazado(res: Response, mesaId: string, token: string) {
  esperarError(res, 422, 'REFERENCIA_INVALIDA');
  const campos = res.body.campos as { campo: string }[];
  expect(
    campos.some((c) => c.campo === 'mozoId'),
    `campos en mozoId: ${JSON.stringify(campos)}`,
  ).toBe(true);
  expect(await filasDe(admin, 'orden_mesa', 'mesa_id = $1', [mesaId])).toHaveLength(0);
  expect(await mesaEnSalon(ctx, token, mesaId)).toMatchObject({ estado: 'LIBRE', orden: null });
}

// ------------------------------------------------------------------------------------------------
// 10 · El mozo responsable por defecto
// ------------------------------------------------------------------------------------------------
describe('criterio 10 · sin mozoId, el mozo responsable es quien abre la mesa', () => {
  it.each(TIPOS_DE_SESION)(
    'el Mozo abre (sesión de %s): la orden queda a su nombre, creada por él y desde su equipo',
    async (tipo) => {
      const e = await esc();
      const s = await sesiones(ctx, e.A.mozo, e.A.S1);
      const mesa = await (await mesasS1()).siguiente();
      const res = await abrirOrden(ctx, s[tipo], { mesaId: mesa.id, comensales: 3 });
      exigirEstado(res, 201, 'abrir la mesa');
      const orden = ordenRespuestaSchema.parse(res.body);
      expect(orden.mozo).toEqual({ id: e.A.mozo.id, nombre: nombreDe(e.A.mozo) });
      expect(orden).toMatchObject({
        estado: 'ABIERTA',
        tipo: 'MESA',
        canal: 'SALON',
        comensales: 3,
      });

      // 81: la orden queda con `creado_por_usuario_id` = quien abrió y `mozo_id` = el responsable.
      expect(await mozoGuardado(admin, orden.id)).toBe(e.A.mozo.id);
      expect(await autorDeFila(admin, 'orden', orden.id)).toEqual({
        usuarioId: e.A.mozo.id,
        equipoId: tipo === 'pin' ? s.equipoId : null,
        superadministradorId: null,
        sistema: null,
      });

      // El mapa y la consulta de la orden dicen lo mismo.
      expect((await mesaEnSalon(ctx, s[tipo], mesa.id)).orden?.mozo).toEqual(orden.mozo);
      expect((await leerOrden(ctx, s[tipo], orden.id)).mozo).toEqual(orden.mozo);
    },
  );

  it('un mozoId igual a quien abre es válido', async () => {
    const e = await esc();
    const s = await sesiones(ctx, e.A.mozo, e.A.S1);
    const mesa = await (await mesasS1()).siguiente();
    const res = await abrirOrden(ctx, s.contrasena, { mesaId: mesa.id, mozoId: e.A.mozo.id });
    exigirEstado(res, 201, 'abrir con mozoId propio');
    expect(res.body.mozo.id).toBe(e.A.mozo.id);
  });
});

// ------------------------------------------------------------------------------------------------
// 10 · El mozo responsable elegido (decisión 8)
// ------------------------------------------------------------------------------------------------
describe('criterio 10 · con mozoId, otra persona que atiende mesas es el mozo responsable', () => {
  type Candidato = {
    nombre: string;
    persona: (e: EscenarioP3) => PersonaConSesion;
  };
  const VALIDOS: Candidato[] = [
    { nombre: 'otro Mozo de S1', persona: (e) => e.mozo2 },
    { nombre: 'el Cajero de S1', persona: (e) => e.A.cajero },
    { nombre: 'el Supervisor de S1', persona: (e) => e.A.supervisor },
    { nombre: 'el Administrador (sin acceso explícito a S1)', persona: (e) => e.A.base.admin },
  ];

  describe.each(VALIDOS)('$nombre', (candidato) => {
    it.each(TIPOS_DE_SESION)(
      'el Cajero abre para esa persona (sesión de %s): ella es la responsable y el Cajero, el creador',
      async (tipo) => {
        const e = await esc();
        const cajero = await sesiones(ctx, e.A.cajero, e.A.S1);
        const elegido = candidato.persona(e);
        const mesa = await (await mesasS1()).siguiente();
        const res = await abrirOrden(ctx, cajero[tipo], { mesaId: mesa.id, mozoId: elegido.id });
        exigirEstado(res, 201, 'abrir con mozoId');
        const orden = ordenRespuestaSchema.parse(res.body);
        expect(orden.mozo.id).toBe(elegido.id);
        expect(orden.mozo.nombre.length).toBeGreaterThan(0);
        expect(await mozoGuardado(admin, orden.id)).toBe(elegido.id);
        expect(await autorDeFila(admin, 'orden', orden.id)).toMatchObject({
          usuarioId: e.A.cajero.id,
          equipoId: tipo === 'pin' ? cajero.equipoId : null,
        });
        expect((await mesaEnSalon(ctx, cajero[tipo], mesa.id)).orden?.mozo.id).toBe(elegido.id);
      },
    );
  });

  it('el Administrador abre para un Mozo y el Supervisor para otro: cada orden queda a nombre del elegido', async () => {
    const e = await esc();
    const adminS1 = (await sesiones(ctx, e.A.base.admin, e.A.S1)).contrasena;
    const supervisor = (await sesiones(ctx, e.A.supervisor, e.A.S1)).pin;
    const mesas = await mesasS1();
    const deAdmin = await abrirOrden(ctx, adminS1, {
      mesaId: (await mesas.siguiente()).id,
      mozoId: e.A.mozo.id,
    });
    const deSupervisor = await abrirOrden(ctx, supervisor, {
      mesaId: (await mesas.siguiente()).id,
      mozoId: e.mozo2.id,
    });
    exigirEstado(deAdmin, 201, 'el Administrador abre para el Mozo');
    exigirEstado(deSupervisor, 201, 'el Supervisor abre para el otro Mozo');
    expect(deAdmin.body.mozo.id).toBe(e.A.mozo.id);
    expect(deSupervisor.body.mozo.id).toBe(e.mozo2.id);
  });

  it('el rol que cuenta es el de la sucursal de la orden: un Mozo de S2 es válido en S2', async () => {
    const e = await esc();
    const soloS2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S2, rol: 'MOZO' }]);
    const adminS2 = (await sesiones(ctx, e.A.base.admin, e.A.S2)).contrasena;
    const mesa = await (await mesasS2()).siguiente();
    const res = await abrirOrden(ctx, adminS2, { mesaId: mesa.id, mozoId: soloS2.id });
    exigirEstado(res, 201, 'abrir en S2 para un Mozo de S2');
    expect(res.body.mozo.id).toBe(soloS2.id);
  });
});

describe('criterio 10 · un mozoId que no atiende mesas se rechaza con 422 REFERENCIA_INVALIDA', () => {
  it.each(TIPOS_DE_SESION)(
    'Cocina/Barra, sin acceso a S1, con rol de Cocina/Barra en S1, inactivo, de B o inexistente (sesión de %s)',
    async (tipo) => {
      const e = await esc();
      const cajero = (await sesiones(ctx, e.A.cajero, e.A.S1))[tipo];
      const soloS2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S2, rol: 'MOZO' }]);
      const cocinaEnS1 = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'COCINA_BARRA' },
        { sucursalId: e.A.S2, rol: 'MOZO' },
      ]);
      const inactivo = await crearPersona(ctx, e.A.tokenAdmin, [
        { sucursalId: e.A.S1, rol: 'MOZO' },
      ]);
      const desactivar = await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/usuarios/${inactivo.id}`,
        cuerpo: { activo: false },
      });
      exigirEstado(desactivar, 200, 'desactivar al Mozo');

      const casos: [string, string][] = [
        ['Cocina/Barra de S1', e.A.cocina.id],
        ['alguien sin acceso a S1', soloS2.id],
        ['alguien con rol de Cocina/Barra en S1 (y Mozo en S2)', cocinaEnS1.id],
        ['un usuario inactivo', inactivo.id],
        ['un usuario de B', e.B.mozo.id],
        ['un usuario inexistente', randomUUID()],
      ];
      const cuerpos = new Map<string, unknown>();
      for (const [que, mozoId] of casos) {
        const mesa = await (await mesasS1()).siguiente();
        const res = await abrirOrden(ctx, cajero, { mesaId: mesa.id, mozoId });
        await exigirMozoRechazado(res, mesa.id, cajero).catch((error: unknown) => {
          throw new Error(`${que}: ${(error as Error).message}`);
        });
        cuerpos.set(que, res.body);
      }
      // Uno de B y uno inexistente no se distinguen.
      expect(cuerpos.get('un usuario de B')).toEqual(cuerpos.get('un usuario inexistente'));
    },
  );

  it('el rechazo no deja nada guardado, no publica eventos y la misma clave de idempotencia sirve después con un mozoId válido', async () => {
    const e = await esc();
    const cajero = (await sesiones(ctx, e.A.cajero, e.A.S1)).contrasena;
    const mesa = await (await mesasS1()).siguiente();
    const id = randomUUID();
    const clave = randomUUID();
    await asentar();
    ctx.publicador.limpiar();
    const mal = await abrirOrden(
      ctx,
      cajero,
      { id, mesaId: mesa.id, mozoId: e.A.cocina.id },
      { clave },
    );
    await exigirMozoRechazado(mal, mesa.id, cajero);
    expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(0);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    const bien = await abrirOrden(
      ctx,
      cajero,
      { id, mesaId: mesa.id, mozoId: e.A.mozo.id },
      { clave },
    );
    exigirEstado(bien, 201, 'el error no se guardó');
    expect(bien.body.mozo.id).toBe(e.A.mozo.id);
  });

  it('un mozoId que no es un UUID responde 400 DATOS_INVALIDOS', async () => {
    const e = await esc();
    const cajero = (await sesiones(ctx, e.A.cajero, e.A.S1)).contrasena;
    const mesa = await (await mesasS1()).siguiente();
    for (const mozoId of ['no-es-un-uuid', 123, '']) {
      const res = await llamar(ctx, cajero, {
        metodo: 'post',
        ruta: '/ordenes',
        cuerpo: { id: randomUUID(), mesaId: mesa.id, comensales: 2, mozoId },
        cabeceras: { 'Idempotency-Key': randomUUID() },
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await filasDe(admin, 'orden_mesa', 'mesa_id = $1', [mesa.id])).toHaveLength(0);
  });

  it('una sesión de soporte tiene que enviar mozoId: sin él, 422; con uno válido, 201 y la orden a nombre de ese mozo', async () => {
    const e = await esc();
    const abrirSoporte = await ctx
      .http()
      .post(`/plataforma/empresas/${e.A.empresaId}/soporte`)
      .set(bearer(e.sa.token))
      .send({ motivo: unico('Soporte y mozo'), sucursalId: e.A.S1 });
    exigirEstado(abrirSoporte, 201, 'abrir soporte');
    const token = abrirSoporte.body.token as string;
    const mesa = await (await mesasS1()).siguiente();
    const sin = await abrirOrden(ctx, token, { mesaId: mesa.id });
    expect(sin.status, JSON.stringify(sin.body)).toBe(422);
    expect(JSON.stringify(sin.body.campos)).toContain('mozoId');
    expect(await filasDe(admin, 'orden_mesa', 'mesa_id = $1', [mesa.id])).toHaveLength(0);
    const con = await abrirOrden(ctx, token, { mesaId: mesa.id, mozoId: e.A.mozo.id });
    exigirEstado(con, 201, 'soporte abre con mozoId');
    expect(con.body.mozo.id).toBe(e.A.mozo.id);
    expect(await mozoGuardado(admin, con.body.id as string)).toBe(e.A.mozo.id);
  });
});

// ------------------------------------------------------------------------------------------------
// 10 · El mozo responsable no cambia después (decisión 8)
// ------------------------------------------------------------------------------------------------
describe('criterio 10 · el mozo responsable no cambia después', () => {
  it('ni por editar los comensales, ni por un mozoId en el PATCH, ni por la réplica de la apertura, ni por enviar, anular o pedir la pre-cuenta', async () => {
    const e = await esc();
    const c = await carta();
    const m1 = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
    const m2 = (await sesiones(ctx, e.mozo2, e.A.S1)).contrasena;
    const cajero = await sesiones(ctx, e.A.cajero, e.A.S1);
    const supervisor = (await sesiones(ctx, e.A.supervisor, e.A.S1)).contrasena;
    const mesa = await (await mesasS1()).siguiente();
    const idOrden = randomUUID();
    const abrir = await abrirOrden(ctx, m1, { id: idOrden, mesaId: mesa.id, comensales: 2 });
    exigirEstado(abrir, 201, 'M1 abre');
    const responsable = { id: e.A.mozo.id, nombre: nombreDe(e.A.mozo) };
    const sigueIgual = async (que: string) => {
      expect(await mozoGuardado(admin, idOrden), `${que}: mozo_id`).toBe(e.A.mozo.id);
      expect((await leerOrden(ctx, m1, idOrden)).mozo, que).toEqual(responsable);
      expect((await mesaEnSalon(ctx, m1, mesa.id)).orden?.mozo, `${que}: mapa`).toEqual(
        responsable,
      );
    };

    // Editar los comensales (otra persona) no cambia al responsable.
    const comensales = await llamar(ctx, cajero.contrasena, {
      metodo: 'patch',
      ruta: `/ordenes/${idOrden}`,
      cuerpo: { comensales: 6 },
    });
    exigirEstado(comensales, 200, 'cambiar los comensales');
    await sigueIgual('después de editar los comensales');

    // El PATCH no acepta un mozo nuevo: el campo es desconocido.
    for (const cuerpo of [
      { mozoId: e.mozo2.id },
      { comensales: 6, mozoId: e.mozo2.id },
      { mozo: e.mozo2.id },
    ]) {
      const res = await llamar(ctx, cajero.contrasena, {
        metodo: 'patch',
        ruta: `/ordenes/${idOrden}`,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    await sigueIgual('después de intentar cambiar el mozo');

    // Repetir la apertura (mismo id, misma mesa) con otro mozoId: no cambia al responsable.
    const replica = await abrirOrden(ctx, m2, { id: idOrden, mesaId: mesa.id, mozoId: e.mozo2.id });
    expect([201, 422], JSON.stringify(replica.body)).toContain(replica.status);
    await sigueIgual('después de repetir la apertura con otro mozoId');

    // Otras personas envían, anulan y piden la pre-cuenta.
    const envio = await enviar(ctx, m2, idOrden, [lineaLomo(c, 2), lineaGaseosa(c, 1)]);
    exigirEstado(envio, 201, 'M2 envía');
    exigirEstado(
      await pedirPrecuenta(ctx, supervisor, idOrden),
      201,
      'el Supervisor pide la pre-cuenta',
    );
    const auth = await pedirAutorizacion(
      ctx,
      cajero.contrasena,
      e.A.supervisor.pin,
      'ANULAR_ITEM_ENVIADO',
    );
    exigirEstado(
      await anularItem(
        ctx,
        cajero.contrasena,
        idOrden,
        envio.body.items[0].id as string,
        cuerpoDeAnulacion(),
        {
          autorizacion: auth.autorizacionId,
        },
      ),
      201,
      'el Cajero anula con clave',
    );
    await sigueIgual('después de enviar, pedir la pre-cuenta y anular');
  });
});

// ------------------------------------------------------------------------------------------------
// 30 · M1 abre; M2 y C agregan
// ------------------------------------------------------------------------------------------------
describe.each(TIPOS_DE_SESION)(
  'criterio 30 · el Mozo M1 abre, el Mozo M2 y el Cajero C agregan (sesiones de %s)',
  (tipo) => {
    async function armar() {
      const e = await esc();
      const c = await carta();
      const s = {
        m1: (await sesiones(ctx, e.A.mozo, e.A.S1))[tipo],
        m2: (await sesiones(ctx, e.mozo2, e.A.S1))[tipo],
        c: (await sesiones(ctx, e.A.cajero, e.A.S1))[tipo],
        supervisor: (await sesiones(ctx, e.A.supervisor, e.A.S1))[tipo],
      };
      const equipos = {
        m1: (await sesiones(ctx, e.A.mozo, e.A.S1)).equipoId,
        m2: (await sesiones(ctx, e.mozo2, e.A.S1)).equipoId,
        c: (await sesiones(ctx, e.A.cajero, e.A.S1)).equipoId,
        supervisor: (await sesiones(ctx, e.A.supervisor, e.A.S1)).equipoId,
      };
      const mesa = await (await mesasS1()).siguiente();
      const abrir = await abrirOrden(ctx, s.m1, { mesaId: mesa.id });
      exigirEstado(abrir, 201, 'M1 abre');
      const ordenId = abrir.body.id as string;
      return { e, c, s, equipos, mesa, ordenId };
    }

    it('la orden sigue a nombre de M1 y cada ítem dice quién lo comandó', async () => {
      const { e, c, s, ordenId } = await armar();
      const envioM1 = await enviar(ctx, s.m1, ordenId, [lineaLomo(c, 1)]);
      const envioM2 = await enviar(ctx, s.m2, ordenId, [lineaGaseosa(c, 2)]);
      const envioC = await enviar(ctx, s.c, ordenId, [lineaCombo(c, 1)]);
      const envioS = await enviar(ctx, s.supervisor, ordenId, [lineaGaseosa(c, 1)]);
      for (const [que, envio] of [
        ['M1', envioM1],
        ['M2', envioM2],
        ['C', envioC],
        ['el Supervisor', envioS],
      ] as const) {
        exigirEstado(envio, 201, `${que} envía`);
      }
      // El primer envío es la comanda; los siguientes, adiciones.
      expect(
        [envioM1, envioM2, envioC, envioS].map((r) => [r.body.numero, r.body.esAdicion]),
      ).toEqual([
        [1, false],
        [2, true],
        [3, true],
        [4, true],
      ]);

      const orden = ordenRespuestaSchema.parse(await leerOrden(ctx, s.m1, ordenId));
      expect(orden.mozo).toEqual({ id: e.A.mozo.id, nombre: nombreDe(e.A.mozo) });
      expect(orden.items.map((i) => [i.envioNumero, i.comandadoPor])).toEqual([
        [1, { id: e.A.mozo.id, nombre: nombreDe(e.A.mozo) }],
        [2, { id: e.mozo2.id, nombre: nombreDe(e.mozo2) }],
        [3, { id: e.A.cajero.id, nombre: nombreDe(e.A.cajero) }],
        [4, { id: e.A.supervisor.id, nombre: nombreDe(e.A.supervisor) }],
      ]);
      // Lo mismo dicen los ítems de la respuesta de cada envío.
      expect(envioM2.body.items[0].comandadoPor).toEqual({
        id: e.mozo2.id,
        nombre: nombreDe(e.mozo2),
      });
      expect(envioC.body.items[0].comandadoPor).toEqual({
        id: e.A.cajero.id,
        nombre: nombreDe(e.A.cajero),
      });
      expect(await mozoGuardado(admin, ordenId)).toBe(e.A.mozo.id);
    });

    it('la trazabilidad: la orden queda creada por M1 y cada ítem y cada envío, por quien los envió y desde su equipo', async () => {
      const { e, c, s, equipos, ordenId } = await armar();
      const envios = [
        {
          quien: 'm1',
          persona: e.A.mozo,
          res: await enviar(ctx, s.m1, ordenId, [lineaLomo(c, 1)]),
        },
        {
          quien: 'm2',
          persona: e.mozo2,
          res: await enviar(ctx, s.m2, ordenId, [lineaGaseosa(c, 2)]),
        },
        {
          quien: 'c',
          persona: e.A.cajero,
          res: await enviar(ctx, s.c, ordenId, [lineaCombo(c, 1)]),
        },
      ] as const;
      for (const { res } of envios) exigirEstado(res, 201, 'enviar');

      const deLaOrden = await autorDeFila(admin, 'orden', ordenId);
      expect(deLaOrden).toEqual({
        usuarioId: e.A.mozo.id,
        equipoId: tipo === 'pin' ? equipos.m1 : null,
        superadministradorId: null,
        sistema: null,
      });
      for (const { quien, persona, res } of envios) {
        const equipoEsperado = tipo === 'pin' ? equipos[quien] : null;
        for (const item of res.body.items as { id: string }[]) {
          expect(await autorDeFila(admin, 'item', item.id), `ítem de ${quien}`).toEqual({
            usuarioId: persona.id,
            equipoId: equipoEsperado,
            superadministradorId: null,
            sistema: null,
          });
        }
        expect(
          await autorDeFila(admin, 'envio', res.body.id as string),
          `envío de ${quien}`,
        ).toMatchObject({
          usuarioId: persona.id,
          equipoId: equipoEsperado,
        });
      }
      // El mozo responsable sigue siendo M1 aunque otras personas hayan tocado la orden.
      expect(await mozoGuardado(admin, ordenId)).toBe(e.A.mozo.id);
      expect(await autorDeFila(admin, 'orden', ordenId)).toEqual(deLaOrden);
    });

    it('el mapa y el KDS muestran siempre a M1 como el mozo de la orden', async () => {
      const { e, c, s, mesa, ordenId } = await armar();
      exigirEstado(await enviar(ctx, s.m1, ordenId, [lineaLomo(c, 1)]), 201, 'M1 envía');
      exigirEstado(await enviar(ctx, s.m2, ordenId, [lineaCombo(c, 1)]), 201, 'M2 envía');
      const salon = await leerSalon(ctx, s.c);
      const deLaMesa = salon.zonas.flatMap((z) => z.mesas).find((m) => m.id === mesa.id)!;
      expect(deLaMesa.orden?.mozo.id).toBe(e.A.mozo.id);
      const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
      const comandas = comandasDelKds(await leerCocina(ctx, cocina)).filter(
        (k) => k.orden.id === ordenId,
      );
      expect(comandas.length).toBeGreaterThanOrEqual(3);
      for (const k of comandas) expect(k.orden.mozo.id).toBe(e.A.mozo.id);
      expect(new Set(comandas.map((k) => k.tipo))).toEqual(new Set(['COMANDA', 'ADICION']));
    });
  },
);

describe('criterio 30 · cualquier persona con ATENDER_MESA envía a cualquier orden abierta de la sucursal', () => {
  it('Cocina/Barra no puede enviar, aunque conozca la orden', async () => {
    const e = await esc();
    const c = await carta();
    const m1 = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
    const mesa = await (await mesasS1()).siguiente();
    const abrir = await abrirOrden(ctx, m1, { mesaId: mesa.id });
    exigirEstado(abrir, 201, 'M1 abre');
    for (const tipo of TIPOS_DE_SESION) {
      const cocina = (await sesiones(ctx, e.A.cocina, e.A.S1))[tipo];
      esperarError(
        await enviar(ctx, cocina, abrir.body.id as string, [lineaGaseosa(c, 1)]),
        403,
        'PROHIBIDO',
      );
    }
    expect(await filasDe(admin, 'item', 'orden_id = $1', [abrir.body.id])).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------
// 81 · La anulación del Cajero con la clave del Supervisor
// ------------------------------------------------------------------------------------------------
describe.each(TIPOS_DE_SESION)(
  'criterio 81 · una anulación del Cajero con la clave del Supervisor (sesiones de %s)',
  (tipo: TipoDeSesion) => {
    it('queda con el Cajero como autor y el Supervisor como autorizador; el ítem conserva a quien lo comandó', async () => {
      const e = await esc();
      const c = await carta();
      const m1 = (await sesiones(ctx, e.A.mozo, e.A.S1))[tipo];
      const m2 = await sesiones(ctx, e.mozo2, e.A.S1);
      const cajero = await sesiones(ctx, e.A.cajero, e.A.S1);
      const mesa = await (await mesasS1()).siguiente();
      const abrir = await abrirOrden(ctx, m1, { mesaId: mesa.id });
      exigirEstado(abrir, 201, 'M1 abre');
      const ordenId = abrir.body.id as string;
      const envio = await enviar(ctx, m2[tipo], ordenId, [lineaLomo(c, 2)]);
      exigirEstado(envio, 201, 'M2 envía');
      const itemId = envio.body.items[0].id as string;

      const auth = await pedirAutorizacion(
        ctx,
        cajero[tipo],
        e.A.supervisor.pin,
        'ANULAR_ITEM_ENVIADO',
      );
      const cuerpo = cuerpoDeAnulacion({ cantidad: 1 });
      const res = await anularItem(ctx, cajero[tipo], ordenId, itemId, cuerpo, {
        autorizacion: auth.autorizacionId,
      });
      exigirEstado(res, 201, 'el Cajero anula con clave');
      expect(res.body.autorizadoPor).toMatchObject({ id: e.A.supervisor.id });

      const equipoCajero = tipo === 'pin' ? cajero.equipoId : null;
      // La anulación guardada: autor, equipo y autorizador.
      const [anulacion] = await filasDe(admin, 'anulacion_item', 'item_id = $1', [itemId]);
      expect(anulacion).toMatchObject({
        creado_por_usuario_id: e.A.cajero.id,
        creado_por_equipo_id: equipoCajero,
        autorizado_por_id: e.A.supervisor.id,
        autorizacion_id: auth.autorizacionId,
      });
      // El ítem lo creó M2 y lo cambió por última vez el Cajero.
      expect(await autorDeFila(admin, 'item', itemId)).toMatchObject({
        usuarioId: e.mozo2.id,
        equipoId: tipo === 'pin' ? m2.equipoId : null,
      });
      expect(await ultimoAutor('item', itemId)).toEqual({
        usuarioId: e.A.cajero.id,
        equipoId: equipoCajero,
      });
      // La auditoría: el Cajero como actor y el Supervisor como autorizador.
      const filas = await filasDe(
        admin,
        'auditoria',
        `entidad_id = $1 AND accion = 'anular_item'`,
        [itemId],
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        actor_usuario_id: e.A.cajero.id,
        autorizado_por_id: e.A.supervisor.id,
        autorizacion_id: auth.autorizacionId,
        equipo_id: equipoCajero,
      });
      // Y la orden sigue a nombre de M1.
      expect(await mozoGuardado(admin, ordenId)).toBe(e.A.mozo.id);
      expect(
        ordenRespuestaSchema.parse(await leerOrden(ctx, m1, ordenId)).items[0]!.comandadoPor,
      ).toEqual({ id: e.mozo2.id, nombre: nombreDe(e.mozo2) });
    });
  },
);
