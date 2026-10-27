import { describe, expect, it } from 'vitest';
import {
  autorizacionEntradaSchema,
  cambiarContrasenaEntradaSchema,
  contrasenaIngresoSchema,
  contrasenaSchema,
  elegirSucursalEntradaSchema,
  fechaSchema,
  horarioUsuarioSchema,
  ingresoContrasenaEntradaSchema,
  ingresoPinEntradaSchema,
  minusculasAscii,
  montoSchema,
  motivoSchema,
  nombreUsuarioSchema,
  pinAutorizacionSchema,
  pinSchema,
  recordarEquipoEntradaSchema,
  restablecerContrasenaEntradaSchema,
  sesionRespuestaSchema,
  sucursalAccesoEntradaSchema,
  usuarioCrearEntradaSchema,
  usuarioModificarEntradaSchema,
  CODIGOS_ERROR,
} from '../src';

// Esquemas de la sección "Plataforma y acceso" (historia 002): formato de los datos, no reglas de acceso.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('nombreUsuarioSchema (criterio 19)', () => {
  it('acepta de 3 a 50 caracteres a-z, 0-9, punto, guion bajo y guion', () => {
    for (const bueno of ['abc', 'maria.perez', 'juan_p-2', 'a'.repeat(50), '123']) {
      expect(nombreUsuarioSchema.safeParse(bueno).success, bueno).toBe(true);
    }
  });

  it('guarda en minúsculas lo que llega con mayúsculas ASCII', () => {
    expect(nombreUsuarioSchema.parse('Maria.PEREZ')).toBe('maria.perez');
  });

  it('rechaza largos fuera de rango, espacios, símbolos y letras no ASCII', () => {
    for (const malo of [
      '',
      'ab',
      'a'.repeat(51),
      'maria perez',
      ' maria',
      'maria ',
      'maria@correo',
      'María',
      'ñandú',
      'user\u0000',
      'user\n',
      // El signo Kelvin (U+212A) se plegaría a "k" con toLowerCase: no debe aceptarse como ASCII.
      'Kevin',
    ]) {
      expect(nombreUsuarioSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('minusculasAscii no pliega Unicode', () => {
    expect(minusculasAscii('ABC-xyz')).toBe('abc-xyz');
    expect(minusculasAscii('KEVIN')).toBe('Kevin');
  });
});

describe('contrasenaSchema (criterio 13)', () => {
  it('acepta de 8 a 128 caracteres, con espacios y Unicode', () => {
    for (const buena of ['12345678', 'con espacios 1', 'contraseña-ñ-ü', 'a'.repeat(128)]) {
      expect(contrasenaSchema.safeParse(buena).success, buena).toBe(true);
    }
  });

  it('cuenta caracteres y no unidades UTF-16', () => {
    // 8 emojis = 16 unidades UTF-16 pero 8 caracteres.
    expect(contrasenaSchema.safeParse('😀'.repeat(8)).success).toBe(true);
    expect(contrasenaSchema.safeParse('😀'.repeat(7)).success).toBe(false);
    expect(contrasenaSchema.safeParse('😀'.repeat(128)).success).toBe(true);
    expect(contrasenaSchema.safeParse('😀'.repeat(129)).success).toBe(false);
  });

  it('rechaza menos de 8, más de 128, NUL y sustitutos sueltos', () => {
    for (const mala of ['', '1234567', 'a'.repeat(129), 'clave\u0000larga', 'clave\uD800larga']) {
      expect(contrasenaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });

  it('no recorta los espacios de los extremos', () => {
    expect(contrasenaSchema.parse('  abcdefgh  ')).toBe('  abcdefgh  ');
    expect(contrasenaSchema.safeParse('       a').success).toBe(true);
  });

  it('la contraseña de ingreso no exige el mínimo (un PIN como contraseña es una contraseña incorrecta)', () => {
    expect(contrasenaIngresoSchema.safeParse('1234').success).toBe(true);
    expect(contrasenaIngresoSchema.safeParse('').success).toBe(false);
    expect(contrasenaIngresoSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(contrasenaIngresoSchema.safeParse('x\u0000').success).toBe(false);
  });
});

describe('pinSchema y pinAutorizacionSchema (criterios 21 y 46)', () => {
  it('pinSchema acepta exactamente 4 o 6 dígitos (con ceros a la izquierda)', () => {
    for (const bueno of ['1234', '0000', '012345', '999999']) {
      expect(pinSchema.safeParse(bueno).success, bueno).toBe(true);
    }
    for (const malo of [
      '',
      '123',
      '12345',
      '1234567',
      'abcd',
      '12 34',
      '1234\n',
      '١٢٣٤',
      ' 1234',
    ]) {
      expect(pinSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('pinAutorizacionSchema acepta solo 6 dígitos', () => {
    expect(pinAutorizacionSchema.safeParse('123456').success).toBe(true);
    expect(pinAutorizacionSchema.safeParse('000000').success).toBe(true);
    for (const malo of ['1234', '12345', '1234567', 'abcdef', '123456\n', '']) {
      expect(pinAutorizacionSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('horarioUsuarioSchema (criterio 106)', () => {
  it('acepta null (sin horario) y una lista con al menos un tramo válido', () => {
    expect(horarioUsuarioSchema.safeParse(null).success).toBe(true);
    expect(
      horarioUsuarioSchema.safeParse([{ dia: 5, desde: '18:00', hasta: '02:00' }]).success,
    ).toBe(true);
  });

  it('rechaza la lista vacía', () => {
    expect(horarioUsuarioSchema.safeParse([]).success).toBe(false);
  });

  it('rechaza solapes, desde igual a hasta y tramos mal formados', () => {
    for (const malo of [
      [
        { dia: 1, desde: '10:00', hasta: '14:00' },
        { dia: 1, desde: '13:00', hasta: '15:00' },
      ],
      [{ dia: 1, desde: '10:00', hasta: '10:00' }],
      [{ dia: 8, desde: '10:00', hasta: '12:00' }],
      [{ dia: 1, desde: '25:00', hasta: '12:00' }],
    ]) {
      expect(horarioUsuarioSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('un tramo del domingo que cruza la medianoche choca con uno del lunes', () => {
    const r = horarioUsuarioSchema.safeParse([
      { dia: 7, desde: '22:00', hasta: '06:00' },
      { dia: 1, desde: '05:00', hasta: '08:00' },
    ]);
    expect(r.success).toBe(false);
  });
});

describe('fechaSchema, montoSchema y motivoSchema', () => {
  it('fechaSchema acepta fechas del calendario', () => {
    for (const buena of ['2026-11-10', '2028-02-29', '2026-12-31']) {
      expect(fechaSchema.safeParse(buena).success, buena).toBe(true);
    }
    for (const mala of [
      '2026-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-11-31',
      '26-11-10',
      '2026-1-1',
      '',
    ]) {
      expect(fechaSchema.safeParse(mala).success, mala).toBe(false);
    }
  });

  it('montoSchema acepta decimales con hasta 2 decimales y mayores que 0', () => {
    for (const bueno of ['1', '0.01', '10.5', '99999999.99', '150.00', '0.10']) {
      expect(montoSchema.safeParse(bueno).success, bueno).toBe(true);
    }
    for (const malo of [
      '0',
      '0.00',
      '-1',
      '1.234',
      '100000000',
      '1,5',
      '1e3',
      '',
      'abc',
      '.5',
      '1.',
    ]) {
      expect(montoSchema.safeParse(malo).success, malo).toBe(false);
    }
  });

  it('motivoSchema recorta, exige de 1 a 300 caracteres y rechaza NUL y sustitutos sueltos', () => {
    expect(motivoSchema.parse('  Pago de noviembre  ')).toBe('Pago de noviembre');
    expect(motivoSchema.safeParse('a'.repeat(300)).success).toBe(true);
    for (const malo of ['', '   ', 'a'.repeat(301), 'x\u0000y', 'x\uDC00y']) {
      expect(motivoSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('entradas de sesión', () => {
  it('ingresoContrasenaEntrada: el nombre se compara en minúsculas ASCII y no se valida su formato', () => {
    expect(
      ingresoContrasenaEntradaSchema.parse({ usuario: 'Maria.Perez', contrasena: 'x' }),
    ).toEqual({ usuario: 'maria.perez', contrasena: 'x' });
    expect(
      ingresoContrasenaEntradaSchema.safeParse({ usuario: 'no valido!', contrasena: '1234' })
        .success,
    ).toBe(true);
    for (const malo of [
      { usuario: '', contrasena: 'x' },
      { usuario: 'a', contrasena: '' },
      { usuario: 'a'.repeat(51), contrasena: 'x' },
      { usuario: 'a', contrasena: 'x', empresaId: ID_1 },
      { usuario: 'a' },
    ]) {
      expect(ingresoContrasenaEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });

  it('ingresoPinEntrada exige usuarioId y PIN de 4 o 6 dígitos, sin usuario ni contraseña', () => {
    expect(ingresoPinEntradaSchema.safeParse({ usuarioId: ID_1, pin: '1234' }).success).toBe(true);
    expect(ingresoPinEntradaSchema.safeParse({ usuarioId: ID_1, pin: '123456' }).success).toBe(
      true,
    );
    for (const malo of [
      { usuarioId: ID_1, pin: '12345' },
      { usuarioId: 'no-es-uuid', pin: '1234' },
      { pin: '1234' },
      { usuario: 'maria', contrasena: 'secreta123' },
      { usuarioId: ID_1, pin: '1234', contrasena: 'x' },
    ]) {
      expect(ingresoPinEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('cambiarContrasenaEntrada exige la nueva válida y rechaza campos desconocidos', () => {
    expect(
      cambiarContrasenaEntradaSchema.safeParse({ actual: 'vieja', nueva: 'nueva-clave-1' }).success,
    ).toBe(true);
    const corta = cambiarContrasenaEntradaSchema.safeParse({ actual: 'vieja', nueva: 'corta' });
    expect(corta.success).toBe(false);
    expect(campos(corta)).toContain('nueva');
    expect(
      cambiarContrasenaEntradaSchema.safeParse({ actual: 'a', nueva: 'nueva-clave-1', x: 1 })
        .success,
    ).toBe(false);
  });

  it('elegirSucursalEntrada exige un UUID', () => {
    expect(elegirSucursalEntradaSchema.safeParse({ sucursalId: ID_1 }).success).toBe(true);
    expect(elegirSucursalEntradaSchema.safeParse({ sucursalId: 'x' }).success).toBe(false);
    expect(elegirSucursalEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('sesionRespuesta acepta la sesión de un Administrador de soporte sin sucursal', () => {
    const permisos = Object.fromEntries(
      [
        'ATENDER_MESA',
        'MOVER_UNIR_MESAS',
        'ANULAR_ITEM_ENVIADO',
        'APLICAR_DESCUENTO',
        'APLICAR_CORTESIA',
        'ANULAR_ORDEN',
        'GESTIONAR_PEDIDOS_WEB',
        'COBRAR',
        'EMITIR_NOTA_CREDITO',
        'OPERAR_CAJA',
        'USAR_KDS',
        'GESTIONAR_DISPONIBILIDAD',
        'REGISTRAR_INGRESO_MERCADERIA',
        'AJUSTAR_STOCK',
        'EDITAR_CARTA',
        'ADMINISTRAR',
      ].map((a) => [a, 'permitido']),
    );
    const sesion = {
      tipo: 'SOPORTE',
      empresaId: ID_1,
      usuario: null,
      superadministrador: { id: ID_2, nombre: 'Soporte' },
      rol: 'ADMINISTRADOR',
      esAdministrador: true,
      sucursal: null,
      sucursales: [],
      equipo: null,
      permisos,
      modulos: [],
      avisoSuscripcion: null,
      debeCambiarContrasena: false,
      expiraPorInactividadEn: '2026-11-10T15:30:00.000Z',
    };
    expect(sesionRespuestaSchema.safeParse(sesion).success).toBe(true);
    expect(sesionRespuestaSchema.safeParse({ ...sesion, permisos: null }).success).toBe(true);
    expect(sesionRespuestaSchema.safeParse({ ...sesion, tipo: 'OTRO' }).success).toBe(false);
  });
});

describe('usuarioCrearEntradaSchema (criterios 18, 20 y 106)', () => {
  const trabajador = {
    nombre: 'María Pérez',
    nombreUsuario: 'maria.perez',
    esAdministrador: false,
    accesos: [{ sucursalId: ID_1, rol: 'MOZO' }],
    contrasenaTemporal: 'temporal-123',
  };

  it('acepta un trabajador con accesos y con o sin horario', () => {
    expect(usuarioCrearEntradaSchema.safeParse(trabajador).success).toBe(true);
    expect(usuarioCrearEntradaSchema.safeParse({ ...trabajador, horario: null }).success).toBe(
      true,
    );
    expect(
      usuarioCrearEntradaSchema.safeParse({
        ...trabajador,
        horario: [{ dia: 1, desde: '10:00', hasta: '18:00' }],
      }).success,
    ).toBe(true);
  });

  it('acepta un Administrador sin accesos ni horario', () => {
    expect(
      usuarioCrearEntradaSchema.safeParse({ ...trabajador, esAdministrador: true, accesos: [] })
        .success,
    ).toBe(true);
  });

  it('la contraseña temporal es obligatoria y debe ser válida', () => {
    const sin: Record<string, unknown> = { ...trabajador };
    delete sin.contrasenaTemporal;
    expect(usuarioCrearEntradaSchema.safeParse(sin).success).toBe(false);
    expect(
      usuarioCrearEntradaSchema.safeParse({ ...trabajador, contrasenaTemporal: null }).success,
    ).toBe(false);
    expect(
      usuarioCrearEntradaSchema.safeParse({ ...trabajador, contrasenaTemporal: 'corta' }).success,
    ).toBe(false);
  });

  it('rechaza roles fuera de la lista, el rol Administrador como acceso y sucursales repetidas', () => {
    for (const rol of ['ADMINISTRADOR', 'GERENTE', 'mozo', '']) {
      expect(
        usuarioCrearEntradaSchema.safeParse({ ...trabajador, accesos: [{ sucursalId: ID_1, rol }] })
          .success,
        rol,
      ).toBe(false);
    }
    const repetidas = usuarioCrearEntradaSchema.safeParse({
      ...trabajador,
      accesos: [
        { sucursalId: ID_1, rol: 'MOZO' },
        { sucursalId: ID_1, rol: 'CAJERO' },
      ],
    });
    expect(repetidas.success).toBe(false);
    expect(campos(repetidas)).toContain('accesos.1.sucursalId');
  });

  it('un Administrador con accesos o con horario, y un trabajador sin accesos, son inválidos', () => {
    const conAccesos = usuarioCrearEntradaSchema.safeParse({
      ...trabajador,
      esAdministrador: true,
    });
    expect(conAccesos.success).toBe(false);
    expect(campos(conAccesos)).toContain('accesos');
    const conHorario = usuarioCrearEntradaSchema.safeParse({
      ...trabajador,
      esAdministrador: true,
      accesos: [],
      horario: [{ dia: 1, desde: '10:00', hasta: '18:00' }],
    });
    expect(campos(conHorario)).toContain('horario');
    const sinAccesos = usuarioCrearEntradaSchema.safeParse({ ...trabajador, accesos: [] });
    expect(campos(sinAccesos)).toContain('accesos');
  });

  it('rechaza el horario vacío y los campos que no son del cliente (empresaId, creadoPor*)', () => {
    const vacio = usuarioCrearEntradaSchema.safeParse({ ...trabajador, horario: [] });
    expect(vacio.success).toBe(false);
    expect(campos(vacio)).toContain('horario');
    for (const extra of [
      { empresaId: ID_1 },
      { creadoPorUsuarioId: ID_1 },
      { creadoPorSistema: 'migracion:x' },
      { actualizadoPorUsuarioId: ID_1 },
      { activo: false },
      { pin: '1234' },
    ]) {
      expect(
        usuarioCrearEntradaSchema.safeParse({ ...trabajador, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe('usuarioModificarEntradaSchema (criterios 21b y 22)', () => {
  it('exige al menos un campo y acepta horario null como un campo', () => {
    expect(usuarioModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(usuarioModificarEntradaSchema.safeParse({ horario: null }).success).toBe(true);
    expect(usuarioModificarEntradaSchema.safeParse({ activo: false }).success).toBe(true);
    expect(usuarioModificarEntradaSchema.safeParse({ nombre: 'Nuevo nombre' }).success).toBe(true);
  });

  it('rechaza campos desconocidos y los que no son del cliente', () => {
    for (const extra of [
      { empresaId: ID_1 },
      { creadoPorUsuarioId: ID_1 },
      { nombreUsuario: 'otro' },
      { contrasenaTemporal: 'temporal-123' },
    ]) {
      expect(
        usuarioModificarEntradaSchema.safeParse({ nombre: 'X', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('rechaza horario vacío, horario con esAdministrador y sucursales repetidas', () => {
    expect(usuarioModificarEntradaSchema.safeParse({ horario: [] }).success).toBe(false);
    expect(
      usuarioModificarEntradaSchema.safeParse({
        esAdministrador: true,
        horario: [{ dia: 1, desde: '10:00', hasta: '18:00' }],
      }).success,
    ).toBe(false);
    expect(
      usuarioModificarEntradaSchema.safeParse({ esAdministrador: true, horario: null }).success,
    ).toBe(true);
    expect(
      usuarioModificarEntradaSchema.safeParse({
        accesos: [
          { sucursalId: ID_1, rol: 'MOZO' },
          { sucursalId: ID_1, rol: 'MOZO' },
        ],
      }).success,
    ).toBe(false);
  });

  it('restablecerContrasenaEntrada: la contraseña temporal es obligatoria (null es 400)', () => {
    expect(
      restablecerContrasenaEntradaSchema.safeParse({ contrasenaTemporal: 'temporal-123' }).success,
    ).toBe(true);
    expect(restablecerContrasenaEntradaSchema.safeParse({ contrasenaTemporal: null }).success).toBe(
      false,
    );
    expect(restablecerContrasenaEntradaSchema.safeParse({}).success).toBe(false);
  });

  it('sucursalAccesoEntrada acepta enteros de 1 a 120', () => {
    for (const bueno of [1, 5, 120]) {
      expect(sucursalAccesoEntradaSchema.safeParse({ minutosInactividad: bueno }).success).toBe(
        true,
      );
    }
    for (const malo of [0, 121, 1.5, '5', null, -1]) {
      expect(sucursalAccesoEntradaSchema.safeParse({ minutosInactividad: malo }).success).toBe(
        false,
      );
    }
  });
});

describe('equipos y autorizaciones', () => {
  it('recordarEquipoEntrada: nombre opcional de 1 a 60, sin campos desconocidos', () => {
    expect(recordarEquipoEntradaSchema.safeParse({}).success).toBe(true);
    expect(recordarEquipoEntradaSchema.safeParse({ nombre: 'Chrome · Android' }).success).toBe(
      true,
    );
    for (const malo of [
      { nombre: '' },
      { nombre: 'a'.repeat(61) },
      { nombre: 'x', empresaId: ID_1 },
    ]) {
      expect(recordarEquipoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('autorizacionEntrada: acción de la matriz, motivo válido y PIN de 6 dígitos', () => {
    const buena = {
      accion: 'ANULAR_ITEM_ENVIADO',
      motivo: 'Cliente cambió de pedido',
      pin: '123456',
    };
    expect(autorizacionEntradaSchema.safeParse(buena).success).toBe(true);
    for (const mala of [
      { ...buena, accion: 'DESCONOCIDA' },
      { ...buena, pin: '1234' },
      { ...buena, pin: '1234567' },
      { ...buena, motivo: '   ' },
      { ...buena, motivo: 'a'.repeat(301) },
      { ...buena, motivo: 'x\u0000' },
      { ...buena, motivo: 'x\uD800' },
      { ...buena, sucursalId: ID_1 },
    ]) {
      expect(autorizacionEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });
});

describe('códigos de error nuevos', () => {
  it('incluye los de la sección y conserva los de 001', () => {
    for (const codigo of [
      'CREDENCIALES_INVALIDAS',
      'SESION_EXPIRADA',
      'EQUIPO_NO_RECONOCIDO',
      'BLOQUEO_TEMPORAL',
      'FUERA_DE_HORARIO',
      'CAMBIO_CONTRASENA_REQUERIDO',
      'CLAVE_INVALIDA',
      'CLAVE_REQUERIDA',
      'AUTORIZACION_INVALIDA',
      'CLAVE_INNECESARIA',
      'SUCURSAL_NO_ELEGIDA',
      'SUCURSAL_INVALIDA',
      'SUCURSAL_SUSPENDIDA',
      'MODULO_NO_INCLUIDO',
      'ULTIMO_ADMINISTRADOR',
      'PLAN_INVALIDO',
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
      'NO_AUTENTICADO',
      'PROHIBIDO',
      'DATOS_INVALIDOS',
    ]) {
      expect(CODIGOS_ERROR, codigo).toContain(codigo);
    }
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });
});
