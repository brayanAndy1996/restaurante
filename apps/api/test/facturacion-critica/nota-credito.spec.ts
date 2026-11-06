// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · Notas de crédito (ruta crítica), criterios 143 a 146, 149, 151, 152 y 157:
// - 144: la forma de la entrada (formas incorrectas = 400, sin cambios), `NOTA_CREDITO_CAMBIO` y la respuesta;
// - 143 y 146: los tres tipos y el original (sucursal, B, nota de crédito, alcance del Cajero, `POR_ENVIAR`, `ENVIADO`,
//   `RECHAZADO`, `ANULADO`, cambio sobre una factura o con Nuevo RUS, anulación con notas previas);
// - 149: serie y número de la caja de la operación y del emisor del original, `SIN_SERIE`;
// - 151: el cambio de boleta por factura; 152: el estado del original cuando el worker acepta la nota;
// - 157: el ticket de la nota en el emulador, con la gaveta solo si se devuelve efectivo.
// La emisión por el Supervisor evita la clave (la clave está en `nota-credito-clave.spec.ts`). El original queda `ACEPTADO`
// corriendo el procesador de envíos a mano con el simulador del PSE (criterios 125 y 137).
// Hoy falla por "No implementado": `POST /notas-credito` y el worker lanzan `Error('No implementado')`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Cierres,
  cerrarAdmin,
  cobrar,
  crearEscenario,
  cuentaC,
  esperarError,
  esperarHasta,
  filas,
  impresoraDeCaja,
  pulsosRecibidos,
  vincularPuente,
  CLIENTE_DNI,
  CLIENTE_RUC,
  type Escenario,
  type ImpresoraDePrueba,
} from '../caja-critica/fabrica-caja';
import {
  aceptar,
  arrancarNotas,
  comprobanteDe,
  contarFilas,
  efectivo,
  emitirAceptado,
  emitirNota,
  envioDe,
  estadoDe,
  filaDeNota,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  autorizarNota,
  prepararNotas,
  turnoAbiertoDe,
  yape,
  cuerpoNota,
  formatoNumero,
  trabajosDeComprobante,
  type AppNotas,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;
const cierres = new Cierres();
const A = () => esc.A;
const B = () => esc.B;
const sup = () => A().token.supervisor!;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await cerrarAdmin();
});

/** Una boleta (cuenta C) cobrada y aceptada por el simulador; deja el escenario listo la primera vez. */
const boleta = async (o: Parameters<typeof emitirAceptado>[2] = {}) => {
  await prepararNotas(ctx, esc);
  return emitirAceptado(ctx, A(), o);
};

const lineaDe = (comprobante: Libre, descripcion: RegExp): Libre =>
  (comprobante.lineas as Libre[]).find((l) => descripcion.test(l.descripcion as string))!;

