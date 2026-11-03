// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · Reglas puras de los llamados desde la mesa (criterio 56, con 32, 33, 35 y 36): `venceEnLlamado`,
// `estadoVigenteLlamado`, `siguienteEstadoLlamado`, `decidirLimite`, `aceptaLlamados` y
// `destinatariosDeLlamado`. Todas las horas son de Lima (UTC-5); el lunes 2 de noviembre de 2026 es lunes.
//
// Cubre: cada ejemplo del criterio 56; la tabla completa de transiciones (3 tipos x 5 estados x 3 acciones);
// los bordes del vencimiento (14:59.999 y 15:00:00); la ventana abierta por la izquierda de `decidirLimite`, el
// mínimo de 1 segundo y el redondeo hacia arriba; y el horario de `aceptaLlamados`.
import { describe, expect, it } from 'vitest';
import {
  ACCIONES_LLAMADO,
  ESTADOS_LLAMADO,
  LIMITE_LLAMADOS_IP,
  LIMITE_LLAMADOS_MESA,
  MINUTOS_VENCIMIENTO_LLAMADO,
  TIPOS_LLAMADO,
  aceptaLlamados,
  decidirLimite,
  destinatariosDeLlamado,
  estadoVigenteLlamado,
  siguienteEstadoLlamado,
  venceEnLlamado,
  type AccionLlamado,
  type EstadoLlamado,
  type TipoLlamado,
  type TramoHorario,
} from '../../src';

const MIN = 60_000;
const SEG = 1_000;

/** Un instante de Lima del lunes 2 de noviembre de 2026. */
const lima = (hora: string): Date => new Date(`2026-11-02T${hora}-05:00`);

// ---------------------------------------------------------------------------------------------------
// venceEnLlamado
// ---------------------------------------------------------------------------------------------------

describe('venceEnLlamado (criterio 56)', () => {
  it('suma exactamente 15 minutos al instante de creación', () => {
    expect(MINUTOS_VENCIMIENTO_LLAMADO).toBe(15);
    expect(venceEnLlamado(lima('20:00:00')).toISOString()).toBe(lima('20:15:00').toISOString());
  });

  it('conserva los milisegundos', () => {
    const creado = new Date('2026-11-03T01:00:00.123Z');
    expect(venceEnLlamado(creado).getTime()).toBe(creado.getTime() + 15 * MIN);
  });

  it('cruza la medianoche y el cambio de mes sin problema', () => {
    const creado = new Date('2026-11-30T23:55:00-05:00');
    expect(venceEnLlamado(creado).toISOString()).toBe(
      new Date('2026-12-01T00:10:00-05:00').toISOString(),
    );
  });

  it('no modifica el instante recibido y devuelve otra fecha', () => {
    const creado = lima('20:00:00');
    const antes = creado.getTime();
    const vence = venceEnLlamado(creado);
    expect(creado.getTime()).toBe(antes);
    expect(vence).not.toBe(creado);
  });
});

// ---------------------------------------------------------------------------------------------------
// estadoVigenteLlamado
// ---------------------------------------------------------------------------------------------------

describe('estadoVigenteLlamado (criterio 56)', () => {
  const venceEn = lima('20:15:00');

  it('a las 20:14:59.999 sigue PENDIENTE y a las 20:15:00 ya es VENCIDO', () => {
    expect(
      estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, new Date(venceEn.getTime() - 1)),
    ).toBe('PENDIENTE');
    expect(estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, venceEn)).toBe('VENCIDO');
  });

  it('el ejemplo del criterio: creado 20:00:00, 20:14:59.999 y 20:15:00', () => {
    const creado = lima('20:00:00');
    const llamado = { estado: 'PENDIENTE' as const, venceEn: venceEnLlamado(creado) };
    expect(estadoVigenteLlamado(llamado, lima('20:14:59.999'))).toBe('PENDIENTE');
    expect(estadoVigenteLlamado(llamado, lima('20:15:00'))).toBe('VENCIDO');
  });

  it('un PENDIENTE mucho después sigue VENCIDO', () => {
    expect(estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, lima('23:59:59'))).toBe(
      'VENCIDO',
    );
  });

  it('un PENDIENTE recién creado y uno anterior al vencimiento son PENDIENTE', () => {
    expect(estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, lima('20:00:00'))).toBe(
      'PENDIENTE',
    );
    expect(estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, lima('19:00:00'))).toBe(
      'PENDIENTE',
    );
  });

  it('un ATENDIDO no vence: sigue ATENDIDO a las 23:00', () => {
    expect(estadoVigenteLlamado({ estado: 'ATENDIDO', venceEn }, lima('23:00:00'))).toBe(
      'ATENDIDO',
    );
    expect(estadoVigenteLlamado({ estado: 'ATENDIDO', venceEn }, venceEn)).toBe('ATENDIDO');
  });

  it.each(['PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO'] as const)(
    'un %s conserva su estado aunque haya pasado venceEn',
    (estado) => {
      expect(estadoVigenteLlamado({ estado, venceEn }, lima('23:00:00'))).toBe(estado);
      expect(estadoVigenteLlamado({ estado, venceEn }, lima('20:00:00'))).toBe(estado);
    },
  );

  it('no modifica el llamado recibido', () => {
    const llamado = { estado: 'PENDIENTE' as EstadoLlamado, venceEn: new Date(venceEn) };
    estadoVigenteLlamado(llamado, lima('21:00:00'));
    expect(llamado.estado).toBe('PENDIENTE');
    expect(llamado.venceEn.getTime()).toBe(venceEn.getTime());
  });
});

