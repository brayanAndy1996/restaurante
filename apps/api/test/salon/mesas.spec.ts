// Historia 004 · salón y cocina, grupo C1 · mesas del mapa (criterios 3, 4 y 6) y `MesasConsultaService`
// (listar y bloquear por id): pruebas del desarrollador (no protegidas). El aislamiento entre empresas y los
// permisos de todas las rutas los cubren las pruebas protegidas de `salon-critica/`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { MesasConsultaService, UsoDeMesas } from '../../src/modulos/salon';
import { esperarError, filasAuditoria, llamar, type Libre } from '../acceso/fabrica-equipos';
import {
  arrancarMapa,
  crearMesa,
  crearZona,
  mesaCreada,
  unico,
  zonaCreada,
  type EntornoMapa,
} from './ayudas-mapa';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let e: EntornoMapa;
let S1: string;
let S2: string;
let S3: string;

beforeAll(async () => {
  e = await arrancarMapa();
  [S1, S2, S3] = e.A.sucursales.map((s) => s.id) as [string, string, string];
});

afterAll(async () => {
  await e?.entorno.cerrar();
});

const rutaMesa = (sucursalId: string, id: string) => `/sucursales/${sucursalId}/mesas/${id}`;
const modificar = (sucursalId: string, id: string, cuerpo: unknown, token = e.admin) =>
  llamar(e.app, 'patch', rutaMesa(sucursalId, id), { token, cuerpo });
const auditoriaDe = async (accion: string, sucursalId: string) =>
  (await filasAuditoria(e.A.id, accion)).filter((f) => f.sucursal_id === sucursalId);

