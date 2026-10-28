// spec: 003-carta (pruebas protegidas)
//
// Ataque adversarial, ronda 1: lo crítico que encontró (permisos y auditoría; aislamiento).
// - R1-F1 (criterios 40, 46 y 62): dos personas con permiso marcan agotado el mismo producto a la vez. Cada
//   cambio real deja exactamente una fila de auditoría y un evento `carta.disponibilidad`, y la segunda
//   fila lleva en `antes` el agotado que dejó la primera (no dos filas con `antes: null`).
//   (a) producto que nunca estuvo agotado, mismo `hasta`; (b) lo mismo después de una reactivación (la
//   fila se borró); (c) `FIN_DEL_DIA` contra `REACTIVAR` a la vez: dos cambios reales, dos filas, dos eventos,
//   encadenados.
// - R1-F4 (criterio 61): el 403 (y el 401) van antes que el 413 en `PUT /carta/productos/:id/foto`. Quien no
//   tiene el permiso recibe 403 `PROHIBIDO` aunque el cuerpo pase de 1 MB; sin sesión, 401; y en ningún caso se
//   guarda un archivo, queda auditoría ni cambia una fila. El Administrador con el mismo cuerpo sí recibe 413.
// Solo usan contratos públicos (rutas de `spec.md`, `auditoria`, `producto_agotado` y el publicador y el
// almacén de las pruebas). Las carreras son probabilísticas: cada pareja se repite varias veces y basta una
// pareja mala para fallar, de modo que una implementación correcta las pasa siempre.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  crearEscenarioCarta,
  esperarError,
  exigirEstado,
  exigirSinFallos,
  instantaneaCarta,
  llamar,
  pngValido,
  productoSimpleNuevo,
  sembrarCarta,
  sesionContrasena,
  sesionesDe,
  type AppCarta,
  type DatosCarta,
  type EscenarioCarta,
  type FilaDeAuditoria,
} from './fabrica-permisos-carta';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let datos: DatosCarta;

