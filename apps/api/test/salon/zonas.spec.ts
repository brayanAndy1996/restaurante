// Historia 004 · salón y cocina, grupo C1 · zonas del mapa de mesas (criterios 1, 2, 5 y 6): pruebas del
// desarrollador (no protegidas). El aislamiento entre empresas y la clasificación de permisos de todas las rutas
// los cubren las pruebas protegidas de `salon-critica/`; aquí van los ejemplos de negocio, la auditoría y la
// concurrencia.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { esperarError, filasAuditoria, llamar, type Libre } from '../acceso/fabrica-equipos';
import {
  adminConSucursal,
  arrancarMapa,
  crearMesa,
  crearZona,
  mesaCreada,
  sesionDe,
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

const rutaZonas = (sucursalId: string) => `/sucursales/${sucursalId}/zonas`;
const auditoriaDe = async (accion: string, sucursalId: string) =>
  (await filasAuditoria(e.A.id, accion)).filter((f) => f.sucursal_id === sucursalId);

describe('criterio 1 · crear, listar y ordenar zonas', () => {
  it('responde 201 con la forma del contrato, sin mesas, activa y al final del orden', async () => {
    const nombre = unico('Terraza');
    const primera = await crearZona(e.app, e.admin, S2, { nombre, columnas: 6, filas: 4 });
    expect(primera.status, primera.text).toBe(201);
    expect(primera.body).toEqual({
      id: expect.any(String),
      sucursalId: S2,
      nombre,
      orden: 1,
      columnas: 6,
      filas: 4,
      activa: true,
      mesas: [],
    });
    const segunda = await crearZona(e.app, e.admin, S2);
    expect(segunda.body.orden).toBe(2);
    const tercera = await crearZona(e.app, e.admin, S2);
    expect(tercera.body.orden).toBe(3);
  });

  it('valida los límites: nombre de 1 a 40, columnas de 2 a 12, filas de 1 a 30, sin campos desconocidos', async () => {
    const malos: Libre[] = [
      { nombre: '' },
      { nombre: '   ' },
      { nombre: 'x'.repeat(41) },
      { columnas: 1 },
      { columnas: 13 },
      { columnas: 2.5 },
      { filas: 0 },
      { filas: 31 },
      { filas: '3' },
      { otro: 1 },
      { sucursalId: S1 },
      { empresaId: e.A.id },
    ];
    for (const cuerpo of malos) {
      const res = await crearZona(e.app, e.admin, S3, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    }
    for (const cuerpo of [
      { columnas: 2, filas: 1 },
      { columnas: 12, filas: 30, nombre: 'x'.repeat(40) },
    ]) {
      const res = await crearZona(e.app, e.admin, S3, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(201);
    }
  });

  it('el nombre es único entre las zonas de la sucursal sin distinguir mayúsculas; en otra sucursal o empresa sí se repite', async () => {
    const nombre = unico('Salón');
    expect((await crearZona(e.app, e.admin, S1, { nombre })).status).toBe(201);
    const repetida = await crearZona(e.app, e.admin, S1, { nombre: nombre.toUpperCase() });
    esperarError(repetida, 409, 'CONFLICTO');
    expect(repetida.body.campos).toEqual([expect.objectContaining({ campo: 'nombre' })]);
    expect((await crearZona(e.app, e.admin, S2, { nombre })).status).toBe(201);
    expect((await crearZona(e.app, e.adminB, e.B.sucursales[0]!.id, { nombre })).status).toBe(201);
    // El mismo nombre en una zona desactivada también cuenta como repetido.
    const zona = await zonaCreada(e.app, e.admin, S1);
    await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    esperarError(await crearZona(e.app, e.admin, S1, { nombre: zona.nombre }), 409, 'CONFLICTO');
  });

  it('GET devuelve las zonas en su orden con todas sus mesas, activas e inactivas', async () => {
    const z1 = await zonaCreada(e.app, e.admin, S1, { columnas: 5, filas: 5 });
    const z2 = await zonaCreada(e.app, e.admin, S1);
    const m2 = await mesaCreada(e.app, e.admin, S1, z1.id, { columna: 2, fila: 1 });
    const m1 = await mesaCreada(e.app, e.admin, S1, z1.id, { columna: 1, fila: 1 });
    const m3 = await mesaCreada(e.app, e.admin, S1, z1.id, { columna: 1, fila: 2 });
    await llamar(e.app, 'patch', `/sucursales/${S1}/mesas/${m3.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    const lista = await llamar(e.app, 'get', rutaZonas(S1), { token: e.admin });
    expect(lista.status, lista.text).toBe(200);
    const zonas = lista.body as Libre[];
    const ids = zonas.map((z) => z.id);
    expect(ids.indexOf(z1.id)).toBeLessThan(ids.indexOf(z2.id));
    const zona1 = zonas.find((z) => z.id === z1.id)!;
    expect(zona1.mesas.map((m: Libre) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    expect(zona1.mesas.find((m: Libre) => m.id === m3.id).activa).toBe(false);
    expect(zonas.find((z) => z.id === z2.id)!.mesas).toEqual([]);
    // Cada zona trae solo lo de esta sucursal.
    expect(zonas.every((z) => z.sucursalId === S1)).toBe(true);
  });

  it('PUT /orden reordena con todas las zonas exactamente una vez y audita; con el mismo orden no deja fila', async () => {
    const sucursal = e.A.sucursales[2]!.id;
    const a = await zonaCreada(e.app, e.admin, sucursal);
    const b = await zonaCreada(e.app, e.admin, sucursal);
    const lista = await llamar(e.app, 'get', rutaZonas(sucursal), { token: e.admin });
    const actuales = (lista.body as Libre[]).map((z) => z.id as string);
    expect(actuales).toContain(a.id);
    const invertido = [...actuales].reverse();
    const filasAntes = (await auditoriaDe('ordenar_zonas', sucursal)).length;

    const res = await llamar(e.app, 'put', `${rutaZonas(sucursal)}/orden`, {
      token: e.admin,
      cuerpo: { ids: invertido },
    });
    expect(res.status, res.text).toBe(200);
    expect((res.body as Libre[]).map((z) => z.id)).toEqual(invertido);
    expect((res.body as Libre[]).map((z) => z.orden)).toEqual(invertido.map((_, i) => i + 1));
    const filas = await auditoriaDe('ordenar_zonas', sucursal);
    expect(filas).toHaveLength(filasAntes + 1);
    expect(filas.map((f) => f.detalle)).toContainEqual(
      expect.objectContaining({ antes: actuales, despues: invertido }),
    );
    const get = await llamar(e.app, 'get', rutaZonas(sucursal), { token: e.admin });
    expect((get.body as Libre[]).map((z) => z.id)).toEqual(invertido);

    const igual = await llamar(e.app, 'put', `${rutaZonas(sucursal)}/orden`, {
      token: e.admin,
      cuerpo: { ids: invertido },
    });
    expect(igual.status).toBe(200);
    expect(await auditoriaDe('ordenar_zonas', sucursal)).toHaveLength(filasAntes + 1);
    expect(b.id).toBeTruthy();
  });

  it('PUT /orden rechaza con 400 un id faltante, repetido, inexistente, de otra sucursal o de otra empresa, con el mismo cuerpo', async () => {
    const sucursal = e.A.sucursales[2]!.id;
    const lista = await llamar(e.app, 'get', rutaZonas(sucursal), { token: e.admin });
    const actuales = (lista.body as Libre[]).map((z) => z.id as string);
    expect(actuales.length).toBeGreaterThanOrEqual(2);
    const deOtraSucursal = (await zonaCreada(e.app, e.admin, S2)).id as string;
    const deB = (await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id)).id as string;
    const casos: string[][] = [
      actuales.slice(1),
      [...actuales.slice(1), randomUUID()],
      [...actuales.slice(1), deOtraSucursal],
      [...actuales.slice(1), deB],
    ];
    const cuerpos = new Set<string>();
    for (const ids of casos) {
      const res = await llamar(e.app, 'put', `${rutaZonas(sucursal)}/orden`, {
        token: e.admin,
        cuerpo: { ids },
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    // Un id repetido lo rechaza el esquema, también con 400.
    const repetido = await llamar(e.app, 'put', `${rutaZonas(sucursal)}/orden`, {
      token: e.admin,
      cuerpo: { ids: [...actuales, actuales[0]!] },
    });
    esperarError(repetido, 400, 'DATOS_INVALIDOS');
    // Nada cambió.
    const despues = await llamar(e.app, 'get', rutaZonas(sucursal), { token: e.admin });
    expect((despues.body as Libre[]).map((z) => z.id)).toEqual(actuales);
  });

  it('una creación repetida con la misma Idempotency-Key devuelve la misma zona sin crear otra', async () => {
    const cabeceras = { 'Idempotency-Key': randomUUID() };
    const cuerpo = { nombre: unico('Idem'), columnas: 3, filas: 3 };
    const primera = await llamar(e.app, 'post', rutaZonas(S2), {
      token: e.admin,
      cuerpo,
      cabeceras,
    });
    const segunda = await llamar(e.app, 'post', rutaZonas(S2), {
      token: e.admin,
      cuerpo,
      cabeceras,
    });
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    const lista = await llamar(e.app, 'get', rutaZonas(S2), { token: e.admin });
    expect((lista.body as Libre[]).filter((z) => z.nombre === cuerpo.nombre)).toHaveLength(1);
  });
});

describe('criterio 2 · editar zonas', () => {
  it('cambia nombre, cuadrícula y estado, y responde con la zona completa', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 4, filas: 3 });
    const nombre = unico('Renombrada');
    const res = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { nombre, columnas: 8, filas: 10 },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ ...zona, nombre, columnas: 8, filas: 10 });
    const apagada = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    expect(apagada.body.activa).toBe(false);
    const prendida = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { activa: true },
    });
    expect(prendida.body.activa).toBe(true);
  });

  it('exige al menos un campo y rechaza valores fuera de rango o desconocidos', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    for (const cuerpo of [
      {},
      { columnas: 1 },
      { filas: 31 },
      { nombre: '' },
      { x: 1 },
      { activa: 'si' },
    ]) {
      const res = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
        token: e.admin,
        cuerpo,
      });
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
  });

  it('un nombre que ya tiene otra zona de la sucursal responde 409 CONFLICTO; el propio nombre con otra capitalización no', async () => {
    const a = await zonaCreada(e.app, e.admin, S1);
    const b = await zonaCreada(e.app, e.admin, S1);
    esperarError(
      await llamar(e.app, 'patch', `${rutaZonas(S1)}/${b.id}`, {
        token: e.admin,
        cuerpo: { nombre: a.nombre.toLowerCase() },
      }),
      409,
      'CONFLICTO',
    );
    const propio = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${b.id}`, {
      token: e.admin,
      cuerpo: { nombre: b.nombre.toUpperCase() },
    });
    expect(propio.status, propio.text).toBe(200);
  });

  it('achicar la cuadrícula dejando afuera una mesa activa responde 409 CONFLICTO con las mesas en el mensaje', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1, { columnas: 6, filas: 6 });
    const dentro = await mesaCreada(e.app, e.admin, S1, zona.id, { columna: 2, fila: 2 });
    const afuera = await mesaCreada(e.app, e.admin, S1, zona.id, {
      nombre: unico('Lejos'),
      columna: 6,
      fila: 5,
    });
    const res = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { columnas: 4, filas: 4 },
    });
    esperarError(res, 409, 'CONFLICTO');
    expect(res.body.mensaje).toContain(afuera.nombre);
    expect(res.body.mensaje).not.toContain(dentro.nombre);
    expect(res.body.campos.map((c: Libre) => c.campo).sort()).toEqual(['columnas', 'filas']);
    const sin = await llamar(e.app, 'get', rutaZonas(S1), { token: e.admin });
    expect((sin.body as Libre[]).find((z) => z.id === zona.id)).toMatchObject({
      columnas: 6,
      filas: 6,
    });

    // Con la mesa desactivada la zona sí se achica; una mesa justo en el borde nuevo cabe.
    await llamar(e.app, 'patch', `/sucursales/${S1}/mesas/${afuera.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    const ok = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { columnas: 4, filas: 2 },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ columnas: 4, filas: 2 });
    const ajustado = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { columnas: 2 },
    });
    expect(ajustado.status).toBe(200); // la mesa de la columna 2 sigue dentro
    esperarError(
      await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
        token: e.admin,
        cuerpo: { filas: 1 },
      }),
      409,
      'CONFLICTO',
    );
  });

  it('desactivar una zona con mesas activas responde 409 EN_USO; sin mesas activas se puede', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    const mesa = await mesaCreada(e.app, e.admin, S1, zona.id);
    esperarError(
      await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
        token: e.admin,
        cuerpo: { activa: false },
      }),
      409,
      'EN_USO',
    );
    await llamar(e.app, 'patch', `/sucursales/${S1}/mesas/${mesa.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    const res = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { activa: false },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.activa).toBe(false);
    // No se pone una mesa activa en una zona desactivada.
    esperarError(await crearMesa(e.app, e.admin, S1, zona.id, { columna: 2 }), 409, 'CONFLICTO');
  });

  it('una zona de otra sucursal de A, de B o inexistente responde 404 con el mismo cuerpo', async () => {
    const deS2 = await zonaCreada(e.app, e.admin, S2);
    const deB = await zonaCreada(e.app, e.adminB, e.B.sucursales[0]!.id);
    const cuerpos = new Set<string>();
    for (const id of [deS2.id, deB.id, randomUUID()]) {
      const res = await llamar(e.app, 'patch', `${rutaZonas(S1)}/${id}`, {
        token: e.admin,
        cuerpo: { nombre: unico('Intruso') },
      });
      esperarError(res, 404, 'NO_ENCONTRADO');
      cuerpos.add(JSON.stringify(res.body));
    }
    expect(cuerpos.size).toBe(1);
    const sigue = await llamar(e.app, 'get', rutaZonas(S2), { token: e.admin });
    expect((sigue.body as Libre[]).find((z) => z.id === deS2.id)!.nombre).toBe(deS2.nombre);
  });
});

