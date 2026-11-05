// Historia 006 · caja, cobro y comprobantes, grupo C1 (T6) · pruebas del desarrollador (no protegidas) de las rutas de
// configuración de la entrega 6a: cajas (criterios 1 y 2), series (3 a 5), tasa de IGV del emisor (6) y su permiso y
// auditoría (7). Completan las protegidas de `caja-critica/series.spec.ts` y `permisos-caja.spec.ts` en lo que ellas no
// miran: la forma de la respuesta, los límites, la impresora de la caja, la regla de las tasas con comprobantes
// emitidos y el rechazo por rol. Los turnos y los comprobantes que hacen falta se siembran por SQL, porque sus rutas
// llegan en grupos posteriores.
import { randomUUID } from 'node:crypto';
import { cajaRespuestaSchema, tasaIgvRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { RegistroImpresoraDeCaja } from '../../src/modulos/facturacion';
import { IMPRESION, type ImpresionPuerto } from '../../src/modulos/pedidos/impresion';
import { filasAuditoria } from '../acceso/fabrica-equipos';
import { altaEmpresa, type EmpresaDePrueba } from '../acceso/fabrica-plataforma';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  api,
  arrancarCaja,
  cerrarAdmin,
  crearCaja,
  crearEscenario,
  esperarError,
  exigirEstado,
  filas,
  ponerSerie,
  ponerTasa,
  type AppP5,
  type Escenario,
  type Res,
} from '../caja-critica/fabrica-caja';
import { cuerpoRed, impresoraCreada } from '../impresion/ayudas-impresion';
import { abrirCliente } from '../utilidades';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
let apiCliente: Client;
/** Una empresa aparte con tres sucursales y su Administrador: las pruebas que llenan una sucursal de cajas no pisan las de A. */
let E: EmpresaDePrueba;

const A = () => esc.A;
const admin = () => A().token.admin!;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 5 });
  esc = await crearEscenario(ctx);
  apiCliente = await abrirCliente('api');
  await esc.A.cajas();
  await esc.B.cajas();
  E = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 3 });
});
afterAll(async () => {
  await ctx?.cerrar();
  await apiCliente?.end();
  await cerrarAdmin();
});

/** Un turno abierto o cerrado sembrado por SQL con el actor de prueba (la ruta de apertura llega en T9). */
async function sembrarTurno(
  empresaId: string,
  sucursalId: string,
  cajaId: string,
  responsableId: string,
  estado: 'ABIERTO' | 'CERRADO' = 'ABIERTO',
): Promise<string> {
  const id = randomUUID();
  await enTransaccion(
    apiCliente,
    empresaId,
    async () => {
      await apiCliente.query(
        `INSERT INTO turno (id, empresa_id, caja_id, sucursal_id, responsable_id, estado, abierto_en, dia_operativo,
                            fondo, cerrado_en, cerrado_por_id, huella_entrada, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, now(), '2026-11-02', '50.00',
                 CASE WHEN $6 = 'CERRADO' THEN now() END, CASE WHEN $6 = 'CERRADO' THEN $5::uuid END,
                 decode(repeat('ab', 32), 'hex'), now(), now())`,
        [id, empresaId, cajaId, sucursalId, responsableId, estado],
      );
    },
    { confirmar: true },
  );
  return id;
}

const nombraElCampo = (res: Res, campo: string) =>
  (res.body.campos as Array<{ campo: string }> | undefined)?.map((c) => c.campo).includes(campo);

