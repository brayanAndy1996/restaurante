// Historia 004 · entrega 3b, grupo C9 (T44) · pruebas del desarrollador (no protegidas) del estado del puente y de las
// impresoras con el reloj de la API (criterios 120 y 121): `impresion.estado` se publica solo cuando el estado
// cambia (un latido con otro estado, el puente que se conecta, el puente que deja de latir 60 segundos y el puente
// que vuelve), nunca dos veces el mismo estado, y una impresora Bluetooth sigue en `DESCONOCIDO`.
import {
  estadoImpresionRespuestaSchema,
  type EstadoImpresionRespuesta,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MINUTO } from '../acceso/fabrica-plataforma';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import {
  Cierres,
  arrancarP5,
  conectarSocketDelPuente,
  esperarHasta,
  type AppP5,
} from '../impresion-critica/fabrica-p5';
import { llamarPuente, nuevoPuente, type PuenteVinculado } from '../impresion-critica/fabrica-p6';
import {
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { SenalPuenteService, puenteVuelve } from '../../src/modulos/impresion/senal-puente.service';
import { abrirCliente } from '../utilidades';
import { cuerpoBluetooth, cuerpoRed, impresoraCreada } from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
const cierres = new Cierres();
let senal: SenalPuenteService;

const A = () => esc.e.A;
const T = () => esc.token.adminA;
const SEGUNDO = 1000;

beforeAll(async () => {
  ctx = await arrancarP5();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  senal = ctx.app.get(SenalPuenteService, { strict: false });
});

afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await admin?.end();
});

/** Una sucursal con una impresora de red, una Bluetooth y un puente nuevo (que reemplaza al anterior). */
async function preparar() {
  const sucursalId = A().S3!;
  const token = await sesionContrasena(ctx, A().base.admin, sucursalId);
  const red = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
  const bluetooth = await impresoraCreada(ctx, T(), sucursalId, cuerpoBluetooth());
  const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
  ctx.publicador.limpiar();
  return { sucursalId, token, red, bluetooth, puente };
}

