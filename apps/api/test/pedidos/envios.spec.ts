// Historia 004 · salón y cocina, grupo C3 (T14 y T15) · pruebas del desarrollador (no protegidas) de enviar la
// comanda, marchar y el stock del comandero. Completan las protegidas de `salon-critica/` en lo que ellas no
// pueden ejercitar todavía porque dependen de rutas de grupos posteriores (anular, unir, pre-cuenta): aquí el
// estado de la orden se deja por SQL como `restaurante_api` con el contexto y el actor de prueba fijados.
//
// Cubre: lo que guarda cada ítem y cada línea de comanda; la réplica del envío y de la marcha cuando la orden ya
// no está abierta o cambió después (siempre el envío original); un mismo id usado a la vez en dos órdenes; la
// orden que sale de la pre-cuenta; la orden `UNIDA`; el destino de cada estación guardado al crear la comanda;
// la marcha con una anulación parcial y la de un ítem sin partes; y `GET /salon/stock`.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPRESION, type ImpresionPuerto } from '../../src/modulos/pedidos';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  arrancarP2,
  conEventos,
  conteoDeOrden,
  cerrarOrdenPorSql,
  crearEnCarta,
  enviarComanda,
  enviarOk,
  envio,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  lineasDeComanda,
  llamar,
  marchar,
  nombreUnico,
  prepararEscenarioP2,
  verOrden,
  type AppP2,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
} from '../salon-critica/fabrica-p2';
import { anularPorSql, escribir, ponerEstado } from './ayudas-pedidos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let api: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const A = () => esc.e.A;
const t = () => esc.token;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

const abrir = (): Promise<OrdenAbierta> => abrirOrden(ctx, esc.salon, t().mozo);
const enviarComoMozo = (ordenId: string, lineas: LineaCuerpo[]) =>
  enviarOk(ctx, t().mozo, ordenId, lineas);

/** Escribe por SQL como `restaurante_api` (contexto de A y actor de prueba). */
const escribirEnA = <T>(fn: () => Promise<T>) => escribir(api, A().empresaId, fn);

describe('lo que guarda el envío', () => {
  it('cada ítem guarda la línea preparada completa, su total, su posición y quién lo comandó', async () => {
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [L.lomo(['3/4', 'Huevo'], 2), L.gaseosa(3)]);
    const { rows } = await admin.query(
      `SELECT i.posicion, i.cantidad, i.precio_unitario, i.total, i.linea, i.es_adicion, i.estado,
              i.cantidad_anulada, i.creado_por_usuario_id, i.envio_id
         FROM item i WHERE i.orden_id = $1 ORDER BY i.posicion`,
      [o.id],
    );
    expect(rows.map((f) => [f.posicion, f.cantidad, f.precio_unitario, f.total])).toEqual([
      [1, 2, '30.50', '61.00'],
      [2, 3, '9.00', '27.00'],
    ]);
    for (const f of rows) {
      expect(f).toMatchObject({
        es_adicion: false,
        estado: 'ENVIADO',
        cantidad_anulada: 0,
        creado_por_usuario_id: A().mozo.id,
        envio_id: r.id,
      });
    }
    expect(rows[0].linea).toMatchObject({
      productoId: esc.carta.lomo,
      nombre: 'Lomo saltado',
      tipo: 'SIMPLE',
      cantidad: 2,
      precioUnitario: '30.50',
      total: '61.00',
      estacionId: esc.carta.cocinaId,
    });
    expect(
      (rows[0].linea.modificadores as { nombre: string; productoLigado: unknown }[]).map(
        (m) => m.nombre,
      ),
    ).toEqual(['3/4', 'Huevo']);
    const envioFila = await admin.query(
      `SELECT numero, es_adicion, length(huella_entrada) AS largo FROM envio WHERE id = $1`,
      [r.id],
    );
    expect(envioFila.rows[0]).toEqual({ numero: 1, es_adicion: false, largo: 32 });
  });

  it('una parte de componente guarda la cantidad del componente por ítem y la lectura la multiplica por lo vigente', async () => {
    const componente = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'SIMPLE',
      nombre: nombreUnico('Medallón'),
      familiaId: esc.carta.familiaId,
      seVendeSolo: false,
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'PORCIONES',
    });
    const combo = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'COMBO',
      nombre: nombreUnico('Combo doble'),
      familiaId: esc.carta.familiaId,
      precio: '30.00',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: componente.id, cantidad: 2 }],
    });
    const o = await abrir();
    const r = await enviarComoMozo(o.id, [
      { productoId: combo.id, modificadorIds: [], cantidad: 3 },
    ]);
    const { rows } = await admin.query(
      `SELECT cantidad_por_item, cantidad, rol, estado, esperar
         FROM comanda_linea WHERE comanda_id = $1`,
      [r.comandas[0]!.id],
    );
    expect(rows).toEqual([
      {
        cantidad_por_item: 2,
        cantidad: null,
        rol: 'COMPONENTE',
        estado: 'ENVIADO',
        esperar: false,
      },
    ]);
    expect((await lineasDeComanda(admin, r.comandas[0]!.id))[0]!.cantidad).toBe(6);
  });

  it('una adición a una orden con ítems es adición aunque los ítems no vinieran de un envío suyo', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.gaseosa(1)]);
    const segundo = await enviarComoMozo(o.id, [L.gaseosa(1)]);
    expect(segundo).toMatchObject({ numero: 2, esAdicion: true });
  });
});

