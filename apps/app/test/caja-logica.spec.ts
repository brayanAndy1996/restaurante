import type { CajaRespuesta, SalonRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  CONTEO_VACIO,
  cajaInicial,
  cuentasAbiertasDelSalon,
  cuerpoDeCierre,
  etiquetaDeMesas,
  medioDeCampoDeConteo,
  mediosConDiferencia,
  motivosQueFaltan,
  movimientosRecientesPrimero,
  soles,
  textoDeCuentasAbiertas,
  textoDeDiferencia,
  validarApertura,
  validarConteo,
  validarMovimiento,
} from '../src/modulos/caja/turno';

// spec: 006-caja-cobro, criterios 24, 28, 31, 32 y 108 a 110, 116 (lógica pura de la pantalla de caja; pruebas no
// protegidas).

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caja = (n: number, extra: Partial<CajaRespuesta> = {}): CajaRespuesta => ({
  id: uuid(n),
  sucursalId: uuid(1),
  nombre: `Caja ${n}`,
  activa: true,
  impresora: null,
  series: [],
  turnoAbierto: null,
  ...extra,
});
const ocupada = (n: number) =>
  caja(n, {
    turnoAbierto: {
      id: uuid(300 + n),
      responsable: { id: uuid(400), nombre: 'Ana' },
      abiertoEn: '2026-11-04T23:02:00.000Z',
    },
  });

describe('soles y textoDeDiferencia', () => {
  it('escribe los montos con S/ y miles, y un negativo con el signo antes de la moneda', () => {
    expect(soles('1284.5')).toBe('S/ 1,284.50');
    expect(soles('0.00')).toBe('S/ 0.00');
    expect(soles('-15.00')).toBe('-S/ 15.00');
  });

  it('dice la diferencia con palabras: faltan, sobran o cuadra', () => {
    expect(textoDeDiferencia('-12.00')).toBe('Faltan S/ 12.00');
    expect(textoDeDiferencia('5.50')).toBe('Sobran S/ 5.50');
    expect(textoDeDiferencia('0.00')).toBe('Cuadra');
  });

  it('cuenta las cuentas abiertas en singular y en plural', () => {
    expect(textoDeCuentasAbiertas(1)).toBe('Queda 1 cuenta abierta');
    expect(textoDeCuentasAbiertas(2)).toBe('Quedan 2 cuentas abiertas');
  });
});

describe('validarApertura (criterio 24)', () => {
  it('pide la caja y el fondo; el fondo se manda con 2 decimales', () => {
    expect(validarApertura({ cajaId: uuid(1), fondo: '200' })).toEqual({
      ok: true,
      cajaId: uuid(1),
      fondo: '200.00',
    });
    expect(validarApertura({ cajaId: uuid(1), fondo: 'S/ 150.5' })).toMatchObject({
      ok: true,
      fondo: '150.50',
    });
  });

  it('el fondo puede ser cero, pero no se puede dejar sin escribir', () => {
    expect(validarApertura({ cajaId: uuid(1), fondo: '0' })).toMatchObject({
      ok: true,
      fondo: '0.00',
    });
    const vacio = validarApertura({ cajaId: uuid(1), fondo: '  ' });
    expect(vacio).toMatchObject({ ok: false });
    expect(!vacio.ok && vacio.errores.fondo).toContain('Escribe el fondo inicial');
  });

  it('rechaza más de 2 decimales, más de 8 enteros y una caja sin elegir', () => {
    const resultado = validarApertura({ cajaId: '', fondo: '100.555' });
    expect(resultado).toMatchObject({ ok: false });
    expect(!resultado.ok && Object.keys(resultado.errores)).toEqual(['cajaId', 'fondo']);
    expect(validarApertura({ cajaId: uuid(1), fondo: '123456789' }).ok).toBe(false);
    expect(validarApertura({ cajaId: uuid(1), fondo: '99999999.99' }).ok).toBe(true);
  });
});

