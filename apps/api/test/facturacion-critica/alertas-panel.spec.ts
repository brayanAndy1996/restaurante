// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Alertas y panel de comprobantes (ruta crítica), criterios 133 y 135:
// - 133: hay alerta de un comprobante cuando está `RECHAZADO` sin reemisión, lleva más de 30 minutos en `POR_ENVIAR` o
//   `ENVIADO`, su envío está `DETENIDO` o su último resultado es `ERROR_CONFIGURACION`; cada una publica
//   `facturacion.alerta` `{ sucursalId }` en la sala de la sucursal **una vez** por comprobante y motivo (el barrido
//   detecta las de tiempo y `envio_pse.alertado_en` evita repetirlas), cuenta en `GET /facturacion/alertas`, deja un
//   registro `warn` `pse.alerta` (sin datos de clientes) y cuenta en `GET /plataforma/facturacion/alertas`;
// - 135: `GET /facturacion/comprobantes` con sus filtros (estado, tipo, fechas, alerta, texto), los conteos por estado con
//   los mismos filtros salvo el estado, 50 por página del más nuevo al más antiguo con cursor, y
//   `GET /facturacion/comprobantes/:id` con el envío y los intentos (del más nuevo al más antiguo).
// Cuál alerta gana cuando coinciden varias (por ejemplo `DETENIDO` y `DEMORADO`) no lo fija la especificación: las
// pruebas de ese caso suman los dos contadores. Los comprobantes de la empresa B (una sola sucursal) arman el panel; las de
// A, las alertas que dependen del barrido y de un emisor sin configuración.
// Hoy falla porque `envio_pse` no existe y las rutas de 6b responden «No implementado».
import {
  alertasPlataformaRespuestaSchema,
  alertasRespuestaSchema,
  comprobanteDetalleSchema,
  panelComprobantesSchema,
} from '@restaurante/contratos';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activarSimulado,
  api,
  arrancarFact,
  avanzar,
  capturarRegistros,
  cerrarAdmin,
  CLIENTE_DNI,
  CLIENTE_RUC,
  cobrarFactura,
  cobrarLomo,
  crearEscenarioFact,
  eventosPublicados,
  exigirEstado,
  limitarBarrido,
  procesar,
  turnoDe,
  venderMostrador,
  type AppFact,
  type Cobrado,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;
const MIN = 60_000;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(() => {
  ctx.pse.reglas.limpiar();
});

const alertasDe = async (token: string | undefined, sucursalId?: string): Promise<Libre> => {
  const res = await api(
    ctx,
    token,
    'get',
    `/facturacion/alertas${sucursalId ? `?sucursalId=${sucursalId}` : ''}`,
  );
  exigirEstado(res, 200, 'GET /facturacion/alertas (006, criterio 133)');
  return alertasRespuestaSchema.parse(res.body);
};
const panelDe = async (consulta: string, token: string | undefined = B().token.supervisor) => {
  const res = await api(ctx, token, 'get', `/facturacion/comprobantes${consulta}`);
  exigirEstado(res, 200, `GET /facturacion/comprobantes${consulta} (006, criterio 135)`);
  return panelComprobantesSchema.parse(res.body);
};
const alertasPublicadas = (e: { id: string; S1: string }, sucursal: string = e.S1) =>
  eventosPublicados(ctx, 'facturacion.alerta').filter(
    (ev) => ev.empresaId === e.id && (ev.sala as { sucursalId?: string }).sucursalId === sucursal,
  );
const barrer = async (...empresas: string[]) => {
  const restaurar = limitarBarrido(ctx, empresas);
  try {
    await ctx.barrido.barrerAhora();
  } finally {
    restaurar();
  }
};
const numeroDe = (c: Cobrado): string => (c.respuesta.comprobante as { numero: string }).numero;
const rechazar = (c: Cobrado) =>
  ctx.pse.reglas.rechazarNumero(numeroDe(c), { codigo: '2800', mensaje: 'Rechazo de prueba' });

