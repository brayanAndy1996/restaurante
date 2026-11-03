import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  CODIGO_MESA_REGEX,
  atencionEntradaSchema,
  atencionRespuestaSchema,
  descarteEntradaSchema,
  errorRespuestaSchema,
  estadoLlamadoPublicoSchema,
  eventoLlamadoCambioSchema,
  eventoLlamadoNuevoSchema,
  eventoSalonCambioSchema,
  llamadoDetalleSchema,
  llamadoEntradaSchema,
  llamadoPublicoSchema,
  llamadoResumenSchema,
  llamadosRespuestaSchema,
  mesaPublicaSchema,
  pasoACuentaEntradaSchema,
  pasoACuentaRespuestaSchema,
} from '../src';

// Esquemas de los llamados (historia 005, criterios 25, 26, 36, 38 a 46, 53): formato de los datos, no reglas de
// negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';
const INSTANTE = '2026-11-03T20:00:00.000Z';
const VENCE = '2026-11-03T20:15:00.000Z';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('CODIGO_MESA_REGEX (criterio 6)', () => {
  it('acepta 22 caracteres base64url y distingue mayúsculas', () => {
    expect(CODIGO_MESA_REGEX.test('AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
    expect(CODIGO_MESA_REGEX.test('abcdefghijklmnopqrstuv')).toBe(true);
    expect(CODIGO_MESA_REGEX.test('A-_dEfGhIjKlMnOpQrStU9')).toBe(true);
  });

  it.each([
    ['21 caracteres', 'AbCdEfGhIjKlMnOpQrStU'],
    ['23 caracteres', 'AbCdEfGhIjKlMnOpQrStUvW'],
    ['relleno', 'AbCdEfGhIjKlMnOpQrStU='],
    ['espacio', 'AbCdEfGhIjKlMnOpQrSt U'],
    ['más', 'AbCdEfGhIjKlMnOpQrSt+v'],
    ['barra', 'AbCdEfGhIjKlMnOpQrSt/v'],
    ['salto de línea al final', 'AbCdEfGhIjKlMnOpQrStUv\n'],
    ['vacío', ''],
  ])('rechaza %s', (_motivo, codigo) => {
    expect(CODIGO_MESA_REGEX.test(codigo)).toBe(false);
  });
});

describe('llamadoEntradaSchema (criterio 26)', () => {
  const linea = { productoId: ID_2, modificadorIds: [], cantidad: 2 };
  const pedido = { id: ID_1, tipo: 'PEDIDO' as const, lineas: [linea] };

  it('acepta los tres tipos', () => {
    expect(llamadoEntradaSchema.safeParse(pedido).success).toBe(true);
    expect(llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'LLAMAR_MOZO' }).success).toBe(true);
    expect(llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'PEDIR_CUENTA' }).success).toBe(true);
  });

  it('un pedido admite observación y nota, recortadas', () => {
    const resultado = llamadoEntradaSchema.parse({
      ...pedido,
      lineas: [{ ...linea, observacion: '  sin ají  ' }],
      nota: '  para compartir ',
    });
    expect(resultado.tipo === 'PEDIDO' && resultado.lineas[0]?.observacion).toBe('sin ají');
    expect(resultado.tipo === 'PEDIDO' && resultado.nota).toBe('para compartir');
  });

  it('exige el id UUID y un tipo conocido', () => {
    expect(llamadoEntradaSchema.safeParse({ ...pedido, id: 'x' }).success).toBe(false);
    expect(llamadoEntradaSchema.safeParse({ tipo: 'LLAMAR_MOZO' }).success).toBe(false);
    expect(llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'OTRO' }).success).toBe(false);
    expect(llamadoEntradaSchema.safeParse({ id: ID_1 }).success).toBe(false);
  });

  it('un pedido lleva de 1 a 30 líneas', () => {
    expect(llamadoEntradaSchema.safeParse({ ...pedido, lineas: [] }).success).toBe(false);
    expect(
      llamadoEntradaSchema.safeParse({ ...pedido, lineas: Array(30).fill(linea) }).success,
    ).toBe(true);
    expect(
      llamadoEntradaSchema.safeParse({ ...pedido, lineas: Array(31).fill(linea) }).success,
    ).toBe(false);
    expect(llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'PEDIDO' }).success).toBe(false);
  });

  it('la cantidad es entera de 1 a 20', () => {
    for (const cantidad of [1, 20]) {
      expect(
        llamadoEntradaSchema.safeParse({ ...pedido, lineas: [{ ...linea, cantidad }] }).success,
      ).toBe(true);
    }
    for (const cantidad of [0, 21, 1.5, -1, '2']) {
      expect(
        llamadoEntradaSchema.safeParse({ ...pedido, lineas: [{ ...linea, cantidad }] }).success,
        String(cantidad),
      ).toBe(false);
    }
  });

  it('modificadorIds es obligatorio, de hasta 30 y sin repetir (también con otra capitalización)', () => {
    const sinLista = { productoId: ID_2, cantidad: 1 };
    expect(llamadoEntradaSchema.safeParse({ ...pedido, lineas: [sinLista] }).success).toBe(false);
    const treinta = Array.from(
      { length: 30 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(
      llamadoEntradaSchema.safeParse({ ...pedido, lineas: [{ ...linea, modificadorIds: treinta }] })
        .success,
    ).toBe(true);
    expect(
      llamadoEntradaSchema.safeParse({
        ...pedido,
        lineas: [{ ...linea, modificadorIds: [...treinta, ID_3] }],
      }).success,
    ).toBe(false);
    const repetido = llamadoEntradaSchema.safeParse({
      ...pedido,
      lineas: [{ ...linea, modificadorIds: [ID_3, ID_3.toUpperCase()] }],
    });
    expect(repetido.success).toBe(false);
    expect(campos(repetido)).toEqual(['lineas.0.modificadorIds.1']);
  });

  it('la observación y la nota son de 1 a 140 caracteres', () => {
    const conObservacion = (observacion: string) => ({
      ...pedido,
      lineas: [{ ...linea, observacion }],
    });
    expect(llamadoEntradaSchema.safeParse(conObservacion('x'.repeat(140))).success).toBe(true);
    expect(llamadoEntradaSchema.safeParse(conObservacion('x'.repeat(141))).success).toBe(false);
    expect(llamadoEntradaSchema.safeParse(conObservacion('   ')).success).toBe(false);
    expect(llamadoEntradaSchema.safeParse({ ...pedido, nota: 'x'.repeat(141) }).success).toBe(
      false,
    );
    expect(llamadoEntradaSchema.safeParse({ ...pedido, nota: '' }).success).toBe(false);
  });

  it('los textos rechazan NUL', () => {
    expect(llamadoEntradaSchema.safeParse({ ...pedido, nota: 'a\u0000b' }).success).toBe(false);
  });

  it('es estricto: no acepta nombre, teléfono, pago ni ids de la mesa', () => {
    for (const extra of [
      { nombre: 'Ana' },
      { telefono: '999999999' },
      { pago: 'EFECTIVO' },
      { mesaId: ID_2 },
      { empresaId: ID_2 },
      { sucursalId: ID_2 },
    ]) {
      expect(llamadoEntradaSchema.safeParse({ ...pedido, ...extra }).success).toBe(false);
    }
    expect(
      llamadoEntradaSchema.safeParse({ ...pedido, lineas: [{ ...linea, precio: '1.00' }] }).success,
    ).toBe(false);
  });

  it('un llamado sin pedido no acepta líneas ni nota', () => {
    expect(
      llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'LLAMAR_MOZO', lineas: [] }).success,
    ).toBe(false);
    expect(
      llamadoEntradaSchema.safeParse({ id: ID_1, tipo: 'PEDIR_CUENTA', nota: 'x' }).success,
    ).toBe(false);
  });
});

