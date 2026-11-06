// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P9 · El worker y el barrido con el contexto de cada empresa (ruta crítica), criterio 163:
// - un trabajo `{ empresaId: A, comprobanteId: <de B> }` no encuentra nada (la RLS lo oculta): no llama al PSE, no deja
//   intento ni cambia nada en A ni en B, y no registra datos de B; tampoco el trabajo de una empresa inexistente;
// - el barrido de A nunca toca envíos de B (ni los encola, ni los detiene, ni los alerta) y viceversa; la lista de
//   empresas la da `EmpresasConsulta.ids()` (solo ids);
// - la carga del trabajo en la cola lleva solo `empresaId` y `comprobanteId`;
// - cada transacción del worker queda trazada con el actor `worker:envio-pse`;
// - los roles de pg-boss (`restaurante_colas`, esquema `colas`) y de la carga del padrón (`restaurante_referencia`) no
//   tienen privilegios en `public`: un `SELECT` de `comprobante` con esos roles falla con 42501.
// Hoy falla porque `envio_pse` y las columnas de 6b no existen y el procesador y el barrido responden «No implementado».
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  arrancarFact,
  avanzar,
  capturarRegistros,
  cerrarAdmin,
  CLIENTE_RUC,
  cobrarFactura,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  exigirPse,
  envioDe,
  eventosPublicados,
  filas,
  intentosDe,
  limitarBarrido,
  procesar,
  procesarCola,
  turnoDe,
  type AppFact,
  type Cobrado,
  type EmpresaCaja,
  type Escenario,
} from './fabrica-facturacion';
import { EmpresasConsulta } from '../../src/modulos/plataforma';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;
const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

const CLIENTE_DE_B = {
  ...CLIENTE_RUC,
  nombre: 'Cliente Secreto de la Empresa B SAC',
  direccion: 'Calle Reservada 987, Arequipa',
};

async function cobroDe(e: EmpresaCaja, factura = false): Promise<Cobrado> {
  const turnoId = await turnoDe(ctx, e, 'cajero', 'S1', 'caja1');
  return factura
    ? cobrarFactura(ctx, e, { turnoId, cliente: e === B() ? CLIENTE_DE_B : CLIENTE_RUC })
    : cobrarLomo(ctx, e, { turnoId });
}

/** Todo lo que el worker podría tocar de un comprobante. */
async function foto(c: Cobrado) {
  return {
    comprobante: await comprobanteFila(c.comprobanteId),
    envio: await envioDe(c.comprobanteId),
    intentos: await intentosDe(c.comprobanteId),
  };
}
const conteo = async (tabla: string, empresaId: string): Promise<number> =>
  Number(
    (await filas(`SELECT count(*)::int AS n FROM ${tabla} WHERE empresa_id = $1`, [empresaId]))[0]!
      .n,
  );

