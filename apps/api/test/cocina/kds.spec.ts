// Historia 004 · salón y cocina, grupo C4 (T18) · pruebas del desarrollador (no protegidas) de la pantalla de
// cocina (KDS): el orden de llegada, pendientes y recientes, las transiciones de una línea, "Todo listo" y
// "Visto", el aviso de "Listo", el filtro por estación, el destino de la comanda, el `ETag` y el conteo de
// consultas. Completan las protegidas de `salon-critica/` (permisos, atribución y aislamiento de las cuatro
// rutas) en lo que ellas no ejercitan. Lo que todavía no tiene ruta (una anulación, unir mesas) se deja por SQL
// como `restaurante_api` con el contexto y el actor de prueba fijados.
import { randomUUID } from 'node:crypto';
import { cocinaRespuestaSchema, type ComandaKds, type LineaKds } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abrirOrden,
  arrancarP2,
  conEventos,
  crearEnCarta,
  enviarOk,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  llamar,
  marchar,
  nombreUnico,
  prepararEscenarioP2,
  sesionContrasena,
  simpleNuevo,
  type AppP2,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import { contarConsultas, escribir, sembrarEnvio } from '../pedidos/ayudas-pedidos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let api: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;
let cocinaS2: string;

const A = () => esc.e.A;
const t = () => esc.token;
const MINUTO = 60_000;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
  // El Administrador con S2 activa: el KDS de una sucursal donde no hay otras pruebas.
  cocinaS2 = await sesionContrasena(ctx, A().base.admin, A().S2);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

const escribirEnA = <T>(fn: () => Promise<T>) => escribir(api, A().empresaId, fn);

/** Hace que las comandas de la orden hayan llegado `minutos` antes (sin mover el reloj: la sesión vence). */
const envejecer = (ordenId: string, minutos: number) =>
  escribirEnA(async () => {
    await api.query(
      `UPDATE comanda SET creado_en = creado_en - make_interval(mins => $2), actualizado_en = now()
        WHERE orden_id = $1`,
      [ordenId, minutos],
    );
  });

const abrir = (opciones: { mozoId?: string; token?: string } = {}): Promise<OrdenAbierta> =>
  abrirOrden(ctx, esc.salon, opciones.token ?? t().mozo, {
    ...(opciones.mozoId === undefined ? {} : { mozoId: opciones.mozoId }),
  });

/** Abre una mesa y envía las líneas con el Mozo (o con `token`). */
async function ordenEnviada(lineas: LineaCuerpo[], token = t().mozo) {
  const orden = await abrir({ token });
  const envio = await enviarOk(ctx, token, orden.id, lineas);
  return { orden, envio };
}

const leerKds = async (token = t().cocina, consulta = '') => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: `/cocina/comandas${consulta}` });
  exigirEstado(res, 200, 'GET /cocina/comandas');
  return cocinaRespuestaSchema.parse(res.body);
};

/** Las comandas de la orden que se ven en el KDS, pendientes y recientes por separado. */
async function delKds(ordenId: string, consulta = '', token = t().cocina) {
  const r = await leerKds(token, consulta);
  const es = (c: ComandaKds) => c.orden.id === ordenId;
  return { pendientes: r.pendientes.filter(es), recientes: r.recientes.filter(es), r };
}

const lineasDeLasComandas = (cs: readonly ComandaKds[]): LineaKds[] => cs.flatMap((c) => c.lineas);

const ponerEstadoLinea = (token: string, lineaId: string, estado: string) =>
  llamar(ctx, token, {
    metodo: 'put',
    ruta: `/cocina/lineas/${lineaId}/estado`,
    cuerpo: { estado },
  });

const todoListo = (token: string, comandaId: string) =>
  llamar(ctx, token, { metodo: 'put', ruta: `/cocina/comandas/${comandaId}/listo` });

const visto = (token: string, comandaId: string) =>
  llamar(ctx, token, { metodo: 'put', ruta: `/cocina/comandas/${comandaId}/visto` });

const nombresDeEventos = (eventos: readonly { nombre: string }[]) => eventos.map((e) => e.nombre);

