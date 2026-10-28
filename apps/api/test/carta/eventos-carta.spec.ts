// Historia 003, grupo C5 · eventos de la carta (criterios 46, 53 y 54, T26): pruebas del desarrollador (no
// protegidas) con el `PublicadorEnMemoria`. Toda escritura de C1 a C5 publica un solo evento por petición,
// después de confirmar la transacción, y ninguno si se revierte, si es rechazada o si no cambia nada. Que cada
// evento lleve la empresa del contexto y una sala de esa empresa lo prueba el criterio 68 de las pruebas
// protegidas (`referencias-carta.spec.ts`); aquí, además, la forma exacta de cada uno contra los contratos.
import { eventoCartaActualizadaSchema, eventoDisponibilidadSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamiliasService } from '../../src/modulos/carta/familias.service';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  pngValido,
  llamar,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  sembrarBase,
  sesionContrasena,
  unico,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';
import {
  crearGrupo,
  crearLigable,
  crearProducto,
  crearSimple,
  cuerpoCombo,
  cuerpoMenu,
  pedir,
  type Base,
} from './ayudas-combos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let cocinaS1: string;
let base: Base;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = await sesionContrasena(ctx, e.A.base.admin, null);
  cocinaS1 = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
  base = await sembrarBase(ctx, tokenA);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** Los eventos publicados desde el último `limpiar`, ya asentados. */
async function eventos() {
  await asentar();
  return ctx.publicador.eventos();
}

/** Ejecuta `hacer` con el publicador limpio y devuelve lo que publicó. */
async function publicado(hacer: () => Promise<unknown>) {
  await asentar();
  ctx.publicador.limpiar();
  await hacer();
  return eventos();
}

const deEmpresa = (sucursalId: string | null = null) => ({
  empresaId: e.A.empresaId,
  sala: sucursalId === null ? { tipo: 'empresa' } : { tipo: 'sucursal', sucursalId },
  nombre: 'carta.actualizada',
  datos: { sucursalId },
});

