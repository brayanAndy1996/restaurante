// Historia 003, grupo C4 · menú del día de la sucursal (criterios 34 a 38): pruebas del desarrollador (no
// protegidas) con el reloj de la API. Quién puede armar el menú (y los 403 por rol) lo cubren las pruebas
// protegidas `permisos-carta.spec.ts` y `cajero-carta.spec.ts`; el aislamiento, `referencias-carta.spec.ts`.
// Aquí: la consulta por día, el armado, el cambio de día a la hora de corte, el armado de la víspera, cada
// sucursal con sus opciones y su día operativo, los 422, el no-op y la auditoría.
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  instantaneaCarta,
  unaFila,
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
  type GrupoCreado,
  type ProductoCreado,
} from './ayudas-combos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let adminS1: string;
let adminS2: string;
let cocinaS1: string;
let base: Base;

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  await abrirSesiones();
  base = await sembrarBase(ctx, tokenA);
});

let relojMovido = false;

/** Abre las sesiones de la prueba con el reloj donde esté (las sesiones vencen si el reloj salta un día). */
async function abrirSesiones(): Promise<void> {
  tokenA = await sesionContrasena(ctx, e.A.base.admin, null);
  adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
  adminS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
  cocinaS1 = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
}

/** Mueve el reloj a otro instante y vuelve a abrir las sesiones. */
async function mover(instante: string): Promise<void> {
  ctx.reloj.fijar(instante);
  relojMovido = true;
  await abrirSesiones();
}

