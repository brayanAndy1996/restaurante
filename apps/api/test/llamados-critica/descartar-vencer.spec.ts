// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · Descartar y vencer · Criterios 53 a 55 (con 45 y 52 en lo que toca a `llamado.cambio`). La API real con
// `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, dos empresas (A con S1 y S2, y B), la carta de
// ejemplo de 004, la carta web publicada por sus rutas y las mesas creadas por las rutas de 004.
//
// Cubre: descartar un pendiente de cada tipo y un pedido atendido, con y sin motivo, con quién y cuándo
// (53); repetirlo, hacerlo sobre un pasado o un vencido y publicar `llamado.cambio` (53); que la mesa abierta
// por la atención sigue abierta (53); el vencimiento a los 15 minutos con el reloj de la API en la lista, el
// detalle, el estado público y al atender (54); y los llamados sin pedido atendidos, que no se descartan ni se
// pasan, y que "Pedir la cuenta" solo avisa (55).
import { eventoLlamadoCambioSchema, llamadoDetalleSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enviarOk } from '../salon-critica/fabrica-p2';
import {
  HORA_DE_SERVICIO,
  MINUTO,
  abriendo,
  abrirMesa,
  arrancarLlamados,
  atenderLlamado,
  atenderOk,
  clave,
  conteoDePedidos,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  cuerpoPedirCuenta,
  descartarLlamado,
  descartarOk,
  detalleDeLlamado,
  esperarError,
  eventosDeLlamado,
  eventosDePedidos,
  eventosPublicados,
  exigirEstado,
  filaLlamado,
  lineasDe,
  lineasDelPedido,
  limpiarRegistros,
  listaDeLlamados,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  nombreDe,
  ordenesAbiertasDeLaMesa,
  pasarLlamado,
  pasarOk,
  prepararEscenarioLlamados,
  sinIds,
  verEstado,
  type AppLlamados,
  type CuerpoLlamado,
  type EscenarioLlamados,
  type Lugar,
  type MesaLlamados,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;
let L: ReturnType<typeof lineasDe>;

const t = () => esc.token;
const A = () => esc.e.A;
const mozo = () => A().mozo;
const nuevaMesa = (lugar: Lugar = 'S1'): Promise<MesaLlamados> => mesaConCodigo(ctx, esc, lugar);
const iso = () => ctx.reloj.ahora().toISOString();

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const estadoGuardado = async (mesa: MesaLlamados, id: string): Promise<string> =>
  (await filaLlamado(admin, mesa.empresaId, id))!.estado;

// ===================================================================================================
// Criterio 53 · descartar
// ===================================================================================================

describe('criterio 53 · descartar', () => {
  it.each([
    ['PEDIDO', () => cuerpoPedido(lineasDelPedido(esc))],
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ] as [string, () => CuerpoLlamado][])(
    'un %s pendiente se descarta con motivo: queda DESCARTADO con quién, cuándo y por qué',
    async (tipo, hacer) => {
      const mesa = await nuevaMesa();
      const creado = await crearLlamado(ctx, mesa, hacer());
      ctx.reloj.avanzar(2 * MINUTO);
      await limpiarRegistros(ctx);

      const res = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Pedido falso' });
      exigirEstado(res, 200, `descartar un ${tipo}`);
      const d = llamadoDetalleSchema.parse(res.body);
      expect(d).toMatchObject({
        id: creado.id,
        tipo,
        estado: 'DESCARTADO',
        motivoDescarte: 'Pedido falso',
        cerradoPor: { id: mozo().id, nombre: nombreDe(mozo()) },
        cerradoEn: iso(),
        atendidoPor: null,
        atendidoEn: null,
        lineasPasadas: null,
      });
      const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
      expect(fila).toMatchObject({
        estado: 'DESCARTADO',
        motivo_descarte: 'Pedido falso',
        cerrado_por_usuario_id: mozo().id,
      });
      expect(fila.cerrado_en!.getTime()).toBe(ctx.reloj.ahora().getTime());
      // Descartar no abre ni toca la mesa.
      expect(await eventosDePedidos(ctx)).toEqual([]);
      expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    },
  );

  it('sin motivo también se descarta y el motivo queda en null; con 140 caracteres se acepta', async () => {
    const [a, b] = await mesasConCodigo(ctx, esc, 2);
    const sin = await crearLlamado(ctx, a!, cuerpoLlamarMozo());
    const res = await descartarLlamado(ctx, t().mozo, sin.id, {});
    exigirEstado(res, 200, 'descartar sin motivo');
    expect(res.body).toMatchObject({ estado: 'DESCARTADO', motivoDescarte: null });

    const largo = await crearLlamado(ctx, b!, cuerpoLlamarMozo());
    const motivo = 'm'.repeat(140);
    const res2 = await descartarLlamado(ctx, t().mozo, largo.id, { motivo });
    exigirEstado(res2, 200, 'descartar con 140 caracteres');
    expect(res2.body.motivoDescarte).toBe(motivo);
  });

  it.each([
    ['motivo vacío', { motivo: '' }],
    ['motivo de solo espacios', { motivo: '   ' }],
    ['motivo de 141 caracteres', { motivo: 'm'.repeat(141) }],
    ['motivo que no es texto', { motivo: 12 }],
    ['un campo desconocido', { motivo: 'Repetido', estado: 'ATENDIDO' }],
  ])('%s es 400 DATOS_INVALIDOS y el llamado sigue pendiente', async (_n, cuerpo) => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    esperarError(await descartarLlamado(ctx, t().mozo, creado.id, cuerpo), 400, 'DATOS_INVALIDOS');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
  });

  it('sin Idempotency-Key es 400 con campos', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/llamados/${creado.id}/descarte`,
      cuerpo: {},
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(JSON.stringify(res.body.campos)).toContain('Idempotency-Key');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
  });

  it('un PEDIDO atendido se descarta: conserva quién lo atendió y anota quién lo descartó', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const ordenId = randomUUID();
    await atenderOk(ctx, t().mozo, creado.id, { ordenId, comensales: 2 });
    ctx.reloj.avanzar(MINUTO);
    await limpiarRegistros(ctx);

    const res = await descartarLlamado(ctx, t().mozo2, creado.id, {
      motivo: 'Ya lo pidió al mozo',
    });
    exigirEstado(res, 200, 'descartar un pedido atendido');
    expect(res.body).toMatchObject({
      estado: 'DESCARTADO',
      motivoDescarte: 'Ya lo pidió al mozo',
      atendidoPor: { id: mozo().id },
      cerradoPor: { id: esc.mozo2.id },
      cerradoEn: iso(),
    });
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila).toMatchObject({
      atendido_por_usuario_id: mozo().id,
      cerrado_por_usuario_id: esc.mozo2.id,
    });
  });

  it('si la atención abrió la mesa y no hay nada enviado, la mesa sigue abierta y se puede liberar sin clave', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    const ordenId = randomUUID();
    await atenderOk(ctx, t().mozo, creado.id, { ordenId, comensales: 2 });
    await descartarOk(ctx, t().mozo, creado.id, { motivo: 'Pedido falso' });

    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([ordenId]);
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('OCUPADA');

    const liberar = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${ordenId}/liberacion`,
      cabeceras: clave(),
    });
    exigirEstado(liberar, 200, 'liberar la mesa (004, criterio 44)');
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
  });

  it('repetirlo responde 200 sin cambios: la misma clave devuelve lo guardado y otra clave, el mismo descarte', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const k = randomUUID();
    const primera = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Repetido' }, k);
    exigirEstado(primera, 200, 'descartar');
    ctx.reloj.avanzar(5 * MINUTO);
    await limpiarRegistros(ctx);

    const igual = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Repetido' }, k);
    exigirEstado(igual, 200, 'réplica con la misma clave');
    expect(igual.body).toEqual(primera.body);

    const otraClave = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Otro motivo' });
    exigirEstado(otraClave, 200, 'repetir con otra clave');
    expect(otraClave.body).toMatchObject({
      estado: 'DESCARTADO',
      motivoDescarte: 'Repetido',
      cerradoEn: primera.body.cerradoEn,
      cerradoPor: primera.body.cerradoPor,
    });
    // Aun si lo repite otra persona, no cambia quién lo cerró.
    const otraPersona = await descartarLlamado(ctx, t().mozo2, creado.id, {});
    exigirEstado(otraPersona, 200, 'repetir desde otra persona');
    expect(otraPersona.body.cerradoPor).toEqual(primera.body.cerradoPor);
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('sobre un llamado pasado a la cuenta es 409 LLAMADO_CERRADO con su estado', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    await pasarOk(ctx, t().mozo, creado.id, [{ posicion: 0, cantidad: 1 }]);
    await limpiarRegistros(ctx);
    const res = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Tarde' });
    esperarError(res, 409, 'LLAMADO_CERRADO');
    expect(res.body.estado).toBe('PASADO_A_CUENTA');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PASADO_A_CUENTA');
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('sobre un llamado vencido es 409 LLAMADO_VENCIDO y queda guardado como VENCIDO; a los 14:59.999 todavía se descarta', async () => {
    const [aTiempo, tarde] = await mesasConCodigo(ctx, esc, 2);
    const uno = await crearLlamado(ctx, aTiempo!, cuerpoLlamarMozo());
    const dos = await crearLlamado(ctx, tarde!, cuerpoPedido([L.gaseosa(1)]));
    ctx.reloj.avanzar(15 * MINUTO - 1);
    await descartarOk(ctx, t().mozo, uno.id, { motivo: 'A tiempo' });

    ctx.reloj.avanzar(1);
    await limpiarRegistros(ctx);
    const res = await descartarLlamado(ctx, t().mozo, dos.id, { motivo: 'Tarde' });
    esperarError(res, 409, 'LLAMADO_VENCIDO');
    const fila = (await filaLlamado(admin, tarde!.empresaId, dos.id))!;
    expect(fila.estado).toBe('VENCIDO');
    expect(fila.motivo_descarte).toBeNull();
    expect(fila.cerrado_por_usuario_id).toBeNull();
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('un llamado de otra sucursal de A o de B es 404, igual que uno inexistente', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const inexistente = randomUUID();
    const deS2 = await descartarLlamado(ctx, t().mozoS2, creado.id, {});
    const deB = await descartarLlamado(ctx, t().mozoB, creado.id, {});
    const sinFila = await descartarLlamado(ctx, t().mozo, inexistente, {});
    esperarError(deS2, 404, 'NO_ENCONTRADO');
    esperarError(deB, 404, 'NO_ENCONTRADO');
    esperarError(sinFila, 404, 'NO_ENCONTRADO');
    expect(sinIds(deS2, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(sinIds(deB, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
  });

  it('publica llamado.cambio { llamadoId, mesaId, estado: DESCARTADO } en la sala de la sucursal, y solo una vez', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    await limpiarRegistros(ctx);
    await descartarOk(ctx, t().mozo, creado.id, { motivo: 'Pedido falso' });
    await descartarLlamado(ctx, t().mozo, creado.id, {}); // repetirlo no publica otra vez
    const eventos = await eventosDeLlamado(ctx, 'llamado.cambio');
    expect(eventos).toHaveLength(1);
    const evento = eventoLlamadoCambioSchema.parse(eventos[0]);
    expect(evento.empresaId).toBe(A().empresaId);
    expect(evento.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    expect(evento.datos).toEqual({ llamadoId: creado.id, mesaId: mesa.id, estado: 'DESCARTADO' });
    expect(JSON.stringify(eventos[0]).length).toBeLessThan(4096);
  });
});

// ===================================================================================================
// Criterio 54 · vencer
// ===================================================================================================

describe('criterio 54 · vencer', () => {
  it('a los 14:59.999 sigue pendiente en la lista, el detalle y el estado público; a los 15:00 ya está VENCIDO en los tres', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));

    ctx.reloj.avanzar(15 * MINUTO - 1);
    const enLista = async () =>
      (
        (await listaDeLlamados(ctx, t().mozo)).body.llamados as { id: string; estado: string }[]
      ).find((l) => l.id === creado.id)?.estado;
    const enDetalle = async () => (await detalleDeLlamado(ctx, t().mozo, creado.id)).body.estado;
    const enPublico = async () =>
      (await verEstado(creado.cliente, mesa.codigo, creado.id)).body.estado;

    expect([await enLista(), await enDetalle(), await enPublico()]).toEqual([
      'PENDIENTE',
      'PENDIENTE',
      'PENDIENTE',
    ]);
    ctx.reloj.avanzar(1);
    expect([await enLista(), await enDetalle(), await enPublico()]).toEqual([
      'VENCIDO',
      'VENCIDO',
      'VENCIDO',
    ]);

    // Y al atenderlo o descartarlo ya está vencido.
    esperarError(
      await atenderLlamado(ctx, t().mozo, creado.id, abriendo()),
      409,
      'LLAMADO_VENCIDO',
    );
    esperarError(await descartarLlamado(ctx, t().mozo, creado.id, {}), 409, 'LLAMADO_VENCIDO');
    expect(await estadoGuardado(mesa, creado.id)).toBe('VENCIDO');
  });

  it('el vencimiento sale del reloj de la API: venceEn es creadoEn + 15 minutos en el detalle y en la lista', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const d = await detalleDeLlamado(ctx, t().mozo, creado.id);
    expect(new Date(d.body.venceEn).getTime() - new Date(d.body.creadoEn).getTime()).toBe(
      15 * MINUTO,
    );
    const lista = await listaDeLlamados(ctx, t().mozo);
    expect(lista.body.ahora).toBe(iso());
  });

  it('un llamado atendido no vence aunque pase el tiempo: sigue ATENDIDO en el detalle y en la lista', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    for (let i = 0; i < 3; i += 1) {
      ctx.reloj.avanzar(20 * MINUTO);
      expect((await detalleDeLlamado(ctx, t().mozo, creado.id)).body.estado).toBe('ATENDIDO');
    }
    const fila = (
      (await listaDeLlamados(ctx, t().mozo)).body.llamados as { id: string; estado: string }[]
    ).find((l) => l.id === creado.id);
    expect(fila?.estado).toBe('ATENDIDO');
    expect((await verEstado(creado.cliente, mesa.codigo, creado.id)).body.estado).toBe('ATENDIDO');
  });

  it('no hay tarea programada: vencer no publica eventos ni cambia nada hasta que alguien toca el llamado', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await limpiarRegistros(ctx);
    ctx.reloj.avanzar(25 * MINUTO);
    // Solo lecturas.
    await listaDeLlamados(ctx, t().mozo);
    await detalleDeLlamado(ctx, t().mozo, creado.id);
    await verEstado(creado.cliente, mesa.codigo, creado.id);
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
  });
});

