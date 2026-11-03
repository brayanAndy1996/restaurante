// Historia 005, grupo C3 · pruebas del desarrollador (no protegidas). Cubren:
// - un producto desactivado se rechaza en la ruta pública con el mismo cuerpo que uno inexistente (no revela el motivo
//   "desactivado"), mientras que la revisión del mozo (`GET /llamados/:id`) sí dice el motivo real (decisión del
//   orquestador de la C3);
// - `GET /llamados` se arma con un número fijo de consultas, las mismas con 3 que con 12 llamados;
// - `ErrorAplicacion.conservarCambios`: el rechazo `LLAMADO_VENCIDO` confirma el `VENCIDO` que escribió y no deja
//   reservada la clave de idempotencia, de modo que repetir con la misma clave responde igual (409), no 409
//   `CONFLICTO` ("sigue en curso") ni 422.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  ES_CONTROL_DE_TRANSACCION,
  registrarConsultas,
} from '../llamados-critica/fabrica-aislamiento';
import {
  HORA_DE_SERVICIO,
  MINUTO,
  abriendo,
  arrancarLlamados,
  atenderLlamado,
  cambiarProducto,
  clienteNuevo,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  detalleDeLlamado,
  enviarLlamado,
  esperarError,
  filaLlamado,
  lineaDe,
  listaDeLlamados,
  mesasConCodigo,
  prepararEscenarioLlamados,
  productoPropio,
  sinIds,
  type AppLlamados,
  type EscenarioLlamados,
} from '../llamados-critica/fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

describe('un producto desactivado', () => {
  it('al público se le rechaza igual que uno inexistente; al mozo, su revisión le dice el motivo real', async () => {
    const [mesa, otra] = await mesasConCodigo(ctx, esc, 2);
    const plato = await productoPropio(ctx, esc, '18.00');
    // El cliente lo pide cuando todavía se vende.
    const pedido = await crearLlamado(ctx, mesa!, cuerpoPedido([lineaDe(plato.id, 1)]));

    await cambiarProducto(ctx, esc, plato.id, { activo: false });
    const inexistente = randomUUID();
    const deInactivo = await enviarLlamado(
      clienteNuevo(ctx),
      otra!.codigo,
      cuerpoPedido([lineaDe(plato.id, 1)]),
    );
    const deInexistente = await enviarLlamado(
      clienteNuevo(ctx),
      otra!.codigo,
      cuerpoPedido([lineaDe(inexistente, 1)]),
    );
    esperarError(deInactivo, 422, 'PRODUCTO_NO_VENDIBLE');
    expect(sinIds(deInactivo, [plato.id])).toEqual(sinIds(deInexistente, [inexistente]));
    expect(JSON.stringify(deInactivo.body)).not.toMatch(/INACTIVO|desactivad/i);

    // El mozo ve el motivo real del llamado que ya existía.
    const detalle = await detalleDeLlamado(ctx, esc.token.mozo, pedido.id);
    expect(detalle.status, detalle.text).toBe(200);
    expect(detalle.body.lineas[0].revision).toMatchObject({
      disponible: false,
      codigo: 'INACTIVO',
      motivo: 'El producto está desactivado',
    });
    expect(detalle.body.totalActual).toBe('0.00');
  });
});

describe('un rechazo que conserva los cambios (LLAMADO_VENCIDO)', () => {
  it('guarda el VENCIDO, no deja la clave de idempotencia reservada y repetir con la misma clave responde igual', async () => {
    const [mesa] = await mesasConCodigo(ctx, esc, 1);
    const creado = await crearLlamado(ctx, mesa!, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO);

    const k = randomUUID();
    const cuerpo = abriendo(2, randomUUID());
    const primera = await atenderLlamado(ctx, esc.token.mozo, creado.id, cuerpo, k);
    esperarError(primera, 409, 'LLAMADO_VENCIDO');
    const fila = (await filaLlamado(admin, mesa!.empresaId, creado.id))!;
    expect(fila.estado).toBe('VENCIDO');
    expect(fila.vencido_en?.getTime()).toBe(fila.vence_en.getTime());

    // La clave no quedó reservada: la misma clave y el mismo cuerpo vuelven a evaluarse y dan el mismo rechazo.
    const repetida = await atenderLlamado(ctx, esc.token.mozo, creado.id, cuerpo, k);
    esperarError(repetida, 409, 'LLAMADO_VENCIDO');
    const huecos = await admin.query(
      `SELECT count(*)::int AS n FROM idempotencia WHERE empresa_id = $1 AND clave = $2`,
      [mesa!.empresaId, k],
    );
    expect(huecos.rows[0].n).toBe(0);
  });

  it('un rechazo normal (409 de estado) sigue revirtiendo: la transacción no conserva nada', async () => {
    const [mesa] = await mesasConCodigo(ctx, esc, 1);
    const creado = await crearLlamado(ctx, mesa!, cuerpoLlamarMozo());
    const atendido = await atenderLlamado(ctx, esc.token.mozo, creado.id, abriendo());
    expect(atendido.status).toBe(200);
    const tomado = await atenderLlamado(ctx, esc.token.mozo2, creado.id, abriendo());
    esperarError(tomado, 409, 'LLAMADO_TOMADO');
    expect((await filaLlamado(admin, mesa!.empresaId, creado.id))!.estado).toBe('ATENDIDO');
  });
});

describe('GET /llamados', () => {
  it('se arma con un número fijo de consultas: las mismas con pocos que con muchos llamados', async () => {
    const contar = async (): Promise<number> => {
      const registro = registrarConsultas(ctx.app);
      try {
        const res = await listaDeLlamados(ctx, esc.token.mozo);
        expect(res.status, res.text).toBe(200);
        return registro.consultas.filter((c) => !ES_CONTROL_DE_TRANSACCION.test(c.sql)).length;
      } finally {
        registro.detener();
      }
    };
    const [primera, ...resto] = await mesasConCodigo(ctx, esc, 12);
    await crearLlamado(ctx, primera!, cuerpoLlamarMozo());
    const pocos = await contar();
    for (const mesa of resto) await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const muchos = await contar();
    expect(muchos).toBe(pocos);
    expect(pocos).toBeLessThanOrEqual(12);
  });
});
