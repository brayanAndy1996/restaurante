// Historia 004 · salón y cocina, grupo C2 · el mapa del salón con estados (criterios 7 y 8) y la consulta de la
// orden con ítems (criterio 55): pruebas del desarrollador (no protegidas). Lo que todavía no tiene ruta (ítems,
// pre-cuenta, mesas unidas) se siembra por SQL.
import { randomUUID } from 'node:crypto';
import { salonRespuestaSchema, ordenRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  crearEscenarioP3,
  crearPersona,
  esperarError,
  exigirEstado,
  leerOrden,
  leerSalon,
  llamar,
  sembrarCartaSalon,
  sesiones,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
} from '../salon-critica/fabrica-p3';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { UsuariosConsultaService } from '../../src/modulos/seguridad';
import { contarConsultas, escribir, ponerEstado, sembrarEnvio } from './ayudas-pedidos';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppP3;
let e: EscenarioP3;
let api: Client;
let carta: CartaSalon;
let mesasS1: PoolDeMesas;
let mozo: string;
let cocina: string;
let adminS1: string;

beforeAll(async () => {
  ctx = await arrancarP3();
  api = await abrirCliente('api');
  e = await crearEscenarioP3(ctx);
  carta = await sembrarCartaSalon(ctx, e.A.tokenAdmin);
  mesasS1 = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1);
  mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
  cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
  adminS1 = await sesionContrasena(ctx, e.A.base.admin, e.A.S1);
});

afterAll(async () => {
  await ctx?.cerrar();
  await api?.end();
});

/** Una sucursal propia con una zona de `n` mesas (en una cuadrícula de 12 × 30), para no mezclar los casos. */
async function sucursalConMesas(sucursalId: string, n: number) {
  const pool = new PoolDeMesas(ctx, e.A.tokenAdmin, sucursalId);
  const mesas = [];
  for (let i = 0; i < n; i++) mesas.push(await pool.siguiente());
  return mesas;
}