describe('criterios 56 y 57 · lo que muestra cada comanda y el orden de llegada', () => {
  it('trae las comandas en orden de llegada y, a igual instante, por id, con todo su detalle', async () => {
    const primera = await ordenEnviada([L.lomo(['3/4', 'Huevo'], 2, { observacion: 'Sin ají' })]);
    ctx.reloj.avanzar(MINUTO);
    const segunda = await ordenEnviada([
      L.combo(['Cerveza', 'Ensalada'], 1),
      L.lomo(['Jugoso'], 1, { paraLlevar: true }),
    ]);

    const r = await leerKds();
    const ids = new Set([...primera.envio.comandas, ...segunda.envio.comandas].map((c) => c.id));
    const mias = r.pendientes.filter((c) => ids.has(c.id));
    expect(mias).toHaveLength(ids.size);
    // Orden de llegada global de lo pendiente: (creadaEn, id) no decrece.
    for (let i = 1; i < r.pendientes.length; i++) {
      const a = r.pendientes[i - 1]!;
      const b = r.pendientes[i]!;
      expect(
        [a.creadaEn, a.id] <= [b.creadaEn, b.id],
        `${a.creadaEn} ${a.id} antes de ${b.creadaEn} ${b.id}`,
      ).toBe(true);
    }
    expect(mias[0]!.orden.id).toBe(primera.orden.id);
    expect(mias.at(-1)!.orden.id).toBe(segunda.orden.id);

    const cocina = mias.find((c) => c.orden.id === primera.orden.id)!;
    expect(cocina).toMatchObject({
      tipo: 'COMANDA',
      vistaEn: null,
      motivo: null,
      estacion: { id: esc.carta.cocinaId },
      orden: {
        id: primera.orden.id,
        mozo: { id: A().mozo.id },
        comensales: 2,
      },
    });
    expect(cocina.orden.mozo.nombre).not.toBe('');
    expect(cocina.orden.mesas).toHaveLength(1);
    expect(cocina.orden.mesas[0]).toMatchObject({ id: primera.orden.mesaId });
    expect(cocina.orden.mesas[0]!.nombre).not.toBe('');
    expect(cocina.lineas).toHaveLength(1);
    expect(cocina.lineas[0]).toMatchObject({
      rol: 'PRODUCTO',
      nombre: 'Lomo saltado',
      cantidad: 2,
      modificadores: ['3/4', 'Huevo'],
      observacion: 'Sin ají',
      tiempo: 1,
      esperar: false,
      paraLlevar: false,
      estado: 'ENVIADO',
    });
    expect(Date.parse(cocina.creadaEn)).toBe(Date.parse(INICIO_POR_DEFECTO));
    expect(Date.parse(r.ahora)).toBe(Date.parse(INICIO_POR_DEFECTO) + MINUTO);

    // La segunda orden: una comanda por estación, la de Cocina con el lomo para llevar.
    const deSegunda = mias.filter((c) => c.orden.id === segunda.orden.id);
    expect(deSegunda.map((c) => c.estacion.id).sort()).toEqual(
      [esc.carta.barraId, esc.carta.cocinaId].sort(),
    );
    const lomo = lineasDeLasComandas(deSegunda).find((l) => l.nombre === 'Lomo saltado')!;
    expect(lomo.paraLlevar).toBe(true);
  });

  it('una parte de combo muestra el combo del que sale y las líneas de un ítem salen juntas', async () => {
    const { orden } = await ordenEnviada([L.combo(['Cerveza', 'Ensalada'], 2)]);
    const { pendientes } = await delKds(orden.id);
    const lineas = lineasDeLasComandas(pendientes);
    expect(lineas.length).toBeGreaterThan(1);
    const comp = lineas.filter((l) => l.rol === 'COMPONENTE');
    expect(comp.length).toBeGreaterThan(0);
    for (const l of comp) expect(l.contexto).toBeTruthy();
    expect(new Set(lineas.map((l) => l.itemId)).size).toBe(1);
  });

  it('la cantidad es la vigente: una anulación parcial la baja y una total deja la línea ANULADO fuera de pendientes', async () => {
    const { orden, envio } = await ordenEnviada([L.lomo(['3/4'], 3)]);
    const itemId = envio.items[0]!.id;
    await escribirEnA(async () => {
      await api.query(
        `UPDATE item SET cantidad_anulada = 1, actualizado_en = now() WHERE id = $1`,
        [itemId],
      );
    });
    let { pendientes } = await delKds(orden.id);
    expect(lineasDeLasComandas(pendientes).map((l) => l.cantidad)).toEqual([2]);

    await escribirEnA(async () => {
      await api.query(
        `UPDATE item SET cantidad_anulada = 3, estado = 'ANULADO', actualizado_en = now() WHERE id = $1`,
        [itemId],
      );
      await api.query(
        `UPDATE comanda_linea SET estado = 'ANULADO', estado_en = now(), actualizado_en = now()
          WHERE item_id = $1`,
        [itemId],
      );
    });
    const despues = await delKds(orden.id);
    pendientes = despues.pendientes;
    expect(pendientes).toEqual([]);
    expect(lineasDeLasComandas(despues.recientes)).toMatchObject([
      { estado: 'ANULADO', cantidad: 0 },
    ]);
  });

  it('una orden unida a otra muestra las mesas y el mozo de la orden en que quedó', async () => {
    const o1 = await abrir();
    const o2 = await abrir({ token: t().mozo2 });
    await enviarOk(ctx, t().mozo, o1.id, [L.lomo(['3/4'], 1)]);
    await escribirEnA(async () => {
      await api.query(
        `UPDATE orden SET estado = 'UNIDA', unida_a_orden_id = $2, actualizado_en = now() WHERE id = $1`,
        [o1.id, o2.id],
      );
      await api.query(
        `UPDATE orden_mesa SET hasta = greatest(now(), desde), actualizado_en = now()
          WHERE orden_id = $1 AND hasta IS NULL`,
        [o1.id],
      );
    });
    const r = await leerKds();
    const comanda = r.pendientes.find(
      (c) => c.lineas.some((l) => l.nombre === 'Lomo saltado') && c.orden.id === o2.id,
    );
    expect(comanda).toBeDefined();
    expect(comanda!.orden.mesas.map((m) => m.id)).toEqual([o2.mesaId]);
    expect(comanda!.orden.mozo.id).toBe(esc.mozo2.id);
  });
});

