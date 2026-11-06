// Pruebas del desarrollador (no protegidas) del barrido, las alertas y el trabajo en segundo plano (historia 006, T31;
// criterios 126, 130, 133, 137 y 172). Las rutas de alertas y del panel son de T32; aquí se mira lo que el barrido y el
// procesador dejan en la base, en los eventos y en el registro.
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { TrabajoEnSegundoPlano } from '../../src/modulos/facturacion';
import { EmpresasConsulta } from '../../src/modulos/plataforma';
import { ColaEnMemoria } from '../../src/nucleo/colas';
import { fijarEntornoDePrueba } from '../utilidades';
import {
  arrancarFact,
  avanzar,
  capturarRegistros,
  cerrarAdmin,
  cobrarLomo,
  crearEscenarioFact,
  envioDe,
  eventosPublicados,
  exigirPse,
  limitarBarrido,
  procesar,
  turnoDe,
  type AppFact,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurar: () => void;
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurar = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurar?.();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
  await esc.A.refrescarSesiones();
  await esc.B.refrescarSesiones();
});

const alertasDe = (empresaId: string, sucursalId: string) =>
  eventosPublicados(ctx, 'facturacion.alerta').filter(
    (e) =>
      e.empresaId === empresaId && (e.sala as { sucursalId?: string }).sucursalId === sucursalId,
  );

describe('EmpresasConsulta.ids', () => {
  it('lista solo ids de empresas, y están A y B', async () => {
    const ids = await ctx.app.get(EmpresasConsulta, { strict: false }).ids();
    expect(ids).toContain(esc.A.id);
    expect(ids).toContain(esc.B.id);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});

describe('alertas del barrido y del procesador', () => {
  it('el PSE caído: demorado a los 31 minutos, detenido al pasar el plazo; un aviso por motivo y un registro warn cada vez', async () => {
    const registros = capturarRegistros();
    try {
      ctx.pse.reglas.fallarTransmision(1000);
      const turnoId = await turnoDe(ctx, esc.B, 'cajero', 'S1', 'caja1');
      const c = await cobrarLomo(ctx, esc.B, { turnoId });
      await procesar(ctx, esc.B.id, c.comprobanteId);
      const antes = alertasDe(esc.B.id, esc.B.S1).length;

      await avanzar(ctx, 29 * MIN, esc.B);
      expect(await ctx.barrido.barrerAhora()).toMatchObject({ alertas: 0 });
      expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(antes);

      await avanzar(ctx, 2 * MIN, esc.B);
      const demora = await ctx.barrido.barrerAhora();
      expect(demora.alertas).toBeGreaterThanOrEqual(1);
      expect(await envioDe(c.comprobanteId)).toMatchObject({ alerta: 'DEMORADO' });
      expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(antes + 1);
      expect((await ctx.barrido.barrerAhora()).alertas).toBe(0);
      expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(antes + 1);

      await avanzar(ctx, 4 * DIA, esc.B);
      const vencido = await ctx.barrido.barrerAhora();
      expect(vencido.detenidos).toBeGreaterThanOrEqual(1);
      const envio = (await envioDe(c.comprobanteId))!;
      expect(envio).toMatchObject({ estado: 'DETENIDO', alerta: 'DETENIDO', en_curso_hasta: null });
      expect(envio.proximo_intento_en).toBeNull();
      expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(antes + 2);
      await ctx.barrido.barrerAhora();
      expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(antes + 2);

      const lineas = registros
        .deNivel('warn')
        .filter((l) => l.includes('pse.alerta') && l.includes(c.comprobanteId));
      expect(lineas).toHaveLength(2);
      expect(lineas[0]).toContain('DEMORADO');
      expect(lineas[1]).toContain('DETENIDO');
      for (const linea of lineas) {
        expect(linea).toContain(esc.B.id);
        expect(linea).not.toMatch(/Lomo|Cliente|total/i);
      }
    } finally {
      registros.restaurar();
    }
  });

  it('un rechazo alerta al guardarse (una sola vez) y el barrido no lo repite', async () => {
    const turnoId = await turnoDe(ctx, esc.B, 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, esc.B, { turnoId });
    ctx.pse.reglas.rechazarNumero((c.respuesta.comprobante as { numero: string }).numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, esc.B.id, c.comprobanteId);
    expect(await envioDe(c.comprobanteId)).toMatchObject({ alerta: 'RECHAZADO' });
    expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(1);
    expect(alertasDe(esc.B.id, esc.B.S1)[0]?.datos).toEqual({ sucursalId: esc.B.S1 });
    await ctx.barrido.barrerAhora();
    expect(alertasDe(esc.B.id, esc.B.S1)).toHaveLength(1);
  });

  it('un emisor sin configuración alerta SIN_CONFIGURACION al intentar, una sola vez, sin llamar al PSE', async () => {
    const turnoS2 = await turnoDe(ctx, esc.A, 'supervisorS2', 'S2', 'caja1');
    const c = await cobrarLomo(ctx, esc.A, {
      turnoId: turnoS2,
      sucursal: 'S2',
      token: esc.A.token.supervisorS2!,
    });
    await procesar(ctx, esc.A.id, c.comprobanteId);
    ctx.reloj.avanzar(2 * MIN);
    await procesar(ctx, esc.A.id, c.comprobanteId);
    await ctx.barrido.barrerAhora();
    expect(ctx.pse.llamadas()).toEqual([]);
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      alerta: 'SIN_CONFIGURACION',
      ultimo_resultado: 'ERROR_CONFIGURACION',
    });
    expect(alertasDe(esc.A.id, esc.A.S2)).toHaveLength(1);
  });

  it('el último intento, hecho al llegar al plazo, deja el envío detenido sin esperar al barrido', async () => {
    ctx.pse.reglas.fallarTransmision(1000);
    const turnoId = await turnoDe(ctx, esc.B, 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, esc.B, { turnoId });
    await procesar(ctx, esc.B.id, c.comprobanteId);
    const plazo = new Date((await envioDe(c.comprobanteId))!.plazo_hasta as string).getTime();
    // Un intento justo en plazo_hasta: el siguiente caería en el mismo instante, así que no hay siguiente.
    ctx.reloj.fijar(plazo - 60 * MIN);
    await esc.B.refrescarSesiones();
    await procesar(ctx, esc.B.id, c.comprobanteId);
    ctx.reloj.fijar(plazo);
    await procesar(ctx, esc.B.id, c.comprobanteId);
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'DETENIDO' });
  });
});

