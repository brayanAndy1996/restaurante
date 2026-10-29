// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 2, a la entrega 3a. Cada falla del ataque (y la decisión del orquestador que la
// acompaña) se convierte aquí en pruebas. La API real con `RelojManual`, `PublicadorEnMemoria` e
// `InventarioObservador`, la carta de ejemplo de `spec.md` creada por las rutas de 003 y las órdenes abiertas,
// enviadas, anuladas y unidas por las rutas de 3a. Solo usan contratos públicos; para leer filas (y fijar un
// contador por SQL con el actor fijado), un cliente administrador.
//
// FA1 (crítica, criterio 37). Una réplica de anulación tras unir mesas: el Supervisor anula 1 unidad de una
// Gaseosa × 3 de O2, se une O2 a O1 (el ítem pasa a O1 y O2 queda `UNIDA`) y se repite el mismo cuerpo con el
// mismo `id` de anulación y otra `Idempotency-Key`, por la ruta de O2 y por la de O1: 201 con la anulación
// existente, sin anular de nuevo (`cantidad_anulada` sigue en 1, una sola fila `anulacion_item`, una sola de
// auditoría `anular_item`, ninguna comanda `ANULACION` nueva, ni llamada al inventario ni eventos). Con el Mozo
// que usa clave, la réplica con una autorización nueva devuelve la existente y consume la nueva (criterio 37).
// Se repite con un producto con estación (Lomo saltado) para que la comanda `ANULACION` exista de verdad.
//
// Decisión del orquestador (criterio 29 aplicado a las anulaciones). Una anulación NUEVA (un `id` que no existe)
// de un ítem de una orden `UNIDA`, por la ruta de la orden absorbida, responde 409 `ORDEN_NO_ABIERTA` con
// `ordenId` de la orden principal, como el envío; no 404. Lo mismo `POST /ordenes/:id/anulacion` sobre una orden
// `UNIDA`. No cambia nada y la autorización no se consume.
//
// Criterio 70 (guarda de nombres). La guarda de la API rechaza antes de la base `pg_lock_status`,
// `pg_isolation_test_session_is_blocked` y `pg_notification_queue_usage` igual que los demás nombres del
// criterio (con esquema, comillas, mayúsculas, tras otra sentencia y tras comentarios); dentro de literales y
// comentarios siguen permitidos. Se ejecutan por la API real (`ContextoEmpresa` y el `Sequelize` de la API), como
// `tiempo-real-aislamiento.spec.ts`: `contieneSentenciaNoPermitida` solo mira la primera palabra de cada
// sentencia, no los nombres.
//
// Números de envío y de pre-cuenta (criterios 23 y 52). Con `envio.numero` (o `precuenta.numero`) fijado en 32767
// por SQL, el siguiente envío (o la siguiente pre-cuenta) responde 201 con el número 32768: el contador no puede
// quedar atado a un `smallint`.
import { anulacionRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { variantes, type EntradaProhibida } from '../aislamiento/nombres-prohibidos';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  arrancarP2,
  conEventos,
  enviarComanda,
  enviarOk,
  envio,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  pedirPrecuenta,
  prepararEscenarioP2,
  unirMesasOk,
  verOrden,
  type AppP2,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
  type Res,
} from './fabrica-p2';
import {
  anulacionesDelItem,
  anularItem,
  anularOrden,
  asentar,
  auditoriaNueva,
  auditoriaSalon,
  autorizacionGuardada,
  cuerpoDeAnulacion,
  instantaneaSalon,
  pedirAutorizacion,
} from './fabrica-p3';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const A = () => esc.e.A;
const t = () => esc.token;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const abrir = (token: string = t().mozo): Promise<OrdenAbierta> =>
  abrirOrden(ctx, esc.salon, token);

// ===================================================================================================
// Ayudantes
// ===================================================================================================

/** Lo que una réplica o un rechazo no pueden cambiar: las tablas de salón y la auditoría de salón. */
async function foto() {
  return {
    tablas: await instantaneaSalon(admin, A().empresaId),
    auditoria: await auditoriaSalon(admin, A().empresaId),
  };
}

