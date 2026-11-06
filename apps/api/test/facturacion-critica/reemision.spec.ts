// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Rechazado y «Emitir otro» (ruta crítica), criterio 134:
// - un comprobante `RECHAZADO` conserva su número y su motivo para siempre; `POST /facturacion/comprobantes/:id/reemision`
//   (IK, `{ tipo, cliente? }`) emite uno nuevo con otro número, las mismas líneas y totales (con la misma tasa de IGV), el
//   mismo formato, caja, turno y responsable y el mismo emisor, con `reemplaza_a_id` = el rechazado y `motivo_reemplazo`
//   `REEMISION`; toma la serie activa del tipo en la caja del rechazado (409 `SIN_SERIE`); responde 201
//   `{ comprobante, impresion, trabajoId }` y encola su ticket (sin pulso de gaveta);
// - de una boleta rechazada se puede emitir una factura con RUC (y dirección) o una boleta; una nota de crédito rechazada se
//   reemite con el mismo tipo de nota y sin `cliente`; las reglas del criterio 51 se aplican igual;
// - `COMPROBANTE_NO_RECHAZADO` si no está rechazado y `YA_REEMPLAZADO` (con `comprobanteId` del que lo reemplazó) si ya
//   tiene reemisión, también con dos reemisiones a la vez (una 201 y una 409, un solo número consumido);
// - cuenta en la cuota del plan y deja `reemitir_comprobante` en la auditoría (una fila, ninguna en la réplica);
// - el rechazado deja de tener alerta cuando tiene reemisión.
// Hoy falla porque `envio_pse` y las columnas de 6b no existen y las rutas de 6b responden «No implementado».
import { alertasRespuestaSchema, reemisionRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activarSimulado,
  anularComprobante,
  api,
  arrancarFact,
  cerrarAdmin,
  Cierres,
  CLIENTE_DNI,
  CLIENTE_RUC,
  cobrarLomo,
  comprobanteFila,
  contar,
  crearEscenarioFact,
  envioDe,
  escribir,
  esperarError,
  exigirEstado,
  exigirPse,
  filas,
  filasDeAuditoria,
  ik,
  impresoraDeCaja,
  limitarBarrido,
  abrirTurno,
  procesar,
  seriesDeNotas,
  turnoDe,
  ultimoNumero,
  vincularPuente,
  type AppFact,
  type Cobrado,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';
import { abrirCliente } from '../utilidades';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppFact;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;
let restaurarBarrido: () => void;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
});

const numeroDe = (c: Cobrado): string => (c.respuesta.comprobante as { numero: string }).numero;
const supervisor = () => A().token.supervisor!;

