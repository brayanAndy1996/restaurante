// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P3 · Pasar a la cuenta · Criterios 46 a 52 (con 40 en lo que toca a la revisión). La API real con
// `RelojManual`, `PublicadorEnMemoria` e `InventarioDePrueba`, dos empresas (A con S1 y S2, y B), la carta de
// ejemplo de 004, la carta web publicada por sus rutas, las mesas creadas por las rutas de 004 y las personas
// creadas con `POST /usuarios`.
//
// Cubre: la forma de la entrada (posiciones fuera de rango o repetidas, cantidad de 1 a 999, campos de producto
// o modificadores rechazados por estrictos) y quién puede pasarlo (46); solo un `PEDIDO` `ATENDIDO` (46); los
// precios y la disponibilidad del sistema, todo o nada (47); la cuenta vigente de la mesa: la principal si se
// unió, `MESA_SIN_CUENTA` si la anularon (48); que nada llega a cocina: ni envío, ítem, comanda, línea de comanda,
// trabajo de impresión, ni llamada al inventario, ni cambia `orden.version` ni la pre-cuenta, ni se publican
// `cocina.*`, `salon.cambio` ni `orden.cambio` (49); de punta a punta con `POST /ordenes/:id/envios` (50); la
// réplica con la misma clave, con otra clave y las mismas líneas (instantánea) y con otras líneas, y dos pasos
// simultáneos (51); y `llamado.cambio` (52).
import {
  envioRespuestaSchema,
  eventoLlamadoCambioSchema,
  pasoACuentaRespuestaSchema,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  agotar,
  anularOrdenOk,
  crearEnCarta,
  enviarComanda,
  enviarOk,
  envio,
  nombreUnico,
  pedirPrecuenta,
  reactivar,
  simpleNuevo,
  unirMesasOk,
  type LineaCuerpo,
} from '../salon-critica/fabrica-p2';
import {
  HORA_DE_SERVICIO,
  MINUTO,
  abrirMesa,
  arrancarLlamados,
  atenderOk,
  cambiarProducto,
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
  lineaDe,
  lineasDe,
  limpiarRegistros,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  nombreDe,
  ordenesAbiertasDeLaMesa,
  pasarLlamado,
  pasarOk,
  prepararEscenarioLlamados,
  productoPropio,
  sinIds,
  versionDeLaOrden,
  type AppLlamados,
  type EscenarioLlamados,
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
const nuevaMesa = (): Promise<MesaLlamados> => mesaConCodigo(ctx, esc);
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

/**
 * El pedido de tres líneas: 0 Lomo [3/4, Huevo] × 2 (S/ 30.50 c/u), 1 Combo [Cerveza, Ensalada] × 2 (S/ 28.40 c/u)
 * y 2 Gaseosa × 1 (S/ 9.00). Total que ve el cliente: 126.80.
 */
const lineasDelCliente = (): LineaCuerpo[] => [
  L.lomo(['3/4', 'Huevo'], 2),
  L.combo(['Cerveza', 'Ensalada'], 2),
  L.gaseosa(1),
];
const todasLasLineas = (cantidades = [2, 2, 1]) =>
  cantidades.map((cantidad, posicion) => ({ posicion, cantidad }));

interface PedidoAtendido {
  mesa: MesaLlamados;
  id: string;
  ordenId: string;
  cuerpo: ReturnType<typeof cuerpoPedido>;
}

/** Crea el pedido en una mesa libre y lo atiende el Mozo (que abre la mesa). */
async function pedidoAtendido(
  lineas: LineaCuerpo[] = lineasDelCliente(),
  atiende: string = t().mozo,
): Promise<PedidoAtendido> {
  const mesa = await nuevaMesa();
  const cuerpo = cuerpoPedido(lineas);
  const creado = await crearLlamado(ctx, mesa, cuerpo);
  const ordenId = randomUUID();
  await atenderOk(ctx, atiende, creado.id, { ordenId, comensales: 2 });
  return { mesa, id: creado.id, ordenId, cuerpo };
}

interface Foto {
  conteo: Awaited<ReturnType<typeof conteoDePedidos>>;
  version: number;
  estadoOrden: string;
  estadoLlamado: string;
}

/** Lo que no debe cambiar si el paso se rechaza. */
async function foto(p: PedidoAtendido): Promise<Foto> {
  const orden = await admin.query('SELECT version, estado FROM orden WHERE id = $1', [p.ordenId]);
  return {
    conteo: await conteoDePedidos(admin, p.mesa.empresaId),
    version: orden.rows[0].version as number,
    estadoOrden: orden.rows[0].estado as string,
    estadoLlamado: (await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado,
  };
}

/** El paso se rechazó sin dejar rastro: el llamado sigue ATENDIDO y nada de pedidos ni eventos cambió. */
async function sinRastro(p: PedidoAtendido, antes: Foto): Promise<void> {
  expect(await foto(p)).toEqual({ ...antes, estadoLlamado: 'ATENDIDO' });
  expect(antes.estadoLlamado).toBe('ATENDIDO');
  expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  const d = await detalleDeLlamado(ctx, t().mozo, p.id);
  expect(d.body).toMatchObject({ estado: 'ATENDIDO', lineasPasadas: null, cerradoPor: null });
}

/** `pasoACuentaRespuesta` → el cuerpo de un envío de 004 (como `aLineaDeEnvio` de la PWA). */
function comoEnvio(
  lineas: {
    productoId: string;
    modificadores: { id: string }[];
    cantidad: number;
    observacion: string | null;
  }[],
) {
  return lineas.map((l): LineaCuerpo => ({
    productoId: l.productoId,
    modificadorIds: l.modificadores.map((m) => m.id),
    cantidad: l.cantidad,
    ...(l.observacion !== null ? { observacion: l.observacion } : {}),
  }));
}

// ===================================================================================================
// Criterio 46 · pasar: la respuesta y la forma
// ===================================================================================================

describe('criterio 46 · pasar a la cuenta', () => {
  it('responde 200 con el llamado PASADO_A_CUENTA, la orden y las líneas con los precios del sistema', async () => {
    const p = await pedidoAtendido();
    ctx.reloj.avanzar(2 * MINUTO);
    await limpiarRegistros(ctx);

    const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
    exigirEstado(res, 200, 'pasar a la cuenta');
    const cuerpo = pasoACuentaRespuestaSchema.parse(res.body);
    expect(cuerpo.ordenId).toBe(p.ordenId);
    expect(cuerpo.llamado).toMatchObject({
      id: p.id,
      estado: 'PASADO_A_CUENTA',
      ordenId: p.ordenId,
      lineasPasadas: todasLasLineas(),
      atendidoPor: { id: mozo().id },
      cerradoPor: { id: mozo().id, nombre: nombreDe(mozo()) },
      cerradoEn: iso(),
    });
    expect(cuerpo.lineas).toHaveLength(3);
    expect(cuerpo.lineas[0]).toMatchObject({
      posicion: 0,
      productoId: esc.carta.lomo,
      nombre: 'Lomo saltado',
      cantidad: 2,
      observacion: null,
      precioUnitario: '30.50',
      total: '61.00',
    });
    expect(cuerpo.lineas[0]!.modificadores.map((m) => m.nombre).sort()).toEqual(['3/4', 'Huevo']);
    expect(cuerpo.lineas[0]!.modificadores.find((m) => m.nombre === 'Huevo')).toMatchObject({
      id: esc.carta.mod['Huevo'],
      precioExtra: '2.50',
    });
    expect(cuerpo.lineas[1]).toMatchObject({
      posicion: 1,
      nombre: 'Combo hamburguesa',
      precioUnitario: '28.40',
      total: '56.80',
    });
    expect(cuerpo.lineas[2]).toMatchObject({
      posicion: 2,
      productoId: esc.carta.gaseosa,
      precioUnitario: '9.00',
      total: '9.00',
    });

    const fila = (await filaLlamado(admin, p.mesa.empresaId, p.id))!;
    expect(fila).toMatchObject({
      estado: 'PASADO_A_CUENTA',
      orden_id: p.ordenId,
      cerrado_por_usuario_id: mozo().id,
    });
    expect(fila.lineas_pasadas).toEqual(todasLasLineas());
    // La lista y el detalle lo muestran pasado.
    const d = await detalleDeLlamado(ctx, t().mozo, p.id);
    expect(d.body).toMatchObject({ estado: 'PASADO_A_CUENTA', lineasPasadas: todasLasLineas() });
  });

  it('las que faltan son las que el mozo quitó: solo se pasan las que van, y la cantidad la cambia el mozo', async () => {
    const p = await pedidoAtendido();
    const res = await pasarOk(ctx, t().mozo, p.id, [
      { posicion: 2, cantidad: 3 },
      { posicion: 0, cantidad: 5 },
    ]);
    const cuerpo = pasoACuentaRespuestaSchema.parse(res.body);
    expect(cuerpo.lineas).toHaveLength(2);
    const porPosicion = (n: number) => cuerpo.lineas.find((l) => l.posicion === n)!;
    expect(porPosicion(0)).toMatchObject({ cantidad: 5, precioUnitario: '30.50', total: '152.50' });
    expect(porPosicion(2)).toMatchObject({ cantidad: 3, precioUnitario: '9.00', total: '27.00' });
    expect(cuerpo.lineas.some((l) => l.posicion === 1)).toBe(false);
    expect(
      [...(cuerpo.llamado.lineasPasadas ?? [])].sort((a, b) => a.posicion - b.posicion),
    ).toEqual([
      { posicion: 0, cantidad: 5 },
      { posicion: 2, cantidad: 3 },
    ]);
  });

  it('la cantidad va de 1 a 999: 999 se acepta', async () => {
    const p = await pedidoAtendido([L.gaseosa(1)]);
    const res = await pasarOk(ctx, t().mozo, p.id, [{ posicion: 0, cantidad: 999 }]);
    expect(res.body.lineas[0]).toMatchObject({ cantidad: 999, total: '8991.00' });
  });

  it.each([
    ['sin la clave lineas', {}],
    ['lineas vacío', { lineas: [] }],
    ['31 líneas', { lineas: Array.from({ length: 31 }, (_, i) => ({ posicion: i, cantidad: 1 })) }],
    ['cantidad 0', { lineas: [{ posicion: 0, cantidad: 0 }] }],
    ['cantidad 1000', { lineas: [{ posicion: 0, cantidad: 1000 }] }],
    ['cantidad con decimales', { lineas: [{ posicion: 0, cantidad: 1.5 }] }],
    ['cantidad como texto', { lineas: [{ posicion: 0, cantidad: '2' }] }],
    ['sin cantidad', { lineas: [{ posicion: 0 }] }],
    ['sin posición', { lineas: [{ cantidad: 1 }] }],
    ['posición con decimales', { lineas: [{ posicion: 0.5, cantidad: 1 }] }],
    [
      'productoId en la línea',
      { lineas: [{ posicion: 0, cantidad: 1, productoId: randomUUID() }] },
    ],
    ['modificadorIds en la línea', { lineas: [{ posicion: 0, cantidad: 1, modificadorIds: [] }] }],
    ['modificadores en la línea', { lineas: [{ posicion: 0, cantidad: 1, modificadores: [] }] }],
    ['observacion en la línea', { lineas: [{ posicion: 0, cantidad: 1, observacion: 'otra' }] }],
    ['precio en la línea', { lineas: [{ posicion: 0, cantidad: 1, precioUnitario: '1.00' }] }],
    ['nombre en la línea', { lineas: [{ posicion: 0, cantidad: 1, nombre: 'Otro plato' }] }],
    ['ordenId en el cuerpo', { lineas: [{ posicion: 0, cantidad: 1 }], ordenId: randomUUID() }],
    ['mesaId en el cuerpo', { lineas: [{ posicion: 0, cantidad: 1 }], mesaId: randomUUID() }],
  ])('%s es 400 DATOS_INVALIDOS y no cambia nada', async (_n, cuerpo) => {
    const p = await pedidoAtendido();
    const antes = await foto(p);
    await limpiarRegistros(ctx);
    esperarError(await pasarLlamado(ctx, t().mozo, p.id, cuerpo), 400, 'DATOS_INVALIDOS');
    await sinRastro(p, antes);
  });

  it('sin Idempotency-Key es 400 con campos', async () => {
    const p = await pedidoAtendido();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/llamados/${p.id}/paso-a-cuenta`,
      cuerpo: { lineas: todasLasLineas() },
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(JSON.stringify(res.body.campos)).toContain('Idempotency-Key');
  });

  it.each([
    [
      'una posición que no existe (3 de 0 a 2)',
      [
        { posicion: 0, cantidad: 1 },
        { posicion: 3, cantidad: 1 },
      ],
    ],
    ['una posición muy grande', [{ posicion: 99, cantidad: 1 }]],
    [
      'una posición repetida',
      [
        { posicion: 1, cantidad: 1 },
        { posicion: 1, cantidad: 2 },
      ],
    ],
    [
      'la misma posición tres veces',
      [
        { posicion: 0, cantidad: 1 },
        { posicion: 0, cantidad: 1 },
        { posicion: 0, cantidad: 1 },
      ],
    ],
  ])('%s es 422 DATOS_INVALIDOS con campos y no cambia nada', async (_n, lineas) => {
    const p = await pedidoAtendido();
    const antes = await foto(p);
    await limpiarRegistros(ctx);
    const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas });
    esperarError(res, 422, 'DATOS_INVALIDOS');
    expect(Array.isArray(res.body.campos)).toBe(true);
    expect(res.body.campos.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body.campos)).toContain('lineas');
    await sinRastro(p, antes);
  });

  it('una posición negativa se rechaza (400 por la forma o 422) y no cambia nada', async () => {
    const p = await pedidoAtendido();
    const antes = await foto(p);
    const res = await pasarLlamado(ctx, t().mozo, p.id, {
      lineas: [{ posicion: -1, cantidad: 1 }],
    });
    expect([400, 422]).toContain(res.status);
    expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    expect(await foto(p)).toEqual(antes);
  });
});

// ===================================================================================================
// Criterio 46 · solo un PEDIDO ATENDIDO
// ===================================================================================================

describe('criterio 46 · solo un PEDIDO ATENDIDO se pasa', () => {
  it('un PEDIDO pendiente (sin atender) es 409 TRANSICION_INVALIDA y no cambia nada', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelCliente()));
    await limpiarRegistros(ctx);
    const res = await pasarLlamado(ctx, t().mozo, creado.id, { lineas: todasLasLineas() });
    esperarError(res, 409, 'TRANSICION_INVALIDA');
    expect((await filaLlamado(admin, mesa.empresaId, creado.id))!.estado).toBe('PENDIENTE');
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    // Y el rechazo no consumió la clave de la mesa: se atiende y se pasa con normalidad.
    await atenderOk(ctx, t().mozo, creado.id, { ordenId: randomUUID(), comensales: 2 });
    await pasarOk(ctx, t().mozo, creado.id, todasLasLineas());
  });

  it.each([
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ])('un %s sin pedido (pendiente o atendido) es 409 TRANSICION_INVALIDA', async (_tipo, hacer) => {
    const [a, b] = await mesasConCodigo(ctx, esc, 2);
    const pendiente = await crearLlamado(ctx, a!, hacer());
    esperarError(
      await pasarLlamado(ctx, t().mozo, pendiente.id, { lineas: [{ posicion: 0, cantidad: 1 }] }),
      409,
      'TRANSICION_INVALIDA',
    );
    const atendido = await crearLlamado(ctx, b!, hacer());
    await atenderOk(ctx, t().mozo, atendido.id, { ordenId: randomUUID(), comensales: 2 });
    esperarError(
      await pasarLlamado(ctx, t().mozo, atendido.id, { lineas: [{ posicion: 0, cantidad: 1 }] }),
      409,
      'TRANSICION_INVALIDA',
    );
    expect((await filaLlamado(admin, a!.empresaId, pendiente.id))!.estado).toBe('PENDIENTE');
    expect((await filaLlamado(admin, b!.empresaId, atendido.id))!.estado).toBe('ATENDIDO');
  });

  it('un llamado descartado es 409 LLAMADO_CERRADO con su estado', async () => {
    const p = await pedidoAtendido();
    await descartarOk(ctx, t().mozo, p.id, { motivo: 'Pedido falso' });
    await limpiarRegistros(ctx);
    const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
    esperarError(res, 409, 'LLAMADO_CERRADO');
    expect(res.body.estado).toBe('DESCARTADO');
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('el estado (409) va antes que la forma de las posiciones (422)', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelCliente()));
    esperarError(
      await pasarLlamado(ctx, t().mozo, creado.id, { lineas: [{ posicion: 99, cantidad: 1 }] }),
      409,
      'TRANSICION_INVALIDA',
    );
  });

  it('cualquier persona con ATENDER_MESA de la sucursal puede pasarlo, no solo quien lo atendió', async () => {
    const [a, b] = [await pedidoAtendido(), await pedidoAtendido()];
    const porMozo2 = await pasarOk(ctx, t().mozo2, a.id, todasLasLineas());
    expect(porMozo2.body.llamado).toMatchObject({
      atendidoPor: { id: mozo().id },
      cerradoPor: { id: esc.mozo2.id, nombre: nombreDe(esc.mozo2) },
    });
    const porCajero = await pasarOk(ctx, t().cajero, b.id, todasLasLineas());
    expect(porCajero.body.llamado.cerradoPor.id).toBe(A().cajero.id);
  });

  it('un llamado de otra sucursal de A o de B es 404, igual que uno inexistente, y no cambia', async () => {
    const p = await pedidoAtendido();
    const inexistente = randomUUID();
    const deS2 = await pasarLlamado(ctx, t().mozoS2, p.id, { lineas: todasLasLineas() });
    const deB = await pasarLlamado(ctx, t().mozoB, p.id, { lineas: todasLasLineas() });
    const sinFila = await pasarLlamado(ctx, t().mozo, inexistente, { lineas: todasLasLineas() });
    esperarError(deS2, 404, 'NO_ENCONTRADO');
    esperarError(deB, 404, 'NO_ENCONTRADO');
    esperarError(sinFila, 404, 'NO_ENCONTRADO');
    expect(sinIds(deS2, [p.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(sinIds(deB, [p.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado).toBe('ATENDIDO');
  });
});

// ===================================================================================================
// Criterio 47 · precios y disponibilidad del sistema, todo o nada
// ===================================================================================================

describe('criterio 47 · precios y disponibilidad del sistema', () => {
  it('el precio es el del sistema aunque el cliente haya visto otro; el detalle conserva lo que vio el cliente', async () => {
    const plato = await productoPropio(ctx, esc, '20.00');
    const p = await pedidoAtendido([lineaDe(plato.id, 2), L.gaseosa(1)]);
    await cambiarProducto(ctx, esc, plato.id, { precio: '25.00' });

    const res = await pasarOk(ctx, t().mozo, p.id, [
      { posicion: 0, cantidad: 2 },
      { posicion: 1, cantidad: 1 },
    ]);
    const cuerpo = pasoACuentaRespuestaSchema.parse(res.body);
    expect(cuerpo.lineas[0]).toMatchObject({
      precioUnitario: '25.00',
      total: '50.00',
      cantidad: 2,
    });
    expect(cuerpo.lineas[1]).toMatchObject({ precioUnitario: '9.00', total: '9.00' });
    expect(cuerpo.llamado.lineas[0]).toMatchObject({ precioCliente: '20.00' });
    expect(cuerpo.llamado.totalCliente).toBe('49.00');
  });

  it('un modificador que cambió de precio también se cobra al precio del sistema', async () => {
    const salsa = await crearEnCarta(ctx, A().tokenAdmin, '/carta/grupos-modificadores', {
      nombre: nombreUnico('Salsa mutable'),
      seleccion: 'UNICA',
      obligatorio: true,
      modificadores: [
        { nombre: 'Rocoto', precioExtra: '1.00' },
        { nombre: 'Ají amarillo', precioExtra: '0.50' },
      ],
    });
    const rocoto = salsa.modificadores!.find((m) => m.nombre === 'Rocoto')!.id;
    const aji = salsa.modificadores!.find((m) => m.nombre === 'Ají amarillo')!.id;
    const plato = await crearEnCarta(
      ctx,
      A().tokenAdmin,
      '/carta/productos',
      simpleNuevo(esc.carta, {
        nombre: nombreUnico('Plato con salsa'),
        precio: '15.00',
        gruposModificadores: [salsa.id],
      }),
    );
    const p = await pedidoAtendido([
      { productoId: plato.id, modificadorIds: [rocoto], cantidad: 1 },
    ]);
    const cambio = await llamar(ctx, A().tokenAdmin, {
      metodo: 'patch',
      ruta: `/carta/grupos-modificadores/${salsa.id}`,
      cuerpo: {
        modificadores: [
          { id: rocoto, nombre: 'Rocoto', precioExtra: '3.00' },
          { id: aji, nombre: 'Ají amarillo', precioExtra: '0.50' },
        ],
      },
    });
    exigirEstado(cambio, 200, 'cambiar el precio del Rocoto');
    const res = await pasarOk(ctx, t().mozo, p.id, [{ posicion: 0, cantidad: 1 }]);
    expect(res.body.lineas[0]).toMatchObject({ precioUnitario: '18.00', total: '18.00' });
    expect(res.body.lineas[0].modificadores[0]).toMatchObject({
      nombre: 'Rocoto',
      precioExtra: '3.00',
    });
    expect(res.body.llamado.lineas[0]).toMatchObject({ precioCliente: '16.00' });
  });

  it('una opción agotada entre el pedido y el paso (Cerveza): 422 SELECCION_INVALIDA en esa línea, nada cambia, el llamado sigue ATENDIDO; sin esa línea, 200', async () => {
    const p = await pedidoAtendido();
    await agotar(ctx, t().cocina, esc.carta.cervezaPilsen);
    try {
      // El detalle ya la muestra no disponible.
      const detalle = await detalleDeLlamado(ctx, t().mozo, p.id);
      expect(detalle.body.lineas[1].revision.disponible).toBe(false);
      const antes = await foto(p);
      await limpiarRegistros(ctx);

      const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
      esperarError(res, 422, 'SELECCION_INVALIDA');
      expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['lineas.1']);
      expect(JSON.stringify(res.body.campos)).toContain('MODIFICADOR_NO_DISPONIBLE');
      await sinRastro(p, antes);

      // Sin esa línea, el paso sale.
      const sin = await pasarOk(ctx, t().mozo, p.id, [
        { posicion: 0, cantidad: 2 },
        { posicion: 2, cantidad: 1 },
      ]);
      expect(sin.body.lineas.map((l: { posicion: number }) => l.posicion)).toEqual([0, 2]);
      expect(sin.body.llamado.estado).toBe('PASADO_A_CUENTA');
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.cervezaPilsen);
    }
  });

  it('un producto agotado (propio): 422 PRODUCTO_NO_VENDIBLE en su línea y, al reactivarlo, el mismo paso sale', async () => {
    const plato = await productoPropio(ctx, esc, '14.00');
    const p = await pedidoAtendido([L.gaseosa(1), lineaDe(plato.id, 2)]);
    await agotar(ctx, t().cocina, plato.id);
    try {
      const antes = await foto(p);
      await limpiarRegistros(ctx);
      const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas([1, 2]) });
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
      expect(res.body.campos.map((c: { campo: string }) => c.campo)).toEqual(['lineas.1']);
      await sinRastro(p, antes);
    } finally {
      await reactivar(ctx, t().cocina, plato.id);
    }
    const ok = await pasarOk(ctx, t().mozo, p.id, todasLasLineas([1, 2]));
    expect(ok.body.lineas[1]).toMatchObject({ precioUnitario: '14.00', total: '28.00' });
  });

  it('un componente agotado (Hamburguesa) es 422 PRODUCTO_NO_VENDIBLE con COMPONENTE_NO_DISPONIBLE', async () => {
    const p = await pedidoAtendido();
    await agotar(ctx, t().cocina, esc.carta.hamburguesa);
    try {
      const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
      expect(JSON.stringify(res.body.campos)).toContain('COMPONENTE_NO_DISPONIBLE');
      expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado).toBe('ATENDIDO');
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.hamburguesa);
    }
  });

  it('campos lleva una entrada por línea rechazada y el código es el de la primera', async () => {
    const plato = await productoPropio(ctx, esc, '11.00');
    const p = await pedidoAtendido([
      L.gaseosa(1),
      lineaDe(plato.id, 1),
      L.combo(['Cerveza', 'Ensalada'], 1),
      L.gaseosa(2),
    ]);
    await agotar(ctx, t().cocina, plato.id);
    await agotar(ctx, t().cocina, esc.carta.cervezaPilsen);
    try {
      const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas([1, 1, 1, 2]) });
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
      expect(res.body.campos.map((c: { campo: string }) => c.campo).sort()).toEqual([
        'lineas.1',
        'lineas.2',
      ]);
      expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado).toBe('ATENDIDO');
    } finally {
      await reactivar(ctx, t().cocina, plato.id);
      await reactivar(ctx, t().cocina, esc.carta.cervezaPilsen);
    }
  });

  it('el tope de monto (MONTO_FUERA_DE_RANGO) se aplica a la cantidad que pone el mozo y nada cambia', async () => {
    const tesoro = await productoPropio(ctx, esc, '99999999.99');
    const p = await pedidoAtendido([lineaDe(tesoro.id, 1)]);
    const antes = await foto(p);
    await limpiarRegistros(ctx);
    const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: [{ posicion: 0, cantidad: 2 }] });
    esperarError(res, 422, 'MONTO_FUERA_DE_RANGO');
    await sinRastro(p, antes);
    // Con la cantidad original sí.
    const ok = await pasarOk(ctx, t().mozo, p.id, [{ posicion: 0, cantidad: 1 }]);
    expect(ok.body.lineas[0].total).toBe('99999999.99');
  });

  it('el producto, los modificadores y la observación salen del llamado: la observación del cliente viaja a la cuenta', async () => {
    const p = await pedidoAtendido([L.lomo(['3/4', 'Queso'], 1, { observacion: 'sin ají' })]);
    const res = await pasarOk(ctx, t().mozo, p.id, [{ posicion: 0, cantidad: 1 }]);
    expect(res.body.lineas[0]).toMatchObject({
      productoId: esc.carta.lomo,
      observacion: 'sin ají',
      precioUnitario: '30.00',
    });
    expect(
      res.body.lineas[0].modificadores.map((m: { nombre: string }) => m.nombre).sort(),
    ).toEqual(['3/4', 'Queso']);
  });
});

// ===================================================================================================
// Criterio 48 · la cuenta de la mesa
// ===================================================================================================

describe('criterio 48 · la cuenta vigente de la mesa', () => {
  it('las líneas van a la orden abierta de la mesa y el llamado guarda esa orden', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo2);
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelCliente()));
    await atenderOk(ctx, t().mozo, creado.id, {});
    const res = await pasarOk(ctx, t().mozo, creado.id, todasLasLineas());
    expect(res.body.ordenId).toBe(ordenId);
    expect((await filaLlamado(admin, mesa.empresaId, creado.id))!.orden_id).toBe(ordenId);
  });

  it('con la mesa unida a otra, las líneas van a la cuenta principal', async () => {
    const [mesaDelLlamado, mesaPrincipal] = await mesasConCodigo(ctx, esc, 2);
    const principal = await abrirMesa(ctx, esc, mesaPrincipal!, t().mozo2);
    const creado = await crearLlamado(ctx, mesaDelLlamado!, cuerpoPedido(lineasDelCliente()));
    const propia = randomUUID();
    await atenderOk(ctx, t().mozo, creado.id, { ordenId: propia, comensales: 2 });
    await unirMesasOk(ctx, t().supervisor, principal, [mesaDelLlamado!.id]);
    expect(await ordenesAbiertasDeLaMesa(admin, mesaDelLlamado!.id)).toEqual([principal]);

    const res = await pasarOk(ctx, t().mozo, creado.id, todasLasLineas());
    expect(res.body.ordenId).toBe(principal);
    expect(res.body.llamado.ordenId).toBe(principal);
  });

  it('sin orden abierta (la anularon después de atender) es 409 MESA_SIN_CUENTA y nada cambia; abriendo la mesa de nuevo, sale', async () => {
    const p = await pedidoAtendido();
    await anularOrdenOk(ctx, t().supervisor, p.ordenId);
    const antes = await foto(p);
    await limpiarRegistros(ctx);

    const res = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
    esperarError(res, 409, 'MESA_SIN_CUENTA');
    expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado).toBe('ATENDIDO');
    expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.lineas_pasadas).toBeNull();
    expect((await eventosDeLlamado(ctx)).map((e) => e.nombre)).toEqual([]);
    expect((await foto(p)).conteo).toEqual(antes.conteo);

    const nueva = await abrirMesa(ctx, esc, p.mesa, t().mozo);
    const ok = await pasarOk(ctx, t().mozo, p.id, todasLasLineas());
    expect(ok.body.ordenId).toBe(nueva);
  });

  it('al pasar, el llamado queda con ordenId, lineasPasadas, cerradoPor y cerradoEn', async () => {
    const p = await pedidoAtendido();
    ctx.reloj.avanzar(3 * MINUTO);
    const res = await pasarOk(ctx, t().mozo2, p.id, [{ posicion: 1, cantidad: 4 }]);
    expect(res.body.llamado).toMatchObject({
      estado: 'PASADO_A_CUENTA',
      ordenId: p.ordenId,
      lineasPasadas: [{ posicion: 1, cantidad: 4 }],
      cerradoPor: { id: esc.mozo2.id },
      cerradoEn: iso(),
    });
  });
});

// ===================================================================================================
// Criterio 49 · nada llega a cocina
// ===================================================================================================

describe('criterio 49 · pasar a la cuenta no llega a cocina', () => {
  it('no crea envío, ítem, comanda, línea de comanda ni trabajo de impresión, no llama al inventario y no publica cocina.*, salon.cambio ni orden.cambio', async () => {
    const p = await pedidoAtendido();
    const antes = await foto(p);
    await limpiarRegistros(ctx);

    await pasarOk(ctx, t().mozo, p.id, todasLasLineas());

    const despues = await foto(p);
    expect(despues.conteo).toEqual(antes.conteo);
    expect(despues.version).toBe(antes.version);
    expect(despues.estadoOrden).toBe('ABIERTA');
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(await eventosDePedidos(ctx)).toEqual([]);
    expect((await eventosDeLlamado(ctx)).map((e) => e.nombre)).toEqual(['llamado.cambio']);

    // La orden no tiene ítems: nada de lo pasado está en la cuenta hasta que alguien pulse "Enviar".
    const orden = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${p.ordenId}` });
    exigirEstado(orden, 200, 'GET /ordenes/:id');
    expect(orden.body.items).toEqual([]);
    expect(orden.body.total).toBe('0.00');
    // El KDS no tiene nada nuevo.
    const kds = await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/cocina/comandas' });
    exigirEstado(kds, 200, 'GET /cocina/comandas');
    const delaOrden = JSON.stringify(kds.body).includes(p.ordenId);
    expect(delaOrden).toBe(false);
  });

  it('con una orden que ya tenía ítems enviados, no cambia sus ítems, su total ni su versión', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    await enviarOk(ctx, t().mozo, ordenId, [L.gaseosa(2)]);
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelCliente()));
    await atenderOk(ctx, t().mozo, creado.id, {});
    const antes = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    const conteo = await conteoDePedidos(admin, mesa.empresaId);
    const version = await versionDeLaOrden(admin, ordenId);
    await limpiarRegistros(ctx);

    await pasarOk(ctx, t().mozo, creado.id, todasLasLineas());

    const despues = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    expect(despues.body).toEqual(antes.body);
    expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(conteo);
    expect(await versionDeLaOrden(admin, ordenId)).toBe(version);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(await eventosDePedidos(ctx)).toEqual([]);
  });

  it('con la mesa EN_PRECUENTA sigue EN_PRECUENTA: la versión de la orden y la pre-cuenta vigente no cambian', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    await enviarOk(ctx, t().mozo, ordenId, [L.gaseosa(1)]);
    const pre = await pedirPrecuenta(ctx, t().mozo, ordenId);
    exigirEstado(pre, 201, 'pedir la pre-cuenta');
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelCliente()));
    await atenderOk(ctx, t().mozo, creado.id, {});
    const version = await versionDeLaOrden(admin, ordenId);
    const antes = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    await limpiarRegistros(ctx);

    await pasarOk(ctx, t().mozo, creado.id, todasLasLineas());

    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('EN_PRECUENTA');
    expect(await versionDeLaOrden(admin, ordenId)).toBe(version);
    const despues = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    expect(despues.body.estado).toBe('EN_PRECUENTA');
    expect(despues.body.precuentaVigente).toEqual(antes.body.precuentaVigente);
    expect(despues.body.precuentaVigente).not.toBeNull();
    const invalidadas = await admin.query(
      'SELECT count(*)::int AS n FROM precuenta WHERE orden_id = $1 AND invalidada_en IS NOT NULL',
      [ordenId],
    );
    expect(invalidadas.rows[0].n).toBe(0);
    expect(await eventosDePedidos(ctx)).toEqual([]);
  });

  it('un paso rechazado (agotado, posición, estado) tampoco toca nada de cocina', async () => {
    const p = await pedidoAtendido();
    const antes = await foto(p);
    await limpiarRegistros(ctx);
    await pasarLlamado(ctx, t().mozo, p.id, { lineas: [{ posicion: 9, cantidad: 1 }] });
    await agotar(ctx, t().cocina, esc.carta.cervezaPilsen);
    try {
      await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.cervezaPilsen);
    }
    expect((await foto(p)).conteo).toEqual(antes.conteo);
    expect(ctx.inventario.llamadas()).toEqual([]);
  });
});

