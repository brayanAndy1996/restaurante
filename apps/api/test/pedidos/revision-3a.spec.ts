// Historia 004 · salón y cocina, revisión de la entrega 3a · pruebas del desarrollador (no protegidas) de los
// hallazgos I1, M2, M3, M4, M5, M7, M10 y M13 y de la migración de cantidades enteras (F1). Las fallas críticas
// del ataque (F1, F2 y "Todo listo") las cubre `salon-critica/ataque-ronda1.spec.ts`.
import { randomUUID } from 'node:crypto';
import {
  cocinaRespuestaSchema,
  eventoCocinaVistoSchema,
  type ComandaKds,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { ejecutarConPrincipal, type Principal } from '../../src/nucleo/principal';
import { SesionActual } from '../../src/modulos/seguridad';
import { UsoDeMesas } from '../../src/modulos/salon';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  anularItemOk,
  arrancarP2,
  clave,
  conEventos,
  enviarOk,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  llamar,
  pedirPrecuenta,
  prepararEscenarioP2,
  sesionContrasena,
  type AppP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { contarConsultas, escribir } from './ayudas-pedidos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let api: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const A = () => esc.e.A;
const t = () => esc.token;
const MINUTO = 60_000;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

const escribirEnA = <T>(fn: () => Promise<T>) => escribir(api, A().empresaId, fn);

const leerKds = async (token = t().cocina) => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/cocina/comandas' });
  exigirEstado(res, 200, 'GET /cocina/comandas');
  return cocinaRespuestaSchema.parse(res.body);
};

async function delKds(ordenId: string) {
  const r = await leerKds();
  const es = (c: ComandaKds) => c.orden.id === ordenId;
  return { pendientes: r.pendientes.filter(es), recientes: r.recientes.filter(es) };
}

const ponerEstadoLinea = (lineaId: string, estado: string) =>
  llamar(ctx, t().cocina, {
    metodo: 'put',
    ruta: `/cocina/lineas/${lineaId}/estado`,
    cuerpo: { estado },
  });

const visto = (comandaId: string) =>
  llamar(ctx, t().cocina, { metodo: 'put', ruta: `/cocina/comandas/${comandaId}/visto` });

/** Hace que todo lo de la orden haya pasado `minutos` antes: llegada, vistas y último cambio de cada línea. */
const envejecer = (ordenId: string, minutos: number) =>
  escribirEnA(async () => {
    await api.query(
      `UPDATE comanda_linea SET estado_en = estado_en - make_interval(mins => $2), actualizado_en = now()
        WHERE comanda_id IN (SELECT id FROM comanda WHERE orden_id = $1)`,
      [ordenId, minutos],
    );
    await api.query(
      `UPDATE comanda
          SET creado_en = creado_en - make_interval(mins => $2),
              vista_en = vista_en - make_interval(mins => $2), actualizado_en = now()
        WHERE orden_id = $1`,
      [ordenId, minutos],
    );
  });

async function ordenEnviada(lineas = [L.lomo(['3/4'], 1)], token = t().mozo) {
  const orden = await abrirOrden(ctx, esc.salon, token);
  const envio = await enviarOk(ctx, token, orden.id, lineas);
  return { orden, envio };
}

describe('F1 · las cantidades de los pedidos son integer', () => {
  it('comanda_linea, item y anulacion_item guardan sus cantidades como integer', async () => {
    const { rows } = await admin.query<{ tabla: string; columna: string; tipo: string }>(
      `SELECT table_name AS tabla, column_name AS columna, data_type AS tipo
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (('comanda_linea', 'cantidad_por_item'),
               ('comanda_linea', 'cantidad'), ('item', 'cantidad'), ('item', 'cantidad_anulada'),
               ('anulacion_item', 'cantidad'))`,
    );
    expect(rows).toHaveLength(5);
    for (const fila of rows) expect(fila.tipo, `${fila.tabla}.${fila.columna}`).toBe('integer');
  });
});

