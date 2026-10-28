// Historia 003 · correcciones de la ronda 1 adversarial y de la revisión T31: pruebas del desarrollador (no
// protegidas) de lo que no es ruta crítica. Lo crítico (R1-F1 y R1-F4) lo cubre la prueba protegida
// `carta-critica/ataque-ronda1.spec.ts`.
// - R1-F2: dos `PATCH` cruzados que pasan a combo (A con B de componente y B con A) no dan 500: uno gana y el
//   otro responde 422 `REFERENCIA_INVALIDA` (o 409), y queda exactamente un combo.
// - R1-F3: un id de ruta en mayúsculas es el mismo recurso que en minúsculas; un producto no puede ser
//   componente de sí mismo aunque la URL venga en mayúsculas (422, no 500 por el `CHECK`).
// - Revisión: los menús de una familia inactiva no salen en la consulta del menú del día (ni en la vista), y la
//   foto responde 403 antes que 415 a quien no puede editar la carta.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { arrancarCarta, esperarError, exigirEstado } from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  llamar,
  pngValido,
  sembrarBase,
  sesionContrasena,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';
import {
  crearGrupo,
  crearProducto,
  crearSimple,
  cuerpoMenu,
  pedir,
  type Base,
} from './ayudas-combos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let token: string;
let base: Base;

