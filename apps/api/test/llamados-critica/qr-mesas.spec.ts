// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · Los códigos QR de las mesas · Criterios 6, 9 y 10. La API real con `RelojManual` y `PublicadorEnMemoria`,
// dos empresas (A con S1 y S2, y B) con la carta de ejemplo de 003, las mesas creadas por las rutas de zonas y
// mesas de 004, la carta web publicada por sus rutas y el código de cada mesa leído de la hoja de QR.
//
// Cubre: el código nace con la mesa (22 caracteres base64url, único, no se puede elegir, la respuesta de 004 no
// cambia) (6); cambiar el QR: código nuevo, el anterior responde 404 en la mesa, en un llamado nuevo y en el
// estado de un llamado hecho con él, el llamado ya creado sigue para el mozo, réplica con la misma clave y otro
// código con otra clave, mesa inactiva, otra sucursal, B o inexistente (9); y la mesa inactiva (404 y vuelta al
// reactivarla con el mismo código) (10).
import { qrMesaRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  HORA_DE_SERVICIO,
  URL_CARTA,
  arrancarLlamados,
  cambiarQr,
  clienteNuevo,
  crearLlamado,
  crearOk,
  cuerpoLlamarMozo,
  cuerpoPedido,
  enviarLlamado,
  esperarError,
  esperarNoDisponible,
  exigirEstado,
  leerHoja,
  lineasDelPedido,
  listaDeLlamados,
  llamar,
  mesaConCodigo,
  mesasConCodigo,
  ponerActiva,
  prepararEscenarioLlamados,
  verEstado,
  verMesa,
  type AppLlamados,
  type EscenarioLlamados,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;

const CODIGO_RE = /^[A-Za-z0-9_-]{22}$/;

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

// ===================================================================================================
// Criterio 6 · el código nace con la mesa
// ===================================================================================================

describe('criterio 6 · el código de una mesa', () => {
  it('una mesa nueva tiene su código en la hoja de QR: 22 caracteres base64url y la url de la carta web', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    expect(mesa.codigo).toMatch(CODIGO_RE);
    const hoja = await leerHoja(ctx, esc);
    const fila = hoja.mesas.find((m) => m.mesaId === mesa.id)!;
    expect(fila.codigo).toBe(mesa.codigo);
    expect(fila.url).toBe(`${URL_CARTA}/m/${mesa.codigo}`);
    expect(fila.generadoEn).not.toBeNull();
    expect(new Date(fila.generadoEn!).getTime()).toBe(ctx.reloj.ahora().getTime());
  });

  it('la respuesta de crear la mesa (004) no cambia: no trae el código ni el QR', async () => {
    const zona = await llamar(ctx, esc.e.A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${esc.e.A.S1}/zonas`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 6)}`, columnas: 4, filas: 4 },
    });
    exigirEstado(zona, 201, 'crear la zona');
    const res = await llamar(ctx, esc.e.A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${esc.e.A.S1}/zonas/${zona.body.id as string}/mesas`,
      cuerpo: { nombre: 'Q1', capacidad: 4, forma: 'CUADRADA', columna: 1, fila: 1 },
    });
    exigirEstado(res, 201, 'crear la mesa');
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['activa', 'capacidad', 'columna', 'fila', 'forma', 'id', 'nombre', 'zonaId'].sort(),
    );
    // Y aun así la mesa ya tiene su código.
    const hoja = await leerHoja(ctx, esc);
    const fila = hoja.mesas.find((m) => m.mesaId === res.body.id)!;
    expect(fila.codigo).toMatch(CODIGO_RE);
  });

  it('el código es único: 12 mesas, 12 códigos distintos y ninguno repetido con las de otra sucursal ni con las de B', async () => {
    const delaS1 = await mesasConCodigo(ctx, esc, 8);
    const delaS2 = await mesasConCodigo(ctx, esc, 2, 'S2');
    const deB = await mesasConCodigo(ctx, esc, 2, 'B1');
    const codigos = [...delaS1, ...delaS2, ...deB].map((m) => m.codigo);
    expect(new Set(codigos).size).toBe(12);
    for (const codigo of codigos) expect(codigo).toMatch(CODIGO_RE);
  });

  it('el código no se puede adivinar a partir del id ni del nombre de la mesa', async () => {
    const [a, b] = await mesasConCodigo(ctx, esc, 2);
    for (const mesa of [a!, b!]) {
      expect(mesa.codigo.toLowerCase()).not.toContain(mesa.id.replace(/-/g, '').slice(0, 8));
    }
    // Las dos mesas son consecutivas y sus códigos no comparten ni la mitad del texto.
    let iguales = 0;
    for (let i = 0; i < 22; i += 1) if (a!.codigo[i] === b!.codigo[i]) iguales += 1;
    expect(iguales).toBeLessThan(11);
  });

  it('el código funciona de inmediato en la ruta pública de la mesa', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'GET /publico/mesas/:codigo');
    expect(res.body.mesa).toEqual({ nombre: mesa.nombre });
  });

  it('ninguna entrada acepta el código: crear y editar la mesa con `codigo` son 400', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const elegido = 'A'.repeat(22);
    const zona = await llamar(ctx, esc.e.A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${esc.e.A.S1}/zonas`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 6)}`, columnas: 4, filas: 4 },
    });
    exigirEstado(zona, 201, 'crear la zona');
    const crear = await llamar(ctx, esc.e.A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${esc.e.A.S1}/zonas/${zona.body.id as string}/mesas`,
      cuerpo: {
        nombre: 'Q2',
        capacidad: 4,
        forma: 'CUADRADA',
        columna: 1,
        fila: 1,
        codigo: elegido,
      },
    });
    esperarError(crear, 400, 'DATOS_INVALIDOS');
    const editar = await llamar(ctx, esc.e.A.tokenAdmin, {
      metodo: 'patch',
      ruta: `/sucursales/${esc.e.A.S1}/mesas/${mesa.id}`,
      cuerpo: { codigo: elegido },
    });
    esperarError(editar, 400, 'DATOS_INVALIDOS');
    // El código elegido no abre nada y el de la mesa sigue igual.
    esperarNoDisponible(await verMesa(clienteNuevo(ctx), elegido));
    const hoja = await leerHoja(ctx, esc);
    expect(hoja.mesas.find((m) => m.mesaId === mesa.id)!.codigo).toBe(mesa.codigo);
  });
});