describe('I1 y M3 · GET /cocina/comandas: pendientes por índice y recientes por última actividad', () => {
  it('los índices parciales de las pendientes existen y son parciales', async () => {
    const { rows } = await admin.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('comanda_linea_pendiente_idx', 'comanda_no_vista_idx')`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs['comanda_linea_pendiente_idx']).toMatch(
      /\(comanda_id\) WHERE .*ENVIADO.*EN_PREPARACION/,
    );
    expect(defs['comanda_no_vista_idx']).toMatch(
      /\(sucursal_id\) WHERE .*vista_en IS NULL.*MARCHAR.*ANULACION/,
    );
  });

  it('una comanda vieja que se termina ahora aparece en recientes y se puede corregir', async () => {
    const { orden } = await ordenEnviada();
    await envejecer(orden.id, 5 * 60);
    // Llegó hace cinco horas y sigue pendiente (lo pendiente no vence).
    let { pendientes, recientes } = await delKds(orden.id);
    expect(pendientes).toHaveLength(1);
    const linea = pendientes[0]!.lineas[0]!;

    exigirEstado(await ponerEstadoLinea(linea.id, 'LISTO'), 200, 'terminar');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes).toHaveLength(0);
    expect(recientes).toHaveLength(1);
    expect(Date.parse(recientes[0]!.creadaEn)).toBe(
      Date.parse(INICIO_POR_DEFECTO) - 5 * 60 * MINUTO,
    );

    // Corregir el "Listo" puesto por error la devuelve a pendientes; terminarla otra vez, a recientes.
    exigirEstado(await ponerEstadoLinea(linea.id, 'ENVIADO'), 200, 'corregir');
    expect((await delKds(orden.id)).pendientes).toHaveLength(1);
    exigirEstado(await ponerEstadoLinea(linea.id, 'LISTO'), 200, 'terminar otra vez');

    // La hora corre desde el último cambio, no desde la llegada.
    ctx.reloj.avanzar(59 * MINUTO);
    expect((await delKds(orden.id)).recientes).toHaveLength(1);
    ctx.reloj.avanzar(2 * MINUTO);
    expect((await delKds(orden.id)).recientes).toHaveLength(0);
  });

  it('una comanda de marcha vieja que se marca vista ahora aparece en recientes', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(
      await llamar(ctx, t().mozo, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/marchas`,
        cuerpo: { id: randomUUID() },
        cabeceras: clave(),
      }),
      201,
      'marchar',
    );
    await envejecer(orden.id, 5 * 60);
    let { pendientes, recientes } = await delKds(orden.id);
    const marcha = pendientes.find((c) => c.tipo === 'MARCHAR')!;
    expect(marcha).toBeDefined();

    exigirEstado(await visto(marcha.id), 200, 'visto');
    ({ pendientes, recientes } = await delKds(orden.id));
    expect(pendientes.map((c) => c.tipo)).not.toContain('MARCHAR');
    expect(recientes.map((c) => c.tipo)).toContain('MARCHAR');
  });

  it('lo terminado hace más de una hora ya no aparece en recientes', async () => {
    const { orden } = await ordenEnviada();
    const linea = (await delKds(orden.id)).pendientes[0]!.lineas[0]!;
    exigirEstado(await ponerEstadoLinea(linea.id, 'LISTO'), 200, 'terminar');
    await envejecer(orden.id, 61);
    const r = await delKds(orden.id);
    expect(r.pendientes).toEqual([]);
    expect(r.recientes).toEqual([]);
  });

  it('el motivo de una anulación viene en la misma consulta: hay o no anulaciones, las consultas son las mismas', async () => {
    const { orden, envio } = await ordenEnviada([L.lomo(['3/4'], 3)]);
    const sin = await contarConsultas(ctx, () => leerKds());
    expect(sin.resultado.pendientes.some((c) => c.tipo === 'ANULACION')).toBe(false);

    await anularItemOk(ctx, t().supervisor, orden.id, envio.items[0]!.id, 1);
    const con = await contarConsultas(ctx, () => leerKds());
    const anulacion = con.resultado.pendientes.find(
      (c) => c.orden.id === orden.id && c.tipo === 'ANULACION',
    );
    expect(anulacion).toBeDefined();
    expect(anulacion!.motivo).toBe('Anulación de prueba');
    expect(con.consultas).toBe(sin.consultas);
  });
});

