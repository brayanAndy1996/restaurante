// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P11 · `dentroDeHorario(horario, instante)` (criterio 105): hora de Lima (UTC-5, sin horario de
// verano), intervalo [desde, hasta), tramos que cruzan la medianoche (el domingo sigue el lunes) y sin
// depender de la zona horaria del proceso.
import { afterEach, describe, expect, it } from 'vitest';
import { dentroDeHorario, type TramoHorario } from '../src';

const ZONAS_DEL_PROCESO = [
  'America/Lima',
  'UTC',
  'Asia/Tokyo',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
];

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

/** Ejecuta `fn` con la zona horaria del proceso cambiada, comprobando que el cambio hizo efecto. */
function conZona(zona: string, fn: () => void): void {
  process.env.TZ = zona;
  const desfase = new Date('2026-10-30T12:00:00Z').getTimezoneOffset();
  const esperado: Record<string, number> = {
    'America/Lima': 300,
    UTC: 0,
    'Asia/Tokyo': -540,
    'America/Los_Angeles': 420, // PDT hasta el 1 de noviembre
    'Europe/Madrid': -60, // CET desde el 25 de octubre
    'Pacific/Kiritimati': -840,
    'Pacific/Pago_Pago': 660,
  };
  expect(desfase, `la zona ${zona} no se aplicó al proceso`).toBe(esperado[zona]);
  fn();
}

const viernes: TramoHorario[] = [{ dia: 5, desde: '18:00', hasta: '02:00' }];
const domingo: TramoHorario[] = [{ dia: 7, desde: '22:00', hasta: '06:00' }];

describe.each(ZONAS_DEL_PROCESO)('dentroDeHorario · con la zona del proceso %s', (zona) => {
  it('sin horario (null) siempre es true', () => {
    conZona(zona, () => {
      for (const iso of [
        '2026-10-30T18:00:00-05:00',
        '2026-11-02T03:00:00-05:00',
        '2026-01-01T00:00:00Z',
        '2026-12-31T23:59:59.999Z',
      ]) {
        expect(dentroDeHorario(null, new Date(iso)), iso).toBe(true);
      }
    });
  });

  it('tramo de viernes 18:00 a 02:00: ejemplos del criterio 105', () => {
    conZona(zona, () => {
      const casos: [string, boolean][] = [
        ['2026-10-30T18:00-05:00', true],
        ['2026-10-30T17:59-05:00', false],
        ['2026-10-31T01:59-05:00', true],
        ['2026-10-31T02:00-05:00', false],
        ['2026-10-31T06:59Z', true],
        ['2026-10-31T07:00Z', false],
      ];
      for (const [iso, esperado] of casos) {
        expect(dentroDeHorario(viernes, new Date(iso)), iso).toBe(esperado);
      }
    });
  });

  it('tramo de domingo 22:00 a 06:00 sigue el lunes: 2026-11-02T05:59-05:00 es true', () => {
    conZona(zona, () => {
      const casos: [string, boolean][] = [
        ['2026-11-01T21:59-05:00', false],
        ['2026-11-01T22:00-05:00', true],
        ['2026-11-01T23:59-05:00', true],
        ['2026-11-02T00:00-05:00', true],
        ['2026-11-02T05:59-05:00', true],
        ['2026-11-02T06:00-05:00', false],
        ['2026-11-02T10:00-05:00', false],
      ];
      for (const [iso, esperado] of casos) {
        expect(dentroDeHorario(domingo, new Date(iso)), iso).toBe(esperado);
      }
    });
  });

  it('el día se mide en Lima, no en UTC: la noche de Lima ya es el día siguiente en UTC', () => {
    conZona(zona, () => {
      // Viernes 30 a las 23:30 de Lima ya es sábado 31 a las 04:30 UTC.
      expect(dentroDeHorario(viernes, new Date('2026-10-31T04:30:00Z'))).toBe(true);
      // Sábado 31 a las 19:00 de Lima (00:00 UTC del domingo): no es viernes.
      expect(dentroDeHorario(viernes, new Date('2026-11-01T00:00:00Z'))).toBe(false);
      // Jueves 29 a las 20:00 de Lima (01:00 UTC del viernes 30): no es viernes todavía.
      expect(dentroDeHorario(viernes, new Date('2026-10-30T01:00:00Z'))).toBe(false);
    });
  });
});

