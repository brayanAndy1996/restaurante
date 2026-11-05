import type { CuentaRespuesta } from '@restaurante/contratos';

type DetalleDeParte = CuentaRespuesta['cobros'][number]['detalleParte'];

/**
 * El `detalleParte` de un cobro de los ejemplos: una parte cobrada de `total` soles con IGV incluido, vista por consumo
 * (una línea gravada sin ítem). La pantalla todavía no lo usa para decidir nada; solo hace falta que sea válido.
 */
export function detalleDeParte(
  total: string,
  tipo: DetalleDeParte['tipo'] = 'TOTAL',
  cierraLaCuenta = false,
): DetalleDeParte {
  const [enteros = '0', decimales = '00'] = total.split('.');
  const centimos = BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0'));
  const base = (centimos * 100n + 59n) / 118n;
  const monto = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
  return {
    tipo,
    formato: 'CONSUMO',
    lineas: [
      {
        itemId: null,
        cantidad: 1,
        afectacion: 'GRAVADO',
        bruto: total,
        descuento: '0.00',
        neto: total,
        base: monto(base),
        igv: monto(centimos - base),
        bolsas: 0,
        icbper: '0.00',
        gratuita: null,
      },
    ],
    porItem: [],
    totales: {
      subtotal: total,
      descuentos: '0.00',
      operaciones: {
        gravadas: monto(base),
        exoneradas: '0.00',
        inafectas: '0.00',
        gratuitas: '0.00',
      },
      igv: monto(centimos - base),
      igvGratuitas: '0.00',
      icbper: '0.00',
      total,
    },
    cierraLaCuenta,
  };
}