describe('M2 · cocina.visto', () => {
  it('marcar vista una comanda de marcha publica cocina.visto { comandaId } a la sucursal, una sola vez', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(
      await llamar(ctx, t().mozo, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/marchas`,
        cuerpo: { id: randomUUID() },
        cabeceras: clave(),
      }),
      201,
      'marchar',
    );
    const marcha = (await delKds(orden.id)).pendientes.find((c) => c.tipo === 'MARCHAR')!;

    const primera = await conEventos(ctx, () => visto(marcha.id));
    exigirEstado(primera.resultado, 200, 'visto');
    expect(primera.eventos).toHaveLength(1);
    const evento = eventoCocinaVistoSchema.parse(primera.eventos[0]);
    expect(evento).toEqual({
      empresaId: A().empresaId,
      sala: { tipo: 'sucursal', sucursalId: A().S1 },
      nombre: 'cocina.visto',
      datos: { comandaId: marcha.id },
    });

    const otra = await conEventos(ctx, () => visto(marcha.id));
    exigirEstado(otra.resultado, 200, 'visto otra vez');
    expect(otra.eventos).toEqual([]);
  });

  it('una comanda de otra sucursal responde 404 y no publica nada', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 1, { tiempo: 2 })]);
    exigirEstado(
      await llamar(ctx, t().mozo, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/marchas`,
        cuerpo: { id: randomUUID() },
        cabeceras: clave(),
      }),
      201,
      'marchar',
    );
    const marcha = (await delKds(orden.id)).pendientes.find((c) => c.tipo === 'MARCHAR')!;
    const cocinaS2 = await sesionContrasena(ctx, A().base.admin, A().S2);
    const { resultado, eventos } = await conEventos(ctx, () =>
      llamar(ctx, cocinaS2, { metodo: 'put', ruta: `/cocina/comandas/${marcha.id}/visto` }),
    );
    esperarError(resultado, 404, 'NO_ENCONTRADO');
    expect(eventos).toEqual([]);
  });
});

describe('M4 · la pre-cuenta vigente con otra versión de la orden se reemplaza', () => {
  it('con la misma versión devuelve la vigente; si la versión cambió, la invalida y emite la siguiente', async () => {
    const { orden } = await ordenEnviada([L.lomo(['3/4'], 2)]);
    const primeraId = randomUUID();
    const primera = await pedirPrecuenta(ctx, t().mozo, orden.id, primeraId);
    exigirEstado(primera, 201, 'primera pre-cuenta');
    expect(primera.body).toMatchObject({ id: primeraId, numero: 1 });

    // Sin cambios: la misma.
    const igual = await pedirPrecuenta(ctx, t().mozo, orden.id, randomUUID());
    exigirEstado(igual, 201, 'misma pre-cuenta');
    expect(igual.body).toMatchObject({ id: primeraId, numero: 1 });

    // La orden cambia de versión sin que nada invalide la pre-cuenta (la versión queda sin leer si no se compara).
    await escribirEnA(async () => {
      await api.query(
        `UPDATE orden SET version = version + 1, actualizado_en = now() WHERE id = $1`,
        [orden.id],
      );
    });
    const segundaId = randomUUID();
    const segunda = await pedirPrecuenta(ctx, t().mozo, orden.id, segundaId);
    exigirEstado(segunda, 201, 'segunda pre-cuenta');
    expect(segunda.body).toMatchObject({ id: segundaId, numero: 2 });

    const { rows } = await admin.query(
      `SELECT p.id, p.numero, p.version_orden, p.invalidada_en, o.version
         FROM precuenta p JOIN orden o ON o.id = p.orden_id AND o.empresa_id = p.empresa_id
        WHERE p.orden_id = $1 ORDER BY p.numero`,
      [orden.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].invalidada_en).not.toBeNull();
    expect(rows[1].invalidada_en).toBeNull();
    expect(rows[1].version_orden).toBe(rows[1].version);

    // Ahora la vigente es la nueva.
    const otra = await pedirPrecuenta(ctx, t().mozo, orden.id, randomUUID());
    expect(otra.body).toMatchObject({ id: segundaId, numero: 2 });
  });
});