describe('el trabajo en segundo plano', () => {
  beforeAll(() => {
    fijarEntornoDePrueba();
  });

  it('con autoIniciar la aplicación registra el procesador en la cola y arranca el barrido, y al cerrar lo detiene', async () => {
    const cola = new ColaEnMemoria();
    const contexto = await NestFactory.createApplicationContext(
      AppModule.registrar({
        colaPse: cola,
        tiempoReal: { habilitado: false },
        worker: { autoIniciar: true, mantenimientoDeCola: false },
      }),
      { logger: false, abortOnError: false },
    );
    try {
      expect(cola.procesador()).not.toBeNull();
    } finally {
      await contexto.close();
    }
    expect(cola.procesador()).toBeNull();
  });

  it('sin autoIniciar no trabaja solo (criterio 137) hasta que se le pide iniciar', async () => {
    const cola = new ColaEnMemoria();
    const contexto = await NestFactory.createApplicationContext(
      AppModule.registrar({ colaPse: cola, tiempoReal: { habilitado: false } }),
      { logger: false, abortOnError: false },
    );
    try {
      expect(cola.procesador()).toBeNull();
      const trabajo = contexto.get(TrabajoEnSegundoPlano);
      await trabajo.iniciar();
      await trabajo.iniciar(); // repetirlo no hace nada
      expect(cola.procesador()).not.toBeNull();
      await trabajo.detener();
      expect(cola.procesador()).toBeNull();
    } finally {
      await contexto.close();
    }
  });
});