describe('cajaInicial (criterio 109)', () => {
  it('recuerda la caja de la última vez si sigue libre', () => {
    expect(cajaInicial([caja(1), caja(2)], uuid(2))).toBe(uuid(2));
  });

  it('si la recordada está ocupada, queda sin elegir salvo que solo haya una libre', () => {
    expect(cajaInicial([caja(1), ocupada(2), caja(3)], uuid(2))).toBe('');
    expect(cajaInicial([caja(1), ocupada(2)], uuid(2))).toBe(uuid(1));
  });

  it('con varias libres y nada recordado, la persona decide', () => {
    expect(cajaInicial([caja(1), caja(2)], null)).toBe('');
  });
});

describe('validarMovimiento (criterio 28)', () => {
  it('pide un monto mayor que cero y un motivo de 1 a 300 caracteres', () => {
    expect(validarMovimiento({ tipo: 'EGRESO', monto: '15.5', motivo: '  Hielo  ' })).toEqual({
      ok: true,
      tipo: 'EGRESO',
      monto: '15.50',
      motivo: 'Hielo',
    });
    const mal = validarMovimiento({ tipo: 'INGRESO', monto: '0', motivo: '' });
    expect(mal).toMatchObject({ ok: false });
    expect(!mal.ok && Object.keys(mal.errores)).toEqual(['monto', 'motivo']);
    expect(validarMovimiento({ tipo: 'INGRESO', monto: '1', motivo: 'x'.repeat(301) }).ok).toBe(
      false,
    );
    expect(validarMovimiento({ tipo: 'INGRESO', monto: '1', motivo: 'x'.repeat(300) }).ok).toBe(
      true,
    );
  });

  it('muestra el más nuevo primero', () => {
    const lista = [
      { id: 'a', creadoEn: '1' },
      { id: 'b', creadoEn: '2' },
    ] as never[];
    expect(movimientosRecientesPrimero(lista).map((m: { id: string }) => m.id)).toEqual(['b', 'a']);
  });
});

describe('el conteo del cierre (criterios 31 y 116)', () => {
  const lleno = {
    EFECTIVO: '295',
    TARJETA_CREDITO: '69.2',
    TARJETA_DEBITO: '0',
    YAPE: '29.20',
    PLIN: '0.00',
  };

  it('pide los cinco medios y los manda con 2 decimales', () => {
    expect(validarConteo(lleno)).toEqual({
      ok: true,
      contado: {
        EFECTIVO: '295.00',
        TARJETA_CREDITO: '69.20',
        TARJETA_DEBITO: '0.00',
        YAPE: '29.20',
        PLIN: '0.00',
      },
    });
  });

  it('un medio sin escribir es un error: un cero se escribe, no se supone', () => {
    const resultado = validarConteo({ ...lleno, YAPE: '' });
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.errores.YAPE).toContain('Escribe lo que contaste en yape');
    expect(validarConteo(CONTEO_VACIO).ok).toBe(false);
  });

  it('el cuerpo va en el orden de los medios y el motivo solo viaja con una diferencia', () => {
    const contado = {
      EFECTIVO: '295.00',
      TARJETA_CREDITO: '69.20',
      TARJETA_DEBITO: '0.00',
      YAPE: '29.20',
      PLIN: '0.00',
    };
    const motivos = { ...CONTEO_VACIO, EFECTIVO: ' Faltó sencillo ', YAPE: 'no debería ir' };
    expect(cuerpoDeCierre(contado, motivos, new Set(['EFECTIVO']))).toEqual({
      conteo: [
        { medio: 'EFECTIVO', contado: '295.00', motivo: 'Faltó sencillo' },
        { medio: 'TARJETA_CREDITO', contado: '69.20' },
        { medio: 'TARJETA_DEBITO', contado: '0.00' },
        { medio: 'YAPE', contado: '29.20' },
        { medio: 'PLIN', contado: '0.00' },
      ],
    });
    // El primer envío, a ciegas, no lleva ningún motivo.
    expect(
      cuerpoDeCierre(contado, motivos, new Set()).conteo.every((c) => c.motivo === undefined),
    ).toBe(true);
  });

  it('pide el motivo solo de los medios con diferencia', () => {
    const diferencias = [
      { medio: 'EFECTIVO' as const, contado: '295.00', diferencia: '-12.00' },
      { medio: 'TARJETA_CREDITO' as const, contado: '69.20', diferencia: '0.00' },
      { medio: 'YAPE' as const, contado: '30.00', diferencia: '0.80' },
    ];
    expect(mediosConDiferencia(diferencias)).toEqual(['EFECTIVO', 'YAPE']);
    expect(motivosQueFaltan(diferencias, { ...CONTEO_VACIO, YAPE: 'Sobró' })).toEqual({
      EFECTIVO: 'Escribe el motivo de esta diferencia',
    });
    expect(
      motivosQueFaltan(diferencias, { ...CONTEO_VACIO, EFECTIVO: 'Faltó sencillo', YAPE: 'x' }),
    ).toEqual({});
  });

  it('traduce los campos conteo.<i>.motivo del 422 al medio, por el orden de los cinco medios', () => {
    expect(medioDeCampoDeConteo('conteo.0.motivo')).toBe('EFECTIVO');
    expect(medioDeCampoDeConteo('conteo.3.motivo')).toBe('YAPE');
    expect(medioDeCampoDeConteo('conteo.4.motivo')).toBe('PLIN');
    expect(medioDeCampoDeConteo('conteo.0.contado')).toBeUndefined();
    expect(medioDeCampoDeConteo('fondo')).toBeUndefined();
  });
});

