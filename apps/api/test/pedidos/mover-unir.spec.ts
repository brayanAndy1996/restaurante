// Historia 004 · salón y cocina, grupo C6 (T25) · pruebas del desarrollador (no protegidas) de mover y unir mesas
// (criterios 45 a 49). Completan las protegidas de `salon-critica/` (que ya usan la unión como preparación) con
// lo que ellas no miran: el historial de `orden_mesa`, la fila de auditoría `unir_ordenes`, la invalidación de
// las pre-cuentas, el límite de 20 mesas, las carreras de la unión con un envío y entre dos uniones cruzadas, y
// la repetición.
import { randomUUID } from 'node:crypto';
import type { OrdenRespuesta } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  asentar,
  auditoriaSalon,
  crearEscenarioP3,
  enviar,
  esperarError,
  eventosDe,
  exigirEstado,
  filasDe,
  leerOrden,
  leerSalon,
  lineaCombo,
  lineaGaseosa,
  lineaLomo,
  llamar,
  pedirPrecuenta,
  sembrarCartaSalon,
  sesiones,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
  type MesaDePrueba,
} from '../salon-critica/fabrica-p3';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppP3;
let e: EscenarioP3;
let admin: Client;
let carta: CartaSalon;
let mesas: PoolDeMesas;
let mozo: string;
let mozo2: string;
let cocina: string;