// ===================================================================================================
// Criterio 50 · de punta a punta
// ===================================================================================================

describe('criterio 50 · de punta a punta', () => {
  it('las líneas de la respuesta enviadas con POST /ordenes/:id/envios crean las comandas por estación con los precios del sistema', async () => {
    const p = await pedidoAtendido();
    const paso = pasoACuentaRespuestaSchema.parse(
      (await pasarOk(ctx, t().mozo, p.id, todasLasLineas())).body,
    );
    const antes = await conteoDePedidos(admin, p.mesa.empresaId);
    expect(antes.envios).toBe(0);

    const res = await enviarComanda(ctx, t().mozo, paso.ordenId, envio(comoEnvio(paso.lineas)));
    exigirEstado(res, 201, 'enviar la comanda (004, criterio 15)');
    const enviado = envioRespuestaSchema.parse(res.body);
    expect(enviado.items).toHaveLength(3);
    expect(enviado.items.map((i) => i.precioUnitario).sort()).toEqual(
      ['28.40', '30.50', '9.00'].sort(),
    );
    expect(enviado.items.find((i) => i.nombre === 'Lomo saltado')).toMatchObject({
      cantidad: 2,
      precioUnitario: '30.50',
      totalVigente: '61.00',
    });
    // Lomo con Huevo y Combo con Hamburguesa van a Cocina, y la Cerveza del combo a la Barra.
    expect(enviado.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    for (const c of enviado.comandas) expect(c.tipo).toBe('COMANDA');

    const despues = await conteoDePedidos(admin, p.mesa.empresaId);
    expect(despues.envios).toBe(1);
    expect(despues.items).toBe(3);
    expect(despues.comandas).toBe(2);
    // El llamado ya estaba pasado y no cambió con el envío.
    expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.estado).toBe('PASADO_A_CUENTA');
  });

  it('el envío vuelve a calcular el precio: si cambia entre el paso y el envío, el ítem lleva el nuevo', async () => {
    const plato = await productoPropio(ctx, esc, '20.00');
    const p = await pedidoAtendido([lineaDe(plato.id, 2)]);
    const paso = pasoACuentaRespuestaSchema.parse(
      (await pasarOk(ctx, t().mozo, p.id, [{ posicion: 0, cantidad: 2 }])).body,
    );
    expect(paso.lineas[0]).toMatchObject({ precioUnitario: '20.00' });
    await cambiarProducto(ctx, esc, plato.id, { precio: '22.00' });
    const res = await enviarComanda(ctx, t().mozo, paso.ordenId, envio(comoEnvio(paso.lineas)));
    exigirEstado(res, 201, 'enviar');
    expect(res.body.items[0]).toMatchObject({ precioUnitario: '22.00', totalVigente: '44.00' });
  });

  it('si entre el paso y el envío se agota algo, el envío lo rechaza y no crea nada', async () => {
    const plato = await productoPropio(ctx, esc, '16.00');
    const p = await pedidoAtendido([lineaDe(plato.id, 1), L.gaseosa(1)]);
    const paso = pasoACuentaRespuestaSchema.parse(
      (await pasarOk(ctx, t().mozo, p.id, todasLasLineas([1, 1]))).body,
    );
    await agotar(ctx, t().cocina, plato.id);
    try {
      const antes = await conteoDePedidos(admin, p.mesa.empresaId);
      const res = await enviarComanda(ctx, t().mozo, paso.ordenId, envio(comoEnvio(paso.lineas)));
      esperarError(res, 422, 'PRODUCTO_NO_VENDIBLE');
      expect(await conteoDePedidos(admin, p.mesa.empresaId)).toEqual(antes);
    } finally {
      await reactivar(ctx, t().cocina, plato.id);
    }
  });

  it('las líneas quitadas por el mozo no llegan al envío ni a la cuenta', async () => {
    const p = await pedidoAtendido();
    const paso = pasoACuentaRespuestaSchema.parse(
      (await pasarOk(ctx, t().mozo, p.id, [{ posicion: 2, cantidad: 2 }])).body,
    );
    const res = await enviarComanda(ctx, t().mozo, paso.ordenId, envio(comoEnvio(paso.lineas)));
    exigirEstado(res, 201, 'enviar');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      nombre: 'Gaseosa 1 L',
      cantidad: 2,
      precioUnitario: '9.00',
    });
    const orden = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${paso.ordenId}` });
    expect(orden.body.total).toBe('18.00');
  });
});

// ===================================================================================================
// Criterio 51 · réplica y simultáneos
// ===================================================================================================

describe('criterio 51 · réplica', () => {
  it('la misma clave devuelve la respuesta guardada, sin cambios ni evento', async () => {
    const p = await pedidoAtendido();
    const k = randomUUID();
    const primera = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }, k);
    exigirEstado(primera, 200, 'pasar');
    ctx.reloj.avanzar(5 * MINUTO);
    const antes = await foto({ ...p });
    await limpiarRegistros(ctx);

    const replica = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }, k);
    exigirEstado(replica, 200, 'réplica con la misma clave');
    expect(replica.body).toEqual(primera.body);
    expect(await foto({ ...p })).toEqual({ ...antes, estadoLlamado: 'PASADO_A_CUENTA' });
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('otra clave sobre un llamado ya pasado con las mismas líneas responde 200 con el paso original (instantánea), también desde otra sesión', async () => {
    const plato = await productoPropio(ctx, esc, '20.00');
    const p = await pedidoAtendido([lineaDe(plato.id, 2), L.gaseosa(1)]);
    const lineas = [
      { posicion: 0, cantidad: 2 },
      { posicion: 1, cantidad: 1 },
    ];
    const primera = await pasarLlamado(ctx, t().mozo, p.id, { lineas });
    exigirEstado(primera, 200, 'pasar');
    // El precio cambia después: la réplica sigue mostrando el del paso original.
    await cambiarProducto(ctx, esc, plato.id, { precio: '30.00' });
    ctx.reloj.avanzar(2 * MINUTO);
    await limpiarRegistros(ctx);

    for (const token of [t().mozo, t().mozo2]) {
      const otra = await pasarLlamado(ctx, token, p.id, { lineas });
      exigirEstado(otra, 200, 'otra clave con las mismas líneas');
      expect(otra.body.lineas).toEqual(primera.body.lineas);
      expect(otra.body.lineas[0].precioUnitario).toBe('20.00');
      expect(otra.body.ordenId).toBe(primera.body.ordenId);
      expect(otra.body.llamado).toMatchObject({
        estado: 'PASADO_A_CUENTA',
        cerradoEn: primera.body.llamado.cerradoEn,
        cerradoPor: primera.body.llamado.cerradoPor,
      });
    }
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    expect((await filaLlamado(admin, p.mesa.empresaId, p.id))!.cerrado_por_usuario_id).toBe(
      mozo().id,
    );
  });

  it.each([
    [
      'otra cantidad',
      [
        { posicion: 0, cantidad: 3 },
        { posicion: 1, cantidad: 2 },
        { posicion: 2, cantidad: 1 },
      ],
    ],
    ['menos líneas', [{ posicion: 0, cantidad: 2 }]],
    ['otra línea', [{ posicion: 2, cantidad: 1 }]],
  ])(
    'con otras líneas (%s) es 409 LLAMADO_CERRADO con el estado y nada cambia',
    async (_n, otras) => {
      const p = await pedidoAtendido();
      const primera = await pasarOk(ctx, t().mozo, p.id, todasLasLineas());
      await limpiarRegistros(ctx);
      const res = await pasarLlamado(ctx, t().mozo2, p.id, { lineas: otras });
      esperarError(res, 409, 'LLAMADO_CERRADO');
      expect(res.body.estado).toBe('PASADO_A_CUENTA');
      const fila = (await filaLlamado(admin, p.mesa.empresaId, p.id))!;
      expect(fila.lineas_pasadas).toEqual(primera.body.llamado.lineasPasadas);
      expect(fila.cerrado_por_usuario_id).toBe(mozo().id);
      expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    },
  );

  it('dos pasos simultáneos con las mismas líneas terminan en un solo paso y un solo aviso', async () => {
    const p = await pedidoAtendido();
    await limpiarRegistros(ctx);
    const [a, b] = await Promise.all([
      pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }),
      pasarLlamado(ctx, t().mozo2, p.id, { lineas: todasLasLineas() }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.lineas).toEqual(b.body.lineas);
    expect(a.body.ordenId).toBe(b.body.ordenId);
    expect(a.body.llamado.cerradoEn).toBe(b.body.llamado.cerradoEn);
    expect(a.body.llamado.cerradoPor).toEqual(b.body.llamado.cerradoPor);
    expect(await eventosDeLlamado(ctx, 'llamado.cambio')).toHaveLength(1);
    expect((await foto(p)).conteo.envios).toBe(0);
  });

  it('dos pasos simultáneos con líneas distintas: uno sale y el otro es 409 LLAMADO_CERRADO', async () => {
    const p = await pedidoAtendido();
    await limpiarRegistros(ctx);
    const [a, b] = await Promise.all([
      pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }),
      pasarLlamado(ctx, t().mozo2, p.id, { lineas: [{ posicion: 0, cantidad: 1 }] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    esperarError(a.status === 409 ? a : b, 409, 'LLAMADO_CERRADO');
    expect(await eventosDeLlamado(ctx, 'llamado.cambio')).toHaveLength(1);
    const fila = (await filaLlamado(admin, p.mesa.empresaId, p.id))!;
    expect(fila.estado).toBe('PASADO_A_CUENTA');
    const ganador = a.status === 200 ? a : b;
    expect(fila.lineas_pasadas).toEqual(ganador.body.llamado.lineasPasadas);
  });

  it('descartar después de pasar no se puede, y pasar después de descartar tampoco', async () => {
    const [x, y] = [await pedidoAtendido(), await pedidoAtendido()];
    await pasarOk(ctx, t().mozo, x.id, todasLasLineas());
    const descartar = await descartarLlamado(ctx, t().mozo, x.id, {});
    esperarError(descartar, 409, 'LLAMADO_CERRADO');
    expect(descartar.body.estado).toBe('PASADO_A_CUENTA');
    await descartarOk(ctx, t().mozo, y.id);
    esperarError(
      await pasarLlamado(ctx, t().mozo, y.id, { lineas: todasLasLineas() }),
      409,
      'LLAMADO_CERRADO',
    );
  });
});

// ===================================================================================================
// Criterio 52 · llamado.cambio al pasar
// ===================================================================================================

describe('criterio 52 · llamado.cambio', () => {
  it('pasar publica llamado.cambio con estado PASADO_A_CUENTA en la sala de la sucursal, y solo eso', async () => {
    const p = await pedidoAtendido();
    await limpiarRegistros(ctx);
    await pasarOk(ctx, t().mozo, p.id, todasLasLineas());
    const todos = await eventosPublicados(ctx);
    expect(todos.map((e) => e.nombre)).toEqual(['llamado.cambio']);
    const evento = eventoLlamadoCambioSchema.parse(todos[0]);
    expect(evento.empresaId).toBe(A().empresaId);
    expect(evento.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    expect(evento.datos).toEqual({ llamadoId: p.id, mesaId: p.mesa.id, estado: 'PASADO_A_CUENTA' });
    expect(JSON.stringify(todos[0]).length).toBeLessThan(4096);
  });

  it('un paso rechazado o repetido no publica nada', async () => {
    const p = await pedidoAtendido();
    const k = randomUUID();
    await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }, k);
    await limpiarRegistros(ctx);
    await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }, k); // réplica
    await pasarLlamado(ctx, t().mozo2, p.id, { lineas: todasLasLineas() }); // instantánea
    await pasarLlamado(ctx, t().mozo2, p.id, { lineas: [{ posicion: 0, cantidad: 1 }] }); // 409
    await pasarLlamado(ctx, t().mozoS2, p.id, { lineas: todasLasLineas() }); // 404
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });
});