describe('criterio 56 · pendientes y recientes', () => {
  it('una comanda con alguna línea sin terminar sigue pendiente; al terminarla pasa a recientes, que dura 60 minutos', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1), L.lomo(['Jugoso'], 1)]);
    let { pendientes, recientes } = await delKds(orden.id);
    expect(pendientes).toHaveLength(1);
    expect(recientes).toHaveLength(0);
    const [a, b] = pendientes[0]!.lineas;

    exigirEstado(await ponerEstadoLinea(t().cocina, a!.id, 'LISTO'), 200, 'primera línea lista');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes).toHaveLength(1);
    expect(recientes).toHaveLength(0);

    exigirEstado(await ponerEstadoLinea(t().cocina, b!.id, 'EN_PREPARACION'), 200, 'preparando');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes).toHaveLength(1);

    exigirEstado(await ponerEstadoLinea(t().cocina, b!.id, 'LISTO'), 200, 'segunda línea lista');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes).toHaveLength(0);
    expect(recientes).toHaveLength(1);
    // Corregir un "Listo" puesto por error la devuelve a pendientes.
    exigirEstado(await ponerEstadoLinea(t().cocina, b!.id, 'ENVIADO'), 200, 'corregir');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes).toHaveLength(1);
    expect(recientes).toHaveLength(0);
    exigirEstado(await ponerEstadoLinea(t().cocina, b!.id, 'LISTO'), 200, 'otra vez lista');

    await envejecer(orden.id, 59);
    expect((await delKds(orden.id)).recientes).toHaveLength(1);
    await envejecer(orden.id, 2);
    const fuera = await delKds(orden.id);
    expect(fuera.recientes).toHaveLength(0);
    expect(fuera.pendientes).toHaveLength(0);
  });

  it('una comanda pendiente no vence con el tiempo', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    await envejecer(orden.id, 5 * 60);
    expect((await delKds(orden.id)).pendientes).toHaveLength(1);
  });

  it('las recientes son las 30 últimas, en orden de llegada, y no cuentan las pendientes', async () => {
    const orden = await abrirOrden(ctx, esc.salonS2, t().mozoS2);
    const { itemIds } = await sembrarEnvio(
      api,
      A().empresaId,
      { sucursalId: A().S2, ordenId: orden.id, estacionId: esc.carta.cocinaId },
      [{ productoId: esc.carta.lomo, precio: '10.00', cantidad: 1 }],
    );
    // 35 comandas terminadas, una por minuto hacia atrás desde ahora: 5 de ellas quedan fuera del tope.
    const ahora = new Date(INICIO_POR_DEFECTO).getTime();
    await escribirEnA(async () => {
      for (let i = 0; i < 35; i++) {
        const id = randomUUID();
        await api.query(
          `INSERT INTO comanda (id, empresa_id, sucursal_id, orden_id, estacion_id, tipo, destino, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, 'COMANDA', 'KDS', $6, $6)`,
          [id, A().empresaId, A().S2, orden.id, esc.carta.cocinaId, new Date(ahora - i * 1000)],
        );
        await api.query(
          `INSERT INTO comanda_linea (empresa_id, comanda_id, item_id, rol, producto_id, nombre, cantidad_por_item,
                                      modificadores, tiempo, para_llevar, esperar, estado, estado_en, creado_en, actualizado_en)
           VALUES ($1, $2, $3, 'PRODUCTO', $4, 'Lomo', 1, '[]'::jsonb, 1, false, false, 'LISTO', now(), now(), now())`,
          [A().empresaId, id, itemIds[0], esc.carta.lomo],
        );
      }
    });
    const r = await leerKds(cocinaS2);
    // La comanda pendiente de `sembrarEnvio` está en `pendientes`; las 35 terminadas se recortan a 30.
    expect(r.recientes.length).toBe(30);
    const instantes = r.recientes.map((c) => Date.parse(c.creadaEn));
    expect([...instantes].sort((x, y) => x - y)).toEqual(instantes);
    expect(Math.max(...instantes)).toBe(ahora);
    expect(Math.min(...instantes)).toBe(ahora - 29 * 1000);
  });

  it('MARCHAR y ANULACION son pendientes hasta que alguien las marca vistas; luego pasan a recientes', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(await marchar(ctx, t().mozo, orden.id, { id: randomUUID() }), 201, 'marchar');
    // Una anulación sembrada por SQL (todavía no hay ruta que la cree).
    const o2 = await abrir();
    await sembrarEnvio(
      api,
      A().empresaId,
      { sucursalId: A().S1, ordenId: o2.id, estacionId: esc.carta.cocinaId },
      [{ productoId: esc.carta.lomo, precio: '10.00', cantidad: 2 }],
    );

    // `sembrarEnvio` usa la hora de la base; la prueba corre con el reloj manual.
    await escribirEnA(async () => {
      await api.query(`UPDATE comanda SET creado_en = $2 WHERE orden_id = $1`, [
        o2.id,
        new Date(INICIO_POR_DEFECTO),
      ]);
    });

    const marcha = (await delKds(orden.id)).pendientes.find((c) => c.tipo === 'MARCHAR')!;
    const anulacion = (await delKds(o2.id)).pendientes.find((c) => c.tipo === 'ANULACION')!;
    expect(marcha).toBeDefined();
    expect(anulacion).toBeDefined();
    expect(anulacion.motivo).toBeNull();
    expect(marcha.lineas[0]).toMatchObject({ cantidad: 1, esperar: false });

    const antes = Date.parse(INICIO_POR_DEFECTO);
    for (const c of [marcha, anulacion]) {
      const res = await visto(t().cocina, c.id);
      exigirEstado(res, 200, 'visto');
      expect(res.body).toMatchObject({ id: c.id });
      expect(Date.parse(res.body.vistaEn as string)).toBe(antes);
    }
    expect((await delKds(orden.id)).pendientes.filter((c) => c.tipo === 'MARCHAR')).toEqual([]);
    expect((await delKds(orden.id)).recientes.map((c) => c.tipo)).toContain('MARCHAR');
    expect((await delKds(o2.id)).recientes.map((c) => c.tipo)).toContain('ANULACION');
  });
});