describe('cuentas que bloquean el cierre (criterio 116)', () => {
  it('nombra las mesas de una cuenta', () => {
    expect(etiquetaDeMesas(['4'])).toBe('Mesa 4');
    expect(etiquetaDeMesas(['4', '5'])).toBe('Mesas 4 y 5');
    expect(etiquetaDeMesas(['1', '2', '3'])).toBe('Mesas 1, 2 y 3');
    expect(etiquetaDeMesas([])).toBe('Cuenta sin mesa');
  });

  it('lista cada cuenta del mapa una sola vez, aunque ocupe varias mesas', () => {
    const orden = (id: string, mesas: string[], total: string) => ({
      id,
      mozo: { id: uuid(9), nombre: 'Lucía' },
      comensales: 2,
      abiertaEn: '2026-11-04T23:00:00.000Z',
      total,
      mesas: mesas.map((nombre, i) => ({ id: uuid(50 + i), nombre })),
    });
    const mesa = (n: number, o: ReturnType<typeof orden> | null) => ({
      id: uuid(100 + n),
      nombre: String(n),
      capacidad: 4,
      forma: 'CUADRADA' as const,
      columna: n,
      fila: 1,
      estado: o ? ('OCUPADA' as const) : ('LIBRE' as const),
      orden: o,
    });
    const unida = orden(uuid(701), ['4', '5'], '69.20');
    const salon = {
      sucursalId: uuid(1),
      ahora: '2026-11-04T23:30:00.000Z',
      mozos: [],
      zonas: [
        {
          id: uuid(2),
          nombre: 'Salón',
          columnas: 3,
          filas: 1,
          mesas: [
            mesa(1, null),
            mesa(4, unida),
            mesa(5, unida),
            mesa(6, orden(uuid(702), ['6'], '12.5')),
          ],
        },
      ],
    } as SalonRespuesta;
    expect(cuentasAbiertasDelSalon(salon)).toEqual([
      { ordenId: uuid(701), texto: 'Mesas 4 y 5', detalle: 'Lucía · S/ 69.20' },
      { ordenId: uuid(702), texto: 'Mesa 6', detalle: 'Lucía · S/ 12.50' },
    ]);
  });
});
