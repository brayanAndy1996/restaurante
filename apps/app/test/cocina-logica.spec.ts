import { describe, expect, it } from 'vitest';
import {
  ahoraDeCocina,
  claveCocina,
  conComandaVista,
  conLineaEn,
  conTodoListo,
  estaPendiente,
  etiquetaDeMesas,
  pendientesEnOrden,
  recientesEnOrden,
  type CocinaEnCache,
} from '../src/modulos/cocina/cocina';
import { textoDeAvisoDeListo } from '../src/lib/avisos-de-listo';
import { cocinaDe, comandaKds, lineaKds } from './ayudas-cocina';
import { uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 56, 58, 59, 62 y 98 (reglas de presentación del KDS; no protegidas).

describe('orden de llegada', () => {
  it('ordena por hora de llegada y desempata por id', () => {
    const a = comandaKds(5, { creadaEn: '2026-10-29T16:50:00.000Z' });
    const b = comandaKds(2, { creadaEn: '2026-10-29T16:50:00.000Z' });
    const c = comandaKds(9, { creadaEn: '2026-10-29T16:40:00.000Z' });
    expect(pendientesEnOrden([a, b, c]).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
  });

  it('las anulaciones van primero y entre ellas también por llegada', () => {
    const normal = comandaKds(1, { hace: 20 });
    const anulacionVieja = comandaKds(2, { hace: 9, tipo: 'ANULACION' });
    const anulacionNueva = comandaKds(3, { hace: 1, tipo: 'ANULACION' });
    const marcha = comandaKds(4, { hace: 5, tipo: 'MARCHAR' });
    expect(
      pendientesEnOrden([marcha, anulacionNueva, normal, anulacionVieja]).map((x) => x.id),
    ).toEqual([anulacionVieja.id, anulacionNueva.id, normal.id, marcha.id]);
  });

  it('no cambia la lista que recibe', () => {
    const lista = [comandaKds(2, { hace: 1 }), comandaKds(1, { hace: 9 })];
    pendientesEnOrden(lista);
    expect(lista.map((c) => c.id)).toEqual([comandaKds(2).id, comandaKds(1).id]);
  });

  it('las recientes van de la más nueva a la más vieja', () => {
    const vieja = comandaKds(1, { hace: 40 });
    const nueva = comandaKds(2, { hace: 10 });
    expect(recientesEnOrden([vieja, nueva]).map((c) => c.id)).toEqual([nueva.id, vieja.id]);
  });
});

describe('etiquetaDeMesas', () => {
  it('nombra una o varias mesas sin repetir la palabra "Mesa"', () => {
    expect(etiquetaDeMesas([{ nombre: '4' }])).toBe('Mesa 4');
    expect(etiquetaDeMesas([{ nombre: 'Mesa 4' }])).toBe('Mesa 4');
    expect(etiquetaDeMesas([{ nombre: '4' }, { nombre: 'Mesa 5' }])).toBe('Mesas 4 y 5');
    expect(etiquetaDeMesas([{ nombre: '4' }, { nombre: '5' }, { nombre: '6' }])).toBe(
      'Mesas 4, 5 y 6',
    );
    expect(etiquetaDeMesas([])).toBe('Sin mesa');
  });
});

describe('qué está pendiente (criterio 56)', () => {
  it('una comanda, mientras una línea esté por preparar o en preparación', () => {
    const c = (...estados: ('ENVIADO' | 'EN_PREPARACION' | 'LISTO' | 'ANULADO')[]) =>
      comandaKds(1, { lineas: estados.map((estado, i) => lineaKds(i + 1, { estado })) });
    expect(estaPendiente(c('LISTO', 'ENVIADO'))).toBe(true);
    expect(estaPendiente(c('LISTO', 'EN_PREPARACION'))).toBe(true);
    expect(estaPendiente(c('LISTO', 'ANULADO'))).toBe(false);
    expect(estaPendiente(c('ANULADO'))).toBe(false);
  });

  it('una marcha o una anulación, hasta que se marca vista', () => {
    expect(estaPendiente(comandaKds(1, { tipo: 'MARCHAR' }))).toBe(true);
    expect(
      estaPendiente(comandaKds(1, { tipo: 'ANULACION', vistaEn: '2026-10-29T17:00:00.000Z' })),
    ).toBe(false);
  });
});

describe('cambios provisionales', () => {
  const dosLineas = comandaKds(1, {
    lineas: [lineaKds(1), lineaKds(2, { nombre: 'Ají de gallina' })],
  });

  it('una línea lista no saca la comanda de pendientes mientras quede otra', () => {
    const cocina = conLineaEn(cocinaDe([dosLineas]), lineaKds(1).id, 'LISTO');
    expect(cocina.pendientes).toHaveLength(1);
    expect(cocina.recientes).toHaveLength(0);
    expect(cocina.pendientes[0]?.lineas.map((l) => l.estado)).toEqual(['LISTO', 'ENVIADO']);
  });

  it('la última línea lista pasa la comanda a recientes, y deshacer la devuelve', () => {
    const una = comandaKds(1);
    const lista = conLineaEn(cocinaDe([una]), lineaKds(1).id, 'LISTO');
    expect(lista.pendientes).toHaveLength(0);
    expect(lista.recientes.map((c) => c.id)).toEqual([una.id]);

    const deshecha = conLineaEn(lista, lineaKds(1).id, 'ENVIADO');
    expect(deshecha.pendientes.map((c) => c.id)).toEqual([una.id]);
    expect(deshecha.recientes).toHaveLength(0);
  });

  it('"Preparando" deja la comanda pendiente', () => {
    const cocina = conLineaEn(cocinaDe([comandaKds(1)]), lineaKds(1).id, 'EN_PREPARACION');
    expect(cocina.pendientes[0]?.lineas[0]?.estado).toBe('EN_PREPARACION');
  });

  it('una línea anulada no cambia de estado', () => {
    const anulada = comandaKds(1, {
      lineas: [lineaKds(1, { estado: 'ANULADO' }), lineaKds(2)],
    });
    const cocina = conLineaEn(cocinaDe([anulada]), lineaKds(1).id, 'LISTO');
    expect(cocina.pendientes[0]?.lineas[0]?.estado).toBe('ANULADO');
  });

  it('"Todo listo" deja lista toda línea no anulada y manda la comanda a recientes', () => {
    const c = comandaKds(1, {
      lineas: [
        lineaKds(1),
        lineaKds(2, { estado: 'EN_PREPARACION' }),
        lineaKds(3, { estado: 'ANULADO' }),
      ],
    });
    const cocina = conTodoListo(cocinaDe([c, comandaKds(2)]), c.id);
    expect(cocina.pendientes.map((x) => x.id)).toEqual([comandaKds(2).id]);
    expect(cocina.recientes[0]?.lineas.map((l) => l.estado)).toEqual(['LISTO', 'LISTO', 'ANULADO']);
  });

  it('"Todo listo" no toca las líneas que esperan la marcha (criterio 59)', () => {
    const c = comandaKds(1, {
      lineas: [
        lineaKds(1),
        lineaKds(2, { estado: 'EN_PREPARACION' }),
        lineaKds(3, { tiempo: 2, esperar: true }),
        lineaKds(4, { tiempo: 2, esperar: true, estado: 'EN_PREPARACION' }),
      ],
    });
    const cocina = conTodoListo(cocinaDe([c]), c.id);
    // Las dos de tiempo 2 siguen como estaban y la comanda sigue pendiente, a la espera de la marcha.
    expect(cocina.pendientes).toHaveLength(1);
    expect(cocina.recientes).toHaveLength(0);
    expect(cocina.pendientes[0]?.lineas.map((l) => l.estado)).toEqual([
      'LISTO',
      'LISTO',
      'ENVIADO',
      'EN_PREPARACION',
    ]);
  });

  it('con todas las líneas esperando la marcha, "Todo listo" no cambia nada', () => {
    const c = comandaKds(1, { lineas: [lineaKds(1, { tiempo: 2, esperar: true })] });
    const antes = cocinaDe([c]);
    expect(conTodoListo(antes, c.id).pendientes[0]?.lineas[0]?.estado).toBe('ENVIADO');
  });

  it('"Todo listo" no toca una marcha', () => {
    const marcha = comandaKds(1, { tipo: 'MARCHAR' });
    expect(conTodoListo(cocinaDe([marcha]), marcha.id).pendientes).toHaveLength(1);
  });

  it('"Enterado" saca la marcha o la anulación de pendientes', () => {
    const anulacion = comandaKds(1, { tipo: 'ANULACION' });
    const cocina = conComandaVista(cocinaDe([anulacion]), anulacion.id, '2026-10-29T17:01:00.000Z');
    expect(cocina.pendientes).toHaveLength(0);
    expect(cocina.recientes[0]?.vistaEn).toBe('2026-10-29T17:01:00.000Z');
  });
});

describe('la clave y la hora', () => {
  it('la clave no depende del orden de las estaciones', () => {
    expect(claveCocina('s', ['b', 'a'])).toEqual(claveCocina('s', ['a', 'b']));
    expect(claveCocina('s', ['a'])).not.toEqual(claveCocina('s', ['a', 'b']));
    expect(claveCocina('s', [])).not.toEqual(claveCocina('t', []));
  });

  it('la hora de ahora es la del servidor más lo que pasó en el equipo desde la respuesta', () => {
    const datos = {
      cocina: cocinaDe([]),
      etag: null,
      ahoraDelServidorMs: 1_000_000,
      recibidoEnMs: 5_000_000_000,
    } satisfies CocinaEnCache;
    expect(ahoraDeCocina(datos, 5_000_090_000)).toBe(1_090_000);
    // Un reloj que retrocede no resta tiempo.
    expect(ahoraDeCocina(datos, 4_000_000_000)).toBe(1_000_000);
    expect(ahoraDeCocina(undefined, 42)).toBe(42);
  });
});

describe('la frase del aviso de "Listo"', () => {
  it('dice el plato, la cantidad y la mesa', () => {
    const base = { ordenId: uuid(1), itemId: uuid(2), lineaId: uuid(3), destinatarios: [] };
    expect(
      textoDeAvisoDeListo({
        ...base,
        nombre: 'Lomo saltado',
        cantidad: 1,
        mesas: [{ id: uuid(4), nombre: '4' }],
      }),
    ).toBe('Lomo saltado × 1 de la mesa 4 está listo');
    expect(
      textoDeAvisoDeListo({
        ...base,
        nombre: 'Chicha',
        cantidad: 3,
        mesas: [
          { id: uuid(4), nombre: '4' },
          { id: uuid(5), nombre: 'Mesa 5' },
        ],
      }),
    ).toBe('Chicha × 3 de las mesas 4 y 5 está listo');
  });
});
