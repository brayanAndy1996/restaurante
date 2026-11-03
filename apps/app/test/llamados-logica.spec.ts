import type { LineaParaBorrador } from '@restaurante/contratos';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ahoraDeLlamados,
  clasificarLlamados,
  esParaMi,
  estaPorVencer,
  lineasParaPasar,
  motivoParaNoPasar,
  textoDeAntiguedad,
  textoDeAvisoDeLlamado,
  textoDeVencimiento,
  totalDeLineaDeLlamado,
  type LlamadosEnCache,
} from '../src/modulos/llamados/llamados';
import {
  agregarLineasDeLlamado,
  cambiarBorrador,
  claveDeBorrador,
  leerBorrador,
} from '../src/modulos/salon/borrador';
import {
  idDeLlamado,
  lineaDeLlamado,
  listaDeLlamados,
  llamadoDetalle,
  llamadoResumen,
} from './ayudas-llamados';
import { AHORA, uuid } from './ayudas-salon';

// spec: 005-carta-web-mesa, criterios 70 a 72 (reglas de presentación y borrador; pruebas no protegidas).

const ahora = Date.parse(AHORA);
const USUARIO = '22222222-2222-4222-8222-222222222222';

describe('el reloj del servidor', () => {
  it('suma al `ahora` de la respuesta solo lo que pasó en este equipo desde que llegó', () => {
    const cache: LlamadosEnCache = {
      respuesta: listaDeLlamados([]),
      etag: null,
      ahoraDelServidorMs: ahora,
      recibidoEnMs: 5_000_000,
    };
    // El reloj del equipo va a otra hora, pero solo cuenta la diferencia.
    expect(ahoraDeLlamados(cache, 5_000_000)).toBe(ahora);
    expect(ahoraDeLlamados(cache, 5_090_000)).toBe(ahora + 90_000);
    // Un reloj que retrocede no hace retroceder al servidor.
    expect(ahoraDeLlamados(cache, 4_000_000)).toBe(ahora);
    expect(ahoraDeLlamados(undefined, 123)).toBe(123);
  });
});

describe('clasificar los llamados', () => {
  it('los pendientes vigentes van aparte, el más antiguo primero; un vencido pasa a recientes', () => {
    const lista = [
      llamadoResumen(1, { minutos: 2 }),
      llamadoResumen(2, { minutos: 10 }),
      llamadoResumen(3, { minutos: 16 }),
    ];
    const { pendientes, recientes } = clasificarLlamados(lista, ahora);
    expect(pendientes.map((l) => l.id)).toEqual([idDeLlamado(2), idDeLlamado(1)]);
    expect(recientes.map((l) => l.id)).toEqual([idDeLlamado(3)]);
  });

  it('el borde es exacto: a los 15:00 ya venció y a los 14:59 sigue pendiente', () => {
    const l = llamadoResumen(1, { minutos: 15 });
    expect(clasificarLlamados([l], ahora - 1).pendientes).toHaveLength(1);
    expect(clasificarLlamados([l], ahora).pendientes).toHaveLength(0);
  });

  it('un pedido atendido sin cerrar está «en atención»; un aviso sin pedido atendido va a recientes', () => {
    const { enAtencion, recientes, pendientes } = clasificarLlamados(
      [
        llamadoResumen(1, { estado: 'ATENDIDO' }),
        llamadoResumen(2, { estado: 'ATENDIDO', tipo: 'LLAMAR_MOZO' }),
        llamadoResumen(3, { estado: 'DESCARTADO', cerradoEn: AHORA }),
      ],
      ahora,
    );
    expect(pendientes).toHaveLength(0);
    expect(enAtencion.map((l) => l.id)).toEqual([idDeLlamado(1)]);
    expect(recientes.map((l) => l.id).sort()).toEqual([idDeLlamado(2), idDeLlamado(3)].sort());
  });

  it('un atendido no vence, aunque haya pasado su hora', () => {
    const l = llamadoResumen(1, { estado: 'ATENDIDO', minutos: 60 });
    expect(clasificarLlamados([l], ahora).enAtencion).toHaveLength(1);
  });
});

describe('textos', () => {
  it('«vence en N min» con el reloj del servidor', () => {
    const vence = (minutos: number, segundos = 0) =>
      new Date(ahora + minutos * 60_000 + segundos * 1000).toISOString();
    expect(textoDeVencimiento(vence(12), ahora)).toBe('vence en 12 min');
    expect(textoDeVencimiento(vence(0, 61), ahora)).toBe('vence en 2 min');
    expect(textoDeVencimiento(vence(0, 59), ahora)).toBe('vence en menos de 1 min');
    expect(textoDeVencimiento(vence(0, 0), ahora)).toBe('venció');
    expect(estaPorVencer(vence(2), ahora)).toBe(true);
    expect(estaPorVencer(vence(5), ahora)).toBe(false);
  });

  it('«hace N min»', () => {
    const hace = (m: number) => new Date(ahora - m * 60_000).toISOString();
    expect(textoDeAntiguedad(hace(0), ahora)).toBe('recién llegó');
    expect(textoDeAntiguedad(hace(3), ahora)).toBe('hace 3 min');
    expect(textoDeAntiguedad(hace(65), ahora)).toBe('hace 1 h 05 min');
  });

  it('el banner dice la mesa, el tipo y los platos', () => {
    expect(textoDeAvisoDeLlamado('4', 'PEDIDO', 3)).toBe('Mesa 4 · Pedido (3 platos)');
    expect(textoDeAvisoDeLlamado('Mesa 4', 'PEDIDO', 1)).toBe('Mesa 4 · Pedido (1 plato)');
    expect(textoDeAvisoDeLlamado('4', 'PEDIDO')).toBe('Mesa 4 · Pedido');
    expect(textoDeAvisoDeLlamado('12', 'LLAMAR_MOZO', 5)).toBe('Mesa 12 · Llama al mozo');
    expect(textoDeAvisoDeLlamado('12', 'PEDIR_CUENTA')).toBe('Mesa 12 · Pide la cuenta');
  });
});