beforeEach(async () => {
  // Lunes 2 de noviembre de 2026, 10:00 (día operativo 2026-11-02).
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
  if (relojMovido) {
    relojMovido = false;
    await abrirSesiones();
  }
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const RUTA = '/carta/sucursal/menu-del-dia';
const HOY = '2026-11-02';
const AYER = '2026-11-01';
const MANANA = '2026-11-03';

interface Opcion {
  modificadorId: string;
  nombre: string;
  precioExtra: string;
  producto: { id: string; nombre: string } | null;
  elegida: boolean;
  disponible: boolean;
}
interface MenuRespuesta {
  productoId: string;
  nombre: string;
  precio: string | null;
  dia: string;
  grupos: {
    id: string;
    nombre: string;
    minimo: number;
    maximo: number;
    opciones: Opcion[];
  }[];
}

/** Un menú del día de referencia (criterio 57): Entrada y Segundo con sus platos candidatos. */
interface Menu {
  producto: ProductoCreado;
  entrada: GrupoCreado;
  segundo: GrupoCreado;
  sopaDelDia: ProductoCreado;
  ajiDeGallina: ProductoCreado;
  /** Ids de modificadores por nombre. */
  op: Record<'papa' | 'sopa' | 'aji' | 'lomo', string>;
}

async function nuevoMenu(extra: Record<string, unknown> = {}): Promise<Menu> {
  const sopaDelDia = await crearLigable(ctx, tokenA, base, { nombre: unico('Sopa del día') });
  const ajiDeGallina = await crearLigable(ctx, tokenA, base, { nombre: unico('Ají de gallina') });
  const entrada = await crearGrupo(ctx, tokenA, [
    { nombre: 'Papa a la huancaína' },
    { nombre: 'Sopa', productoId: sopaDelDia.id },
  ]);
  const segundo = await crearGrupo(ctx, tokenA, [
    { nombre: 'Ají de gallina', productoId: ajiDeGallina.id },
    { nombre: 'Lomo saltado', precioExtra: '5.00' },
  ]);
  const producto = await crearProducto(
    ctx,
    tokenA,
    cuerpoMenu(base, { gruposModificadores: [entrada.id, segundo.id], ...extra }),
  );
  return {
    producto,
    entrada,
    segundo,
    sopaDelDia,
    ajiDeGallina,
    op: {
      papa: entrada.modificadores[0]!.id,
      sopa: entrada.modificadores[1]!.id,
      aji: segundo.modificadores[0]!.id,
      lomo: segundo.modificadores[1]!.id,
    },
  };
}

const consultar = (token = adminS1, dia?: string) =>
  pedir(ctx, token, 'get', dia === undefined ? RUTA : `${RUTA}?dia=${dia}`);
const armar = (menu: { producto: { id: string } }, cuerpo: unknown, token = adminS1) =>
  pedir(ctx, token, 'put', `${RUTA}/${menu.producto.id}`, cuerpo);
const elMenu = async (menu: Menu, token = adminS1, dia?: string): Promise<MenuRespuesta> => {
  const res = await consultar(token, dia);
  exigirEstado(res, 200, 'consultar el menú');
  const encontrado = (res.body as MenuRespuesta[]).find((m) => m.productoId === menu.producto.id);
  if (encontrado === undefined) throw new Error('El menú no aparece en la consulta');
  return encontrado;
};
const elegidas = (m: MenuRespuesta): string[] =>
  m.grupos.flatMap((g) => g.opciones.filter((o) => o.elegida).map((o) => o.modificadorId)).sort();
const filasDelDia = async (menu: Menu, sucursalId: string, dia: string): Promise<string[]> =>
  (
    await admin.query(
      `SELECT modificador_id FROM menu_del_dia_opcion
        WHERE producto_id = $1 AND sucursal_id = $2 AND dia_operativo = $3::date
        ORDER BY modificador_id`,
      [menu.producto.id, sucursalId, dia],
    )
  ).rows.map((r) => r.modificador_id);

describe('criterio 34 · consultar el menú de un día', () => {
  it('trae el menú con sus tiempos y platos candidatos, sin ninguno elegido, para el día operativo actual', async () => {
    const menu = await nuevoMenu();
    const m = await elMenu(menu);
    expect(m).toMatchObject({ nombre: menu.producto.nombre, precio: '12.00', dia: HOY });
    expect(m.grupos.map((g) => [g.id, g.nombre, g.minimo, g.maximo])).toEqual([
      [menu.entrada.id, menu.entrada.nombre, 1, 1],
      [menu.segundo.id, menu.segundo.nombre, 1, 1],
    ]);
    expect(m.grupos[0]!.opciones).toEqual([
      {
        modificadorId: menu.op.papa,
        nombre: 'Papa a la huancaína',
        precioExtra: '0.00',
        producto: null,
        elegida: false,
        disponible: true,
      },
      {
        modificadorId: menu.op.sopa,
        nombre: 'Sopa',
        precioExtra: '0.00',
        producto: { id: menu.sopaDelDia.id, nombre: menu.sopaDelDia.nombre },
        elegida: false,
        disponible: true,
      },
    ]);
    expect(m.grupos[1]!.opciones.map((o) => [o.nombre, o.precioExtra])).toEqual([
      ['Ají de gallina', '0.00'],
      ['Lomo saltado', '5.00'],
    ]);
  });

  it('acepta el día anterior, el actual y el siguiente; otro día, o un texto que no es fecha, responde 400', async () => {
    const menu = await nuevoMenu();
    for (const dia of [AYER, HOY, MANANA]) {
      expect((await elMenu(menu, adminS1, dia)).dia).toBe(dia);
    }
    for (const dia of ['2026-10-31', '2026-11-04', '2026-11-02T10:00', 'hoy', '2026-02-30']) {
      esperarError(await consultar(adminS1, dia), 400, 'DATOS_INVALIDOS');
    }
    esperarError(await pedir(ctx, adminS1, 'get', `${RUTA}?otro=1`), 400, 'DATOS_INVALIDOS');
  });

  it('solo trae los menús activos y disponibles en la sucursal; el precio es el efectivo', async () => {
    const activo = await nuevoMenu();
    const inactivo = await nuevoMenu();
    const noDisponible = await nuevoMenu();
    const conPrecioPropio = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/productos/${inactivo.producto.id}`, {
        activo: false,
      }),
      200,
      'desactivar',
    );
    exigirEstado(
      await pedir(
        ctx,
        tokenA,
        'put',
        `/carta/productos/${noDisponible.producto.id}/sucursales/${e.A.S1}`,
        { precio: null, disponible: false },
      ),
      200,
      'no disponible en S1',
    );
    exigirEstado(
      await pedir(
        ctx,
        tokenA,
        'put',
        `/carta/productos/${conPrecioPropio.producto.id}/sucursales/${e.A.S1}`,
        { precio: '13.50', disponible: true },
      ),
      200,
      'precio propio en S1',
    );
    const lista = ((await consultar()).body as MenuRespuesta[]).map((m) => m.productoId);
    expect(lista).toContain(activo.producto.id);
    expect(lista).toContain(conPrecioPropio.producto.id);
    expect(lista).not.toContain(inactivo.producto.id);
    expect(lista).not.toContain(noDisponible.producto.id);
    expect((await elMenu(conPrecioPropio)).precio).toBe('13.50');
    // En S2 nada cambia: el no disponible de S1 sí aparece y el precio es el de la empresa.
    expect((await elMenu(noDisponible, adminS2)).productoId).toBe(noDisponible.producto.id);
    expect((await elMenu(conPrecioPropio, adminS2)).precio).toBe('12.00');
  });

  it('no trae productos que no son menús del día ni lo que no se arma aquí', async () => {
    const simple = await crearSimple(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { componentes: [{ productoId: simple.id, cantidad: 1 }] }),
    );
    const ids = ((await consultar()).body as MenuRespuesta[]).map((m) => m.productoId);
    expect(ids).not.toContain(simple.id);
    expect(ids).not.toContain(combo.id);
  });

  it('un plato cuyo producto ligado está inactivo o no disponible en la sucursal viene con disponible: false', async () => {
    const menu = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/productos/${menu.sopaDelDia.id}`, {
        activo: false,
      }),
      200,
      'desactivar el producto ligado de la sopa',
    );
    exigirEstado(
      await pedir(
        ctx,
        tokenA,
        'put',
        `/carta/productos/${menu.ajiDeGallina.id}/sucursales/${e.A.S1}`,
        { precio: null, disponible: false },
      ),
      200,
      'ají no disponible en S1',
    );
    const enS1 = await elMenu(menu);
    const estado = (m: MenuRespuesta) =>
      Object.fromEntries(
        m.grupos.flatMap((g) => g.opciones.map((o) => [o.nombre, o.disponible] as const)),
      );
    expect(estado(enS1)).toEqual({
      'Papa a la huancaína': true,
      Sopa: false,
      'Ají de gallina': false,
      'Lomo saltado': true,
    });
    // En S2 el ají sí está disponible; la sopa, desactivada para toda la empresa, no.
    expect(estado(await elMenu(menu, adminS2))).toMatchObject({
      Sopa: false,
      'Ají de gallina': true,
    });
  });

  it('un plato desactivado o un grupo desactivado deja de ofrecerse', async () => {
    const menu = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${menu.entrada.id}`, {
        modificadores: [{ id: menu.op.papa, nombre: 'Papa a la huancaína' }],
      }),
      200,
      'quitar la sopa de la entrada',
    );
    const m = await elMenu(menu);
    expect(m.grupos[0]!.opciones.map((o) => o.nombre)).toEqual(['Papa a la huancaína']);
  });
});

describe('criterio 35 · armar el día', () => {
  it('elige los platos de hoy: responde con el menú, deja una fila de auditoría con el antes y el después y avisa a la sala de la sucursal', async () => {
    const menu = await nuevoMenu();
    const antes = await auditoriaCarta(admin, e.A.empresaId);
    ctx.publicador.limpiar();
    const res = await armar(menu, { opciones: [menu.op.sopa, menu.op.lomo] });
    exigirEstado(res, 200, 'armar hoy');
    expect(elegidas(res.body)).toEqual([menu.op.sopa, menu.op.lomo].sort());
    expect(res.body.dia).toBe(HOY);
    expect(elegidas(await elMenu(menu))).toEqual([menu.op.sopa, menu.op.lomo].sort());
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([menu.op.sopa, menu.op.lomo].sort());

    const nuevas = (await auditoriaCarta(admin, e.A.empresaId)).filter(
      (f) => !antes.some((a) => a.id === f.id),
    );
    const fila = unaFila(nuevas, {
      accion: 'armar_menu_del_dia',
      entidad: 'producto',
      entidadId: menu.producto.id,
      sucursalId: e.A.S1,
      actorUsuarioId: e.A.base.admin.id,
    });
    expect(fila.detalle).toEqual({
      dia: HOY,
      opciones: { antes: [], despues: [menu.op.sopa, menu.op.lomo].sort() },
    });
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        nombre: 'carta.actualizada',
        datos: { sucursalId: e.A.S1 },
      },
    ]);
  });

  it('reemplaza las opciones: las que salen se borran, las nuevas se agregan y la auditoría guarda ambas listas', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { opciones: [menu.op.papa, menu.op.aji] }), 200, 'primero');
    ctx.publicador.limpiar();
    const res = await armar(menu, { opciones: [menu.op.aji, menu.op.lomo, menu.op.sopa] });
    exigirEstado(res, 200, 'reemplazar');
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual(
      [menu.op.aji, menu.op.lomo, menu.op.sopa].sort(),
    );
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'armar_menu_del_dia',
      entidadId: menu.producto.id,
    });
    // El reloj de la prueba no avanza: las filas no tienen un orden estable por hora.
    expect(filas).toHaveLength(2);
    expect(
      filas.find((f) => (f.detalle as { opciones: { antes: string[] } }).opciones.antes.length > 0)!
        .detalle,
    ).toEqual({
      dia: HOY,
      opciones: {
        antes: [menu.op.papa, menu.op.aji].sort(),
        despues: [menu.op.aji, menu.op.lomo, menu.op.sopa].sort(),
      },
    });
    // Una lista vacía deja el día sin opciones.
    exigirEstado(await armar(menu, { opciones: [] }), 200, 'vaciar');
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([]);
    expect(elegidas(await elMenu(menu))).toEqual([]);
  });

  it('repetir la misma lista (en cualquier orden) responde 200 sin auditoría ni evento nuevos', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { opciones: [menu.op.sopa, menu.op.lomo] }), 200, 'armar');
    ctx.publicador.limpiar();
    const n = (await auditoriaCarta(admin, e.A.empresaId)).length;
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const opciones of [
      [menu.op.sopa, menu.op.lomo],
      [menu.op.lomo, menu.op.sopa],
      [menu.op.lomo.toUpperCase(), menu.op.sopa],
    ]) {
      exigirEstado(await armar(menu, { opciones }), 200, 'repetir');
    }
    exigirEstado(
      await armar(menu, { dia: HOY, opciones: [menu.op.sopa, menu.op.lomo] }),
      200,
      'con dia',
    );
    await asentar();
    expect((await auditoriaCarta(admin, e.A.empresaId)).length).toBe(n);
    expect(ctx.publicador.eventos()).toEqual([]);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('se puede armar el de hoy o el de mañana, no el de ayer ni el de pasado mañana (400)', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { dia: MANANA, opciones: [menu.op.papa] }), 200, 'mañana');
    expect(await filasDelDia(menu, e.A.S1, MANANA)).toEqual([menu.op.papa]);
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([]);
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const dia of [AYER, '2026-11-04', '2026-11-02T00:00', 'mañana']) {
      esperarError(await armar(menu, { dia, opciones: [menu.op.papa] }), 400, 'DATOS_INVALIDOS');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
    // La consulta de mañana trae lo armado en la víspera.
    expect(elegidas(await elMenu(menu, adminS1, MANANA))).toEqual([menu.op.papa]);
    expect(elegidas(await elMenu(menu, adminS1, HOY))).toEqual([]);
  });

  it('un producto que no es menú del día, de otra empresa o inexistente responde 404 igual, aun con un día inválido', async () => {
    const menu = await nuevoMenu();
    const simple = await crearSimple(ctx, tokenA, base);
    const combo = await crearProducto(
      ctx,
      tokenA,
      cuerpoCombo(base, { gruposModificadores: [menu.entrada.id] }),
    );
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const grupoB = await crearGrupo(ctx, e.B.tokenAdmin, [{ nombre: 'Sal' }]);
    const menuB = await crearProducto(
      ctx,
      e.B.tokenAdmin,
      cuerpoMenu(baseB, { gruposModificadores: [grupoB.id] }),
    );
    const cuerpos: unknown[] = [];
    for (const id of [simple.id, combo.id, menuB.id, crypto.randomUUID()]) {
      const res = await pedir(ctx, adminS1, 'put', `${RUTA}/${id}`, {
        dia: '2030-01-01',
        opciones: [menu.op.papa],
      });
      esperarError(res, 404, 'NO_ENCONTRADO');
      cuerpos.push(res.body);
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
    esperarError(
      await pedir(ctx, adminS1, 'put', `${RUTA}/no-es-uuid`, { opciones: [] }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('una opción que no es un plato activo de un grupo activo de este menú responde 422 y no cambia nada', async () => {
    const menu = await nuevoMenu();
    const otro = await nuevoMenu();
    const inactivo = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${inactivo.entrada.id}`, {
        modificadores: [{ id: inactivo.op.papa, nombre: 'Papa a la huancaína' }],
      }),
      200,
      'desactivar la sopa',
    );
    exigirEstado(await armar(menu, { opciones: [menu.op.papa] }), 200, 'armar');
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    const grupoB = await crearGrupo(ctx, e.B.tokenAdmin, [{ nombre: 'Sal' }]);
    const cuerpos: unknown[] = [];
    for (const opcion of [
      otro.op.papa, // plato de otro menú
      inactivo.op.sopa, // modificador desactivado
      grupoB.modificadores[0]!.id, // plato de B
      crypto.randomUUID(), // inexistente
    ]) {
      const res = await armar(menu, { opciones: [menu.op.sopa, opcion] });
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect((res.body as { campos: { campo: string }[] }).campos.map((c) => c.campo)).toEqual([
        'opciones',
      ]);
      cuerpos.push(res.body);
    }
    for (const cuerpo of cuerpos) expect(cuerpo).toEqual(cuerpos[0]);
    expect(JSON.stringify(cuerpos[0])).not.toContain(grupoB.modificadores[0]!.id);
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('un grupo desactivado deja a sus platos fuera: 422', async () => {
    // El grupo del menú no se puede desactivar mientras el menú esté activo (EN_USO), así que se desactiva
    // el menú, se desactiva el grupo y se arma el menú inactivo.
    const menu = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/productos/${menu.producto.id}`, { activo: false }),
      200,
      'desactivar el menú',
    );
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${menu.segundo.id}`, {
        activo: false,
      }),
      200,
      'desactivar el grupo',
    );
    esperarError(await armar(menu, { opciones: [menu.op.lomo] }), 422, 'REFERENCIA_INVALIDA');
    exigirEstado(
      await armar(menu, { opciones: [menu.op.papa] }),
      200,
      'una opción de un grupo activo',
    );
  });

  it('rechaza con 400 lo que no cumple la forma: sin lista, repetidas, ids que no son UUID, campos desconocidos', async () => {
    const menu = await nuevoMenu();
    const antes = await instantaneaCarta(admin, e.A.empresaId);
    for (const cuerpo of [
      {},
      { opciones: 'todas' },
      { opciones: [menu.op.papa, menu.op.papa] },
      { opciones: [menu.op.papa, menu.op.papa.toUpperCase()] },
      { opciones: ['uno'] },
      { opciones: [], extra: 1 },
      { opciones: [], empresaId: e.B.empresaId },
    ]) {
      esperarError(await armar(menu, cuerpo), 400, 'DATOS_INVALIDOS');
    }
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(antes);
  });

  it('Cocina/Barra arma el menú de su sucursal con su sesión y queda como autor', async () => {
    const menu = await nuevoMenu();
    const antes = await auditoriaCarta(admin, e.A.empresaId);
    exigirEstado(
      await armar(menu, { opciones: [menu.op.papa, menu.op.aji] }, cocinaS1),
      200,
      'Cocina',
    );
    const nuevas = (await auditoriaCarta(admin, e.A.empresaId)).filter(
      (f) => !antes.some((a) => a.id === f.id),
    );
    unaFila(nuevas, { accion: 'armar_menu_del_dia', actorUsuarioId: e.A.cocina.id });
    const fila = (
      await admin.query(
        `SELECT creado_por_usuario_id FROM menu_del_dia_opcion WHERE producto_id = $1 LIMIT 1`,
        [menu.producto.id],
      )
    ).rows[0];
    expect(fila.creado_por_usuario_id).toBe(e.A.cocina.id);
  });

  it('sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA, también para el Administrador', async () => {
    const menu = await nuevoMenu();
    esperarError(await pedir(ctx, tokenA, 'get', RUTA), 409, 'SUCURSAL_NO_ELEGIDA');
    esperarError(
      await pedir(ctx, tokenA, 'put', `${RUTA}/${menu.producto.id}`, { opciones: [] }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
  });
});