describe('criterio 7 · GET /salon', () => {
  it('trae las zonas activas de la sucursal activa con sus mesas activas, libres y sin orden, y la hora de la API', async () => {
    const mesa = await mesasS1.siguiente();
    const salon = salonRespuestaSchema.parse(await leerSalon(ctx, mozo));
    expect(salon.sucursalId).toBe(e.A.S1);
    expect(salon.ahora).toBe(ctx.reloj.ahora().toISOString());
    const encontrada = salon.zonas.flatMap((z) => z.mesas).find((m) => m.id === mesa.id)!;
    expect(encontrada).toMatchObject({
      nombre: mesa.nombre,
      capacidad: 4,
      forma: 'CUADRADA',
      estado: 'LIBRE',
      orden: null,
    });
    // Las zonas vienen con su cuadrícula y las mesas en el orden del dibujo (fila y columna).
    const zona = salon.zonas.find((z) => z.id === mesa.zonaId)!;
    expect(zona).toMatchObject({ columnas: 12, filas: 30 });
    const posiciones = zona.mesas.map((m) => m.fila * 100 + m.columna);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it('la sucursal activa decide qué ve cada sesión: S2 no ve las mesas de S1', async () => {
    const deS1 = await mesasS1.siguiente();
    const sesionS2 = (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena;
    const salonS2 = await leerSalon(ctx, sesionS2);
    expect(salonS2.sucursalId).toBe(e.A.S2);
    expect(salonS2.zonas.flatMap((z) => z.mesas).map((m) => m.id)).not.toContain(deS1.id);
  });

  it('el estado sale de la orden: ocupada al abrir, en pre-cuenta y libre al anularla', async () => {
    const mesa = await mesasS1.siguiente();
    const apertura = await abrirOrden(ctx, mozo, { mesaId: mesa.id, comensales: 3 });
    const id = apertura.body.id as string;
    const abierta = (await leerSalon(ctx, mozo)).zonas
      .flatMap((z) => z.mesas)
      .find((m) => m.id === mesa.id)!;
    expect(abierta.estado).toBe('OCUPADA');
    expect(abierta.orden).toEqual({
      id,
      mozo: { id: e.A.mozo.id, nombre: expect.any(String) },
      comensales: 3,
      abiertaEn: ctx.reloj.ahora().toISOString(),
      total: '0.00',
      mesas: [{ id: mesa.id, nombre: mesa.nombre }],
    });
    await ponerEstado(api, e.A.empresaId, id, 'EN_PRECUENTA');
    const enPrecuenta = (await leerSalon(ctx, mozo)).zonas
      .flatMap((z) => z.mesas)
      .find((m) => m.id === mesa.id)!;
    expect(enPrecuenta.estado).toBe('EN_PRECUENTA');
    await ponerEstado(api, e.A.empresaId, id, 'ABIERTA');
    const otraVez = (await leerSalon(ctx, mozo)).zonas
      .flatMap((z) => z.mesas)
      .find((m) => m.id === mesa.id)!;
    expect(otraVez.estado).toBe('OCUPADA');
  });

  it('el total de la orden suma los totales vigentes con packages/dominio (lo anulado no cuenta)', async () => {
    const mesa = await mesasS1.siguiente();
    const apertura = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    const id = apertura.body.id as string;
    await sembrarEnvio(
      api,
      e.A.empresaId,
      { sucursalId: e.A.S1, ordenId: id, estacionId: carta.cocinaId },
      [
        { productoId: carta.lomoId, precio: '33.50', cantidad: 2 },
        { productoId: carta.lomoId, precio: '28.40', cantidad: 3, cantidadAnulada: 1 },
        { productoId: carta.lomoId, precio: '17.00', cantidad: 1, cantidadAnulada: 1 },
      ],
    );
    const enMapa = (await leerSalon(ctx, mozo)).zonas
      .flatMap((z) => z.mesas)
      .find((m) => m.id === mesa.id)!;
    expect(enMapa.orden!.total).toBe('123.80');
    const orden = ordenRespuestaSchema.parse(await leerOrden(ctx, mozo, id));
    expect(orden.total).toBe('123.80');
  });

  it('las mesas unidas comparten la misma orden con todas sus mesas', async () => {
    const principal = await mesasS1.siguiente();
    const unida = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: principal.id })).body.id as string;
    await escribir(api, e.A.empresaId, async () => {
      await api.query(
        `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, creado_en, actualizado_en)
         VALUES ($1, $2, $3, now(), now(), now())`,
        [e.A.empresaId, id, unida.id],
      );
    });
    const mesas = (await leerSalon(ctx, mozo)).zonas.flatMap((z) => z.mesas);
    for (const m of [principal, unida]) {
      const enMapa = mesas.find((x) => x.id === m.id)!;
      expect(enMapa.estado).toBe('OCUPADA');
      expect(enMapa.orden!.id).toBe(id);
      expect(enMapa.orden!.mesas.map((x) => x.id).sort()).toEqual([principal.id, unida.id].sort());
    }
    expect((await leerOrden(ctx, mozo, id)).mesas.map((x) => x.id).sort()).toEqual(
      [principal.id, unida.id].sort(),
    );
  });

  it('una mesa inactiva con orden abierta igual aparece; sin orden no, y una zona inactiva tampoco', async () => {
    const mesa = await mesasS1.siguiente();
    const inactivaLibre = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: mesa.id })).body.id as string;
    await escribir(api, e.A.empresaId, async () => {
      await api.query(`UPDATE mesa SET activa = false WHERE id = ANY($1::uuid[])`, [
        [mesa.id, inactivaLibre.id],
      ]);
    });
    const mesas = (await leerSalon(ctx, mozo)).zonas.flatMap((z) => z.mesas);
    expect(mesas.find((m) => m.id === mesa.id)).toMatchObject({ estado: 'OCUPADA' });
    expect(mesas.find((m) => m.id === mesa.id)!.orden!.id).toBe(id);
    expect(mesas.map((m) => m.id)).not.toContain(inactivaLibre.id);

    const zona = await llamar(ctx, e.A.tokenAdmin, {
      metodo: 'post',
      ruta: `/sucursales/${e.A.S1}/zonas`,
      cuerpo: { nombre: `Cerrada ${randomUUID().slice(0, 6)}`, columnas: 3, filas: 3 },
    });
    exigirEstado(zona, 201, 'crear una zona');
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/zonas/${zona.body.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la zona',
    );
    expect((await leerSalon(ctx, mozo)).zonas.map((z) => z.id)).not.toContain(zona.body.id);
  });

  it('quién puede verlo: Mozo, Cajero, Supervisor y Administrador con sucursal activa; Cocina/Barra 403; sin sucursal activa 409', async () => {
    esperarError(await llamar(ctx, cocina, { metodo: 'get', ruta: '/salon' }), 403, 'PROHIBIDO');
    exigirEstado(
      await llamar(ctx, adminS1, { metodo: 'get', ruta: '/salon' }),
      200,
      'Administrador',
    );
    esperarError(
      await llamar(ctx, e.A.tokenAdmin, { metodo: 'get', ruta: '/salon' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
  });
});

describe('decisión 8 · mozos: quiénes pueden ser el mozo responsable', () => {
  const idsDe = (salon: { mozos: { id: string }[] }) => salon.mozos.map((m) => m.id);

  it('trae a los usuarios activos que atienden mesas en la sucursal activa, por nombre, y ninguno más', async () => {
    const soloS2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S2, rol: 'MOZO' }]);
    const inactivo = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S1, rol: 'MOZO' }]);
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/usuarios/${inactivo.id}`,
        cuerpo: { activo: false },
      }),
      200,
      'desactivar',
    );
    const salon = salonRespuestaSchema.parse(await leerSalon(ctx, mozo));
    const ids = idsDe(salon);
    for (const quien of [e.A.mozo, e.mozo2, e.A.cajero, e.A.supervisor, e.A.base.admin]) {
      expect(ids, `debería estar ${quien.id}`).toContain(quien.id);
    }
    // Cocina/Barra, quien solo tiene S2, el inactivo y todos los de B quedan fuera.
    for (const fuera of [e.A.cocina.id, soloS2.id, inactivo.id, e.B.mozo.id, e.B.base.admin.id]) {
      expect(ids).not.toContain(fuera);
    }
    expect(salon.mozos.every((m) => m.nombre.length > 0)).toBe(true);
    const nombres = salon.mozos.map((m) => m.nombre.toLowerCase());
    expect(nombres).toEqual([...nombres].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // Sin repetidos.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('es la misma lista que POST /ordenes acepta como mozoId (puedenAtenderMesa)', async () => {
    const consulta = ctx.app.get(UsuariosConsultaService);
    const soloS2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S2, rol: 'MOZO' }]);
    const candidatos = [
      e.A.mozo.id,
      e.mozo2.id,
      e.A.cajero.id,
      e.A.supervisor.id,
      e.A.base.admin.id,
      e.A.cocina.id,
      soloS2.id,
      e.B.mozo.id,
    ];
    const aceptados = await ctx.app
      .get(ContextoEmpresa)
      .ejecutar(e.A.empresaId, () => consulta.puedenAtenderMesa(e.A.S1, candidatos), {
        actor: { sistema: 'prueba' },
      });
    const enLista = idsDe(await leerSalon(ctx, mozo));
    expect(enLista.filter((id) => candidatos.includes(id)).sort()).toEqual([...aceptados].sort());
    // El rol que cuenta es el de la sucursal activa: S2 no lista a quien solo atiende en S1, y sí al Cajero (Mozo en S2).
    const enS2 = idsDe(await leerSalon(ctx, (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena));
    expect(enS2).toContain(e.A.cajero.id);
    expect(enS2).toContain(soloS2.id);
    expect(enS2).toContain(e.A.base.admin.id);
    expect(enS2).not.toContain(e.A.mozo.id);
    expect(enS2).not.toContain(e.A.cocina.id);
  });

  it('nunca trae usuarios de otra empresa', async () => {
    const deB = await leerSalon(ctx, (await sesiones(ctx, e.B.mozo, e.B.S1)).contrasena);
    const deA = await leerSalon(ctx, mozo);
    const idsA = new Set(idsDe(deA));
    expect(idsDe(deB)).toContain(e.B.mozo.id);
    expect(idsDe(deB).filter((id) => idsA.has(id))).toEqual([]);
  });

  it('el ETag cambia si entra o sale una persona de la lista (alta, cambio de rol, desactivación) y no si nada cambia', async () => {
    const etagActual = async (): Promise<string> => {
      const res = await llamar(ctx, mozo, { metodo: 'get', ruta: '/salon' });
      exigirEstado(res, 200, 'leer el salón');
      return res.headers.etag as string;
    };
    const base = await etagActual();
    expect(await etagActual()).toBe(base);
    const nueva = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S1, rol: 'MOZO' }]);
    const conNueva = await etagActual();
    expect(conNueva).not.toBe(base);
    const sinCambios = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/salon',
      cabeceras: { 'If-None-Match': conNueva },
    });
    expect(sinCambios.status).toBe(304);
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/usuarios/${nueva.id}`,
        cuerpo: { activo: false },
      }),
      200,
      'desactivar',
    );
    const sinNueva = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/salon',
      cabeceras: { 'If-None-Match': conNueva },
    });
    expect(sinNueva.status).toBe(200);
    expect(sinNueva.headers.etag).not.toBe(conNueva);
    expect(idsDe(sinNueva.body)).not.toContain(nueva.id);
  });
});

