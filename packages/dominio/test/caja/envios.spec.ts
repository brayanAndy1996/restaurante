// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Reglas puras del envío al PSE (ruta crítica), criterios 127, 129, 130 y 133:
// - 129: `proximoIntento` con la tabla `ESPERAS_REINTENTO_MINUTOS`, el ejemplo de un comprobante emitido a las 10:00
//   y el tope en `plazoHasta`;
// - 130: `plazoDeEnvio` (último milisegundo, hora de Lima, de la fecha de emisión más los días de `PLAZOS_ENVIO_DIAS`),
//   también cruzando un fin de mes, de año y un año bisiesto;
// - 133: `alertaDe` en cada caso (rechazado sin reemisión, demorado a los 31 minutos y no a los 29, detenido, sin
//   configuración); cuál motivo gana cuando coinciden varios no lo fija la especificación y no se prueba;
// - 127: `transicionPermitida` con las veinticinco parejas de estados.
// Hoy falla por "No implementado": las funciones de `envios.ts` son solo su firma.
import { describe, expect, it } from 'vitest';
import {
  ESPERAS_REINTENTO_MINUTOS,
  ESTADOS_COMPROBANTE,
  MINUTOS_ALERTA_PENDIENTE,
  PLAZOS_ENVIO_DIAS,
  TIPOS_DOCUMENTO_ELECTRONICO,
  alertaDe,
  plazoDeEnvio,
  proximoIntento,
  transicionPermitida,
  type EntradaAlerta,
  type EstadoComprobante,
} from '../../src';

const MIN = 60_000;
const lima = (texto: string): Date => new Date(`${texto}-05:00`);

describe('constantes de 6b', () => {
  it('las esperas son 1, 2, 5, 15, 30 y 60 minutos y la alerta a los 30', () => {
    expect([...ESPERAS_REINTENTO_MINUTOS]).toEqual([1, 2, 5, 15, 30, 60]);
    expect(MINUTOS_ALERTA_PENDIENTE).toBe(30);
  });

  it('hay un plazo en días para cada uno de los cuatro documentos (provisional: 3)', () => {
    expect(Object.keys(PLAZOS_ENVIO_DIAS).sort()).toEqual([...TIPOS_DOCUMENTO_ELECTRONICO].sort());
    for (const tipo of TIPOS_DOCUMENTO_ELECTRONICO) expect(PLAZOS_ENVIO_DIAS[tipo]).toBe(3);
  });
});