describe('criterio 5 · quién y dónde', () => {
  it('Mozo, Cajero, Cocina/Barra y Supervisor reciben 403 PROHIBIDO en todas las rutas y no cambia nada', async () => {
    const zona = await zonaCreada(e.app, e.admin, S1);
    const mesa = await mesaCreada(e.app, e.admin, S1, zona.id);
    const antes = (await filasAuditoria(e.A.id)).length;
    for (const persona of [e.mozo, e.cajero, e.cocina, e.supervisor]) {
      const token = await sesionDe(e.app, persona);
      const llamadas: [string, string, unknown][] = [
        ['get', rutaZonas(S1), undefined],
        ['post', rutaZonas(S1), { nombre: unico('Z'), columnas: 3, filas: 3 }],
        ['put', `${rutaZonas(S1)}/orden`, { ids: [zona.id] }],
        ['patch', `${rutaZonas(S1)}/${zona.id}`, { nombre: unico('Z') }],
        [
          'post',
          `${rutaZonas(S1)}/${zona.id}/mesas`,
          { nombre: unico('M'), capacidad: 2, forma: 'REDONDA', columna: 3, fila: 3 },
        ],
        ['patch', `/sucursales/${S1}/mesas/${mesa.id}`, { capacidad: 9 }],
      ];
      for (const [metodo, ruta, cuerpo] of llamadas) {
        const res = await llamar(e.app, metodo as 'get', ruta, {
          token,
          ...(cuerpo !== undefined ? { cuerpo } : {}),
        });
        expect(res.status, `${persona.nombreUsuario} ${metodo} ${ruta}: ${res.text}`).toBe(403);
        expect(res.body.codigo).toBe('PROHIBIDO');
      }
    }
    expect((await filasAuditoria(e.A.id)).length).toBeGreaterThanOrEqual(antes);
    const lista = await llamar(e.app, 'get', rutaZonas(S1), { token: e.admin });
    const guardada = (lista.body as Libre[]).find((z) => z.id === zona.id)!;
    expect(guardada.nombre).toBe(zona.nombre);
    expect(guardada.mesas[0].capacidad).toBe(4);
  });

  it('el Administrador configura cualquier sucursal con o sin sucursal activa', async () => {
    const sin = await llamar(e.app, 'get', rutaZonas(S2), { token: e.admin });
    expect(sin.status).toBe(200);
    const conOtra = await adminConSucursal(e.app, e.A, S1);
    const res = await crearZona(e.app, conOtra, S2);
    expect(res.status, res.text).toBe(201);
    expect(res.body.sucursalId).toBe(S2);
  });

  it('una sucursal de B o inexistente en la ruta responde 404 con el mismo cuerpo y nada cambia', async () => {
    const deB = e.B.sucursales[0]!.id;
    const antes = (await filasAuditoria(e.B.id)).length;
    const cuerpos = new Set<string>();
    for (const id of [deB, randomUUID()]) {
      for (const res of [
        await llamar(e.app, 'get', rutaZonas(id), { token: e.admin }),
        await crearZona(e.app, e.admin, id),
        await llamar(e.app, 'put', `${rutaZonas(id)}/orden`, {
          token: e.admin,
          cuerpo: { ids: [] },
        }),
      ]) {
        esperarError(res, 404, 'NO_ENCONTRADO');
        cuerpos.add(JSON.stringify(res.body));
      }
    }
    expect(cuerpos.size).toBe(1);
    expect((await filasAuditoria(e.B.id)).length).toBe(antes);
    const deLaEmpresaB = await llamar(e.app, 'get', rutaZonas(deB), { token: e.adminB });
    expect(deLaEmpresaB.status).toBe(200);
  });
});