beforeAll(async () => {
  ctx = await arrancarP3({ poolMax: 4 });
  admin = await abrirCliente('admin');
  e = await crearEscenarioP3(ctx);
  carta = await sembrarCartaSalon(ctx, e.A.tokenAdmin);
  mesas = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1);
  mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
  mozo2 = (await sesiones(ctx, e.mozo2, e.A.S1)).contrasena;
  cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

interface Abierta {
  id: string;
  mesa: MesaDePrueba;
}

/** Abre una mesa nueva (con `token`, por defecto el Mozo) y, si se pide, envía la gaseosa y el lomo. */
async function abrir(
  opciones: { token?: string; comensales?: number; conItems?: boolean } = {},
): Promise<Abierta> {
  const mesa = await mesas.siguiente();
  const token = opciones.token ?? mozo;
  const res = await abrirOrden(ctx, token, {
    mesaId: mesa.id,
    comensales: opciones.comensales ?? 2,
  });
  exigirEstado(res, 201, 'abrir la mesa');
  const id = res.body.id as string;
  if (opciones.conItems === true) {
    const envio = await enviar(ctx, token, id, [lineaLomo(carta, 1), lineaGaseosa(carta, 2)]);
    exigirEstado(envio, 201, 'enviar la comanda');
  }
  return { id, mesa };
}

const mover = (token: string, ordenId: string, cuerpo: Record<string, unknown>) =>
  llamar(ctx, token, { metodo: 'post', ruta: `/ordenes/${ordenId}/movimiento`, cuerpo });
const unir = (token: string, ordenId: string, mesaIds: string[]) =>
  llamar(ctx, token, { metodo: 'post', ruta: `/ordenes/${ordenId}/union`, cuerpo: { mesaIds } });

const relaciones = (ordenId: string) =>
  filasDe(admin, 'orden_mesa', 'orden_id = $1', [ordenId]) as Promise<
    { mesa_id: string; desde: Date; hasta: Date | null }[]
  >;
const vigentes = async (ordenId: string): Promise<string[]> =>
  (await relaciones(ordenId)).filter((r) => r.hasta === null).map((r) => r.mesa_id);

describe('criterio 45 · mover', () => {
  it('a una mesa libre: la orden pasa a la nueva, la original queda libre y el historial se conserva', async () => {
    const o = await abrir({ conItems: true });
    const libre = await mesas.siguiente();
    const antes = await leerOrden(ctx, mozo, o.id);
    await asentar();
    ctx.publicador.limpiar();

    const res = await mover(mozo, o.id, { mesaDestinoId: libre.id });
    exigirEstado(res, 200, 'mover a una mesa libre');
    const orden = res.body as OrdenRespuesta;
    expect(orden.mesas).toEqual([{ id: libre.id, nombre: libre.nombre }]);
    // Estado, ítems, total y mozo no cambian.
    expect(orden.estado).toBe(antes.estado);
    expect(orden.items.map((i) => i.id)).toEqual(antes.items.map((i) => i.id));
    expect(orden.total).toBe(antes.total);
    expect(orden.mozo).toEqual(antes.mozo);

    const historial = await relaciones(o.id);
    expect(historial).toHaveLength(2);
    expect(historial.find((r) => r.mesa_id === o.mesa.id)!.hasta).not.toBeNull();
    expect(await vigentes(o.id)).toEqual([libre.id]);
    const salon = await leerSalon(ctx, mozo);
    const todas = salon.zonas.flatMap((z) => z.mesas);
    expect(todas.find((m) => m.id === o.mesa.id)).toMatchObject({ estado: 'LIBRE', orden: null });
    expect(todas.find((m) => m.id === libre.id)!.orden).toMatchObject({ id: o.id });

    // Eventos: una mesa de origen, una de destino y la orden; ninguna fila de auditoría.
    await asentar();
    const salonCambio = eventosDe(ctx, 'salon.cambio');
    expect(salonCambio).toHaveLength(1);
    expect(
      (salonCambio[0]!.datos as { mesaIds: string[]; ordenId: string }).mesaIds.sort(),
    ).toEqual([o.mesa.id, libre.id].sort());
    expect(eventosDe(ctx, 'orden.cambio')).toHaveLength(1);
    const auditoria = await auditoriaSalon(admin, e.A.empresaId, { entidadId: o.id });
    expect(auditoria).toEqual([]);
  });

  it('a una mesa ocupada responde 409 MESA_OCUPADA con la orden que la ocupa y no cambia nada', async () => {
    const o = await abrir();
    const otra = await abrir();
    await asentar();
    ctx.publicador.limpiar();
    const res = await mover(mozo, o.id, { mesaDestinoId: otra.mesa.id });
    esperarError(res, 409, 'MESA_OCUPADA');
    expect(res.body.ordenId).toBe(otra.id);
    expect(await vigentes(o.id)).toEqual([o.mesa.id]);
    expect(await vigentes(otra.id)).toEqual([otra.mesa.id]);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('repetir el movimiento hecho responde 200 sin otro efecto (ni eventos ni filas nuevas)', async () => {
    const o = await abrir();
    const libre = await mesas.siguiente();
    exigirEstado(await mover(mozo, o.id, { mesaDestinoId: libre.id }), 200, 'mover');
    const filas = (await relaciones(o.id)).length;
    await asentar();
    ctx.publicador.limpiar();
    // Con y sin la mesa de origen (que ya no es de la orden).
    exigirEstado(await mover(mozo, o.id, { mesaDestinoId: libre.id }), 200, 'repetir');
    exigirEstado(
      await mover(mozo, o.id, { mesaOrigenId: o.mesa.id, mesaDestinoId: libre.id }),
      200,
      'repetir con el origen',
    );
    expect((await relaciones(o.id)).length).toBe(filas);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('una orden con varias mesas pide la de origen (400) y mueve solo esa; una que no es suya da 422', async () => {
    const o = await abrir();
    const segunda = await mesas.siguiente();
    exigirEstado(await unir(mozo, o.id, [segunda.id]), 200, 'unir una mesa libre');
    const destino = await mesas.siguiente();

    const sinOrigen = await mover(mozo, o.id, { mesaDestinoId: destino.id });
    esperarError(sinOrigen, 400, 'DATOS_INVALIDOS');
    expect(sinOrigen.body.campos.map((c: { campo: string }) => c.campo)).toContain('mesaOrigenId');

    const ajena = await mesas.siguiente();
    esperarError(
      await mover(mozo, o.id, { mesaOrigenId: ajena.id, mesaDestinoId: destino.id }),
      422,
      'REFERENCIA_INVALIDA',
    );
    expect((await vigentes(o.id)).sort()).toEqual([o.mesa.id, segunda.id].sort());

    exigirEstado(
      await mover(mozo, o.id, { mesaOrigenId: o.mesa.id, mesaDestinoId: destino.id }),
      200,
      'mover una de las dos',
    );
    expect((await vigentes(o.id)).sort()).toEqual([segunda.id, destino.id].sort());
  });

  it('una mesa de otra sucursal o inexistente responde 404 con el mismo cuerpo; una inactiva, 409', async () => {
    const o = await abrir();
    const deS2 = await new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S2).siguiente();
    const ajena = await mover(mozo, o.id, { mesaDestinoId: deS2.id });
    const inexistente = await mover(mozo, o.id, { mesaDestinoId: randomUUID() });
    esperarError(ajena, 404, 'NO_ENCONTRADO');
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(ajena.body).toEqual(inexistente.body);

    const inactiva = await mesas.siguiente();
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la mesa',
    );
    esperarError(await mover(mozo, o.id, { mesaDestinoId: inactiva.id }), 409, 'CONFLICTO');
    expect(await vigentes(o.id)).toEqual([o.mesa.id]);
  });

  it('no invalida la pre-cuenta ni cambia el estado de la orden', async () => {
    const o = await abrir({ conItems: true });
    const precuenta = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(precuenta, 201, 'pedir la pre-cuenta');
    const libre = await mesas.siguiente();
    exigirEstado(await mover(mozo, o.id, { mesaDestinoId: libre.id }), 200, 'mover');
    const orden = await leerOrden(ctx, mozo, o.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente).toMatchObject({ id: precuenta.body.id });
    // Pedirla de nuevo devuelve la misma, ya con la mesa nueva.
    const otra = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(otra, 201, 'pedir otra');
    expect(otra.body.id).toBe(precuenta.body.id);
    expect(otra.body.orden.mesas).toEqual([{ id: libre.id, nombre: libre.nombre }]);
  });

  it('una orden anulada o unida responde 409 ORDEN_NO_ABIERTA; Cocina/Barra, 403', async () => {
    const o = await abrir();
    const libre = await mesas.siguiente();
    esperarError(await mover(cocina, o.id, { mesaDestinoId: libre.id }), 403, 'PROHIBIDO');

    const anulada = await abrir();
    exigirEstado(
      await llamar(ctx, mozo, {
        metodo: 'post',
        ruta: `/ordenes/${anulada.id}/liberacion`,
        cabeceras: { 'Idempotency-Key': randomUUID() },
      }),
      200,
      'liberar la mesa',
    );
    esperarError(
      await mover(mozo, anulada.id, { mesaDestinoId: libre.id }),
      409,
      'ORDEN_NO_ABIERTA',
    );

    const absorbida = await abrir();
    exigirEstado(await unir(mozo, o.id, [absorbida.mesa.id]), 200, 'unir');
    const res = await mover(mozo, absorbida.id, { mesaDestinoId: libre.id });
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(o.id);
  });
});

describe('criterios 46 y 47 · unir', () => {
  it('mesas libres: se suman a la orden, el mapa las muestra como grupo y repetir responde 200 sin efectos', async () => {
    const o = await abrir({ conItems: true });
    const [a, b] = [await mesas.siguiente(), await mesas.siguiente()];
    await asentar();
    ctx.publicador.limpiar();
    const res = await unir(mozo, o.id, [a.id, b.id]);
    exigirEstado(res, 200, 'unir dos mesas libres');
    const orden = res.body as OrdenRespuesta;
    expect(orden.mesas.map((m) => m.id).sort()).toEqual([o.mesa.id, a.id, b.id].sort());
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.comensales).toBe(2);

    const salon = await leerSalon(ctx, mozo);
    const todas = salon.zonas.flatMap((z) => z.mesas);
    for (const id of [o.mesa.id, a.id, b.id]) {
      const mesa = todas.find((m) => m.id === id)!;
      expect(mesa.orden?.id).toBe(o.id);
      expect(mesa.orden?.mesas.map((m) => m.id).sort()).toEqual([o.mesa.id, a.id, b.id].sort());
    }
    await asentar();
    const cambios = eventosDe(ctx, 'salon.cambio');
    expect(cambios).toHaveLength(1);
    expect((cambios[0]!.datos as { mesaIds: string[] }).mesaIds.sort()).toEqual(
      [o.mesa.id, a.id, b.id].sort(),
    );
    expect(eventosDe(ctx, 'orden.cambio')).toHaveLength(1);
    // Sin otra orden absorbida no hay fila de auditoría.
    expect(
      await auditoriaSalon(admin, e.A.empresaId, { accion: 'unir_ordenes', entidadId: o.id }),
    ).toEqual([]);

    // Repetir (también con una mesa que ya es de la orden): 200 sin otro efecto.
    ctx.publicador.limpiar();
    const filas = (await relaciones(o.id)).length;
    exigirEstado(await unir(mozo, o.id, [a.id, b.id]), 200, 'repetir la unión');
    exigirEstado(await unir(mozo, o.id, [o.mesa.id]), 200, 'unir la propia mesa');
    expect((await relaciones(o.id)).length).toBe(filas);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('una mesa ocupada: su orden se une (ítems, mesas y comensales pasan a la principal) y deja la fila unir_ordenes', async () => {
    const principal = await abrir({ token: mozo, comensales: 3, conItems: true });
    const absorbida = await abrir({ token: mozo2, comensales: 4 });
    const envio = await enviar(ctx, mozo2, absorbida.id, [lineaCombo(carta, 1)]);
    exigirEstado(envio, 201, 'enviar a la absorbida');
    const comboId = (envio.body.items as { id: string }[])[0]!.id;
    const extra = await mesas.siguiente();
    exigirEstado(await unir(mozo2, absorbida.id, [extra.id]), 200, 'dar otra mesa a la absorbida');
    // Pre-cuentas en las dos.
    exigirEstado(await pedirPrecuenta(ctx, mozo, principal.id), 201, 'pre-cuenta de la principal');
    exigirEstado(await pedirPrecuenta(ctx, mozo2, absorbida.id), 201, 'pre-cuenta de la absorbida');
    const totalAntes = (await leerOrden(ctx, mozo, principal.id)).total;
    await asentar();
    ctx.publicador.limpiar();

    const res = await unir(mozo, principal.id, [absorbida.mesa.id]);
    exigirEstado(res, 200, 'unir una mesa ocupada');
    const orden = res.body as OrdenRespuesta;
    // Sus mesas (las dos de la absorbida también), sus comensales y sus ítems, con su autor y su envío.
    expect(orden.mesas.map((m) => m.id).sort()).toEqual(
      [principal.mesa.id, absorbida.mesa.id, extra.id].sort(),
    );
    expect(orden.comensales).toBe(7);
    expect(orden.mozo.id).toBe(e.A.mozo.id);
    const combo = orden.items.find((i) => i.id === comboId)!;
    expect(combo.comandadoPor?.id).toBe(e.mozo2.id);
    expect(combo.envioNumero).toBe(1);
    expect(orden.items).toHaveLength(3);
    // La pre-cuenta de la principal se invalidó y la orden vuelve a ABIERTA.
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.precuentaVigente).toBeNull();
    expect(orden.total).not.toBe(totalAntes);

    // La absorbida: UNIDA, sin mesas vigentes, sin ítems y con su pre-cuenta invalidada.
    const absorbidaFila = await filasDe(admin, 'orden', 'id = $1', [absorbida.id]);
    expect(absorbidaFila[0]).toMatchObject({ estado: 'UNIDA', unida_a_orden_id: principal.id });
    expect(await vigentes(absorbida.id)).toEqual([]);
    expect(await filasDe(admin, 'item', 'orden_id = $1', [absorbida.id])).toHaveLength(0);
    const precuentas = await filasDe(admin, 'precuenta', 'orden_id = ANY($1::uuid[])', [
      [principal.id, absorbida.id],
    ]);
    expect(precuentas).toHaveLength(2);
    expect(precuentas.every((p) => p.invalidada_en !== null)).toBe(true);
    const vista = await leerOrden(ctx, mozo, absorbida.id);
    expect(vista.estado).toBe('UNIDA');
    expect(vista.unidaA).toBe(principal.id);

    // Las comandas no se tocan: siguen en su orden de origen.
    const comandas = await filasDe(admin, 'comanda', 'orden_id = $1', [absorbida.id]);
    expect(comandas.length).toBeGreaterThan(0);

    // Auditoría: una sola fila con el mozo y los ítems de la absorbida.
    const filas = await auditoriaSalon(admin, e.A.empresaId, {
      accion: 'unir_ordenes',
      entidadId: principal.id,
    });
    expect(filas).toHaveLength(1);
    const detalle = filas[0]!.detalle as {
      mozoId: string;
      absorbidas: {
        ordenId: string;
        mozoId: string;
        comensales: number;
        mesas: { id: string }[];
        items: { itemId: string; nombre: string; totalVigente: string }[];
      }[];
    };
    expect(filas[0]!.actor_usuario_id).toBe(e.A.mozo.id);
    expect(detalle.mozoId).toBe(e.A.mozo.id);
    expect(detalle.absorbidas).toHaveLength(1);
    expect(detalle.absorbidas[0]).toMatchObject({
      ordenId: absorbida.id,
      mozoId: e.mozo2.id,
      comensales: 4,
    });
    expect(detalle.absorbidas[0]!.mesas.map((m) => m.id).sort()).toEqual(
      [absorbida.mesa.id, extra.id].sort(),
    );
    expect(detalle.absorbidas[0]!.items.map((i) => [i.itemId, i.totalVigente])).toEqual([
      [comboId, '27.40'],
    ]);

    // Eventos: todas las mesas en un salon.cambio y un orden.cambio por orden.
    await asentar();
    const cambios = eventosDe(ctx, 'salon.cambio');
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.datos).toMatchObject({ ordenId: principal.id });
    expect((cambios[0]!.datos as { mesaIds: string[] }).mesaIds.sort()).toEqual(
      [principal.mesa.id, absorbida.mesa.id, extra.id].sort(),
    );
    expect(
      eventosDe(ctx, 'orden.cambio')
        .map((x) => (x.datos as { ordenId: string }).ordenId)
        .sort(),
    ).toEqual([principal.id, absorbida.id].sort());

    // Repetir la unión ya hecha: 200 sin otro efecto.
    ctx.publicador.limpiar();
    exigirEstado(await unir(mozo, principal.id, [absorbida.mesa.id]), 200, 'repetir la unión');
    expect(
      await auditoriaSalon(admin, e.A.empresaId, {
        accion: 'unir_ordenes',
        entidadId: principal.id,
      }),
    ).toHaveLength(1);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    // Y se puede seguir comandando a la principal, que numera su siguiente envío.
    const adicion = await enviar(ctx, mozo, principal.id, [lineaGaseosa(carta, 1)]);
    exigirEstado(adicion, 201, 'enviar a la principal');
    expect(adicion.body.esAdicion).toBe(true);
  });

  it('unir solo mesas libres a una orden en pre-cuenta no invalida la pre-cuenta', async () => {
    const o = await abrir({ conItems: true });
    const precuenta = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(precuenta, 201, 'pedir la pre-cuenta');
    const libre = await mesas.siguiente();
    exigirEstado(await unir(mozo, o.id, [libre.id]), 200, 'unir una libre');
    const orden = await leerOrden(ctx, mozo, o.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente?.id).toBe(precuenta.body.id);
  });

  it('una orden vacía absorbida no invalida la pre-cuenta de la principal', async () => {
    const principal = await abrir({ conItems: true });
    const vacia = await abrir();
    const precuenta = await pedirPrecuenta(ctx, mozo, principal.id);
    exigirEstado(precuenta, 201, 'pedir la pre-cuenta');
    exigirEstado(await unir(mozo, principal.id, [vacia.mesa.id]), 200, 'unir la orden vacía');
    const orden = await leerOrden(ctx, mozo, principal.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente?.id).toBe(precuenta.body.id);
    expect((await leerOrden(ctx, mozo, vacia.id)).estado).toBe('UNIDA');
  });

  it('los comensales sumados no pasan de 99', async () => {
    const principal = await abrir({ comensales: 60 });
    const otra = await abrir({ comensales: 60 });
    const res = await unir(mozo, principal.id, [otra.mesa.id]);
    exigirEstado(res, 200, 'unir');
    expect(res.body.comensales).toBe(99);
  });

  it('la orden no pasa de 20 mesas, contando las de la orden absorbida', async () => {
    const principal = await abrir();
    const muchas = await Promise.all(Array.from({ length: 10 }, () => mesas.siguiente()));
    exigirEstado(
      await unir(
        mozo,
        principal.id,
        muchas.map((m) => m.id),
      ),
      200,
      'unir 10 mesas',
    );
    const otra = await abrir();
    const masMesas = await Promise.all(Array.from({ length: 10 }, () => mesas.siguiente()));
    exigirEstado(
      await unir(
        mozo,
        otra.id,
        masMesas.map((m) => m.id),
      ),
      200,
      'unir 10 mesas a la otra',
    );
    // 11 + 11 = 22 mesas: no cabe.
    const antes = (await vigentes(principal.id)).length;
    esperarError(await unir(mozo, principal.id, [otra.mesa.id]), 422, 'DATOS_INVALIDOS');
    expect((await vigentes(principal.id)).length).toBe(antes);
    expect((await leerOrden(ctx, mozo, otra.id)).estado).toBe('ABIERTA');
  });

  it('una mesa de otra sucursal o inexistente responde 404 con el mismo cuerpo; una orden ajena, 404', async () => {
    const o = await abrir();
    const deS2 = await new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S2).siguiente();
    const ajena = await unir(mozo, o.id, [deS2.id]);
    const inexistente = await unir(mozo, o.id, [randomUUID()]);
    esperarError(ajena, 404, 'NO_ENCONTRADO');
    expect(ajena.body).toEqual(inexistente.body);
    const libre = await mesas.siguiente();
    esperarError(await unir(mozo, randomUUID(), [libre.id]), 404, 'NO_ENCONTRADO');
    expect(await vigentes(o.id)).toEqual([o.mesa.id]);
  });

  it('una mesa inactiva libre responde 409 CONFLICTO y no se une nada', async () => {
    const o = await abrir();
    const libre = await mesas.siguiente();
    const inactiva = await mesas.siguiente();
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    esperarError(await unir(mozo, o.id, [libre.id, inactiva.id]), 409, 'CONFLICTO');
    expect(await vigentes(o.id)).toEqual([o.mesa.id]);
  });

  it('una orden unida u anulada no puede ser la principal (409 ORDEN_NO_ABIERTA)', async () => {
    const principal = await abrir();
    const absorbida = await abrir();
    exigirEstado(await unir(mozo, principal.id, [absorbida.mesa.id]), 200, 'unir');
    const libre = await mesas.siguiente();
    const res = await unir(mozo, absorbida.id, [libre.id]);
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId).toBe(principal.id);
  });
});