beforeAll(async () => {
  // Un pool con varias conexiones: con 2 o menos las dos peticiones apenas se solapan.
  ctx = await arrancarCarta({ poolMax: 6 });
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  datos = await sembrarCarta(ctx, e.A.tokenAdmin);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ------------------------------------------------------------------------------------------------
// R1-F1 · marcar agotado en paralelo
// ------------------------------------------------------------------------------------------------

async function productoNuevo(): Promise<string> {
  const res = await llamar(ctx, e.A.tokenAdmin, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: productoSimpleNuevo({ familiaId: datos.familiaId, estacionId: datos.estacionId }),
  });
  exigirEstado(res, 201, 'producto nuevo para la carrera');
  return res.body.id as string;
}

/** El `hasta` de un lado (`antes` o `despues`) del detalle de una fila: objeto con `hasta` o el texto. */
function hastaDe(lado: unknown): string | null {
  if (typeof lado === 'string') return lado;
  if (lado !== null && typeof lado === 'object') {
    const h = (lado as { hasta?: unknown }).hasta;
    return typeof h === 'string' ? h : null;
  }
  return null;
}

const antesDe = (f: FilaDeAuditoria): unknown => (f.detalle as { antes?: unknown } | null)?.antes;
const despuesDe = (f: FilaDeAuditoria): unknown =>
  (f.detalle as { despues?: unknown } | null)?.despues;

const resumen = (filas: FilaDeAuditoria[]): string => JSON.stringify(filas.map((f) => f.detalle));

/** Eventos `carta.disponibilidad` publicados para el producto. */
function eventosDe(productoId: string) {
  return ctx.publicador
    .eventos()
    .filter((ev) => ev.nombre === 'carta.disponibilidad' && ev.datos.productoId === productoId);
}

async function agotadoFinal(productoId: string): Promise<string | null> {
  const { rows } = await admin.query<{ hasta: string }>(
    `SELECT hasta FROM producto_agotado WHERE producto_id = $1 AND sucursal_id = $2`,
    [productoId, e.A.S1],
  );
  expect(rows.length, 'filas de producto_agotado').toBeLessThanOrEqual(1);
  return rows[0]?.hasta ?? null;
}

describe('R1-F1 · dos personas marcan agotado a la vez (criterios 40, 46 y 62)', () => {
  const PAREJAS_A = 15;
  const PAREJAS_B = 12;
  const PAREJAS_C = 10;

  it('(a) mismo hasta sobre un producto nunca agotado: una fila, un evento y el estado final agotado', async () => {
    const cocina = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
    const supervisor = await sesionContrasena(ctx, e.A.supervisor, e.A.S1);
    const fallos: string[] = [];
    for (let i = 0; i < PAREJAS_A; i++) {
      const id = await productoNuevo();
      await asentar();
      ctx.publicador.limpiar();
      const [r1, r2] = await Promise.all([
        llamar(ctx, cocina, {
          metodo: 'put',
          ruta: `/carta/sucursal/agotados/${id}`,
          cuerpo: { hasta: 'FIN_DEL_DIA' },
        }),
        llamar(ctx, supervisor, {
          metodo: 'put',
          ruta: `/carta/sucursal/agotados/${id}`,
          cuerpo: { hasta: 'FIN_DEL_DIA' },
        }),
      ]);
      await asentar(150);
      const filas = await auditoriaCarta(admin, e.A.empresaId, {
        accion: 'marcar_agotado',
        entidadId: id,
      });
      const eventos = eventosDe(id);
      const final = await agotadoFinal(id);
      const problemas: string[] = [];
      if (r1.status !== 200 || r2.status !== 200)
        problemas.push(`estados ${r1.status}/${r2.status}`);
      if (filas.length !== 1)
        problemas.push(`${filas.length} filas marcar_agotado ${resumen(filas)}`);
      if (eventos.length !== 1) problemas.push(`${eventos.length} eventos`);
      if (final !== 'FIN_DEL_DIA') problemas.push(`estado final ${String(final)}`);
      if (problemas.length > 0) fallos.push(`pareja ${i}: ${problemas.join('; ')}`);
    }
    exigirSinFallos(fallos);
  });

  it('(b) después de una reactivación (la fila se borró): una sola fila de auditoría por pareja', async () => {
    const cocina = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
    const supervisor = await sesionContrasena(ctx, e.A.supervisor, e.A.S1);
    const fallos: string[] = [];
    for (let i = 0; i < PAREJAS_B; i++) {
      const id = await productoNuevo();
      const ruta = `/carta/sucursal/agotados/${id}`;
      exigirEstado(
        await llamar(ctx, cocina, { metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } }),
        200,
        'marcar antes de la reactivación',
      );
      exigirEstado(await llamar(ctx, cocina, { metodo: 'delete', ruta }), 204, 'reactivar');
      expect(await agotadoFinal(id), 'tras reactivar no queda fila').toBeNull();
      await asentar();
      const filasAntes = new Set(
        (await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).map((f) => f.id),
      );
      ctx.publicador.limpiar();

      const [r1, r2] = await Promise.all([
        llamar(ctx, cocina, { metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } }),
        llamar(ctx, supervisor, { metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } }),
      ]);
      await asentar(150);
      const nuevas = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).filter(
        (f) => !filasAntes.has(f.id),
      );
      const eventos = eventosDe(id);
      const final = await agotadoFinal(id);
      const problemas: string[] = [];
      if (r1.status !== 200 || r2.status !== 200)
        problemas.push(`estados ${r1.status}/${r2.status}`);
      if (nuevas.length !== 1 || nuevas[0]!.accion !== 'marcar_agotado') {
        problemas.push(
          `${nuevas.length} filas nuevas [${nuevas.map((f) => f.accion).join(',')}] ${resumen(nuevas)}`,
        );
      }
      if (eventos.length !== 1) problemas.push(`${eventos.length} eventos`);
      if (final !== 'FIN_DEL_DIA') problemas.push(`estado final ${String(final)}`);
      if (problemas.length > 0) fallos.push(`pareja ${i}: ${problemas.join('; ')}`);
    }
    exigirSinFallos(fallos);
  });

  it('(c) FIN_DEL_DIA contra REACTIVAR a la vez: dos filas encadenadas (la segunda parte de lo que dejó la primera) y dos eventos', async () => {
    const cocina = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
    const supervisor = await sesionContrasena(ctx, e.A.supervisor, e.A.S1);
    const fallos: string[] = [];
    for (let i = 0; i < PAREJAS_C; i++) {
      const id = await productoNuevo();
      const ruta = `/carta/sucursal/agotados/${id}`;
      await asentar();
      ctx.publicador.limpiar();
      const [r1, r2] = await Promise.all([
        llamar(ctx, cocina, { metodo: 'put', ruta, cuerpo: { hasta: 'FIN_DEL_DIA' } }),
        llamar(ctx, supervisor, { metodo: 'put', ruta, cuerpo: { hasta: 'REACTIVAR' } }),
      ]);
      await asentar(150);
      const filas = await auditoriaCarta(admin, e.A.empresaId, {
        accion: 'marcar_agotado',
        entidadId: id,
      });
      const eventos = eventosDe(id);
      const final = await agotadoFinal(id);
      const problemas: string[] = [];
      if (r1.status !== 200 || r2.status !== 200)
        problemas.push(`estados ${r1.status}/${r2.status}`);
      if (eventos.length !== 2) problemas.push(`${eventos.length} eventos`);
      if (filas.length !== 2) {
        problemas.push(`${filas.length} filas marcar_agotado ${resumen(filas)}`);
      } else {
        // La que partió de "no agotado" es la primera; la otra debe partir de lo que esa dejó.
        const primeras = filas.filter((f) => antesDe(f) === null || antesDe(f) === undefined);
        const segundas = filas.filter((f) => !primeras.includes(f));
        if (primeras.length !== 1 || segundas.length !== 1) {
          problemas.push(`no se encadenan (${primeras.length} con antes nulo) ${resumen(filas)}`);
        } else {
          const primera = primeras[0]!;
          const segunda = segundas[0]!;
          if (hastaDe(antesDe(segunda)) !== hastaDe(despuesDe(primera))) {
            problemas.push(
              `la segunda parte de ${String(hastaDe(antesDe(segunda)))} y la primera dejó ` +
                String(hastaDe(despuesDe(primera))),
            );
          }
          if (hastaDe(despuesDe(primera)) === hastaDe(despuesDe(segunda))) {
            problemas.push('las dos filas dejan el mismo hasta (no es un cambio real)');
          }
          if (hastaDe(despuesDe(segunda)) !== final) {
            problemas.push(
              `el estado final ${String(final)} no es el de la última fila ` +
                String(hastaDe(despuesDe(segunda))),
            );
          }
        }
      }
      if (problemas.length > 0) fallos.push(`pareja ${i}: ${problemas.join('; ')}`);
    }
    exigirSinFallos(fallos);
  });
});