async function cobroRechazado(o: Libre = {}): Promise<Cobrado> {
  const turnoId = o.turnoId ?? (await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1'));
  const c = await cobrarLomo(ctx, A(), { turnoId, ...o });
  ctx.pse.reglas.rechazarNumero(numeroDe(c), { codigo: '2800', mensaje: 'Rechazo de prueba' });
  await procesar(ctx, A().id, c.comprobanteId);
  expect((await comprobanteFila(c.comprobanteId)).estado).toBe('RECHAZADO');
  return c;
}

const reemitir = (id: string, cuerpo: Libre, token: string = supervisor(), clave?: string) =>
  escribir(
    ctx,
    token,
    'post',
    `/facturacion/comprobantes/${id}/reemision`,
    cuerpo,
    clave ? ik(clave) : {},
  );

const consumo = async (sucursalId: string): Promise<number> =>
  Number(
    (
      await filas(
        'SELECT coalesce(sum(emitidos), 0) AS n FROM consumo_comprobantes WHERE sucursal_id = $1',
        [sucursalId],
      )
    )[0]!.n,
  );

const campos = (lineas: Libre[]) =>
  lineas.map(
    ({
      posicion,
      itemId,
      descripcion,
      cantidad,
      unidad,
      precioUnitario,
      valorUnitario,
      bruto,
      descuento,
      neto,
      base,
      igv,
      bolsas,
      icbper,
      afectacion,
      gratuita,
      valorReferencial,
    }) => ({
      posicion,
      itemId,
      descripcion,
      cantidad,
      unidad,
      precioUnitario,
      valorUnitario,
      bruto,
      descuento,
      neto,
      base,
      igv,
      bolsas,
      icbper,
      afectacion,
      gratuita,
      valorReferencial,
    }),
  );

describe('criterio 134 · una boleta rechazada se reemite como factura con RUC', () => {
  it('emite uno nuevo con otro número, las mismas líneas y totales, el mismo formato, caja, turno y responsable', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobroRechazado({
      turnoId,
      lineas: [
        ['lomo', 2],
        ['gaseosa', 1],
      ],
      total: '65.00',
    });
    const cajaId = (await A().cajas()).S1!.caja1;
    const antesF = await ultimoNumero(cajaId, 'FACTURA');
    const antesB = await ultimoNumero(cajaId, 'BOLETA');
    const cuotaAntes = await consumo(A().S1);

    const res = await reemitir(original.comprobanteId, { tipo: 'FACTURA', cliente: CLIENTE_RUC });
    exigirEstado(res, 201, 'Emitir otro (006, criterio 134)');
    const cuerpo = reemisionRespuestaSchema.parse(res.body);
    const nuevo = cuerpo.comprobante;
    const viejo = (await api(ctx, supervisor(), 'get', `/comprobantes/${original.comprobanteId}`))
      .body as Libre;

    expect(nuevo.id).not.toBe(original.comprobanteId);
    expect(nuevo).toMatchObject({
      tipo: 'FACTURA',
      estado: 'POR_ENVIAR',
      origen: 'REEMISION',
      simulado: true,
      serie: 'F001',
      correlativo: antesF + 1,
      formato: (original.respuesta.comprobante as Libre).formato,
      cajaId,
      turnoId,
      turnoResponsableId: viejo.turnoResponsableId,
      emisor: viejo.emisor,
      sucursal: viejo.sucursal,
      cobroId: null,
      tasaIgv: viejo.tasaIgv,
      cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero, nombre: CLIENTE_RUC.nombre },
      reemplazaA: { id: original.comprobanteId, numero: numeroDe(original) },
    });
    // Las mismas líneas y totales, sin recalcular.
    expect(campos(nuevo.lineas as Libre[])).toEqual(campos(viejo.lineas as Libre[]));
    expect(nuevo.totales).toEqual(viejo.totales);
    expect(nuevo.montoEnLetras).toBe(viejo.montoEnLetras);

    // En la base: vínculo, motivo y numeración.
    const fila = await comprobanteFila(nuevo.id);
    expect(fila).toMatchObject({
      reemplaza_a_id: original.comprobanteId,
      motivo_reemplazo: 'REEMISION',
      cobro_id: null,
      detalle_parte: null,
      numero: antesF + 1,
    });
    expect(await ultimoNumero(cajaId, 'FACTURA')).toBe(antesF + 1);
    expect(await ultimoNumero(cajaId, 'BOLETA')).toBe(antesB);
    expect(await consumo(A().S1)).toBe(cuotaAntes + 1);

    // El rechazado conserva su número, su estado y su motivo; ahora sabe quién lo reemplazó.
    const conservado = await comprobanteFila(original.comprobanteId);
    expect(conservado).toMatchObject({ estado: 'RECHAZADO', sunat_codigo: '2800' });
    expect(`${conservado.serie}-${String(conservado.numero).padStart(8, '0')}`).toBe(
      numeroDe(original),
    );
    const detalle = await api(ctx, supervisor(), 'get', `/comprobantes/${original.comprobanteId}`);
    expect(detalle.body.reemplazadoPor).toEqual({ id: nuevo.id, numero: nuevo.numero });
  });

  it('el comprobante nuevo se envía como cualquier otro y se acepta', async () => {
    const original = await cobroRechazado();
    const res = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(res, 201, 'Emitir otro');
    const nuevoId = res.body.comprobante.id as string;
    expect(await envioDe(nuevoId)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    await procesar(ctx, A().id, nuevoId);
    expect((await comprobanteFila(nuevoId)).estado).toBe('ACEPTADO');
    expect((await comprobanteFila(original.comprobanteId)).estado).toBe('RECHAZADO');
  });

  it('sin cliente en la entrada conserva el del rechazado; con cliente lo reemplaza', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobroRechazado({ turnoId, cliente: CLIENTE_DNI });
    const conservado = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(conservado, 201, 'Emitir otro sin cliente');
    expect(conservado.body.comprobante.cliente).toMatchObject({
      tipoDocumento: 'DNI',
      numero: CLIENTE_DNI.numero,
    });
    const otro = await cobroRechazado({ turnoId, cliente: CLIENTE_DNI });
    const corregido = await reemitir(otro.comprobanteId, {
      tipo: 'BOLETA',
      cliente: { tipoDocumento: 'DNI', numero: '12345678', nombre: 'Luis Rojas' },
    });
    exigirEstado(corregido, 201, 'Emitir otro con el cliente corregido');
    expect(corregido.body.comprobante.cliente).toMatchObject({
      numero: '12345678',
      nombre: 'Luis Rojas',
    });
  });

  it('el rechazado deja de tener alerta cuando tiene reemisión', async () => {
    const original = await cobroRechazado();
    const alertas = async () =>
      alertasRespuestaSchema.parse(
        (await api(ctx, supervisor(), 'get', '/facturacion/alertas')).body,
      );
    const antes = (await alertas()).rechazados;
    expect(antes).toBeGreaterThanOrEqual(1);
    exigirEstado(await reemitir(original.comprobanteId, { tipo: 'BOLETA' }), 201, 'Emitir otro');
    expect((await alertas()).rechazados).toBe(antes - 1);
    const panel = await api(
      ctx,
      supervisor(),
      'get',
      `/facturacion/comprobantes?texto=${numeroDe(original)}`,
    );
    exigirEstado(panel, 200, 'Panel');
    expect(panel.body.items[0]).toMatchObject({
      id: original.comprobanteId,
      estado: 'RECHAZADO',
      alerta: null,
    });
    expect(panel.body.items[0].reemplazadoPor).not.toBeNull();
  });
});

