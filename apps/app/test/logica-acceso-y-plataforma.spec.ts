import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  equipoDeSesion,
  guardarTokenDeEquipo,
  guardarTokenDeSesion,
  tokenDeEquipo,
  tokenDeSesion,
  tokensDeEquipo,
} from '../src/lib/almacen';
import { nuevaClaveDeIdempotencia } from '../src/lib/api';
import { nombreDelEquipo } from '../src/lib/equipo';
import { ErrorApi, mensajeDeCampo, mensajeDeError } from '../src/lib/errores';
import { fechaHoraDeLima } from '../src/lib/formato';
import { segundosHasta, useSegundosHasta } from '../src/lib/tiempo';
import { minutosValidos } from '../src/modulos/administracion/acceso-sucursal';
import { useClaveDeEscritura } from '../src/modulos/plataforma/claves';
import {
  altaVacia,
  entradaDeAlta,
  validarAlta,
  validarFechaOpcional,
  type AltaForm,
} from '../src/modulos/plataforma/empresa-form';
import {
  cambiosDelPlan,
  entradaDePlan,
  formularioDePlan,
  hayCambiosDePlan,
  planVacio,
  validarPlan,
} from '../src/modulos/plataforma/plan-form';
import {
  textoDeComprobantesDelMes,
  textoDeConsumo,
  textoDePlan,
  textoDePrecio,
} from '../src/modulos/plataforma/plataforma';
import { montoNormalizado } from '../src/modulos/plataforma/SuscripcionDetallePagina';

describe('nombre del equipo', () => {
  const casos: [string, string][] = [
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome · Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari · iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
      'Samsung Internet · Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/130 Mobile/15E148 Safari/604.1',
      'Chrome · iPhone',
    ],
    ['algo desconocido', 'Equipo sin nombre'],
  ];
  it.each(casos)('arma un nombre legible: %#', (agente, esperado) => {
    expect(nombreDelEquipo(agente)).toBe(esperado);
  });
});

describe('tokens de equipo y sesión en el almacenamiento', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('guarda un token de equipo por empresa y descarta lo que no es un token', () => {
    guardarTokenDeEquipo('e1', 'eq.a.b.c');
    guardarTokenDeEquipo('e2', 'eq.d.e.f');
    expect(tokensDeEquipo()).toEqual({ e1: 'eq.a.b.c', e2: 'eq.d.e.f' });
    localStorage.setItem(
      'restaurante.equipos',
      JSON.stringify({ e1: 'eq.a.b.c', e2: 'mal', e3: 5 }),
    );
    expect(tokensDeEquipo()).toEqual({ e1: 'eq.a.b.c' });
    expect(tokenDeEquipo('e9')).toBeNull();
  });

  it('la sesión PIN recuerda el equipo con el que se abrió y la de contraseña no', () => {
    guardarTokenDeSesion('se.a.b.c', 'eq.a.b.c');
    expect(tokenDeSesion()).toBe('se.a.b.c');
    expect(equipoDeSesion()).toBe('eq.a.b.c');
    guardarTokenDeSesion('se.a.b.d');
    expect(equipoDeSesion()).toBeNull();
  });
});

describe('mensajes de campo de la API', () => {
  it('deja pasar los que ya vienen en español y cambia los de zod en inglés', () => {
    expect(mensajeDeCampo('El RUC ya está registrado')).toBe('El RUC ya está registrado');
    expect(mensajeDeCampo('Too small: expected string to have >=1 characters')).toBe(
      'Revisa este dato',
    );
    expect(mensajeDeCampo('Invalid input')).toBe('Revisa este dato');
    expect(mensajeDeCampo('Unrecognized key: "x"')).toBe('Revisa este dato');
  });

  it('dice en español los códigos nuevos del acceso', () => {
    const e = (codigo: string) => new ErrorApi({ estado: 401, codigo, mensaje: '' });
    expect(mensajeDeError(e('EQUIPO_NO_RECONOCIDO'))).toMatch(/ya no está registrado/);
    expect(mensajeDeError(e('PLAN_INVALIDO'))).toMatch(/plan elegido/);
    expect(mensajeDeError(e('CLAVE_IDEMPOTENCIA_REUTILIZADA'))).toMatch(/otros datos/);
  });
});