describe('respuestas públicas estrictas (criterios 21, 25, 26 y 38)', () => {
  const llamado = {
    id: ID_1,
    tipo: 'PEDIDO' as const,
    estado: 'PENDIENTE' as const,
    creadoEn: INSTANTE,
    venceEn: VENCE,
    lineas: [
      {
        nombre: 'Lomo saltado',
        modificadores: ['Sin ají'],
        cantidad: 2,
        observacion: null,
        precioUnitario: '28.00',
        total: '56.00',
      },
    ],
    total: '56.00',
  };

  it('llamadoPublico: acepta un pedido y un llamado sin pedido', () => {
    expect(llamadoPublicoSchema.safeParse(llamado).success).toBe(true);
    expect(
      llamadoPublicoSchema.safeParse({ ...llamado, tipo: 'LLAMAR_MOZO', lineas: [], total: null })
        .success,
    ).toBe(true);
  });

  it('llamadoPublico: solo `PENDIENTE` y sin claves de más', () => {
    expect(llamadoPublicoSchema.safeParse({ ...llamado, estado: 'ATENDIDO' }).success).toBe(false);
    for (const extra of [
      { mesaId: ID_2 },
      { sucursalId: ID_2 },
      { huellaIp: 'x' },
      { ordenId: ID_2 },
    ]) {
      expect(llamadoPublicoSchema.safeParse({ ...llamado, ...extra }).success).toBe(false);
    }
    expect(
      llamadoPublicoSchema.safeParse({
        ...llamado,
        lineas: [{ ...llamado.lineas[0], productoId: ID_2 }],
      }).success,
    ).toBe(false);
  });

  it('mesaPublica: sin claves de más', () => {
    const mesa = {
      mesa: { nombre: '4' },
      carta: { empresaSlug: 'sabor-norteno', sucursalSlug: 'miraflores' },
      aceptaLlamados: true,
      motivoNoAcepta: null,
      llamadoPendiente: { tipo: 'PEDIDO' as const, venceEn: VENCE },
    };
    expect(mesaPublicaSchema.safeParse(mesa).success).toBe(true);
    expect(
      mesaPublicaSchema.safeParse({
        ...mesa,
        aceptaLlamados: false,
        motivoNoAcepta: 'FUERA_DE_HORARIO',
        llamadoPendiente: null,
      }).success,
    ).toBe(true);
    expect(mesaPublicaSchema.safeParse({ ...mesa, motivoNoAcepta: 'OTRO' }).success).toBe(false);
    for (const extra of [
      { estado: 'OCUPADA' },
      { mozo: 'Ana' },
      { mesaId: ID_2 },
      { total: '1.00' },
    ]) {
      expect(mesaPublicaSchema.safeParse({ ...mesa, ...extra }).success).toBe(false);
    }
    expect(mesaPublicaSchema.safeParse({ ...mesa, mesa: { nombre: '4', id: ID_2 } }).success).toBe(
      false,
    );
    expect(
      mesaPublicaSchema.safeParse({
        ...mesa,
        llamadoPendiente: { tipo: 'PEDIDO', venceEn: VENCE, id: ID_2 },
      }).success,
    ).toBe(false);
  });

  it('estadoLlamadoPublico: cualquier estado, sin nombres de personas', () => {
    for (const estado of ['PENDIENTE', 'ATENDIDO', 'PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO']) {
      expect(
        estadoLlamadoPublicoSchema.safeParse({ id: ID_1, tipo: 'PEDIDO', estado, venceEn: VENCE })
          .success,
        estado,
      ).toBe(true);
    }
    const base = { id: ID_1, tipo: 'PEDIDO', estado: 'ATENDIDO', venceEn: VENCE };
    expect(
      estadoLlamadoPublicoSchema.safeParse({ ...base, atendidoPor: { id: ID_2, nombre: 'Ana' } })
        .success,
    ).toBe(false);
    expect(estadoLlamadoPublicoSchema.safeParse({ ...base, estado: 'OTRO' }).success).toBe(false);
  });
});

