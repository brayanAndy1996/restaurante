// Historia 005, grupo C1 · configuración de la carta web y QR de las mesas (criterios 1 a 9, 12 y 65 en HTTP):
// pruebas del desarrollador (no protegidas). Cubren lo que las protegidas de P1, P2 y P4 no recorren: la forma de
// `GET /carta-web` sin configurar y configurada con sus enlaces, la dirección reservada, mal formada y repetida (con
// la dirección anterior que deja de buscarse), el logo (formato, tamaño, lados, reemplazo y borrado del archivo
// anterior, el prefijo de la clave), la dirección de cada sucursal, la hoja de QR (zonas y mesas inactivas fuera,
// aviso de carta sin publicar, repetir no cambia los códigos) y dos configuraciones simultáneas con la misma dirección.
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { esSubidaDeFoto } from '../../src/nucleo/archivos';
import { buscarEmpresaDeCarta } from '../../src/nucleo/base-de-datos/consultas-sin-empresa';
import { altaEmpresa } from '../acceso/fabrica-plataforma';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  crearEscenarioCarta,
  esperarError,
  exigirEstado,
  llamar,
  pngValido,
  sesionContrasena,
  type AppCarta,
  type EscenarioCarta,
} from '../carta-critica/fabrica-permisos-carta';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CARTA_WEB_URL = 'http://localhost:3001';
const MB = 1_048_576;

let ctx: AppCarta;
let admin: Client;
let sequelize: Sequelize;
let e: EscenarioCarta;

