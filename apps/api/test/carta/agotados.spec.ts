// Historia 003, grupo C5 · agotados (86) de la sucursal (criterios 39 a 44 y 53): pruebas del desarrollador (no
// protegidas) con el reloj de la API. Quién puede marcar y reactivar (los 403 por rol), el aislamiento entre
// empresas y la concurrencia con el pool los cubren las pruebas protegidas `permisos-carta.spec.ts`,
// `cajero-carta.spec.ts`, `rls-carta.spec.ts` y `referencias-carta.spec.ts`. Aquí: la forma de la respuesta, el
// no-op, la vigencia con la hora de corte, la auditoría con su antes y su después, el evento, el origen
// `SIN_STOCK` de la sección 6 y la trazabilidad de la fila.
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { CartaDisponibilidadService } from '../../src/modulos/carta';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  sembrarBase,
  sesionContrasena,
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
let adminS1: string;
let adminS2: string;
let cocinaS1: string;
let tokenB: string;
let base: Base;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  await abrirSesiones();
  base = await sembrarBase(ctx, tokenA);
});

let relojMovido = false;

async function abrirSesiones(): Promise<void> {
  tokenA = await sesionContrasena(ctx, e.A.base.admin, null);
  adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
  adminS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
  cocinaS1 = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
  tokenB = await sesionContrasena(ctx, e.B.base.admin, null);
}

async function mover(instante: string): Promise<void> {
  ctx.reloj.fijar(instante);
  relojMovido = true;
  await abrirSesiones();
}

beforeEach(async () => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO); // lunes 2 de noviembre de 2026, 10:00 (día operativo 2026-11-02)
  if (relojMovido) {
    relojMovido = false;
    await abrirSesiones();
  }
  ctx.publicador.limpiar();
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const RUTA = '/carta/sucursal/agotados';
const HOY = '2026-11-02';

const marcar = (productoId: string, cuerpo: unknown = {}, token = cocinaS1) =>
  pedir(ctx, token, 'put', `${RUTA}/${productoId}`, cuerpo);
const reactivar = (productoId: string, token = cocinaS1) =>
  pedir(ctx, token, 'delete', `${RUTA}/${productoId}`);

const filas = async (productoId: string, sucursalId?: string) =>
  (
    await admin.query(
      `SELECT * FROM producto_agotado WHERE producto_id = $1 AND ($2::uuid IS NULL OR sucursal_id = $2)
        ORDER BY sucursal_id`,
      [productoId, sucursalId ?? null],
    )
  ).rows;
const auditoriaDe = (productoId: string, accion: string) =>
  auditoriaCarta(admin, e.A.empresaId, { accion, entidadId: productoId });
const eventosDisponibilidad = () =>
  ctx.publicador.eventos().filter((x) => x.nombre === 'carta.disponibilidad');

interface ProductoDeVista {
  id: string;
  agotado: { desde: string; hasta: string; origen: string } | null;
  vendible: boolean;
  motivo: string | null;
}
async function enLaVista(
  productoId: string,
  token = adminS1,
): Promise<ProductoDeVista | undefined> {
  const res = await pedir(ctx, token, 'get', '/carta/sucursal');
  exigirEstado(res, 200, 'la vista');
  return (res.body.familias as { productos: ProductoDeVista[] }[])
    .flatMap((f) => f.productos)
    .find((p) => p.id === productoId);
}