describe('llamados del mozo (criterios 39 y 40)', () => {
  const persona = { id: ID_2, nombre: 'Ana' };
  const resumen = {
    id: ID_1,
    tipo: 'PEDIDO' as const,
    estado: 'ATENDIDO' as const,
    mesa: { id: ID_3, nombre: '4' },
    creadoEn: INSTANTE,
    venceEn: VENCE,
    unidades: 3,
    total: '84.00',
    nota: null,
    destinatarios: null,
    atendidoPor: persona,
    atendidoEn: INSTANTE,
    cerradoPor: null,
    cerradoEn: null,
    ordenId: null,
  };
  const detalle = {
    ...resumen,
    lineas: [
      {
        posicion: 0,
        productoId: ID_2,
        nombre: 'Combo hamburguesa',
        modificadores: [{ id: ID_3, nombre: 'Cerveza', precioExtra: '0.00' }],
        cantidad: 2,
        observacion: null,
        precioCliente: '28.00',
        revision: { disponible: true as const, precioUnitario: '30.00', total: '60.00' },
      },
      {
        posicion: 1,
        productoId: ID_3,
        nombre: 'Gaseosa 1 L',
        modificadores: [],
        cantidad: 1,
        observacion: 'sin hielo',
        precioCliente: '8.00',
        revision: {
          disponible: false as const,
          codigo: 'COMPONENTE_NO_DISPONIBLE',
          motivo: 'Una de sus partes no está disponible',
        },
      },
    ],
    totalCliente: '84.00',
    totalActual: '60.00',
    motivoDescarte: null,
    lineasPasadas: null,
  };

  it('llamadoResumen: acepta destinatarios nulos o una lista y rechaza ids que no son UUID', () => {
    expect(llamadoResumenSchema.safeParse(resumen).success).toBe(true);
    expect(llamadoResumenSchema.safeParse({ ...resumen, destinatarios: [ID_2] }).success).toBe(
      true,
    );
    expect(llamadoResumenSchema.safeParse({ ...resumen, destinatarios: ['x'] }).success).toBe(
      false,
    );
    expect(llamadoResumenSchema.safeParse({ ...resumen, estado: 'OTRO' }).success).toBe(false);
  });

  it('llamadosRespuesta lleva la hora de la API', () => {
    expect(
      llamadosRespuestaSchema.safeParse({ ahora: INSTANTE, llamados: [resumen] }).success,
    ).toBe(true);
    expect(llamadosRespuestaSchema.safeParse({ llamados: [resumen] }).success).toBe(false);
  });

  it('llamadoDetalle: la revisión es disponible con precios o no disponible con motivo', () => {
    expect(llamadoDetalleSchema.safeParse(detalle).success).toBe(true);
    const sinPrecios = structuredClone(detalle);
    (sinPrecios.lineas[0] as { revision: unknown }).revision = { disponible: true };
    expect(llamadoDetalleSchema.safeParse(sinPrecios).success).toBe(false);
    const sinMotivo = structuredClone(detalle);
    (sinMotivo.lineas[1] as { revision: unknown }).revision = { disponible: false, codigo: 'X' };
    expect(llamadoDetalleSchema.safeParse(sinMotivo).success).toBe(false);
  });

  it('llamadoDetalle: acepta las líneas pasadas', () => {
    expect(
      llamadoDetalleSchema.safeParse({
        ...detalle,
        estado: 'PASADO_A_CUENTA',
        lineasPasadas: [{ posicion: 0, cantidad: 3 }],
      }).success,
    ).toBe(true);
    expect(
      llamadoDetalleSchema.safeParse({ ...detalle, lineasPasadas: [{ posicion: 0, cantidad: 0 }] })
        .success,
    ).toBe(false);
  });

  it('atencionRespuesta: la orden puede ser nula (PEDIR_CUENTA sobre una mesa libre)', () => {
    expect(
      atencionRespuestaSchema.safeParse({ llamado: detalle, ordenId: ID_1, mesaAbierta: true })
        .success,
    ).toBe(true);
    expect(
      atencionRespuestaSchema.safeParse({ llamado: detalle, ordenId: null, mesaAbierta: false })
        .success,
    ).toBe(true);
  });
});