describe('criterio 36 · el cambio de día a la hora de corte', () => {
  it('las opciones de hoy dejan de valer a la hora de corte (05:00): un minuto antes siguen, a las 05:00 el día empieza sin opciones', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { opciones: [menu.op.sopa, menu.op.lomo] }), 200, 'armar hoy');
    await mover('2026-11-03T04:59:00-05:00');
    const antes = await elMenu(menu);
    expect(antes.dia).toBe(HOY);
    expect(elegidas(antes)).toEqual([menu.op.sopa, menu.op.lomo].sort());
    await mover('2026-11-03T05:00:00-05:00');
    const despues = await elMenu(menu);
    expect(despues.dia).toBe(MANANA);
    expect(elegidas(despues)).toEqual([]);
    // Las de ayer siguen consultables (para "Repetir las de ayer") y no se perdieron.
    expect(elegidas(await elMenu(menu, adminS1, HOY))).toEqual([menu.op.sopa, menu.op.lomo].sort());
    expect(await filasDelDia(menu, e.A.S1, HOY)).toHaveLength(2);
  });

  it('las opciones armadas la víspera valen desde la hora de corte', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { opciones: [menu.op.papa] }), 200, 'hoy');
    exigirEstado(
      await armar(menu, { dia: MANANA, opciones: [menu.op.sopa, menu.op.aji] }),
      200,
      'víspera',
    );
    expect(elegidas(await elMenu(menu))).toEqual([menu.op.papa]);
    await mover('2026-11-03T05:00:00-05:00');
    const m = await elMenu(menu);
    expect(m.dia).toBe(MANANA);
    expect(elegidas(m)).toEqual([menu.op.sopa, menu.op.aji].sort());
    // Con el reloj en el día nuevo, "hoy" es MANANA, "mañana" es el 4 y el 2 ya no se consulta.
    exigirEstado(
      await armar(menu, { dia: '2026-11-04', opciones: [menu.op.lomo] }),
      200,
      'nueva víspera',
    );
    esperarError(await armar(menu, { dia: HOY, opciones: [menu.op.papa] }), 400, 'DATOS_INVALIDOS');
    esperarError(await consultar(adminS1, '2026-10-31'), 400, 'DATOS_INVALIDOS');
  });

  it('antes de la hora de corte, de madrugada, "hoy" sigue siendo el día operativo anterior', async () => {
    const menu = await nuevoMenu();
    await mover('2026-11-03T02:00:00-05:00');
    const m = await elMenu(menu);
    expect(m.dia).toBe(HOY);
    exigirEstado(await armar(menu, { opciones: [menu.op.papa] }), 200, 'armar de madrugada');
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([menu.op.papa]);
  });

  it('usa la hora de corte de cada sucursal y la cambia el Administrador sin tocar lo armado', async () => {
    const menu = await nuevoMenu();
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S2}`, { horaCorte: '00:00' }),
      200,
      'corte de S2 a medianoche',
    );
    try {
      await mover('2026-11-03T02:00:00-05:00');
      expect((await elMenu(menu, adminS1)).dia).toBe(HOY);
      expect((await elMenu(menu, adminS2)).dia).toBe(MANANA);
      exigirEstado(await armar(menu, { opciones: [menu.op.papa] }, adminS1), 200, 'armar S1');
      exigirEstado(await armar(menu, { opciones: [menu.op.sopa] }, adminS2), 200, 'armar S2');
      expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([menu.op.papa]);
      expect(await filasDelDia(menu, e.A.S2, MANANA)).toEqual([menu.op.sopa]);
    } finally {
      exigirEstado(
        await pedir(ctx, tokenA, 'patch', `/sucursales/${e.A.S2}`, { horaCorte: '05:00' }),
        200,
        'restaurar el corte',
      );
    }
  });
});

describe('criterio 37 · por sucursal', () => {
  it('armar el menú en S1 no cambia el de S2, ni la auditoría ni el evento de S2', async () => {
    const menu = await nuevoMenu();
    ctx.publicador.limpiar();
    exigirEstado(await armar(menu, { opciones: [menu.op.papa, menu.op.lomo] }, adminS1), 200, 'S1');
    expect(elegidas(await elMenu(menu, adminS2))).toEqual([]);
    exigirEstado(await armar(menu, { opciones: [menu.op.sopa] }, adminS2), 200, 'S2');
    expect(elegidas(await elMenu(menu, adminS1))).toEqual([menu.op.papa, menu.op.lomo].sort());
    expect(elegidas(await elMenu(menu, adminS2))).toEqual([menu.op.sopa]);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'armar_menu_del_dia',
      entidadId: menu.producto.id,
    });
    expect(filas.map((f) => f.sucursal_id).sort()).toEqual([e.A.S1, e.A.S2].sort());
    await asentar();
    expect(ctx.publicador.eventos().map((x) => x.sala)).toEqual([
      { tipo: 'sucursal', sucursalId: e.A.S1 },
      { tipo: 'sucursal', sucursalId: e.A.S2 },
    ]);
  });

  it('dos armados a la vez del mismo menú terminan con una de las dos listas completas y sin errores', async () => {
    const menu = await nuevoMenu();
    const a = [menu.op.papa, menu.op.aji];
    const b = [menu.op.sopa, menu.op.lomo];
    for (let i = 0; i < 6; i++) {
      const [ra, rb] = await Promise.all([
        armar(menu, { opciones: a }),
        armar(menu, { opciones: b }),
      ]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const final = await filasDelDia(menu, e.A.S1, HOY);
      expect([a.slice().sort(), b.slice().sort()]).toContainEqual(final);
    }
  });
});

describe('criterio 36 · caso límite: un plato desactivado que estaba elegido', () => {
  it('deja de ofrecerse desde la siguiente lectura y la selección guardada se conserva', async () => {
    const menu = await nuevoMenu();
    exigirEstado(await armar(menu, { opciones: [menu.op.papa, menu.op.sopa] }), 200, 'armar');
    exigirEstado(
      await pedir(ctx, tokenA, 'patch', `/carta/grupos-modificadores/${menu.entrada.id}`, {
        modificadores: [{ id: menu.op.papa, nombre: 'Papa a la huancaína' }],
      }),
      200,
      'desactivar la sopa',
    );
    const m = await elMenu(menu);
    expect(elegidas(m)).toEqual([menu.op.papa]);
    expect(await filasDelDia(menu, e.A.S1, HOY)).toEqual([menu.op.papa, menu.op.sopa].sort());
  });
});