describe('M5 · liberar una mesa publica también orden.cambio', () => {
  it('publica salon.cambio y orden.cambio de la orden liberada', async () => {
    const orden = await abrirOrden(ctx, esc.salon, t().mozo);
    const { resultado, eventos } = await conEventos(ctx, () =>
      llamar(ctx, t().mozo, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/liberacion`,
        cabeceras: clave(),
      }),
    );
    exigirEstado(resultado, 200, 'liberar');
    expect(eventos.map((e) => e.nombre).sort()).toEqual(['orden.cambio', 'salon.cambio']);
    const cambio = eventos.find((e) => e.nombre === 'orden.cambio')!;
    expect(cambio).toMatchObject({
      empresaId: A().empresaId,
      sala: { tipo: 'sucursal', sucursalId: A().S1 },
      datos: { ordenId: orden.id },
    });
  });
});

describe('M7 · la huella de la anulación no incluye el motivo', () => {
  it('el mismo id con otro motivo es la misma anulación (201 con lo guardado, sin otra fila); con otra cantidad, 422', async () => {
    const { orden, envio } = await ordenEnviada([L.lomo(['3/4'], 3)]);
    const itemId = envio.items[0]!.id;
    const id = randomUUID();
    const cuerpo = (cantidad: number, motivo: string) => ({
      id,
      cantidad,
      motivo,
      destinoStock: 'VUELVE',
    });
    const anular = (cantidad: number, motivo: string) =>
      llamar(ctx, t().supervisor, {
        metodo: 'post',
        ruta: `/ordenes/${orden.id}/items/${itemId}/anulaciones`,
        cuerpo: cuerpo(cantidad, motivo),
        cabeceras: clave(),
      });

    const primera = await anular(1, 'Se equivocaron de plato');
    exigirEstado(primera, 201, 'anular');
    const replica = await anular(1, 'Otro texto del motivo');
    exigirEstado(replica, 201, 'réplica con otro motivo');
    expect(replica.body.motivo).toBe('Se equivocaron de plato');

    esperarError(await anular(2, 'Se equivocaron de plato'), 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const { rows } = await admin.query(
      `SELECT count(*)::int AS filas FROM anulacion_item WHERE item_id = $1`,
      [itemId],
    );
    expect(rows[0].filas).toBe(1);
  });
});

describe('M10 · la sucursal activa sale de un solo lugar', () => {
  const principal = (sucursalId: string | null): Principal => ({
    tipo: 'PRUEBA',
    empresaId: A().empresaId,
    sesionId: null,
    usuarioId: null,
    superadministradorId: null,
    sucursalId,
    rol: null,
    esAdministrador: true,
    equipoId: null,
    equipoRecordadoId: null,
    debeCambiarContrasena: false,
  });

  it('SesionActual.sucursalActiva devuelve la sucursal o responde 409 SUCURSAL_NO_ELEGIDA', () => {
    const sesion = ctx.app.get(SesionActual);
    expect(ejecutarConPrincipal(principal(A().S1), () => sesion.sucursalActiva())).toBe(A().S1);
    let error: unknown;
    try {
      ejecutarConPrincipal(principal(null), () => sesion.sucursalActiva());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorAplicacion);
    expect(error).toMatchObject({ codigo: 'SUCURSAL_NO_ELEGIDA' });
    expect((error as ErrorAplicacion).getStatus()).toBe(409);
  });

  it('las rutas de pedidos con una sesión sin sucursal activa responden 409 SUCURSAL_NO_ELEGIDA', async () => {
    esperarError(
      await llamar(ctx, t().adminA, { metodo: 'get', ruta: '/cocina/comandas' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
    esperarError(
      await llamar(ctx, t().adminA, { metodo: 'get', ruta: '/salon' }),
      409,
      'SUCURSAL_NO_ELEGIDA',
    );
  });
});

describe('M13 · UsoDeMesas falla cerrado', () => {
  it('sin ningún comprobador registrado lanza un error y no responde que las mesas están libres', async () => {
    const uso = new UsoDeMesas();
    await expect(uso.conOrdenAbierta([randomUUID()])).rejects.toThrow(/ning[uú]n comprobador/);
    // Sin mesas que preguntar no hace falta comprobador.
    expect((await uso.conOrdenAbierta([])).size).toBe(0);
  });

  it('PedidosModule registra su comprobador: desactivar una mesa con orden abierta responde 409 EN_USO', async () => {
    const orden = await abrirOrden(ctx, esc.salon, t().mozo);
    esperarError(
      await llamar(ctx, t().adminA, {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/mesas/${orden.mesaId}`,
        cuerpo: { activa: false },
      }),
      409,
      'EN_USO',
    );
    // Una mesa libre sí se desactiva: el comprobador responde, no falla.
    const libre = await esc.salon.mesaNueva();
    exigirEstado(
      await llamar(ctx, t().adminA, {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/mesas/${libre}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar una mesa libre',
    );
  });
});