// ------------------------------------------------------------------------------------------------
// La empresa B arma el panel; sus tres fases comparten comprobantes y reloj, así que van en orden.
// ------------------------------------------------------------------------------------------------
describe('criterios 133 y 135 · alertas y panel de la empresa B (una sucursal, emisor en SIMULADO)', () => {
  let c1: Cobrado; // boleta con DNI; acepta al tercer intento
  let c2: Cobrado; // boleta rechazada
  let c3: Cobrado; // factura con RUC, aceptada
  let c4: Cobrado; // boleta sin procesar
  let c5: Cobrado; // boleta aceptada diez días después
  let c6: Cobrado; // boleta con ERROR_CONFIGURACION y luego aceptada
  let turnoB: string;
  let t0: Date;
  let emitidoC4: number;

  it('fase 1: un rechazo y un error de configuración recientes alertan; el aviso se publica una vez', async () => {
    turnoB = await turnoDe(ctx, B(), 'cajero', 'S1', 'caja1');
    t0 = ctx.reloj.ahora();
    const cobrar = async (o: Libre = {}) => {
      const c = await cobrarLomo(ctx, B(), { turnoId: turnoB, ...o });
      ctx.reloj.avanzar(MIN);
      return c;
    };
    c1 = await cobrar({ cliente: CLIENTE_DNI });
    c2 = await cobrar();
    c3 = await cobrarFactura(ctx, B(), { turnoId: turnoB });
    ctx.reloj.avanzar(MIN);
    emitidoC4 = ctx.reloj.ahora().getTime();
    c4 = await cobrar();
    ctx.reloj.avanzar(2 * MIN);
    c6 = await cobrar();

    // c1: dos fallos de transmisión y a la tercera acepta (para el detalle con intentos).
    ctx.pse.reglas.fallarTransmision(2);
    await procesar(ctx, B().id, c1.comprobanteId);
    ctx.reloj.avanzar(MIN);
    await procesar(ctx, B().id, c1.comprobanteId);
    ctx.reloj.avanzar(2 * MIN);
    await procesar(ctx, B().id, c1.comprobanteId);
    // c2: rechazada. c3: aceptada. c6: error de configuración (queda sin alertar por tiempo).
    rechazar(c2);
    await procesar(ctx, B().id, c2.comprobanteId);
    await procesar(ctx, B().id, c3.comprobanteId);
    ctx.pse.reglas.errorDeConfiguracion(1);
    await procesar(ctx, B().id, c6.comprobanteId);
    ctx.pse.reglas.limpiar();

    await barrer(B().id);
    const alertas = await alertasDe(B().token.supervisor);
    expect(alertas).toEqual({
      rechazados: 1,
      demorados: 0,
      detenidos: 0,
      sinConfiguracion: 1,
      modoSimulado: true,
    });
    // Un aviso por alerta (rechazo y configuración), en la sala de la sucursal, con solo { sucursalId }.
    const avisos = alertasPublicadas(B());
    expect(avisos).toHaveLength(2);
    for (const a of avisos) {
      expect(a.nombre).toBe('facturacion.alerta');
      expect(a.datos).toEqual({ sucursalId: B().S1 });
      expect(a.sala).toEqual({ tipo: 'sucursal', sucursalId: B().S1 });
    }
    // Ni repetir el barrido ni volver a procesar los repite.
    await barrer(B().id);
    await procesar(ctx, B().id, c2.comprobanteId);
    expect(alertasPublicadas(B())).toHaveLength(2);
  });

  it('fase 1: el panel marca la alerta de cada comprobante y `alerta=true` deja solo los que la tienen', async () => {
    const todos = await panelDe('');
    const alertaDe = (c: Cobrado) => todos.items.find((i) => i.id === c.comprobanteId)!.alerta;
    expect(alertaDe(c2)).toBe('RECHAZADO');
    expect(alertaDe(c6)).toBe('SIN_CONFIGURACION');
    expect(alertaDe(c1)).toBeNull();
    expect(alertaDe(c3)).toBeNull();
    expect(alertaDe(c4)).toBeNull();
    const conAlerta = await panelDe('?alerta=true');
    expect(conAlerta.items.map((i) => i.id)).toEqual([c6.comprobanteId, c2.comprobanteId]);
  });

  it('fase 1: un comprobante en POR_ENVIAR no alerta a los 29 minutos de emitido y sí a los 31', async () => {
    ctx.reloj.fijar(emitidoC4 + 29 * MIN);
    await esc.B.refrescarSesiones();
    expect((await alertasDe(B().token.supervisor)).demorados).toBe(0);
    await barrer(B().id);
    expect(alertasPublicadas(B())).toHaveLength(2);
    ctx.reloj.fijar(emitidoC4 + 31 * MIN);
    await esc.B.refrescarSesiones();
    expect((await alertasDe(B().token.supervisor)).demorados).toBe(1);
  });

  it('fase 2: c6 se acepta al reintentar; el barrido publica la alerta de tiempo de c4 una sola vez y B cuenta rechazados 1 y demorados 1', async () => {
    await procesar(ctx, B().id, c6.comprobanteId); // reintento a la hora (el error era único)
    expect((await panelDe('')).items.find((i) => i.id === c6.comprobanteId)!.estado).toBe(
      'ACEPTADO',
    );

    await esc.B.refrescarSesiones();
    const antes = alertasPublicadas(B()).length;
    expect(antes).toBe(2);
    await barrer(B().id);
    expect(alertasPublicadas(B()).length).toBe(antes + 1);
    await barrer(B().id);
    expect(alertasPublicadas(B()).length).toBe(antes + 1);

    const alertas = await alertasDe(B().token.supervisor);
    expect(alertas).toMatchObject({
      rechazados: 1,
      demorados: 1,
      detenidos: 0,
      sinConfiguracion: 0,
    });
    const panel = await panelDe('?alerta=true');
    expect(panel.items.map((i) => [i.id, i.alerta])).toEqual([
      [c4.comprobanteId, 'DEMORADO'],
      [c2.comprobanteId, 'RECHAZADO'],
    ]);
  });

  it('fase 2: GET /plataforma/facturacion/alertas cuenta lo mismo para la empresa B (y solo el superadministrador)', async () => {
    const res = await api(ctx, esc.sa.token, 'get', '/plataforma/facturacion/alertas');
    exigirEstado(res, 200, 'GET /plataforma/facturacion/alertas (006, criterio 133)');
    const lista = alertasPlataformaRespuestaSchema.parse(res.body);
    const deB = lista.find((e) => e.empresaId === B().id);
    expect(deB).toEqual({
      empresaId: B().id,
      empresa: B().base.nombre,
      rechazados: 1,
      demorados: 1,
      detenidos: 0,
      sinConfiguracion: 0,
    });
    // Una sesión de empresa no entra a las rutas de /plataforma.
    const intruso = await api(ctx, B().token.supervisor, 'get', '/plataforma/facturacion/alertas');
    expect(intruso.status).toBeGreaterThanOrEqual(401);
    expect(intruso.status).toBeLessThan(500);
  });

  it('fase 3: el panel, con 10 días más tarde, usa por defecto los últimos 7 días; con desde y hasta ve todo', async () => {
    await avanzar(ctx, 10 * 24 * 60 * MIN, B(), A());
    c5 = await cobrarLomo(ctx, B(), { turnoId: turnoB });
    await procesar(ctx, B().id, c5.comprobanteId);

    const porDefecto = await panelDe('');
    expect(porDefecto.items.map((i) => i.id)).toEqual([c5.comprobanteId]);
    expect(porDefecto.conteos).toEqual({
      POR_ENVIAR: 0,
      ENVIADO: 0,
      ACEPTADO: 1,
      RECHAZADO: 0,
      ANULADO: 0,
    });

    const dia = (d: Date) => d.toISOString().slice(0, 10);
    const todo = `?desde=${dia(new Date(t0.getTime() - 24 * 60 * MIN))}&hasta=${dia(ctx.reloj.ahora())}`;
    const panel = await panelDe(todo);
    // Del más nuevo al más antiguo.
    expect(panel.items.map((i) => i.id)).toEqual([
      c5.comprobanteId,
      c6.comprobanteId,
      c4.comprobanteId,
      c3.comprobanteId,
      c2.comprobanteId,
      c1.comprobanteId,
    ]);
    expect(panel.siguiente).toBeNull();
    expect(panel.conteos).toEqual({
      POR_ENVIAR: 1,
      ENVIADO: 0,
      ACEPTADO: 4,
      RECHAZADO: 1,
      ANULADO: 0,
    });
    // Forma de cada ítem.
    const i3 = panel.items.find((i) => i.id === c3.comprobanteId)!;
    expect(i3).toMatchObject({
      tipo: 'FACTURA',
      numero: numeroDe(c3),
      estado: 'ACEPTADO',
      simulado: true,
      total: '28.00',
      cliente: CLIENTE_RUC.nombre,
      sucursal: { id: B().S1 },
      alerta: null,
      sunat: { codigo: '0' },
      afectaA: null,
      reemplazaA: null,
      reemplazadoPor: null,
    });
    expect(i3.envio).toMatchObject({
      estado: 'TERMINADO',
      intentos: 1,
      ultimoResultado: 'ACEPTADO',
    });
    const i4 = panel.items.find((i) => i.id === c4.comprobanteId)!;
    expect(i4).toMatchObject({ estado: 'POR_ENVIAR', alerta: 'DEMORADO', sunat: null });
    expect(i4.envio).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    const i2 = panel.items.find((i) => i.id === c2.comprobanteId)!;
    expect(i2).toMatchObject({
      estado: 'RECHAZADO',
      alerta: 'RECHAZADO',
      sunat: { codigo: '2800' },
    });
    expect(i2.sunat!.mensaje).toContain('Rechazo de prueba');
  });

  it('fase 3: filtros por estado (uno o varios), tipo, texto y fechas; los conteos ignoran solo el estado', async () => {
    const dia = (d: Date) => d.toISOString().slice(0, 10);
    const rango = `desde=${dia(new Date(t0.getTime() - 24 * 60 * MIN))}&hasta=${dia(ctx.reloj.ahora())}`;
    const completos = { POR_ENVIAR: 1, ENVIADO: 0, ACEPTADO: 4, RECHAZADO: 1, ANULADO: 0 };

    const rechazados = await panelDe(`?${rango}&estado=RECHAZADO`);
    expect(rechazados.items.map((i) => i.id)).toEqual([c2.comprobanteId]);
    expect(rechazados.conteos).toEqual(completos);

    const dosPorComa = await panelDe(`?${rango}&estado=ACEPTADO,RECHAZADO`);
    expect(dosPorComa.items.map((i) => i.id)).toEqual([
      c5.comprobanteId,
      c6.comprobanteId,
      c3.comprobanteId,
      c2.comprobanteId,
      c1.comprobanteId,
    ]);
    const dosRepetido = await panelDe(`?${rango}&estado=ACEPTADO&estado=RECHAZADO`);
    expect(dosRepetido.items.map((i) => i.id)).toEqual(dosPorComa.items.map((i) => i.id));

    const facturas = await panelDe(`?${rango}&tipo=FACTURA`);
    expect(facturas.items.map((i) => i.id)).toEqual([c3.comprobanteId]);
    expect(facturas.conteos).toEqual({ ...completos, POR_ENVIAR: 0, ACEPTADO: 1, RECHAZADO: 0 });

    // Texto: serie y número exactos (largo o corto) o el documento exacto del cliente.
    const [serie, correlativo] = numeroDe(c2).split('-') as [string, string];
    const largo = await panelDe(`?${rango}&texto=${numeroDe(c2)}`);
    expect(largo.items.map((i) => i.id)).toEqual([c2.comprobanteId]);
    const corto = await panelDe(`?${rango}&texto=${serie}-${Number(correlativo)}`);
    expect(corto.items.map((i) => i.id)).toEqual([c2.comprobanteId]);
    const porRuc = await panelDe(`?${rango}&texto=${CLIENTE_RUC.numero}`);
    expect(porRuc.items.map((i) => i.id)).toEqual([c3.comprobanteId]);
    const porDni = await panelDe(`?${rango}&texto=${CLIENTE_DNI.numero}`);
    expect(porDni.items.map((i) => i.id)).toEqual([c1.comprobanteId]);
    expect((await panelDe(`?${rango}&texto=${CLIENTE_DNI.numero.slice(0, 5)}`)).items).toEqual([]);

    // Fechas de emisión: solo el día de c5.
    const hoy = dia(ctx.reloj.ahora());
    const soloHoy = await panelDe(`?desde=${hoy}&hasta=${hoy}`);
    expect(soloHoy.items.map((i) => i.id)).toEqual([c5.comprobanteId]);
  });

  it('fase 3: consultas inválidas responden 400 (estado, fechas, rango de más de 93 días, parámetros desconocidos)', async () => {
    for (const consulta of [
      '?estado=NADA',
      '?tipo=TICKET',
      '?desde=2026-13-01',
      '?desde=2026-01-01&hasta=2026-12-31',
      '?alerta=quizas',
      '?sucursalId=no-es-uuid',
      '?empresaId=cualquiera',
    ]) {
      const res = await api(
        ctx,
        B().token.supervisor,
        'get',
        `/facturacion/comprobantes${consulta}`,
      );
      expect(res.status, `${consulta}: ${res.text}`).toBe(400);
    }
  });

  it('fase 3: el detalle trae el comprobante con su envío y los intentos, del más nuevo al más antiguo', async () => {
    const res = await api(
      ctx,
      B().token.supervisor,
      'get',
      `/facturacion/comprobantes/${c1.comprobanteId}`,
    );
    exigirEstado(res, 200, 'GET /facturacion/comprobantes/:id (006, criterio 135)');
    const detalle = comprobanteDetalleSchema.parse(res.body);
    expect(detalle).toMatchObject({
      id: c1.comprobanteId,
      estado: 'ACEPTADO',
      simulado: true,
      pdfDisponible: false,
    });
    expect(detalle.envio).toMatchObject({ estado: 'TERMINADO', intentos: 3 });
    expect(detalle.intentos).toHaveLength(4);
    expect(detalle.intentos[0]!.resultado).toBe('ACEPTADO');
    const numeros = detalle.intentos.map((i) => i.numero);
    expect(numeros).toEqual([...numeros].sort((a, b) => b - a));
    // Solo lo permitido por intentoRespuesta: nada del documento ni de la respuesta completa.
    for (const intento of res.body.intentos as Libre[]) {
      expect(Object.keys(intento).sort()).toEqual(
        [
          'codigo',
          'iniciadoEn',
          'mensaje',
          'numero',
          'operacion',
          'resultado',
          'terminadoEn',
        ].sort(),
      );
    }
    expect(detalle.sunat).toMatchObject({ codigo: '0' });
    expect(detalle.marcas!.aceptadoEn).not.toBeNull();
  });

  it('fase 3: con más de 50 comprobantes el panel pagina de 50 en 50, del más nuevo al más antiguo, sin repetir ni saltar ninguno', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 52; i += 4) {
      ids.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(4, 52 - i) }, () =>
            venderMostrador(ctx, B(), turnoB, B().token.cajero!),
          ),
        )),
      );
    }
    const esperados = new Set([c5.comprobanteId, ...ids]);
    expect(esperados.size).toBe(53);

    const primera = await panelDe('');
    expect(primera.items).toHaveLength(50);
    expect(primera.siguiente).not.toBeNull();
    expect(primera.conteos).toEqual({
      POR_ENVIAR: 52,
      ENVIADO: 0,
      ACEPTADO: 1,
      RECHAZADO: 0,
      ANULADO: 0,
    });
    const segunda = await panelDe(`?cursor=${encodeURIComponent(primera.siguiente!)}`);
    expect(segunda.items).toHaveLength(3);
    expect(segunda.siguiente).toBeNull();
    expect(segunda.conteos).toEqual(primera.conteos);

    const vistos = [...primera.items, ...segunda.items].map((i) => i.id);
    expect(new Set(vistos).size).toBe(53);
    expect(new Set(vistos)).toEqual(esperados);
    const instantes = [...primera.items, ...segunda.items].map((i) => Date.parse(i.emitidoEn));
    expect(instantes).toEqual([...instantes].sort((a, b) => b - a));
  });
});