describe('criterio 163 · un trabajo de una empresa con un comprobante de otra no encuentra nada', () => {
  it('{ empresaId: A, comprobanteId: de B } no llama al PSE, no cambia nada en A ni en B y no registra datos de B', async () => {
    const deA = await cobroDe(A());
    const deB = await cobroDe(B(), true);
    const antes = { A: await foto(deA), B: await foto(deB) };
    const envios = { A: await conteo('envio_pse', A().id), B: await conteo('envio_pse', B().id) };
    const llamadas = ctx.pse.llamadas().length;
    const registros = capturarRegistros();
    try {
      await procesar(ctx, A().id, deB.comprobanteId);
      await procesar(ctx, B().id, deA.comprobanteId);
      await procesar(ctx, randomUUID(), deA.comprobanteId);
      // También por la cola, con el trabajo mal armado (sola: sin el trabajo legítimo del cobro de A).
      ctx.cola.vaciar();
      await ctx.cola.encolar({ empresaId: A().id, comprobanteId: deB.comprobanteId });
      await procesarCola(ctx, [A().id]);
      const registrado = registros.texto();
      for (const dato of [
        CLIENTE_DE_B.nombre,
        CLIENTE_DE_B.direccion,
        CLIENTE_DE_B.numero,
        'Lomo saltado',
      ]) {
        expect(registrado, `los registros no llevan «${dato}»`).not.toContain(dato);
      }
    } finally {
      registros.restaurar();
    }
    expect(ctx.pse.llamadas()).toHaveLength(llamadas);
    expect(await foto(deA)).toEqual(antes.A);
    expect(await foto(deB)).toEqual(antes.B);
    expect(await conteo('envio_pse', A().id)).toBe(envios.A);
    expect(await conteo('envio_pse', B().id)).toBe(envios.B);
    expect((await foto(deB)).intentos).toEqual([]);
    expect((await envioDe(deB.comprobanteId))!.estado).toBe('PENDIENTE');
  });

  it('con el trabajo bien armado cada empresa procesa lo suyo (la prueba anterior no es vacía)', async () => {
    const deA = await cobroDe(A());
    const deB = await cobroDe(B());
    await procesar(ctx, A().id, deA.comprobanteId);
    await procesar(ctx, B().id, deB.comprobanteId);
    expect((await comprobanteFila(deA.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await comprobanteFila(deB.comprobanteId)).estado).toBe('ACEPTADO');
  });

  it('la carga del trabajo en la cola lleva solo empresaId y comprobanteId', async () => {
    const c = await cobroDe(A());
    const trabajo = ctx.cola.pendientes().find((t) => t.comprobanteId === c.comprobanteId)!;
    expect(trabajo).toBeDefined();
    expect(
      Object.keys(trabajo)
        .filter((k) => k !== 'startAfter')
        .sort(),
    ).toEqual(['comprobanteId', 'empresaId']);
    expect(trabajo.empresaId).toBe(A().id);
    expect(JSON.stringify(trabajo)).not.toMatch(/Lomo|Cliente|total|ruc/i);
  });
});

describe('criterio 163 · el barrido de cada empresa solo toca las suyas', () => {
  it('EmpresasConsulta.ids() da solo ids de empresas, y están A y B', async () => {
    const ids = await ctx.app.get(EmpresasConsulta, { strict: false }).ids();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.every((i) => typeof i === 'string' && UUID_RE.test(i))).toBe(true);
    expect(ids).toContain(A().id);
    expect(ids).toContain(B().id);
  });

  it('el barrido de A (aun después del plazo) no encola, detiene ni alerta envíos de B, y el de B no toca los de A', async () => {
    ctx.pse.reglas.fallarTransmision(1000);
    const deA = await cobroDe(A());
    const deB = await cobroDe(B(), true);
    await procesar(ctx, A().id, deA.comprobanteId);
    await procesar(ctx, B().id, deB.comprobanteId);
    ctx.cola.vaciar();
    ctx.publicador.limpiar();
    // Pasan 4 días: los dos envíos están vencidos y fuera de plazo.
    await avanzar(ctx, 4 * DIA, A(), B());
    const fotoB = await foto(deB);

    const soloA = limitarBarrido(ctx, [A().id]);
    try {
      await ctx.barrido.barrerAhora();
    } finally {
      soloA();
    }
    expect((await envioDe(deA.comprobanteId))!.estado).toBe('DETENIDO');
    expect(await foto(deB)).toEqual(fotoB);
    expect(ctx.cola.pendientes().filter((t) => t.comprobanteId === deB.comprobanteId)).toEqual([]);
    expect(eventosPublicados(ctx, 'facturacion.alerta').every((e) => e.empresaId === A().id)).toBe(
      true,
    );
    expect(
      eventosPublicados(ctx, 'facturacion.alerta').every(
        (e) => (e.sala as { sucursalId: string }).sucursalId === A().S1,
      ),
    ).toBe(true);

    const fotoA = await foto(deA);
    ctx.publicador.limpiar();
    const soloB = limitarBarrido(ctx, [B().id]);
    try {
      await ctx.barrido.barrerAhora();
    } finally {
      soloB();
    }
    expect((await envioDe(deB.comprobanteId))!.estado).toBe('DETENIDO');
    expect(await foto(deA)).toEqual(fotoA);
    expect(eventosPublicados(ctx, 'facturacion.alerta').every((e) => e.empresaId === B().id)).toBe(
      true,
    );
    expect(
      eventosPublicados(ctx, 'facturacion.alerta').every(
        (e) => (e.sala as { sucursalId: string }).sucursalId === B().S1,
      ),
    ).toBe(true);
  });
});