describe('réplicas cuando la orden ya no está abierta o cambió', () => {
  async function conEnvio() {
    const o = await abrir();
    const cuerpo = envio([
      L.combo(['Cerveza', 'Ensalada'], 3, { tiempo: 2 }),
      L.lomo(['3/4', 'Huevo'], 1),
      L.gaseosa(2),
    ]);
    const res = await enviarComanda(ctx, t().mozo, o.id, cuerpo);
    exigirEstado(res, 201, 'primer envío');
    return { o, cuerpo, res, filas: await conteoDeOrden(admin, o.id) };
  }

  it('con la orden CERRADA, ANULADA o UNIDA devuelve el envío original, sin efectos', async () => {
    for (const dejar of ['cerrada', 'anulada', 'unida'] as const) {
      const p = await conEnvio();
      if (dejar === 'cerrada') await cerrarOrdenPorSql(admin, p.o.id);
      else if (dejar === 'anulada') await anularPorSql(api, A().empresaId, p.o.id);
      else {
        const principal = await abrir();
        await escribirEnA(async () => {
          await api.query(
            `UPDATE orden SET estado = 'UNIDA', unida_a_orden_id = $2, actualizado_en = now()
              WHERE id = $1`,
            [p.o.id, principal.id],
          );
        });
      }
      const { resultado, eventos } = await conEventos(ctx, () =>
        enviarComanda(ctx, t().mozo, p.o.id, p.cuerpo),
      );
      expect(resultado.status, `${dejar}: ${resultado.text}`).toBe(201);
      expect(resultado.body).toEqual(p.res.body);
      expect(eventos).toEqual([]);
      expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
      expect(await conteoDeOrden(admin, p.o.id)).toEqual(p.filas);
    }
  });

  it('la réplica es el envío tal como salió: no muestra lo anulado ni lo marchado después', async () => {
    const p = await conEnvio();
    exigirEstado(await marchar(ctx, t().mozo, p.o.id, { id: randomUUID() }), 201, 'marchar');
    await escribirEnA(async () => {
      await api.query(
        `UPDATE item SET cantidad_anulada = 1, actualizado_en = now() WHERE envio_id = $1 AND posicion = 1`,
        [p.res.body.id],
      );
      await api.query(
        `UPDATE comanda_linea SET estado = 'LISTO', estado_en = now(), actualizado_en = now()
          WHERE comanda_id IN (SELECT id FROM comanda WHERE envio_id = $1)`,
        [p.res.body.id],
      );
    });
    // La orden sí refleja lo que pasó después…
    const orden = (await verOrden(ctx, t().mozo, p.o.id)).body as {
      items: { cantidadAnulada: number; marchadoEn: string | null; cocina: { listo: number } }[];
    };
    expect(orden.items[0]).toMatchObject({ cantidadAnulada: 1 });
    expect(orden.items[0]!.marchadoEn).not.toBeNull();
    expect(orden.items[0]!.cocina.listo).toBeGreaterThan(0);
    // …y la réplica del envío sigue siendo el envío original.
    const replica = await enviarComanda(ctx, t().mozo, p.o.id, p.cuerpo);
    expect(replica.status).toBe(201);
    expect(replica.body).toEqual(p.res.body);
  });

  it('la marcha repetida con otra clave devuelve la misma marcha aunque la orden se haya cerrado', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const cuerpo = { id: randomUUID() };
    const primera = await marchar(ctx, t().mozo, o.id, cuerpo);
    exigirEstado(primera, 201, 'marchar');
    await cerrarOrdenPorSql(admin, o.id);
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, cuerpo),
    );
    expect(resultado.status, resultado.text).toBe(201);
    expect(resultado.body).toEqual(primera.body);
    expect(eventos).toEqual([]);
  });

  it('el mismo id de envío usado a la vez en dos órdenes deja un solo envío y rechaza al otro con 422', async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const [o1, o2] = [await abrir(), await abrir()];
      const cuerpo = envio([L.lomo(['3/4'], 1)]);
      const [a, b] = await Promise.all([
        enviarComanda(ctx, t().mozo, o1.id, cuerpo),
        enviarComanda(ctx, t().mozo2, o2.id, cuerpo),
      ]);
      expect([a.status, b.status].sort(), `ronda ${ronda}`).toEqual([201, 422]);
      esperarError(a.status === 201 ? b : a, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM envio WHERE id = $1`, [
        cuerpo.id,
      ]);
      expect(rows[0].n).toBe(1);
      const total =
        (await conteoDeOrden(admin, o1.id)).items + (await conteoDeOrden(admin, o2.id)).items;
      expect(total).toBe(1);
    }
  });
});

describe('estado de la orden', () => {
  it('una adición saca la orden de EN_PRECUENTA, sube la versión y publica salon.cambio con la mesa', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'])]);
    await ponerEstado(api, A().empresaId, o.id, 'EN_PRECUENTA');
    const antes = await admin.query(`SELECT version FROM orden WHERE id = $1`, [o.id]);
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)])),
    );
    exigirEstado(resultado, 201, 'adición');
    const despues = await admin.query(`SELECT estado, version FROM orden WHERE id = $1`, [o.id]);
    expect(despues.rows[0]).toEqual({ estado: 'ABIERTA', version: antes.rows[0].version + 1 });
    expect(eventos.filter((e) => e.nombre === 'salon.cambio').map((e) => e.datos)).toEqual([
      { mesaIds: [o.mesaId], ordenId: o.id },
    ]);
    // Un envío con la orden ABIERTA no publica salon.cambio.
    const otra = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)])),
    );
    expect(otra.eventos.filter((e) => e.nombre === 'salon.cambio')).toEqual([]);
  });

  it('un envío a una orden UNIDA responde 409 con el ordenId de la principal y no guarda nada', async () => {
    const [absorbida, principal] = [await abrir(), await abrir()];
    await escribirEnA(async () => {
      await api.query(
        `UPDATE orden SET estado = 'UNIDA', unida_a_orden_id = $2, actualizado_en = now() WHERE id = $1`,
        [absorbida.id, principal.id],
      );
    });
    ctx.inventario.limpiar();
    const res = await enviarComanda(ctx, t().mozo, absorbida.id, envio([L.gaseosa(1)]));
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.id);
    expect(await conteoDeOrden(admin, absorbida.id)).toMatchObject({ envios: 0, items: 0 });
    expect(ctx.inventario.alEnviarLlamadas()).toEqual([]);
  });
});

describe('el destino de cada estación se guarda al crear la comanda', () => {
  it('una estación con impresora sale como IMPRESORA y las demás como KDS; no cambia si el destino cambia después', async () => {
    const impresion = ctx.app.get<ImpresionPuerto>(IMPRESION, { strict: false });
    const original = impresion.destinos.bind(impresion);
    // La impresora de este caso no existe en la base: lo que se prueba es el destino guardado en la comanda, así
    // que no se encola ningún trabajo (el trabajo real lo prueban `impresion-critica/` y `impresion/cola-puente`).
    const encolarOriginal = impresion.encolar.bind(impresion);
    impresion.encolar = async () => [];
    const impresoraId = randomUUID();
    let cuerpo: ReturnType<typeof envio> | undefined;
    let ordenId = '';
    impresion.destinos = async (_sucursalId, estacionIds) =>
      new Map(
        estacionIds.map((id) => [
          id,
          id === esc.carta.cocinaId
            ? ({ destino: 'IMPRESORA', impresoraId } as const)
            : ({ destino: 'KDS' } as const),
        ]),
      );
    try {
      const o = await abrir();
      cuerpo = envio([L.combo(['Cerveza', 'Ensalada'], 1), L.lomo(['3/4'])]);
      const res = await enviarComanda(ctx, t().mozo, o.id, cuerpo);
      exigirEstado(res, 201, 'enviar');
      const r = res.body as EnvioRespuestaDePrueba;
      ordenId = o.id;
      expect(r.comandas.map((c) => [c.estacionNombre, c.destino])).toEqual([
        ['Barra', 'KDS'],
        ['Cocina', 'IMPRESORA'],
      ]);
      const { rows } = await admin.query(
        `SELECT estacion_id, destino FROM comanda WHERE orden_id = $1 ORDER BY destino`,
        [o.id],
      );
      expect(rows).toEqual([
        { estacion_id: esc.carta.cocinaId, destino: 'IMPRESORA' },
        { estacion_id: esc.carta.barraId, destino: 'KDS' },
      ]);
    } finally {
      impresion.destinos = original;
      impresion.encolar = encolarOriginal;
    }
    // Con el destino de vuelta en KDS, la réplica sigue mostrando el destino con el que salió.
    const replica = await enviarComanda(ctx, t().mozo, ordenId, cuerpo);
    expect(replica.status).toBe(201);
    expect(
      (replica.body as EnvioRespuestaDePrueba).comandas.map((c) => [c.estacionNombre, c.destino]),
    ).toEqual([
      ['Barra', 'KDS'],
      ['Cocina', 'IMPRESORA'],
    ]);
  });
});

describe('marchar', () => {
  it('con una anulación parcial, la línea de la marcha lleva la cantidad vigente fija de cada parte', async () => {
    const componente = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'SIMPLE',
      nombre: nombreUnico('Medallón'),
      familiaId: esc.carta.familiaId,
      seVendeSolo: false,
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'PORCIONES',
    });
    const combo = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'COMBO',
      nombre: nombreUnico('Combo doble'),
      familiaId: esc.carta.familiaId,
      precio: '30.00',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: componente.id, cantidad: 2 }],
    });
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      { productoId: combo.id, modificadorIds: [], cantidad: 3, tiempo: 2 },
    ]);
    // Quedan 2 de 3 vigentes (lo que hará la anulación parcial).
    await escribirEnA(async () => {
      await api.query(
        `UPDATE item SET cantidad_anulada = 1, actualizado_en = now() WHERE id = $1`,
        [e.items[0]!.id],
      );
    });
    const res = await marchar(ctx, t().mozo, o.id, { id: randomUUID() });
    exigirEstado(res, 201, 'marchar');
    const lineas = await admin.query(
      `SELECT cl.cantidad_por_item, cl.cantidad, cl.esperar
         FROM comanda_linea cl WHERE cl.comanda_id = $1`,
      [res.body.comandas[0].id],
    );
    expect(lineas.rows).toEqual([{ cantidad_por_item: 2, cantidad: 4, esperar: false }]);
  });

  it('un ítem de segundo tiempo sin partes (sin estación) se marcha sin comandas', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [L.gaseosa(2, { tiempo: 2 })]);
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
    );
    exigirEstado(resultado, 201, 'marchar');
    expect(resultado.body.comandas).toEqual([]);
    expect(eventos.map((ev) => ev.nombre)).toEqual(['orden.cambio']);
    const orden = (await verOrden(ctx, t().mozo, o.id)).body as {
      items: { id: string; marchadoEn: string | null }[];
    };
    expect(orden.items.find((i) => i.id === e.items[0]!.id)!.marchadoEn).not.toBeNull();
    esperarError(await marchar(ctx, t().mozo, o.id, { id: randomUUID() }), 409, 'NADA_QUE_MARCHAR');
  });
});

describe('GET /salon/stock', () => {
  it('sin productoIds responde { productos: [] } y no llama a nada más que al puerto', async () => {
    ctx.inventario.limpiar();
    const res = await llamar(ctx, t().mozo, { metodo: 'get', ruta: '/salon/stock' });
    exigirEstado(res, 200, 'GET /salon/stock');
    expect(res.body).toEqual({ productos: [] });
  });

  it('con un puerto sin datos responde { productos: [] } para los productos pedidos', async () => {
    const res = await llamar(ctx, t().mozo, {
      metodo: 'get',
      ruta: `/salon/stock?productoIds=${esc.carta.gaseosa}&productoIds=${esc.carta.lomo}`,
    });
    exigirEstado(res, 200, 'GET /salon/stock');
    expect(res.body).toEqual({ productos: [] });
  });

  it('solo devuelve los productos pedidos aunque el puerto sepa de otros, y acepta ids en mayúsculas', async () => {
    ctx.inventario.fijarDisponibles(
      new Map([
        [esc.carta.gaseosa, 7],
        [esc.carta.lomo, 3],
      ]),
    );
    try {
      const res = await llamar(ctx, t().mozo, {
        metodo: 'get',
        ruta: `/salon/stock?productoIds=${esc.carta.gaseosa.toUpperCase()}`,
      });
      exigirEstado(res, 200, 'GET /salon/stock');
      expect(res.body).toEqual({ productos: [{ productoId: esc.carta.gaseosa, disponible: 7 }] });
    } finally {
      ctx.inventario.fijarDisponibles(new Map());
    }
  });

  it('un id que no es UUID responde 400 DATOS_INVALIDOS', async () => {
    const res = await llamar(ctx, t().mozo, {
      metodo: 'get',
      ruta: '/salon/stock?productoIds=no-es-uuid',
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
  });

  it('Cocina/Barra no consulta el stock del comandero (403)', async () => {
    const res = await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/salon/stock' });
    esperarError(res, 403, 'PROHIBIDO');
  });
});