describe('fecha y hora relativas de Lima', () => {
  const ahora = new Date('2026-10-27T20:00:00.000Z'); // 15:00 en Lima
  it('dice hoy, ayer o la fecha', () => {
    expect(fechaHoraDeLima('2026-10-27T18:40:00.000Z', ahora)).toBe('hoy 13:40');
    expect(fechaHoraDeLima('2026-10-26T23:02:00.000Z', ahora)).toBe('ayer 18:02');
    expect(fechaHoraDeLima('2026-10-05T23:40:00.000Z', ahora)).toBe('05/10/2026 18:40');
  });

  it('usa el día de Lima, no el de UTC (una hora de la noche de Lima ya es "mañana" en UTC)', () => {
    // 2026-10-28T02:00Z es 21:00 del 27 en Lima: sigue siendo "hoy".
    expect(fechaHoraDeLima('2026-10-28T02:00:00.000Z', ahora)).toBe('hoy 21:00');
  });
});

describe('cuenta regresiva', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-27T20:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  it('cuenta los segundos que faltan, sin bajar de 0', () => {
    const ahora = Date.now();
    expect(segundosHasta(ahora + 272_000)).toBe(272);
    expect(segundosHasta(ahora + 100)).toBe(1);
    expect(segundosHasta(ahora - 5000)).toBe(0);
  });

  it('se actualiza cada segundo y se detiene en 0', () => {
    const hasta = new Date(Date.now() + 3000).toISOString();
    const { result } = renderHook(() => useSegundosHasta(hasta));
    expect(result.current).toBe(3);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it('muestra de inmediato un instante nuevo, sin un cuadro con el valor viejo', () => {
    const { result, rerender } = renderHook(({ hasta }) => useSegundosHasta(hasta), {
      initialProps: { hasta: null as string | null },
    });
    expect(result.current).toBe(0);
    rerender({ hasta: new Date(Date.now() + 90_000).toISOString() });
    expect(result.current).toBe(90);
  });
});

describe('minutos de inactividad', () => {
  it.each([
    ['1', 1],
    [' 120 ', 120],
    ['5', 5],
  ])('acepta %j', (texto, esperado) => expect(minutosValidos(texto)).toBe(esperado));
  it.each(['', '0', '121', '2.5', '-1', 'abc', '1e2', '１２'])('rechaza %j', (texto) =>
    expect(minutosValidos(texto)).toBeNull(),
  );
});

describe('monto de un pago', () => {
  it.each([
    ['120', '120'],
    ['120.5', '120.5'],
    ['120,50', '120.50'],
    [' 0.01 ', '0.01'],
  ])('acepta %j', (texto, esperado) => expect(montoNormalizado(texto)).toBe(esperado));
  it.each(['', '0', '0.00', '-5', '12.345', 'S/ 10', '123456789'])('rechaza %j', (texto) =>
    expect(montoNormalizado(texto)).toBeNull(),
  );
});

describe('textos de la plataforma', () => {
  it('precios, consumo y plan', () => {
    expect(textoDePrecio(null)).toBe('Sin definir');
    expect(textoDePrecio('120')).toBe('S/ 120.00');
    expect(textoDePrecio('0.0500')).toBe('S/ 0.05');
    expect(textoDePrecio('1234.5')).toBe('S/ 1,234.50');
    expect(textoDeConsumo({ emitidos: 120, cuota: 500 })).toBe('120 de 500');
    expect(textoDeConsumo({ emitidos: 7, cuota: null })).toBe('7');
    expect(textoDeComprobantesDelMes({ emitidos: 1, cuota: null })).toBe('1 comprobante este mes');
    expect(textoDeComprobantesDelMes({ emitidos: 0, cuota: null })).toBe('0 comprobantes este mes');
    expect(textoDeComprobantesDelMes({ emitidos: 3, cuota: 500 })).toBe(
      '3 de 500 comprobantes este mes',
    );
    expect(textoDePlan('Pro')).toBe('Plan Pro');
    expect(textoDePlan('Plan base')).toBe('Plan base');
  });
});

describe('alta de empresa: validación y entrada', () => {
  const hoy = '2026-10-27';
  function llena(): AltaForm {
    const f = altaVacia();
    f.nombre = ' Cevichería El Faro ';
    f.emisores[0]!.ruc = '20600000005';
    f.emisores[0]!.razonSocial = 'El Faro E.I.R.L.';
    f.emisores[0]!.regimen = 'GENERAL';
    f.sucursales[0]!.nombre = 'Barranco';
    f.sucursales[0]!.direccion = 'Av. Grau 340';
    f.administrador = {
      nombre: 'Carmen',
      nombreUsuario: 'Faro.Admin',
      contrasenaTemporal: '12345678',
    };
    f.motivo = 'Cliente nuevo';
    return f;
  }

  it('un formulario completo no tiene errores y arma la entrada de la API', () => {
    const f = llena();
    expect(validarAlta(f, hoy)).toEqual({});
    expect(entradaDeAlta(f)).toEqual({
      nombre: 'Cevichería El Faro',
      emisores: [{ ruc: '20600000005', razonSocial: 'El Faro E.I.R.L.', regimen: 'GENERAL' }],
      sucursales: [
        {
          rucEmisor: '20600000005',
          nombre: 'Barranco',
          codigoEstablecimiento: '0001',
          direccion: 'Av. Grau 340',
        },
      ],
      administrador: {
        nombre: 'Carmen',
        nombreUsuario: 'faro.admin',
        contrasenaTemporal: '12345678',
      },
      motivo: 'Cliente nuevo',
    });
  });

  it('detecta RUC y nombres repetidos, y sucursales sin emisor', () => {
    const f = llena();
    f.emisores.push({ id: 'x', ruc: '20600000005', razonSocial: 'Otra', regimen: 'RER' });
    f.sucursales.push({ ...f.sucursales[0]!, id: 'y', emisorId: '' });
    const errores = validarAlta(f, hoy);
    expect(errores['emisores.1.ruc']).toBe('Este RUC ya está en la lista');
    expect(errores['sucursales.1.rucEmisor']).toBe('Elige el emisor de la sucursal');
    f.sucursales[1]!.emisorId = f.emisores[0]!.id;
    const otra = validarAlta(f, hoy);
    expect(otra['sucursales.1.codigoEstablecimiento']).toBe(
      'Este emisor ya tiene una sucursal con ese código',
    );
    expect(otra['sucursales.1.nombre']).toBe('Ya hay una sucursal con este nombre');
  });

  it('exige contraseña de 8 a 128 caracteres y usuario con el formato de la API', () => {
    const f = llena();
    f.administrador.contrasenaTemporal = '1234567';
    f.administrador.nombreUsuario = 'a b';
    const e = validarAlta(f, hoy);
    expect(e['administrador.contrasenaTemporal']).toBe('Usa al menos 8 caracteres');
    expect(e['administrador.nombreUsuario']).toMatch(/3 a 50 caracteres/);
    f.administrador.contrasenaTemporal = 'x'.repeat(129);
    expect(validarAlta(f, hoy)['administrador.contrasenaTemporal']).toBe(
      'Usa 128 caracteres como máximo',
    );
  });

  it('el vencimiento y las fechas opcionales', () => {
    expect(validarFechaOpcional('', hoy)).toBeUndefined();
    expect(validarFechaOpcional('2026-10-27', hoy)).toBeUndefined();
    expect(validarFechaOpcional('2026-10-26', hoy)).toBe('No puede ser anterior a hoy');
    expect(validarFechaOpcional('2026-02-30', hoy)).toBe('Esa fecha no existe');
    expect(validarFechaOpcional('27/10/2026', hoy)).toBe('Elige una fecha válida');
  });

  it('manda la suscripción solo con lo que se eligió', () => {
    const f = llena();
    f.sucursales[0]!.planId = 'plan-1';
    expect(entradaDeAlta(f).sucursales[0]?.suscripcion).toEqual({ planId: 'plan-1' });
    f.sucursales[0]!.vencimiento = '2026-12-01';
    expect(entradaDeAlta(f).sucursales[0]?.suscripcion).toEqual({
      planId: 'plan-1',
      vencimiento: '2026-12-01',
    });
  });
});

describe('plan: formulario', () => {
  const original = {
    id: 'p1',
    codigo: 'PRO',
    nombre: 'Pro',
    precioMensual: '120.00',
    cuotaComprobantesMes: 500,
    precioExcedente: '0.0500',
    diasGracia: 10,
    modulos: ['CAJA', 'SALON'] as ('CAJA' | 'SALON')[],
    porDefecto: false,
    activo: true,
    creadoEn: '2026-10-01T00:00:00.000Z',
    actualizadoEn: '2026-10-01T00:00:00.000Z',
  };

  it('un plan nuevo empieza con todos los módulos y 7 días de gracia', () => {
    const f = planVacio();
    expect(f.diasGracia).toBe('7');
    expect(Object.values(f.modulos).every(Boolean)).toBe(true);
  });

  it('valida cada campo', () => {
    const f = planVacio();
    f.precioMensual = '12.345';
    f.cuotaComprobantesMes = '-1';
    f.precioExcedente = '1.23456';
    f.diasGracia = '61';
    const e = validarPlan(f);
    expect(Object.keys(e).sort()).toEqual(
      [
        'codigo',
        'nombre',
        'precioMensual',
        'cuotaComprobantesMes',
        'precioExcedente',
        'diasGracia',
        'motivo',
      ].sort(),
    );
    f.codigo = 'X';
    f.nombre = 'X';
    f.precioMensual = '';
    f.cuotaComprobantesMes = '';
    f.precioExcedente = '';
    f.diasGracia = '0';
    f.motivo = 'm';
    expect(validarPlan(f)).toEqual({});
    expect(entradaDePlan(f)).toMatchObject({
      precioMensual: null,
      cuotaComprobantesMes: null,
      precioExcedente: null,
      diasGracia: 0,
    });
  });

  it('sin cambios no hay nada que enviar; con cambios solo viaja lo que cambió', () => {
    const f = formularioDePlan(original);
    expect(hayCambiosDePlan(cambiosDelPlan(original, f))).toBe(false);
    f.motivo = 'Prueba';
    f.diasGracia = '15';
    f.cuotaComprobantesMes = '';
    f.modulos = { ...f.modulos, SALON: false };
    expect(cambiosDelPlan(original, f)).toEqual({
      motivo: 'Prueba',
      diasGracia: 15,
      cuotaComprobantesMes: null,
      modulos: ['CAJA'],
    });
  });

  it('el orden de los módulos del plan no cuenta como un cambio', () => {
    const f = formularioDePlan({ ...original, modulos: ['SALON', 'CAJA'] });
    expect(hayCambiosDePlan(cambiosDelPlan({ ...original, modulos: ['SALON', 'CAJA'] }, f))).toBe(
      false,
    );
  });
});

describe('clave de escritura', () => {
  const error = (extra: Partial<ConstructorParameters<typeof ErrorApi>[0]>) =>
    new ErrorApi({ estado: 400, codigo: 'X', mensaje: '', ...extra });

  it('es la misma hasta que se suelta', () => {
    const { result } = renderHook(() => useClaveDeEscritura());
    const a = result.current.obtener();
    expect(result.current.obtener()).toBe(a);
    result.current.soltar();
    expect(result.current.obtener()).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('se conserva si el resultado de la escritura es dudoso y se suelta si fue un rechazo claro', () => {
    const { result } = renderHook(() => useClaveDeEscritura());
    const a = result.current.obtener();
    result.current.alFallar(error({ estado: 0, codigo: 'SIN_CONEXION' }));
    expect(result.current.obtener()).toBe(a);
    result.current.alFallar(error({ estado: 503 }));
    expect(result.current.obtener()).toBe(a);
    result.current.alFallar(error({ reintentada: true }));
    expect(result.current.obtener()).toBe(a);
    result.current.alFallar(error({ estado: 409, codigo: 'CONFLICTO' }));
    expect(result.current.obtener()).not.toBe(a);
  });

  it('las claves nuevas son distintas entre sí', () => {
    expect(nuevaClaveDeIdempotencia()).not.toBe(nuevaClaveDeIdempotencia());
  });
});