beforeAll(async () => {
  ctx = await arrancarCarta({ poolMax: 4 });
  admin = await abrirCliente('admin');
  sequelize = ctx.app.get<Sequelize>(CONEXION_API);
  e = await crearEscenarioCarta(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const direccion = (prefijo = 'cw'): string => `${prefijo}-${randomUUID().slice(0, 8)}`;
const putCarta = (token: string, cuerpo: object) =>
  llamar(ctx, token, { metodo: 'put', ruta: '/carta-web', cuerpo });
const putSucursal = (token: string, sucursalId: string, cuerpo: object) =>
  llamar(ctx, token, { metodo: 'put', ruta: `/carta-web/sucursales/${sucursalId}`, cuerpo });
const subirLogo = (token: string, tipo: string, datos: Buffer) =>
  llamar(ctx, token, { metodo: 'put', ruta: '/carta-web/logo', binario: { tipo, datos } });

describe('criterio 1 · GET /carta-web', () => {
  it('sin configurar: configurada false, color por defecto y todas las sucursales sin dirección ni publicar', async () => {
    const res = await llamar(ctx, e.B.tokenAdmin, { metodo: 'get', ruta: '/carta-web' });
    exigirEstado(res, 200, 'GET /carta-web');
    expect(res.body).toMatchObject({
      configurada: false,
      nombre: null,
      slug: null,
      colorPrincipal: '#1D4A9E',
      logoUrl: null,
      url: null,
    });
    const sucursales = res.body.sucursales as {
      sucursalId: string;
      slug: unknown;
      publicada: unknown;
      url: unknown;
    }[];
    expect(sucursales.map((s) => s.sucursalId).sort()).toEqual([e.B.S1, e.B.S2].sort());
    for (const s of sucursales)
      expect(s).toMatchObject({ slug: null, publicada: false, url: null });
  });

  it('configurada: el enlace de la empresa y el de cada sucursal con su dirección', async () => {
    const slug = direccion();
    exigirEstado(
      await putCarta(e.A.tokenAdmin, { nombre: 'Sabor Norteño', slug, colorPrincipal: '#b3261e' }),
      200,
      'configurar',
    );
    exigirEstado(
      await putSucursal(e.A.tokenAdmin, e.A.S1, { slug: 'miraflores', publicada: true }),
      200,
      'sucursal',
    );
    const res = await llamar(ctx, e.A.tokenAdmin, { metodo: 'get', ruta: '/carta-web' });
    exigirEstado(res, 200, 'GET /carta-web');
    expect(res.body).toMatchObject({
      configurada: true,
      nombre: 'Sabor Norteño',
      slug,
      colorPrincipal: '#B3261E',
      url: `${CARTA_WEB_URL}/${slug}`,
    });
    const s1 = (res.body.sucursales as { sucursalId: string }[]).find(
      (s) => s.sucursalId === e.A.S1,
    );
    expect(s1).toMatchObject({
      slug: 'miraflores',
      publicada: true,
      url: `${CARTA_WEB_URL}/${slug}/miraflores`,
    });
    const s2 = (res.body.sucursales as { sucursalId: string }[]).find(
      (s) => s.sucursalId === e.A.S2,
    );
    expect(s2).toMatchObject({ slug: null, publicada: false, url: null });
  });
});

describe('criterio 2 · nombre, dirección y color', () => {
  it('rechaza una dirección reservada, mayúsculas, corta, con guion al borde o sin nombre (400 con campos)', async () => {
    for (const mala of [
      'api',
      'publico',
      'Mal-Slug',
      'ab',
      '-inicio',
      'fin-',
      'doble--guion',
      'con_guion',
      'a'.repeat(41),
    ]) {
      const res = await putCarta(e.A.tokenAdmin, {
        nombre: 'X',
        slug: mala,
        colorPrincipal: '#AABBCC',
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
      expect(JSON.stringify(res.body.campos)).toContain('slug');
    }
    for (const cuerpo of [
      { nombre: '', slug: direccion(), colorPrincipal: '#AABBCC' },
      { nombre: 'x'.repeat(81), slug: direccion(), colorPrincipal: '#AABBCC' },
      { nombre: 'X', slug: direccion(), colorPrincipal: 'rojo' },
      { nombre: 'X', slug: direccion(), colorPrincipal: '#ABC' },
      { nombre: 'X', slug: direccion(), colorPrincipal: '#AABBCC', extra: 1 },
    ]) {
      esperarError(await putCarta(e.A.tokenAdmin, cuerpo), 400, 'DATOS_INVALIDOS');
    }
  });

  it('una dirección de otro restaurante es 409 sin decir de quién; la propia se puede repetir', async () => {
    const slugB = direccion('rincon');
    exigirEstado(
      await putCarta(e.B.tokenAdmin, { nombre: 'Rincón', slug: slugB, colorPrincipal: '#1D6B3A' }),
      200,
      'configurar B',
    );
    const res = await putCarta(e.A.tokenAdmin, {
      nombre: 'Sabor Norteño',
      slug: slugB,
      colorPrincipal: '#B3261E',
    });
    esperarError(res, 409, 'CONFLICTO');
    expect(res.body.mensaje).toBe('Esa dirección ya la usa otro restaurante. Elige otra');
    expect(res.text).not.toContain(e.B.empresaId);
    // B repite su propia dirección y su configuración sigue igual.
    exigirEstado(
      await putCarta(e.B.tokenAdmin, { nombre: 'Rincón', slug: slugB, colorPrincipal: '#1D6B3A' }),
      200,
      'B repite lo suyo',
    );
  });

  it('al cambiar la dirección, la anterior deja de buscarse y la nueva se encuentra', async () => {
    const primera = direccion('antes');
    const segunda = direccion('despues');
    const token = e.A.tokenAdmin;
    const actual = await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' });
    const nombre = (actual.body.nombre as string | null) ?? 'Sabor Norteño';
    exigirEstado(
      await putCarta(token, { nombre, slug: primera, colorPrincipal: '#B3261E' }),
      200,
      'primera',
    );
    expect(await buscarEmpresaDeCarta(sequelize, primera)).toBe(e.A.empresaId);
    exigirEstado(
      await putCarta(token, { nombre, slug: segunda, colorPrincipal: '#B3261E' }),
      200,
      'segunda',
    );
    expect(await buscarEmpresaDeCarta(sequelize, primera)).toBeNull();
    expect(await buscarEmpresaDeCarta(sequelize, segunda)).toBe(e.A.empresaId);
  });

  it('dos empresas que piden la misma dirección a la vez: exactamente una la consigue', async () => {
    const slug = direccion('carrera');
    const [a, b] = await Promise.all([
      putCarta(e.A.tokenAdmin, { nombre: 'A', slug, colorPrincipal: '#B3261E' }),
      putCarta(e.B.tokenAdmin, { nombre: 'B', slug, colorPrincipal: '#1D6B3A' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ganadora = a.status === 200 ? e.A.empresaId : e.B.empresaId;
    expect(await buscarEmpresaDeCarta(sequelize, slug)).toBe(ganadora);
    // Cada una vuelve a una dirección propia para no estorbar a las demás pruebas.
    await putCarta(e.A.tokenAdmin, { nombre: 'A', slug: direccion(), colorPrincipal: '#B3261E' });
    await putCarta(e.B.tokenAdmin, { nombre: 'B', slug: direccion(), colorPrincipal: '#1D6B3A' });
  });
});

describe('criterio 3 · logo', () => {
  async function conCarta(token: string): Promise<void> {
    const res = await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' });
    if (res.body.configurada === true) return;
    exigirEstado(
      await putCarta(token, { nombre: 'Logo', slug: direccion('logo'), colorPrincipal: '#1D4A9E' }),
      200,
      'configurar para el logo',
    );
  }

  it('sin la configuración de la carta web es 409 CARTA_WEB_SIN_CONFIGURAR y no guarda nada', async () => {
    const c = await altaEmpresa(ctx, e.sa);
    const antes = ctx.almacen.claves().length;
    const res = await subirLogo(c.admin.token, 'image/png', pngValido(200, 200));
    esperarError(res, 409, 'CARTA_WEB_SIN_CONFIGURAR');
    // El archivo recién subido no queda huérfano... ni siquiera se sube.
    expect(ctx.almacen.claves().length).toBe(antes);
    // Quitar el logo sin configuración no falla ni deja nada.
    exigirEstado(
      await llamar(ctx, c.admin.token, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'quitar',
    );
  });

  it('un PNG válido queda bajo carta-web/<empresa>/; reemplazarlo borra el archivo anterior; quitarlo borra el último', async () => {
    const token = e.A.tokenAdmin;
    await conCarta(token);
    const primero = await subirLogo(token, 'image/png', pngValido(240, 240));
    exigirEstado(primero, 200, 'subir el logo');
    const url1 = primero.body.logoUrl as string;
    const clave1 = url1.slice(url1.indexOf('carta-web/'));
    expect(clave1).toMatch(new RegExp(`^carta-web/${e.A.empresaId}/[0-9a-f-]{36}\\.png$`));
    expect(ctx.almacen.obtener(clave1)?.tipo).toBe('image/png');

    const segundo = await subirLogo(token, 'image/png', pngValido(300, 300));
    exigirEstado(segundo, 200, 'cambiar el logo');
    const url2 = segundo.body.logoUrl as string;
    const clave2 = url2.slice(url2.indexOf('carta-web/'));
    expect(clave2).not.toBe(clave1);
    await vi.waitFor(() => expect(ctx.almacen.obtener(clave1)).toBeUndefined());
    expect(ctx.almacen.obtener(clave2)).toBeDefined();

    const carta = await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' });
    expect(carta.body.logoUrl).toBe(url2);

    exigirEstado(
      await llamar(ctx, token, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'quitar',
    );
    await vi.waitFor(() => expect(ctx.almacen.obtener(clave2)).toBeUndefined());
    expect(
      (await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' })).body.logoUrl,
    ).toBeNull();
    // Quitarlo otra vez no falla.
    exigirEstado(
      await llamar(ctx, token, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'otra vez',
    );
  });

  it('rechaza lo que no es una imagen entera, con otro tipo, de 63 o 2049 píxeles, de más de 1 MB o de otro formato', async () => {
    const token = e.A.tokenAdmin;
    await conCarta(token);
    const antes = ctx.almacen.claves().length;
    esperarError(
      await subirLogo(token, 'image/png', Buffer.from('no es una imagen')),
      422,
      'FOTO_INVALIDA',
    );
    esperarError(await subirLogo(token, 'image/jpeg', pngValido(200, 200)), 422, 'FOTO_INVALIDA');
    esperarError(await subirLogo(token, 'image/png', pngValido(63, 200)), 422, 'FOTO_INVALIDA');
    esperarError(await subirLogo(token, 'image/png', pngValido(2049, 100)), 422, 'FOTO_INVALIDA');
    esperarError(await subirLogo(token, 'image/gif', Buffer.alloc(10)), 415, 'TIPO_NO_SOPORTADO');
    esperarError(
      await subirLogo(token, 'image/png', Buffer.alloc(MB + 1)),
      413,
      'CUERPO_DEMASIADO_GRANDE',
    );
    expect(ctx.almacen.claves().length).toBe(antes);
    // Los límites de lado son válidos: 64 y 2048.
    exigirEstado(await subirLogo(token, 'image/png', pngValido(64, 64)), 200, '64 px');
    exigirEstado(await subirLogo(token, 'image/png', pngValido(2048, 16 + 48)), 200, '2048 px');
  });

  it('el logo de una empresa nunca borra un archivo de otra', async () => {
    await conCarta(e.A.tokenAdmin);
    await conCarta(e.B.tokenAdmin);
    const deB = await subirLogo(e.B.tokenAdmin, 'image/png', pngValido(200, 200));
    exigirEstado(deB, 200, 'logo de B');
    const claveB = (deB.body.logoUrl as string).slice(
      (deB.body.logoUrl as string).indexOf('carta-web/'),
    );
    exigirEstado(
      await subirLogo(e.A.tokenAdmin, 'image/png', pngValido(220, 220)),
      200,
      'logo de A',
    );
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, { metodo: 'delete', ruta: '/carta-web/logo' }),
      204,
      'quitar A',
    );
    expect(ctx.almacen.obtener(claveB)).toBeDefined();
  });
});

describe('criterio 4 · sucursal', () => {
  it('sin la configuración de la empresa es 409; una sucursal de otra empresa o inexistente, 404', async () => {
    // La empresa C: sin carta web.
    const c = await altaEmpresa(ctx, e.sa);
    const sucursalC = c.sucursales[0]!.id;
    esperarError(
      await putSucursal(c.admin.token, sucursalC, { slug: 'centro', publicada: true }),
      409,
      'CARTA_WEB_SIN_CONFIGURAR',
    );
    const deB = await putSucursal(e.A.tokenAdmin, e.B.S1, { slug: 'barranco', publicada: true });
    esperarError(deB, 404, 'NO_ENCONTRADO');
    const inexistente = await putSucursal(e.A.tokenAdmin, randomUUID(), {
      slug: 'barranco',
      publicada: true,
    });
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(JSON.stringify(deB.body).replace(e.B.S1, '<id>')).toBe(
      JSON.stringify(inexistente.body).replace(/[0-9a-f-]{36}/, '<id>'),
    );
  });

  it('la dirección es única entre las sucursales de la empresa (409), pero otra empresa puede usar la misma', async () => {
    for (const token of [e.A.tokenAdmin, e.B.tokenAdmin]) {
      const actual = await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' });
      if (actual.body.configurada !== true) {
        exigirEstado(
          await putCarta(token, { nombre: 'X', slug: direccion('suc'), colorPrincipal: '#1D4A9E' }),
          200,
          'configurar',
        );
      }
    }
    exigirEstado(
      await putSucursal(e.A.tokenAdmin, e.A.S1, { slug: 'centro-comun', publicada: false }),
      200,
      'S1',
    );
    const repetida = await putSucursal(e.A.tokenAdmin, e.A.S2, {
      slug: 'centro-comun',
      publicada: true,
    });
    esperarError(repetida, 409, 'CONFLICTO');
    exigirEstado(
      await putSucursal(e.B.tokenAdmin, e.B.S1, { slug: 'centro-comun', publicada: true }),
      200,
      'B',
    );
    // Reservada y mal formada.
    esperarError(
      await putSucursal(e.A.tokenAdmin, e.A.S2, { slug: 'api', publicada: true }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await putSucursal(e.A.tokenAdmin, e.A.S2, {
        slug: 'centro-comun',
        publicada: true,
        extra: 1,
      }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('responde la fila de la sucursal con su enlace y se puede despublicar', async () => {
    const carta = await llamar(ctx, e.A.tokenAdmin, { metodo: 'get', ruta: '/carta-web' });
    const slugEmpresa = carta.body.slug as string;
    const res = await putSucursal(e.A.tokenAdmin, e.A.S3!, { slug: 'san-isidro', publicada: true });
    exigirEstado(res, 200, 'S3');
    expect(res.body).toMatchObject({
      sucursalId: e.A.S3,
      slug: 'san-isidro',
      publicada: true,
      url: `${CARTA_WEB_URL}/${slugEmpresa}/san-isidro`,
    });
    const quitada = await putSucursal(e.A.tokenAdmin, e.A.S3!, {
      slug: 'san-isidro',
      publicada: false,
    });
    expect(quitada.body.publicada).toBe(false);
  });
});

describe('criterios 7 a 9 · hoja de QR', () => {
  const CODIGO = /^[A-Za-z0-9_-]{22}$/;

  async function zonaConMesas(token: string, sucursalId: string, nombres: string[]) {
    const zona = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${sucursalId}/zonas`,
      cuerpo: { nombre: `Zona ${randomUUID().slice(0, 6)}`, columnas: 6, filas: 6 },
    });
    exigirEstado(zona, 201, 'crear la zona');
    const ids: string[] = [];
    for (const [i, nombre] of nombres.entries()) {
      const mesa = await llamar(ctx, token, {
        metodo: 'post',
        ruta: `/sucursales/${sucursalId}/zonas/${zona.body.id as string}/mesas`,
        cuerpo: { nombre, capacidad: 4, forma: 'CUADRADA', columna: i + 1, fila: 1 },
      });
      exigirEstado(mesa, 201, `crear la mesa ${nombre}`);
      ids.push(mesa.body.id as string);
    }
    return { zonaId: zona.body.id as string, ids };
  }

  const hoja = (token: string, sucursalId: string) =>
    llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${sucursalId}/qr-mesas` });

  it('lista las mesas activas de las zonas activas en el orden del mapa con su código y su enlace', async () => {
    const token = e.A.tokenAdmin;
    const sufijo = randomUUID().slice(0, 4);
    const { zonaId, ids } = await zonaConMesas(token, e.A.S1, [
      `Q1-${sufijo}`,
      `Q2-${sufijo}`,
      `Q3-${sufijo}`,
    ]);
    // Una mesa inactiva y una zona inactiva no salen.
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${ids[2]!}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la mesa',
    );
    const otra = await zonaConMesas(token, e.A.S1, [`Z1-${sufijo}`]);
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${otra.ids[0]!}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la mesa de la zona',
    );
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/zonas/${otra.zonaId}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la zona',
    );
    const res = await hoja(token, e.A.S1);
    exigirEstado(res, 200, 'hoja');
    expect(Object.keys(res.body as object).sort()).toEqual(['cartaPublicada', 'mesas', 'sucursal']);
    expect(res.body.sucursal.id).toBe(e.A.S1);
    const mesas = res.body.mesas as {
      mesaId: string;
      zona: { id: string };
      nombre: string;
      codigo: string;
      url: string;
      generadoEn: string;
    }[];
    const nuestras = mesas.filter((m) => m.zona.id === zonaId);
    expect(nuestras.map((m) => m.nombre)).toEqual([`Q1-${sufijo}`, `Q2-${sufijo}`]);
    expect(mesas.some((m) => m.zona.id === otra.zonaId)).toBe(false);
    for (const m of nuestras) {
      expect(m.codigo).toMatch(CODIGO);
      expect(m.url).toBe(`${CARTA_WEB_URL}/m/${m.codigo}`);
      expect(new Date(m.generadoEn).toISOString()).toBe(m.generadoEn);
    }
  });

  it('cartaPublicada refleja la publicación de la sucursal', async () => {
    const token = e.A.tokenAdmin;
    const antes = await hoja(token, e.A.S2);
    expect(antes.body.cartaPublicada).toBe(false);
    exigirEstado(
      await putSucursal(token, e.A.S2, { slug: 'hoja-s2', publicada: true }),
      200,
      'publicar',
    );
    expect((await hoja(token, e.A.S2)).body.cartaPublicada).toBe(true);
    exigirEstado(
      await putSucursal(token, e.A.S2, { slug: 'hoja-s2', publicada: false }),
      200,
      'despublicar',
    );
    expect((await hoja(token, e.A.S2)).body.cartaPublicada).toBe(false);
  });

  it('una sucursal de B o inexistente es 404 con el mismo cuerpo', async () => {
    const deB = await hoja(e.A.tokenAdmin, e.B.S1);
    const inexistente = await hoja(e.A.tokenAdmin, randomUUID());
    esperarError(deB, 404, 'NO_ENCONTRADO');
    expect(deB.body).toEqual(inexistente.body);
    esperarError(
      await llamar(ctx, e.A.tokenAdmin, { metodo: 'post', ruta: `/sucursales/${e.B.S1}/qr-mesas` }),
      404,
      'NO_ENCONTRADO',
    );
  });

  it('una mesa sin código (anterior a la sección) lo recibe al crear los que faltan, sin cambiar los demás', async () => {
    const token = e.B.tokenAdmin;
    const { ids } = await zonaConMesas(token, e.B.S1, ['F1', 'F2']);
    const antes = (await hoja(token, e.B.S1)).body.mesas as { mesaId: string; codigo: string }[];
    // Una mesa creada "antes de la sección": se quita su código como administrador de la base.
    await admin.query('BEGIN');
    try {
      await admin.query('DELETE FROM mesa_qr WHERE mesa_id = $1', [ids[1]]);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
    const sin = await hoja(token, e.B.S1);
    const fila = (
      sin.body.mesas as {
        mesaId: string;
        codigo: string | null;
        url: unknown;
        generadoEn: unknown;
      }[]
    ).find((m) => m.mesaId === ids[1]);
    expect(fila).toMatchObject({ codigo: null, url: null, generadoEn: null });

    const creados = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${e.B.S1}/qr-mesas`,
    });
    exigirEstado(creados, 200, 'crear los que faltan');
    const despues = creados.body.mesas as { mesaId: string; codigo: string }[];
    expect(despues.find((m) => m.mesaId === ids[1])?.codigo).toMatch(CODIGO);
    for (const previa of antes.filter((m) => m.mesaId !== ids[1])) {
      expect(despues.find((m) => m.mesaId === previa.mesaId)?.codigo).toBe(previa.codigo);
    }
    expect(despues.some((m) => m.mesaId === ids[0])).toBe(true);
    // Repetirlo no cambia ningún código.
    const otra = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${e.B.S1}/qr-mesas`,
    });
    expect(otra.body.mesas).toEqual(despues);
  });

  it('cambiar el QR de una mesa sin código le crea el primero', async () => {
    const token = e.B.tokenAdmin;
    const { ids } = await zonaConMesas(token, e.B.S2, ['G1']);
    await admin.query('DELETE FROM mesa_qr WHERE mesa_id = $1', [ids[0]]);
    const res = await llamar(ctx, token, {
      metodo: 'post',
      ruta: `/sucursales/${e.B.S2}/mesas/${ids[0]!}/qr`,
      cabeceras: { 'Idempotency-Key': randomUUID() },
    });
    exigirEstado(res, 201, 'cambiar el QR');
    expect(res.body.codigo).toMatch(CODIGO);
    const guardado = await admin.query('SELECT codigo FROM mesa_qr WHERE mesa_id = $1', [ids[0]]);
    expect(guardado.rows[0].codigo).toBe(res.body.codigo);
  });
});

describe('criterio 5 · ADMINISTRAR', () => {
  it('los demás roles reciben 403 en la configuración y en la hoja de QR', async () => {
    for (const persona of [e.A.mozo, e.A.cajero, e.A.supervisor, e.A.cocina]) {
      const token = await sesionContrasena(ctx, persona, e.A.S1);
      esperarError(
        await llamar(ctx, token, { metodo: 'get', ruta: '/carta-web' }),
        403,
        'PROHIBIDO',
      );
      esperarError(
        await llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${e.A.S1}/qr-mesas` }),
        403,
        'PROHIBIDO',
      );
    }
  });
});

describe('criterio 3 · cuerpo binario del logo', () => {
  it('la subida del logo se trata como la de una foto: si se rechaza sin leer el cuerpo, se cierra la conexión', async () => {
    expect(esSubidaDeFoto('PUT', '/carta-web/logo')).toBe(true);
    expect(esSubidaDeFoto('PUT', '/carta-web/logo/')).toBe(true);
    expect(esSubidaDeFoto('PUT', `/carta/productos/${randomUUID()}/foto`)).toBe(true);
    expect(esSubidaDeFoto('GET', '/carta-web/logo')).toBe(false);
    expect(esSubidaDeFoto('PUT', '/carta-web')).toBe(false);
    expect(esSubidaDeFoto('PUT', '/carta-web/logo/otra')).toBe(false);
  });
});