// ------------------------------------------------------------------------------------------------
// La empresa A: emisor sin configuración, alertas de tiempo con el barrido, registro pse.alerta
// ------------------------------------------------------------------------------------------------
describe('criterio 133 · alertas de la empresa A', () => {
  it('un emisor sin configuración de PSE alerta SIN_CONFIGURACION una sola vez y deja de alertar al activarlo', async () => {
    const turnoS2 = await turnoDe(ctx, A(), 'supervisorS2', 'S2', 'caja1');
    const token = A().token.supervisorS2!;
    expect((await alertasDe(token)).modoSimulado).toBe(false);
    const antes = (await alertasDe(token)).sinConfiguracion;
    const eventosAntes = alertasPublicadas(A(), A().S2).length;
    const llamadas = ctx.pse.llamadas().length;
    const c = await cobrarLomo(ctx, A(), { turnoId: turnoS2, sucursal: 'S2', token });
    await procesar(ctx, A().id, c.comprobanteId);
    await barrer(A().id);
    expect(ctx.pse.llamadas()).toHaveLength(llamadas);
    expect((await alertasDe(token)).sinConfiguracion).toBe(antes + 1);
    expect(alertasPublicadas(A(), A().S2)).toHaveLength(eventosAntes + 1);
    // Repetir no repite el aviso.
    ctx.reloj.avanzar(2 * MIN);
    await procesar(ctx, A().id, c.comprobanteId);
    await barrer(A().id);
    expect(alertasPublicadas(A(), A().S2)).toHaveLength(eventosAntes + 1);
    const panel = await api(ctx, token, 'get', `/facturacion/comprobantes?texto=${numeroDe(c)}`);
    exigirEstado(panel, 200, 'Panel');
    expect(panelComprobantesSchema.parse(panel.body).items[0]).toMatchObject({
      id: c.comprobanteId,
      simulado: false,
      alerta: 'SIN_CONFIGURACION',
    });

    // Soporte activa el emisor: el siguiente intento acepta y la alerta desaparece.
    await activarSimulado(ctx, esc, A(), A().emisor2!);
    ctx.reloj.avanzar(5 * MIN);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(await alertasDe(token)).toMatchObject({ sinConfiguracion: antes, modoSimulado: true });
  });

  it('un comprobante con el PSE caído más de 30 minutos y otro que pasa su plazo suman una alerta cada uno, una sola vez', async () => {
    const turnoS3 = await turnoDe(ctx, A(), 'cajeroS3', 'S3', 'caja1');
    const token = A().token.supervisorS3!;
    const base = await alertasDe(token);
    const total = (a: Libre) => a.demorados + a.detenidos;
    const eventosAntes = alertasPublicadas(A(), A().S3).length;

    ctx.pse.reglas.fallarTransmision(1000);
    const c = await cobrarLomo(ctx, A(), {
      turnoId: turnoS3,
      sucursal: 'S3',
      token: A().token.cajeroS3!,
    });
    await procesar(ctx, A().id, c.comprobanteId);
    // A los 29 minutos todavía no; a los 31 sí (el barrido la detecta).
    await avanzar(ctx, 29 * MIN, A());
    await barrer(A().id);
    expect(total(await alertasDe(token))).toBe(total(base));
    expect(alertasPublicadas(A(), A().S3)).toHaveLength(eventosAntes);
    await avanzar(ctx, 2 * MIN, A());
    await barrer(A().id);
    expect(total(await alertasDe(token))).toBe(total(base) + 1);
    expect(alertasPublicadas(A(), A().S3)).toHaveLength(eventosAntes + 1);
    await barrer(A().id);
    expect(alertasPublicadas(A(), A().S3)).toHaveLength(eventosAntes + 1);

    // Pasa su plazo: queda DETENIDO. Sigue siendo un comprobante con alerta (no dos).
    await avanzar(ctx, 4 * 24 * 60 * MIN, A());
    await barrer(A().id);
    const final = await alertasDe(token);
    expect(total(final)).toBe(total(base) + 1);
    const panel = await api(
      ctx,
      token,
      'get',
      `/facturacion/comprobantes?texto=${numeroDe(c)}&desde=2026-11-01&hasta=2026-12-31`,
    );
    exigirEstado(panel, 200, 'Panel');
    const item = panelComprobantesSchema.parse(panel.body).items[0]!;
    expect(item.envio!.estado).toBe('DETENIDO');
    expect(['DETENIDO', 'DEMORADO']).toContain(item.alerta);
    const despues = alertasPublicadas(A(), A().S3).length;
    expect(despues).toBeGreaterThanOrEqual(eventosAntes + 1);
    expect(despues).toBeLessThanOrEqual(eventosAntes + 2);
    await barrer(A().id);
    expect(alertasPublicadas(A(), A().S3)).toHaveLength(despues);
  });

  it('cada alerta deja un registro warn `pse.alerta` con ids y motivo, sin datos del cliente, y una sola vez', async () => {
    const turnoS1 = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const registros = capturarRegistros();
    try {
      const c = await cobrarFactura(ctx, A(), { turnoId: turnoS1 });
      ctx.pse.reglas.rechazarRucDeCliente(CLIENTE_RUC.numero, {
        codigo: '2800',
        mensaje: 'El RUC del cliente no existe',
      });
      await procesar(ctx, A().id, c.comprobanteId);
      await barrer(A().id);
      await barrer(A().id);
      const alertas = registros
        .deNivel('warn')
        .filter((l) => l.includes('pse.alerta') && l.includes(c.comprobanteId));
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toContain(A().id);
      expect(alertas[0]).toContain('RECHAZADO');
      const todo = registros.texto();
      for (const dato of [CLIENTE_RUC.nombre, CLIENTE_RUC.numero, CLIENTE_RUC.direccion]) {
        expect(todo, `los registros no llevan «${dato}»`).not.toContain(dato);
      }
    } finally {
      registros.restaurar();
    }
  });
});