/** Autorización de clave del Supervisor para el Mozo (queda atada a su sesión). */
const autorizacionDeMozo = (
  accion: 'ANULAR_ITEM_ENVIADO' | 'ANULAR_ORDEN' = 'ANULAR_ITEM_ENVIADO',
  motivo = 'Autorizo la anulación',
) => pedirAutorizacion(ctx, t().mozo, A().supervisor.pin, accion, motivo);

interface FilaDeItem {
  cantidad: number;
  cantidad_anulada: number;
  orden_id: string;
}

async function filaDeItem(itemId: string): Promise<FilaDeItem> {
  const { rows } = await admin.query<FilaDeItem>(
    `SELECT cantidad, cantidad_anulada, orden_id FROM item WHERE id = $1`,
    [itemId],
  );
  expect(rows, `ítem ${itemId}`).toHaveLength(1);
  return rows[0]!;
}

/** Cuántas comandas `ANULACION` tienen esas órdenes. */
async function comandasDeAnulacionDe(ordenIds: string[]): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comanda WHERE orden_id = ANY($1::uuid[]) AND tipo = 'ANULACION'`,
    [ordenIds],
  );
  return rows[0]!.n;
}

const idsDe = (comandas: { id: string }[]) => comandas.map((c) => c.id).sort();

// ===================================================================================================
// FA1 · La réplica de una anulación después de unir mesas (criterio 37)
// ===================================================================================================

type Producto = 'Gaseosa 1 L' | 'Lomo saltado';
const PRODUCTOS: Producto[] = ['Gaseosa 1 L', 'Lomo saltado'];

const lineaDe = (producto: Producto, cantidad: number): LineaCuerpo =>
  producto === 'Gaseosa 1 L' ? L.gaseosa(cantidad) : L.lomo(['Jugoso'], cantidad);

const MOTIVO_ORIGINAL = 'Se cayó al piso';

/**
 * O1 con el producto × 1 y O2 con el producto × 3; `quien` anula 1 unidad del ítem de O2 con `VUELVE` (el
 * Supervisor sin clave; el Mozo con una autorización del Supervisor); y el Mozo une la mesa de O2 a O1.
 */
async function ordenesUnidasConAnulacion(producto: Producto, quien: 'supervisor' | 'mozo') {
  const o1 = await abrir();
  const o2 = await abrir();
  await enviarOk(ctx, t().mozo, o1.id, [lineaDe(producto, 1)]);
  const envioDeO2 = await enviarOk(ctx, t().mozo, o2.id, [lineaDe(producto, 3)]);
  const item = envioDeO2.items[0]!;
  const cuerpo = cuerpoDeAnulacion({
    cantidad: 1,
    motivo: MOTIVO_ORIGINAL,
    destinoStock: 'VUELVE',
  });
  const autorizacion = quien === 'mozo' ? (await autorizacionDeMozo()).autorizacionId : null;
  const primera = await anularItem(
    ctx,
    quien === 'mozo' ? t().mozo : t().supervisor,
    o2.id,
    item.id,
    cuerpo,
    { autorizacion },
  );
  exigirEstado(primera, 201, 'la primera anulación (antes de unir)');
  anulacionRespuestaSchema.parse(primera.body);
  exigirEstado(await unirMesasOk(ctx, t().mozo, o1.id, [o2.mesaId]), 200, 'unir O2 a O1');
  expect((await filaDeItem(item.id)).orden_id, 'el ítem pasó a la principal').toBe(o1.id);
  return { o1, o2, item, cuerpo, primera };
}

describe.each(PRODUCTOS)(
  'FA1 · réplica de una anulación tras unir mesas (criterio 37) · %s',
  (producto) => {
    const comandasEsperadas = producto === 'Lomo saltado' ? 1 : 0;

    describe.each(['O2', 'O1'] as const)('por la ruta de %s', (porLaRutaDe) => {
      it('el Supervisor repite el mismo id con otra Idempotency-Key: 201 con la anulación X y nada cambia', async () => {
        const { o1, o2, item, cuerpo, primera } = await ordenesUnidasConAnulacion(
          producto,
          'supervisor',
        );
        expect(await comandasDeAnulacionDe([o1.id, o2.id])).toBe(comandasEsperadas);
        const ruta = porLaRutaDe === 'O2' ? o2 : o1;
        const antes = await foto();
        const { resultado, eventos } = await conEventos(ctx, () =>
          anularItem(ctx, t().supervisor, ruta.id, item.id, cuerpo),
        );

        expect(resultado.status, `réplica por ${porLaRutaDe}: ${resultado.text}`).toBe(201);
        const replica = anulacionRespuestaSchema.parse(resultado.body);
        expect(replica).toMatchObject({
          id: cuerpo.id,
          itemId: item.id,
          cantidad: 1,
          motivo: MOTIVO_ORIGINAL,
          destinoStock: 'VUELVE',
          item: { id: item.id, cantidadAnulada: 1, cantidadVigente: 2, estado: 'ENVIADO' },
        });
        expect(idsDe(replica.comandas)).toEqual(idsDe(primera.body.comandas));

        // Ni se anuló de nuevo, ni se guardó nada, ni se avisó al inventario ni al resto de los equipos.
        expect(await filaDeItem(item.id)).toMatchObject({ cantidad: 3, cantidad_anulada: 1 });
        expect(await anulacionesDelItem(admin, item.id)).toHaveLength(1);
        expect(
          (await auditoriaSalon(admin, A().empresaId, { entidadId: item.id })).filter(
            (f) => f.accion === 'anular_item',
          ),
        ).toHaveLength(1);
        expect(await comandasDeAnulacionDe([o1.id, o2.id])).toBe(comandasEsperadas);
        expect(await foto()).toEqual(antes);
        expect(ctx.inventario.llamadas()).toEqual([]);
        expect(eventos).toEqual([]);
      });

      it('el Mozo con una autorización nueva recibe la anulación existente y consume la nueva, sin anular de nuevo', async () => {
        const { o1, o2, item, cuerpo, primera } = await ordenesUnidasConAnulacion(producto, 'mozo');
        const ruta = porLaRutaDe === 'O2' ? o2 : o1;
        const nueva = await autorizacionDeMozo('ANULAR_ITEM_ENVIADO', 'Otra vez la clave');
        expect((await autorizacionGuardada(admin, nueva.autorizacionId)).usada_en).toBeNull();
        await asentar();
        const antes = await foto();
        const { resultado, eventos } = await conEventos(ctx, () =>
          anularItem(ctx, t().mozo, ruta.id, item.id, cuerpo, {
            autorizacion: nueva.autorizacionId,
          }),
        );

        expect(resultado.status, `réplica por ${porLaRutaDe}: ${resultado.text}`).toBe(201);
        const replica = anulacionRespuestaSchema.parse(resultado.body);
        expect(replica).toMatchObject({
          id: cuerpo.id,
          itemId: item.id,
          cantidad: 1,
          motivo: MOTIVO_ORIGINAL,
          destinoStock: 'VUELVE',
          item: { id: item.id, cantidadAnulada: 1, cantidadVigente: 2 },
        });
        expect(idsDe(replica.comandas)).toEqual(idsDe(primera.body.comandas));

        // La autorización nueva queda usada y lo dice su fila de 002; no hay otra anulación ni otro `anular_item`.
        expect((await autorizacionGuardada(admin, nueva.autorizacionId)).usada_en).not.toBeNull();
        const nuevas = await auditoriaNueva(admin, A().empresaId, antes.auditoria);
        expect(nuevas.map((f) => f.accion)).toEqual(['ANULAR_ITEM_ENVIADO']);
        expect(nuevas[0]).toMatchObject({ autorizacion_id: nueva.autorizacionId });
        expect(await filaDeItem(item.id)).toMatchObject({ cantidad: 3, cantidad_anulada: 1 });
        expect(await anulacionesDelItem(admin, item.id)).toHaveLength(1);
        expect(
          (await auditoriaSalon(admin, A().empresaId, { entidadId: item.id })).filter(
            (f) => f.accion === 'anular_item',
          ),
        ).toHaveLength(1);
        expect(await comandasDeAnulacionDe([o1.id, o2.id])).toBe(comandasEsperadas);
        expect((await foto()).tablas).toEqual(antes.tablas);
        expect(ctx.inventario.llamadas()).toEqual([]);
        expect(eventos).toEqual([]);
      });
    });
  },
);

// ===================================================================================================
// Criterio 29 aplicado a las anulaciones · una orden UNIDA no se anula: se manda a la principal
// ===================================================================================================

describe('criterio 29 · una anulación nueva por la ruta de una orden UNIDA responde 409 ORDEN_NO_ABIERTA con la principal', () => {
  /** O1 y O2 con un Lomo cada una; el Mozo une la mesa de O2 a O1: O2 queda `UNIDA`, su ítem pasa a O1. */
  async function ordenesUnidas() {
    const o1 = await abrir();
    const o2 = await abrir();
    await enviarOk(ctx, t().mozo, o1.id, [L.lomo(['Jugoso'], 2)]);
    const envioDeO2 = await enviarOk(ctx, t().mozo, o2.id, [L.lomo(['3/4'], 2)]);
    await unirMesasOk(ctx, t().mozo, o1.id, [o2.mesaId]);
    const orden2 = await verOrden(ctx, t().mozo, o2.id);
    exigirEstado(orden2, 200, 'GET de la orden absorbida');
    expect(orden2.body).toMatchObject({ estado: 'UNIDA', unidaA: o1.id });
    return { o1, o2, item: envioDeO2.items[0]! };
  }

  const exigirRechazoConPrincipal = (res: Res, principalId: string) => {
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect(res.body.ordenId, 'ordenId de la orden principal').toBe(principalId);
  };

  it('el Supervisor anula un ítem con un id nuevo por la ruta de O2: 409 con el ordenId de O1 y nada cambia', async () => {
    const { o1, o2, item } = await ordenesUnidas();
    const antes = await foto();
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularItem(ctx, t().supervisor, o2.id, item.id, cuerpoDeAnulacion({ cantidad: 1 })),
    );
    exigirRechazoConPrincipal(resultado, o1.id);
    expect(await foto()).toEqual(antes);
    expect(await filaDeItem(item.id)).toMatchObject({ cantidad_anulada: 0, orden_id: o1.id });
    expect(await anulacionesDelItem(admin, item.id)).toEqual([]);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('el Mozo con clave recibe el mismo 409, la autorización no se consume y sirve después por la ruta de O1', async () => {
    const { o1, o2, item } = await ordenesUnidas();
    const auth = await autorizacionDeMozo();
    await asentar();
    const antes = await foto();
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularItem(ctx, t().mozo, o2.id, item.id, cuerpoDeAnulacion({ cantidad: 1 }), {
        autorizacion: auth.autorizacionId,
      }),
    );
    exigirRechazoConPrincipal(resultado, o1.id);
    expect(await foto()).toEqual(antes);
    expect(await anulacionesDelItem(admin, item.id)).toEqual([]);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(eventos).toEqual([]);
    expect(
      (await autorizacionGuardada(admin, auth.autorizacionId)).usada_en,
      'la autorización sigue disponible',
    ).toBeNull();

    // La PWA lleva al mozo a la principal y repite ahí con la misma autorización: ahora sí.
    const enLaPrincipal = await anularItem(
      ctx,
      t().mozo,
      o1.id,
      item.id,
      cuerpoDeAnulacion({ cantidad: 1 }),
      { autorizacion: auth.autorizacionId },
    );
    exigirEstado(enLaPrincipal, 201, 'repetir por la ruta de la principal');
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).not.toBeNull();
    expect(await filaDeItem(item.id)).toMatchObject({ cantidad_anulada: 1 });
  });

  it('varios rechazos seguidos dan la misma respuesta y siguen sin cambiar nada', async () => {
    const { o1, o2, item } = await ordenesUnidas();
    const antes = await foto();
    for (let i = 0; i < 3; i++) {
      exigirRechazoConPrincipal(
        await anularItem(ctx, t().supervisor, o2.id, item.id, cuerpoDeAnulacion({ cantidad: 1 })),
        o1.id,
      );
    }
    expect(await foto()).toEqual(antes);
  });

  it('POST /ordenes/:id/anulacion sobre la orden UNIDA, con el Supervisor: 409 con el ordenId de O1 y nada cambia', async () => {
    const { o1, o2 } = await ordenesUnidas();
    const antes = await foto();
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularOrden(ctx, t().supervisor, o2.id),
    );
    exigirRechazoConPrincipal(resultado, o1.id);
    expect(await foto()).toEqual(antes);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(eventos).toEqual([]);
    // La principal sigue abierta y la absorbida sigue `UNIDA`.
    expect((await verOrden(ctx, t().mozo, o1.id)).body.estado).toBe('ABIERTA');
    expect((await verOrden(ctx, t().mozo, o2.id)).body.estado).toBe('UNIDA');
  });

  it('POST /ordenes/:id/anulacion sobre la orden UNIDA, con el Mozo y su clave: 409 y la autorización no se consume', async () => {
    const { o1, o2 } = await ordenesUnidas();
    const auth = await autorizacionDeMozo('ANULAR_ORDEN');
    await asentar();
    const antes = await foto();
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularOrden(
        ctx,
        t().mozo,
        o2.id,
        { motivo: 'Se fueron sin pedir', destinoStock: 'VUELVE' },
        { autorizacion: auth.autorizacionId },
      ),
    );
    exigirRechazoConPrincipal(resultado, o1.id);
    expect(await foto()).toEqual(antes);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(eventos).toEqual([]);
    expect((await autorizacionGuardada(admin, auth.autorizacionId)).usada_en).toBeNull();
  });
});

// ===================================================================================================
// Criterio 70 · La guarda de la API y los nombres nuevos del canal lateral
// ===================================================================================================

/** Los nombres que faltaban en la lista del criterio 70, con una sentencia válida que los menciona. */
const ENTRADAS_RONDA2: EntradaProhibida[] = [
  {
    nombre: 'pg_lock_status',
    grupo: '22d',
    sql: (n) => `SELECT * FROM ${n}()`,
    esquema: 'pg_catalog',
  },
  {
    nombre: 'pg_isolation_test_session_is_blocked',
    grupo: '22d',
    sql: (n) => `SELECT ${n}(1, '{2}')`,
    esquema: 'pg_catalog',
  },
  {
    nombre: 'pg_notification_queue_usage',
    grupo: '22d',
    sql: (n) => `SELECT ${n}()`,
    esquema: 'pg_catalog',
  },
];

const ALIAS_RONDA2 = [
  'mi_pg_lock_status',
  'x_pg_isolation_test_session_is_blocked',
  'mi_pg_notification_queue_usage',
];

describe('criterio 70 · la guarda de la API rechaza antes de la base pg_lock_status, pg_isolation_test_session_is_blocked y pg_notification_queue_usage', () => {
  let sequelize: Sequelize;
  let contexto: ContextoEmpresa;
  let sucursales: string[];

  beforeAll(async () => {
    sequelize = ctx.app.get<Sequelize>(CONEXION_API);
    contexto = ctx.app.get(ContextoEmpresa);
    const { rows } = await admin.query<{ id: string }>(
      `SELECT id FROM sucursal WHERE empresa_id = $1 ORDER BY id`,
      [A().empresaId],
    );
    sucursales = rows.map((r) => r.id).sort();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
  });

  type Fila = { id: string };
  const describir = (valor: unknown) =>
    valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : String(valor);

  /**
   * Corre `sql` dentro de `ejecutar(A)` y luego un SELECT sobre sucursal en la misma transacción. Devuelve un
   * texto con el problema, o `null` si la sentencia se rechazó antes de la base y la transacción sigue sana.
   */
  async function problemaAlRechazar(sql: string): Promise<string | null> {
    const visto = await contexto.ejecutar(A().empresaId, async () => {
      let error: unknown;
      try {
        await sequelize.query(sql);
      } catch (e) {
        error = e;
      }
      let lectura: Fila[] | string;
      try {
        lectura = await sequelize.query<Fila>('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
        });
      } catch (e) {
        lectura = describir(e);
      }
      return { error, lectura };
    });
    if (visto.error === undefined) return 'la sentencia tuvo éxito (no se rechazó)';
    if (visto.error instanceof DatabaseError) return `llegó a la base: ${describir(visto.error)}`;
    if (!(visto.error instanceof Error))
      return `se lanzó un valor que no es un Error: ${String(visto.error)}`;
    if (typeof visto.lectura === 'string') return `el SELECT posterior falló: ${visto.lectura}`;
    const vistos = visto.lectura.map((f) => f.id).sort();
    if (JSON.stringify(vistos) !== JSON.stringify(sucursales)) {
      return `el SELECT posterior no devolvió solo las filas de A: ${vistos.join(',')}`;
    }
    return null;
  }

  it.each(ENTRADAS_RONDA2.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes y el SELECT posterior solo ve filas de A',
    async (_nombre, entrada) => {
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const problema = await problemaAlRechazar(sql);
        if (problema !== null)
          problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it.each(ALIAS_RONDA2)(
    'control · el alias %s (que contiene un nombre dentro de otro identificador) se ejecuta',
    async (alias) => {
      const filas = await contexto.ejecutar(A().empresaId, async () => {
        await sequelize.query(`SELECT 1 AS ${alias}`);
        return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
      });
      expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
    },
  );

  it.each([
    [
      'comillas simples',
      `'pg_lock_status pg_isolation_test_session_is_blocked pg_notification_queue_usage'`,
    ],
    ['E-string', `E'pg_lock_status pg_notification_queue_usage'`],
    ['comillas de dólar', `$$pg_lock_status(); pg_isolation_test_session_is_blocked(1, '{2}')$$`],
    [
      'comillas de dólar con etiqueta',
      `$q$pg_notification_queue_usage pg_isolation_test_session_is_blocked$q$`,
    ],
  ])(
    'control · un UPDATE con un literal (%s) con esos nombres guarda el valor tal cual',
    async (_nombre, literal) => {
      const esperado = (await admin.query<{ v: string }>(`SELECT ${literal} AS v`)).rows[0]!.v;
      await contexto.ejecutar(
        A().empresaId,
        () =>
          sequelize.query(
            `UPDATE sucursal SET direccion = ${literal} WHERE id = '${sucursales[0]}'`,
          ),
        { actor: { sistema: 'prueba' } },
      );
      const { rows } = await admin.query<{ direccion: string }>(
        'SELECT direccion FROM sucursal WHERE id = $1',
        [sucursales[0]],
      );
      expect(rows[0]!.direccion).toBe(esperado);
    },
  );

  it.each([
    `/* pg_lock_status pg_isolation_test_session_is_blocked */ SELECT id FROM sucursal`,
    `-- pg_notification_queue_usage pg_lock_status\nSELECT id FROM sucursal`,
    `SELECT id FROM sucursal /* pg_notification_queue_usage pg_isolation_test_session_is_blocked */`,
  ])(
    'control · un comentario con esos nombres antes o después de un SELECT no se rechaza: %j',
    async (sql) => {
      const filas = await contexto.ejecutar(A().empresaId, () =>
        sequelize.query<Fila>(sql, { type: QueryTypes.SELECT }),
      );
      expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
    },
  );
});

// ===================================================================================================
// Números de envío y de pre-cuenta que pasan de 32767 (criterios 23 y 52)
// ===================================================================================================

/** Fija `numero` de una fila de `envio` o de `precuenta` por SQL, con un actor de sistema fijado (como el cobro). */
async function fijarNumero(
  tabla: 'envio' | 'precuenta',
  id: string,
  numero: number,
): Promise<void> {
  await admin.query('BEGIN');
  try {
    await admin.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba-004-ronda2']);
    const { rowCount } = await admin.query(`UPDATE ${tabla} SET numero = $1 WHERE id = $2`, [
      numero,
      id,
    ]);
    if (rowCount !== 1) throw new Error(`No existe ${tabla} ${id}`);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

const numeroGuardado = async (tabla: 'envio' | 'precuenta', id: string): Promise<number> => {
  const { rows } = await admin.query<{ numero: number }>(
    `SELECT numero FROM ${tabla} WHERE id = $1`,
    [id],
  );
  expect(rows, `${tabla} ${id}`).toHaveLength(1);
  return rows[0]!.numero;
};

describe('criterio 23 · el número de envío sigue después de 32767', () => {
  it('con envio.numero en 32767, el siguiente envío responde 201 con el número 32768, como adición', async () => {
    const o = await abrir();
    const primero = await enviarOk(ctx, t().mozo, o.id, [L.lomo(['Jugoso'], 1)]);
    expect(primero.numero).toBe(1);
    await fijarNumero('envio', primero.id, 32767);

    const segundo = await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)]));
    exigirEstado(segundo, 201, 'el envío siguiente a 32767');
    expect(segundo.body).toMatchObject({ ordenId: o.id, numero: 32768, esAdicion: true });
    expect(segundo.body.items[0]).toMatchObject({ envioNumero: 32768, esAdicion: true });
    expect(await numeroGuardado('envio', segundo.body.id)).toBe(32768);

    // Y uno más: 32769.
    const tercero = await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['Jugoso'], 1)]));
    exigirEstado(tercero, 201, 'el envío siguiente a 32768');
    expect(tercero.body).toMatchObject({ numero: 32769, esAdicion: true });
    expect(tercero.body.comandas.map((c: { tipo: string }) => c.tipo)).toEqual(['ADICION']);

    const orden = await verOrden(ctx, t().mozo, o.id);
    exigirEstado(orden, 200, 'GET /ordenes/:id');
    expect(
      (orden.body.items as { envioNumero: number }[]).map((i) => i.envioNumero).sort(),
    ).toEqual([32767, 32768, 32769]);
  });
});

describe('criterio 52 · el número de pre-cuenta sigue después de 32767', () => {
  it('con precuenta.numero en 32767, la siguiente pre-cuenta responde 201 con el número 32768', async () => {
    const o = await abrir();
    await enviarOk(ctx, t().mozo, o.id, [L.lomo(['Jugoso'], 1)]);
    const primera = await pedirPrecuenta(ctx, t().mozo, o.id);
    exigirEstado(primera, 201, 'la primera pre-cuenta');
    expect(primera.body.numero).toBe(1);
    await fijarNumero('precuenta', primera.body.id, 32767);

    // Una adición devuelve la orden a ABIERTA e invalida la pre-cuenta vigente (criterio 53).
    await enviarOk(ctx, t().mozo, o.id, [L.gaseosa(1)]);
    const siguiente = await pedirPrecuenta(ctx, t().mozo, o.id);
    exigirEstado(siguiente, 201, 'la pre-cuenta siguiente a 32767');
    expect(siguiente.body.numero).toBe(32768);
    expect(siguiente.body.id).not.toBe(primera.body.id);
    expect(await numeroGuardado('precuenta', siguiente.body.id)).toBe(32768);

    // Pedirla de nuevo, sin cambios, devuelve la vigente (criterio 52): mismo número.
    const otra = await pedirPrecuenta(ctx, t().mozo, o.id);
    exigirEstado(otra, 201, 'repetir la pre-cuenta');
    expect(otra.body).toMatchObject({ id: siguiente.body.id, numero: 32768 });

    const orden = await verOrden(ctx, t().mozo, o.id);
    exigirEstado(orden, 200, 'GET /ordenes/:id');
    expect(orden.body.precuentaVigente).toMatchObject({ id: siguiente.body.id, numero: 32768 });
  });
});