const latir = async (
  puente: PuenteVinculado,
  impresoras: { id: string; estado: 'LISTA' | 'NO_RESPONDE'; error?: string }[],
) => {
  const res = await llamarPuente(ctx, puente.token, 'post', '/puente/latido', {
    versionApp: '1.0.0',
    impresoras,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
};

/** Cuántos avisos de otras sucursales llegaron en la última llamada a `avisos`. */
let ultimosAjenos = 0;

/**
 * Los avisos `impresion.estado` de una sucursal publicados desde la última vez (los saca de la memoria; los de otras
 * sucursales quedan fuera de la cuenta y se anotan en `ultimosAjenos`).
 */
const avisos = (sucursalId: string): number => {
  const todos = ctx.publicador.eventos().filter((e) => e.nombre === 'impresion.estado');
  ctx.publicador.limpiar();
  const propios = todos.filter(
    (e) => e.sala.tipo === 'sucursal' && e.sala.sucursalId === sucursalId,
  );
  for (const aviso of propios) {
    expect(aviso).toMatchObject({
      empresaId: A().empresaId,
      sala: { tipo: 'sucursal', sucursalId },
      datos: { sucursalId },
    });
  }
  ultimosAjenos = todos.length - propios.length;
  return propios.length;
};

const pedirEstado = async (token: string): Promise<EstadoImpresionRespuesta> => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/estado' });
  exigirEstado(res, 200, 'estado de la impresión');
  return estadoImpresionRespuestaSchema.parse(res.body);
};

/** Espera a que el socket del puente deje su señal (con el reloj manual: `ultima_senal_en` = ahora). */
const esperarSenal = (puenteId: string) =>
  esperarHasta(
    async () =>
      (
        await admin.query<{ ok: boolean }>(
          'SELECT ultima_senal_en = $2 AS ok FROM puente WHERE id = $1',
          [puenteId, ctx.reloj.ahora()],
        )
      ).rows[0]?.ok === true,
    5000,
    'la señal del puente por el socket',
  );

/** Deja pasar un momento para comprobar que no se publicó nada más. */
const unMomento = () => new Promise((resolver) => setTimeout(resolver, 300));

describe('puenteVuelve (regla pura de los criterios 120 y 121)', () => {
  const ahora = new Date('2026-11-02T15:00:00.000Z');
  const hace = (segundos: number) => new Date(ahora.getTime() - segundos * SEGUNDO);

  it('vuelve si nunca dio señal, si pasaron más de 60 segundos o si su desconexión ya se avisó', () => {
    expect(puenteVuelve(null, null, ahora)).toBe(true);
    expect(puenteVuelve(hace(61), null, ahora)).toBe(true);
    expect(puenteVuelve(hace(5), hace(1), ahora)).toBe(true);
  });

  it('no vuelve con señal de hace 60 segundos o menos (el límite es "más de 60")', () => {
    expect(puenteVuelve(hace(0), null, ahora)).toBe(false);
    expect(puenteVuelve(hace(20), null, ahora)).toBe(false);
    expect(puenteVuelve(hace(60), null, ahora)).toBe(false);
  });
});

describe('impresion.estado solo cuando el estado cambia (criterio 120)', () => {
  it('el primer latido avisa, el mismo estado repetido no y un estado distinto sí', async () => {
    const { sucursalId, red, puente } = await preparar();

    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId), 'primer latido: el puente se conecta').toBe(1);

    for (let i = 0; i < 3; i++) {
      ctx.reloj.avanzar(20 * SEGUNDO);
      await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    }
    expect(avisos(sucursalId), 'tres latidos con el mismo estado').toBe(0);

    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'NO_RESPONDE', error: 'Sin conexión' }]);
    expect(avisos(sucursalId), 'la impresora deja de responder').toBe(1);

    // El mismo estado con otro texto de error no es un cambio de estado.
    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'NO_RESPONDE', error: 'Tiempo agotado' }]);
    expect(avisos(sucursalId), 'sigue sin responder').toBe(0);

    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId), 'la impresora vuelve').toBe(1);

    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId), 'otra vez lista').toBe(0);
  });

  it('una impresora que no responde y vuelve: el estado y su estadoDesde cambian con el reloj, y el aviso va una vez por cambio', async () => {
    const { sucursalId, token, red, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    const lista = ctx.reloj.ahora().toISOString();
    avisos(sucursalId);

    ctx.reloj.avanzar(30 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'NO_RESPONDE', error: 'Sin papel' }]);
    const caida = ctx.reloj.ahora().toISOString();
    expect(avisos(sucursalId)).toBe(1);
    let estado = await pedirEstado(token);
    expect(estado.puente).toMatchObject({ id: puente.id, conectado: true });
    expect(estado.impresoras.find((i) => i.id === red.id)).toMatchObject({
      estado: 'NO_RESPONDE',
      estadoDesde: caida,
    });

    // Latidos con el mismo estado no mueven `estadoDesde`.
    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'NO_RESPONDE', error: 'Sin papel' }]);
    expect(avisos(sucursalId)).toBe(0);
    estado = await pedirEstado(token);
    expect(estado.impresoras.find((i) => i.id === red.id)!.estadoDesde).toBe(caida);

    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId)).toBe(1);
    estado = await pedirEstado(token);
    expect(estado.impresoras.find((i) => i.id === red.id)).toMatchObject({
      estado: 'LISTA',
      estadoDesde: ctx.reloj.ahora().toISOString(),
    });
    expect(lista < caida).toBe(true);
  });

  it('una impresora Bluetooth queda en DESCONOCIDO aunque el puente esté conectado y la de red cambie', async () => {
    const { sucursalId, token, red, bluetooth, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'NO_RESPONDE', error: 'Sin papel' }]);
    avisos(sucursalId);

    const estado = await pedirEstado(token);
    expect(estado.puente?.conectado).toBe(true);
    expect(estado.impresoras.find((i) => i.id === red.id)?.estado).toBe('NO_RESPONDE');
    expect(estado.impresoras.find((i) => i.id === bluetooth.id)).toMatchObject({
      estado: 'DESCONOCIDO',
      estadoDesde: null,
      pendientes: 0,
    });
    // También en la lista de impresoras del Administrador.
    const lista = await llamar(ctx, T(), {
      metodo: 'get',
      ruta: `/sucursales/${sucursalId}/impresoras`,
    });
    exigirEstado(lista, 200, 'listar las impresoras');
    const propias = lista.body as { id: string; estado: string; estadoDesde: string | null }[];
    expect(propias.find((i) => i.id === bluetooth.id)).toMatchObject({
      estado: 'DESCONOCIDO',
      estadoDesde: null,
    });
  });
});