describe('criterio 58 · estados de una línea', () => {
  it('va de cualquiera de los tres estados a otro, publica cocina.linea y avisa solo al pasar a LISTO', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 2)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    const visitas: [string, string[]][] = [];
    for (const estado of [
      'EN_PREPARACION',
      'LISTO',
      'EN_PREPARACION',
      'ENVIADO',
      'LISTO',
      'ENVIADO',
    ]) {
      const { resultado, eventos } = await conEventos(ctx, () =>
        ponerEstadoLinea(t().cocina, linea.id, estado),
      );
      exigirEstado(resultado, 200, `a ${estado}`);
      expect(resultado.body).toMatchObject({ id: linea.id, estado, cantidad: 2 });
      visitas.push([estado, nombresDeEventos(eventos)]);
    }
    expect(visitas).toEqual([
      ['EN_PREPARACION', ['cocina.linea']],
      ['LISTO', ['cocina.linea', 'cocina.listo']],
      ['EN_PREPARACION', ['cocina.linea']],
      ['ENVIADO', ['cocina.linea']],
      ['LISTO', ['cocina.linea', 'cocina.listo']],
      ['ENVIADO', ['cocina.linea']],
    ]);
  });

  it('repetir el estado responde 200 sin evento ni cambio de fecha', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    exigirEstado(await ponerEstadoLinea(t().cocina, linea.id, 'LISTO'), 200, 'listo');
    const fecha = async () =>
      (await admin.query(`SELECT estado_en FROM comanda_linea WHERE id = $1`, [linea.id])).rows[0]
        .estado_en as Date;
    const antes = await fecha();
    ctx.reloj.avanzar(MINUTO);
    for (const estado of ['LISTO']) {
      const { resultado, eventos } = await conEventos(ctx, () =>
        ponerEstadoLinea(t().cocina, linea.id, estado),
      );
      exigirEstado(resultado, 200, 'repetir');
      expect(eventos).toEqual([]);
    }
    expect(await fecha()).toEqual(antes);
  });

  it('cocina.listo lleva a la mesa, el nombre, la cantidad y, sin repetir, al mozo responsable y a quien comandó', async () => {
    // Responsable: el Mozo. Comanda: el Mozo 2 (otro mozo toma el pedido en la mesa de otro).
    const orden = await abrir({ mozoId: A().mozo.id });
    await enviarOk(ctx, t().mozo2, orden.id, [L.lomo(['3/4'], 2)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    const { resultado, eventos } = await conEventos(ctx, () =>
      ponerEstadoLinea(t().cocina, linea.id, 'LISTO'),
    );
    exigirEstado(resultado, 200, 'listo');
    expect(eventos.map((e) => e.nombre)).toEqual(['cocina.linea', 'cocina.listo']);
    const [evLinea, evListo] = eventos;
    expect(evLinea).toMatchObject({
      empresaId: A().empresaId,
      sala: { tipo: 'sucursal', sucursalId: A().S1 },
      datos: { lineaId: linea.id, estado: 'LISTO' },
    });
    expect(evListo).toMatchObject({
      empresaId: A().empresaId,
      sala: { tipo: 'sucursal', sucursalId: A().S1 },
      datos: {
        ordenId: orden.id,
        itemId: linea.itemId,
        lineaId: linea.id,
        nombre: 'Lomo saltado',
        cantidad: 2,
      },
    });
    const datos = evListo!.datos as {
      destinatarios: string[];
      mesas: { id: string; nombre: string }[];
    };
    expect(datos.destinatarios).toEqual([A().mozo.id, esc.mozo2.id]);
    expect(datos.mesas).toHaveLength(1);
    expect(datos.mesas[0]!.id).toBe(orden.mesaId);

    // Si el responsable es quien comandó, aparece una sola vez.
    const propia = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const l2 = lineasDeLasComandas((await delKds(propia.orden.id)).pendientes)[0]!;
    const { eventos: e2 } = await conEventos(ctx, () =>
      ponerEstadoLinea(t().cocina, l2.id, 'LISTO'),
    );
    const listo = e2.find((e) => e.nombre === 'cocina.listo')!;
    expect((listo.datos as { destinatarios: string[] }).destinatarios).toEqual([A().mozo.id]);
  });

  it('una línea ANULADO responde 409 TRANSICION_INVALIDA y no cambia nada ni publica', async () => {
    const { orden, envio } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    await escribirEnA(async () => {
      await api.query(
        `UPDATE item SET cantidad_anulada = 1, estado = 'ANULADO', actualizado_en = now() WHERE id = $1`,
        [envio.items[0]!.id],
      );
      await api.query(
        `UPDATE comanda_linea SET estado = 'ANULADO', estado_en = now(), actualizado_en = now() WHERE id = $1`,
        [linea.id],
      );
    });
    for (const estado of ['ENVIADO', 'EN_PREPARACION', 'LISTO']) {
      const { resultado, eventos } = await conEventos(ctx, () =>
        ponerEstadoLinea(t().cocina, linea.id, estado),
      );
      esperarError(resultado, 409, 'TRANSICION_INVALIDA');
      expect(eventos).toEqual([]);
    }
    const fila = await admin.query(`SELECT estado FROM comanda_linea WHERE id = $1`, [linea.id]);
    expect(fila.rows[0].estado).toBe('ANULADO');
  });

  it('el cuerpo se valida: ANULADO, un estado desconocido, campos de más o un id que no es UUID responden 400', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    for (const cuerpo of [
      { estado: 'ANULADO' },
      { estado: 'COCINANDO' },
      { estado: 'LISTO', extra: 1 },
      {},
    ]) {
      const res = await llamar(ctx, t().cocina, {
        metodo: 'put',
        ruta: `/cocina/lineas/${linea.id}/estado`,
        cuerpo,
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    esperarError(await ponerEstadoLinea(t().cocina, 'no-es-uuid', 'LISTO'), 400, 'DATOS_INVALIDOS');
    esperarError(await ponerEstadoLinea(t().cocina, randomUUID(), 'LISTO'), 404, 'NO_ENCONTRADO');
  });

  it('las líneas de una comanda de marcha no se mueven con estados: 409 TRANSICION_INVALIDA', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(await marchar(ctx, t().mozo, orden.id, { id: randomUUID() }), 201, 'marchar');
    const marcha = (await delKds(orden.id)).pendientes.find((c) => c.tipo === 'MARCHAR')!;
    const { resultado, eventos } = await conEventos(ctx, () =>
      ponerEstadoLinea(t().cocina, marcha.lineas[0]!.id, 'LISTO'),
    );
    esperarError(resultado, 409, 'TRANSICION_INVALIDA');
    expect(eventos).toEqual([]);
  });

  it('el Supervisor y el Administrador también cambian estados; un cocinero de otra sucursal no ve la línea (404)', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const linea = lineasDeLasComandas((await delKds(orden.id)).pendientes)[0]!;
    exigirEstado(
      await ponerEstadoLinea(t().supervisor, linea.id, 'EN_PREPARACION'),
      200,
      'Supervisor',
    );
    exigirEstado(await ponerEstadoLinea(t().adminS1, linea.id, 'ENVIADO'), 200, 'Administrador');
    esperarError(await ponerEstadoLinea(cocinaS2, linea.id, 'LISTO'), 404, 'NO_ENCONTRADO');
    esperarError(await ponerEstadoLinea(t().mozo, linea.id, 'LISTO'), 403, 'PROHIBIDO');
  });
});