// ------------------------------------------------------------------------------------------------
// R1-F4 · el 403 y el 401 van antes que el 413
// ------------------------------------------------------------------------------------------------

describe('R1-F4 · foto de más de 1 MB: primero los permisos (criterios 14 y 61)', () => {
  /** PNG válido seguido de relleno: pasa de 1 MB (1 048 576 bytes) por un margen amplio. */
  const grande = () => Buffer.concat([pngValido(), Buffer.alloc(1_100_000)]);
  const subir = (token: string | undefined, cuerpo: Buffer) =>
    llamar(ctx, token, {
      metodo: 'put',
      ruta: `/carta/productos/${datos.productoId}/foto`,
      binario: { tipo: 'image/png', datos: cuerpo },
    });

  /** Ni filas, ni auditoría, ni archivos, ni eventos cambian mientras corre `fn`. */
  async function sinCambios(fn: () => Promise<void>): Promise<void> {
    await asentar();
    ctx.publicador.limpiar();
    const tablas = await instantaneaCarta(admin, e.A.empresaId);
    const auditoria = await auditoriaCarta(admin, e.A.empresaId);
    const claves = ctx.almacen.claves();
    await fn();
    await asentar();
    expect(await instantaneaCarta(admin, e.A.empresaId)).toEqual(tablas);
    expect(await auditoriaCarta(admin, e.A.empresaId)).toEqual(auditoria);
    expect(ctx.almacen.claves()).toEqual(claves);
    expect(ctx.publicador.eventos()).toEqual([]);
  }

  it('el Supervisor de S1 (sesión de contraseña y de PIN) recibe 403 PROHIBIDO, no 413', async () => {
    const sesiones = await sesionesDe(ctx, e.A.supervisor, e.A.S1);
    await sinCambios(async () => {
      for (const [clase, token] of Object.entries(sesiones)) {
        const res = await subir(token, grande());
        esperarError(res, 403, 'PROHIBIDO');
        expect(res.status, `sesión de ${clase}`).toBe(403);
      }
    });
  });

  it('Mozo, Cocina/Barra y el Cajero con S2 activa (Mozo allí) también reciben 403, no 413', async () => {
    const mozo = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
    const cocina = await sesionContrasena(ctx, e.A.cocina, e.A.S1);
    const cajeroEnS2 = await sesionContrasena(ctx, e.A.cajero, e.A.S2);
    await sinCambios(async () => {
      for (const [quien, token] of [
        ['Mozo', mozo],
        ['Cocina/Barra', cocina],
        ['Cajero con S2 activa', cajeroEnS2],
      ] as const) {
        const res = await subir(token, grande());
        expect(res.status, `${quien}: ${res.text}`).toBe(403);
        expect(res.body, quien).toMatchObject({ codigo: 'PROHIBIDO' });
      }
    });
  });

  it('sin sesión responde 401 NO_AUTENTICADO, y con la sesión cerrada también, no 413', async () => {
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    exigirEstado(await llamar(ctx, cajero, { metodo: 'delete', ruta: '/sesion' }), 204, 'cerrar');
    await sinCambios(async () => {
      const sinSesion = await subir(undefined, grande());
      expect(sinSesion.status, sinSesion.text).toBe(401);
      expect(sinSesion.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
      const cerrada = await subir(cajero, grande());
      expect(cerrada.status, cerrada.text).toBe(401);
      expect(cerrada.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    });
  });

  it('el Administrador con el mismo cuerpo sí recibe 413 CUERPO_DEMASIADO_GRANDE y no se guarda nada', async () => {
    await sinCambios(async () => {
      const res = await subir(e.A.tokenAdmin, grande());
      esperarError(res, 413, 'CUERPO_DEMASIADO_GRANDE');
    });
  });
});