describe('dentroDeHorario · intervalo [desde, hasta)', () => {
  const diurno: TramoHorario[] = [{ dia: 3, desde: '09:00', hasta: '18:00' }]; // miércoles

  it('incluye el inicio y excluye el fin', () => {
    expect(dentroDeHorario(diurno, new Date('2026-11-04T09:00:00.000-05:00'))).toBe(true);
    expect(dentroDeHorario(diurno, new Date('2026-11-04T08:59:59.999-05:00'))).toBe(false);
    expect(dentroDeHorario(diurno, new Date('2026-11-04T17:59:59.999-05:00'))).toBe(true);
    expect(dentroDeHorario(diurno, new Date('2026-11-04T18:00:00.000-05:00'))).toBe(false);
  });

  it('solo vale el día del tramo', () => {
    expect(dentroDeHorario(diurno, new Date('2026-11-03T12:00:00-05:00'))).toBe(false); // martes
    expect(dentroDeHorario(diurno, new Date('2026-11-04T12:00:00-05:00'))).toBe(true); // miércoles
    expect(dentroDeHorario(diurno, new Date('2026-11-05T12:00:00-05:00'))).toBe(false); // jueves
    expect(dentroDeHorario(diurno, new Date('2026-11-11T12:00:00-05:00'))).toBe(true); // otro miércoles
  });

  it('Lima no tiene horario de verano: el mismo desfase en enero y en julio', () => {
    // Miércoles 14 de enero y miércoles 15 de julio de 2026: las 09:00 de Lima son las 14:00 UTC.
    for (const dia of ['2026-01-14', '2026-07-15']) {
      expect(dentroDeHorario(diurno, new Date(`${dia}T14:00:00Z`)), dia).toBe(true);
      expect(dentroDeHorario(diurno, new Date(`${dia}T13:59:59Z`)), dia).toBe(false);
      expect(dentroDeHorario(diurno, new Date(`${dia}T22:59:59Z`)), dia).toBe(true);
      expect(dentroDeHorario(diurno, new Date(`${dia}T23:00:00Z`)), dia).toBe(false);
    }
  });
});

describe('dentroDeHorario · varios tramos', () => {
  const partido: TramoHorario[] = [
    { dia: 1, desde: '12:00', hasta: '15:00' },
    { dia: 1, desde: '19:00', hasta: '23:00' },
    { dia: 6, desde: '10:00', hasta: '14:00' },
  ];

  it('vale si cae en cualquiera de los tramos', () => {
    expect(dentroDeHorario(partido, new Date('2026-11-02T13:00:00-05:00'))).toBe(true); // lunes 13:00
    expect(dentroDeHorario(partido, new Date('2026-11-02T20:00:00-05:00'))).toBe(true); // lunes 20:00
    expect(dentroDeHorario(partido, new Date('2026-11-07T11:00:00-05:00'))).toBe(true); // sábado 11:00
  });

  it('no vale entre tramos ni en días sin tramo', () => {
    expect(dentroDeHorario(partido, new Date('2026-11-02T16:00:00-05:00'))).toBe(false); // hueco del lunes
    expect(dentroDeHorario(partido, new Date('2026-11-03T13:00:00-05:00'))).toBe(false); // martes
    expect(dentroDeHorario(partido, new Date('2026-11-01T13:00:00-05:00'))).toBe(false); // domingo
  });

  it('tramos contiguos: el fin del primero es el inicio del segundo', () => {
    const contiguos: TramoHorario[] = [
      { dia: 2, desde: '10:00', hasta: '14:00' },
      { dia: 2, desde: '14:00', hasta: '18:00' },
    ];
    expect(dentroDeHorario(contiguos, new Date('2026-11-03T13:59:59-05:00'))).toBe(true);
    expect(dentroDeHorario(contiguos, new Date('2026-11-03T14:00:00-05:00'))).toBe(true);
    expect(dentroDeHorario(contiguos, new Date('2026-11-03T18:00:00-05:00'))).toBe(false);
  });

  it('un tramo que cruza la medianoche y otro que empieza a esa hora en el día siguiente', () => {
    const noche: TramoHorario[] = [
      { dia: 2, desde: '20:00', hasta: '00:00' }, // martes hasta la medianoche
      { dia: 3, desde: '00:00', hasta: '03:00' }, // miércoles de madrugada
    ];
    expect(dentroDeHorario(noche, new Date('2026-11-03T23:59:59.999-05:00'))).toBe(true);
    expect(dentroDeHorario(noche, new Date('2026-11-04T00:00:00.000-05:00'))).toBe(true);
    expect(dentroDeHorario(noche, new Date('2026-11-04T02:59:59.999-05:00'))).toBe(true);
    expect(dentroDeHorario(noche, new Date('2026-11-04T03:00:00.000-05:00'))).toBe(false);
  });
});

