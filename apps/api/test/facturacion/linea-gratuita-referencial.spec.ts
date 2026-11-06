// Pruebas del desarrollador (6b, T41b): las líneas gratuitas de `comprobanteRespuesta` traen su base e IGV referenciales,
// leídos de lo guardado en `comprobante_linea` (criterios 69 y 147), para que la PWA no los derive al calcular la nota.
import { comprobanteRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cerrarAdmin,
  cobrar,
  crearEscenario,
  cuentaC,
  escribir,
  exigir,
  filas,
  type Escenario,
  type Libre,
} from '../caja-critica/fabrica-caja';
import {
  aceptar,
  arrancarNotas,
  comprobanteDe,
  efectivo,
  emitirNota,
  prepararNotas,
  turnoAbiertoDe,
  type AppNotas,
} from '../facturacion-critica/fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
  await prepararNotas(ctx, esc);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

/** Cobra la cuenta C con la Gaseosa (S/ 9.00) de cortesía: total S/ 60.20, base referencial 7.63 e IGV 1.37. */
async function comprobanteConCortesia(): Promise<{ id: string; turnoId: string }> {
  const cajero = esc.A.token.cajero!;
  const cuenta = await cuentaC(ctx, esc.A);
  exigir(
    await escribir(ctx, esc.A.token.supervisor!, 'post', `/cuentas/${cuenta.ordenId}/cortesias`, {
      id: randomUUID(),
      itemId: cuenta.item.gaseosa!,
      cantidad: 1,
      motivo: 'Atención de la casa',
    }),
    201,
    'Cortesía (criterio 43)',
  );
  const cajaId = (await esc.A.cajas()).S1!.caja1;
  const turnoId = await turnoAbiertoDe(ctx, cajero, cajaId);
  const cobro = await cobrar(ctx, cajero, cuenta, {
    turnoId,
    total: '60.20',
    tipo: 'BOLETA',
    pagos: [efectivo('60.20')],
  });
  const id = (cobro.comprobante as Libre).id as string;
  await aceptar(ctx, esc.A, id);
  return { id, turnoId };
}

describe('la línea gratuita expone su base e IGV referenciales (criterio 147)', () => {
  it('GET /comprobantes/:id los trae de lo guardado y las demás líneas llevan null', async () => {
    const { id } = await comprobanteConCortesia();
    const leido = await comprobanteDe(ctx, esc.A.token.cajero!, id);
    expect(comprobanteRespuestaSchema.safeParse(leido).success).toBe(true);

    const guardadas = await filas(
      `SELECT posicion, valor_referencial::text AS valor, base_referencial::text AS base,
              igv_referencial::text AS igv
         FROM comprobante_linea WHERE comprobante_id = $1 AND gratuita`,
      [id],
    );
    expect(guardadas).toHaveLength(1);
    const gratuita = (leido.lineas as Libre[]).filter((l) => l.gratuita);
    expect(gratuita).toHaveLength(1);
    expect(gratuita[0]).toMatchObject({
      posicion: guardadas[0]!.posicion,
      valorReferencial: '9.00',
      baseReferencial: guardadas[0]!.base,
      igvReferencial: guardadas[0]!.igv,
    });
    expect(gratuita[0]).toMatchObject({ baseReferencial: '7.63', igvReferencial: '1.37' });
    for (const l of (leido.lineas as Libre[]).filter((x) => !x.gratuita)) {
      expect(l.valorReferencial).toBeNull();
      expect(l.baseReferencial).toBeNull();
      expect(l.igvReferencial).toBeNull();
    }
  });

  it('la nota de anulación conserva los valores referenciales', async () => {
    const { id } = await comprobanteConCortesia();
    const original = await comprobanteDe(ctx, esc.A.token.cajero!, id);
    const nota = (
      await emitirNota(ctx, esc.A.token.supervisor!, {
        comprobanteId: id,
        tipo: 'ANULACION',
        total: '60.20',
      })
    ).nota as Libre;
    const deLaNota = await comprobanteDe(ctx, esc.A.token.supervisor!, nota.id);
    const referenciales = (c: Libre) =>
      (c.lineas as Libre[])
        .filter((l) => l.gratuita)
        .map(({ valorReferencial, baseReferencial, igvReferencial }) => ({
          valorReferencial,
          baseReferencial,
          igvReferencial,
        }));
    expect(referenciales(deLaNota)).toEqual(referenciales(original));
    expect(referenciales(original)).toEqual([
      { valorReferencial: '9.00', baseReferencial: '7.63', igvReferencial: '1.37' },
    ]);
  });
});