describe('proximoIntento · criterio 129', () => {
  const emitido = lima('2026-11-02T10:00:00.000');
  const plazo = plazoLejano();

  function plazoLejano(): Date {
    return lima('2026-11-05T23:59:59.999');
  }

  it('ejemplo del criterio: emitido a las 10:00, errores a las 10:00, 10:01, 10:03, 10:08, 10:23 y 10:53', () => {
    const intentosA = [
      ['10:00', 1, '10:01'],
      ['10:01', 2, '10:03'],
      ['10:03', 3, '10:08'],
      ['10:08', 4, '10:23'],
      ['10:23', 5, '10:53'],
      ['10:53', 6, '11:53'],
      ['11:53', 7, '12:53'],
      ['12:53', 8, '13:53'],
    ] as const;
    for (const [hora, n, siguiente] of intentosA) {
      expect(
        proximoIntento(n, lima(`2026-11-02T${hora}:00.000`), plazo),
        `intento ${n} a las ${hora}`,
      ).toEqual(lima(`2026-11-02T${siguiente}:00.000`));
    }
  });

  it('la espera del intento n es ESPERAS_REINTENTO_MINUTOS[min(n − 1, 5)]; después del sexto, siempre 60 minutos', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 25, 100]) {
      const esperaEsperada = ESPERAS_REINTENTO_MINUTOS[Math.min(n - 1, 5)]!;
      expect(proximoIntento(n, emitido, plazo).getTime() - emitido.getTime(), `n=${n}`).toBe(
        esperaEsperada * MIN,
      );
    }
  });

  it('sin pasar de plazoHasta: si el siguiente caería después, se intenta justo en plazoHasta', () => {
    const plazoCorto = lima('2026-11-02T10:30:00.000');
    // Intento 5 a las 10:23: tocaba 10:53, pero el plazo es 10:30.
    expect(proximoIntento(5, lima('2026-11-02T10:23:00.000'), plazoCorto)).toEqual(plazoCorto);
    // Un intento que ya cae dentro del plazo no se toca.
    expect(proximoIntento(3, lima('2026-11-02T10:03:00.000'), plazoCorto)).toEqual(
      lima('2026-11-02T10:08:00.000'),
    );
  });

  it('si el siguiente cae exactamente en plazoHasta, es plazoHasta', () => {
    const plazoExacto = lima('2026-11-02T10:08:00.000');
    expect(proximoIntento(3, lima('2026-11-02T10:03:00.000'), plazoExacto)).toEqual(plazoExacto);
  });

  it('devuelve un Date nuevo y no modifica sus argumentos', () => {
    const ahora = lima('2026-11-02T10:00:00.000');
    const limite = lima('2026-11-05T23:59:59.999');
    const copiaAhora = ahora.getTime();
    const copiaLimite = limite.getTime();
    const siguiente = proximoIntento(1, ahora, limite);
    expect(siguiente).not.toBe(ahora);
    expect(siguiente).not.toBe(limite);
    expect(ahora.getTime()).toBe(copiaAhora);
    expect(limite.getTime()).toBe(copiaLimite);
  });

  it('lanza RangeError con entradas mal formadas', () => {
    expect(() => proximoIntento(0, emitido, plazo)).toThrow(RangeError);
    expect(() => proximoIntento(-1, emitido, plazo)).toThrow(RangeError);
    expect(() => proximoIntento(1.5, emitido, plazo)).toThrow(RangeError);
    expect(() => proximoIntento(Number.NaN, emitido, plazo)).toThrow(RangeError);
    expect(() => proximoIntento(1, new Date('no es una fecha'), plazo)).toThrow(RangeError);
    expect(() => proximoIntento(1, emitido, new Date('no es una fecha'))).toThrow(RangeError);
  });
});

describe('plazoDeEnvio · criterio 130', () => {
  it('es el último milisegundo, hora de Lima, de la fecha de emisión más 3 días', () => {
    // 2026-11-02 + 3 = 2026-11-05 23:59:59.999 en Lima (UTC−5) = 2026-11-06 04:59:59.999 UTC.
    for (const tipo of TIPOS_DOCUMENTO_ELECTRONICO) {
      expect(plazoDeEnvio(tipo, '2026-11-02').toISOString(), tipo).toBe('2026-11-06T04:59:59.999Z');
    }
  });

  it('usa los días de PLAZOS_ENVIO_DIAS de cada tipo', () => {
    for (const tipo of TIPOS_DOCUMENTO_ELECTRONICO) {
      const dias = PLAZOS_ENVIO_DIAS[tipo];
      const esperado = new Date(Date.UTC(2026, 10, 2 + dias, 23 + 5, 59, 59, 999));
      expect(plazoDeEnvio(tipo, '2026-11-02').getTime(), tipo).toBe(esperado.getTime());
    }
  });

  it('cruza el fin de mes, el fin de año y el 29 de febrero de un año bisiesto', () => {
    expect(plazoDeEnvio('BOLETA', '2026-11-29').toISOString()).toBe('2026-12-03T04:59:59.999Z');
    expect(plazoDeEnvio('FACTURA', '2026-12-30').toISOString()).toBe('2027-01-03T04:59:59.999Z');
    expect(plazoDeEnvio('BOLETA', '2026-02-27').toISOString()).toBe('2026-03-03T04:59:59.999Z');
    expect(plazoDeEnvio('NOTA_CREDITO_BOLETA', '2028-02-27').toISOString()).toBe(
      '2028-03-02T04:59:59.999Z',
    );
  });

  it('la hora de Lima manda sobre la de UTC: una fecha cuyo último milisegundo ya es del día siguiente en UTC', () => {
    // 2026-11-05 23:59:59.999 en Lima es 2026-11-06 en UTC.
    const plazo = plazoDeEnvio('BOLETA', '2026-11-02');
    expect(plazo.getUTCDate()).toBe(6);
    expect(plazo.toLocaleString('sv-SE', { timeZone: 'America/Lima' })).toBe('2026-11-05 23:59:59');
    expect(plazo.getTime() % 1000).toBe(999);
  });

  it('lanza RangeError con un tipo o una fecha inválidos', () => {
    // @ts-expect-error tipo inexistente
    expect(() => plazoDeEnvio('TICKET', '2026-11-02')).toThrow(RangeError);
    expect(() => plazoDeEnvio('BOLETA', '2026-02-30')).toThrow(RangeError);
    expect(() => plazoDeEnvio('BOLETA', '2026-13-01')).toThrow(RangeError);
    expect(() => plazoDeEnvio('BOLETA', '02/11/2026')).toThrow(RangeError);
    expect(() => plazoDeEnvio('BOLETA', '')).toThrow(RangeError);
  });
});