describe('criterio 54 · carta.actualizada, uno por petición, después de confirmar', () => {
  // Cada caso: la escritura que cambia algo (con su estado), la misma repetida o una equivalente que no cambia
  // nada, y una variante rechazada.
  interface Caso {
    nombre: string;
    sala: string | null;
    cambia: () => Promise<{ status: number }>;
    estado: number;
    /** Repetir la escritura no cambia nada (los `POST` siempre crean, así que no tienen). */
    noop?: () => Promise<{ status: number }>;
    rechazada: () => Promise<{ status: number }>;
    estadoRechazo: number;
  }

  const casos = async (): Promise<Caso[]> => {
    const estacion = (
      await pedir(ctx, tokenA, 'post', '/carta/estaciones', { nombre: unico('Barra') })
    ).body as { id: string };
    const familia = (
      await pedir(ctx, tokenA, 'post', '/carta/familias', { nombre: unico('Postres') })
    ).body as { id: string };
    const otraFamilia = (
      await pedir(ctx, tokenA, 'post', '/carta/familias', { nombre: unico('Entradas') })
    ).body as { id: string };
    const p1 = await crearSimple(ctx, tokenA, { ...base, familiaId: familia.id });
    const p2 = await crearSimple(ctx, tokenA, { ...base, familiaId: familia.id });
    const grupo = await crearGrupo(ctx, tokenA, [{ nombre: 'Uno' }, { nombre: 'Dos' }]);
    const menuGrupo = await crearGrupo(ctx, tokenA, [{ nombre: 'Sopa' }, { nombre: 'Ensalada' }]);
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [menuGrupo.id] }),
    );
    const aInactivar = await crearSimple(ctx, tokenA, base);
    const idemp = randomUUID();
    const cuerpoIdempotente = { nombre: unico('Idempotente') };
    const uuidInexistente = '7b9a2c3e-0000-4000-8000-0000000000cc';
    const llamada = (
      metodo: 'post' | 'put' | 'patch' | 'delete',
      ruta: string,
      cuerpo?: unknown,
      token = tokenA,
    ) => pedir(ctx, token, metodo, ruta, cuerpo);
    /** Las familias en su orden actual (se lee al llamar: otros casos crean familias). */
    const ordenDeFamilias = async (): Promise<string[]> =>
      ((await pedir(ctx, tokenA, 'get', '/carta/familias')).body as { id: string }[]).map(
        (f) => f.id,
      );

    return [
      {
        nombre: 'POST /carta/estaciones',
        sala: null,
        cambia: () => llamada('post', '/carta/estaciones', { nombre: unico('Parrilla') }),
        estado: 201,
        rechazada: () => llamada('post', '/carta/estaciones', { nombre: '' }),
        estadoRechazo: 400,
      },
      {
        nombre: 'PATCH /carta/estaciones/:id',
        sala: null,
        cambia: () =>
          llamada('patch', `/carta/estaciones/${estacion.id}`, { nombre: unico('Barra 2') }),
        estado: 200,
        noop: () => llamada('patch', `/carta/estaciones/${estacion.id}`, { activa: true }),
        rechazada: () => llamada('patch', `/carta/estaciones/${uuidInexistente}`, { nombre: 'X' }),
        estadoRechazo: 404,
      },
      {
        nombre: 'POST /carta/familias',
        sala: null,
        cambia: () => llamada('post', '/carta/familias', { nombre: unico('Bebidas') }),
        estado: 201,
        rechazada: () => llamada('post', '/carta/familias', { nombre: '' }),
        estadoRechazo: 400,
      },
      {
        nombre: 'PATCH /carta/familias/:id',
        sala: null,
        cambia: () =>
          llamada('patch', `/carta/familias/${familia.id}`, { nombre: unico('Postres 2') }),
        estado: 200,
        noop: () => llamada('patch', `/carta/familias/${familia.id}`, { activa: true }),
        rechazada: () => llamada('patch', `/carta/familias/${uuidInexistente}`, { nombre: 'X' }),
        estadoRechazo: 404,
      },
      {
        nombre: 'PUT /carta/familias/orden',
        sala: null,
        cambia: async () =>
          llamada('put', '/carta/familias/orden', { ids: (await ordenDeFamilias()).reverse() }),
        estado: 200,
        noop: async () => llamada('put', '/carta/familias/orden', { ids: await ordenDeFamilias() }),
        rechazada: () => llamada('put', '/carta/familias/orden', { ids: [uuidInexistente] }),
        estadoRechazo: 400,
      },
      {
        nombre: 'POST /carta/productos',
        sala: null,
        cambia: () =>
          llamada('post', '/carta/productos', {
            tipo: 'SIMPLE',
            nombre: unico('Producto'),
            familiaId: otraFamilia.id,
            precio: '10.00',
            estacionId: estacion.id,
            tipoControlStock: 'UNIDADES',
          }),
        estado: 201,
        rechazada: () =>
          llamada('post', '/carta/productos', {
            tipo: 'SIMPLE',
            nombre: unico('Producto'),
            familiaId: uuidInexistente,
            precio: '10.00',
            estacionId: estacion.id,
            tipoControlStock: 'UNIDADES',
          }),
        estadoRechazo: 422,
      },
      {
        nombre: 'PATCH /carta/productos/:id (varios cambios, un solo evento)',
        sala: null,
        cambia: () =>
          llamada('patch', `/carta/productos/${p1.id}`, {
            nombre: unico('Renombrado'),
            precio: '31.00',
            descripcion: 'Con otra descripción',
            gruposModificadores: [grupo.id],
          }),
        estado: 200,
        noop: () =>
          llamada('patch', `/carta/productos/${p1.id}`, {
            precio: '31.00',
            gruposModificadores: [grupo.id],
          }),
        rechazada: () => llamada('patch', `/carta/productos/${p1.id}`, { precio: '0.00' }),
        estadoRechazo: 400,
      },
      {
        nombre: 'PATCH /carta/productos/:id (desactivar)',
        sala: null,
        cambia: () => llamada('patch', `/carta/productos/${aInactivar.id}`, { activo: false }),
        estado: 200,
        noop: () => llamada('patch', `/carta/productos/${aInactivar.id}`, { activo: false }),
        rechazada: () => llamada('patch', `/carta/productos/${uuidInexistente}`, { activo: false }),
        estadoRechazo: 404,
      },
      {
        nombre: 'PUT /carta/familias/:id/productos/orden',
        sala: null,
        cambia: () =>
          llamada('put', `/carta/familias/${familia.id}/productos/orden`, { ids: [p2.id, p1.id] }),
        estado: 200,
        noop: () =>
          llamada('put', `/carta/familias/${familia.id}/productos/orden`, { ids: [p2.id, p1.id] }),
        rechazada: () =>
          llamada('put', `/carta/familias/${familia.id}/productos/orden`, { ids: [p1.id] }),
        estadoRechazo: 400,
      },
      {
        nombre: 'PUT /carta/productos/:id/foto',
        sala: null,
        cambia: () =>
          llamar(ctx, tokenA, {
            metodo: 'put',
            ruta: `/carta/productos/${p2.id}/foto`,
            binario: { tipo: 'image/png', datos: pngValido() },
          }),
        estado: 200,
        rechazada: () =>
          llamar(ctx, tokenA, {
            metodo: 'put',
            ruta: `/carta/productos/${p2.id}/foto`,
            binario: { tipo: 'image/png', datos: Buffer.from('no es una imagen') },
          }),
        estadoRechazo: 422,
      },
      {
        nombre: 'DELETE /carta/productos/:id/foto',
        sala: null,
        cambia: () => llamada('delete', `/carta/productos/${p2.id}/foto`),
        estado: 204,
        noop: () => llamada('delete', `/carta/productos/${p2.id}/foto`),
        rechazada: () => llamada('delete', `/carta/productos/${uuidInexistente}/foto`),
        estadoRechazo: 404,
      },
      {
        nombre: 'PUT /carta/productos/:id/sucursales/:sucursalId',
        sala: e.A.S1,
        cambia: () =>
          llamada('put', `/carta/productos/${p1.id}/sucursales/${e.A.S1}`, {
            precio: '33.00',
            disponible: true,
          }),
        estado: 200,
        noop: () =>
          llamada('put', `/carta/productos/${p1.id}/sucursales/${e.A.S1}`, {
            precio: '33.00',
            disponible: true,
          }),
        rechazada: () =>
          llamada('put', `/carta/productos/${p1.id}/sucursales/${uuidInexistente}`, {
            precio: '33.00',
            disponible: true,
          }),
        estadoRechazo: 404,
      },
      {
        nombre: 'POST /carta/grupos-modificadores',
        sala: null,
        cambia: () =>
          llamada('post', '/carta/grupos-modificadores', {
            nombre: unico('Grupo'),
            seleccion: 'UNICA',
            obligatorio: true,
            modificadores: [{ nombre: 'A' }],
          }),
        estado: 201,
        rechazada: () =>
          llamada('post', '/carta/grupos-modificadores', { nombre: 'sin modificadores' }),
        estadoRechazo: 400,
      },
      {
        nombre: 'PATCH /carta/grupos-modificadores/:id',
        sala: null,
        cambia: () =>
          llamada('patch', `/carta/grupos-modificadores/${grupo.id}`, {
            modificadores: [
              { id: grupo.modificadores[0]!.id, nombre: 'Uno', precioExtra: '1.50' },
              { id: grupo.modificadores[1]!.id, nombre: 'Dos' },
            ],
          }),
        estado: 200,
        noop: () =>
          llamada('patch', `/carta/grupos-modificadores/${grupo.id}`, {
            modificadores: [
              { id: grupo.modificadores[0]!.id, nombre: 'Uno', precioExtra: '1.50' },
              { id: grupo.modificadores[1]!.id, nombre: 'Dos' },
            ],
          }),
        rechazada: () =>
          llamada('patch', `/carta/grupos-modificadores/${uuidInexistente}`, { nombre: 'X' }),
        estadoRechazo: 404,
      },
      {
        nombre: 'PUT /carta/sucursal/menu-del-dia/:productoId',
        sala: e.A.S1,
        cambia: () =>
          llamada(
            'put',
            `/carta/sucursal/menu-del-dia/${menu.id}`,
            { opciones: [menuGrupo.modificadores[0]!.id] },
            cocinaS1,
          ),
        estado: 200,
        noop: () =>
          llamada(
            'put',
            `/carta/sucursal/menu-del-dia/${menu.id}`,
            { opciones: [menuGrupo.modificadores[0]!.id] },
            cocinaS1,
          ),
        rechazada: () =>
          llamada(
            'put',
            `/carta/sucursal/menu-del-dia/${menu.id}`,
            { opciones: [uuidInexistente] },
            cocinaS1,
          ),
        estadoRechazo: 422,
      },
      {
        nombre: 'POST con Idempotency-Key (el reenvío no publica)',
        sala: null,
        cambia: () =>
          llamar(ctx, tokenA, {
            metodo: 'post',
            ruta: '/carta/familias',
            cuerpo: cuerpoIdempotente,
            cabeceras: { 'Idempotency-Key': idemp },
          }),
        estado: 201,
        noop: () =>
          llamar(ctx, tokenA, {
            metodo: 'post',
            ruta: '/carta/familias',
            cuerpo: cuerpoIdempotente,
            cabeceras: { 'Idempotency-Key': idemp },
          }),
        rechazada: () => llamada('post', '/carta/familias', {}),
        estadoRechazo: 400,
      },
    ];
  };

  let lista: Promise<Caso[]> | undefined;
  const losCasos = () => (lista ??= casos());

  it('cada escritura que cambia algo publica exactamente un carta.actualizada con la sala y los datos del contrato', async () => {
    for (const caso of await losCasos()) {
      let respuesta: { status: number } | undefined;
      const publicados = await publicado(async () => {
        respuesta = await caso.cambia();
      });
      expect(respuesta!.status, caso.nombre).toBe(caso.estado);
      expect(publicados, caso.nombre).toEqual([deEmpresa(caso.sala)]);
      expect(eventoCartaActualizadaSchema.safeParse(publicados[0]).success, caso.nombre).toBe(true);
    }
  });

  it('repetir la escritura sin cambiar nada (o reenviar con la misma clave) no publica nada', async () => {
    for (const caso of await losCasos()) {
      if (caso.noop === undefined) continue;
      let respuesta: { status: number } | undefined;
      const publicados = await publicado(async () => {
        respuesta = await caso.noop!();
      });
      expect(respuesta!.status, caso.nombre).toBeLessThan(300);
      expect(publicados, caso.nombre).toEqual([]);
    }
  });

  it('una escritura rechazada (400, 404 o 422) no publica nada', async () => {
    for (const caso of await losCasos()) {
      let respuesta: { status: number } | undefined;
      const publicados = await publicado(async () => {
        respuesta = await caso.rechazada();
      });
      expect(respuesta!.status, caso.nombre).toBe(caso.estadoRechazo);
      expect(publicados, caso.nombre).toEqual([]);
    }
  });

  it('un cambio de tipo confirmado publica un solo evento; sin confirmar (409) ninguno', async () => {
    const componente = await crearLigable(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: componente.id, cantidad: 1 }] }),
    );
    const aSimple = { tipo: 'SIMPLE', estacionId: base.estacionId };
    const sinConfirmar = await publicado(async () => {
      esperarError(
        await pedir(ctx, tokenA, 'patch', `/carta/productos/${combo.id}`, aSimple),
        409,
        'CONFIRMACION_REQUERIDA',
      );
    });
    expect(sinConfirmar).toEqual([]);
    const confirmado = await publicado(async () => {
      exigirEstado(
        await pedir(ctx, tokenA, 'patch', `/carta/productos/${combo.id}`, {
          ...aSimple,
          confirmarPerdida: true,
        }),
        200,
        'cambiar a simple',
      );
    });
    expect(confirmado).toEqual([deEmpresa(null)]);
  });

  it('si la transacción se revierte después de registrar el evento, no se publica nada', async () => {
    const publicados = await publicado(async () => {
      await expect(
        ctx.app.get(ContextoEmpresa).ejecutar(
          e.A.empresaId,
          async () => {
            await ctx.app
              .get(FamiliasService, { strict: false })
              .crear({ nombre: unico('Revertida') });
            throw new Error('falla antes de confirmar');
          },
          { actor: { sistema: 'prueba' } },
        ),
      ).rejects.toThrow('falla antes de confirmar');
    });
    expect(publicados).toEqual([]);
    const filas = await admin.query(
      `SELECT count(*)::int AS n FROM familia WHERE nombre ILIKE 'Revertida%'`,
    );
    expect(filas.rows[0].n).toBe(0);
  });

  it('el evento se publica después de confirmar: cuando el cliente recibe la respuesta, la fila ya es visible', async () => {
    const visibles: boolean[] = [];
    const original = ctx.publicador.publicar.bind(ctx.publicador);
    const espia = vi.spyOn(ctx.publicador, 'publicar').mockImplementation(async (evento) => {
      const nombre = (evento.datos as { sucursalId: string | null }).sucursalId;
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM familia WHERE empresa_id = $1 AND nombre LIKE 'Visible %'`,
        [evento.empresaId],
      );
      visibles.push(rows[0].n === 1 && nombre === null);
      await original(evento);
    });
    try {
      exigirEstado(
        await pedir(ctx, tokenA, 'post', '/carta/familias', { nombre: unico('Visible') }),
        201,
        'crear',
      );
      await asentar();
    } finally {
      espia.mockRestore();
    }
    expect(visibles).toEqual([true]);
  });
});

describe('criterio 46 · carta.disponibilidad', () => {
  it('marcar, cambiar y reactivar publican uno por cambio real, con los datos del contrato', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const marcar = (cuerpo: unknown) =>
      pedir(ctx, cocinaS1, 'put', `/carta/sucursal/agotados/${producto.id}`, cuerpo);
    const evento = (agotado: boolean, hasta: string | null, origen: string | null) => ({
      empresaId: e.A.empresaId,
      sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
      nombre: 'carta.disponibilidad',
      datos: { sucursalId: e.A.S1, productoId: producto.id, agotado, hasta, origen },
    });
    const primero = await publicado(() => marcar({}));
    expect(primero).toEqual([evento(true, 'FIN_DEL_DIA', 'MANUAL')]);
    expect(eventoDisponibilidadSchema.safeParse(primero[0]).success).toBe(true);
    expect(await publicado(() => marcar({}))).toEqual([]);
    expect(await publicado(() => marcar({ hasta: 'REACTIVAR' }))).toEqual([
      evento(true, 'REACTIVAR', 'MANUAL'),
    ]);
    const reactivado = await publicado(() =>
      pedir(ctx, cocinaS1, 'delete', `/carta/sucursal/agotados/${producto.id}`),
    );
    expect(reactivado).toEqual([evento(false, null, null)]);
    expect(eventoDisponibilidadSchema.safeParse(reactivado[0]).success).toBe(true);
    expect(
      await publicado(() =>
        pedir(ctx, cocinaS1, 'delete', `/carta/sucursal/agotados/${producto.id}`),
      ),
    ).toEqual([]);
  });

  it('un agotado no publica carta.actualizada ni al revés (cada evento tiene su causa)', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const agotado = await publicado(() =>
      pedir(ctx, cocinaS1, 'put', `/carta/sucursal/agotados/${producto.id}`, {}),
    );
    expect(agotado.map((x) => x.nombre)).toEqual(['carta.disponibilidad']);
    const editado = await publicado(() =>
      pedir(ctx, tokenA, 'patch', `/carta/productos/${producto.id}`, { precio: '41.00' }),
    );
    expect(editado.map((x) => x.nombre)).toEqual(['carta.actualizada']);
  });

  it('no hay eventos de otras empresas: B no recibe lo de A', async () => {
    const productoB = await crearSimple(
      ctx,
      e.B.tokenAdmin,
      await sembrarBase(ctx, e.B.tokenAdmin),
    );
    const publicados = await publicado(async () => {
      const producto = await crearSimple(ctx, tokenA, base);
      exigirEstado(
        await pedir(ctx, cocinaS1, 'put', `/carta/sucursal/agotados/${producto.id}`, {}),
        200,
        'agotar',
      );
    });
    expect(publicados.length).toBeGreaterThan(0);
    expect(publicados.every((x) => x.empresaId === e.A.empresaId)).toBe(true);
    expect(JSON.stringify(publicados)).not.toContain(productoB.id);
  });
});