describe('criterio 7 · ETag', () => {
  it('trae ETag, responde 304 con If-None-Match igual aunque pase el tiempo, y cambia cuando cambia el mapa', async () => {
    const primera = await llamar(ctx, mozo, { metodo: 'get', ruta: '/salon' });
    exigirEstado(primera, 200, 'primera lectura');
    const etag = primera.headers.etag as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(primera.headers['cache-control']).toBe('private, no-cache');

    ctx.reloj.avanzar(5 * 60_000);
    const igual = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/salon',
      cabeceras: { 'If-None-Match': etag },
    });
    expect(igual.status).toBe(304);
    expect(igual.text).toBe('');
    expect(igual.headers.etag).toBe(etag);
    ctx.reloj.avanzar(-5 * 60_000);

    const mesa = await mesasS1.siguiente();
    const cambiado = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/salon',
      cabeceras: { 'If-None-Match': etag },
    });
    expect(cambiado.status).toBe(200);
    expect(cambiado.headers.etag).not.toBe(etag);
    const nuevo = cambiado.headers.etag as string;
    exigirEstado(await abrirOrden(ctx, mozo, { mesaId: mesa.id }), 201, 'abrir');
    const trasAbrir = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/salon',
      cabeceras: { 'If-None-Match': nuevo },
    });
    expect(trasAbrir.status).toBe(200);
    expect(trasAbrir.headers.etag).not.toBe(nuevo);
  });
});