describe('atencionEntradaSchema (criterio 42)', () => {
  it('acepta un cuerpo vacío o con ordenId y comensales', () => {
    expect(atencionEntradaSchema.safeParse({}).success).toBe(true);
    expect(atencionEntradaSchema.safeParse({ ordenId: ID_1, comensales: 2 }).success).toBe(true);
  });

  it('los comensales son enteros de 1 a 99 y el ordenId, UUID', () => {
    for (const comensales of [1, 99]) {
      expect(atencionEntradaSchema.safeParse({ comensales }).success).toBe(true);
    }
    for (const comensales of [0, 100, 1.5, '2']) {
      expect(atencionEntradaSchema.safeParse({ comensales }).success, String(comensales)).toBe(
        false,
      );
    }
    expect(atencionEntradaSchema.safeParse({ ordenId: 'x' }).success).toBe(false);
  });

  it('es estricto', () => {
    expect(atencionEntradaSchema.safeParse({ mozoId: ID_1 }).success).toBe(false);
    expect(atencionEntradaSchema.safeParse({ mesaId: ID_1 }).success).toBe(false);
  });
});

describe('pasoACuentaEntradaSchema (criterio 46)', () => {
  it('acepta de 1 a 30 líneas con posición y cantidad', () => {
    expect(
      pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion: 0, cantidad: 1 }] }).success,
    ).toBe(true);
    const treinta = Array.from({ length: 30 }, (_, posicion) => ({ posicion, cantidad: 1 }));
    expect(pasoACuentaEntradaSchema.safeParse({ lineas: treinta }).success).toBe(true);
    expect(
      pasoACuentaEntradaSchema.safeParse({ lineas: [...treinta, { posicion: 30, cantidad: 1 }] })
        .success,
    ).toBe(false);
    expect(pasoACuentaEntradaSchema.safeParse({ lineas: [] }).success).toBe(false);
    expect(pasoACuentaEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('la cantidad es entera de 1 a 999', () => {
    for (const cantidad of [1, 999]) {
      expect(
        pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion: 0, cantidad }] }).success,
      ).toBe(true);
    }
    for (const cantidad of [0, 1000, 1.5, -2, '3']) {
      expect(
        pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion: 0, cantidad }] }).success,
        String(cantidad),
      ).toBe(false);
    }
  });

  it('la posición es un entero que no es negativo', () => {
    for (const posicion of [-1, 0.5, '0']) {
      expect(
        pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion, cantidad: 1 }] }).success,
        String(posicion),
      ).toBe(false);
    }
  });

  it('no valida repetidos ni rangos: eso es del servicio (422 DATOS_INVALIDOS con campos)', () => {
    expect(
      pasoACuentaEntradaSchema.safeParse({
        lineas: [
          { posicion: 0, cantidad: 1 },
          { posicion: 0, cantidad: 2 },
        ],
      }).success,
    ).toBe(true);
  });

  it('rechaza el producto, los modificadores, la observación y los precios', () => {
    for (const extra of [
      { productoId: ID_1 },
      { modificadorIds: [] },
      { observacion: 'x' },
      { precioUnitario: '1.00' },
      { total: '1.00' },
    ]) {
      expect(
        pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion: 0, cantidad: 1, ...extra }] })
          .success,
      ).toBe(false);
    }
    expect(
      pasoACuentaEntradaSchema.safeParse({ lineas: [{ posicion: 0, cantidad: 1 }], ordenId: ID_1 })
        .success,
    ).toBe(false);
  });

  it('pasoACuentaRespuesta devuelve las líneas con los precios del sistema', () => {
    const linea = {
      posicion: 0,
      productoId: ID_2,
      nombre: 'Lomo saltado',
      modificadores: [],
      cantidad: 2,
      observacion: null,
      precioUnitario: '28.00',
      total: '56.00',
    };
    const llamado = {
      id: ID_1,
      tipo: 'PEDIDO',
      estado: 'PASADO_A_CUENTA',
      mesa: { id: ID_3, nombre: '4' },
      creadoEn: INSTANTE,
      venceEn: VENCE,
      unidades: 2,
      total: '56.00',
      nota: null,
      destinatarios: null,
      atendidoPor: { id: ID_2, nombre: 'Ana' },
      atendidoEn: INSTANTE,
      cerradoPor: { id: ID_2, nombre: 'Ana' },
      cerradoEn: INSTANTE,
      ordenId: ID_3,
      lineas: [],
      totalCliente: '56.00',
      totalActual: '56.00',
      motivoDescarte: null,
      lineasPasadas: [{ posicion: 0, cantidad: 2 }],
    };
    expect(
      pasoACuentaRespuestaSchema.safeParse({ llamado, ordenId: ID_3, lineas: [linea] }).success,
    ).toBe(true);
    expect(
      pasoACuentaRespuestaSchema.safeParse({ llamado, ordenId: null, lineas: [linea] }).success,
    ).toBe(false);
  });
});