describe('el puente que deja de latir y vuelve (criterios 120 y 121, revisión con el reloj)', () => {
  it('a los 60 segundos sin señal sigue conectado; pasados los 60 se avisa una sola vez, aunque se revise muchas veces', async () => {
    const { sucursalId, token, red, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId)).toBe(1);

    ctx.reloj.avanzar(60 * SEGUNDO);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'justo 60 segundos: aún conectado').toBe(0);
    expect((await pedirEstado(token)).puente?.conectado).toBe(true);

    ctx.reloj.avanzar(SEGUNDO);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'más de 60 segundos: desconectado').toBe(1);
    const estado = await pedirEstado(token);
    expect(estado.puente).toMatchObject({ id: puente.id, conectado: false });
    expect(estado.impresoras.find((i) => i.id === red.id)?.estado).toBe('DESCONOCIDO');

    // Revisiones posteriores, también mucho tiempo después, no repiten el aviso.
    await senal.revisarAhora();
    ctx.reloj.avanzar(10 * MINUTO);
    await Promise.all([senal.revisarAhora(), senal.revisarAhora()]);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'la desconexión ya se avisó').toBe(0);
  });

  it('cuando el puente vuelve avisa una vez, aunque ya tuviera el mismo estado de impresoras; después los latidos iguales no avisan', async () => {
    const { sucursalId, token, red, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    avisos(sucursalId);
    ctx.reloj.avanzar(61 * SEGUNDO);
    await senal.revisarAhora();
    expect(avisos(sucursalId)).toBe(1);

    ctx.reloj.avanzar(5 * MINUTO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId), 'el puente vuelve').toBe(1);
    let estado = await pedirEstado(token);
    expect(estado.puente?.conectado).toBe(true);
    expect(estado.impresoras.find((i) => i.id === red.id)?.estado).toBe('LISTA');

    ctx.reloj.avanzar(20 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    await senal.revisarAhora();
    expect(avisos(sucursalId)).toBe(0);

    // Y se puede volver a quedar sin señal: un segundo ciclo avisa de nuevo, una vez.
    ctx.reloj.avanzar(2 * MINUTO);
    await senal.revisarAhora();
    await senal.revisarAhora();
    expect(avisos(sucursalId)).toBe(1);
    estado = await pedirEstado(token);
    expect(estado.puente?.conectado).toBe(false);
  });

  it('un latido que llega pasados los 60 segundos, sin que la revisión haya corrido, avisa que el puente vuelve', async () => {
    const { sucursalId, red, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    avisos(sucursalId);

    ctx.reloj.avanzar(90 * SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    expect(avisos(sucursalId)).toBe(1);
    // La revisión posterior ya no encuentra nada que avisar.
    await senal.revisarAhora();
    expect(avisos(sucursalId)).toBe(0);
  });

  it('un puente que nunca dio señal no se avisa como desconectado; uno revocado deja de vigilarse sin avisar nada', async () => {
    const { sucursalId, token, red, puente } = await preparar();
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    avisos(sucursalId);
    // Un puente nuevo reemplaza (revoca) al anterior y todavía no da señal.
    const nuevo = await nuevoPuente(ctx, T(), A(), sucursalId);
    ctx.publicador.limpiar();
    ctx.reloj.avanzar(5 * MINUTO);
    // Lo consulta una PWA: queda vigilado, pero sin señal nunca hubo conexión que perder.
    expect((await pedirEstado(token)).puente).toMatchObject({ id: nuevo.id, conectado: false });
    await senal.revisarAhora();
    await senal.revisarAhora();
    expect(avisos(sucursalId)).toBe(0);
    const filas = await admin.query<{ desconexion_avisada_en: Date | null; activo: boolean }>(
      'SELECT desconexion_avisada_en, activo FROM puente WHERE id = ANY($1::uuid[]) ORDER BY activo',
      [[puente.id, nuevo.id]],
    );
    expect(filas.rows).toEqual([
      { desconexion_avisada_en: null, activo: false },
      { desconexion_avisada_en: null, activo: true },
    ]);
  });

  it('la revisión solo avisa a la sucursal del puente que se quedó sin señal', async () => {
    const { sucursalId, red, puente } = await preparar();
    const otra = A().S1;
    const otraImpresora = await impresoraCreada(ctx, T(), otra, cuerpoRed());
    const otroPuente = await nuevoPuente(ctx, T(), A(), otra);
    ctx.reloj.avanzar(SEGUNDO);
    await latir(puente, [{ id: red.id, estado: 'LISTA' }]);
    await latir(otroPuente, [{ id: otraImpresora.id, estado: 'LISTA' }]);
    ctx.publicador.limpiar();

    // Solo el segundo sigue latiendo.
    ctx.reloj.avanzar(40 * SEGUNDO);
    await latir(otroPuente, [{ id: otraImpresora.id, estado: 'LISTA' }]);
    ctx.reloj.avanzar(30 * SEGUNDO);
    await latir(otroPuente, [{ id: otraImpresora.id, estado: 'LISTA' }]);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'el puente de S3 lleva 70 segundos sin señal').toBe(1);
    expect(ultimosAjenos, 'ninguna otra sucursal recibe el aviso').toBe(0);
    const filas = await admin.query<{ id: string; desconexion_avisada_en: Date | null }>(
      'SELECT id, desconexion_avisada_en FROM puente WHERE id = ANY($1::uuid[])',
      [[puente.id, otroPuente.id]],
    );
    expect(filas.rows.find((f) => f.id === otroPuente.id)!.desconexion_avisada_en).toBeNull();
    expect(filas.rows.find((f) => f.id === puente.id)!.desconexion_avisada_en).not.toBeNull();
  });
});