describe('«Para ti»: los destinatarios', () => {
  it('es para quien está entre los destinatarios, o para todos si es `null`', () => {
    expect(esParaMi([USUARIO, uuid(31)], USUARIO)).toBe(true);
    expect(esParaMi([uuid(31)], USUARIO)).toBe(false);
    expect(esParaMi([], USUARIO)).toBe(false);
    expect(esParaMi(null, USUARIO)).toBe(true);
    // Una sesión de soporte no es una persona de la sucursal.
    expect(esParaMi(null, null)).toBe(false);
    expect(esParaMi([USUARIO], undefined)).toBe(false);
  });
});

describe('revisar el pedido antes de pasarlo', () => {
  const detalle = llamadoDetalle(1, {
    estado: 'ATENDIDO',
    lineas: [
      lineaDeLlamado(0),
      lineaDeLlamado(1, {
        revision: { disponible: false, codigo: 'AGOTADO', motivo: 'Agotado' },
      }),
      lineaDeLlamado(2, { cantidad: 1 }),
    ],
  });

  it('pasa las líneas que quedan con la cantidad que dejó el mozo', () => {
    expect(
      lineasParaPasar(detalle, {
        1: { cantidad: 2, quitada: true },
        2: { cantidad: 4, quitada: false },
      }),
    ).toEqual([
      { posicion: 0, cantidad: 2 },
      { posicion: 2, cantidad: 4 },
    ]);
  });

  it('no se puede pasar con lo no disponible, sin líneas o con un envío en curso', () => {
    expect(motivoParaNoPasar(detalle, {}, false)).toMatch(/Quita lo que no está disponible/);
    const sinAgotado = { 1: { cantidad: 2, quitada: true } };
    expect(motivoParaNoPasar(detalle, sinAgotado, false)).toBeNull();
    expect(motivoParaNoPasar(detalle, sinAgotado, true)).toMatch(/envío a cocina sin terminar/);
    const todoQuitado = {
      0: { cantidad: 2, quitada: true },
      1: { cantidad: 2, quitada: true },
      2: { cantidad: 1, quitada: true },
    };
    expect(motivoParaNoPasar(detalle, todoQuitado, false)).toMatch(/al menos un plato/);
  });

  it('el total de una línea sale de `packages/dominio`, sin redondeos propios', () => {
    expect(totalDeLineaDeLlamado('28.00', 2)).toBe('56.00');
    expect(totalDeLineaDeLlamado('10.10', 3)).toBe('30.30');
  });
});

describe('agregarLineasDeLlamado: el borrador de la cuenta', () => {
  const clave = claveDeBorrador('11111111-1111-4111-8111-111111111111', USUARIO, uuid(904));
  const lineas: LineaParaBorrador[] = [
    {
      posicion: 0,
      productoId: uuid(500),
      nombre: 'Combo hamburguesa',
      modificadores: [{ id: uuid(600), nombre: 'Ensalada', precioExtra: '0.00' }],
      cantidad: 2,
      observacion: 'sin cebolla',
      precioUnitario: '30.00',
      total: '60.00',
    },
    {
      posicion: 2,
      productoId: uuid(502),
      nombre: 'Gaseosa 1 L',
      modificadores: [],
      cantidad: 1,
      observacion: null,
      precioUnitario: '8.00',
      total: '8.00',
    },
  ];

  beforeEach(() => localStorage.clear());

  it('agrega las líneas con los precios del sistema, sin tiempo 2 ni para llevar', () => {
    expect(agregarLineasDeLlamado(clave, idDeLlamado(1), lineas)).toBe('agregado');
    const guardado = leerBorrador(clave);
    expect(guardado.lineas).toHaveLength(2);
    expect(guardado.lineas[0]).toMatchObject({
      productoId: uuid(500),
      cantidad: 2,
      observacion: 'sin cebolla',
      precioUnitario: '30.00',
      tiempo: 1,
      paraLlevar: false,
      llamadoId: idDeLlamado(1),
    });
    expect(guardado.lineas[1]?.observacion).toBe('');
    expect(guardado.envioId).toBeNull();
  });

  it('una réplica no las duplica', () => {
    agregarLineasDeLlamado(clave, idDeLlamado(1), lineas);
    expect(agregarLineasDeLlamado(clave, idDeLlamado(1), lineas)).toBe('repetido');
    expect(agregarLineasDeLlamado(clave, idDeLlamado(1), lineas)).toBe('repetido');
    expect(leerBorrador(clave).lineas).toHaveLength(2);
  });

  it('suma a lo que ya había y otro llamado sí se agrega', () => {
    agregarLineasDeLlamado(clave, idDeLlamado(1), [lineas[0]!]);
    expect(agregarLineasDeLlamado(clave, idDeLlamado(2), [lineas[1]!])).toBe('agregado');
    expect(leerBorrador(clave).lineas.map((l) => l.llamadoId)).toEqual([
      idDeLlamado(1),
      idDeLlamado(2),
    ]);
  });

  it('con un envío en curso queda bloqueado y no cambia nada', () => {
    cambiarBorrador(clave, (b) => ({ ...b, envioId: uuid(9999) }));
    expect(agregarLineasDeLlamado(clave, idDeLlamado(1), lineas)).toBe('bloqueado');
    expect(leerBorrador(clave).lineas).toHaveLength(0);
  });
});