describe('descarteEntradaSchema (criterio 53)', () => {
  it('el motivo es opcional y de 1 a 140 caracteres', () => {
    expect(descarteEntradaSchema.safeParse({}).success).toBe(true);
    expect(descarteEntradaSchema.safeParse({ motivo: 'Pedido falso' }).success).toBe(true);
    expect(descarteEntradaSchema.safeParse({ motivo: 'x'.repeat(140) }).success).toBe(true);
    expect(descarteEntradaSchema.safeParse({ motivo: 'x'.repeat(141) }).success).toBe(false);
    expect(descarteEntradaSchema.safeParse({ motivo: '  ' }).success).toBe(false);
    expect(descarteEntradaSchema.parse({ motivo: ' Repetido ' }).motivo).toBe('Repetido');
  });

  it('es estricto', () => {
    expect(descarteEntradaSchema.safeParse({ estado: 'DESCARTADO' }).success).toBe(false);
  });
});

describe('eventos de llamados (criterios 36, 45, 52, 53 y 57)', () => {
  const sala = { tipo: 'sucursal' as const, sucursalId: ID_1 };

  it('llamado.nuevo: destinatarios nulo o lista de ids', () => {
    const base = {
      empresaId: ID_2,
      sala,
      nombre: 'llamado.nuevo' as const,
      datos: {
        llamadoId: ID_3,
        tipo: 'PEDIDO' as const,
        mesaId: ID_1,
        mesaNombre: '4',
        destinatarios: null,
      },
    };
    expect(eventoLlamadoNuevoSchema.safeParse(base).success).toBe(true);
    expect(
      eventoLlamadoNuevoSchema.safeParse({
        ...base,
        datos: { ...base.datos, destinatarios: [ID_2] },
      }).success,
    ).toBe(true);
    expect(
      eventoLlamadoNuevoSchema.safeParse({
        ...base,
        datos: { ...base.datos, destinatarios: ['x'] },
      }).success,
    ).toBe(false);
    expect(eventoLlamadoNuevoSchema.safeParse({ ...base, nombre: 'llamado.cambio' }).success).toBe(
      false,
    );
  });

  it('llamado.cambio lleva el estado', () => {
    const base = {
      empresaId: ID_2,
      sala,
      nombre: 'llamado.cambio' as const,
      datos: { llamadoId: ID_3, mesaId: ID_1, estado: 'PASADO_A_CUENTA' as const },
    };
    expect(eventoLlamadoCambioSchema.safeParse(base).success).toBe(true);
    expect(
      eventoLlamadoCambioSchema.safeParse({ ...base, datos: { ...base.datos, estado: 'OTRO' } })
        .success,
    ).toBe(false);
  });

  it('el evento de 004 sigue funcionando (se reutiliza `eventoDeSucursal`)', () => {
    expect(
      eventoSalonCambioSchema.safeParse({
        empresaId: ID_2,
        sala,
        nombre: 'salon.cambio',
        datos: { mesaIds: [ID_3], ordenId: ID_1 },
      }).success,
    ).toBe(true);
  });
});