describe('el puente se conecta por el socket (criterios 111 y 120)', () => {
  it('conectarse tras estar sin señal avisa una vez; reconectarse con señal reciente y desconectarse no avisan', async () => {
    const { sucursalId, token, puente } = await preparar();

    ctx.reloj.avanzar(SEGUNDO);
    const primero = await conectarSocketDelPuente(ctx.app, cierres, puente.token);
    await esperarSenal(puente.id);
    await esperarHasta(() => ctx.publicador.eventos().length > 0, 3000, 'el aviso de conexión');
    expect(avisos(sucursalId), 'primera conexión').toBe(1);
    expect((await pedirEstado(token)).puente?.conectado).toBe(true);

    // Se cae y reconecta en seguida: la señal sigue fresca, no cambió nada.
    ctx.reloj.avanzar(10 * SEGUNDO);
    primero.cerrar();
    await esperarSenal(puente.id);
    ctx.reloj.avanzar(5 * SEGUNDO);
    const segundo = await conectarSocketDelPuente(ctx.app, cierres, puente.token);
    await esperarSenal(puente.id);
    await unMomento();
    expect(avisos(sucursalId), 'desconectar y reconectar con señal reciente').toBe(0);

    // Sin señal más de 60 segundos la revisión avisa; el socket que vuelve avisa otra vez.
    ctx.reloj.avanzar(SEGUNDO);
    segundo.cerrar();
    await esperarSenal(puente.id);
    ctx.reloj.avanzar(61 * SEGUNDO);
    await senal.revisarAhora();
    expect(avisos(sucursalId), 'sin señal por más de 60 segundos').toBe(1);
    await conectarSocketDelPuente(ctx.app, cierres, puente.token);
    await esperarSenal(puente.id);
    await esperarHasta(() => ctx.publicador.eventos().length > 0, 3000, 'el aviso de que vuelve');
    expect(avisos(sucursalId), 'el puente vuelve por el socket').toBe(1);
    expect((await pedirEstado(token)).puente?.conectado).toBe(true);
  });
});