describe('criterio 3 · crear mesas', () => {
  it('responde 201 con la forma del contrato, activa y en la celda pedida', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 4, filas: 3 });
    const nombre = unico('Mesa');
    const res = await crearMesa(e.app, e.admin, S1, zona.id, {
      nombre,
      capacidad: 6,
      forma: 'RECTANGULAR',
      columna: 3,
      fila: 2,
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      zonaId: zona.id,
      nombre,
      capacidad: 6,
      forma: 'RECTANGULAR',
      columna: 3,
      fila: 2,
      activa: true,
    });
  });

  it('valida nombre (1 a 20), capacidad (1 a 50), forma y campos desconocidos', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 12, filas: 30 });
    const malos: Libre[] = [
      { nombre: '' },
      { nombre: 'x'.repeat(21) },
      { capacidad: 0 },
      { capacidad: 51 },
      { capacidad: 2.5 },
      { forma: 'TRIANGULAR' },
      { forma: 'redonda' },
      { columna: 0 },
      { fila: 0 },
      { columna: 13 },
      { fila: 31 },
      { zonaId: zona.id },
      { activa: false },
      { sucursalId: S1 },
    ];
    for (const cuerpo of malos) {
      const res = await crearMesa(e.app, e.admin, S1, zona.id, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    }
    for (const [i, cuerpo] of [
      { nombre: 'x'.repeat(20), capacidad: 1, forma: 'REDONDA', columna: 12, fila: 30 },
      { capacidad: 50, forma: 'RECTANGULAR', columna: 1, fila: 30 },
    ].entries()) {
      const res = await crearMesa(e.app, e.admin, S1, zona.id, {
        ...cuerpo,
        nombre: i === 0 ? cuerpo.nombre : unico('M'),
      });
      expect(res.status, JSON.stringify(cuerpo)).toBe(201);
    }
  });

  it('la celda debe caer dentro de la cuadrícula de la zona (400 con la columna o la fila señaladas); los bordes sí valen', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 3, filas: 2 });
    const fueraColumna = await crearMesa(e.app, e.admin, S1, zona.id, { columna: 4, fila: 1 });
    esperarError(fueraColumna, 400, 'DATOS_INVALIDOS');
    expect(fueraColumna.body.campos.map((c: Libre) => c.campo)).toEqual(['columna']);
    const fueraFila = await crearMesa(e.app, e.admin, S1, zona.id, { columna: 1, fila: 3 });
    esperarError(fueraFila, 400, 'DATOS_INVALIDOS');
    expect(fueraFila.body.campos.map((c: Libre) => c.campo)).toEqual(['fila']);
    const fueraAmbas = await crearMesa(e.app, e.admin, S1, zona.id, { columna: 9, fila: 9 });
    expect(fueraAmbas.body.campos.map((c: Libre) => c.campo).sort()).toEqual(['columna', 'fila']);
    expect((await crearMesa(e.app, e.admin, S1, zona.id, { columna: 1, fila: 1 })).status).toBe(
      201,
    );
    expect((await crearMesa(e.app, e.admin, S1, zona.id, { columna: 3, fila: 2 })).status).toBe(
      201,
    );
  });

  it('una celda con otra mesa activa responde 409 CONFLICTO con campos en columna y fila; la de una mesa inactiva queda libre', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    const primera = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 2, fila: 2 });
    const repetida = await crearMesa(e.app, e.admin, S1, zona.id, { columna: 2, fila: 2 });
    esperarError(repetida, 409, 'CONFLICTO');
    expect(repetida.body.campos.map((c: Libre) => c.campo).sort()).toEqual(['columna', 'fila']);
    await modificar(S1, primera.id, { activa: false });
    expect((await crearMesa(e.app, e.admin, S1, zona.id, { columna: 2, fila: 2 })).status).toBe(
      201,
    );
    // La misma celda en otra zona es otra celda.
    const otra = await zonaCreada(e.app, e.admin, S1);
    expect((await crearMesa(e.app, e.admin, S1, otra.id, { columna: 2, fila: 2 })).status).toBe(
      201,
    );
  });

  it('el nombre es único entre las mesas activas de la sucursal sin distinguir mayúsculas, entre zonas; en otra sucursal sí se repite', async () => {
    const zonaA = await zonaCreada(e.app, e.admin, S1);
    const zonaB = await zonaCreada(e.app, e.admin, S1);
    const zonaS2 = await zonaCreada(e.app, e.admin, S2);
    const nombre = unico('Barra');
    const primera = await mesaCreada(e.app, e.admin, S1, zonaA.id, { nombre });
    const repetida = await crearMesa(e.app, e.admin, S1, zonaB.id, {
      nombre: nombre.toLowerCase(),
    });
    esperarError(repetida, 409, 'CONFLICTO');
    expect(repetida.body.campos.map((c: Libre) => c.campo)).toEqual(['nombre']);
    expect((await crearMesa(e.app, e.admin, S2, zonaS2.id, { nombre })).status).toBe(201);
    expect(
      (
        await crearMesa(
          e.app,
          e.adminB,
          e.B.sucursales[0]!.id,
          ...[(await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id)).id as string, { nombre }],
        )
      ).status,
    ).toBe(201);
    // Con la mesa desactivada, el nombre queda libre.
    await modificar(S1, primera.id, { activa: false });
    expect((await crearMesa(e.app, e.admin, S1, zonaB.id, { nombre })).status).toBe(201);
  });

  it('una zona de otra sucursal, de B o inexistente en la ruta responde 404 con el mismo cuerpo', async () => {
    const deS2 = await zonaCreada(e.app, e.admin, S2);
    const deB = await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id);
    const cuerpos = new Set<string>();
    for (const id of [deS2.id, deB.id, randomUUID()]) {
      const res = await crearMesa(e.app, e.admin, S1, id);
      esperarError(res, 404, 'NO_ENCONTRADO');
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
  });

  it('dos mesas con el mismo nombre o la misma celda a la vez: una se crea y la otra responde 409', async () => {
    const zona = await zonaCreada(e.app, e.admin, S3, { columnas: 5, filas: 5 });
    const nombre = unico('Carrera');
    const mismoNombre = await Promise.all([
      crearMesa(e.app, e.admin, S3, zona.id, { nombre, columna: 1, fila: 1 }),
      crearMesa(e.app, e.admin, S3, zona.id, { nombre: nombre.toUpperCase(), columna: 2, fila: 1 }),
    ]);
    expect(mismoNombre.map((r) => r.status).sort()).toEqual([201, 409]);
    const mismaCelda = await Promise.all([
      crearMesa(e.app, e.admin, S3, zona.id, { columna: 4, fila: 4 }),
      crearMesa(e.app, e.admin, S3, zona.id, { columna: 4, fila: 4 }),
      crearMesa(e.app, e.admin, S3, zona.id, { columna: 4, fila: 4 }),
    ]);
    expect(mismaCelda.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });
});