describe('códigos de error de 005 (criterios 30 a 53)', () => {
  it('están en CODIGOS_ERROR', () => {
    for (const codigo of [
      'LLAMADO_PENDIENTE',
      'FUERA_DE_HORARIO',
      'DEMASIADOS_LLAMADOS',
      'LLAMADO_TOMADO',
      'LLAMADO_VENCIDO',
      'LLAMADO_CERRADO',
      'MESA_LIBRE',
      'MESA_SIN_CUENTA',
      'CARTA_WEB_SIN_CONFIGURAR',
    ]) {
      expect(CODIGOS_ERROR as readonly string[], codigo).toContain(codigo);
    }
  });

  it('no hay códigos repetidos', () => {
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });

  it('el cuerpo de error admite `atendidoPor` y `estado` opcionales', () => {
    const base = { codigo: 'LLAMADO_TOMADO', mensaje: 'Ana ya está atendiendo este llamado' };
    expect(errorRespuestaSchema.safeParse(base).success).toBe(true);
    expect(
      errorRespuestaSchema.safeParse({ ...base, atendidoPor: { id: ID_1, nombre: 'Ana' } }).success,
    ).toBe(true);
    expect(
      errorRespuestaSchema.safeParse({ ...base, atendidoPor: { id: 'x', nombre: 'Ana' } }).success,
    ).toBe(false);
    expect(
      errorRespuestaSchema.safeParse({
        codigo: 'LLAMADO_CERRADO',
        mensaje: 'x',
        estado: 'PASADO_A_CUENTA',
      }).success,
    ).toBe(true);
    expect(
      errorRespuestaSchema.safeParse({ codigo: 'LLAMADO_CERRADO', mensaje: 'x', estado: 'OTRO' })
        .success,
    ).toBe(false);
  });

  it('`DEMASIADOS_LLAMADOS` lleva `reintentarEnSegundos`', () => {
    expect(
      errorRespuestaSchema.safeParse({
        codigo: 'DEMASIADOS_LLAMADOS',
        mensaje: 'Espera un momento',
        reintentarEnSegundos: 60,
      }).success,
    ).toBe(true);
  });
});
