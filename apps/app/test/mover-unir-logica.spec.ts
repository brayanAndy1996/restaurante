import { describe, expect, it } from 'vitest';
import {
  cuentasQueSeAbsorben,
  fraseDeMovimiento,
  fraseDeUnion,
  listaDeNombres,
  motivoNoElegible,
  resumenDeMesaElegida,
} from '../src/modulos/salon/mover-unir';
import { esLaVigente, frasesDeLaNota, sePuedePedirPrecuenta } from '../src/modulos/salon/precuenta';
import { itemDeOrden, mesa, ordenDeMesa, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 45 a 54, 94 y 95 (reglas de la pantalla de mover, unir y pre-cuenta).

const propias = new Set([uuid(104)]);

describe('Qué mesas se pueden elegir (decisión 9, criterio 94)', () => {
  it('mover solo deja elegir mesas libres', () => {
    expect(motivoNoElegible('mover', mesa(6, '6'), propias)).toBeNull();
    expect(motivoNoElegible('mover', mesa(5, '5', { orden: {} }), propias)).toBe(
      'ocupada: para juntar cuentas usa Unir',
    );
    expect(
      motivoNoElegible('mover', mesa(8, '8', { estado: 'EN_PRECUENTA', orden: {} }), propias),
    ).toContain('ocupada');
  });

  it('unir deja elegir libres y ocupadas', () => {
    expect(motivoNoElegible('unir', mesa(6, '6'), propias)).toBeNull();
    expect(motivoNoElegible('unir', mesa(5, '5', { orden: {} }), propias)).toBeNull();
    expect(
      motivoNoElegible('unir', mesa(8, '8', { estado: 'EN_PRECUENTA', orden: {} }), propias),
    ).toBeNull();
  });

  it('las mesas de la propia cuenta nunca se eligen', () => {
    expect(motivoNoElegible('mover', mesa(4, '4', { orden: {} }), propias)).toBe(
      'es de esta cuenta',
    );
    expect(motivoNoElegible('unir', mesa(4, '4', { orden: {} }), propias)).toBe(
      'es de esta cuenta',
    );
  });
});

describe('Frases de confirmar (criterios 45 y 94)', () => {
  const orden = ordenDeMesa(4);

  it('lista nombres como se dicen', () => {
    expect(listaDeNombres([])).toBe('');
    expect(listaDeNombres(['5'])).toBe('5');
    expect(listaDeNombres(['5', '6'])).toBe('5 y 6');
    expect(listaDeNombres(['5', '6', '7'])).toBe('5, 6 y 7');
  });

  it('unir dice a qué cuenta va y a nombre de quién queda la venta', () => {
    expect(fraseDeUnion([{ nombre: '5' }, { nombre: '6' }], orden)).toBe(
      'Unir 5 y 6 a la cuenta de la mesa 4: la venta queda a nombre de Ana Ríos.',
    );
    const dosMesas = ordenDeMesa(4, {
      mesas: [
        { id: uuid(104), nombre: '4' },
        { id: uuid(107), nombre: '7' },
      ],
    });
    expect(fraseDeUnion([{ nombre: '5' }], dosMesas)).toBe(
      'Unir 5 a la cuenta de las mesas 4 y 7: la venta queda a nombre de Ana Ríos.',
    );
  });

  it('mover dice de dónde a dónde y que sigue a cargo el mismo mozo', () => {
    expect(fraseDeMovimiento('4', '6', orden)).toBe(
      'La cuenta pasa de la mesa 4 a la mesa 6. Sigue a cargo de Ana Ríos.',
    );
  });

  it('resume una mesa elegida con su mozo y su total', () => {
    expect(
      resumenDeMesaElegida(mesa(5, '5', { orden: { mozo: 'Luis Vega', total: '85.00' } })),
    ).toBe('Mesa 5 · Ocupada · Luis Vega · S/\u00a085.00');
    expect(
      resumenDeMesaElegida(
        mesa(8, '8', { estado: 'EN_PRECUENTA', orden: { mozo: 'Rosa', total: '40.00' } }),
      ),
    ).toBe('Mesa 8 · En pre-cuenta · Rosa · S/\u00a040.00');
    expect(resumenDeMesaElegida(mesa(6, '6'))).toBe('Mesa 6 · Libre');
  });

  it('una cuenta con varias mesas elegidas se absorbe una sola vez', () => {
    const grupo = [
      { id: uuid(105), nombre: '5' },
      { id: uuid(106), nombre: '6' },
    ];
    const cuentas = cuentasQueSeAbsorben([
      mesa(5, '5', { orden: { id: uuid(905), mozo: 'Luis', total: '85.00', mesas: grupo } }),
      mesa(6, '6', { orden: { id: uuid(905), mozo: 'Luis', total: '85.00', mesas: grupo } }),
      mesa(7, '7'),
    ]);
    expect(cuentas).toEqual([
      {
        ordenId: uuid(905),
        mesas: ['5', '6'],
        mozo: 'Luis',
        total: 'S/ 85.00',
        enPrecuenta: false,
      },
    ]);
  });
});

describe('Pre-cuenta (criterios 50 a 53)', () => {
  it('solo se pide con la cuenta abierta y algún ítem con cantidad vigente', () => {
    const conItem = ordenDeMesa(4, { items: [itemDeOrden(1)] });
    expect(sePuedePedirPrecuenta(conItem)).toBe(true);
    expect(sePuedePedirPrecuenta({ ...conItem, estado: 'EN_PRECUENTA' })).toBe(true);
    expect(sePuedePedirPrecuenta({ ...conItem, estado: 'ANULADA' })).toBe(false);
    expect(sePuedePedirPrecuenta(ordenDeMesa(4))).toBe(false);
    expect(
      sePuedePedirPrecuenta(
        ordenDeMesa(4, {
          items: [itemDeOrden(1, { estado: 'ANULADO', cantidadVigente: 0, cantidadAnulada: 1 })],
        }),
      ),
    ).toBe(false);
  });

  it('es la vigente solo mientras la cuenta siga en pre-cuenta con ese número', () => {
    const vigente = {
      id: uuid(7001),
      numero: 2,
      total: '10.00',
      emitidaEn: '2026-10-29T17:00:00.000Z',
    };
    expect(esLaVigente({ estado: 'EN_PRECUENTA', precuentaVigente: vigente }, { numero: 2 })).toBe(
      true,
    );
    // Se agregó o se anuló algo: la cuenta vuelve a abierta.
    expect(esLaVigente({ estado: 'ABIERTA', precuentaVigente: null }, { numero: 2 })).toBe(false);
    // Hay otra pre-cuenta más nueva.
    expect(
      esLaVigente(
        { estado: 'EN_PRECUENTA', precuentaVigente: { ...vigente, numero: 3 } },
        { numero: 2 },
      ),
    ).toBe(false);
  });

  it('parte la nota en la frase fija y la del ICBPER', () => {
    const base = 'Precios con IGV incluido. No es un comprobante de pago.';
    expect(frasesDeLaNota(base)).toEqual([base]);
    expect(frasesDeLaNota(`${base} El ICBPER se suma al cobrar.`)).toEqual([
      base,
      'El ICBPER se suma al cobrar.',
    ]);
  });
});