// ---------------------------------------------------------------------------------------------------
// siguienteEstadoLlamado
// ---------------------------------------------------------------------------------------------------

describe('siguienteEstadoLlamado (criterio 56)', () => {
  /**
   * La tabla del criterio 56 escrita de otra forma: solo las transiciones que existen; todo lo demás es `null`.
   * `soloPedido` marca las que valen únicamente en un `PEDIDO`.
   */
  const TRANSICIONES: {
    estado: EstadoLlamado;
    accion: AccionLlamado;
    a: EstadoLlamado;
    soloPedido: boolean;
  }[] = [
    { estado: 'PENDIENTE', accion: 'ATENDER', a: 'ATENDIDO', soloPedido: false },
    { estado: 'PENDIENTE', accion: 'DESCARTAR', a: 'DESCARTADO', soloPedido: false },
    { estado: 'ATENDIDO', accion: 'PASAR_A_CUENTA', a: 'PASADO_A_CUENTA', soloPedido: true },
    { estado: 'ATENDIDO', accion: 'DESCARTAR', a: 'DESCARTADO', soloPedido: true },
  ];

  function esperado(tipo: TipoLlamado, estado: EstadoLlamado, accion: AccionLlamado) {
    const t = TRANSICIONES.find((x) => x.estado === estado && x.accion === accion);
    if (!t) return null;
    if (t.soloPedido && tipo !== 'PEDIDO') return null;
    return t.a;
  }

  const TODAS = TIPOS_LLAMADO.flatMap((tipo) =>
    ESTADOS_LLAMADO.flatMap((estado) =>
      ACCIONES_LLAMADO.map(
        (accion) => [tipo, estado, accion, esperado(tipo, estado, accion)] as const,
      ),
    ),
  );

  it('la tabla tiene 3 tipos x 5 estados x 3 acciones = 45 combinaciones', () => {
    expect(TODAS).toHaveLength(45);
    // Las transiciones válidas son 2 (PENDIENTE) x 3 tipos + 2 (ATENDIDO) x 1 tipo = 8.
    expect(TODAS.filter(([, , , a]) => a !== null)).toHaveLength(8);
  });

  it.each(TODAS)('%s · %s + %s → %s', (tipo, estado, accion, a) => {
    expect(siguienteEstadoLlamado(tipo, estado, accion)).toBe(a);
  });

  it('PENDIENTE + ATENDER → ATENDIDO y PENDIENTE + DESCARTAR → DESCARTADO en cualquier tipo', () => {
    for (const tipo of TIPOS_LLAMADO) {
      expect(siguienteEstadoLlamado(tipo, 'PENDIENTE', 'ATENDER')).toBe('ATENDIDO');
      expect(siguienteEstadoLlamado(tipo, 'PENDIENTE', 'DESCARTAR')).toBe('DESCARTADO');
      expect(siguienteEstadoLlamado(tipo, 'PENDIENTE', 'PASAR_A_CUENTA')).toBeNull();
    }
  });

  it('ATENDIDO + PASAR_A_CUENTA y ATENDIDO + DESCARTAR solo valen en un PEDIDO', () => {
    expect(siguienteEstadoLlamado('PEDIDO', 'ATENDIDO', 'PASAR_A_CUENTA')).toBe('PASADO_A_CUENTA');
    expect(siguienteEstadoLlamado('PEDIDO', 'ATENDIDO', 'DESCARTAR')).toBe('DESCARTADO');
    for (const tipo of ['LLAMAR_MOZO', 'PEDIR_CUENTA'] as const) {
      expect(siguienteEstadoLlamado(tipo, 'ATENDIDO', 'PASAR_A_CUENTA')).toBeNull();
      expect(siguienteEstadoLlamado(tipo, 'ATENDIDO', 'DESCARTAR')).toBeNull();
    }
  });

  it('un VENCIDO, un PASADO_A_CUENTA y un DESCARTADO no admiten ninguna acción', () => {
    for (const tipo of TIPOS_LLAMADO) {
      for (const estado of ['VENCIDO', 'PASADO_A_CUENTA', 'DESCARTADO'] as const) {
        for (const accion of ACCIONES_LLAMADO) {
          expect(siguienteEstadoLlamado(tipo, estado, accion)).toBeNull();
        }
      }
    }
  });

  it('un ATENDIDO no se atiende otra vez', () => {
    for (const tipo of TIPOS_LLAMADO) {
      expect(siguienteEstadoLlamado(tipo, 'ATENDIDO', 'ATENDER')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// decidirLimite
// ---------------------------------------------------------------------------------------------------

describe('decidirLimite (criterios 32, 33 y 56)', () => {
  const limiteMesa = { maximo: 6, ventanaMinutos: 30 };

  it('los límites de la especificación: 6 en 30 minutos por mesa y 20 en 10 por conexión', () => {
    expect(LIMITE_LLAMADOS_MESA).toEqual(limiteMesa);
    expect(LIMITE_LLAMADOS_IP).toEqual({ maximo: 20, ventanaMinutos: 10 });
  });

  const seis = ['20:00:00', '20:05:00', '20:10:00', '20:15:00', '20:20:00', '20:25:00'].map(lima);

  it('el ejemplo del criterio: seis llamados 20:00 … 20:25 y otro a las 20:29 → no permitido, reintentar en 60 s', () => {
    expect(decidirLimite(seis, lima('20:29:00'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 60,
    });
  });

  it('a las 20:30:00 el de las 20:00 sale de la ventana (abierta por la izquierda) y se permite', () => {
    expect(decidirLimite(seis, lima('20:30:00'), limiteMesa)).toEqual({ permitido: true });
  });

  it('un milisegundo antes de las 20:30:00 todavía no se permite y se reintenta en 1 segundo (mínimo 1)', () => {
    expect(decidirLimite(seis, lima('20:29:59.999'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 1,
    });
  });

  it('redondea hacia arriba los segundos que faltan', () => {
    // El más antiguo (20:00:00) sale a las 20:30:00: a las 20:28:59.001 faltan 60.999 s → 61.
    expect(decidirLimite(seis, lima('20:28:59.001'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 61,
    });
    // Faltan 60.001 s → 61.
    expect(decidirLimite(seis, lima('20:28:59.999'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 61,
    });
    // Faltan exactamente 90 s → 90.
    expect(decidirLimite(seis, lima('20:28:30'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 90,
    });
  });

  it('con menos de `maximo` instantes en la ventana se permite', () => {
    expect(decidirLimite([], lima('20:29:00'), limiteMesa)).toEqual({ permitido: true });
    expect(decidirLimite(seis.slice(0, 5), lima('20:29:00'), limiteMesa)).toEqual({
      permitido: true,
    });
  });

  it('exactamente `maximo` instantes en la ventana ya no se permite', () => {
    expect(decidirLimite(seis, lima('20:26:00'), limiteMesa).permitido).toBe(false);
  });

  it('los instantes fuera de la ventana no cuentan', () => {
    const viejos = ['18:00:00', '18:30:00', '19:00:00'].map(lima);
    expect(decidirLimite([...viejos, ...seis.slice(0, 5)], lima('20:29:00'), limiteMesa)).toEqual({
      permitido: true,
    });
  });

  it('la ventana es (ahora − ventana, ahora]: uno justo en el límite izquierdo no cuenta', () => {
    // Seis instantes: el más antiguo está exactamente 30 minutos antes de `ahora` → solo cuentan cinco.
    const ahora = lima('20:30:00');
    expect(decidirLimite(seis, ahora, limiteMesa)).toEqual({ permitido: true });
    // Un milisegundo antes de salir, sí cuenta.
    expect(decidirLimite(seis, new Date(ahora.getTime() - 1), limiteMesa).permitido).toBe(false);
  });

  it('un instante igual a `ahora` sí cuenta (cerrada por la derecha)', () => {
    const ahora = lima('20:30:00');
    const casiLleno = [...seis.slice(1), ahora]; // 5 anteriores + 1 en `ahora` = 6
    expect(decidirLimite(casiLleno, ahora, limiteMesa).permitido).toBe(false);
    expect(decidirLimite(seis.slice(2), ahora, limiteMesa).permitido).toBe(true);
  });

  it('el instante que decide el reintento es el más antiguo de la ventana, no el primero de la lista', () => {
    const desordenados = [seis[3]!, seis[0]!, seis[5]!, seis[1]!, seis[4]!, seis[2]!];
    expect(decidirLimite(desordenados, lima('20:29:00'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 60,
    });
  });

  it('un instante fuera de la ventana no decide el reintento', () => {
    const conViejo = [lima('18:00:00'), ...seis.slice(1), lima('20:26:00')];
    // Dentro de la ventana a las 20:29:00: 20:05 … 20:25 y 20:26 = 6. El más antiguo, 20:05, sale a las 20:35.
    expect(decidirLimite(conViejo, lima('20:29:00'), limiteMesa)).toEqual({
      permitido: false,
      reintentarEnSegundos: 6 * 60,
    });
  });

  it('el límite por conexión: 20 en 10 minutos', () => {
    const ahora = lima('21:00:00');
    const veinte = Array.from(
      { length: 20 },
      (_, i) => new Date(ahora.getTime() - (9 * MIN - i * 20 * SEG)),
    );
    const veintiuno = decidirLimite(veinte, ahora, LIMITE_LLAMADOS_IP);
    // El más antiguo está 9 minutos antes de `ahora` → sale en 1 minuto.
    expect(veintiuno).toEqual({ permitido: false, reintentarEnSegundos: 60 });
    expect(decidirLimite(veinte.slice(1), ahora, LIMITE_LLAMADOS_IP)).toEqual({ permitido: true });
  });

  it('con `maximo` 1 basta un instante dentro de la ventana', () => {
    const ahora = lima('20:00:00');
    const limite = { maximo: 1, ventanaMinutos: 5 };
    expect(decidirLimite([new Date(ahora.getTime() - 2 * MIN)], ahora, limite)).toEqual({
      permitido: false,
      reintentarEnSegundos: 3 * 60,
    });
    expect(decidirLimite([new Date(ahora.getTime() - 5 * MIN)], ahora, limite)).toEqual({
      permitido: true,
    });
  });

  it('no modifica la lista de instantes', () => {
    const lista = [...seis].reverse();
    const copia = lista.map((d) => d.getTime());
    decidirLimite(lista, lima('20:29:00'), limiteMesa);
    expect(lista.map((d) => d.getTime())).toEqual(copia);
  });
});

// ---------------------------------------------------------------------------------------------------
// aceptaLlamados
// ---------------------------------------------------------------------------------------------------

describe('aceptaLlamados (criterios 35 y 56)', () => {
  const todosLosDias = (desde: string, hasta: string): TramoHorario[] =>
    [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, desde, hasta }));
  const horario = todosLosDias('12:00', '23:00');

  it('dentro del horario y sin cuenta abierta → acepta', () => {
    expect(aceptaLlamados({ horario, ahora: lima('14:00:00'), mesaConCuenta: false })).toBe(true);
  });

  it('fuera del horario y sin cuenta abierta → no acepta', () => {
    expect(aceptaLlamados({ horario, ahora: lima('10:00:00'), mesaConCuenta: false })).toBe(false);
    expect(aceptaLlamados({ horario, ahora: lima('23:30:00'), mesaConCuenta: false })).toBe(false);
  });

  it('fuera del horario con una cuenta abierta → acepta (los clientes que siguen después del cierre)', () => {
    expect(aceptaLlamados({ horario, ahora: lima('23:30:00'), mesaConCuenta: true })).toBe(true);
    expect(aceptaLlamados({ horario, ahora: lima('03:00:00'), mesaConCuenta: true })).toBe(true);
  });

  it('con la lista vacía o sin horario cargado → acepta a toda hora', () => {
    expect(aceptaLlamados({ horario: [], ahora: lima('03:00:00'), mesaConCuenta: false })).toBe(
      true,
    );
    expect(aceptaLlamados({ horario: null, ahora: lima('03:00:00'), mesaConCuenta: false })).toBe(
      true,
    );
  });

  it('el intervalo es [desde, hasta): 12:00:00 acepta y 11:59:59.999 no; 22:59:59.999 acepta y 23:00:00 no', () => {
    const cierre = (hora: string) =>
      aceptaLlamados({ horario, ahora: lima(hora), mesaConCuenta: false });
    expect(cierre('11:59:59.999')).toBe(false);
    expect(cierre('12:00:00')).toBe(true);
    expect(cierre('22:59:59.999')).toBe(true);
    expect(cierre('23:00:00')).toBe(false);
  });

  it('usa la hora de Lima y no la del proceso', () => {
    // 19:00 UTC del lunes son las 14:00 de Lima (dentro); 03:00 UTC del martes son las 22:00 del lunes (dentro);
    // 05:00 UTC del martes son las 00:00 de Lima (fuera).
    expect(
      aceptaLlamados({ horario, ahora: new Date('2026-11-02T19:00:00Z'), mesaConCuenta: false }),
    ).toBe(true);
    expect(
      aceptaLlamados({ horario, ahora: new Date('2026-11-03T03:00:00Z'), mesaConCuenta: false }),
    ).toBe(true);
    expect(
      aceptaLlamados({ horario, ahora: new Date('2026-11-03T05:00:00Z'), mesaConCuenta: false }),
    ).toBe(false);
  });

  it('respeta el día de la semana: solo abre los martes', () => {
    const soloMartes: TramoHorario[] = [{ dia: 2, desde: '12:00', hasta: '23:00' }];
    expect(
      aceptaLlamados({ horario: soloMartes, ahora: lima('14:00:00'), mesaConCuenta: false }),
    ).toBe(false);
    expect(
      aceptaLlamados({
        horario: soloMartes,
        ahora: new Date('2026-11-03T14:00:00-05:00'),
        mesaConCuenta: false,
      }),
    ).toBe(true);
  });

  it('un tramo que cruza la medianoche acepta después de las 00:00 del día siguiente', () => {
    const noche = todosLosDias('18:00', '02:00');
    expect(
      aceptaLlamados({
        horario: noche,
        ahora: new Date('2026-11-03T01:00:00-05:00'),
        mesaConCuenta: false,
      }),
    ).toBe(true);
    expect(
      aceptaLlamados({
        horario: noche,
        ahora: new Date('2026-11-03T02:00:00-05:00'),
        mesaConCuenta: false,
      }),
    ).toBe(false);
  });

  it('con una cuenta abierta, la lista vacía y la nula siguen aceptando', () => {
    expect(aceptaLlamados({ horario: [], ahora: lima('03:00:00'), mesaConCuenta: true })).toBe(
      true,
    );
    expect(aceptaLlamados({ horario: null, ahora: lima('03:00:00'), mesaConCuenta: true })).toBe(
      true,
    );
  });

  it('no modifica el horario recibido', () => {
    const copia = JSON.stringify(horario);
    aceptaLlamados({ horario, ahora: lima('14:00:00'), mesaConCuenta: false });
    expect(JSON.stringify(horario)).toBe(copia);
  });
});

// ---------------------------------------------------------------------------------------------------
// destinatariosDeLlamado
// ---------------------------------------------------------------------------------------------------

describe('destinatariosDeLlamado (criterios 36 y 56)', () => {
  const mozo = '8f0e5a52-2f0c-4a7e-9d6c-0f6f2d9a1b11';

  it('con un mozo responsable devuelve [su id]', () => {
    expect(destinatariosDeLlamado(mozo)).toEqual([mozo]);
  });

  it('sin mozo responsable (mesa libre) devuelve null, no una lista vacía', () => {
    expect(destinatariosDeLlamado(null)).toBeNull();
  });

  it('cada llamada devuelve una lista nueva', () => {
    const a = destinatariosDeLlamado(mozo);
    const b = destinatariosDeLlamado(mozo);
    expect(a).not.toBe(b);
    a?.push('otro');
    expect(destinatariosDeLlamado(mozo)).toEqual([mozo]);
  });
});