describe('criterio 4 · editar mesas', () => {
  it('cambia nombre, capacidad, forma y celda, y responde con la mesa completa', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 6, filas: 6 });
    const mesa = await mesaCreada(e.app, e.admin, S1, zona.id);
    const nombre = unico('Nueva');
    const res = await modificar(S1, mesa.id, {
      nombre,
      capacidad: 8,
      forma: 'REDONDA',
      columna: 5,
      fila: 6,
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      ...mesa,
      nombre,
      capacidad: 8,
      forma: 'REDONDA',
      columna: 5,
      fila: 6,
    });
  });

  it('exige al menos un campo y rechaza valores inválidos o desconocidos', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    const mesa = await mesaCreada(e.app, e.admin, S1, zona.id);
    for (const cuerpo of [
      {},
      { capacidad: 0 },
      { forma: 'X' },
      { nombre: '' },
      { x: 1 },
      { zonaId: 'no' },
    ]) {
      const res = await modificar(S1, mesa.id, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
  });

  it('aplica las reglas del criterio 3 sobre el resultado: celda fuera de la zona (400), celda y nombre ocupados (409)', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 3, filas: 3 });
    const a = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 1, fila: 1 });
    const b = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 2, fila: 1 });
    esperarError(await modificar(S1, b.id, { columna: 4 }), 400, 'DATOS_INVALIDOS');
    esperarError(await modificar(S1, b.id, { fila: 4 }), 400, 'DATOS_INVALIDOS');
    const celda = await modificar(S1, b.id, { columna: 1 });
    esperarError(celda, 409, 'CONFLICTO');
    expect(celda.body.campos.map((c: Libre) => c.campo).sort()).toEqual(['columna', 'fila']);
    const nombre = await modificar(S1, b.id, { nombre: a.nombre.toUpperCase() });
    esperarError(nombre, 409, 'CONFLICTO');
    expect(nombre.body.campos.map((c: Libre) => c.campo)).toEqual(['nombre']);
    // No choca consigo misma: la misma celda, el mismo nombre con otra capitalización.
    expect((await modificar(S1, b.id, { columna: 2, fila: 1 })).status).toBe(200);
    expect((await modificar(S1, b.id, { nombre: b.nombre.toUpperCase() })).status).toBe(200);
  });

  it('cambia una mesa de zona de la misma sucursal; una zona de otra sucursal, de B o inexistente responde 422 REFERENCIA_INVALIDA con el mismo cuerpo', async () => {
    const origen = await zonaCreada(e.app, e.admin, S1);
    const destino = await zonaCreada(e.app, e.admin, S1, { columnas: 2, filas: 2 });
    const mesa = await mesaCreada(e.app, e.admin, S1, origen.id, { columna: 2, fila: 2 });
    const movida = await modificar(S1, mesa.id, { zonaId: destino.id });
    expect(movida.status, movida.text).toBe(200);
    expect(movida.body.zonaId).toBe(destino.id);
    // La celda se valida contra la zona nueva.
    const enS2 = await zonaCreada(e.app, e.admin, S2);
    const enB = await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id);
    const cuerpos = new Set<string>();
    for (const zonaId of [enS2.id, enB.id, randomUUID()]) {
      const res = await modificar(S1, mesa.id, { zonaId });
      esperarError(res, 422, 'REFERENCIA_INVALIDA');
      expect(res.body.campos.map((c: Libre) => c.campo)).toEqual(['zonaId']);
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    const chica = await zonaCreada(e.app, e.admin, S1, { columnas: 2, filas: 1 });
    esperarError(await modificar(S1, mesa.id, { zonaId: chica.id }), 400, 'DATOS_INVALIDOS');
    const sigue = await llamar(e.app, 'get', `/sucursales/${S1}/zonas`, { token: e.admin });
    const lista = (sigue.body as Libre[]).find((z) => z.id === destino.id)!;
    expect(lista.mesas.map((m: Libre) => m.id)).toContain(mesa.id);
  });

  it('no se pone una mesa activa en una zona desactivada', async () => {
    const activa = await zonaCreada(e.app, e.admin, S1);
    const apagada = await zonaCreada(e.app, e.admin, S1);
    await llamar(e.app, 'patch', `/sucursales/${S1}/zonas/${apagada.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    const mesa = await mesaCreada(e.app, e.admin, S1, activa.id);
    esperarError(await modificar(S1, mesa.id, { zonaId: apagada.id }), 409, 'CONFLICTO');
  });

  it('desactivar y reactivar: la mesa inactiva sigue en la zona, no se borra, y al reactivar vuelve a validarse', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    const a = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 1, fila: 1 });
    const off = await modificar(S1, a.id, { activa: false });
    expect(off.status).toBe(200);
    expect(off.body.activa).toBe(false);
    const b = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 1, fila: 1 });
    esperarError(await modificar(S1, a.id, { activa: true }), 409, 'CONFLICTO');
    await modificar(S1, b.id, { activa: false });
    expect((await modificar(S1, a.id, { activa: true })).body.activa).toBe(true);
    const lista = await llamar(e.app, 'get', `/sucursales/${S1}/zonas`, { token: e.admin });
    const mesas = (lista.body as Libre[]).find((z) => z.id === zona.id)!.mesas as Libre[];
    expect(mesas.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('desactivar una mesa con orden abierta responde 409 EN_USO; moverla de celda o de zona sí se puede', async () => {
    const usos = e.app.get(UsoDeMesas);
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 5, filas: 5 });
    const ocupada = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 1, fila: 1 });
    const libre = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 2, fila: 1 });
    // El módulo de pedidos registra cómo saber qué mesas tienen una orden abierta; aquí, un comprobador propio.
    usos.registrar(async (ids) => ids.filter((id) => id === ocupada.id));
    esperarError(await modificar(S1, ocupada.id, { activa: false }), 409, 'EN_USO');
    const movida = await modificar(S1, ocupada.id, { columna: 4, fila: 4, capacidad: 2 });
    expect(movida.status, movida.text).toBe(200);
    expect(movida.body).toMatchObject({ columna: 4, fila: 4, capacidad: 2, activa: true });
    expect((await modificar(S1, libre.id, { activa: false })).status).toBe(200);
  });

  it('una mesa de otra sucursal de A, de B o inexistente responde 404 con el mismo cuerpo y no cambia', async () => {
    const zonaS2 = await zonaCreada(e.app, e.admin, S2);
    const deS2 = await mesaCreada(e.app, e.admin, S2, zonaS2.id);
    const zonaB = await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id);
    const deB = await mesaCreada(e.app, e.adminB, e.B.sucursales[0]!.id, zonaB.id);
    const cuerpos = new Set<string>();
    for (const id of [deS2.id, deB.id, randomUUID()]) {
      const res = await modificar(S1, id, { capacidad: 9 });
      esperarError(res, 404, 'NO_ENCONTRADO');
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    const lista = await llamar(e.app, 'get', `/sucursales/${S2}/zonas`, { token: e.admin });
    const mesa = ((lista.body as Libre[]).find((z) => z.id === zonaS2.id)!.mesas as Libre[])[0]!;
    expect(mesa.capacidad).toBe(4);
  });
});

describe('criterio 6 · auditoría de las mesas', () => {
  it('crear y modificar dejan una fila cada una con la sucursal y el antes y el después; sin cambios no dejan fila', async () => {
    const zona = await zonaCreada(e.app, e.admin, S3, { columnas: 5, filas: 5 });
    const crear = (await auditoriaDe('crear_mesa', S3)).length;
    const cambiar = (await auditoriaDe('modificar_mesa', S3)).length;
    const mesa = await mesaCreada(e.app, e.admin, S3, zona.id, {
      capacidad: 4,
      columna: 1,
      fila: 1,
    });
    const filasCrear = await auditoriaDe('crear_mesa', S3);
    expect(filasCrear).toHaveLength(crear + 1);
    const fila = filasCrear.find((f) => f.entidad_id === mesa.id)!;
    expect(fila.actor_usuario_id).toBe(e.A.admin.id);
    expect(fila.sucursal_id).toBe(S3);
    expect(fila.detalle).toMatchObject({ zonaId: zona.id, nombre: mesa.nombre, capacidad: 4 });

    await modificar(S3, mesa.id, { capacidad: 6, columna: 3 });
    const filasCambiar = await auditoriaDe('modificar_mesa', S3);
    expect(filasCambiar).toHaveLength(cambiar + 1);
    const detalle = filasCambiar.find((f) => f.entidad_id === mesa.id)!.detalle;
    expect(detalle.capacidad).toEqual({ antes: 4, despues: 6 });
    expect(detalle.columna).toEqual({ antes: 1, despues: 3 });
    expect(detalle.fila).toBeUndefined();

    const igual = await modificar(S3, mesa.id, { capacidad: 6 });
    expect(igual.status).toBe(200);
    expect(await auditoriaDe('modificar_mesa', S3)).toHaveLength(cambiar + 1);
  });

  it('una creación repetida con la misma Idempotency-Key no duplica la mesa ni la fila de auditoría', async () => {
    const zona = await zonaCreada(e.app, e.admin, S3, { columnas: 5, filas: 5 });
    const cabeceras = { 'Idempotency-Key': randomUUID() };
    const cuerpo = { nombre: unico('Idem'), capacidad: 2, forma: 'REDONDA', columna: 5, fila: 5 };
    const ruta = `/sucursales/${S3}/zonas/${zona.id}/mesas`;
    const primera = await llamar(e.app, 'post', ruta, { token: e.admin, cuerpo, cabeceras });
    const segunda = await llamar(e.app, 'post', ruta, { token: e.admin, cuerpo, cabeceras });
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    const filas = (await auditoriaDe('crear_mesa', S3)).filter(
      (f) => f.entidad_id === primera.body.id,
    );
    expect(filas).toHaveLength(1);
  });
});

describe('MesasConsultaService', () => {
  const enContexto = <T>(empresaId: string, fn: () => Promise<T>) =>
    e.app.get(ContextoEmpresa).ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });

  it('listar devuelve las zonas de la sucursal con sus mesas en una cantidad fija de consultas', async () => {
    const consulta = e.app.get(MesasConsultaService);
    const sucursal = e.B.sucursales[1]!.id;
    const contar = async (sucursalId: string) => {
      const conexion = (
        consulta as unknown as { conexion: { query: (...a: unknown[]) => unknown } }
      ).conexion;
      const original = conexion.query.bind(conexion);
      let n = 0;
      conexion.query = (...argumentos: unknown[]) => {
        n++;
        return original(...argumentos);
      };
      try {
        const zonas = await enContexto(e.B.id, () => consulta.listar(sucursalId));
        return { n, zonas };
      } finally {
        conexion.query = original;
      }
    };
    const z1 = await zonaCreada(e.app, e.adminB, sucursal, { columnas: 12, filas: 30 });
    await crearZona(e.app, e.adminB, sucursal);
    await mesaCreada(e.app, e.adminB, sucursal, z1.id, { columna: 1, fila: 1 });
    const sinZonas = await contar(randomUUID()).then((r) => r.n); // 1 consulta de zonas + el contexto
    const pocas = await contar(sucursal);
    for (let i = 2; i <= 40; i++) {
      await mesaCreada(e.app, e.adminB, sucursal, z1.id, {
        columna: i % 12 || 12,
        fila: Math.ceil(i / 12),
      });
    }
    const muchas = await contar(sucursal);
    expect(muchas.n).toBe(pocas.n);
    expect(muchas.n).toBe(sinZonas + 1); // zonas y mesas: dos consultas, sin importar cuántas mesas
    expect(muchas.zonas.find((z) => z.id === z1.id)!.mesas).toHaveLength(40);
    expect(muchas.zonas.every((z) => z.sucursalId === sucursal)).toBe(true);
  });

  it('bloquear devuelve las mesas con su sucursal; una de otra sucursal, de B o inexistente es 404 con el mismo cuerpo', async () => {
    const consulta = e.app.get(MesasConsultaService);
    const zona = await zonaCreada(e.app, e.admin, S1);
    const a = await mesaCreada(e.app, e.admin, S1, zona.id);
    const b = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 2 });
    const zonaS2 = await zonaCreada(e.app, e.admin, S2);
    const deS2 = await mesaCreada(e.app, e.admin, S2, zonaS2.id);
    const zonaB = await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id);
    const deB = await mesaCreada(e.app, e.adminB, e.B.sucursales[0]!.id, zonaB.id);

    const ok = await enContexto(e.A.id, () => consulta.bloquear([b.id, a.id, a.id], S1));
    expect(ok.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(ok.every((m) => m.sucursalId === S1)).toBe(true);
    expect(ok.find((m) => m.id === a.id)).toMatchObject({
      zonaId: zona.id,
      nombre: a.nombre,
      activa: true,
    });

    const cuerpos = new Set<string>();
    for (const ids of [[deS2.id], [deB.id], [randomUUID()], [a.id, deS2.id], [a.id, deB.id]]) {
      const error = await enContexto(e.A.id, () => consulta.bloquear(ids, S1)).catch(
        (x: unknown) => x as { estado?: number; codigo?: string; message: string },
      );
      expect(error).toBeInstanceOf(Error);
      cuerpos.add(JSON.stringify([(error as Libre).codigo, (error as Error).message]));
    }
    expect(cuerpos.size).toBe(1);
    expect(await enContexto(e.A.id, () => consulta.bloquear([], S1))).toEqual([]);
  });
});