describe('criterio 59 · Todo listo y Visto', () => {
  it('Todo listo pone en LISTO las líneas no anuladas, avisa por cada una y es idempotente', async () => {
    const { orden, envio } = await ordenEnviada([L.lomo(['3/4'], 1), L.lomo(['Jugoso'], 2)]);
    const comanda = (await delKds(orden.id)).pendientes[0]!;
    const [primera, segunda] = comanda.lineas;
    exigirEstado(await ponerEstadoLinea(t().cocina, primera!.id, 'LISTO'), 200, 'una ya lista');
    // La segunda línea del ítem 2 se anula por SQL: no debe pasar a LISTO.
    const anulado = envio.items[1]!.id;
    await escribirEnA(async () => {
      await api.query(
        `UPDATE comanda_linea SET estado = 'ANULADO', estado_en = now(), actualizado_en = now() WHERE item_id = $1`,
        [anulado],
      );
    });
    const tercera = await ordenEnviada([L.lomo(['3/4'], 1), L.lomo(['Jugoso'], 1)]);
    const c3 = (await delKds(tercera.orden.id)).pendientes[0]!;

    // La comanda 1: una lista, otra anulada. No hay nada que cambiar: sin eventos.
    const { resultado: r1, eventos: e1 } = await conEventos(ctx, () =>
      todoListo(t().cocina, comanda.id),
    );
    exigirEstado(r1, 200, 'todo listo (nada que cambiar)');
    expect(e1).toEqual([]);
    expect(r1.body.lineas.map((l: LineaKds) => l.estado)).toEqual(['LISTO', 'ANULADO']);
    expect(segunda).toBeDefined();

    // La comanda 3: dos líneas por cambiar.
    const { resultado, eventos } = await conEventos(ctx, () => todoListo(t().cocina, c3.id));
    exigirEstado(resultado, 200, 'todo listo');
    expect(resultado.body).toMatchObject({ id: c3.id, tipo: 'COMANDA' });
    expect(resultado.body.lineas.map((l: LineaKds) => l.estado)).toEqual(['LISTO', 'LISTO']);
    expect(nombresDeEventos(eventos).sort()).toEqual([
      'cocina.linea',
      'cocina.linea',
      'cocina.listo',
      'cocina.listo',
    ]);
    const idsListo = eventos
      .filter((e) => e.nombre === 'cocina.listo')
      .map((e) => (e.datos as { lineaId: string }).lineaId)
      .sort();
    expect(idsListo).toEqual(c3.lineas.map((l) => l.id).sort());

    const otra = await conEventos(ctx, () => todoListo(t().cocina, c3.id));
    exigirEstado(otra.resultado, 200, 'repetir');
    expect(otra.eventos).toEqual([]);
    expect((await delKds(tercera.orden.id)).recientes).toHaveLength(1);
  });

  it('Todo listo sobre una comanda de marcha y Visto sobre una comanda responden 409 TRANSICION_INVALIDA', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(await marchar(ctx, t().mozo, orden.id, { id: randomUUID() }), 201, 'marchar');
    const { pendientes } = await delKds(orden.id);
    const comanda = pendientes.find((c) => c.tipo === 'COMANDA')!;
    const marcha = pendientes.find((c) => c.tipo === 'MARCHAR')!;
    esperarError(await todoListo(t().cocina, marcha.id), 409, 'TRANSICION_INVALIDA');
    esperarError(await visto(t().cocina, comanda.id), 409, 'TRANSICION_INVALIDA');
    // La adición se marca igual que una comanda.
    exigirEstado(await todoListo(t().cocina, comanda.id), 200, 'todo listo de la comanda');
  });

  it('Visto es idempotente: la segunda vez no cambia la fecha en que se vio', async () => {
    const orden = await abrir();
    await sembrarEnvio(
      api,
      A().empresaId,
      { sucursalId: A().S1, ordenId: orden.id, estacionId: esc.carta.cocinaId },
      [{ productoId: esc.carta.lomo, precio: '10.00', cantidad: 1 }],
    );
    const anulacion = (await delKds(orden.id)).pendientes.find((c) => c.tipo === 'ANULACION')!;
    const primera = await visto(t().cocina, anulacion.id);
    exigirEstado(primera, 200, 'visto');
    ctx.reloj.avanzar(5 * MINUTO);
    const { resultado, eventos } = await conEventos(ctx, () => visto(t().cocina, anulacion.id));
    exigirEstado(resultado, 200, 'visto otra vez');
    expect(resultado.body.vistaEn).toBe(primera.body.vistaEn);
    expect(eventos).toEqual([]);
  });

  it('una comanda de otra sucursal o inexistente responde 404', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1)]);
    const comanda = (await delKds(orden.id)).pendientes[0]!;
    esperarError(await todoListo(cocinaS2, comanda.id), 404, 'NO_ENCONTRADO');
    esperarError(await visto(cocinaS2, comanda.id), 404, 'NO_ENCONTRADO');
    esperarError(await todoListo(t().cocina, randomUUID()), 404, 'NO_ENCONTRADO');
    esperarError(await todoListo(t().cocina, 'x'), 400, 'DATOS_INVALIDOS');
  });
});