describe('alertaDe · criterio 133', () => {
  const ahora = lima('2026-11-02T12:00:00.000');
  const haceMin = (m: number) => new Date(ahora.getTime() - m * MIN);
  const base: EntradaAlerta = {
    estado: 'ACEPTADO',
    estadoEnvio: 'TERMINADO',
    emitidoEn: haceMin(5),
    ultimoResultado: 'ACEPTADO',
    reemplazado: false,
  };

  it('un comprobante aceptado y terminado no tiene alerta, sea cual sea su antigüedad', () => {
    expect(alertaDe(base, ahora)).toBeNull();
    expect(alertaDe({ ...base, emitidoEn: haceMin(60 * 24 * 10) }, ahora)).toBeNull();
    expect(alertaDe({ ...base, estado: 'ANULADO' }, ahora)).toBeNull();
  });

  it('RECHAZADO sin reemisión alerta; con reemisión ya no', () => {
    const rechazado: EntradaAlerta = {
      ...base,
      estado: 'RECHAZADO',
      ultimoResultado: 'RECHAZADO',
    };
    expect(alertaDe(rechazado, ahora)).toBe('RECHAZADO');
    expect(alertaDe({ ...rechazado, emitidoEn: haceMin(60 * 24 * 3) }, ahora)).toBe('RECHAZADO');
    expect(alertaDe({ ...rechazado, reemplazado: true }, ahora)).toBeNull();
  });

  it('POR_ENVIAR sin alerta a los 29 minutos y con alerta DEMORADO a los 31', () => {
    const porEnviar: EntradaAlerta = {
      ...base,
      estado: 'POR_ENVIAR',
      estadoEnvio: 'PENDIENTE',
      ultimoResultado: null,
    };
    expect(alertaDe({ ...porEnviar, emitidoEn: haceMin(0) }, ahora)).toBeNull();
    expect(alertaDe({ ...porEnviar, emitidoEn: haceMin(29) }, ahora)).toBeNull();
    expect(alertaDe({ ...porEnviar, emitidoEn: haceMin(31) }, ahora)).toBe('DEMORADO');
    expect(alertaDe({ ...porEnviar, emitidoEn: haceMin(600) }, ahora)).toBe('DEMORADO');
  });

  it('ENVIADO (esperando la respuesta final) también alerta a los 31 minutos y no a los 29', () => {
    const enviado: EntradaAlerta = {
      ...base,
      estado: 'ENVIADO',
      estadoEnvio: 'ESPERANDO_RESPUESTA',
      ultimoResultado: 'PENDIENTE',
    };
    expect(alertaDe({ ...enviado, emitidoEn: haceMin(29) }, ahora)).toBeNull();
    expect(alertaDe({ ...enviado, emitidoEn: haceMin(31) }, ahora)).toBe('DEMORADO');
  });

  it('el tiempo se cuenta desde emitidoEn con el `ahora` recibido, no con el reloj del sistema', () => {
    const porEnviar: EntradaAlerta = {
      ...base,
      estado: 'POR_ENVIAR',
      estadoEnvio: 'PENDIENTE',
      ultimoResultado: null,
      emitidoEn: lima('2020-01-01T10:00:00.000'),
    };
    expect(alertaDe(porEnviar, lima('2020-01-01T10:29:00.000'))).toBeNull();
    expect(alertaDe(porEnviar, lima('2020-01-01T10:31:00.000'))).toBe('DEMORADO');
  });

  it('un envío DETENIDO alerta aunque el comprobante sea reciente', () => {
    const detenido: EntradaAlerta = {
      ...base,
      estado: 'POR_ENVIAR',
      estadoEnvio: 'DETENIDO',
      emitidoEn: haceMin(1),
      ultimoResultado: 'ERROR_TRANSPORTE',
    };
    expect(alertaDe(detenido, ahora)).toBe('DETENIDO');
  });

  it('un último resultado ERROR_CONFIGURACION alerta SIN_CONFIGURACION aunque el comprobante sea reciente', () => {
    const sinConfiguracion: EntradaAlerta = {
      ...base,
      estado: 'POR_ENVIAR',
      estadoEnvio: 'PENDIENTE',
      emitidoEn: haceMin(1),
      ultimoResultado: 'ERROR_CONFIGURACION',
    };
    expect(alertaDe(sinConfiguracion, ahora)).toBe('SIN_CONFIGURACION');
  });

  it('un error de transporte reciente, sin más, no alerta', () => {
    expect(
      alertaDe(
        {
          ...base,
          estado: 'POR_ENVIAR',
          estadoEnvio: 'PENDIENTE',
          emitidoEn: haceMin(2),
          ultimoResultado: 'ERROR_TRANSPORTE',
        },
        ahora,
      ),
    ).toBeNull();
  });

  it('un comprobante sin envío (emitido antes de 6b) alerta solo por su estado y su antigüedad', () => {
    const sinEnvio: EntradaAlerta = {
      ...base,
      estado: 'POR_ENVIAR',
      estadoEnvio: null,
      ultimoResultado: null,
    };
    expect(alertaDe({ ...sinEnvio, emitidoEn: haceMin(29) }, ahora)).toBeNull();
    expect(alertaDe({ ...sinEnvio, emitidoEn: haceMin(31) }, ahora)).toBe('DEMORADO');
    expect(
      alertaDe({ ...sinEnvio, estado: 'ACEPTADO', emitidoEn: haceMin(600) }, ahora),
    ).toBeNull();
  });
});

