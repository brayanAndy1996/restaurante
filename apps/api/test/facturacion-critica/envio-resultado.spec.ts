// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Qué se guarda de la respuesta, una sola vez (ruta crítica), criterio 131:
// - en el comprobante solo las columnas del criterio 127, con los largos recortados (`sunat_mensaje` hasta 500
//   caracteres, hasta 20 observaciones de hasta 500, `hash` y `referencia_pse` hasta 200);
// - el XML y el CDR van al almacén privado, con las claves `comprobantes/<empresaId>/<comprobanteId>/documento.xml` y
//   `…/cdr.zip` (o `.xml`), y no al de las fotos;
// - en `intento_pse` van la operación, la hora de inicio y fin, el resultado, el código y el mensaje recortado a 500
//   caracteres, nunca el documento enviado ni el cuerpo de la respuesta ni la credencial; los registros del worker no
//   llevan nombres ni documentos de clientes;
// - una segunda respuesta del mismo comprobante (un trabajo repetido) no escribe nada: ni columnas, ni archivos, ni
//   intentos.
// Hoy falla porque `envio_pse`, `intento_pse` y las columnas de 6b no existen y el procesador responde «No implementado».
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrancarFact,
  capturarRegistros,
  cerrarAdmin,
  cobrarFactura,
  cobrarLomo,
  CLIENTE_RUC,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  filas,
  intentosDe,
  limitarBarrido,
  procesar,
  turnoDe,
  type AppFact,
  type Cobrado,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;
