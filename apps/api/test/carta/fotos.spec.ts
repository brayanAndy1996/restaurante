// Historia 003, grupo C1 · fotos de los productos (criterios 14 a 17): pruebas del desarrollador (no
// protegidas) con imágenes de muestra (JPEG, PNG y WebP válidos, archivos truncados, firma que no coincide
// con el `Content-Type`, lados de 199 y 2049 px, 1 MB + 1 byte y una transacción revertida que conserva la
// foto anterior). Las claves, los permisos y el aislamiento los cubren también las pruebas protegidas.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  asentar,
  auditoriaCarta,
  esperarError,
  exigirEstado,
  type Llamada,
} from '../carta-critica/fabrica-permisos-carta';
import {
  crearEscenarioCarta,
  jpegValido,
  llamar,
  pngValido,
  productoSimple,
  sembrarBase,
  sesionContrasena,
  webpConPerdida,
  webpExtendido,
  webpValido,
  type AppCarta,
  type EscenarioCarta,
} from './ayudas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const MB = 1_048_576;

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let tokenA: string;
let base: { estacionId: string; familiaId: string };

beforeAll(async () => {
  ctx = await arrancarCarta();
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  tokenA = e.A.tokenAdmin;
  base = await sembrarBase(ctx, tokenA);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

async function nuevoProducto(token = tokenA, b = base): Promise<string> {
  const res = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/productos',
    cuerpo: productoSimple(b),
  });
  exigirEstado(res, 201, 'crear producto');
  return res.body.id as string;
}

const subir = (id: string, tipo: string, datos: Buffer, token = tokenA) =>
  llamar(ctx, token, {
    metodo: 'put',
    ruta: `/carta/productos/${id}/foto`,
    binario: { tipo, datos },
  } satisfies Llamada);

const fotoClaveDe = async (id: string): Promise<string | null> =>
  (await admin.query('SELECT foto_clave FROM producto WHERE id = $1', [id])).rows[0].foto_clave;