describe('criterio 48 · carreras', () => {
  it('un envío a la orden que se absorbe, a la vez que la unión, no pierde ni duplica ítems', async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const principal = await abrir({ conItems: true });
      const absorbida = await abrir();
      const envioId = randomUUID();
      const [union, envio] = await Promise.all([
        unir(mozo, principal.id, [absorbida.mesa.id]),
        enviar(ctx, mozo2, absorbida.id, [lineaGaseosa(carta, 1)], { id: envioId }),
      ]);
      exigirEstado(union, 200, `unir (ronda ${ronda})`);
      // Ni 500 ni nada raro: el envío termina antes (201) o después (409 con la principal).
      if (envio.status === 409) {
        esperarError(envio, 409, 'ORDEN_NO_ABIERTA');
        expect(envio.body.ordenId).toBe(principal.id);
      } else {
        exigirEstado(envio, 201, `enviar (ronda ${ronda})`);
      }
      // Ningún ítem queda en la orden unida, y el del envío (si salió) está una sola vez en la principal.
      expect(await filasDe(admin, 'item', 'orden_id = $1', [absorbida.id])).toHaveLength(0);
      const enPrincipal = await filasDe(admin, 'item', 'orden_id = $1 AND envio_id = $2', [
        principal.id,
        envioId,
      ]);
      expect(enPrincipal).toHaveLength(envio.status === 201 ? 1 : 0);
      const total = await filasDe(admin, 'item', 'envio_id = $1', [envioId]);
      expect(total).toHaveLength(envio.status === 201 ? 1 : 0);
      const orden = await leerOrden(ctx, mozo, principal.id);
      expect(orden.items).toHaveLength(2 + (envio.status === 201 ? 1 : 0));
    }
  });

  it('dos uniones cruzadas terminan con una sola orden abierta o con un 409 que se puede repetir', async () => {
    for (let ronda = 0; ronda < 6; ronda++) {
      const uno = await abrir({ conItems: true });
      const dos = await abrir({ conItems: true });
      const [a, b] = await Promise.all([
        unir(mozo, uno.id, [dos.mesa.id]),
        unir(mozo2, dos.id, [uno.mesa.id]),
      ]);
      const estados = [a.status, b.status];
      expect(
        estados.every((s) => s === 200 || s === 409),
        JSON.stringify([a.body, b.body]),
      ).toBe(true);
      expect(estados.includes(200)).toBe(true);
      for (const r of [a, b]) {
        if (r.status === 409) expect(['ORDEN_NO_ABIERTA', 'CONFLICTO']).toContain(r.body.codigo);
      }
      const ordenes = (await filasDe(admin, 'orden', 'id = ANY($1::uuid[])', [
        [uno.id, dos.id],
      ])) as {
        id: string;
        estado: string;
        unida_a_orden_id: string | null;
      }[];
      const abiertas = ordenes.filter((o) => o.estado === 'ABIERTA');
      expect(abiertas).toHaveLength(1);
      const unida = ordenes.find((o) => o.estado === 'UNIDA')!;
      expect(unida.unida_a_orden_id).toBe(abiertas[0]!.id);
      // Todos los ítems (4) y las dos mesas están en la que quedó abierta.
      const final = await leerOrden(ctx, mozo, abiertas[0]!.id);
      expect(final.items).toHaveLength(4);
      expect(final.mesas.map((m) => m.id).sort()).toEqual([uno.mesa.id, dos.mesa.id].sort());
      // Si hubo un 409 CONFLICTO, repetirlo termina bien o con el 409 de la orden ya unida.
    }
  });

  it('dos uniones a la vez sobre la misma mesa libre terminan con la mesa en una sola orden', async () => {
    const a = await abrir();
    const b = await abrir();
    const libre = await mesas.siguiente();
    const [x, y] = await Promise.all([unir(mozo, a.id, [libre.id]), unir(mozo, b.id, [libre.id])]);
    // La segunda ve la mesa ya tomada por la primera y, como está ocupada, absorbe su orden (decisión 9).
    expect([x.status, y.status].sort()).toEqual([200, 200]);
    const ocupantes = await filasDe(admin, 'orden_mesa', 'mesa_id = $1 AND hasta IS NULL', [
      libre.id,
    ]);
    expect(ocupantes).toHaveLength(1);
  });
});