let restaurarBarrido: () => void;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(() => {
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

async function nuevoCobro(factura = false): Promise<Cobrado> {
  const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
  return factura ? cobrarFactura(ctx, A(), { turnoId }) : cobrarLomo(ctx, A(), { turnoId });
}

describe('criterio 131 · largos recortados', () => {
  it('un ACEPTADO con respuestas enormes se guarda recortado: mensaje 500, 20 observaciones de 500, hash y referencia 200', async () => {
    const c = await nuevoCobro();
    const observaciones = Array.from({ length: 25 }, (_, i) => ({
      codigo: `4${String(i).padStart(3, '0')}`,
      mensaje: `${'o'.repeat(800)}`,
    }));
    const espia = vi.spyOn(ctx.pse, 'emitir').mockResolvedValueOnce({
      tipo: 'ACEPTADO',
      codigoSunat: '0',
      mensaje: 'm'.repeat(900),
      observaciones,
      hash: 'h'.repeat(400),
      xml: Buffer.from('<xml>SIMULADO</xml>'),
      cdr: Buffer.from('PK-SIMULADO'),
      referenciaPse: 'r'.repeat(400),
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(String(fila.sunat_mensaje).length).toBeLessThanOrEqual(500);
    expect(String(fila.sunat_mensaje).startsWith('mmmm')).toBe(true);
    const guardadas = fila.sunat_observaciones as Array<{ codigo: string; mensaje: string }>;
    expect(guardadas.length).toBeLessThanOrEqual(20);
    expect(guardadas.length).toBeGreaterThan(0);
    for (const o of guardadas) {
      expect(o.mensaje.length).toBeLessThanOrEqual(500);
      expect(o.mensaje.startsWith('oooo')).toBe(true);
    }
    expect(String(fila.hash).length).toBeLessThanOrEqual(200);
    expect(String(fila.hash).startsWith('hhhh')).toBe(true);
    expect(String(fila.referencia_pse).length).toBeLessThanOrEqual(200);
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos).toHaveLength(1);
    expect(String(intentos[0]!.mensaje ?? '').length).toBeLessThanOrEqual(500);
  });

  it('un RECHAZADO con código y mensaje enormes se guarda recortado (50 y 500) en el comprobante y en el intento', async () => {
    const c = await nuevoCobro();
    const espia = vi.spyOn(ctx.pse, 'emitir').mockResolvedValueOnce({
      tipo: 'RECHAZADO',
      origen: 'SUNAT',
      codigo: 'c'.repeat(120),
      mensaje: 'm'.repeat(2000),
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('RECHAZADO');
    expect(String(fila.sunat_codigo).length).toBeLessThanOrEqual(50);
    expect(String(fila.sunat_mensaje).length).toBeLessThanOrEqual(500);
    const [intento] = await intentosDe(c.comprobanteId);
    expect(String(intento!.codigo).length).toBeLessThanOrEqual(50);
    expect(String(intento!.mensaje).length).toBeLessThanOrEqual(500);
  });

  it('un error de transporte con un detalle enorme deja ultimo_error recortado a 500', async () => {
    const c = await nuevoCobro();
    const espia = vi
      .spyOn(ctx.pse, 'emitir')
      .mockResolvedValueOnce({ tipo: 'ERROR_TRANSPORTE', detalle: 'd'.repeat(3000) });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio.ultimo_resultado).toBe('ERROR_TRANSPORTE');
    expect(String(envio.ultimo_error).length).toBeGreaterThan(0);
    expect(String(envio.ultimo_error).length).toBeLessThanOrEqual(500);
    const [intento] = await intentosDe(c.comprobanteId);
    expect(String(intento!.mensaje ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('criterio 131 · el XML y el CDR en el almacén privado', () => {
  it('con XML y CDR guarda ambos bajo comprobantes/<empresaId>/<comprobanteId>/ y no en el almacén de las fotos', async () => {
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const base = `comprobantes/${A().id}/${c.comprobanteId}/`;
    const claves = ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId));
    expect(claves).toHaveLength(2);
    expect(claves.every((k) => k.startsWith(base))).toBe(true);
    expect(claves.some((k) => k === `${base}documento.xml`)).toBe(true);
    expect(claves.some((k) => /\/cdr\.(zip|xml)$/.test(k))).toBe(true);
    const fila = await comprobanteFila(c.comprobanteId);
    expect(claves).toContain(fila.xml_clave);
    expect(claves).toContain(fila.cdr_clave);
    // Ningún archivo de comprobante cae en el almacén (público) de las fotos.
    expect(ctx.almacen.claves().filter((k) => k.includes(c.comprobanteId))).toEqual([]);
    expect(ctx.almacen.claves().filter((k) => k.startsWith('comprobantes/'))).toEqual([]);
  });

  it('sin CDR (el PSE solo entrega el XML) guarda solo el XML y deja cdr_clave nulo', async () => {
    const c = await nuevoCobro();
    const espia = vi.spyOn(ctx.pse, 'emitir').mockResolvedValueOnce({
      tipo: 'ACEPTADO',
      codigoSunat: '0',
      mensaje: 'Aceptado',
      observaciones: [],
      hash: 'abc',
      xml: Buffer.from('<xml>SIMULADO</xml>'),
      cdr: null,
      referenciaPse: null,
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.xml_clave).toBe(`comprobantes/${A().id}/${c.comprobanteId}/documento.xml`);
    expect(fila.cdr_clave).toBeNull();
    expect(fila.referencia_pse).toBeNull();
    expect(ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId))).toEqual([
      fila.xml_clave,
    ]);
  });

  it('sin XML ni CDR no guarda ningún archivo', async () => {
    const c = await nuevoCobro();
    const espia = vi.spyOn(ctx.pse, 'emitir').mockResolvedValueOnce({
      tipo: 'ACEPTADO',
      codigoSunat: '0',
      mensaje: 'Aceptado',
      observaciones: [],
      hash: null,
      xml: null,
      cdr: null,
      referenciaPse: null,
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.xml_clave).toBeNull();
    expect(fila.cdr_clave).toBeNull();
    expect(fila.hash).toBeNull();
    expect(ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId))).toEqual([]);
  });
});

describe('criterio 131 · intento_pse no guarda el documento ni datos de clientes', () => {
  it('las columnas de intento_pse son exactamente las del modelo de datos', async () => {
    const columnas = (
      await filas(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intento_pse'`,
      )
    )
      .map((f) => f.column_name as string)
      .filter((n) => !/^(creado|actualizado)_por_/.test(n))
      .sort();
    expect(columnas).toEqual(
      [
        'id',
        'empresa_id',
        'creado_en',
        'actualizado_en',
        'envio_id',
        'comprobante_id',
        'numero',
        'operacion',
        'iniciado_en',
        'terminado_en',
        'resultado',
        'codigo',
        'mensaje',
      ].sort(),
    );
  });

  it('una factura con cliente rechazada y reintentada no deja nombres, documentos ni líneas en intento_pse ni en los registros', async () => {
    const registros = capturarRegistros();
    try {
      const c = await nuevoCobro(true);
      ctx.pse.reglas.fallarTransmision(1);
      await procesar(ctx, A().id, c.comprobanteId); // error de transporte
      ctx.reloj.avanzar(60_000);
      ctx.pse.reglas.rechazarRucDeCliente(CLIENTE_RUC.numero, {
        codigo: '2800',
        mensaje: 'El RUC del cliente no existe',
      });
      await procesar(ctx, A().id, c.comprobanteId); // rechazada
      expect((await comprobanteFila(c.comprobanteId)).estado).toBe('RECHAZADO');

      const intentos = await filas(
        'SELECT to_jsonb(i)::text AS t FROM intento_pse i WHERE comprobante_id = $1',
        [c.comprobanteId],
      );
      expect(intentos.length).toBeGreaterThanOrEqual(2);
      const prohibidos = [
        CLIENTE_RUC.nombre,
        CLIENTE_RUC.numero,
        CLIENTE_RUC.direccion,
        'Lomo saltado',
      ];
      const texto = intentos.map((f) => f.t as string).join('\n');
      const registrado = registros.texto();
      for (const dato of prohibidos) {
        expect(texto, `intento_pse no lleva «${dato}»`).not.toContain(dato);
        expect(registrado, `los registros no llevan «${dato}»`).not.toContain(dato);
      }
      // Tampoco el nombre del emisor ni de la sucursal.
      const fila = await comprobanteFila(c.comprobanteId);
      const emisor = fila.emisor as { ruc: string; razonSocial: string };
      expect(registrado).not.toContain(emisor.razonSocial);
      expect(texto).not.toContain(emisor.razonSocial);
    } finally {
      registros.restaurar();
    }
  });
});

describe('criterio 131 · una segunda respuesta del mismo comprobante no escribe nada', () => {
  async function instantanea(c: Cobrado): Promise<Libre> {
    return {
      comprobante: await comprobanteFila(c.comprobanteId),
      envio: await envioDe(c.comprobanteId),
      intentos: await intentosDe(c.comprobanteId),
      lineas: await filas(
        'SELECT * FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion',
        [c.comprobanteId],
      ),
      archivos: ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId)),
    };
  }

  it('un trabajo repetido de un ACEPTADO no cambia ni columnas ni archivos ni intentos (aunque el reloj avance)', async () => {
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const antes = await instantanea(c);
    const escrituras = ctx.almacenC.totalDeEscrituras();
    ctx.reloj.avanzar(15 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(await instantanea(c)).toEqual(antes);
    expect(ctx.almacenC.totalDeEscrituras()).toBe(escrituras);
  });

  it('un trabajo repetido de un RECHAZADO tampoco', async () => {
    const c = await nuevoCobro();
    ctx.pse.reglas.rechazarNumero((c.respuesta.comprobante as { numero: string }).numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, A().id, c.comprobanteId);
    const antes = await instantanea(c);
    const escrituras = ctx.almacenC.totalDeEscrituras();
    ctx.reloj.avanzar(15 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(await instantanea(c)).toEqual(antes);
    expect(ctx.almacenC.totalDeEscrituras()).toBe(escrituras);
  });
});