describe('dentroDeHorario · la medianoche y el domingo al lunes', () => {
  it('hasta 00:00 cruza la medianoche y termina justo al empezar el día siguiente', () => {
    const hastaMedianoche: TramoHorario[] = [{ dia: 7, desde: '23:00', hasta: '00:00' }];
    expect(dentroDeHorario(hastaMedianoche, new Date('2026-11-01T23:00:00-05:00'))).toBe(true);
    expect(dentroDeHorario(hastaMedianoche, new Date('2026-11-01T23:59:59.999-05:00'))).toBe(true);
    expect(dentroDeHorario(hastaMedianoche, new Date('2026-11-02T00:00:00.000-05:00'))).toBe(false);
  });

  it('el instante justo antes de la medianoche de Lima pertenece al día que termina', () => {
    // 2026-11-02T04:59:59.999Z es el domingo 1 a las 23:59:59.999 en Lima.
    const soloDomingoNoche: TramoHorario[] = [{ dia: 7, desde: '23:30', hasta: '23:59' }];
    expect(dentroDeHorario(soloDomingoNoche, new Date('2026-11-02T04:45:00Z'))).toBe(true);
    expect(dentroDeHorario(soloDomingoNoche, new Date('2026-11-02T04:59:00Z'))).toBe(false);
    const lunes: TramoHorario[] = [{ dia: 1, desde: '00:00', hasta: '01:00' }];
    expect(dentroDeHorario(lunes, new Date('2026-11-02T04:59:59.999Z'))).toBe(false);
    expect(dentroDeHorario(lunes, new Date('2026-11-02T05:00:00.000Z'))).toBe(true);
  });

  it('un tramo del lunes no recibe lo que cruza desde el sábado', () => {
    const sabado: TramoHorario[] = [{ dia: 6, desde: '22:00', hasta: '04:00' }];
    expect(dentroDeHorario(sabado, new Date('2026-11-08T03:59:00-05:00'))).toBe(true); // domingo 03:59
    expect(dentroDeHorario(sabado, new Date('2026-11-08T04:00:00-05:00'))).toBe(false); // domingo 04:00
    expect(dentroDeHorario(sabado, new Date('2026-11-09T03:00:00-05:00'))).toBe(false); // lunes 03:00
  });
});

describe('dentroDeHorario · lista vacía', () => {
  it('una lista sin tramos no contiene ningún instante', () => {
    expect(dentroDeHorario([], new Date('2026-11-02T10:00:00-05:00'))).toBe(false);
  });
});

describe('dentroDeHorario · no modifica sus argumentos', () => {
  it('deja intactos el horario y el instante', () => {
    const tramos: TramoHorario[] = [{ dia: 5, desde: '18:00', hasta: '02:00' }];
    const copia = JSON.parse(JSON.stringify(tramos));
    const instante = new Date('2026-10-30T18:00:00-05:00');
    const ms = instante.getTime();
    dentroDeHorario(tramos, instante);
    expect(tramos).toEqual(copia);
    expect(instante.getTime()).toBe(ms);
  });
});