describe('criterio 1 · cajas', () => {
  it('POST crea una caja activa sin impresora ni series ni turno, con la forma de cajaRespuesta; el nombre se recorta', async () => {
    const res = await api(ctx, E.admin.token, 'post', `/sucursales/${E.sucursales[0]!.id}/cajas`, {
      nombre: '  Barra del fondo  ',
    });
    exigirEstado(res, 201, 'Crear la caja');
    const caja = cajaRespuestaSchema.parse(res.body);
    expect(caja).toMatchObject({
      sucursalId: E.sucursales[0]!.id,
      nombre: 'Barra del fondo',
      activa: true,
      impresora: null,
      series: [],
      turnoAbierto: null,
    });
    const lista = await api(ctx, E.admin.token, 'get', `/sucursales/${E.sucursales[0]!.id}/cajas`);
    exigirEstado(lista, 200, 'Listar');
    expect(
      (lista.body as Array<{ id: string }>).map((c) => c.id),
      'la lista incluye la caja',
    ).toContain(caja.id);
  });

  it('el nombre es único en la sucursal sin distinguir mayúsculas (409 CONFLICTO con campos.nombre); en otra sucursal se puede repetir', async () => {
    await crearCaja(ctx, E.admin.token, E.sucursales[0]!.id, 'Caja Única');
    const repetida = await api(
      ctx,
      E.admin.token,
      'post',
      `/sucursales/${E.sucursales[0]!.id}/cajas`,
      {
        nombre: 'CAJA única',
      },
    );
    esperarError(repetida, 409, 'CONFLICTO');
    expect(nombraElCampo(repetida, 'nombre')).toBe(true);
    exigirEstado(
      await api(ctx, E.admin.token, 'post', `/sucursales/${E.sucursales[1]!.id}/cajas`, {
        nombre: 'Caja Única',
      }),
      201,
      'El mismo nombre en otra sucursal',
    );
    const otra = await crearCaja(ctx, E.admin.token, E.sucursales[0]!.id, 'Caja Otra');
    const renombrar = await api(
      ctx,
      E.admin.token,
      'patch',
      `/sucursales/${E.sucursales[0]!.id}/cajas/${otra.id}`,
      {
        nombre: 'caja única',
      },
    );
    esperarError(renombrar, 409, 'CONFLICTO');
  });

  it('una sucursal tiene hasta 10 cajas activas: la 11.ª es 409 CONFLICTO, reactivar con 10 también, y desactivar una deja crear otra', async () => {
    const token = E.admin.token;
    const sucursal = E.sucursales[2]!.id;
    const creadas: string[] = [];
    for (let i = 1; i <= 10; i++) {
      creadas.push((await crearCaja(ctx, token, sucursal, `Caja ${i}`)).id as string);
    }
    esperarError(
      await api(ctx, token, 'post', `/sucursales/${sucursal}/cajas`, { nombre: 'Caja 11' }),
      409,
      'CONFLICTO',
    );
    exigirEstado(
      await api(ctx, token, 'patch', `/sucursales/${sucursal}/cajas/${creadas[0]}`, {
        activa: false,
      }),
      200,
      'Desactivar',
    );
    const once = await crearCaja(ctx, token, sucursal, 'Caja 11');
    // Con 10 activas otra vez, la primera no se puede reactivar.
    esperarError(
      await api(ctx, token, 'patch', `/sucursales/${sucursal}/cajas/${creadas[0]}`, {
        activa: true,
      }),
      409,
      'CONFLICTO',
    );
    expect(once.activa).toBe(true);
    const lista = await api(ctx, token, 'get', `/sucursales/${sucursal}/cajas`);
    expect((lista.body as Array<{ activa: boolean }>).filter((c) => c.activa)).toHaveLength(10);
    expect(lista.body).toHaveLength(11);
  });

  it('dos altas simultáneas con 9 cajas activas dejan 10, no 11', async () => {
    const e = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 1 });
    const sucursal = e.sucursales[0]!.id;
    for (let i = 1; i <= 9; i++) await crearCaja(ctx, e.admin.token, sucursal, `Caja ${i}`);
    const resultados = await Promise.all(
      ['Caja 10', 'Caja 10 bis', 'Caja 10 ter'].map((nombre) =>
        api(ctx, e.admin.token, 'post', `/sucursales/${sucursal}/cajas`, { nombre }),
      ),
    );
    expect(resultados.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(
      await filas('SELECT 1 FROM caja WHERE sucursal_id = $1 AND activa', [sucursal]),
    ).toHaveLength(10);
  });

  it('desactivar una caja con turno abierto es 409 EN_USO y no cambia nada; con el turno cerrado se puede; las cajas no se borran', async () => {
    const caja = await crearCaja(ctx, admin(), A().S1, 'Caja con turno');
    const turno = await sembrarTurno(A().id, A().S1, caja.id as string, A().personas.cajero!.id);
    esperarError(
      await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
        activa: false,
      }),
      409,
      'EN_USO',
    );
    expect(
      (await filas('SELECT activa FROM caja WHERE id = $1', [caja.id]))[0]!.activa,
      'sigue activa',
    ).toBe(true);
    // La respuesta de la caja muestra quién la tiene abierta, sin montos.
    const lista = await api(ctx, admin(), 'get', `/sucursales/${A().S1}/cajas`);
    const vista = cajaRespuestaSchema
      .array()
      .parse(lista.body)
      .find((c) => c.id === caja.id)!;
    expect(vista.turnoAbierto).toMatchObject({
      id: turno,
      responsable: { id: A().personas.cajero!.id },
    });
    expect(JSON.stringify(vista)).not.toContain('fondo');
    await enTransaccion(
      apiCliente,
      A().id,
      async () => {
        await apiCliente.query(
          `UPDATE turno SET estado = 'CERRADO', cerrado_en = now(), cerrado_por_id = responsable_id WHERE id = $1`,
          [turno],
        );
      },
      { confirmar: true },
    );
    exigirEstado(
      await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
        activa: false,
      }),
      200,
      'Desactivar con el turno cerrado',
    );
    expect(
      (await api(ctx, admin(), 'delete', `/sucursales/${A().S1}/cajas/${caja.id}`)).status,
    ).toBe(404);
  });

  it('GET /cajas (Cajero, módulo CAJA) lista solo las activas de la sucursal activa, con el turno abierto y sin montos', async () => {
    const caja = await crearCaja(ctx, admin(), A().S1, 'Caja para el listado');
    const inactiva = await crearCaja(ctx, admin(), A().S1, 'Caja apagada');
    exigirEstado(
      await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${inactiva.id}`, {
        activa: false,
      }),
      200,
      'Apagar',
    );
    await sembrarTurno(A().id, A().S1, caja.id as string, A().personas.cajero2!.id);
    const res = await api(ctx, A().token.cajero, 'get', '/cajas');
    exigirEstado(res, 200, 'GET /cajas');
    const cajas = cajaRespuestaSchema.array().parse(res.body);
    expect(cajas.every((c) => c.activa && c.sucursalId === A().S1)).toBe(true);
    expect(cajas.map((c) => c.id)).toContain(caja.id);
    expect(cajas.map((c) => c.id)).not.toContain(inactiva.id);
    // Los parámetros del emisor de la sucursal: el régimen y los tipos que el cobro aceptará.
    const regimen = (
      await filas(
        `SELECT e.regimen FROM sucursal s JOIN emisor e ON e.id = s.emisor_id WHERE s.id = $1`,
        [A().S1],
      )
    )[0]!.regimen as string;
    for (const c of cajas) {
      expect(c.parametros.regimen).toBe(regimen);
      expect(c.parametros.tiposComprobante).toEqual(
        regimen === 'NUEVO_RUS' ? ['BOLETA'] : ['BOLETA', 'FACTURA'],
      );
    }
    expect(cajas.find((c) => c.id === caja.id)!.turnoAbierto?.responsable.id).toBe(
      A().personas.cajero2!.id,
    );
    // La del Mozo, 403 por rol.
    esperarError(await api(ctx, A().token.mozo, 'get', '/cajas'), 403, 'PROHIBIDO');
  });
});

describe('criterio 2 · impresora de la caja', () => {
  it('una impresora activa de la sucursal se guarda y se muestra con su nombre y su gaveta; null la quita', async () => {
    const impresora = await impresoraCreada(
      ctx,
      admin(),
      A().S1,
      cuerpoRed({ nombre: 'Caja con gaveta', gaveta: true }),
    );
    const caja = await crearCaja(ctx, admin(), A().S1, 'Caja con impresora', impresora.id);
    expect(caja.impresora).toEqual({ id: impresora.id, nombre: 'Caja con gaveta', gaveta: true });
    const quitada = await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
      impresoraId: null,
    });
    exigirEstado(quitada, 200, 'Quitar la impresora');
    expect(quitada.body.impresora).toBeNull();
    const puesta = await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
      impresoraId: impresora.id,
    });
    exigirEstado(puesta, 200, 'Poner la impresora');
    expect(puesta.body.impresora.id).toBe(impresora.id);
  });

  it('una impresora de otra sucursal, de otra empresa, inactiva o inexistente es 422 REFERENCIA_INVALIDA con el mismo cuerpo', async () => {
    const deS2 = await impresoraCreada(ctx, admin(), A().S2);
    const inactiva = await impresoraCreada(ctx, admin(), A().S1);
    exigirEstado(
      await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/impresoras/${inactiva.id}`, {
        activa: false,
      }),
      200,
      'Desactivar la impresora',
    );
    const deB = await impresoraCreada(ctx, esc.B.token.admin!, esc.B.S1);
    const intentos = [deS2.id, inactiva.id, deB.id, randomUUID()];
    const respuestas: Res[] = [];
    for (const impresoraId of intentos) {
      respuestas.push(
        await api(ctx, admin(), 'post', `/sucursales/${A().S1}/cajas`, {
          nombre: `Caja ${randomUUID().slice(0, 6)}`,
          impresoraId,
        }),
      );
    }
    for (const r of respuestas) esperarError(r, 422, 'REFERENCIA_INVALIDA');
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    const caja = await crearCaja(ctx, admin(), A().S1, `Caja ${randomUUID().slice(0, 6)}`);
    for (const impresoraId of intentos) {
      esperarError(
        await api(ctx, admin(), 'patch', `/sucursales/${A().S1}/cajas/${caja.id}`, {
          impresoraId,
        }),
        422,
        'REFERENCIA_INVALIDA',
      );
    }
  });

  it('impresoraDeLaCaja: la propia si está activa; si no, la de caja de la sucursal; si tampoco hay, null', async () => {
    const e = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 1 });
    const sucursal = e.sucursales[0]!.id;
    const propia = await impresoraCreada(ctx, e.admin.token, sucursal, cuerpoRed({ gaveta: true }));
    const deCaja = await impresoraCreada(ctx, e.admin.token, sucursal, cuerpoRed());
    const resolver = (impresoraId: string | null) =>
      ctx.app
        .get(ContextoEmpresa)
        .ejecutar(
          e.empresaId,
          () => ctx.app.get<ImpresionPuerto>(IMPRESION).impresoraDeLaCaja(sucursal, impresoraId),
          { actor: { sistema: 'prueba' } },
        );
    expect(await resolver(null)).toBeNull();
    expect(await resolver(propia.id)).toEqual({ id: propia.id, gaveta: true });
    exigirEstado(
      await api(ctx, e.admin.token, 'put', `/sucursales/${sucursal}/impresion`, {
        impresoraCajaId: deCaja.id,
      }),
      200,
      'Impresora de caja de la sucursal',
    );
    expect(await resolver(null)).toEqual({ id: deCaja.id, gaveta: false });
    expect(await resolver(randomUUID())).toEqual({ id: deCaja.id, gaveta: false });
    exigirEstado(
      await api(ctx, e.admin.token, 'patch', `/sucursales/${sucursal}/impresoras/${propia.id}`, {
        activa: false,
      }),
      200,
      'Desactivar la propia',
    );
    expect(await resolver(propia.id)).toEqual({ id: deCaja.id, gaveta: false });
  });

  it('la impresora de una caja para reimprimir (puerto de facturación) sale de caja.impresora_id y cae en la de la sucursal', async () => {
    const e = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 1 });
    const sucursal = e.sucursales[0]!.id;
    const propia = await impresoraCreada(ctx, e.admin.token, sucursal, cuerpoRed({ gaveta: true }));
    const conPropia = await crearCaja(ctx, e.admin.token, sucursal, 'Con impresora', propia.id);
    const sinPropia = await crearCaja(ctx, e.admin.token, sucursal, 'Sin impresora');
    const deLaCaja = (cajaId: string) =>
      ctx.app
        .get(ContextoEmpresa)
        .ejecutar(e.empresaId, () => ctx.app.get(RegistroImpresoraDeCaja).deLaCaja(cajaId), {
          actor: { sistema: 'prueba' },
        });
    expect(await deLaCaja(conPropia.id as string)).toEqual({ id: propia.id, gaveta: true });
    expect(await deLaCaja(sinPropia.id as string), 'sin la de la sucursal tampoco hay').toBeNull();
    expect(await deLaCaja(randomUUID()), 'una caja inexistente').toBeNull();
    const deCaja = await impresoraCreada(ctx, e.admin.token, sucursal, cuerpoRed());
    exigirEstado(
      await api(ctx, e.admin.token, 'put', `/sucursales/${sucursal}/impresion`, {
        impresoraCajaId: deCaja.id,
      }),
      200,
      'Impresora de caja de la sucursal',
    );
    expect(await deLaCaja(sinPropia.id as string)).toEqual({ id: deCaja.id, gaveta: false });
  });
});