describe('criterio 61 · estaciones y destino', () => {
  it('estacionIds filtra por estación (una o varias, separadas por comas o repetidas); sin él, todas las activas', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1), L.combo(['Cerveza', 'Ensalada'], 1)]);
    const { cocinaId, barraId } = esc.carta;
    const tipos = async (consulta: string) =>
      (await delKds(orden.id, consulta)).pendientes.map((c) => c.estacion.id).sort();

    expect(await tipos('')).toEqual([barraId, cocinaId].sort());
    expect(await tipos(`?estacionIds=${cocinaId}`)).toEqual([cocinaId]);
    expect(await tipos(`?estacionIds=${barraId}`)).toEqual([barraId]);
    expect(await tipos(`?estacionIds=${cocinaId},${barraId}`)).toEqual([barraId, cocinaId].sort());
    expect(await tipos(`?estacionIds=${cocinaId}&estacionIds=${barraId}`)).toEqual(
      [barraId, cocinaId].sort(),
    );
    expect(await tipos(`?estacionIds=${randomUUID()}`)).toEqual([]);
    expect(await tipos(`?estacionIds=${esc.cartaB.cocinaId}`)).toEqual([]);
    esperarError(
      await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/cocina/comandas?estacionIds=hola' }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/cocina/comandas?otro=1' }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('una estación desactivada ya no aparece sin filtro, pero sus comandas ya enviadas siguen a la vista si se la pide', async () => {
    const estacion = await crearEnCarta(ctx, A().tokenAdmin, '/carta/estaciones', {
      nombre: nombreUnico('Parrilla'),
    });
    const producto = await crearEnCarta(
      ctx,
      A().tokenAdmin,
      '/carta/productos',
      simpleNuevo(esc.carta, { estacionId: estacion.id }),
    );
    const { orden } = await ordenEnviada([
      { productoId: producto.id, modificadorIds: [], cantidad: 1 },
    ]);
    const nombre = async (consulta: string) =>
      (await delKds(orden.id, consulta)).pendientes.map((c) => c.estacion.nombre);
    expect(await nombre('')).toEqual([estacion.nombre]);
    exigirEstado(
      await llamar(ctx, A().tokenAdmin, {
        metodo: 'patch',
        ruta: `/carta/productos/${producto.id}`,
        cuerpo: { activo: false },
      }),
      200,
      'desactivar el producto',
    );
    exigirEstado(
      await llamar(ctx, A().tokenAdmin, {
        metodo: 'patch',
        ruta: `/carta/estaciones/${estacion.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la estación',
    );
    expect(await nombre('')).toEqual([]);
    expect(await nombre(`?estacionIds=${estacion.id}`)).toEqual([estacion.nombre]);
  });

  it('el KDS muestra solo las comandas con destino KDS; una con impresora no aparece ni se opera desde el KDS', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1), L.combo(['Cerveza', 'Ensalada'], 1)]);
    const antes = (await delKds(orden.id)).pendientes;
    const impresa = antes.find((c) => c.estacion.id === esc.carta.cocinaId)!;
    await escribirEnA(async () => {
      await api.query(
        `UPDATE comanda SET destino = 'IMPRESORA', actualizado_en = now() WHERE id = $1`,
        [impresa.id],
      );
    });
    const despues = await delKds(orden.id);
    expect(despues.pendientes.map((c) => c.id)).toEqual(
      antes.filter((c) => c.id !== impresa.id).map((c) => c.id),
    );
    expect(despues.recientes).toEqual([]);
    esperarError(
      await ponerEstadoLinea(t().cocina, impresa.lineas[0]!.id, 'LISTO'),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(await todoListo(t().cocina, impresa.id), 404, 'NO_ENCONTRADO');
    const fila = await admin.query(`SELECT estado FROM comanda_linea WHERE id = $1`, [
      impresa.lineas[0]!.id,
    ]);
    expect(fila.rows[0].estado).toBe('ENVIADO');
  });
});

describe('criterio 56 · ETag y conteo de consultas', () => {
  it('responde con ETag, 304 con If-None-Match igual y un ETag nuevo cuando algo cambia (ahora no cuenta)', async () => {
    const primera = await llamar(ctx, cocinaS2, { metodo: 'get', ruta: '/cocina/comandas' });
    exigirEstado(primera, 200, 'GET');
    const etag = primera.headers['etag'] as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(primera.headers['cache-control']).toBe('private, no-cache');

    ctx.reloj.avanzar(10_000);
    const igual = await llamar(ctx, cocinaS2, {
      metodo: 'get',
      ruta: '/cocina/comandas',
      cabeceras: { 'If-None-Match': etag },
    });
    expect(igual.status).toBe(304);
    expect(igual.text).toBe('');

    // Un cambio en S2 cambia el ETag.
    const o2 = await abrirOrden(ctx, esc.salonS2, t().mozoS2);
    await enviarOk(ctx, t().mozoS2, o2.id, [L.lomo(['3/4'], 1)]);
    const cambio = await llamar(ctx, cocinaS2, {
      metodo: 'get',
      ruta: '/cocina/comandas',
      cabeceras: { 'If-None-Match': etag },
    });
    expect(cambio.status).toBe(200);
    expect(cambio.headers['etag']).not.toBe(etag);
  });

  it('hace las mismas consultas con una comanda o con muchas, y con la cocina vacía', async () => {
    const vacia = await contarConsultas(ctx, () =>
      leerKds(cocinaS2, `?estacionIds=${randomUUID()}`),
    );
    expect(vacia.resultado.pendientes).toEqual([]);

    const pocas = await contarConsultas(ctx, () => leerKds(t().cocina));
    for (let i = 0; i < 6; i++) {
      await ordenEnviada([L.lomo(['3/4'], 1), L.gaseosa(2), L.combo(['Cerveza', 'Ensalada'], 1)]);
    }
    const muchas = await contarConsultas(ctx, () => leerKds(t().cocina));
    expect(muchas.resultado.pendientes.length).toBeGreaterThan(
      pocas.resultado.pendientes.length + 10,
    );
    expect(muchas.consultas).toBe(pocas.consultas);
    // Con estaciones nombradas son las mismas consultas (una por las estaciones activas o por sus nombres).
    const filtradas = await contarConsultas(ctx, () =>
      leerKds(t().cocina, `?estacionIds=${esc.carta.cocinaId},${esc.carta.barraId}`),
    );
    expect(filtradas.consultas).toBe(pocas.consultas);
  });
});