// ===================================================================================================
// Criterio 9 · cambiar el QR de una mesa
// ===================================================================================================

describe('criterio 9 · cambiar el QR', () => {
  it('responde 201 con un código nuevo, su url y la hora; la hoja lista el nuevo y no el anterior', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    ctx.reloj.avanzar(5 * 60_000);
    const res = await cambiarQr(ctx, esc, mesa);
    exigirEstado(res, 201, 'cambiar el QR');
    const nuevo = qrMesaRespuestaSchema.parse(res.body);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'codigo',
      'generadoEn',
      'mesaId',
      'url',
    ]);
    expect(nuevo.mesaId).toBe(mesa.id);
    expect(nuevo.codigo).toMatch(CODIGO_RE);
    expect(nuevo.codigo).not.toBe(mesa.codigo);
    expect(nuevo.url).toBe(`${URL_CARTA}/m/${nuevo.codigo}`);
    expect(new Date(nuevo.generadoEn).getTime()).toBe(ctx.reloj.ahora().getTime());

    const hoja = await leerHoja(ctx, esc);
    const fila = hoja.mesas.find((m) => m.mesaId === mesa.id)!;
    expect(fila.codigo).toBe(nuevo.codigo);
    expect(hoja.mesas.some((m) => m.codigo === mesa.codigo)).toBe(false);
  });

  it('el código anterior responde 404 en la mesa, en un llamado nuevo y en el estado de un llamado hecho con él', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const cliente = clienteNuevo(ctx);
    const hecho = await crearLlamado(ctx, mesa, cuerpoLlamarMozo(), cliente);
    exigirEstado(
      await verEstado(cliente, mesa.codigo, hecho.id),
      200,
      'el estado antes de cambiar',
    );

    const cambio = await cambiarQr(ctx, esc, mesa);
    exigirEstado(cambio, 201, 'cambiar el QR');

    esperarNoDisponible(await verMesa(cliente, mesa.codigo));
    esperarNoDisponible(await enviarLlamado(cliente, mesa.codigo, cuerpoLlamarMozo()));
    esperarNoDisponible(await verEstado(cliente, mesa.codigo, hecho.id));
  });

  it('el código nuevo abre la mesa, recibe llamados y muestra el estado del llamado hecho con el anterior', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const cliente = clienteNuevo(ctx);
    const hecho = await crearLlamado(ctx, mesa, cuerpoLlamarMozo(), cliente);
    const nuevo = qrMesaRespuestaSchema.parse((await cambiarQr(ctx, esc, mesa)).body);

    const vista = await verMesa(cliente, nuevo.codigo);
    exigirEstado(vista, 200, 'la mesa con el código nuevo');
    expect(vista.body.mesa).toEqual({ nombre: mesa.nombre });
    // Es la misma mesa: el llamado pendiente de antes se ve con el código nuevo.
    expect(vista.body.llamadoPendiente).toMatchObject({ tipo: 'LLAMAR_MOZO' });
    const estado = await verEstado(cliente, nuevo.codigo, hecho.id);
    exigirEstado(estado, 200, 'el estado con el código nuevo');
    expect(estado.body).toMatchObject({ id: hecho.id, estado: 'PENDIENTE' });
  });

  it('los llamados ya creados siguen para el mozo en GET /llamados y se pueden atender', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const hecho = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    exigirEstado(await cambiarQr(ctx, esc, mesa), 201, 'cambiar el QR');

    const lista = await listaDeLlamados(ctx, esc.token.mozo);
    exigirEstado(lista, 200, 'GET /llamados');
    const fila = (
      lista.body.llamados as { id: string; estado: string; mesa: { id: string } }[]
    ).find((l) => l.id === hecho.id);
    expect(fila).toMatchObject({ estado: 'PENDIENTE', mesa: { id: mesa.id } });
    const detalle = await llamar(ctx, esc.token.mozo, {
      metodo: 'get',
      ruta: `/llamados/${hecho.id}`,
    });
    exigirEstado(detalle, 200, 'GET /llamados/:id');
  });

  it('la misma clave repetida devuelve la misma respuesta; otra clave genera otro código y el anterior deja de funcionar', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const k = randomUUID();
    const primera = await cambiarQr(ctx, esc, mesa, k);
    exigirEstado(primera, 201, 'cambiar el QR');
    ctx.reloj.avanzar(60_000);
    const replica = await cambiarQr(ctx, esc, mesa, k);
    exigirEstado(replica, 201, 'réplica con la misma clave');
    expect(replica.body).toEqual(primera.body);

    // La réplica no cambió nada: el código sigue funcionando.
    exigirEstado(
      await verMesa(clienteNuevo(ctx), primera.body.codigo as string),
      200,
      'el código de la réplica',
    );

    const otra = await cambiarQr(ctx, esc, mesa, randomUUID());
    exigirEstado(otra, 201, 'cambiar el QR con otra clave');
    expect(otra.body.codigo).not.toBe(primera.body.codigo);
    expect(otra.body.codigo).not.toBe(mesa.codigo);
    esperarNoDisponible(await verMesa(clienteNuevo(ctx), primera.body.codigo as string));
    esperarNoDisponible(await verMesa(clienteNuevo(ctx), mesa.codigo));
    exigirEstado(
      await verMesa(clienteNuevo(ctx), otra.body.codigo as string),
      200,
      'el código último',
    );
  });

  it('sin Idempotency-Key es 400 y el código no cambia', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const res = await cambiarQr(ctx, esc, mesa, null);
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(JSON.stringify(res.body.campos)).toContain('Idempotency-Key');
    exigirEstado(await verMesa(clienteNuevo(ctx), mesa.codigo), 200, 'el código sigue igual');
  });

  it('una mesa inactiva responde 409 CONFLICTO y su código no cambia', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    await ponerActiva(ctx, esc, mesa, false);
    const res = await cambiarQr(ctx, esc, mesa);
    esperarError(res, 409, 'CONFLICTO');
    await ponerActiva(ctx, esc, mesa, true);
    exigirEstado(
      await verMesa(clienteNuevo(ctx), mesa.codigo),
      200,
      'el mismo código sigue vigente',
    );
  });

  it('una mesa de otra sucursal, de B o inexistente responde 404 y no cambia nada', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const deS2 = await mesaConCodigo(ctx, esc, 'S2');
    const deB = await mesaConCodigo(ctx, esc, 'B1');
    /** El Administrador de A intenta cambiar el QR de `mesaId` por la ruta de `sucursalId`. */
    const comoAdminDeA = (sucursalId: string, mesaId: string) =>
      llamar(ctx, esc.e.A.tokenAdmin, {
        metodo: 'post',
        ruta: `/sucursales/${sucursalId}/mesas/${mesaId}/qr`,
        cabeceras: { 'Idempotency-Key': randomUUID() },
      });

    // Una mesa de S2 por la ruta de S1.
    esperarError(await comoAdminDeA(esc.e.A.S1, deS2.id), 404, 'NO_ENCONTRADO');
    // Una mesa de B por la ruta de S1 de A, y por la ruta de S1 de B.
    const deBPorA = await comoAdminDeA(esc.e.A.S1, deB.id);
    esperarError(deBPorA, 404, 'NO_ENCONTRADO');
    esperarError(await comoAdminDeA(esc.e.B.S1, deB.id), 404, 'NO_ENCONTRADO');
    // Una mesa que no existe.
    const inexistente = randomUUID();
    const sinMesa = await comoAdminDeA(esc.e.A.S1, inexistente);
    esperarError(sinMesa, 404, 'NO_ENCONTRADO');
    // Una mesa de A por la sucursal de B.
    esperarError(await comoAdminDeA(esc.e.B.S1, mesa.id), 404, 'NO_ENCONTRADO');

    // Los tres códigos siguen funcionando.
    for (const m of [mesa, deS2, deB]) {
      exigirEstado(
        await verMesa(clienteNuevo(ctx), m.codigo),
        200,
        `el código de ${m.nombre} sigue igual`,
      );
    }
    // El 404 de una mesa de B es el mismo que el de una inexistente.
    expect(JSON.stringify(deBPorA.body).replace(deB.id, '<id>')).toBe(
      JSON.stringify(sinMesa.body).replace(inexistente, '<id>'),
    );
  });

  it('cambiar el QR no libera ni toca el estado de la mesa y se puede repetir varias veces', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    let anterior = mesa.codigo;
    for (let i = 0; i < 3; i += 1) {
      const res = await cambiarQr(ctx, esc, mesa);
      exigirEstado(res, 201, `cambio ${i + 1}`);
      expect(res.body.codigo).not.toBe(anterior);
      esperarNoDisponible(await verMesa(clienteNuevo(ctx), anterior));
      anterior = res.body.codigo as string;
    }
    exigirEstado(await verMesa(clienteNuevo(ctx), anterior), 200, 'el último código funciona');
    const llamado = await crearOk(clienteNuevo(ctx), anterior, cuerpoLlamarMozo());
    expect(llamado.estado).toBe('PENDIENTE');
  });
});