describe('criterio 134 · rechazos de la reemisión', () => {
  it('solo un RECHAZADO: uno por enviar o aceptado responde 409 COMPROBANTE_NO_RECHAZADO y no numera', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const cajaId = (await A().cajas()).S1!.caja1;
    const porEnviar = await cobrarLomo(ctx, A(), { turnoId });
    const aceptado = await cobrarLomo(ctx, A(), { turnoId });
    await procesar(ctx, A().id, aceptado.comprobanteId);
    const antesB = await ultimoNumero(cajaId, 'BOLETA');
    const cuota = await consumo(A().S1);
    for (const c of [porEnviar, aceptado]) {
      const res = await reemitir(c.comprobanteId, { tipo: 'BOLETA' });
      esperarError(res, 409, 'COMPROBANTE_NO_RECHAZADO');
    }
    expect(await ultimoNumero(cajaId, 'BOLETA')).toBe(antesB);
    expect(await consumo(A().S1)).toBe(cuota);
  });

  it('un comprobante inexistente responde 404 y la entrada es estricta (400)', async () => {
    expect((await reemitir(randomUUID(), { tipo: 'BOLETA' })).status).toBe(404);
    const original = await cobroRechazado();
    for (const cuerpo of [
      {},
      { tipo: 'TICKET' },
      { tipo: 'BOLETA', campoExtra: 1 },
      { tipo: 'BOLETA', empresaId: randomUUID() },
      { tipo: 'BOLETA', cliente: { tipoDocumento: 'DNI', numero: '123', nombre: 'X' } },
    ]) {
      const res = await reemitir(original.comprobanteId, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(
      await contar('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [original.comprobanteId]),
    ).toBe(0);
  });

  it('YA_REEMPLAZADO: una segunda reemisión responde 409 con el comprobanteId del que lo reemplazó y no numera', async () => {
    const original = await cobroRechazado();
    const cajaId = (await A().cajas()).S1!.caja1;
    const primera = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(primera, 201, 'Primera reemisión');
    const antes = await ultimoNumero(cajaId, 'BOLETA');
    const cuota = await consumo(A().S1);
    const segunda = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    esperarError(segunda, 409, 'YA_REEMPLAZADO');
    expect(segunda.body.comprobanteId).toBe(primera.body.comprobante.id);
    expect(await ultimoNumero(cajaId, 'BOLETA')).toBe(antes);
    expect(await consumo(A().S1)).toBe(cuota);
    expect(
      await contar('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [original.comprobanteId]),
    ).toBe(1);
  });

  it('dos reemisiones simultáneas: una 201 y una 409 YA_REEMPLAZADO, un solo comprobante nuevo y un solo número consumido', async () => {
    const original = await cobroRechazado();
    const cajaId = (await A().cajas()).S1!.caja1;
    const antes = await ultimoNumero(cajaId, 'BOLETA');
    const cuota = await consumo(A().S1);
    const [a, b] = await Promise.all([
      reemitir(original.comprobanteId, { tipo: 'BOLETA' }),
      reemitir(original.comprobanteId, { tipo: 'BOLETA' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const perdedora = a.status === 409 ? a : b;
    const ganadora = a.status === 201 ? a : b;
    expect(perdedora.body.codigo).toBe('YA_REEMPLAZADO');
    expect(perdedora.body.comprobanteId).toBe(ganadora.body.comprobante.id);
    expect(await ultimoNumero(cajaId, 'BOLETA')).toBe(antes + 1);
    expect(await consumo(A().S1)).toBe(cuota + 1);
    expect(
      await contar('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [original.comprobanteId]),
    ).toBe(1);
  });
});

describe('criterio 134 · reglas del criterio 51', () => {
  it('una factura exige cliente con RUC y dirección: sin cliente propio, con DNI o sin dirección es 422 CLIENTE_REQUERIDO', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const cajaId = (await A().cajas()).S1!.caja1;
    const original = await cobroRechazado({ turnoId });
    const antes = await ultimoNumero(cajaId, 'FACTURA');
    const cuota = await consumo(A().S1);
    for (const cuerpo of [
      { tipo: 'FACTURA' },
      { tipo: 'FACTURA', cliente: CLIENTE_DNI },
      {
        tipo: 'FACTURA',
        cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero, nombre: CLIENTE_RUC.nombre },
      },
    ]) {
      esperarError(await reemitir(original.comprobanteId, cuerpo), 422, 'CLIENTE_REQUERIDO');
    }
    expect(await ultimoNumero(cajaId, 'FACTURA')).toBe(antes);
    expect(await consumo(A().S1)).toBe(cuota);
    expect(
      await contar('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [original.comprobanteId]),
    ).toBe(0);
  });

  it('un emisor Nuevo RUS solo emite boletas: reemitir como factura es 422 COMPROBANTE_NO_PERMITIDO; como boleta, 201', async () => {
    await activarSimulado(ctx, esc, A(), A().emisor2!);
    const token = A().token.supervisorS2!;
    const turnoId = await turnoDe(ctx, A(), 'supervisorS2', 'S2', 'caja1');
    const original = await cobroRechazado({ turnoId, sucursal: 'S2', token });
    esperarError(
      await reemitir(original.comprobanteId, { tipo: 'FACTURA', cliente: CLIENTE_RUC }, token),
      422,
      'COMPROBANTE_NO_PERMITIDO',
    );
    const boleta = await reemitir(original.comprobanteId, { tipo: 'BOLETA' }, token);
    exigirEstado(boleta, 201, 'Emitir otro como boleta en Nuevo RUS');
    expect(boleta.body.comprobante).toMatchObject({ tipo: 'BOLETA', tasaIgv: null });
  });

  it('una caja sin serie activa del tipo responde 409 SIN_SERIE y no consume número ni cuota', async () => {
    // La Caja 3 de S1 solo tiene serie de boletas.
    const caja3 = (await A().cajas()).S1!.caja3;
    const turnoId = await abrirTurno(ctx, supervisor(), caja3);
    const original = await cobroRechazado({ turnoId, token: supervisor() });
    const antes = await ultimoNumero(caja3, 'BOLETA');
    const cuota = await consumo(A().S1);
    esperarError(
      await reemitir(original.comprobanteId, { tipo: 'FACTURA', cliente: CLIENTE_RUC }),
      409,
      'SIN_SERIE',
    );
    expect(await ultimoNumero(caja3, 'BOLETA')).toBe(antes);
    expect(await consumo(A().S1)).toBe(cuota);
    expect(
      await contar('SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1', [original.comprobanteId]),
    ).toBe(0);
    // Como boleta, con la serie de esa caja, sí.
    const boleta = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(boleta, 201, 'Emitir otro como boleta en la caja 3');
    expect(boleta.body.comprobante).toMatchObject({ serie: 'B003', cajaId: caja3 });
  });
});

describe('criterio 134 · una nota de crédito rechazada', () => {
  it('se reemite con el mismo tipo de nota, sin cliente, con las mismas líneas, el mismo documento que modifica y otro número', async () => {
    await seriesDeNotas(ctx, A());
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobrarLomo(ctx, A(), { turnoId });
    await procesar(ctx, A().id, original.comprobanteId);
    const anulacion = await anularComprobante(ctx, supervisor(), original.comprobanteId, '28.00');
    exigirEstado(anulacion, 201, 'Anular con una nota de crédito (006, criterio 144)');
    const nota = anulacion.body.nota as Libre;
    ctx.pse.reglas.rechazarNumero(nota.numero, { codigo: '2800', mensaje: 'Rechazo de la nota' });
    await procesar(ctx, A().id, nota.id);
    expect((await comprobanteFila(nota.id)).estado).toBe('RECHAZADO');
    // El original sigue aceptado: la nota rechazada no lo anula.
    expect((await comprobanteFila(original.comprobanteId)).estado).toBe('ACEPTADO');

    const conCliente = await reemitir(nota.id, {
      tipo: 'NOTA_CREDITO_BOLETA',
      cliente: CLIENTE_DNI,
    });
    expect(conCliente.status).toBe(400);
    const res = await reemitir(nota.id, { tipo: 'NOTA_CREDITO_BOLETA' });
    exigirEstado(res, 201, 'Reemitir la nota rechazada');
    const nueva = reemisionRespuestaSchema.parse(res.body).comprobante;
    expect(nueva).toMatchObject({
      tipo: 'NOTA_CREDITO_BOLETA',
      estado: 'POR_ENVIAR',
      origen: 'REEMISION',
      afectaA: { id: original.comprobanteId },
      reemplazaA: { id: nota.id },
      nota: { tipo: 'ANULACION', motivo: nota.nota?.motivo ?? 'Error al digitar la venta' },
    });
    expect(nueva.numero).not.toBe(nota.numero);
    expect(nueva.serie).toBe(nota.serie);
    expect(nueva.correlativo).toBe(Number(nota.correlativo) + 1);
    expect(nueva.totales).toEqual(nota.totales);
    expect(campos(nueva.lineas as Libre[])).toEqual(campos(nota.lineas as Libre[]));
    expect(nueva.lineas.map((l) => l.posicionOrigen)).toEqual(
      (nota.lineas as Libre[]).map((l) => l.posicionOrigen),
    );
    expect(await envioDe(nueva.id)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
  });
});

describe('criterio 134 · auditoría y réplicas', () => {
  it('deja exactamente una fila reemitir_comprobante, con el actor y el detalle; la réplica no deja otra ni numera', async () => {
    const original = await cobroRechazado();
    const cajaId = (await A().cajas()).S1!.caja1;
    const admin = await abrirCliente('admin');
    try {
      const filasDe = async () =>
        filasDeAuditoria(admin, "accion = 'reemitir_comprobante' AND empresa_id = $1", [A().id]);
      const filasAntes = await filasDe();
      const antes = filasAntes.length;
      const clave = randomUUID();
      const cuerpo = { tipo: 'FACTURA', cliente: CLIENTE_RUC };
      const primera = await reemitir(original.comprobanteId, cuerpo, supervisor(), clave);
      exigirEstado(primera, 201, 'Emitir otro');
      const nuevo = primera.body.comprobante as Libre;

      const despues = await filasDe();
      expect(despues).toHaveLength(antes + 1);
      // Con el reloj manual todas las filas tienen la misma hora: la nueva es la que no estaba.
      const conocidas = new Set(filasAntes.map((f) => f.id));
      const nuevas = despues.filter((f) => !conocidas.has(f.id));
      expect(nuevas).toHaveLength(1);
      const fila = nuevas[0]!;
      expect(fila).toMatchObject({
        accion: 'reemitir_comprobante',
        entidad: 'comprobante',
        entidad_id: nuevo.id,
        actor_usuario_id: A().personas.supervisor!.id,
        sucursal_id: A().S1,
      });
      expect(fila.detalle).toEqual({
        rechazado: { id: original.comprobanteId, numero: numeroDe(original) },
        nuevo: { id: nuevo.id, numero: nuevo.numero },
        tipo: 'FACTURA',
        cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero },
      });

      // La réplica (misma clave, mismo cuerpo) devuelve lo mismo sin numerar ni auditar.
      const ultimo = await ultimoNumero(cajaId, 'FACTURA');
      const replica = await reemitir(original.comprobanteId, cuerpo, supervisor(), clave);
      exigirEstado(replica, 201, 'Réplica');
      expect(replica.body.comprobante.id).toBe(nuevo.id);
      expect(await ultimoNumero(cajaId, 'FACTURA')).toBe(ultimo);
      expect(await filasDe()).toHaveLength(antes + 1);
      // La misma clave con otro cuerpo es 422.
      esperarError(
        await reemitir(original.comprobanteId, { tipo: 'BOLETA' }, supervisor(), clave),
        422,
        'CLAVE_IDEMPOTENCIA_REUTILIZADA',
      );
    } finally {
      await admin.end();
    }
  });

  it('sin cliente nuevo la auditoría lleva cliente null cuando el nuevo comprobante no tiene cliente', async () => {
    const original = await cobroRechazado();
    const res = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(res, 201, 'Emitir otro');
    const admin = await abrirCliente('admin');
    try {
      const f = (
        await filasDeAuditoria(admin, "accion = 'reemitir_comprobante' AND entidad_id = $1", [
          res.body.comprobante.id,
        ])
      ).at(-1)!;
      expect((f.detalle as Libre).cliente).toBeNull();
      expect((f.detalle as Libre).tipo).toBe('BOLETA');
    } finally {
      await admin.end();
    }
  });
});

describe('criterio 134 · el ticket de la reemisión', () => {
  it('se encola en la impresora de la caja del rechazado y sale sin pulso de gaveta', async () => {
    const cajaS3 = (await A().cajas()).S3!.caja1;
    const impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
      cajaId: cajaS3,
    });
    const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
    await puente.iniciar();
    const turnoId = await turnoDe(ctx, A(), 'cajeroS3', 'S3', 'caja1');
    // El cobro original sí abre la gaveta (efectivo).
    const original = await cobroRechazado({
      turnoId,
      sucursal: 'S3',
      token: A().token.cajeroS3!,
    });
    await impresora.emulador.esperarTicket(5_000);
    impresora.emulador.limpiar();

    const res = await reemitir(original.comprobanteId, { tipo: 'BOLETA' }, A().token.supervisorS3!);
    exigirEstado(res, 201, 'Emitir otro');
    const cuerpo = reemisionRespuestaSchema.parse(res.body);
    expect(cuerpo.impresion).toBe('EN_COLA');
    expect(cuerpo.trabajoId).not.toBeNull();
    const trabajo = (
      await filas('SELECT * FROM trabajo_impresion WHERE id = $1', [cuerpo.trabajoId])
    )[0]!;
    expect(trabajo).toMatchObject({
      tipo: 'COMPROBANTE',
      comprobante_id: cuerpo.comprobante.id,
      impresora_id: impresora.id,
    });
    const ticket = await impresora.emulador.esperarTicket(5_000);
    expect(ticket.texto).toContain(cuerpo.comprobante.numero);
    expect(ticket.pulsosGaveta).toBe(0);
  });

  it('sin impresora de caja la reemisión igual sale: impresion SIN_IMPRESORA y sin trabajo', async () => {
    const original = await cobroRechazado();
    const res = await reemitir(original.comprobanteId, { tipo: 'BOLETA' });
    exigirEstado(res, 201, 'Emitir otro sin impresora');
    expect(res.body.impresion).toBe('SIN_IMPRESORA');
    expect(res.body.trabajoId).toBeNull();
  });
});