const sinDetalleTecnico = (res: { text: string }) =>
  expect(res.text).not.toMatch(/SQLSTATE|violates|relation "|pg_catalog|at Object\./i);

// ------------------------------------------------------------------------------------------------
describe('criterio 144 · la forma de la entrada', () => {
  it('toda forma incorrecta es 400 DATOS_INVALIDOS y no emite nada', async () => {
    // El 400 sale antes de mirar el comprobante o el turno: los ids son cualquiera.
    const o = { comprobanteId: randomUUID(), turnoId: randomUUID() };
    const antes = await contarFilas('SELECT 1 FROM comprobante WHERE empresa_id = $1', [A().id]);
    const valida = (cambios: Libre = {}): Libre => ({
      ...cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      ...cambios,
    });
    const devolucion = (cambios: Libre = {}) => ({
      turnoId: o.turnoId,
      pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
      redondeo: '0.00',
      ...cambios,
    });
    const dev = (cambios: Libre = {}): Libre =>
      valida({
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: 1, cantidad: 1 }],
        ...cambios,
      });
    const casos: Array<[string, Libre]> = [
      ['un campo desconocido', valida({ empresaId: randomUUID() })],
      ['un tipo desconocido', valida({ tipo: 'OTRA' })],
      ['una devolución sin líneas', dev({ lineas: undefined })],
      ['una devolución con líneas vacías', dev({ lineas: [] })],
      ['una anulación con líneas', valida({ lineas: [{ posicion: 1, cantidad: 1 }] })],
      ['una posición 0', dev({ lineas: [{ posicion: 0, cantidad: 1 }] })],
      ['una cantidad 0', dev({ lineas: [{ posicion: 1, cantidad: 0 }] })],
      ['una cantidad de 1000', dev({ lineas: [{ posicion: 1, cantidad: 1000 }] })],
      ['un cambio sin cliente', valida({ tipo: 'CAMBIO_A_FACTURA' })],
      ['un cliente en una anulación', valida({ cliente: CLIENTE_RUC })],
      [
        'una devolución en el cambio',
        valida({ tipo: 'CAMBIO_A_FACTURA', cliente: CLIENTE_RUC, devolucion: devolucion() }),
      ],
      ['un motivo vacío', valida({ motivo: '' })],
      ['un motivo de 301 caracteres', valida({ motivo: 'x'.repeat(301) })],
      ['un total con tres decimales', valida({ total: '69.201' })],
      ['un total que es número', valida({ total: 69.2 })],
      ['un id que no es uuid', valida({ id: 'no-es-uuid' })],
      ['una devolución sin pagos', dev({ devolucion: devolucion({ pagos: [] }) })],
      [
        'más de 5 pagos',
        dev({
          devolucion: devolucion({
            pagos: [
              { medio: 'EFECTIVO', monto: '1.00' },
              { medio: 'YAPE', monto: '1.00', operacion: 'A1' },
              { medio: 'PLIN', monto: '1.00', operacion: 'A2' },
              { medio: 'TARJETA_CREDITO', monto: '1.00', operacion: 'A3' },
              { medio: 'TARJETA_DEBITO', monto: '1.00', operacion: 'A4' },
              { medio: 'EFECTIVO', monto: '1.00' },
            ],
          }),
        }),
      ],
      [
        'un pago en efectivo con número de operación',
        dev({
          devolucion: devolucion({
            pagos: [{ medio: 'EFECTIVO', monto: '28.00', operacion: 'X1' }],
          }),
        }),
      ],
      [
        'un pago fuera del efectivo sin número de operación',
        dev({ devolucion: devolucion({ pagos: [{ medio: 'YAPE', monto: '28.00' }] }) }),
      ],
      [
        'un pago con "recibido"',
        dev({
          devolucion: devolucion({
            pagos: [{ medio: 'EFECTIVO', monto: '28.00', recibido: '30.00' }],
          }),
        }),
      ],
      ['un redondeo negativo', dev({ devolucion: devolucion({ redondeo: '-0.01' }) })],
    ];
    const fallos: string[] = [];
    for (const [que, cuerpo] of casos) {
      const limpio = Object.fromEntries(Object.entries(cuerpo).filter(([, v]) => v !== undefined));
      const res = await notaCrudo(ctx, sup(), limpio);
      if (res.status !== 400 || res.body?.codigo !== 'DATOS_INVALIDOS') {
        fallos.push(`${que}: ${res.status} ${res.body?.codigo ?? res.text.slice(0, 80)}`);
      }
    }
    // Sin clave de idempotencia también es 400.
    const sinIk = await ctx
      .http()
      .post('/notas-credito')
      .set('Authorization', `Bearer ${sup()}`)
      .send(valida());
    if (sinIk.status !== 400) fallos.push(`sin Idempotency-Key: ${sinIk.status}`);
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await contarFilas('SELECT 1 FROM comprobante WHERE empresa_id = $1', [A().id])).toBe(
      antes,
    );
  });

  it('un total distinto del que calcula el servidor es 409 NOTA_CREDITO_CAMBIO con el total correcto; nada cambia ni consume número', async () => {
    const o = await boleta();
    const antes = await contarFilas(`SELECT 1 FROM comprobante WHERE caja_id = $1`, [o.cajaId]);
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '27.00',
        lineas: [
          { posicion: lineaDe(o.cobro.comprobante, /Lomo/).posicion as number, cantidad: 1 },
        ],
      }),
    );
    esperarError(res, 409, 'NOTA_CREDITO_CAMBIO');
    const campos = (res.body.campos ?? []) as Array<{ campo: string }>;
    expect(campos.map((c) => c.campo)).toContain('total');
    expect(JSON.stringify(res.body)).toContain('28.00');
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    expect(await contarFilas(`SELECT 1 FROM comprobante WHERE caja_id = $1`, [o.cajaId])).toBe(
      antes,
    );
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 143 y 144 · los tres tipos y la respuesta', () => {
  it('ANULACION de una boleta: 201 con la nota, sus líneas, el envío y el trabajo en la cola; el original sigue ACEPTADO', async () => {
    const o = await boleta();
    const original = o.cobro.comprobante as Libre;
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      motivo: 'El cliente se equivocó de comprobante',
      total: '69.20',
    });
    expect(res.id).toBeTruthy();
    expect(res.factura).toBeNull();
    expect(res.devolucion).toBeNull();
    expect(['EN_COLA', 'SIN_IMPRESORA']).toContain(res.impresion);
    const nota = res.nota as Libre;
    expect(nota).toMatchObject({
      tipo: 'NOTA_CREDITO_BOLETA',
      serie: 'BC01',
      estado: 'POR_ENVIAR',
      origen: 'NOTA_CREDITO',
      cobroId: null,
      turnoId: null,
      numeroParte: null,
      simulado: true,
      moneda: 'PEN',
      afectaA: { id: o.comprobanteId, tipo: 'BOLETA', numero: o.numero },
      nota: {
        tipo: 'ANULACION',
        motivo: 'El cliente se equivocó de comprobante',
        cambioAFactura: false,
      },
      totales: { total: '69.20', igv: '9.94', icbper: '1.00' },
    });
    expect(nota.numero).toBe(formatoNumero('BC01', nota.correlativo as number));
    expect(nota.emisor).toEqual(original.emisor);
    expect(nota.sucursal).toEqual(original.sucursal);
    expect(nota.cliente).toEqual(original.cliente);
    expect(nota.cajaId).toBe(o.cajaId);
    expect(nota.turnoResponsableId).toBe(original.turnoResponsableId);
    // Las cuatro líneas del original tal cual, cada una apuntando a la suya.
    const lineasNota = nota.lineas as Libre[];
    expect(lineasNota).toHaveLength(4);
    for (const l of lineasNota) {
      const origen = (original.lineas as Libre[]).find((x) => x.posicion === l.posicionOrigen)!;
      expect(l).toMatchObject({
        cantidad: origen.cantidad,
        neto: origen.neto,
        base: origen.base,
        igv: origen.igv,
        icbper: origen.icbper,
        bolsas: origen.bolsas,
      });
    }
    // Se guardó la nota, su envío y el trabajo de la cola (con solo la empresa y el comprobante).
    const fila = await filaDeNota(nota.id as string);
    expect(fila).toMatchObject({
      id: res.id,
      original_id: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
      devuelto: '0.00',
      turno_id: null,
      factura_id: null,
    });
    expect(await envioDe(nota.id as string)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    const trabajos = ctx.cola
      .pendientes()
      .filter((t) => t.comprobanteId === nota.id)
      .map(({ empresaId, comprobanteId }) => ({ empresaId, comprobanteId }));
    expect(trabajos).toEqual([{ empresaId: A().id, comprobanteId: nota.id }]);
    // Antes de que SUNAT acepte la nota, el original no cambia (criterio 152).
    expect(await estadoDe(o.comprobanteId)).toBe('ACEPTADO');
  });

  it('el worker acepta la anulación: la nota queda ACEPTADO y el original ANULADO con su marca; entonces ya no admite otra nota', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const notaId = (res.nota as Libre).id as string;
    await aceptar(ctx, A(), notaId);
    expect(await estadoDe(o.comprobanteId)).toBe('ANULADO');
    const detalle = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalle.estado).toBe('ANULADO');
    expect(detalle.marcas.anuladoEn).toBeTruthy();
    expect(detalle.notasCredito).toEqual([
      {
        id: notaId,
        tipo: 'ANULACION',
        numero: (res.nota as Libre).numero,
        estado: 'ACEPTADO',
        total: '69.20',
      },
    ]);
    const otra = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
    );
    esperarError(otra, 409, 'COMPROBANTE_ANULADO');
  });

  it('si SUNAT rechaza la nota, el original no cambia y sigue ACEPTADO', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const nota = res.nota as Libre;
    ctx.simulador.reglas.rechazarNumero(nota.numero as string, {
      codigo: '2800',
      mensaje: 'Documento rechazado por la prueba',
    });
    try {
      await ctx.procesar(A().id, nota.id as string);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    expect(await estadoDe(nota.id as string)).toBe('RECHAZADO');
    expect(await estadoDe(o.comprobanteId)).toBe('ACEPTADO');
  });

  it('DEVOLUCION de 1 Lomo y luego del otro: cada una acredita 28.00, el original sigue ACEPTADO con su acreditado; una tercera no hay qué acreditar', async () => {
    const o = await boleta();
    const original = o.cobro.comprobante as Libre;
    const lomo = lineaDe(original, /Lomo/).posicion as number;
    const primera = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      motivo: 'El lomo llegó frío',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
    });
    const nota1 = primera.nota as Libre;
    expect(nota1).toMatchObject({
      tipo: 'NOTA_CREDITO_BOLETA',
      nota: { tipo: 'DEVOLUCION', motivo: 'El lomo llegó frío', cambioAFactura: false },
      totales: { total: '28.00', igv: '4.27' },
    });
    expect(nota1.lineas).toHaveLength(1);
    expect((nota1.lineas as Libre[])[0]).toMatchObject({
      posicionOrigen: lomo,
      cantidad: 1,
      bruto: '28.00',
      neto: '28.00',
      base: '23.73',
      igv: '4.27',
    });
    await aceptar(ctx, A(), nota1.id as string);
    // Una devolución no cambia el estado del original (criterio 152).
    expect(await estadoDe(o.comprobanteId)).toBe('ACEPTADO');
    let detalle = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalle.acreditado).toEqual([
      { posicion: lomo, cantidad: 1, neto: '28.00', bolsas: 0, icbper: '0.00' },
    ]);
    expect(detalle.notasCredito).toEqual([
      {
        id: nota1.id,
        tipo: 'DEVOLUCION',
        numero: nota1.numero,
        estado: 'ACEPTADO',
        total: '28.00',
      },
    ]);

    const segunda = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
    });
    expect((segunda.nota as Libre).totales).toMatchObject({ total: '28.00', igv: '4.27' });
    expect((segunda.nota as Libre).correlativo).toBe((nota1.correlativo as number) + 1);
    detalle = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalle.acreditado).toEqual([
      { posicion: lomo, cantidad: 2, neto: '56.00', bolsas: 0, icbper: '0.00' },
    ]);

    const tercera = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: lomo, cantidad: 1 }],
      }),
    );
    expect(tercera.status).toBe(422);
    expect(['NADA_QUE_ACREDITAR', 'NOTA_CREDITO_INVALIDA']).toContain(tercera.body.codigo);
    sinDetalleTecnico(tercera);
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(2);

    // Con notas que cuentan, la anulación y el cambio a factura ya no son posibles (pregunta 32).
    const anulacion = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
    );
    esperarError(anulacion, 422, 'NOTA_CREDITO_INVALIDA');
    const cambio = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        total: '69.20',
        cliente: CLIENTE_RUC,
      }),
    );
    esperarError(cambio, 422, 'NOTA_CREDITO_INVALIDA');
  });

  it('devolver 1 Bolsa acredita 0.60 (0.10 más 0.50 de ICBPER) y la línea queda con 1 bolsa por acreditar', async () => {
    const o = await boleta();
    const bolsa = lineaDe(o.cobro.comprobante, /Bolsa/).posicion as number;
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '0.60',
      lineas: [{ posicion: bolsa, cantidad: 1 }],
    });
    expect((res.nota as Libre).totales).toMatchObject({ total: '0.60', icbper: '0.50' });
    expect(((res.nota as Libre).lineas as Libre[])[0]).toMatchObject({
      neto: '0.10',
      base: '0.08',
      igv: '0.02',
      bolsas: 1,
      icbper: '0.50',
    });
    const detalle = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalle.acreditado).toEqual([
      { posicion: bolsa, cantidad: 1, neto: '0.10', bolsas: 1, icbper: '0.50' },
    ]);
  });

  it('en un comprobante "Por consumo" la línea agrupada se devuelve entera (una unidad) y no admite más', async () => {
    const o = await boleta({ formato: 'CONSUMO' });
    const original = o.cobro.comprobante as Libre;
    const agrupada = (original.lineas as Libre[]).find(
      (l) => /consumo/i.test(l.descripcion as string) && l.afectacion === 'GRAVADO',
    )!;
    expect(agrupada.cantidad).toBe(1);
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: agrupada.neto as string,
      lineas: [{ posicion: agrupada.posicion as number, cantidad: 1 }],
    });
    expect(((res.nota as Libre).lineas as Libre[])[0]).toMatchObject({
      posicionOrigen: agrupada.posicion,
      cantidad: 1,
      neto: agrupada.neto,
    });
    const otra = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: agrupada.neto as string,
        lineas: [{ posicion: agrupada.posicion as number, cantidad: 2 }],
      }),
    );
    expect(otra.status).toBe(422);
    sinDetalleTecnico(otra);
  });

  it('una línea o una posición que no existe en el original es 422 NOTA_CREDITO_INVALIDA', async () => {
    const o = await boleta();
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: 99, cantidad: 1 }],
      }),
    );
    esperarError(res, 422, 'NOTA_CREDITO_INVALIDA');
    const repetida = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '56.00',
        lineas: [
          { posicion: 1, cantidad: 1 },
          { posicion: 1, cantidad: 1 },
        ],
      }),
    );
    esperarError(repetida, 422, 'NOTA_CREDITO_INVALIDA');
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 146 · el original', () => {
  it('de otra sucursal, de otra empresa o inexistente responde 404, y los dos últimos con el mismo cuerpo', async () => {
    const o = await boleta();
    await prepararNotas(ctx, esc);
    const deB = await emitirAceptadoDeB();
    const pedir = (token: string, comprobanteId: string) =>
      notaCrudo(ctx, token, cuerpoNota({ comprobanteId, tipo: 'ANULACION', total: '69.20' }));
    const otraSucursal = await pedir(A().token.supervisorS3!, o.comprobanteId);
    expect(otraSucursal.status, otraSucursal.text).toBe(404);
    const ajeno = await pedir(sup(), deB);
    const inexistente = await pedir(sup(), randomUUID());
    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(ajeno.body).toEqual(inexistente.body);
    sinDetalleTecnico(ajeno);
    expect(await notasDelOriginal(deB)).toEqual([]);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('una nota de crédito no es un original válido: 422 NOTA_CREDITO_INVALIDA', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '3.00',
      lineas: [
        { posicion: lineaDe(o.cobro.comprobante, /Mandarina/).posicion as number, cantidad: 1 },
      ],
    });
    const notaId = (res.nota as Libre).id as string;
    await aceptar(ctx, A(), notaId);
    const sobreLaNota = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({ comprobanteId: notaId, tipo: 'ANULACION', total: '3.00' }),
    );
    esperarError(sobreLaNota, 422, 'NOTA_CREDITO_INVALIDA');
  });

  it('solo un comprobante ACEPTADO admite nota: POR_ENVIAR, ENVIADO y RECHAZADO son 409 COMPROBANTE_NO_ACEPTADO y ANULADO, 409 COMPROBANTE_ANULADO', async () => {
    const porEnviar = await boleta({ aceptado: false });
    const enviado = await boleta({ aceptado: false });
    const rechazado = await boleta({ aceptado: false });
    ctx.simulador.reglas.responderPendiente(1);
    try {
      await ctx.procesar(A().id, enviado.comprobanteId);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    expect(await estadoDe(enviado.comprobanteId)).toBe('ENVIADO');
    ctx.simulador.reglas.rechazarNumero(rechazado.numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    try {
      await ctx.procesar(A().id, rechazado.comprobanteId);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    expect(await estadoDe(rechazado.comprobanteId)).toBe('RECHAZADO');
    const anulado = await boleta();
    const anulacion = await emitirNota(ctx, sup(), {
      comprobanteId: anulado.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    await aceptar(ctx, A(), (anulacion.nota as Libre).id as string);
    expect(await estadoDe(anulado.comprobanteId)).toBe('ANULADO');

    const intentar = (id: string) =>
      notaCrudo(ctx, sup(), cuerpoNota({ comprobanteId: id, tipo: 'ANULACION', total: '69.20' }));
    esperarError(await intentar(porEnviar.comprobanteId), 409, 'COMPROBANTE_NO_ACEPTADO');
    esperarError(await intentar(enviado.comprobanteId), 409, 'COMPROBANTE_NO_ACEPTADO');
    esperarError(await intentar(rechazado.comprobanteId), 409, 'COMPROBANTE_NO_ACEPTADO');
    esperarError(await intentar(anulado.comprobanteId), 409, 'COMPROBANTE_ANULADO');
    for (const id of [porEnviar, enviado, rechazado]) {
      expect(await notasDelOriginal(id.comprobanteId)).toEqual([]);
    }
  });

  it('el Cajero solo opera los comprobantes de sus turnos: el de otro Cajero es 403 PROHIBIDO aun con una clave válida', async () => {
    const o = await boleta({ quien: 'cajero', caja: 'caja1' });
    const clave = await autorizarNota(
      ctx,
      A().token.cajero2!,
      A().personas.supervisor!.pin,
      objetivoNota(o.comprobanteId, 'ANULACION', '69.20'),
    );
    const res = await notaCrudo(
      ctx,
      A().token.cajero2!,
      cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      { autorizacion: clave.autorizacionId },
    );
    esperarError(res, 403, 'PROHIBIDO');
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('el cambio a factura solo es de una boleta: sobre una factura, 422 NOTA_CREDITO_INVALIDA', async () => {
    const factura = await boleta({ tipo: 'FACTURA', cliente: CLIENTE_RUC });
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: factura.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        total: '69.20',
        cliente: CLIENTE_RUC,
      }),
    );
    esperarError(res, 422, 'NOTA_CREDITO_INVALIDA');
    expect(await notasDelOriginal(factura.comprobanteId)).toEqual([]);
  });

  it('un emisor Nuevo RUS no emite facturas: el cambio de una boleta suya es 422 COMPROBANTE_NO_PERMITIDO', async () => {
    const rus = await boleta({ sucursal: 'S2', caja: 'caja1', quien: 'supervisorS2' });
    const res = await notaCrudo(
      ctx,
      A().token.supervisorS2!,
      cuerpoNota({
        comprobanteId: rus.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        total: '69.20',
        cliente: CLIENTE_RUC,
      }),
    );
    esperarError(res, 422, 'COMPROBANTE_NO_PERMITIDO');
    // La anulación de la boleta de Nuevo RUS sí se emite, sin IGV.
    const anulacion = await emitirNota(ctx, A().token.supervisorS2!, {
      comprobanteId: rus.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    expect((anulacion.nota as Libre).serie).toBe('BC21');
    expect((anulacion.nota as Libre).totales).toMatchObject({ igv: '0.00', total: '69.20' });
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 149 · serie y número de la nota', () => {
  it('sin devolución toma la serie de notas de la caja del original, y el correlativo sigue sin saltos', async () => {
    const enCaja2 = await boleta({ quien: 'cajero2', caja: 'caja2' });
    const otra = await boleta({ quien: 'cajero2', caja: 'caja2' });
    const a = await emitirNota(ctx, sup(), {
      comprobanteId: enCaja2.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const b = await emitirNota(ctx, sup(), {
      comprobanteId: otra.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    expect((a.nota as Libre).serie).toBe('BC02');
    expect((b.nota as Libre).serie).toBe('BC02');
    expect((b.nota as Libre).correlativo).toBe(((a.nota as Libre).correlativo as number) + 1);
    expect((a.nota as Libre).cajaId).toBe(enCaja2.cajaId);
  });

  it('la nota de una factura es NOTA_CREDITO_FACTURA y toma la serie F de notas de su caja', async () => {
    const factura = await boleta({ tipo: 'FACTURA', cliente: CLIENTE_RUC });
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: factura.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    expect(res.nota).toMatchObject({
      tipo: 'NOTA_CREDITO_FACTURA',
      serie: 'FC01',
      afectaA: { id: factura.comprobanteId, tipo: 'FACTURA' },
      cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero },
    });
  });

  it('con devolución toma la serie de la caja del turno de la devolución, aunque el original sea de otra caja', async () => {
    const original = await boleta({ quien: 'cajero', caja: 'caja1' });
    const cajas = await A().cajas();
    // El Supervisor devuelve desde su propio turno en la caja 3.
    const turnoCaja3 = await turnoAbiertoDe(ctx, sup(), cajas.S1!.caja3);
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: original.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [
        { posicion: lineaDe(original.cobro.comprobante, /Lomo/).posicion as number, cantidad: 1 },
      ],
      devolucion: { turnoId: turnoCaja3, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    expect(res.nota).toMatchObject({ serie: 'BC03', cajaId: cajas.S1!.caja3, turnoId: turnoCaja3 });
    expect(res.devolucion).toMatchObject({ total: '28.00', redondeo: '0.00' });
  });

  it('una caja sin serie de notas de ese tipo es 409 SIN_SERIE y no consume ningún número', async () => {
    const factura = await boleta({ tipo: 'FACTURA', cliente: CLIENTE_RUC });
    const cajas = await A().cajas();
    // La caja 3 solo tiene serie de notas de boletas.
    const turnoCaja3 = await turnoAbiertoDe(ctx, sup(), cajas.S1!.caja3);
    const antes = await filas(
      `SELECT tipo, ultimo_numero FROM serie WHERE caja_id = $1 ORDER BY tipo`,
      [cajas.S1!.caja3],
    );
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: factura.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [
          { posicion: lineaDe(factura.cobro.comprobante, /Lomo/).posicion as number, cantidad: 1 },
        ],
        devolucion: { turnoId: turnoCaja3, pagos: [efectivo('28.00')], redondeo: '0.00' },
      }),
    );
    esperarError(res, 409, 'SIN_SERIE');
    expect(res.body.mensaje).toMatch(/notas de crédito/);
    expect(
      await filas(`SELECT tipo, ultimo_numero FROM serie WHERE caja_id = $1 ORDER BY tipo`, [
        cajas.S1!.caja3,
      ]),
    ).toEqual(antes);
    expect(await notasDelOriginal(factura.comprobanteId)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 151 · cambio de boleta por factura', () => {
  it('emite la anulación de la boleta y una factura con las mismas líneas y montos para el cliente con RUC; el original queda ANULADO al aceptarse la nota', async () => {
    const o = await boleta();
    const original = o.cobro.comprobante as Libre;
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      motivo: 'El cliente pidió factura',
      total: '69.20',
      cliente: CLIENTE_RUC,
    });
    const nota = res.nota as Libre;
    const factura = res.factura as Libre;
    expect(res.devolucion).toBeNull();
    expect(nota).toMatchObject({
      tipo: 'NOTA_CREDITO_BOLETA',
      serie: 'BC01',
      nota: { tipo: 'ANULACION', cambioAFactura: true, motivo: 'El cliente pidió factura' },
      afectaA: { id: o.comprobanteId },
    });
    expect(factura).toMatchObject({
      tipo: 'FACTURA',
      serie: 'F001',
      estado: 'POR_ENVIAR',
      origen: 'CAMBIO_A_FACTURA',
      cobroId: null,
      formato: original.formato,
      tasaIgv: original.tasaIgv,
      cajaId: original.cajaId,
      reemplazaA: { id: o.comprobanteId, numero: o.numero },
      cliente: { tipoDocumento: 'RUC', numero: CLIENTE_RUC.numero, nombre: CLIENTE_RUC.nombre },
    });
    expect(factura.totales).toEqual(original.totales);
    const montos = (l: Libre) => ({
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      bruto: l.bruto,
      descuento: l.descuento,
      neto: l.neto,
      base: l.base,
      igv: l.igv,
      bolsas: l.bolsas,
      icbper: l.icbper,
      afectacion: l.afectacion,
    });
    expect((factura.lineas as Libre[]).map(montos)).toEqual(
      (original.lineas as Libre[]).map(montos),
    );
    // La nota y la factura tienen su envío y su trabajo en la cola; la fila de `nota_credito` lleva la factura.
    for (const c of [nota, factura]) {
      expect(await envioDe(c.id as string)).toMatchObject({ estado: 'PENDIENTE' });
      expect(ctx.cola.pendientes().filter((t) => t.comprobanteId === c.id)).toHaveLength(1);
    }
    expect(await filaDeNota(nota.id as string)).toMatchObject({
      tipo: 'CAMBIO_A_FACTURA',
      factura_id: factura.id,
      original_id: o.comprobanteId,
    });
    // El original sigue ACEPTADO hasta que SUNAT acepta la nota; entonces pasa a ANULADO.
    expect(await estadoDe(o.comprobanteId)).toBe('ACEPTADO');
    await aceptar(ctx, A(), nota.id as string);
    await aceptar(ctx, A(), factura.id as string);
    expect(await estadoDe(o.comprobanteId)).toBe('ANULADO');
    expect(await estadoDe(factura.id as string)).toBe('ACEPTADO');
    const detalleFactura = await comprobanteDe(ctx, sup(), factura.id as string);
    expect(detalleFactura.reemplazaA).toMatchObject({ id: o.comprobanteId });
    const detalleBoleta = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(detalleBoleta.reemplazadoPor).toMatchObject({ id: factura.id });
  });

  it('el cliente de la factura sigue las reglas del criterio 51: sin RUC y dirección, 422 CLIENTE_REQUERIDO y no se emite nada', async () => {
    const o = await boleta();
    for (const cliente of [CLIENTE_DNI, { ...CLIENTE_RUC, direccion: undefined }]) {
      const limpio = Object.fromEntries(Object.entries(cliente).filter(([, v]) => v !== undefined));
      const res = await notaCrudo(
        ctx,
        sup(),
        cuerpoNota({
          comprobanteId: o.comprobanteId,
          tipo: 'CAMBIO_A_FACTURA',
          total: '69.20',
          cliente: limpio,
        }),
      );
      esperarError(res, 422, 'CLIENTE_REQUERIDO');
    }
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    expect(
      await contarFilas(`SELECT 1 FROM comprobante WHERE reemplaza_a_id = $1`, [o.comprobanteId]),
    ).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 157 · el ticket de la nota', () => {
  let impresora: ImpresoraDePrueba;
  let preparada: Promise<void> | undefined;
  const preparar = () =>
    (preparada ??= (async () => {
      await prepararNotas(ctx, esc);
      const caja1 = (await A().cajas()).S3!.caja1;
      impresora = await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S3, 'Caja de S3', {
        cajaId: caja1,
      });
      const puente = await vincularPuente(ctx, cierres, A().token.admin!, A().S3);
      await puente.iniciar();
      // La apertura del turno (fondo mayor que 0.00) manda su propio pulso: se espera antes de contar nada.
      await turnoAbiertoDe(ctx, A().token.cajeroS3!, caja1);
      await esperarHasta(
        () => pulsosRecibidos(impresora.emulador) >= 1,
        8_000,
        'el pulso del fondo',
      );
    })());

  /** Una boleta cobrada en S3 con su ticket ya impreso; deja el emulador limpio. */
  async function cobroEnS3() {
    await preparar();
    impresora.emulador.limpiar();
    const o = await emitirAceptado(ctx, A(), { sucursal: 'S3', caja: 'caja1', quien: 'cajeroS3' });
    await impresora.emulador.esperarTickets(1, 8_000);
    impresora.emulador.limpiar();
    return o;
  }

  it('imprime "NOTA DE CRÉDITO ELECTRÓNICA" con el documento que modifica, el motivo, "SON:" y el QR del tipo 07; con efectivo abre la gaveta, con Yape no', async () => {
    const o = await cobroEnS3();
    const lomo = lineaDe(o.cobro.comprobante, /Lomo/).posicion as number;
    const emulador = impresora.emulador;

    const conEfectivo = await emitirNota(ctx, A().token.supervisorS3!, {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      motivo: 'Lomo frío devuelto',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    expect(conEfectivo.impresion).toBe('EN_COLA');
    expect(conEfectivo.trabajoIds).toHaveLength(1);
    const nota = conEfectivo.nota as Libre;
    const [ticket] = await emulador.esperarTickets(1, 8_000);
    expect(ticket!.texto).toMatch(/NOTA DE CR.DITO ELECTR.NICA/);
    expect(ticket!.texto).toContain(nota.numero as string);
    expect(ticket!.texto).toContain(`Modifica: BOLETA ${o.numero}`);
    expect(ticket!.texto).toContain('Lomo fr');
    expect(ticket!.texto).toMatch(/SON: .*VEINTIOCHO CON 00\/100 SOLES/);
    expect(ticket!.qrs).toHaveLength(1);
    expect(ticket!.qrs[0]).toContain(`|07|${nota.serie as string}|`);
    expect(ticket!.pulsosGaveta).toBe(1);

    emulador.limpiar();
    const conYape = await emitirNota(ctx, A().token.supervisorS3!, {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [yape('28.00', 'OP-NC-1')], redondeo: '0.00' },
    });
    expect(conYape.impresion).toBe('EN_COLA');
    const [sin] = await emulador.esperarTickets(1, 8_000);
    expect(sin!.pulsosGaveta).toBe(0);
    expect(pulsosRecibidos(emulador)).toBe(0);
  });

  it('una anulación sin devolución también imprime su ticket (sin gaveta) y deja un solo trabajo COMPROBANTE', async () => {
    const o = await cobroEnS3();
    const res = await emitirNota(ctx, A().token.supervisorS3!, {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const [ticket] = await impresora.emulador.esperarTickets(1, 8_000);
    expect(ticket!.texto).toMatch(/NOTA DE CR.DITO ELECTR.NICA/);
    expect(ticket!.pulsosGaveta).toBe(0);
    const trabajos = await trabajosDeComprobante((res.nota as Libre).id as string);
    expect(trabajos.filter((t) => t.tipo === 'COMPROBANTE')).toHaveLength(1);
    expect(res.trabajoIds).toEqual(trabajos.map((t) => t.id));
  });
});

// ------------------------------------------------------------------------------------------------
async function emitirAceptadoDeB(): Promise<string> {
  const cajas = await B().cajas();
  const token = B().token.cajero!;
  const turnoId = await turnoAbiertoDe(ctx, token, cajas.S1!.caja1);
  const cuenta = await cuentaC(ctx, B());
  const cobro = await cobrar(ctx, token, cuenta, { turnoId, total: '69.20' });
  const id = (cobro.comprobante as Libre).id as string;
  await aceptar(ctx, B(), id);
  return id;
}
