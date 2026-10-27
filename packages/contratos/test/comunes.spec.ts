import { describe, expect, it } from 'vitest';
import {
  codigoEstablecimientoSchema,
  horaSchema,
  horarioSchema,
  regimenTributarioSchema,
  rucSchema,
  textoSchema,
  uuidSchema,
  whatsappSchema,
} from '../src';
import { CODIGOS_ERROR } from '../src';

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

describe('textoSchema (criterio 40b)', () => {
  const nombre = textoSchema(10);

  it('recorta los extremos y acepta un texto normal', () => {
    expect(nombre.parse('  Hola  ')).toBe('Hola');
  });

  it('rechaza el carácter NUL en cualquier posición, sin alterar el texto', () => {
    for (const texto of ['a\u0000b', '\u0000', 'a\u0000', '\u0000a', ' \u0000 ']) {
      const resultado = nombre.safeParse(texto);
      expect(resultado.success, JSON.stringify(texto)).toBe(false);
    }
  });

  it('sigue rechazando vacío y demasiado largo', () => {
    expect(nombre.safeParse('   ').success).toBe(false);
    expect(nombre.safeParse('x'.repeat(11)).success).toBe(false);
  });

  it('acepta otros caracteres de control y Unicode (solo el NUL es dato mal formado)', () => {
    expect(nombre.safeParse('Ñandú\tá').success).toBe(true);
  });
});

describe('textoSchema (criterio 40c)', () => {
  const texto = textoSchema(20);

  it('rechaza un sustituto alto o bajo suelto en cualquier posición', () => {
    for (const malo of [
      '\ud800',
      '\udc00',
      'a\ud800b',
      'a\udc00b',
      'ab\ud800',
      '\udfffab',
      '\ude00\ud83d',
      '\ud800A',
      '\ud83d\ud83d\ude00',
    ]) {
      const resultado = texto.safeParse(malo);
      expect(resultado.success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('acepta un par de sustitutos válido (emoji) tal cual', () => {
    expect(texto.parse('Pizza \u{1F355}')).toBe('Pizza \u{1F355}');
    expect(texto.parse('\ud83d\ude00')).toBe('\u{1F600}');
    expect(texto.parse('\u{1F355}\u{1F355}')).toBe('\u{1F355}\u{1F355}');
  });
});

describe('CODIGOS_ERROR', () => {
  it('incluye CUERPO_DEMASIADO_GRANDE', () => {
    expect(CODIGOS_ERROR).toContain('CUERPO_DEMASIADO_GRANDE');
  });

  it('incluye los códigos de los errores 4xx genéricos (criterio 40d)', () => {
    for (const codigo of [
      'NO_AUTENTICADO',
      'PROHIBIDO',
      'METODO_NO_PERMITIDO',
      'TIPO_NO_SOPORTADO',
      'DEMASIADAS_PETICIONES',
      'PETICION_INVALIDA',
    ]) {
      expect(CODIGOS_ERROR).toContain(codigo);
    }
  });
});