describe('criterio 163 · cada transacción del worker queda trazada con el actor worker:envio-pse', () => {
  it('el procesador deja el actor en envio_pse, intento_pse y el cambio de estado del comprobante', async () => {
    const c = await cobroDe(A());
    const persona = A().personas.cajero!.id;
    // Al registrarse el envío, en la emisión, el actor es la persona que cobró.
    const nacido = (await envioDe(c.comprobanteId))!;
    expect(nacido.creado_por_usuario_id).toBe(persona);
    expect(nacido.creado_por_sistema).toBeNull();

    await procesar(ctx, A().id, c.comprobanteId);
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio.actualizado_por_sistema).toBe('worker:envio-pse');
    expect(envio.actualizado_por_usuario_id).toBeNull();
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.length).toBeGreaterThan(0);
    for (const i of intentos) {
      expect(i.creado_por_sistema).toBe('worker:envio-pse');
      expect(i.creado_por_usuario_id).toBeNull();
    }
    const comprobante = await comprobanteFila(c.comprobanteId);
    expect(comprobante.estado).toBe('ACEPTADO');
    expect(comprobante.actualizado_por_sistema).toBe('worker:envio-pse');
    expect(comprobante.actualizado_por_usuario_id).toBeNull();
    // El comprobante conserva a quien lo emitió.
    expect(comprobante.creado_por_usuario_id).toBe(persona);
  });

  it('el barrido también: lo que detiene queda a nombre de worker:envio-pse', async () => {
    ctx.pse.reglas.fallarTransmision(1000);
    const c = await cobroDe(A());
    await procesar(ctx, A().id, c.comprobanteId);
    await avanzar(ctx, 4 * DIA, A(), B());
    const restaurar = limitarBarrido(ctx, [A().id]);
    try {
      await ctx.barrido.barrerAhora();
    } finally {
      restaurar();
    }
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio.estado).toBe('DETENIDO');
    expect(envio.actualizado_por_sistema).toBe('worker:envio-pse');
    expect(envio.actualizado_por_usuario_id).toBeNull();
  });
});

describe('criterio 163 · los roles de la cola (pg-boss) y de la carga del padrón no tienen privilegios en public', () => {
  let colas: Client;
  let referencia: Client;
  beforeAll(async () => {
    colas = await abrirCliente('colas');
    referencia = await abrirCliente('referencia');
  });
  afterAll(async () => {
    await colas?.end();
    await referencia?.end();
  });

  const TABLAS = [
    'comprobante',
    'comprobante_linea',
    'serie',
    'cobro',
    'empresa',
    'emisor',
    'usuario',
    'auditoria',
    'envio_pse',
    'intento_pse',
    'configuracion_pse',
    'nota_credito',
  ];

  it.each(TABLAS)('restaurante_colas no puede leer %s (42501)', async (tabla) => {
    const error = await errorDe(colas.query(`SELECT 1 FROM public.${tabla} LIMIT 1`));
    expect(error.code, error.message).toBe('42501');
  });

  it.each(TABLAS)('restaurante_referencia no puede leer %s (42501)', async (tabla) => {
    const error = await errorDe(referencia.query(`SELECT 1 FROM public.${tabla} LIMIT 1`));
    expect(error.code, error.message).toBe('42501');
  });

  it('ninguno de los dos puede crear objetos en public ni escribir en tablas de clientes', async () => {
    for (const [nombre, cliente] of [
      ['restaurante_colas', colas],
      ['restaurante_referencia', referencia],
    ] as const) {
      const crear = await errorDe(cliente.query('CREATE TABLE public.intruso_6b (id int)'));
      expect(crear.code, `${nombre}: ${crear.message}`).toBe('42501');
      const borrar = await errorDe(cliente.query('DELETE FROM public.comprobante'));
      expect(borrar.code, `${nombre}: ${borrar.message}`).toBe('42501');
      const insertar = await errorDe(
        cliente.query("INSERT INTO public.empresa (nombre) VALUES ('intrusa')"),
      );
      expect(insertar.code, `${nombre}: ${insertar.message}`).toBe('42501');
    }
  });

  it('cada uno solo toca lo suyo: la cola es dueña del esquema colas y no entra a referencia; la carga no entra a colas', async () => {
    const admin = await abrirCliente('admin');
    try {
      const dueno = await admin.query(
        `SELECT pg_get_userbyid(nspowner) AS dueno FROM pg_namespace WHERE nspname = 'colas'`,
      );
      expect(dueno.rows[0]?.dueno).toBe('restaurante_colas');
      const privilegios = async (rol: string, esquema: string) =>
        (await admin.query(`SELECT has_schema_privilege($1, $2, 'USAGE') AS uso`, [rol, esquema]))
          .rows[0]!.uso as boolean;
      expect(await privilegios('restaurante_colas', 'referencia')).toBe(false);
      expect(await privilegios('restaurante_referencia', 'colas')).toBe(false);
      expect(await privilegios('restaurante_referencia', 'referencia')).toBe(true);
    } finally {
      await admin.end();
    }
  });
});
