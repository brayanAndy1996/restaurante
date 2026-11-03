// Historia 005, grupo C2 · la carta pública, `prepararLineas` y las lecturas que usa el módulo de llamados: pruebas
// del desarrollador (no protegidas). Cubren que `CartaVentaService.prepararLineas` coincide con `prepararLinea` línea
// por línea (también en los rechazos), `SucursalesConsultaService.datosPublicos` (solo lo público),
// `PedidosConsultaService.ordenesVigentesDeMesas` (mesa libre, ocupada y unida), las cabeceras de caché, el `ETag` y el
// 304 de la carta, la lista de sucursales y la disponibilidad, el número fijo de consultas de la carta (5 productos o
// 50 más), y el límite por mesa y el aviso `Retry-After` con los llamados cerrados por SQL.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { CartaVentaService } from '../../src/modulos/carta';
import { PedidosConsultaService } from '../../src/modulos/pedidos';
import { SucursalesConsultaService } from '../../src/modulos/plataforma';
import { enTransaccion } from '../aislamiento/fabrica';
import {
  registrarConsultas,
  ES_CONTROL_DE_TRANSACCION,
} from '../llamados-critica/fabrica-aislamiento';
import { unirMesasOk } from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import {
  HORA_DE_SERVICIO,
  abrirMesa,
  arrancarLlamados,
  clienteNuevo,
  crearOk,
  cuerpoLlamarMozo,
  enviarLlamado,
  esperarError,
  lineaDe,
  lineasDe,
  mesasConCodigo,
  prepararEscenarioLlamados,
  productoPropio,
  publicarCartas,
  type AppLlamados,
  type EscenarioLlamados,
} from '../llamados-critica/fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
  await publicarCartas(ctx, esc);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const empresaA = () => esc.e.A.empresaId;
const enContextoDeA = <T>(fn: () => Promise<T>): Promise<T> =>
  ctx.app.get(ContextoEmpresa).ejecutar(empresaA(), fn, { actor: { sistema: 'prueba' } });

const rutaCarta = () => `/publico/cartas/${esc.slugs.empresaA}/${esc.slugs.sucursalS1}`;