describe('criterios 3 a 5 · series', () => {
  it('la respuesta lleva todas las series de la caja: la activa de cada tipo primero y las inactivas después', async () => {
    const caja = await crearCaja(ctx, admin(), A().S1, 'Caja de series');
    const id = caja.id as string;
    for (const [tipo, serie] of [
      ['BOLETA', 'B810'],
      ['FACTURA', 'F810'],
      ['BOLETA', 'B811'],
    ] as const) {
      exigirEstado(await ponerSerie(ctx, admin(), A().S1, id, tipo, serie), 200, serie);
    }
    const res = await api(ctx, admin(), 'get', `/sucursales/${A().S1}/cajas`);
    const vista = cajaRespuestaSchema
      .array()
      .parse(res.body)
      .find((c) => c.id === id)!;
    expect(vista.series).toEqual([
      { tipo: 'BOLETA', serie: 'B811', ultimoNumero: 0, activa: true, emisorId: A().emisor1 },
      { tipo: 'BOLETA', serie: 'B810', ultimoNumero: 0, activa: false, emisorId: A().emisor1 },
      { tipo: 'FACTURA', serie: 'F810', ultimoNumero: 0, activa: true, emisorId: A().emisor1 },
    ]);
  });

  it('en la base queda una sola serie activa por caja y tipo, con el emisor de la sucursal y el primer número', async () => {
    const caja = await crearCaja(ctx, admin(), A().S1, 'Caja del primer número');
    exigirEstado(
      await ponerSerie(ctx, admin(), A().S1, caja.id as string, 'FACTURA', 'F820', 1500),
      200,
      'Serie con primer número',
    );
    const fila = (
      await filas(
        'SELECT emisor_id, primer_numero, ultimo_numero, activa FROM serie WHERE caja_id = $1',
        [caja.id],
      )
    )[0]!;
    expect(fila).toEqual({
      emisor_id: A().emisor1,
      primer_numero: 1500,
      ultimo_numero: 1499,
      activa: true,
    });
    // El mismo PUT con la misma serie y otro primer número: 409 con campos.primerNumero.
    const distinto = await ponerSerie(
      ctx,
      admin(),
      A().S1,
      caja.id as string,
      'FACTURA',
      'F820',
      7,
    );
    esperarError(distinto, 409, 'CONFLICTO');
    expect(nombraElCampo(distinto, 'primerNumero')).toBe(true);
  });

  it('la serie de otro emisor de la empresa y la de otra empresa se pueden repetir; la de otra caja del mismo emisor no', async () => {
    const cajas = await A().cajas();
    // E2 (S2) ya usa B001 como E1 (S1): los emisores son distintos.
    expect(
      await filas(
        `SELECT emisor_id FROM serie WHERE serie = 'B001' AND empresa_id = $1 ORDER BY emisor_id`,
        [A().id],
      ),
    ).toHaveLength(2);
    esperarError(
      await ponerSerie(ctx, admin(), A().S1, cajas.S1!.caja3, 'BOLETA', 'B001'),
      409,
      'CONFLICTO',
    );
  });

  it('una caja o una sucursal de otra empresa o inexistente es el mismo 404; el tipo desconocido y la serie mal formada son 400', async () => {
    const cajas = await A().cajas();
    const ajena = await ponerSerie(ctx, admin(), A().S1, randomUUID(), 'BOLETA', 'B831');
    esperarError(ajena, 404, 'NO_ENCONTRADO');
    const deB = await ponerSerie(
      ctx,
      admin(),
      A().S1,
      (await esc.B.cajas()).S1!.caja1,
      'BOLETA',
      'B831',
    );
    expect(deB.status).toBe(404);
    expect(deB.body).toEqual(ajena.body);
    const sucursalDeB = await ponerSerie(ctx, admin(), esc.B.S1, cajas.S1!.caja1, 'BOLETA', 'B831');
    const sucursalInexistente = await ponerSerie(
      ctx,
      admin(),
      randomUUID(),
      cajas.S1!.caja1,
      'BOLETA',
      'B831',
    );
    esperarError(sucursalDeB, 404, 'NO_ENCONTRADO');
    expect(sucursalDeB.body).toEqual(sucursalInexistente.body);
    const tipo = await api(
      ctx,
      admin(),
      'put',
      `/sucursales/${A().S1}/cajas/${cajas.S1!.caja1}/series/NOTA_CREDITO_BOLETA`,
      { serie: 'B832' },
    );
    esperarError(tipo, 400, 'DATOS_INVALIDOS');
    const campo = await api(
      ctx,
      admin(),
      'put',
      `/sucursales/${A().S1}/cajas/${cajas.S1!.caja1}/series/BOLETA`,
      { serie: 'B832', empresaId: A().id },
    );
    esperarError(campo, 400, 'DATOS_INVALIDOS');
    // Nada de lo rechazado dejó una serie.
    expect(await filas(`SELECT 1 FROM serie WHERE serie IN ('B831', 'B832')`)).toEqual([]);
  });
});

