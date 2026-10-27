import { describe, expect, it } from 'vitest';
import {
  codigoEstablecimientoSchema,
  horaSchema,
  horarioSchema,
  regimenTributarioSchema,
  rucSchema,
  uuidSchema,
  whatsappSchema,
} from '../src';

describe('esquemas comunes', () => {
  it('horaSchema acepta de 00:00 a 23:59', () => {
    expect(horaSchema.safeParse('00:00').success).toBe(true);
    expect(horaSchema.safeParse('23:59').success).toBe(true);
    for (const mala of ['24:00', '5:00', '12:60', '12', '', 'ab:cd']) {
      expect(horaSchema.safeParse(mala).success, mala).toBe(false);
    }
  });

  it('whatsappSchema acepta solo celulares peruanos en E.164', () => {
    expect(whatsappSchema.safeParse('+51987654321').success).toBe(true);
    for (const malo of [
      '987654321',
      '+51887654321',
      '+5198765432',
      '+519876543210',
      '+51 987654321',
    ]) {
      expect(whatsappSchema.safeParse(malo).success, malo).toBe(false);
    }
  });

  it('rucSchema usa validarRuc', () => {
    expect(rucSchema.safeParse('20100000009').success).toBe(true);
    expect(rucSchema.safeParse('20100000000').success).toBe(false);
  });

  it('codigoEstablecimientoSchema exige 4 dígitos', () => {
    expect(codigoEstablecimientoSchema.safeParse('0001').success).toBe(true);
    for (const malo of ['001', '00001', 'abcd', '']) {
      expect(codigoEstablecimientoSchema.safeParse(malo).success, malo).toBe(false);
    }
  });

  it('regimenTributarioSchema acepta los cuatro regímenes', () => {
    for (const r of ['NUEVO_RUS', 'RER', 'MYPE_TRIBUTARIO', 'GENERAL']) {
      expect(regimenTributarioSchema.safeParse(r).success).toBe(true);
    }
    expect(regimenTributarioSchema.safeParse('OTRO').success).toBe(false);
  });

  it('uuidSchema acepta cualquier UUID con forma válida', () => {
    expect(uuidSchema.safeParse('11111111-1111-1111-1111-111111111111').success).toBe(true);
    expect(uuidSchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(uuidSchema.safeParse('no-es-uuid').success).toBe(false);
  });

  it('horarioSchema acepta lista vacía y tramos que cruzan la medianoche', () => {
    expect(horarioSchema.safeParse([]).success).toBe(true);
    expect(horarioSchema.safeParse([{ dia: 5, desde: '18:00', hasta: '02:00' }]).success).toBe(
      true,
    );
  });

  it('horarioSchema rechaza solapados, desde igual a hasta y días fuera de rango', () => {
    const solapados = horarioSchema.safeParse([
      { dia: 1, desde: '10:00', hasta: '15:00' },
      { dia: 1, desde: '14:00', hasta: '18:00' },
    ]);
    expect(solapados.success).toBe(false);
    expect(horarioSchema.safeParse([{ dia: 1, desde: '10:00', hasta: '10:00' }]).success).toBe(
      false,
    );
    expect(horarioSchema.safeParse([{ dia: 8, desde: '10:00', hasta: '12:00' }]).success).toBe(
      false,
    );
  });
});