describe('criterio 14 · subir la foto', () => {
  it.each([
    ['PNG', 'image/png', () => pngValido(240, 240), 'png'],
    ['JPEG', 'image/jpeg', () => jpegValido(300, 200), 'jpg'],
    ['WebP sin pérdida', 'image/webp', () => webpValido(240, 240), 'webp'],
    ['WebP con pérdida', 'image/webp', () => webpConPerdida(640, 480), 'webp'],
    ['WebP extendido', 'image/webp', () => webpExtendido(1200, 900), 'webp'],
  ])(
    '%s válido: 200 con la URL, la clave bajo la empresa y el producto apuntando a ella',
    async (_n, tipo, imagen, ext) => {
      const id = await nuevoProducto();
      const res = await subir(id, tipo, imagen());
      exigirEstado(res, 200, 'subir foto');
      const clave = await fotoClaveDe(id);
      expect(clave).toMatch(new RegExp(`^carta/${e.A.empresaId}/${id}/[0-9a-f-]{36}\\.${ext}$`));
      expect(ctx.almacen.claves()).toContain(clave);
      expect(res.body).toEqual({ fotoUrl: ctx.almacen.urlPublica(clave!) });
      expect(ctx.almacen.obtener(clave!)).toMatchObject({ tipo });
      // El producto y el listado traen la URL pública (nunca la clave sola).
      const detalle = await llamar(ctx, tokenA, { metodo: 'get', ruta: `/carta/productos/${id}` });
      expect(detalle.body.fotoUrl).toBe(res.body.fotoUrl);
    },
  );

  it('acepta los lados límite (200 y 2048 px) y un Content-Type con parámetros', async () => {
    const id = await nuevoProducto();
    exigirEstado(await subir(id, 'image/png', pngValido(200, 200)), 200, '200 x 200');
    exigirEstado(await subir(id, 'image/png', pngValido(240, 2048)), 200, '240 x 2048');
    exigirEstado(
      await subir(id, 'image/png; charset=binary', pngValido(2048, 240)),
      200,
      'con parámetro',
    );
    exigirEstado(await subir(id, 'IMAGE/PNG', pngValido()), 200, 'en mayúsculas');
  });

  it('rechaza los lados de 199 y 2049 px (422) sin guardar nada', async () => {
    const id = await nuevoProducto();
    const antes = ctx.almacen.claves();
    for (const imagen of [
      pngValido(199, 240),
      pngValido(240, 199),
      pngValido(2049, 240),
      pngValido(240, 2049),
    ]) {
      esperarError(await subir(id, 'image/png', imagen), 422, 'FOTO_INVALIDA');
    }
    esperarError(await subir(id, 'image/jpeg', jpegValido(199, 500)), 422, 'FOTO_INVALIDA');
    esperarError(await subir(id, 'image/webp', webpValido(500, 2049)), 422, 'FOTO_INVALIDA');
    expect(ctx.almacen.claves()).toEqual(antes);
    expect(await fotoClaveDe(id)).toBeNull();
  });

  it('rechaza un archivo truncado de cualquier formato (422) sin guardar nada', async () => {
    const id = await nuevoProducto();
    const antes = ctx.almacen.claves();
    const casos: [string, Buffer][] = [
      ['image/png', pngValido().subarray(0, 100)],
      ['image/png', pngValido().subarray(0, pngValido().length - 12)], // sin IEND
      ['image/png', pngValido().subarray(0, 20)], // en medio del IHDR
      ['image/jpeg', jpegValido().subarray(0, jpegValido().length - 2)], // sin EOI
      ['image/jpeg', jpegValido().subarray(0, 12)],
      ['image/webp', webpValido().subarray(0, webpValido().length - 3)],
      ['image/webp', webpValido().subarray(0, 14)],
    ];
    for (const [tipo, datos] of casos) {
      esperarError(await subir(id, tipo, datos), 422, 'FOTO_INVALIDA');
    }
    expect(ctx.almacen.claves()).toEqual(antes);
  });

  it('rechaza una firma que no coincide con el Content-Type, un archivo que no es imagen y un cuerpo vacío (422)', async () => {
    const id = await nuevoProducto();
    const antes = ctx.almacen.claves();
    esperarError(await subir(id, 'image/png', jpegValido()), 422, 'FOTO_INVALIDA');
    esperarError(await subir(id, 'image/jpeg', pngValido()), 422, 'FOTO_INVALIDA');
    esperarError(await subir(id, 'image/webp', pngValido()), 422, 'FOTO_INVALIDA');
    esperarError(
      await subir(id, 'image/png', Buffer.from('<?php echo 1; ?>')),
      422,
      'FOTO_INVALIDA',
    );
    esperarError(
      await subir(id, 'image/png', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')),
      422,
      'FOTO_INVALIDA',
    );
    esperarError(await subir(id, 'image/jpeg', Buffer.alloc(0)), 422, 'FOTO_INVALIDA');
    expect(ctx.almacen.claves()).toEqual(antes);
    expect(await fotoClaveDe(id)).toBeNull();
  });

  it('otro Content-Type responde 415 y 1 MB + 1 byte responde 413; 1 MB exacto se acepta', async () => {
    const id = await nuevoProducto();
    const antes = ctx.almacen.claves();
    for (const tipo of ['image/gif', 'image/svg+xml', 'application/octet-stream', 'text/plain']) {
      esperarError(await subir(id, tipo, pngValido()), 415, 'TIPO_NO_SOPORTADO');
    }
    const json = await llamar(ctx, tokenA, {
      metodo: 'put',
      ruta: `/carta/productos/${id}/foto`,
      cuerpo: { foto: 'x' },
    });
    esperarError(json, 415, 'TIPO_NO_SOPORTADO');
    const sinTipo = await ctx
      .http()
      .put(`/carta/productos/${id}/foto`)
      .set({ Authorization: `Bearer ${tokenA}` });
    esperarError(sinTipo, 415, 'TIPO_NO_SOPORTADO');

    const relleno = (total: number) => {
      const jpeg = jpegValido();
      const extra = Buffer.alloc(total - jpeg.length, 0x55);
      // El relleno va dentro de los datos del escaneo, antes del EOI.
      return Buffer.concat([
        jpeg.subarray(0, jpeg.length - 2),
        extra,
        jpeg.subarray(jpeg.length - 2),
      ]);
    };
    const grande = await subir(id, 'image/jpeg', relleno(MB + 1));
    esperarError(grande, 413, 'CUERPO_DEMASIADO_GRANDE');
    expect(grande.body.mensaje).toContain('1 MB');
    expect(ctx.almacen.claves()).toEqual(antes);
    exigirEstado(await subir(id, 'image/jpeg', relleno(MB)), 200, 'exactamente 1 MB');
  });

  it('el límite de 1 MB es solo de esta ruta: el resto sigue con 100 KB', async () => {
    const grande = await llamar(ctx, tokenA, {
      metodo: 'post',
      ruta: '/carta/familias',
      cuerpo: { nombre: 'x'.repeat(150 * 1024) },
    });
    esperarError(grande, 413, 'CUERPO_DEMASIADO_GRANDE');
  });

  it('el Mozo recibe 403 y un id de B o inexistente responde 404 con el mismo cuerpo, sin guardar nada', async () => {
    const id = await nuevoProducto();
    const antes = ctx.almacen.claves();
    const mozo = await sesionContrasena(ctx, e.A.mozo, e.A.S1);
    esperarError(await subir(id, 'image/png', pngValido(), mozo), 403, 'PROHIBIDO');
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const deB = await nuevoProducto(e.B.tokenAdmin, baseB);
    const a = await subir(deB, 'image/png', pngValido());
    const b = await subir('00000000-0000-4000-8000-000000000000', 'image/png', pngValido());
    esperarError(a, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
    expect(ctx.almacen.claves()).toEqual(antes);
    expect(await fotoClaveDe(deB)).toBeNull();
    esperarError(await subir('no-es-uuid', 'image/png', pngValido()), 400, 'DATOS_INVALIDOS');
  });
});

describe('criterio 15 · reemplazar la foto', () => {
  it('crea una clave nueva, borra la anterior después de confirmar y audita las dos claves', async () => {
    const id = await nuevoProducto();
    await subir(id, 'image/png', pngValido());
    const primera = (await fotoClaveDe(id))!;
    await asentar();
    ctx.publicador.limpiar();
    const res = await subir(id, 'image/jpeg', jpegValido());
    exigirEstado(res, 200, 'reemplazar');
    const segunda = (await fotoClaveDe(id))!;
    expect(segunda).not.toBe(primera);
    await asentar();
    expect(ctx.almacen.claves()).toContain(segunda);
    expect(ctx.almacen.claves()).not.toContain(primera);
    expect(ctx.publicador.eventos()).toHaveLength(1);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'cambiar_foto_producto',
      entidadId: id,
    });
    expect(filas).toHaveLength(2);
    // Con el reloj manual las dos filas comparten instante: se buscan por su contenido, no por su posición.
    const detalles = filas.map((f) => f.detalle);
    expect(detalles).toContainEqual({ claveAnterior: primera, claveNueva: segunda });
    expect(detalles).toContainEqual({ claveAnterior: null, claveNueva: primera });
  });

  it('si la operación falla antes de confirmar, el producto conserva su foto y la anterior no se borra', async () => {
    const id = await nuevoProducto();
    await subir(id, 'image/png', pngValido());
    const anterior = (await fotoClaveDe(id))!;
    const auditoriaAntes = (await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).length;
    await asentar();
    ctx.publicador.limpiar();

    // Un disparador de la base hace fallar el UPDATE de la foto de este producto.
    const nombre = `falla_foto_${id.replaceAll('-', '')}`;
    await admin.query(`CREATE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'falla de prueba'; END $f$`);
    await admin.query(`CREATE TRIGGER ${nombre} BEFORE UPDATE OF foto_clave ON producto
      FOR EACH ROW WHEN (NEW.id = '${id}') EXECUTE FUNCTION ${nombre}()`);
    try {
      const res = await subir(id, 'image/jpeg', jpegValido());
      expect(res.status).toBe(500);
      expect(res.text).not.toMatch(/falla de prueba|violates|SQLSTATE/i);
    } finally {
      await admin.query(`DROP TRIGGER ${nombre} ON producto`);
      await admin.query(`DROP FUNCTION ${nombre}()`);
    }
    await asentar();
    expect(await fotoClaveDe(id)).toBe(anterior);
    // La anterior sigue y la nueva (guardada antes del fallo) se borró.
    expect(
      ctx.almacen.claves().filter((c) => c.startsWith(`carta/${e.A.empresaId}/${id}/`)),
    ).toEqual([anterior]);
    expect(await auditoriaCarta(admin, e.A.empresaId, { entidadId: id })).toHaveLength(
      auditoriaAntes,
    );
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('si el COMMIT falla, el producto conserva su foto, la anterior no se borra y no hay eventos', async () => {
    const id = await nuevoProducto();
    await subir(id, 'image/png', pngValido());
    const anterior = (await fotoClaveDe(id))!;
    await asentar();
    ctx.publicador.limpiar();
    const nombre = `falla_commit_${id.replaceAll('-', '')}`;
    await admin.query(`CREATE FUNCTION ${nombre}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'falla al confirmar'; END $f$`);
    await admin.query(`CREATE CONSTRAINT TRIGGER ${nombre} AFTER UPDATE OF foto_clave ON producto
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id = '${id}')
      EXECUTE FUNCTION ${nombre}()`);
    try {
      const res = await subir(id, 'image/jpeg', jpegValido());
      expect(res.status).toBe(500);
    } finally {
      await admin.query(`DROP TRIGGER ${nombre} ON producto`);
      await admin.query(`DROP FUNCTION ${nombre}()`);
    }
    await asentar();
    expect(await fotoClaveDe(id)).toBe(anterior);
    expect(ctx.almacen.claves()).toContain(anterior);
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('nunca borra un archivo que no sea de la empresa aunque la fila apunte a él', async () => {
    const id = await nuevoProducto();
    const ajena = `carta/${e.B.empresaId}/${id}/ajena.png`;
    await ctx.almacen.guardar(ajena, pngValido(), 'image/png');
    await admin.query('BEGIN');
    await admin.query(`SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba')`);
    await admin.query('UPDATE producto SET foto_clave = $2 WHERE id = $1', [id, ajena]);
    await admin.query('COMMIT');
    exigirEstado(await subir(id, 'image/png', pngValido()), 200, 'reemplazar');
    await asentar();
    expect(ctx.almacen.claves()).toContain(ajena);
    exigirEstado(
      await llamar(ctx, tokenA, { metodo: 'delete', ruta: `/carta/productos/${id}/foto` }),
      204,
      'quitar',
    );
    await asentar();
    expect(ctx.almacen.claves()).toContain(ajena);
  });
});

describe('criterio 16 · quitar la foto', () => {
  it('responde 204, borra el archivo después de confirmar y deja una fila; sin foto no hace nada', async () => {
    const id = await nuevoProducto();
    await subir(id, 'image/webp', webpValido());
    const clave = (await fotoClaveDe(id))!;
    const cajero = await sesionContrasena(ctx, e.A.cajero, e.A.S1);
    await asentar();
    ctx.publicador.limpiar();
    const res = await llamar(ctx, cajero, {
      metodo: 'delete',
      ruta: `/carta/productos/${id}/foto`,
    });
    exigirEstado(res, 204, 'quitar');
    expect(res.text).toBe('');
    await asentar();
    expect(await fotoClaveDe(id)).toBeNull();
    expect(ctx.almacen.claves()).not.toContain(clave);
    expect(ctx.publicador.eventos()).toHaveLength(1);
    const filas = await auditoriaCarta(admin, e.A.empresaId, {
      accion: 'quitar_foto_producto',
      entidadId: id,
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ actor_usuario_id: e.A.cajero.id });
    expect(filas[0]!.detalle).toEqual({ claveAnterior: clave });

    ctx.publicador.limpiar();
    exigirEstado(
      await llamar(ctx, cajero, { metodo: 'delete', ruta: `/carta/productos/${id}/foto` }),
      204,
      'sin foto',
    );
    await asentar();
    expect(
      await auditoriaCarta(admin, e.A.empresaId, { accion: 'quitar_foto_producto', entidadId: id }),
    ).toHaveLength(1);
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});

describe('criterio 17 · otra empresa', () => {
  it('quitar la foto de un producto de B responde 404 y no borra su archivo', async () => {
    const baseB = await sembrarBase(ctx, e.B.tokenAdmin);
    const deB = await nuevoProducto(e.B.tokenAdmin, baseB);
    exigirEstado(await subir(deB, 'image/png', pngValido(), e.B.tokenAdmin), 200, 'B sube');
    const claveB = (await fotoClaveDe(deB))!;
    const a = await llamar(ctx, tokenA, { metodo: 'delete', ruta: `/carta/productos/${deB}/foto` });
    const b = await llamar(ctx, tokenA, {
      metodo: 'delete',
      ruta: '/carta/productos/00000000-0000-4000-8000-000000000000/foto',
    });
    esperarError(a, 404, 'NO_ENCONTRADO');
    expect(a.body).toEqual(b.body);
    await asentar();
    expect(ctx.almacen.claves()).toContain(claveB);
    expect(await fotoClaveDe(deB)).toBe(claveB);
  });
});