describe('criterio 6 · tasa de IGV del emisor', () => {
  it('GET lista las vigencias en orden de desde; PUT crea y cambia sin duplicar; repetir el mismo valor es 200 sin fila de auditoría', async () => {
    const e = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 1 });
    const emisor = e.emisores[0]!.id;
    const token = e.admin.token;
    expect((await api(ctx, token, 'get', `/emisores/${emisor}/tasas-igv`)).body).toEqual([]);
    exigirEstado(await ponerTasa(ctx, token, emisor, '2027-01-01', '10.50'), 200, 'Crear 2027');
    const antes = await ponerTasa(ctx, token, emisor, '2026-01-01', '18.00');
    exigirEstado(antes, 200, 'Crear 2026');
    expect(tasaIgvRespuestaSchema.parse(antes.body)).toEqual({
      desde: '2026-01-01',
      tasa: '18.00',
    });
    const cambio = await ponerTasa(ctx, token, emisor, '2027-01-01', '17.00');
    expect(cambio.body).toEqual({ desde: '2027-01-01', tasa: '17.00' });
    const lista = await api(ctx, token, 'get', `/emisores/${emisor}/tasas-igv`);
    exigirEstado(lista, 200, 'GET');
    expect(lista.body).toEqual([
      { desde: '2026-01-01', tasa: '18.00' },
      { desde: '2027-01-01', tasa: '17.00' },
    ]);
    const filasAntes = (await filasAuditoria(e.empresaId, 'configurar_tasa_igv')).length;
    expect(filasAntes).toBe(3);
    exigirEstado(await ponerTasa(ctx, token, emisor, '2027-01-01', '17.00'), 200, 'Repetir');
    exigirEstado(await ponerTasa(ctx, token, emisor, '2027-01-01', '17'), 200, 'Repetir sin ceros');
    expect((await filasAuditoria(e.empresaId, 'configurar_tasa_igv')).length).toBe(3);
    const cambiada = (await filasAuditoria(e.empresaId, 'configurar_tasa_igv')).find((f) =>
      f.texto.includes('17.00'),
    )!;
    expect(cambiada.texto).toContain('10.50');
  });

  it('la tasa va de 0.01 a 30.00 con 2 decimales y desde es una fecha real (400); un emisor de B o inexistente es 404', async () => {
    const emisor = A().emisor1;
    for (const tasa of ['0.00', '30.01', '18.123', 'abc', '']) {
      esperarError(
        await ponerTasa(ctx, admin(), emisor, '2031-02-01', tasa),
        400,
        'DATOS_INVALIDOS',
      );
    }
    for (const desde of ['2031-02-30', '2031-13-01', '01-02-2031', 'hoy']) {
      esperarError(await ponerTasa(ctx, admin(), emisor, desde, '18.00'), 400, 'DATOS_INVALIDOS');
    }
    exigirEstado(await ponerTasa(ctx, admin(), emisor, '2031-02-01', '0.01'), 200, 'Mínimo');
    exigirEstado(await ponerTasa(ctx, admin(), emisor, '2031-03-01', '30.00'), 200, 'Máximo');
    const ajeno = await ponerTasa(ctx, admin(), esc.B.emisor1, '2031-02-01', '18.00');
    const inexistente = await ponerTasa(ctx, admin(), randomUUID(), '2031-02-01', '18.00');
    esperarError(ajeno, 404, 'NO_ENCONTRADO');
    expect(ajeno.body).toEqual(inexistente.body);
    const lectura = await api(ctx, admin(), 'get', `/emisores/${esc.B.emisor1}/tasas-igv`);
    esperarError(lectura, 404, 'NO_ENCONTRADO');
  });
});