describe('criterio 6 · auditoría', () => {
  it('crear, modificar y ordenar dejan una fila cada una con la sucursal y el antes y el después', async () => {
    const sucursal = S3;
    const crear = (await auditoriaDe('crear_zona', sucursal)).length;
    const modificar = (await auditoriaDe('modificar_zona', sucursal)).length;
    const zona = await zonaCreada(e.app, e.admin, sucursal, { columnas: 4, filas: 4 });
    const filasCrear = await auditoriaDe('crear_zona', sucursal);
    expect(filasCrear).toHaveLength(crear + 1);
    const fila = filasCrear.find((f) => f.entidad_id === zona.id)!;
    expect(fila.actor_usuario_id).toBe(e.A.admin.id);
    expect(fila.sucursal_id).toBe(sucursal);
    expect(fila.entidad_id).toBe(zona.id);
    expect(fila.detalle).toMatchObject({ nombre: zona.nombre, columnas: 4, filas: 4 });

    await llamar(e.app, 'patch', `${rutaZonas(sucursal)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { nombre: unico('Nueva'), filas: 8 },
    });
    const filasModificar = await auditoriaDe('modificar_zona', sucursal);
    expect(filasModificar).toHaveLength(modificar + 1);
    const detalle = filasModificar.find((f) => f.entidad_id === zona.id)!.detalle;
    expect(detalle.filas).toEqual({ antes: 4, despues: 8 });
    expect(detalle.nombre).toEqual({ antes: zona.nombre, despues: expect.any(String) });
    expect(detalle.columnas).toBeUndefined();

    // Un PATCH que no cambia nada responde 200 y no deja fila.
    const sinCambio = await llamar(e.app, 'patch', `${rutaZonas(sucursal)}/${zona.id}`, {
      token: e.admin,
      cuerpo: { filas: 8 },
    });
    expect(sinCambio.status).toBe(200);
    expect(await auditoriaDe('modificar_zona', sucursal)).toHaveLength(modificar + 1);
  });
});

describe('concurrencia', () => {
  it('diez zonas creadas a la vez quedan con órdenes distintos y consecutivos', async () => {
    const sucursal = e.B.sucursales[1]!.id;
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        crearZona(e.app, e.adminB, sucursal, { nombre: `Concurrente ${i}` }),
      ),
    );
    for (const res of respuestas) expect(res.status, res.text).toBe(201);
    const ordenes = respuestas.map((r) => r.body.orden as number).sort((a, b) => a - b);
    expect(ordenes).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it('dos zonas con el mismo nombre a la vez: una se crea y la otra responde 409', async () => {
    const nombre = unico('Gemela');
    const respuestas = await Promise.all([
      crearZona(e.app, e.admin, S3, { nombre }),
      crearZona(e.app, e.admin, S3, { nombre: nombre.toUpperCase() }),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