describe('criterio 7 · número fijo de consultas', () => {
  it('con 5 y con 80 mesas (libres y con órdenes con ítems) GET /salon hace las mismas consultas', async () => {
    const pocas = await sucursalConMesas(e.A.S2, 5);
    const muchas = await sucursalConMesas(e.A.S3!, 80);
    const tokenS2 = await sesionContrasena(ctx, e.A.base.admin, e.A.S2);
    const tokenS3 = await sesionContrasena(ctx, e.A.base.admin, e.A.S3!);
    const leer = (token: string) => llamar(ctx, token, { metodo: 'get', ruta: '/salon' });

    // Sin ninguna orden.
    const vacioPocas = await contarConsultas(ctx, () => leer(tokenS2));
    const vacioMuchas = await contarConsultas(ctx, () => leer(tokenS3));
    exigirEstado(vacioPocas.resultado, 200, 'salón de 5 mesas');
    exigirEstado(vacioMuchas.resultado, 200, 'salón de 80 mesas');
    expect(
      vacioMuchas.resultado.body.zonas.flatMap((z: { mesas: unknown[] }) => z.mesas),
    ).toHaveLength(80);
    expect(vacioMuchas.consultas).toBe(vacioPocas.consultas);

    // Con órdenes: 2 de 5 en la primera, 60 de 80 en la segunda, cada una con ítems.
    const abrir = async (
      token: string,
      sucursalId: string,
      mesas: { id: string }[],
      hasta: number,
    ) => {
      for (const mesa of mesas.slice(0, hasta)) {
        const res = await abrirOrden(ctx, token, { mesaId: mesa.id });
        exigirEstado(res, 201, 'abrir');
        await sembrarEnvio(
          api,
          e.A.empresaId,
          { sucursalId, ordenId: res.body.id as string, estacionId: carta.cocinaId },
          [{ productoId: carta.lomoId, precio: '10.00', cantidad: 2 }],
        );
      }
    };
    await abrir(tokenS2, e.A.S2, pocas, 2);
    await abrir(tokenS3, e.A.S3!, muchas, 60);
    const conPocas = await contarConsultas(ctx, () => leer(tokenS2));
    const conMuchas = await contarConsultas(ctx, () => leer(tokenS3));
    const ocupadas = (r: typeof conMuchas.resultado) =>
      r.body.zonas
        .flatMap((z: { mesas: { estado: string }[] }) => z.mesas)
        .filter((m: { estado: string }) => m.estado === 'OCUPADA');
    expect(ocupadas(conPocas.resultado)).toHaveLength(2);
    expect(ocupadas(conMuchas.resultado)).toHaveLength(60);
    expect(conMuchas.consultas).toBe(conPocas.consultas);
    // Y es el mismo número que sin órdenes: las consultas no dependen de los datos.
    expect(conMuchas.consultas).toBe(vacioPocas.consultas);
  });
});