describe('transicionPermitida · criterio 127', () => {
  const PERMITIDAS = new Set<string>([
    'POR_ENVIAR>ENVIADO',
    'POR_ENVIAR>ACEPTADO',
    'POR_ENVIAR>RECHAZADO',
    'ENVIADO>ACEPTADO',
    'ENVIADO>RECHAZADO',
    'ACEPTADO>ANULADO',
  ]);

  const parejas: Array<[EstadoComprobante, EstadoComprobante]> = ESTADOS_COMPROBANTE.flatMap((d) =>
    ESTADOS_COMPROBANTE.map((h) => [d, h] as [EstadoComprobante, EstadoComprobante]),
  );

  it.each(parejas)('%s → %s', (desde, hacia) => {
    const esperado = desde === hacia || PERMITIDAS.has(`${desde}>${hacia}`);
    expect(transicionPermitida(desde, hacia)).toBe(esperado);
  });

  it('quedarse en el mismo estado es permitido en los cinco', () => {
    for (const e of ESTADOS_COMPROBANTE) expect(transicionPermitida(e, e), e).toBe(true);
  });

  it('solo hay seis transiciones que cambian de estado', () => {
    const cambian = parejas.filter(([d, h]) => d !== h && transicionPermitida(d, h));
    expect(cambian.length).toBe(PERMITIDAS.size);
  });

  it('un rechazado, un anulado y un aceptado (salvo anularlo) no vuelven atrás', () => {
    expect(transicionPermitida('RECHAZADO', 'ACEPTADO')).toBe(false);
    expect(transicionPermitida('RECHAZADO', 'POR_ENVIAR')).toBe(false);
    expect(transicionPermitida('ANULADO', 'ACEPTADO')).toBe(false);
    expect(transicionPermitida('ACEPTADO', 'RECHAZADO')).toBe(false);
    expect(transicionPermitida('ENVIADO', 'POR_ENVIAR')).toBe(false);
    expect(transicionPermitida('POR_ENVIAR', 'ANULADO')).toBe(false);
    expect(transicionPermitida('ENVIADO', 'ANULADO')).toBe(false);
  });
});