describe('criterio 7 · quién puede configurar', () => {
  it('solo el Administrador: los demás roles reciben 403 PROHIBIDO en las seis rutas, sin cambios ni auditoría', async () => {
    const cajas = await A().cajas();
    const filasAntes = (
      await filas('SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1', [A().id])
    )[0]!.n;
    const cajasAntes = (
      await filas('SELECT count(*)::int AS n FROM caja WHERE empresa_id = $1', [A().id])
    )[0]!.n;
    for (const rol of ['cajero', 'supervisor', 'mozo', 'cocina'] as const) {
      const token = A().token[rol];
      const intentos: Res[] = [
        await api(ctx, token, 'get', `/sucursales/${A().S1}/cajas`),
        await api(ctx, token, 'post', `/sucursales/${A().S1}/cajas`, { nombre: 'Intruso' }),
        await api(ctx, token, 'patch', `/sucursales/${A().S1}/cajas/${cajas.S1!.caja1}`, {
          nombre: 'Intruso',
        }),
        await ponerSerie(ctx, token!, A().S1, cajas.S1!.caja1, 'BOLETA', 'B899'),
        await api(ctx, token, 'get', `/emisores/${A().emisor1}/tasas-igv`),
        await ponerTasa(ctx, token!, A().emisor1, '2035-01-01', '12.00'),
      ];
      for (const r of intentos) esperarError(r, 403, 'PROHIBIDO');
    }
    expect(
      (await filas('SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1', [A().id]))[0]!
        .n,
    ).toBe(filasAntes);
    expect(
      (await filas('SELECT count(*)::int AS n FROM caja WHERE empresa_id = $1', [A().id]))[0]!.n,
    ).toBe(cajasAntes);
    expect(await filas(`SELECT 1 FROM serie WHERE serie = 'B899'`)).toEqual([]);
    expect(await filas(`SELECT 1 FROM emisor_tasa_igv WHERE desde = '2035-01-01'`)).toEqual([]);
  });

  it('el Administrador configura sin sucursal activa (la sucursal va en la ruta) y los cambios quedan con su autor', async () => {
    const e = await altaEmpresa(ctx, esc.sa, { sucursalesPorEmisor: 1 });
    const caja = await crearCaja(ctx, e.admin.token, e.sucursales[0]!.id, 'Caja del admin');
    const fila = (
      await filas(
        'SELECT creado_por_usuario_id, actualizado_por_usuario_id FROM caja WHERE id = $1',
        [caja.id],
      )
    )[0]!;
    expect(fila.creado_por_usuario_id).toBe(e.admin.id);
    expect(fila.actualizado_por_usuario_id).toBe(e.admin.id);
    const auditoria = (await filasAuditoria(e.empresaId, 'crear_caja'))[0]!;
    expect(auditoria.texto).toContain(e.sucursales[0]!.id);
  });
});
