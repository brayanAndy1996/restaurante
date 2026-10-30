// Historia 004 · entrega 3b, grupo C7 (T37) · impresoras de la sucursal (criterios 103 a 105 y 104 en `EN_USO`):
// pruebas del desarrollador (no protegidas). La clasificación de todas las rutas de 3b, el aislamiento y las
// referencias cruzadas los cubren las protegidas de `impresion-critica/` en cuanto exista el puente (T40); aquí
// van los ejemplos de negocio, la validación, la auditoría, la trazabilidad y la concurrencia con el destino.
import { randomUUID } from 'node:crypto';
import { impresoraRespuestaSchema, type ImpresoraRespuesta } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sesionesDe } from '../carta-critica/fabrica-permisos-carta';
import {
  arrancarP2,
  esperarError,
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type AppP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import {
  auditoriaDe,
  cuerpoBluetooth,
  cuerpoRed,
  impresoraCreada,
  rutaDestino,
  rutaImpresion,
  rutaImpresoras,
  totalAuditoria,
  unico,
} from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;

const A = () => esc.e.A;
const B = () => esc.e.B;
const T = () => esc.token.adminA;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const crear = (sucursalId: string, cuerpo: unknown, token = T(), cabeceras = {}) =>
  llamar(ctx, token, { metodo: 'post', ruta: rutaImpresoras(sucursalId), cuerpo, cabeceras });
const modificar = (sucursalId: string, id: string, cuerpo: unknown, token = T()) =>
  llamar(ctx, token, { metodo: 'patch', ruta: `${rutaImpresoras(sucursalId)}/${id}`, cuerpo });
const listar = (sucursalId: string, token = T()) =>
  llamar(ctx, token, { metodo: 'get', ruta: rutaImpresoras(sucursalId) });
const ponerDestino = (sucursalId: string, estacionId: string, cuerpo: unknown) =>
  llamar(ctx, T(), { metodo: 'put', ruta: rutaDestino(sucursalId, estacionId), cuerpo });
const filaDeImpresora = async (id: string) =>
  (await admin.query('SELECT * FROM impresora WHERE id = $1', [id])).rows[0] as
    Record<string, unknown> | undefined;

describe('criterio 103 · alta', () => {
  it('201 con la forma del contrato: de red con sus valores por defecto, activa y sin señal', async () => {
    const nombre = unico('Cocina');
    const res = await crear(A().S1, {
      nombre,
      conexion: { tipo: 'RED', host: 'impresora-cocina.local' },
      anchoMm: 80,
    });
    exigirEstado(res, 201, 'crear');
    const cuerpo = impresoraRespuestaSchema.parse(res.body);
    expect(cuerpo).toEqual({
      id: expect.any(String),
      sucursalId: A().S1,
      nombre,
      conexion: { tipo: 'RED', host: 'impresora-cocina.local', puerto: 9100 },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
      activa: true,
      estado: 'DESCONOCIDO',
      estadoDesde: null,
      pendientes: 0,
    });
    const fila = await filaDeImpresora(cuerpo.id);
    expect(fila).toMatchObject({
      empresa_id: A().empresaId,
      conexion_tipo: 'RED',
      host: 'impresora-cocina.local',
      puerto: 9100,
      mac: null,
    });
  });

  it('guarda el puerto, el ancho de 58 mm, el juego de caracteres y la gaveta que se pidan', async () => {
    const i = await impresoraCreada(
      ctx,
      T(),
      A().S1,
      cuerpoRed({
        conexion: { tipo: 'RED', host: '10.0.0.7', puerto: 9101 },
        anchoMm: 58,
        juegoCaracteres: 'SIN_TILDES',
        gaveta: true,
      }),
    );
    expect(i).toMatchObject({
      conexion: { tipo: 'RED', host: '10.0.0.7', puerto: 9101 },
      anchoMm: 58,
      juegoCaracteres: 'SIN_TILDES',
      gaveta: true,
    });
  });

  it('una impresora Bluetooth solo se guarda: la dirección se normaliza a mayúsculas y no lleva host ni puerto', async () => {
    const i = await impresoraCreada(
      ctx,
      T(),
      A().S1,
      cuerpoBluetooth({ conexion: { tipo: 'BLUETOOTH', mac: 'aa:bb:cc:dd:ee:0f' } }),
    );
    expect(i.conexion).toEqual({ tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:0F' });
    expect(i.estado).toBe('DESCONOCIDO');
    expect(await filaDeImpresora(i.id)).toMatchObject({
      conexion_tipo: 'BLUETOOTH',
      mac: 'AA:BB:CC:DD:EE:0F',
      host: null,
      puerto: null,
    });
  });

  it('valida los límites y rechaza campos desconocidos con 400, sin crear nada', async () => {
    const antes = (await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n;
    const red = { tipo: 'RED', host: '192.168.1.50', puerto: 9100 };
    const malos: Record<string, unknown>[] = [
      { nombre: '' },
      { nombre: '   ' },
      { nombre: 'x'.repeat(41) },
      { conexion: { tipo: 'USB', host: '1.1.1.1' } },
      { conexion: { tipo: 'RED' } },
      { conexion: { ...red, host: '999.1.1.1' } },
      { conexion: { ...red, host: '' } },
      { conexion: { ...red, host: `${'a'.repeat(64)}.com` } },
      { conexion: { ...red, puerto: 0 } },
      { conexion: { ...red, puerto: 65536 } },
      { conexion: { ...red, puerto: 91.5 } },
      { conexion: { ...red, puerto: '9100' } },
      { conexion: { ...red, mac: 'AA:BB:CC:DD:EE:FF' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'GG:BB:CC:DD:EE:FF' } },
      { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF', host: '1.1.1.1' } },
      { anchoMm: 60 },
      { anchoMm: '80' },
      { juegoCaracteres: 'LATIN1' },
      { gaveta: 'si' },
      { activa: false },
      { otro: 1 },
      { sucursalId: A().S2 },
      { empresaId: B().empresaId },
    ];
    for (const extra of malos) {
      const res = await crear(A().S1, cuerpoRed(extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    }
    const sinAncho = cuerpoRed();
    delete (sinAncho as Record<string, unknown>).anchoMm;
    esperarError(await crear(A().S1, sinAncho), 400, 'DATOS_INVALIDOS');
    esperarError(await crear(A().S1, {}), 400, 'DATOS_INVALIDOS');
    expect((await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n).toBe(antes);
  });

  it('el nombre es único en la sucursal sin distinguir mayúsculas (409); en otra sucursal o empresa se repite', async () => {
    const nombre = unico('Barra');
    await impresoraCreada(ctx, T(), A().S1, cuerpoRed({ nombre }));
    const repetida = await crear(A().S1, cuerpoRed({ nombre: nombre.toUpperCase() }));
    esperarError(repetida, 409, 'CONFLICTO');
    expect(repetida.body.campos).toEqual([expect.objectContaining({ campo: 'nombre' })]);
    await impresoraCreada(ctx, T(), A().S2, cuerpoRed({ nombre }));
    await impresoraCreada(ctx, B().tokenAdmin, B().S1, cuerpoRed({ nombre }));
  });

  it('una sucursal de B o inexistente es 404 con el mismo cuerpo, y no crea nada', async () => {
    const antes = (await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n;
    const deB = await crear(B().S1, cuerpoRed());
    const inexistente = await crear(randomUUID(), cuerpoRed());
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(deB.status).toBe(404);
    expect(deB.body).toEqual(inexistente.body);
    expect((await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n).toBe(antes);
  });

  it('con la misma Idempotency-Key devuelve lo guardado sin crear otra', async () => {
    const clave = randomUUID();
    const cuerpo = cuerpoRed();
    const primera = await crear(A().S1, cuerpo, T(), { 'Idempotency-Key': clave });
    exigirEstado(primera, 201, 'primera');
    const segunda = await crear(A().S1, cuerpo, T(), { 'Idempotency-Key': clave });
    exigirEstado(segunda, 201, 'réplica');
    expect(segunda.body).toEqual(primera.body);
    const n = await admin.query('SELECT count(*)::int AS n FROM impresora WHERE nombre = $1', [
      cuerpo.nombre,
    ]);
    expect(n.rows[0].n).toBe(1);
  });

  it('deja una fila crear_impresora con la sucursal y el Administrador como autor', async () => {
    const antes = (await auditoriaDe(admin, A().empresaId, 'crear_impresora')).length;
    const i = await impresoraCreada(ctx, T(), A().S2, cuerpoBluetooth());
    const filas = await auditoriaDe(admin, A().empresaId, 'crear_impresora');
    expect(filas).toHaveLength(antes + 1);
    const fila = filas.at(-1)!;
    expect(fila).toMatchObject({
      sucursal_id: A().S2,
      actor_usuario_id: A().base.admin.id,
      entidad: 'impresora',
      entidad_id: i.id,
    });
    expect(fila.detalle).toMatchObject({
      sucursalId: A().S2,
      nombre: i.nombre,
      conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:FF' },
      anchoMm: 58,
    });
    const traza = await filaDeImpresora(i.id);
    expect(traza).toMatchObject({
      creado_por_usuario_id: A().base.admin.id,
      actualizado_por_usuario_id: A().base.admin.id,
    });
  });
});

describe('criterio 104 · editar y desactivar', () => {
  it('cambia cada campo, reemplaza la conexión entera y audita el antes y el después', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const auditoriasAntes = (await auditoriaDe(admin, A().empresaId, 'modificar_impresora')).length;

    const nuevoNombre = unico('Cocina nueva');
    let res = await modificar(A().S1, i.id, {
      nombre: nuevoNombre,
      anchoMm: 58,
      juegoCaracteres: 'WPC1252',
      gaveta: true,
    });
    exigirEstado(res, 200, 'campos simples');
    expect(res.body).toMatchObject({
      nombre: nuevoNombre,
      anchoMm: 58,
      juegoCaracteres: 'WPC1252',
      gaveta: true,
      conexion: i.conexion,
    });

    // De red a Bluetooth: la conexión se reemplaza entera.
    res = await modificar(A().S1, i.id, {
      conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:00:11:22' },
    });
    exigirEstado(res, 200, 'a Bluetooth');
    expect(res.body.conexion).toEqual({ tipo: 'BLUETOOTH', mac: 'AA:BB:CC:00:11:22' });
    expect(await filaDeImpresora(i.id)).toMatchObject({
      conexion_tipo: 'BLUETOOTH',
      host: null,
      puerto: null,
    });

    // Y de vuelta a red, con el puerto por defecto.
    res = await modificar(A().S1, i.id, { conexion: { tipo: 'RED', host: '10.1.1.1' } });
    exigirEstado(res, 200, 'a red');
    expect(res.body.conexion).toEqual({ tipo: 'RED', host: '10.1.1.1', puerto: 9100 });
    expect(await filaDeImpresora(i.id)).toMatchObject({
      mac: null,
      host: '10.1.1.1',
      puerto: 9100,
    });

    const filas = await auditoriaDe(admin, A().empresaId, 'modificar_impresora');
    expect(filas).toHaveLength(auditoriasAntes + 3);
    const primera = filas[auditoriasAntes]!;
    expect(primera).toMatchObject({ sucursal_id: A().S1, entidad_id: i.id });
    expect(primera.detalle).toMatchObject({
      sucursalId: A().S1,
      nombre: { antes: i.nombre, despues: nuevoNombre },
      anchoMm: { antes: 80, despues: 58 },
      juegoCaracteres: { antes: 'PC850', despues: 'WPC1252' },
      gaveta: { antes: false, despues: true },
    });
    expect(primera.detalle).not.toHaveProperty('conexion');
    expect(filas[auditoriasAntes + 1]!.detalle).toMatchObject({
      conexion: { antes: i.conexion, despues: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:00:11:22' } },
    });
  });

  it('un PATCH sin cambios responde 200 sin auditoría ni nueva fecha de actualización', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const antes = await filaDeImpresora(i.id);
    const auditoriaAntes = await totalAuditoria(admin, A().empresaId);
    const res = await modificar(A().S1, i.id, {
      nombre: i.nombre,
      conexion: i.conexion,
      anchoMm: i.anchoMm,
      activa: true,
    });
    exigirEstado(res, 200, 'sin cambios');
    expect(res.body).toEqual(i);
    expect(await filaDeImpresora(i.id)).toEqual(antes);
    expect(await totalAuditoria(admin, A().empresaId)).toBe(auditoriaAntes);
  });

  it('cambiar solo las mayúsculas del propio nombre es un cambio válido; el de otra impresora es 409', async () => {
    const a = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const b = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const res = await modificar(A().S1, a.id, { nombre: a.nombre.toUpperCase() });
    exigirEstado(res, 200, 'mayúsculas');
    expect(res.body.nombre).toBe(a.nombre.toUpperCase());
    esperarError(await modificar(A().S1, b.id, { nombre: a.nombre }), 409, 'CONFLICTO');
    expect((await filaDeImpresora(b.id))!.nombre).toBe(b.nombre);
  });

  it('valida el cuerpo: vacío, campo desconocido o dueño ajeno son 400', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    for (const cuerpo of [
      {},
      { otro: 1 },
      { sucursalId: A().S2 },
      { empresaId: B().empresaId },
      { nombre: '' },
      { anchoMm: 70 },
      { activa: 'no' },
      { conexion: { tipo: 'RED', host: 'no es un host' } },
    ]) {
      const res = await modificar(A().S1, i.id, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(await filaDeImpresora(i.id)).toMatchObject({ nombre: i.nombre });
  });

  it('desactiva y reactiva (nunca se borra); una inactiva sigue en el listado y se puede editar', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    let res = await modificar(A().S1, i.id, { activa: false });
    exigirEstado(res, 200, 'desactivar');
    expect(res.body.activa).toBe(false);
    const lista = (await listar(A().S1)).body as ImpresoraRespuesta[];
    expect(lista.find((x) => x.id === i.id)).toMatchObject({ activa: false });
    res = await modificar(A().S1, i.id, { gaveta: true });
    expect(res.body).toMatchObject({ activa: false, gaveta: true });
    res = await modificar(A().S1, i.id, { activa: true });
    expect(res.body.activa).toBe(true);
    const filas = await auditoriaDe(admin, A().empresaId, 'modificar_impresora');
    expect(filas.filter((f) => f.entidad_id === i.id)).toHaveLength(3);
  });

  it('desactivar la impresora de un destino o la de caja es 409 EN_USO con el uso en el mensaje', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const { cocinaId, barraId } = esc.carta;
    exigirEstado(
      await ponerDestino(A().S1, cocinaId, { destino: 'IMPRESORA', impresoraId: i.id }),
      200,
      'destino de Cocina',
    );
    let res = await modificar(A().S1, i.id, { activa: false });
    esperarError(res, 409, 'EN_USO');
    expect(res.body.mensaje).toContain('Cocina');
    expect((await filaDeImpresora(i.id))!.activa).toBe(true);

    exigirEstado(
      await ponerDestino(A().S1, barraId, { destino: 'IMPRESORA', impresoraId: i.id }),
      200,
      'destino de Barra',
    );
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: rutaImpresion(A().S1),
        cuerpo: { impresoraCajaId: i.id },
      }),
      200,
      'impresora de caja',
    );
    res = await modificar(A().S1, i.id, { activa: false });
    esperarError(res, 409, 'EN_USO');
    expect(res.body.mensaje).toMatch(/Barra, Cocina/);
    expect(res.body.mensaje).toMatch(/impresora de caja/);

    // Se libera de a poco: mientras quede un uso sigue en uso.
    for (const estacionId of [cocinaId, barraId]) {
      exigirEstado(await ponerDestino(A().S1, estacionId, { destino: 'KDS' }), 200, 'a KDS');
    }
    esperarError(await modificar(A().S1, i.id, { activa: false }), 409, 'EN_USO');
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: rutaImpresion(A().S1),
        cuerpo: { impresoraCajaId: null },
      }),
      200,
      'sin impresora de caja',
    );
    exigirEstado(await modificar(A().S1, i.id, { activa: false }), 200, 'ya libre');
  });

  it('el uso en otra sucursal no impide desactivar: cada impresora es de su sucursal', async () => {
    const deS1 = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const deS2 = await impresoraCreada(ctx, T(), A().S2, cuerpoRed());
    exigirEstado(
      await ponerDestino(A().S2, esc.carta.cocinaId, {
        destino: 'IMPRESORA',
        impresoraId: deS2.id,
      }),
      200,
      'destino en S2',
    );
    exigirEstado(await modificar(A().S1, deS1.id, { activa: false }), 200, 'la de S1 está libre');
    esperarError(await modificar(A().S2, deS2.id, { activa: false }), 409, 'EN_USO');
    exigirEstado(await ponerDestino(A().S2, esc.carta.cocinaId, { destino: 'KDS' }), 200, 'a KDS');
  });

  it('una impresora de otra sucursal, de B o inexistente es 404 con el mismo cuerpo, y no cambia', async () => {
    const deS2 = await impresoraCreada(ctx, T(), A().S2, cuerpoRed());
    const deB = await impresoraCreada(ctx, B().tokenAdmin, B().S1, cuerpoRed());
    const antesS2 = await filaDeImpresora(deS2.id);
    const antesB = await filaDeImpresora(deB.id);
    const inexistente = await modificar(A().S1, randomUUID(), { nombre: 'Hackeada' });
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    for (const id of [deS2.id, deB.id]) {
      const res = await modificar(A().S1, id, { nombre: 'Hackeada' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(inexistente.body);
    }
    expect(await filaDeImpresora(deS2.id)).toEqual(antesS2);
    expect(await filaDeImpresora(deB.id)).toEqual(antesB);
  });
});

describe('criterio 105 · listado', () => {
  it('trae las impresoras de la sucursal (activas e inactivas) por nombre, con estado y pendientes', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const zeta = await impresoraCreada(ctx, token, S1, cuerpoRed({ nombre: 'zeta' }));
    const alfa = await impresoraCreada(ctx, token, S1, cuerpoBluetooth({ nombre: 'Alfa' }));
    const inactiva = await impresoraCreada(ctx, token, S1, cuerpoRed({ nombre: 'Medio' }));
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `${rutaImpresoras(S1)}/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    await impresoraCreada(ctx, token, e.e.A.S2, cuerpoRed());
    await impresoraCreada(ctx, e.token.adminS1B, e.e.B.S1, cuerpoRed());

    const res = await llamar(ctx, token, { metodo: 'get', ruta: rutaImpresoras(S1) });
    exigirEstado(res, 200, 'listar');
    const lista = (res.body as unknown[]).map((x) => impresoraRespuestaSchema.parse(x));
    expect(lista.map((x) => x.nombre)).toEqual(['Alfa', 'Medio', 'zeta']);
    expect(lista.map((x) => x.id)).toEqual([alfa.id, inactiva.id, zeta.id]);
    expect(lista.map((x) => x.activa)).toEqual([true, false, true]);
    for (const x of lista) {
      expect(x).toMatchObject({
        sucursalId: S1,
        estado: 'DESCONOCIDO',
        estadoDesde: null,
        pendientes: 0,
      });
    }
  });

  it('una sucursal sin impresoras responde una lista vacía; la de B o inexistente es 404', async () => {
    const e = await prepararEscenarioP2(ctx);
    const vacia = await llamar(ctx, e.token.adminA, {
      metodo: 'get',
      ruta: rutaImpresoras(e.e.A.S2),
    });
    exigirEstado(vacia, 200, 'vacía');
    expect(vacia.body).toEqual([]);
    const deB = await llamar(ctx, e.token.adminA, {
      metodo: 'get',
      ruta: rutaImpresoras(e.e.B.S1),
    });
    const inexistente = await llamar(ctx, e.token.adminA, {
      metodo: 'get',
      ruta: rutaImpresoras(randomUUID()),
    });
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    expect(deB.status).toBe(404);
    expect(deB.body).toEqual(inexistente.body);
  });
});

describe('permisos · ADMINISTRAR en las rutas de impresoras', () => {
  it('Mozo, Cajero, Cocina/Barra y Supervisor reciben 403 PROHIBIDO, con contraseña y con PIN, sin cambiar nada', async () => {
    const i = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    const personas = [
      ['Mozo', A().mozo],
      ['Cajero', A().cajero],
      ['Cocina/Barra', A().cocina],
      ['Supervisor', A().supervisor],
    ] as const;
    const rutas: [string, string, unknown?][] = [
      ['get', rutaImpresoras(A().S1)],
      ['post', rutaImpresoras(A().S1), cuerpoRed()],
      ['patch', `${rutaImpresoras(A().S1)}/${i.id}`, { nombre: 'Otra' }],
    ];
    const antes = await totalAuditoria(admin, A().empresaId);
    const filas = (await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n;
    for (const [rol, persona] of personas) {
      const sesiones = await sesionesDe(ctx, persona, A().S1);
      const tokens = { contraseña: sesiones.contrasena, PIN: sesiones.pin };
      for (const [tipo, token] of Object.entries(tokens)) {
        for (const [metodo, ruta, cuerpo] of rutas) {
          const res = await llamar(ctx, token, {
            metodo: metodo as 'get',
            ruta,
            ...(cuerpo === undefined ? {} : { cuerpo }),
          });
          expect(res.status, `${rol} (${tipo}) ${metodo} ${ruta}`).toBe(403);
          expect(res.body.codigo).toBe('PROHIBIDO');
        }
      }
    }
    expect(await totalAuditoria(admin, A().empresaId)).toBe(antes);
    expect((await admin.query('SELECT count(*)::int AS n FROM impresora')).rows[0].n).toBe(filas);
    expect(await filaDeImpresora(i.id)).toMatchObject({ nombre: i.nombre });
    // Sin sesión, 401.
    expect(
      (await llamar(ctx, undefined, { metodo: 'get', ruta: rutaImpresoras(A().S1) })).status,
    ).toBe(401);
  });
});

describe('desactivar contra elegir como destino, a la vez', () => {
  it('nunca queda una impresora inactiva como destino (cada ronda: 200 y 422, o 200 y 409)', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    for (let ronda = 0; ronda < 8; ronda++) {
      const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
      const [desactivar, elegir] = await Promise.all([
        llamar(ctx, token, {
          metodo: 'patch',
          ruta: `${rutaImpresoras(S1)}/${i.id}`,
          cuerpo: { activa: false },
        }),
        llamar(ctx, token, {
          metodo: 'put',
          ruta: rutaDestino(S1, e.carta.cocinaId),
          cuerpo: { destino: 'IMPRESORA', impresoraId: i.id },
        }),
      ]);
      expect([200, 409], `desactivar (ronda ${ronda})`).toContain(desactivar.status);
      expect([200, 422], `elegir (ronda ${ronda})`).toContain(elegir.status);
      // Exactamente una de las dos gana.
      expect(desactivar.status === 200 ? 422 : 200, `ronda ${ronda}`).toBe(elegir.status);
      const inconsistentes = await admin.query(
        `SELECT d.id FROM estacion_destino d JOIN impresora i ON i.id = d.impresora_id AND i.empresa_id = d.empresa_id
          WHERE d.empresa_id = $1 AND NOT i.activa`,
        [e.e.A.empresaId],
      );
      expect(inconsistentes.rows, `ronda ${ronda}`).toEqual([]);
      // Deja la estación libre para la ronda siguiente.
      exigirEstado(
        await llamar(ctx, token, {
          metodo: 'put',
          ruta: rutaDestino(S1, e.carta.cocinaId),
          cuerpo: { destino: 'KDS' },
        }),
        200,
        'a KDS',
      );
    }
  });
});