// ===================================================================================================
// Criterio 55 · llamados sin pedido
// ===================================================================================================

describe('criterio 55 · llamados sin pedido', () => {
  it.each([
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ] as [string, () => CuerpoLlamado][])(
    'un %s atendido es final: descartarlo es 409 LLAMADO_CERRADO y pasarlo a la cuenta es 409 TRANSICION_INVALIDA',
    async (_tipo, hacer) => {
      const mesa = await nuevaMesa();
      const creado = await crearLlamado(ctx, mesa, hacer());
      await atenderOk(ctx, t().mozo, creado.id, abriendo());
      await limpiarRegistros(ctx);

      const descartar = await descartarLlamado(ctx, t().mozo, creado.id, { motivo: 'Tarde' });
      esperarError(descartar, 409, 'LLAMADO_CERRADO');
      expect(descartar.body.estado).toBe('ATENDIDO');

      const pasar = await pasarLlamado(ctx, t().mozo, creado.id, {
        lineas: [{ posicion: 0, cantidad: 1 }],
      });
      esperarError(pasar, 409, 'TRANSICION_INVALIDA');

      expect(await estadoGuardado(mesa, creado.id)).toBe('ATENDIDO');
      expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    },
  );

  it('"Pedir la cuenta" solo avisa: ni al crearlo ni al atenderlo se emite o imprime la pre-cuenta ni cambia la orden', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    await enviarOk(ctx, t().mozo, ordenId, [L.gaseosa(2)]);
    const antes = await conteoDePedidos(admin, mesa.empresaId);
    const precuentas = async () =>
      (await admin.query('SELECT count(*)::int AS n FROM precuenta WHERE orden_id = $1', [ordenId]))
        .rows[0].n as number;
    expect(await precuentas()).toBe(0);
    await limpiarRegistros(ctx);

    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    await atenderOk(ctx, t().mozo, creado.id, {});

    expect(await precuentas()).toBe(0);
    expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('OCUPADA');
    expect(
      (await admin.query('SELECT estado FROM orden WHERE id = $1', [ordenId])).rows[0].estado,
    ).toBe('ABIERTA');
    expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
    const nombres = (await eventosPublicados(ctx)).map((e) => e.nombre);
    expect(
      nombres.filter(
        (n) => n.startsWith('cocina.') || n === 'salon.cambio' || n === 'orden.cambio',
      ),
    ).toEqual([]);
  });
});