describe('CartaVentaService.prepararLineas', () => {
  it('coincide con prepararLinea línea por línea: las buenas con su precio y las malas con el mismo error', async () => {
    const L = lineasDe(esc.carta);
    const lineas = [
      L.lomo(['3/4', 'Huevo'], 2),
      L.gaseosa(1),
      L.combo(['Cerveza', 'Ensalada'], 1),
      L.lomo([], 1), // falta el término obligatorio
      lineaDe(esc.carta.huevoFrito), // no se vende solo
      lineaDe(randomUUID()), // no existe
      L.menu([], 1), // menú sin armar
    ];
    const sucursalId = esc.e.A.S1;
    const instante = ctx.reloj.ahora();
    const { juntas, una } = await enContextoDeA(async () => {
      const ventas = ctx.app.get(CartaVentaService);
      const juntas = await ventas.prepararLineas(
        sucursalId,
        lineas.map((l) => ({
          productoId: l.productoId,
          modificadorIds: l.modificadorIds,
          cantidad: l.cantidad,
        })),
        instante,
      );
      const una = [];
      for (const l of lineas) {
        try {
          una.push({
            ok: true as const,
            linea: await ventas.prepararLinea({
              sucursalId,
              productoId: l.productoId,
              modificadorIds: l.modificadorIds,
              cantidad: l.cantidad,
              instante,
            }),
          });
        } catch (error) {
          una.push({ ok: false as const, error });
        }
      }
      return { juntas, una };
    });
    expect(juntas).toHaveLength(lineas.length);
    juntas.forEach((resultado, i) => {
      const esperado = una[i]!;
      expect(resultado.ok, `línea ${i}`).toBe(esperado.ok);
      if (resultado.ok && esperado.ok) expect(resultado.linea).toEqual(esperado.linea);
      if (!resultado.ok && !esperado.ok) {
        const a = resultado.error as { codigo?: string; message: string; campos?: unknown };
        const b = esperado.error as { codigo?: string; message: string; campos?: unknown };
        expect(a.constructor).toBe(b.constructor);
        expect(a.codigo).toBe(b.codigo);
        expect(a.message).toBe(b.message);
        expect(a.campos).toEqual(b.campos);
      }
    });
    // Control: hubo buenas y malas.
    expect(juntas.filter((r) => r.ok)).toHaveLength(3);
    expect(juntas.filter((r) => !r.ok)).toHaveLength(4);
  });

  it('una lista vacía no consulta la carta y una cantidad fuera de rango se rechaza en su línea (RangeError)', async () => {
    const L = lineasDe(esc.carta);
    const resultados = await enContextoDeA(async () => {
      const ventas = ctx.app.get(CartaVentaService);
      expect(await ventas.prepararLineas(esc.e.A.S1, [], ctx.reloj.ahora())).toEqual([]);
      return ventas.prepararLineas(
        esc.e.A.S1,
        [
          { productoId: L.gaseosa(1).productoId, modificadorIds: [], cantidad: 0 },
          { productoId: L.gaseosa(1).productoId, modificadorIds: [], cantidad: 1000 },
        ],
        ctx.reloj.ahora(),
      );
    });
    for (const r of resultados) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBeInstanceOf(RangeError);
    }
  });

  it('una sucursal de otra empresa es 404 para todo el lote', async () => {
    const L = lineasDe(esc.carta);
    await expect(
      enContextoDeA(() =>
        ctx.app
          .get(CartaVentaService)
          .prepararLineas(esc.e.B.S1, [{ ...L.gaseosa(1), modificadorIds: [] }], ctx.reloj.ahora()),
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});

describe('SucursalesConsultaService.datosPublicos', () => {
  it('devuelve solo id, nombre, dirección y horario de las sucursales de la empresa del contexto', async () => {
    const datos = await enContextoDeA(() =>
      ctx.app
        .get(SucursalesConsultaService)
        .datosPublicos([esc.e.A.S1, esc.e.A.S2, esc.e.B.S1, esc.e.A.S1]),
    );
    expect([...datos.keys()].sort()).toEqual([esc.e.A.S1, esc.e.A.S2].sort());
    const s1 = datos.get(esc.e.A.S1)!;
    expect(Object.keys(s1).sort()).toEqual(['direccion', 'horario', 'id', 'nombre']);
    expect(s1.horario).toHaveLength(7);
    expect(datos.get(esc.e.A.S2)!.horario).toEqual([]);
    expect(
      await enContextoDeA(() => ctx.app.get(SucursalesConsultaService).datosPublicos([])),
    ).toEqual(new Map());
  });
});

describe('PedidosConsultaService.ordenesVigentesDeMesas', () => {
  it('una mesa libre no aparece; una ocupada trae su orden y su mozo; una unida, la orden principal', async () => {
    const [ocupada, unida, libre] = await mesasConCodigo(ctx, esc, 3);
    const ordenId = await abrirMesa(ctx, esc, ocupada!, esc.token.mozo);
    await unirMesasOk(ctx, esc.token.mozo, ordenId, [unida!.id]);
    const vigentes = await enContextoDeA(() =>
      ctx.app
        .get(PedidosConsultaService)
        .ordenesVigentesDeMesas([ocupada!.id, unida!.id, libre!.id, randomUUID()]),
    );
    expect([...vigentes.keys()].sort()).toEqual([ocupada!.id, unida!.id].sort());
    for (const mesa of [ocupada!, unida!]) {
      expect(vigentes.get(mesa.id)).toMatchObject({
        mesaId: mesa.id,
        ordenId,
        estado: 'ABIERTA',
        mozoId: esc.e.A.mozo.id,
      });
    }
    expect(
      await enContextoDeA(() => ctx.app.get(PedidosConsultaService).ordenesVigentesDeMesas([])),
    ).toEqual(new Map());
  });

  it('con otra empresa en el contexto no ve las mesas de A', async () => {
    const [mesa] = await mesasConCodigo(ctx, esc, 1);
    await abrirMesa(ctx, esc, mesa!, esc.token.mozo);
    const vigentes = await ctx.app
      .get(ContextoEmpresa)
      .ejecutar(
        esc.e.B.empresaId,
        () => ctx.app.get(PedidosConsultaService).ordenesVigentesDeMesas([mesa!.id]),
        { actor: { sistema: 'prueba' } },
      );
    expect(vigentes.size).toBe(0);
  });
});

describe('criterios 18, 22 y 23 · caché de la carta pública', () => {
  it('la carta lleva ETag fuerte y Cache-Control; con If-None-Match igual responde 304 sin cuerpo', async () => {
    const cliente = clienteNuevo(ctx);
    const res = await cliente.get(rutaCarta());
    expect(res.status, res.text).toBe(200);
    expect(res.headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
    );
    const etag = res.headers['etag'] as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const igual = await cliente.get(rutaCarta()).set('If-None-Match', etag);
    expect(igual.status).toBe(304);
    expect(igual.text).toBe('');
    expect(igual.headers['etag']).toBe(etag);
    expect(igual.headers['cache-control']).toBe(res.headers['cache-control']);
    const otro = await cliente.get(rutaCarta()).set('If-None-Match', '"otro"');
    expect(otro.status).toBe(200);
  });

  it('un cambio de la carta cambia el ETag y el If-None-Match viejo ya no sirve', async () => {
    const cliente = clienteNuevo(ctx);
    const antes = (await cliente.get(rutaCarta())).headers['etag'] as string;
    const plato = await productoPropio(ctx, esc, '17.00');
    const despues = await cliente.get(rutaCarta()).set('If-None-Match', antes);
    expect(despues.status).toBe(200);
    expect(despues.headers['etag']).not.toBe(antes);
    expect(JSON.stringify(despues.body)).toContain(plato.nombre);
  });

  it('la disponibilidad lleva ETag, 304 y Cache-Control de 5 segundos; la lista de sucursales, los de la carta', async () => {
    const cliente = clienteNuevo(ctx);
    const disp = await cliente.get(`${rutaCarta()}/disponibilidad`);
    expect(disp.status, disp.text).toBe(200);
    expect(disp.headers['cache-control']).toBe('public, max-age=5, s-maxage=5');
    const etag = disp.headers['etag'] as string;
    const igual = await cliente.get(`${rutaCarta()}/disponibilidad`).set('If-None-Match', etag);
    expect(igual.status).toBe(304);
    const empresa = await cliente.get(`/publico/cartas/${esc.slugs.empresaA}`);
    expect(empresa.status, empresa.text).toBe(200);
    expect(empresa.headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
    );
    const etagEmpresa = empresa.headers['etag'] as string;
    expect(
      (await cliente.get(`/publico/cartas/${esc.slugs.empresaA}`).set('If-None-Match', etagEmpresa))
        .status,
    ).toBe(304);
  });

  it('la lista de sucursales trae las publicadas con plan PEDIDOS_WEB, por nombre, con su dirección', async () => {
    const res = await clienteNuevo(ctx).get(`/publico/cartas/${esc.slugs.empresaA}`);
    expect(res.status).toBe(200);
    const slugs = (res.body.sucursales as { slug: string }[]).map((s) => s.slug);
    expect(slugs.sort()).toEqual([esc.slugs.sucursalS1, esc.slugs.sucursalS2].sort());
    const nombres = (res.body.sucursales as { nombre: string }[]).map((s) => s.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
    for (const s of res.body.sucursales)
      expect(Object.keys(s).sort()).toEqual(['direccion', 'nombre', 'slug']);
  });

  it('se arma con un número fijo de consultas: las mismas con 5 que con 50 productos más', async () => {
    const cliente = clienteNuevo(ctx);
    const contar = async (): Promise<number> => {
      const registro = registrarConsultas(ctx.app);
      try {
        const res = await cliente.get(rutaCarta());
        expect(res.status, res.text).toBe(200);
        return registro.consultas.filter((c) => !ES_CONTROL_DE_TRANSACCION.test(c.sql)).length;
      } finally {
        registro.detener();
      }
    };
    const antes = await contar();
    const vistos = (await cliente.get(rutaCarta())).body.familias.flatMap(
      (f: { productos: unknown[] }) => f.productos,
    ).length;
    for (let tanda = 0; tanda < 5; tanda += 1) {
      await Promise.all(Array.from({ length: 10 }, () => productoPropio(ctx, esc, '11.00')));
    }
    const despues = await contar();
    const ahora = (await cliente.get(rutaCarta())).body.familias.flatMap(
      (f: { productos: unknown[] }) => f.productos,
    ).length;
    expect(ahora).toBe(vistos + 50);
    expect(despues).toBe(antes);
    expect(antes).toBeLessThanOrEqual(14);
  });
});

describe('criterio 32 · límite por mesa con llamados cerrados por SQL', () => {
  /** Cierra un llamado como descartado, sin pasar por la PWA (el actor de la prueba). */
  async function cerrar(id: string): Promise<void> {
    await enTransaccion(
      admin,
      null,
      async () => {
        await admin.query(
          `UPDATE llamado SET estado = 'DESCARTADO', cerrado_en = creado_en + interval '1 second',
                  motivo_descarte = 'Prueba' WHERE empresa_id = $1 AND id = $2`,
          [empresaA(), id],
        );
      },
      { confirmar: true },
    );
  }

  it('el séptimo en 30 minutos es 429 con reintentarEnSegundos y Retry-After; los rechazados no cuentan', async () => {
    const [mesa] = await mesasConCodigo(ctx, esc, 1);
    const inicio = ctx.reloj.ahora().getTime();
    for (let i = 0; i < 6; i += 1) {
      ctx.reloj.fijar(inicio + i * 60_000);
      const cuerpo = cuerpoLlamarMozo();
      await crearOk(clienteNuevo(ctx), mesa!.codigo, cuerpo);
      await cerrar(cuerpo.id);
    }
    ctx.reloj.fijar(inicio + 6 * 60_000);
    const res = await enviarLlamado(clienteNuevo(ctx), mesa!.codigo, cuerpoLlamarMozo());
    esperarError(res, 429, 'DEMASIADOS_LLAMADOS');
    // El más antiguo (inicio) sale de la ventana a los 30:00: faltan 24 minutos.
    expect(res.body.reintentarEnSegundos).toBe(24 * 60);
    expect(res.headers['retry-after']).toBe(String(24 * 60));
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM llamado WHERE mesa_id = $1',
      [mesa!.id],
    );
    expect(rows[0]!.n).toBe(6);
    // Cuando sale el primero, se vuelve a aceptar.
    ctx.reloj.fijar(inicio + 30 * 60_000);
    await crearOk(clienteNuevo(ctx), mesa!.codigo, cuerpoLlamarMozo());
  });
});
