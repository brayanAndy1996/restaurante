// Historia 006, ronda 2 del ataque (criterios 52 y 90): `cuentaSinNadaQueFaltar` es la misma definición de "no falta
// nada" que `cierraLaCuenta` de una parte, aplicada a la cuenta que queda tras una anulación o un envío.
import { describe, expect, it } from 'vitest';
import {
  calcularParte,
  cuentaSinNadaQueFaltar,
  type CuentaEntrada,
  type ParteCalculada,
} from '../../src';
import {
  ID,
  cuentaC,
  lineaBolsa,
  lineaGaseosa,
  lineaLomo,
  lineaMandarina,
  tomar,
} from '../caja/ayudas';

const dosLomosCobrados = (): ParteCalculada =>
  tomar(
    calcularParte(
      cuentaC(),
      [],
      { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 2 }] },
      'DETALLADO',
    ),
  );

describe('cuentaSinNadaQueFaltar · criterios 52 y 90', () => {
  it('sin partes anteriores nunca cierra la cuenta', () => {
    expect(cuentaSinNadaQueFaltar(cuentaC({ lineas: [] }), [])).toBe(false);
  });

  it('2 Lomos cobrados y anulado todo lo demás: no falta nada', () => {
    const nueva: CuentaEntrada = cuentaC({ lineas: [lineaLomo()] });
    expect(cuentaSinNadaQueFaltar(nueva, [dosLomosCobrados()])).toBe(true);
  });

  it('con una Gaseosa por cobrar todavía falta', () => {
    const nueva = cuentaC({ lineas: [lineaLomo(), lineaGaseosa()] });
    expect(cuentaSinNadaQueFaltar(nueva, [dosLomosCobrados()])).toBe(false);
  });

  it('con las bolsas y la mandarina (cortesía) por cobrar todavía falta', () => {
    const nueva = cuentaC({ lineas: [lineaLomo(), lineaBolsa(), lineaMandarina()] });
    expect(cuentaSinNadaQueFaltar(nueva, [dosLomosCobrados()])).toBe(false);
  });

  it('una cuenta que no cuadra con lo cobrado (anular un Lomo cobrado) no se da por cerrada', () => {
    const nueva = cuentaC({ lineas: [lineaLomo({ cantidad: 1 })] });
    expect(cuentaSinNadaQueFaltar(nueva, [dosLomosCobrados()])).toBe(false);
  });
});