// ===================================================================================================
// Criterio 10 · mesa inactiva
// ===================================================================================================

describe('criterio 10 · mesa inactiva', () => {
  it('mientras está inactiva su código responde 404 (mesa, llamado nuevo y estado); al reactivarla, el mismo código vuelve', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const cliente = clienteNuevo(ctx);
    const hecho = await crearLlamado(ctx, mesa, cuerpoLlamarMozo(), cliente);

    await ponerActiva(ctx, esc, mesa, false);
    esperarNoDisponible(await verMesa(cliente, mesa.codigo));
    esperarNoDisponible(await enviarLlamado(cliente, mesa.codigo, cuerpoLlamarMozo()));
    esperarNoDisponible(await verEstado(cliente, mesa.codigo, hecho.id));

    await ponerActiva(ctx, esc, mesa, true);
    const vista = await verMesa(cliente, mesa.codigo);
    exigirEstado(vista, 200, 'el mismo código tras reactivar');
    expect(vista.body.mesa).toEqual({ nombre: mesa.nombre });
    exigirEstado(await verEstado(cliente, mesa.codigo, hecho.id), 200, 'el estado tras reactivar');
  });

  it('desactivar y reactivar no cambia el código; la hoja de QR no lista la mesa inactiva y la vuelve a listar igual', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    await ponerActiva(ctx, esc, mesa, false);
    const mientras = await leerHoja(ctx, esc);
    expect(mientras.mesas.some((m) => m.mesaId === mesa.id)).toBe(false);

    await ponerActiva(ctx, esc, mesa, true);
    const despues = await leerHoja(ctx, esc);
    expect(despues.mesas.find((m) => m.mesaId === mesa.id)!.codigo).toBe(mesa.codigo);
  });

  it('el 404 de una mesa inactiva es idéntico al de un código desconocido y al de uno reemplazado', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const reemplazada = await mesaConCodigo(ctx, esc);
    await ponerActiva(ctx, esc, mesa, false);
    exigirEstado(await cambiarQr(ctx, esc, reemplazada), 201, 'cambiar el QR');
    const desconocido = 'Z'.repeat(22);

    const cliente = clienteNuevo(ctx);
    const cuerpos = [
      await verMesa(cliente, mesa.codigo),
      await verMesa(cliente, reemplazada.codigo),
      await verMesa(cliente, desconocido),
    ];
    for (const r of cuerpos) esperarNoDisponible(r);
    await ponerActiva(ctx, esc, mesa, true);
  });
});