describe('criterio 39 · marcar', () => {
  it('por defecto es FIN_DEL_DIA: responde la fila con la sucursal activa, el día operativo y origen MANUAL', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const res = await marcar(producto.id);
    exigirEstado(res, 200, 'marcar');
    expect(res.body).toEqual({
      productoId: producto.id,
      sucursalId: e.A.S1,
      desde: '2026-11-02T15:00:00.000Z',
      hasta: 'FIN_DEL_DIA',
      diaOperativo: HOY,
      origen: 'MANUAL',
    });
    const fila = (await filas(producto.id))[0];
    expect(fila).toMatchObject({ sucursal_id: e.A.S1, hasta: 'FIN_DEL_DIA', origen: 'MANUAL' });
    expect(fila.empresa_id).toBe(e.A.empresaId);
  });

  it('acepta hasta REACTIVAR y rechaza otro valor o un campo desconocido', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const res = await marcar(producto.id, { hasta: 'REACTIVAR' });
    exigirEstado(res, 200, 'hasta que lo reactive');
    expect(res.body).toMatchObject({ hasta: 'REACTIVAR', diaOperativo: HOY });
    esperarError(await marcar(producto.id, { hasta: 'MAÑANA' }), 400, 'DATOS_INVALIDOS');
    esperarError(await marcar(producto.id, { origen: 'SIN_STOCK' }), 400, 'DATOS_INVALIDOS');
    esperarError(await marcar(producto.id, { sucursalId: e.A.S2 }), 400, 'DATOS_INVALIDOS');
  });

  it('vale para cualquier producto: simple, uno que no se vende solo, combo y menú del día', async () => {
    const ligable = await crearLigable(ctx, tokenA, base);
    const grupo = await crearGrupo(ctx, tokenA, [{ nombre: 'Papas' }]);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: ligable.id, cantidad: 1 }] }),
    );
    const menu = await crearProducto(
      ctx,
      tokenA,
      cuerpoMenu(base, { gruposModificadores: [grupo.id] }),
    );
    const simple = await crearSimple(ctx, tokenA, base);
    for (const producto of [simple, ligable, combo, menu]) {
      exigirEstado(await marcar(producto.id), 200, `marcar ${String(producto.tipo)}`);
    }
  });

  it('un producto desactivado también se puede marcar', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/productos/${producto.id}`, { activo: false }),
      200,
      'desactivar',
    );
    exigirEstado(await marcar(producto.id), 200, 'marcar el desactivado');
  });

  it('un producto de otra empresa, uno inexistente y un id que no es UUID responden como se espera', async () => {
    const deB = await crearSimple(ctx, tokenB, await sembrarBase(ctx, tokenB));
    const inexistente = '7b9a2c3e-0000-4000-8000-000000000001';
    const a = await marcar(deB.id);
    const b = await marcar(inexistente);
    esperarError(a, 404, 'NO_ENCONTRADO');
    esperarError(b, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
    esperarError(await marcar('no-es-uuid'), 400, 'DATOS_INVALIDOS');
    expect(await filas(deB.id)).toEqual([]);
    expect(eventosDisponibilidad()).toEqual([]);
  });

  it('deja una fila de auditoría con el cocinero como autor, la sucursal, el antes y el después', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar');
    const [fila, ...otras] = await auditoriaDe(producto.id, 'marcar_agotado');
    expect(otras).toEqual([]);
    expect(fila).toMatchObject({
      actor_usuario_id: e.A.cocina.id,
      sucursal_id: e.A.S1,
      entidad: 'producto',
      entidad_id: producto.id,
      detalle: {
        antes: null,
        despues: { hasta: 'FIN_DEL_DIA', origen: 'MANUAL', diaOperativo: HOY },
      },
    });
  });

  it('la fila queda con la trazabilidad de quien la marcó (criterio 63)', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar');
    const fila = (await filas(producto.id))[0];
    expect(fila.creado_por_usuario_id).toBe(e.A.cocina.id);
    expect(fila.actualizado_por_usuario_id).toBe(e.A.cocina.id);
    // Otro la cambia: el último autor es el nuevo y el creador no cambia.
    exigirEstado(await marcar(producto.id, { hasta: 'REACTIVAR' }, adminS1), 200, 'cambiar');
    const despues = (await filas(producto.id))[0];
    expect(despues.creado_por_usuario_id).toBe(e.A.cocina.id);
    expect(despues.actualizado_por_usuario_id).toBe(e.A.base.admin.id);
  });
});

describe('criterio 40 · repetir', () => {
  it('el mismo hasta con el agotado vigente responde lo mismo, sin escribir, auditar ni publicar', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const primera = await marcar(producto.id);
    exigirEstado(primera, 200, 'primera');
    await asentar();
    ctx.publicador.limpiar();
    const antes = await filas(producto.id);
    ctx.reloj.avanzar(60_000);
    const segunda = await marcar(producto.id);
    exigirEstado(segunda, 200, 'repetir');
    expect(segunda.body).toEqual(primera.body);
    expect(await filas(producto.id)).toEqual(antes);
    expect(await auditoriaDe(producto.id, 'marcar_agotado')).toHaveLength(1);
    await asentar();
    expect(eventosDisponibilidad()).toEqual([]);
  });

  it('otro hasta lo cambia, con auditoría (antes y después) y evento', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar');
    await asentar();
    ctx.publicador.limpiar();
    // El reloj de la API es manual: sin avanzarlo las dos filas de auditoría comparten `ocurrido_en` y el orden
    // por (instante, id) dependería del uuid al azar.
    ctx.reloj.avanzar(60_000);
    const res = await marcar(producto.id, { hasta: 'REACTIVAR' });
    exigirEstado(res, 200, 'cambiar el hasta');
    expect(res.body.hasta).toBe('REACTIVAR');
    expect(await filas(producto.id)).toHaveLength(1);
    const auditoria = await auditoriaDe(producto.id, 'marcar_agotado');
    expect(auditoria).toHaveLength(2);
    expect(auditoria[1]!.detalle).toEqual({
      antes: { hasta: 'FIN_DEL_DIA', origen: 'MANUAL', diaOperativo: HOY },
      despues: { hasta: 'REACTIVAR', origen: 'MANUAL', diaOperativo: HOY },
    });
    await asentar();
    expect(eventosDisponibilidad()).toHaveLength(1);
  });

  it('si el agotado anterior ya había vencido, marcarlo es un agotado nuevo (sin antes en la auditoría)', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar hoy');
    await mover('2026-11-03T10:00:00-05:00');
    ctx.publicador.limpiar();
    const res = await marcar(producto.id);
    exigirEstado(res, 200, 'marcar al día siguiente');
    expect(res.body).toMatchObject({
      diaOperativo: '2026-11-03',
      desde: '2026-11-03T15:00:00.000Z',
    });
    const auditoria = await auditoriaDe(producto.id, 'marcar_agotado');
    expect(auditoria).toHaveLength(2);
    expect(auditoria[1]!.detalle).toMatchObject({ antes: null });
    await asentar();
    expect(eventosDisponibilidad()).toHaveLength(1);
  });

  it('dos cocineros a la vez: los dos terminan bien, gana uno de los dos hasta y queda una fila', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    for (let i = 0; i < 4; i++) {
      const producto2 = await crearSimple(ctx, tokenA, base);
      const [a, b] = await Promise.all([
        marcar(producto2.id, { hasta: 'FIN_DEL_DIA' }),
        marcar(producto2.id, { hasta: 'REACTIVAR' }, adminS1),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const guardadas = await filas(producto2.id);
      expect(guardadas).toHaveLength(1);
      expect(['FIN_DEL_DIA', 'REACTIVAR']).toContain(guardadas[0].hasta);
    }
    expect(await filas(producto.id)).toEqual([]);
  });
});

describe('criterio 41 · reactivar', () => {
  it('borra el agotado vigente, responde 204, audita con el antes y publica el evento', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id, { hasta: 'REACTIVAR' }), 200, 'marcar');
    await asentar();
    ctx.publicador.limpiar();
    const res = await reactivar(producto.id);
    exigirEstado(res, 204, 'reactivar');
    expect(await filas(producto.id)).toEqual([]);
    const [fila] = await auditoriaDe(producto.id, 'reactivar_agotado');
    expect(fila).toMatchObject({
      actor_usuario_id: e.A.cocina.id,
      sucursal_id: e.A.S1,
      detalle: {
        antes: { hasta: 'REACTIVAR', origen: 'MANUAL', diaOperativo: HOY },
        despues: null,
      },
    });
    await asentar();
    expect(eventosDisponibilidad()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        nombre: 'carta.disponibilidad',
        datos: {
          sucursalId: e.A.S1,
          productoId: producto.id,
          agotado: false,
          hasta: null,
          origen: null,
        },
      },
    ]);
  });

  it('si no estaba agotado, responde 204 sin auditoría ni evento', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await reactivar(producto.id), 204, 'reactivar sin agotado');
    expect(await auditoriaDe(producto.id, 'reactivar_agotado')).toEqual([]);
    await asentar();
    expect(eventosDisponibilidad()).toEqual([]);
  });

  it('si el agotado ya había vencido, borra la fila vencida sin auditar ni publicar', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar hoy');
    await mover('2026-11-03T10:00:00-05:00');
    ctx.publicador.limpiar();
    exigirEstado(await reactivar(producto.id), 204, 'reactivar el vencido');
    expect(await filas(producto.id)).toEqual([]);
    expect(await auditoriaDe(producto.id, 'reactivar_agotado')).toEqual([]);
    await asentar();
    expect(eventosDisponibilidad()).toEqual([]);
  });

  it('un producto de otra empresa o inexistente responde 404 igual', async () => {
    const deB = await crearSimple(ctx, tokenB, await sembrarBase(ctx, tokenB));
    const a = await reactivar(deB.id);
    const b = await reactivar('7b9a2c3e-0000-4000-8000-000000000002');
    esperarError(a, 404, 'NO_ENCONTRADO');
    esperarError(b, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
  });
});

describe('criterio 42 · solo en su sucursal', () => {
  it('marcar y reactivar en S1 no cambia S2, y viceversa', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar en S1');
    expect((await enLaVista(producto.id, adminS1))?.agotado).not.toBeNull();
    expect((await enLaVista(producto.id, adminS2))?.agotado).toBeNull();
    expect((await enLaVista(producto.id, adminS2))?.vendible).toBe(true);
    exigirEstado(await marcar(producto.id, {}, adminS2), 200, 'marcar en S2');
    exigirEstado(await reactivar(producto.id), 204, 'reactivar en S1');
    expect((await enLaVista(producto.id, adminS1))?.agotado).toBeNull();
    expect((await enLaVista(producto.id, adminS2))?.agotado).not.toBeNull();
    expect((await filas(producto.id)).map((f) => f.sucursal_id)).toEqual([e.A.S2]);
  });
});

describe('criterio 44 · vigencia con la hora de corte 05:00', () => {
  const ESTADO = async (productoId: string) => (await enLaVista(productoId))?.agotado !== null;

  it('marcado el 3 a las 21:00 (día operativo 3): sigue agotado a las 04:59 del 4 y deja de estarlo a las 05:00', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    await mover('2026-11-03T21:00:00-05:00');
    const res = await marcar(producto.id);
    expect(res.body).toMatchObject({ diaOperativo: '2026-11-03' });
    await mover('2026-11-04T04:59:00-05:00');
    expect(await ESTADO(producto.id)).toBe(true);
    await mover('2026-11-04T05:00:00-05:00');
    expect(await ESTADO(producto.id)).toBe(false);
  });

  it('marcado el 4 a las 02:00 (día operativo 3): deja de estarlo a las 05:00 del 4', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    await mover('2026-11-04T02:00:00-05:00');
    const res = await marcar(producto.id);
    expect(res.body).toMatchObject({ diaOperativo: '2026-11-03' });
    await mover('2026-11-04T04:59:00-05:00');
    expect(await ESTADO(producto.id)).toBe(true);
    await mover('2026-11-04T05:00:00-05:00');
    expect(await ESTADO(producto.id)).toBe(false);
  });

  it('hasta REACTIVAR vale días después, hasta el DELETE', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id, { hasta: 'REACTIVAR' }), 200, 'marcar');
    await mover('2026-11-20T12:00:00-05:00');
    expect(await ESTADO(producto.id)).toBe(true);
    exigirEstado(await reactivar(producto.id), 204, 'reactivar');
    expect(await ESTADO(producto.id)).toBe(false);
  });

  it('usa la hora de corte de cada sucursal (S2 con corte a medianoche)', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S2}`, { horaCorte: '00:00' }),
      200,
      'corte de S2',
    );
    try {
      await mover('2026-11-03T21:00:00-05:00');
      exigirEstado(await marcar(producto.id, {}, adminS1), 200, 'marcar en S1');
      exigirEstado(await marcar(producto.id, {}, adminS2), 200, 'marcar en S2');
      await mover('2026-11-04T01:00:00-05:00');
      // En S1 (corte 05:00) sigue siendo el día 3; en S2 (corte 00:00) ya es el 4.
      expect((await enLaVista(producto.id, adminS1))?.agotado).not.toBeNull();
      expect((await enLaVista(producto.id, adminS2))?.agotado).toBeNull();
    } finally {
      exigirEstado(
        await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S2}`, { horaCorte: '05:00' }),
        200,
        'restaurar el corte',
      );
    }
  });

  it('GET /carta/productos/:id/sucursales dice en `agotado` si hay un agotado vigente en cada sucursal', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    exigirEstado(await marcar(producto.id), 200, 'marcar en S1');
    const lista = await pedir(ctx, tokenA, 'get', `/carta/productos/${producto.id}/sucursales`);
    exigirEstado(lista, 200, 'ajustes por sucursal');
    const porSucursal = Object.fromEntries(
      (lista.body as { sucursalId: string; agotado: boolean }[]).map((x) => [
        x.sucursalId,
        x.agotado,
      ]),
    );
    expect(porSucursal[e.A.S1]).toBe(true);
    expect(porSucursal[e.A.S2]).toBe(false);
    await mover('2026-11-03T05:00:00-05:00');
    const despues = await pedir(ctx, tokenA, 'get', `/carta/productos/${producto.id}/sucursales`);
    expect((despues.body as { agotado: boolean }[]).every((x) => !x.agotado)).toBe(true);
    // El PUT del ajuste también responde `agotado` con el estado real.
    exigirEstado(await marcar(producto.id), 200, 'marcar de nuevo');
    const ajuste = await pedir(
      ctx,
      tokenA,
      'put',
      `/carta/productos/${producto.id}/sucursales/${e.A.S1}`,
      { precio: null, disponible: true },
    );
    expect(ajuste.body.agotado).toBe(true);
  });
});

describe('criterio 46 · el evento carta.disponibilidad', () => {
  it('marcar publica un evento en la sala de la sucursal con la empresa, solo después de confirmar', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await marcar(producto.id, { hasta: 'REACTIVAR' }), 200, 'marcar');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        nombre: 'carta.disponibilidad',
        datos: {
          sucursalId: e.A.S1,
          productoId: producto.id,
          agotado: true,
          hasta: 'REACTIVAR',
          origen: 'MANUAL',
        },
      },
    ]);
  });

  it('un rechazo (404, 400 o 403) no publica nada', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    await asentar();
    ctx.publicador.limpiar();
    const mozo = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
    esperarError(await marcar(producto.id, {}, mozo), 403, 'PROHIBIDO');
    esperarError(await marcar(producto.id, { hasta: 'X' }), 400, 'DATOS_INVALIDOS');
    esperarError(await marcar('7b9a2c3e-0000-4000-8000-000000000003'), 404, 'NO_ENCONTRADO');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});

describe('criterio 53 · agotado del sistema (CartaDisponibilidadService)', () => {
  const comoSistema = <T>(fn: (servicio: CartaDisponibilidadService) => Promise<T>): Promise<T> =>
    ctx.app
      .get(ContextoEmpresa)
      .ejecutar(
        e.A.empresaId,
        () => fn(ctx.app.get(CartaDisponibilidadService, { strict: false })),
        { actor: { sistema: 'inventario' } },
      );

  it('marcarAgotado con origen SIN_STOCK y reactivar hacen lo mismo que la API, con el sistema como autor', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    const marcado = await comoSistema((s) =>
      s.marcarAgotado({
        sucursalId: e.A.S2,
        productoId: producto.id,
        hasta: 'REACTIVAR',
        origen: 'SIN_STOCK',
      }),
    );
    expect(marcado).toMatchObject({
      productoId: producto.id,
      sucursalId: e.A.S2,
      hasta: 'REACTIVAR',
      origen: 'SIN_STOCK',
    });
    const [fila] = await auditoriaDe(producto.id, 'marcar_agotado');
    expect(fila).toMatchObject({
      actor_sistema: 'inventario',
      actor_usuario_id: null,
      sucursal_id: e.A.S2,
    });
    await asentar();
    expect(eventosDisponibilidad()).toMatchObject([
      {
        sala: { tipo: 'sucursal', sucursalId: e.A.S2 },
        datos: { agotado: true, hasta: 'REACTIVAR', origen: 'SIN_STOCK' },
      },
    ]);
    expect((await enLaVista(producto.id, adminS2))?.agotado).toMatchObject({ origen: 'SIN_STOCK' });

    // Lo mismo, sin cambios: no-op.
    ctx.publicador.limpiar();
    await comoSistema((s) =>
      s.marcarAgotado({
        sucursalId: e.A.S2,
        productoId: producto.id,
        hasta: 'REACTIVAR',
        origen: 'SIN_STOCK',
      }),
    );
    await asentar();
    expect(eventosDisponibilidad()).toEqual([]);
    expect(await auditoriaDe(producto.id, 'marcar_agotado')).toHaveLength(1);

    await comoSistema((s) => s.reactivar({ sucursalId: e.A.S2, productoId: producto.id }));
    expect(await filas(producto.id)).toEqual([]);
    expect(await auditoriaDe(producto.id, 'reactivar_agotado')).toHaveLength(1);
    await asentar();
    expect(eventosDisponibilidad()).toHaveLength(1);
  });

  it('una sucursal o un producto de otra empresa se tratan como inexistentes y no se escribe nada', async () => {
    const deB = await crearSimple(ctx, tokenB, await sembrarBase(ctx, tokenB));
    const propio = await crearSimple(ctx, tokenA, base);
    await expect(
      comoSistema((s) =>
        s.marcarAgotado({
          sucursalId: e.A.S1,
          productoId: deB.id,
          hasta: 'FIN_DEL_DIA',
          origen: 'MANUAL',
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    await expect(
      comoSistema((s) =>
        s.marcarAgotado({
          sucursalId: e.B.S1,
          productoId: propio.id,
          hasta: 'FIN_DEL_DIA',
          origen: 'MANUAL',
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(await filas(deB.id)).toEqual([]);
    expect(await filas(propio.id)).toEqual([]);
  });

  it('si la transacción se revierte después de marcar, no queda la fila, la auditoría ni el evento', async () => {
    const producto = await crearSimple(ctx, tokenA, base);
    await asentar();
    ctx.publicador.limpiar();
    await expect(
      comoSistema(async (s) => {
        await s.marcarAgotado({
          sucursalId: e.A.S1,
          productoId: producto.id,
          hasta: 'FIN_DEL_DIA',
          origen: 'SIN_STOCK',
        });
        throw new Error('falla posterior');
      }),
    ).rejects.toThrow('falla posterior');
    expect(await filas(producto.id)).toEqual([]);
    expect(await auditoriaDe(producto.id, 'marcar_agotado')).toEqual([]);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});
