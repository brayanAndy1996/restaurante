// spec: 006-caja-cobro (criterio 159; el PDF en el worker y en el barrido, prueba del desarrollador)
//
// El worker arma el PDF al dejar `ACEPTADO` el comprobante; si falla, el estado se guarda igual y el barrido lo vuelve a
// armar; repetir un trabajo no reescribe nada; un comprobante de otra empresa no se toca; el texto del PDF guardado es el
// del comprobante (con la marca de simulado, porque el escenario usa el modo SIMULADO).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchivadorDePdf } from '../../src/modulos/facturacion';
import { PdfComprobantes } from '../../src/modulos/facturacion/pdf/pdf-comprobantes';
import {
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  exigirPse,
  limitarBarrido,
  procesar,
  turnoDe,
  type AppFact,
  type Cobrado,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';
import { textoDelPdf } from './texto-de-pdf';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurarBarrido: () => void;
const A = () => esc.A;
const B = () => esc.B;

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
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const claveDelPdf = (empresaId: string, c: Cobrado) =>
  `comprobantes/${empresaId}/${c.comprobanteId}/representacion.pdf`;

async function cobrar(e = A()): Promise<Cobrado> {
  return cobrarLomo(ctx, e, { turnoId: await turnoDe(ctx, e, 'cajero', 'S1', 'caja1') });
}

describe('criterio 159 · el PDF en el worker', () => {
  it('al aceptarse guarda el PDF con el texto del comprobante, la marca de simulado y su clave en el comprobante', async () => {
    const c = await cobrar();
    expect((await comprobanteFila(c.comprobanteId)).pdf_clave).toBeNull();
    await procesar(ctx, A().id, c.comprobanteId);
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.pdf_clave).toBe(claveDelPdf(A().id, c));
    const pdf = ctx.almacenC.obtener(fila.pdf_clave as string)!;
    expect(pdf.tipo).toBe('application/pdf');
    const texto = textoDelPdf(pdf.contenido);
    const numero = (c.respuesta.comprobante as { numero: string }).numero;
    expect(texto).toContain(numero);
    expect(texto).toContain('Lomo saltado');
    expect(texto).toContain('SON: ');
    expect(texto.split('SIMULADO · SIN VALOR TRIBUTARIO').length - 1).toBe(2);
    // El simulador no tiene dirección de consulta.
    expect(texto).not.toContain('Consulte');
    // El hash que dio el PSE sale en el PDF.
    expect(texto).toContain(fila.hash as string);
  });

  it('un rechazado o un envío que sigue pendiente no tiene PDF', async () => {
    const c = await cobrar();
    ctx.pse.reglas.rechazarNumero((c.respuesta.comprobante as { numero: string }).numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, A().id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('RECHAZADO');
    expect((await comprobanteFila(c.comprobanteId)).pdf_clave).toBeNull();
    expect(ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId))).toEqual([]);
  });

  it('si el PDF falla, el ACEPTADO queda guardado y el siguiente barrido lo arma (pdfPendientes)', async () => {
    const c = await cobrar();
    const armar = vi.spyOn(ctx.app.get(PdfComprobantes), 'armar');
    armar.mockRejectedValueOnce(new Error('falla de prueba'));
    await procesar(ctx, A().id, c.comprobanteId);
    let fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.pdf_clave).toBeNull();
    expect(ctx.almacenC.claves()).not.toContain(claveDelPdf(A().id, c));

    const vuelta = await ctx.barrido.barrerAhora();
    expect(vuelta.pdfPendientes).toBeGreaterThanOrEqual(1);
    fila = await comprobanteFila(c.comprobanteId);
    expect(fila.pdf_clave).toBe(claveDelPdf(A().id, c));
    expect(ctx.almacenC.claves()).toContain(claveDelPdf(A().id, c));
    // Otra vuelta no vuelve a armarlo.
    armar.mockClear();
    await ctx.barrido.barrerAhora();
    expect(armar).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: c.comprobanteId }),
      expect.anything(),
    );
  });

  it('si el almacén falla al guardar el PDF, no se anota la clave y el barrido lo reintenta', async () => {
    const c = await cobrar();
    const guardar = vi.spyOn(ctx.almacenC, 'guardar');
    guardar.mockImplementation(async (clave, contenido, tipo) => {
      if (clave.endsWith('representacion.pdf')) throw new Error('almacén caído');
      // Los demás archivos (XML y CDR) se guardan normalmente.
      await Object.getPrototypeOf(ctx.almacenC).guardar.call(ctx.almacenC, clave, contenido, tipo);
    });
    await procesar(ctx, A().id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await comprobanteFila(c.comprobanteId)).pdf_clave).toBeNull();
    guardar.mockRestore();
    await ctx.barrido.barrerAhora();
    expect((await comprobanteFila(c.comprobanteId)).pdf_clave).toBe(claveDelPdf(A().id, c));
  });

  it('repetir el trabajo de un comprobante terminado no arma ni escribe otro PDF', async () => {
    const c = await cobrar();
    await procesar(ctx, A().id, c.comprobanteId);
    const antes = ctx.almacenC.obtener(claveDelPdf(A().id, c))!.contenido;
    const armar = vi.spyOn(ctx.app.get(PdfComprobantes), 'armar');
    await procesar(ctx, A().id, c.comprobanteId);
    const archivador = ctx.app.get(ArchivadorDePdf);
    expect(await archivador.generar(A().id, c.comprobanteId)).toBe(false);
    expect(armar).not.toHaveBeenCalled();
    expect(ctx.almacenC.obtener(claveDelPdf(A().id, c))!.contenido.equals(antes)).toBe(true);
  });

  it('un trabajo con el comprobante de B desde A no arma ni guarda nada (la RLS lo oculta)', async () => {
    const deB = await cobrar(B());
    ctx.pse.reglas.limpiar();
    const archivador = ctx.app.get(ArchivadorDePdf);
    expect(await archivador.generar(A().id, deB.comprobanteId)).toBe(false);
    expect(await archivador.generar(randomUUID(), deB.comprobanteId)).toBe(false);
    expect(await archivador.generar('no-es-uuid', deB.comprobanteId)).toBe(false);
    expect(ctx.almacenC.claves().filter((k) => k.includes(deB.comprobanteId))).toEqual([]);
    expect((await comprobanteFila(deB.comprobanteId)).pdf_clave).toBeNull();
    // En B sí se arma: el PDF queda bajo la empresa de B.
    await procesar(ctx, B().id, deB.comprobanteId);
    expect((await comprobanteFila(deB.comprobanteId)).pdf_clave).toBe(claveDelPdf(B().id, deB));
  });
});