describe('criterio 55 · la orden con sus ítems', () => {
  it('muestra cada ítem con su envío, cantidades vigentes, totales, modificadores y el conteo de cocina', async () => {
    const mesa = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: mesa.id })).body.id as string;
    const { itemIds } = await sembrarEnvio(
      api,
      e.A.empresaId,
      { sucursalId: e.A.S1, ordenId: id, estacionId: carta.cocinaId },
      [
        {
          productoId: carta.lomoId,
          nombre: 'Lomo saltado',
          precio: '28.00',
          cantidad: 3,
          cantidadAnulada: 1,
          tiempo: 2,
        },
        { productoId: carta.lomoId, nombre: 'Otro', precio: '5.00', cantidad: 1 },
      ],
    );
    const orden = ordenRespuestaSchema.parse(await leerOrden(ctx, mozo, id));
    expect(orden.total).toBe('61.00');
    expect(orden.items.map((i) => i.id)).toEqual(itemIds);
    expect(orden.items[0]).toMatchObject({
      envioNumero: 1,
      esAdicion: false,
      nombre: 'Lomo saltado',
      tipo: 'SIMPLE',
      cantidad: 3,
      cantidadAnulada: 1,
      cantidadVigente: 2,
      precioUnitario: '28.00',
      totalVigente: '56.00',
      modificadores: [{ nombre: 'Jugoso', precioExtra: '0.00' }],
      componentes: [],
      observacion: null,
      tiempo: 2,
      paraLlevar: false,
      marchadoEn: null,
      estado: 'ENVIADO',
      // La línea de la comanda ANULACION no se cuenta: solo las de la comanda original.
      cocina: { enviado: 1, enPreparacion: 0, listo: 0, anulado: 0 },
      comandadoPor: null,
    });
    expect(orden.items[1]!.cocina).toEqual({ enviado: 0, enPreparacion: 0, listo: 1, anulado: 0 });
  });
});