describe('Idempotency-Key en mover y unir', () => {
  it('mover: la réplica con la misma clave devuelve la misma respuesta sin volver a mover ni publicar', async () => {
    const o = await abrir({ conItems: true });
    const libre = await mesas.siguiente();
    const clave = randomUUID();
    const pedir = () =>
      llamar(ctx, mozo, {
        metodo: 'post',
        ruta: `/ordenes/${o.id}/movimiento`,
        cuerpo: { mesaDestinoId: libre.id },
        cabeceras: { 'Idempotency-Key': clave },
      });
    const primera = await pedir();
    exigirEstado(primera, 200, 'mover');
    const filas = (await relaciones(o.id)).length;
    await asentar();
    ctx.publicador.limpiar();
    const replica = await pedir();
    exigirEstado(replica, 200, 'réplica');
    expect(replica.body).toEqual(primera.body);
    expect((await relaciones(o.id)).length).toBe(filas);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
    // La misma clave con otro cuerpo no es una réplica.
    const otra = await mesas.siguiente();
    esperarError(
      await llamar(ctx, mozo, {
        metodo: 'post',
        ruta: `/ordenes/${o.id}/movimiento`,
        cuerpo: { mesaDestinoId: otra.id },
        cabeceras: { 'Idempotency-Key': clave },
      }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    expect(await vigentes(o.id)).toEqual([libre.id]);
  });

  it('unir: la réplica con la misma clave devuelve la misma respuesta sin volver a unir, auditar ni publicar', async () => {
    const principal = await abrir({ conItems: true });
    const absorbida = await abrir({ conItems: true });
    const clave = randomUUID();
    const pedir = () =>
      llamar(ctx, mozo, {
        metodo: 'post',
        ruta: `/ordenes/${principal.id}/union`,
        cuerpo: { mesaIds: [absorbida.mesa.id] },
        cabeceras: { 'Idempotency-Key': clave },
      });
    const primera = await pedir();
    exigirEstado(primera, 200, 'unir');
    await asentar();
    ctx.publicador.limpiar();
    const replica = await pedir();
    exigirEstado(replica, 200, 'réplica');
    expect(replica.body).toEqual(primera.body);
    expect(
      await auditoriaSalon(admin, e.A.empresaId, {
        accion: 'unir_ordenes',
        entidadId: principal.id,
      }),
    ).toHaveLength(1);
    expect((await leerOrden(ctx, mozo, principal.id)).items).toHaveLength(4);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});