beforeAll(async () => {
  // Un pool con varias conexiones: con 2 o menos, dos peticiones apenas se solapan.
  ctx = await arrancarCarta({ poolMax: 6 });
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  token = await sesionContrasena(ctx, e.A.base.admin, null);
  base = await sembrarBase(ctx, token);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const aCombo = (componenteId: string) => ({
  tipo: 'COMBO',
  componentes: [{ productoId: componenteId, cantidad: 1 }],
  confirmarPerdida: true,
});

describe('R1-F2 · dos PATCH cruzados que pasan a combo', () => {
  it('no hay 500: uno gana (200) y el otro responde 422 o 409; queda un solo combo', async () => {
    const PAREJAS = 12;
    const fallos: string[] = [];
    for (let i = 0; i < PAREJAS; i++) {
      const a = await crearSimple(ctx, token, base);
      const b = await crearSimple(ctx, token, base);
      const [r1, r2] = await Promise.all([
        pedir(ctx, token, 'patch', `/carta/productos/${a.id}`, aCombo(b.id)),
        pedir(ctx, token, 'patch', `/carta/productos/${b.id}`, aCombo(a.id)),
      ]);
      const estados = [r1.status, r2.status].sort();
      const tipos = (
        await admin.query<{ tipo: string }>(
          'SELECT tipo FROM producto WHERE id = ANY($1::uuid[]) ORDER BY id',
          [[a.id, b.id]],
        )
      ).rows.map((f) => f.tipo);
      const combos = tipos.filter((t) => t === 'COMBO').length;
      const perdedor = r1.status === 200 ? r2 : r1;
      const problemas: string[] = [];
      if (estados[0] !== 200 || ![409, 422].includes(estados[1]!)) {
        problemas.push(`estados ${r1.status}/${r2.status}: ${r1.text} ${r2.text}`);
      } else if (
        !(perdedor.status === 422
          ? perdedor.body.codigo === 'REFERENCIA_INVALIDA'
          : perdedor.body.codigo === 'EN_USO')
      ) {
        problemas.push(`el perdedor respondió ${perdedor.status} ${perdedor.text}`);
      }
      if (combos !== 1) problemas.push(`${combos} combos (${tipos.join(',')})`);
      if (problemas.length > 0) fallos.push(`pareja ${i}: ${problemas.join('; ')}`);
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
  });
});

describe('R1-F3 · id de ruta en mayúsculas', () => {
  it('un producto no puede ser componente de sí mismo aunque la URL vaya en mayúsculas (422, no 500)', async () => {
    const p = await crearSimple(ctx, token, base);
    const res = await pedir(
      ctx,
      token,
      'patch',
      `/carta/productos/${p.id.toUpperCase()}`,
      aCombo(p.id),
    );
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
    const mayusculas = await pedir(
      ctx,
      token,
      'patch',
      `/carta/productos/${p.id.toUpperCase()}`,
      aCombo(p.id.toUpperCase()),
    );
    esperarError(mayusculas, 422, 'REFERENCIA_INVALIDA');
    const { rows } = await admin.query('SELECT tipo FROM producto WHERE id = $1', [p.id]);
    expect(rows[0].tipo).toBe('SIMPLE');
  });

  it('el id en mayúsculas es el mismo recurso: el GET responde el id en minúsculas y el PATCH lo edita', async () => {
    const p = await crearSimple(ctx, token, base);
    const leido = await pedir(ctx, token, 'get', `/carta/productos/${p.id.toUpperCase()}`);
    exigirEstado(leido, 200, 'leer con el id en mayúsculas');
    expect(leido.body.id).toBe(p.id);
    const editado = await pedir(ctx, token, 'patch', `/carta/productos/${p.id.toUpperCase()}`, {
      nombre: `${p.nombre} editado`,
    });
    exigirEstado(editado, 200, 'editar con el id en mayúsculas');
    expect(editado.body.nombre).toBe(`${p.nombre} editado`);
  });

  it('un id que no es UUID sigue respondiendo 400', async () => {
    const res = await pedir(ctx, token, 'get', '/carta/productos/no-es-un-uuid');
    esperarError(res, 400, 'DATOS_INVALIDOS');
  });
});

describe('revisión T31 · menú del día de una familia inactiva', () => {
  it('no sale en la consulta del menú del día, igual que en la vista de la sucursal', async () => {
    const familia = await pedir(ctx, token, 'post', '/carta/familias', {
      nombre: `Menús ${Date.now()}`,
    });
    exigirEstado(familia, 201, 'crear familia');
    const grupo = await crearGrupo(ctx, token, [{ nombre: 'Papa' }, { nombre: 'Sopa' }]);
    const menu = await crearProducto(
      ctx,
      token,
      cuerpoMenu(
        { ...base, familiaId: familia.body.id as string },
        { gruposModificadores: [grupo.id] },
      ),
    );
    const adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
    const idsDelMenu = async (): Promise<string[]> => {
      const res = await pedir(ctx, adminS1, 'get', '/carta/sucursal/menu-del-dia');
      exigirEstado(res, 200, 'consultar el menú del día');
      return (res.body as { productoId: string }[]).map((m) => m.productoId);
    };
    const idsDeLaVista = async (): Promise<string[]> => {
      const res = await pedir(ctx, adminS1, 'get', '/carta/sucursal');
      exigirEstado(res, 200, 'vista de la sucursal');
      return JSON.stringify(res.body).includes(menu.id) ? [menu.id] : [];
    };
    expect(await idsDelMenu()).toContain(menu.id);
    expect(await idsDeLaVista()).toEqual([menu.id]);

    // La API no deja desactivar una familia con productos activos: se fuerza en la base.
    await admin.query('BEGIN');
    await admin.query(`SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba')`);
    await admin.query('UPDATE familia SET activa = false WHERE id = $1', [familia.body.id]);
    await admin.query('COMMIT');
    expect(await idsDelMenu()).not.toContain(menu.id);
    expect(await idsDeLaVista()).toEqual([]);
  });
});

describe('revisión T31 · la foto: permisos antes que el tipo', () => {
  it('quien no puede editar la carta recibe 403 aunque el Content-Type no sea de imagen', async () => {
    const mozo = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
    const p = await crearSimple(ctx, token, base);
    const res = await llamar(ctx, mozo, {
      metodo: 'put',
      ruta: `/carta/productos/${p.id}/foto`,
      binario: { tipo: 'text/plain', datos: pngValido() },
    });
    esperarError(res, 403, 'PROHIBIDO');
    const admin415 = await llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${p.id}/foto`,
      binario: { tipo: 'text/plain', datos: pngValido() },
    });
    esperarError(admin415, 415, 'TIPO_NO_SOPORTADO');
  });
});
