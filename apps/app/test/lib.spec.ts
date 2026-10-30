import { describe, expect, it } from 'vitest';
import {
  borrarTokenDeEquipo,
  guardarSoporteEnCurso,
  guardarTokenDeEquipo,
  guardarTokenDeSesion,
  soporteEnCurso,
  tokenDeEquipo,
  tokenDeSesion,
  tokensDeEquipo,
} from '../src/lib/almacen';
import {
  ErrorApi,
  errorDeRespuesta,
  erroresPorCampo,
  mensajeDeError,
  textoDeEspera,
} from '../src/lib/errores';
import {
  etiquetaDeRol,
  fechaLarga,
  formatearFecha,
  pluralSucursales,
  relojDeCuenta,
} from '../src/lib/formato';
import { formatearMonto } from '../src/lib/monto';
import { textoDePrecio } from '../src/modulos/plataforma/plataforma';
import { montoNormalizado } from '../src/modulos/plataforma/SuscripcionDetallePagina';

const error = (codigo: string, extra: Partial<ConstructorParameters<typeof ErrorApi>[0]> = {}) =>
  new ErrorApi({ estado: 400, codigo, mensaje: 'x', ...extra });

describe('mensajes de error', () => {
  it('dicen el problema y la salida, en trato de "tú" y sin códigos', () => {
    expect(mensajeDeError(error('CREDENCIALES_INVALIDAS'))).toBe(
      'Tu usuario o contraseña no son correctos. Revisa y vuelve a intentar.',
    );
    expect(mensajeDeError(error('SIN_CONEXION', { estado: 0 }))).toContain('Revisa tu internet');
    expect(mensajeDeError(error('FUERA_DE_HORARIO'))).toContain('fuera de tu horario');
    expect(mensajeDeError(error('ULTIMO_ADMINISTRADOR'))).toContain('administrador activo');
    for (const c of [
      'CREDENCIALES_INVALIDAS',
      'BLOQUEO_TEMPORAL',
      'PROHIBIDO',
      'DATOS_INVALIDOS',
      'ERROR_INTERNO',
    ]) {
      expect(mensajeDeError(error(c, { estado: c === 'ERROR_INTERNO' ? 500 : 400 }))).not.toMatch(
        /\b(40\d|50\d|HTTP)\b/,
      );
    }
  });

  it('el bloqueo dice cuánto falta', () => {
    expect(mensajeDeError(error('BLOQUEO_TEMPORAL', { reintentarEnSegundos: 840 }))).toContain(
      '14 minutos',
    );
    expect(mensajeDeError(error('BLOQUEO_TEMPORAL', { reintentarEnSegundos: 40 }))).toContain(
      '40 segundos',
    );
    expect(textoDeEspera(60)).toBe('1 minuto');
    expect(textoDeEspera(61)).toBe('2 minutos');
  });

  it('cada pantalla puede decir algo más preciso para un código', () => {
    expect(mensajeDeError(error('CONFLICTO'), { CONFLICTO: 'Ese usuario ya existe.' })).toBe(
      'Ese usuario ya existe.',
    );
  });

  it('un error desconocido no filtra detalles', () => {
    expect(mensajeDeError(new Error('boom'))).toBe('Algo salió mal. Inténtalo de nuevo.');
    expect(mensajeDeError(error('ERROR_INTERNO', { estado: 500 }))).toContain('de nuestro lado');
  });

  it('interpreta el cuerpo de la API y tolera cuerpos que no son de la API', () => {
    const e = errorDeRespuesta(400, {
      codigo: 'DATOS_INVALIDOS',
      mensaje: 'x',
      campos: [{ campo: 'horario', mensaje: 'mal' }],
    });
    expect(e.codigo).toBe('DATOS_INVALIDOS');
    expect(erroresPorCampo(e)).toEqual({ horario: 'mal' });
    expect(errorDeRespuesta(502, '<html>').codigo).toBe('ERROR_INTERNO');
    expect(errorDeRespuesta(404, null).codigo).toBe('PETICION_INVALIDA');
  });
});

describe('almacenamiento de credenciales', () => {
  it('guarda un token de equipo por empresa y los conserva', () => {
    guardarTokenDeEquipo('empresa-a', 'eq.a.1.x');
    guardarTokenDeEquipo('empresa-b', 'eq.b.2.y');
    expect(tokenDeEquipo('empresa-a')).toBe('eq.a.1.x');
    expect(tokensDeEquipo()).toEqual({ 'empresa-a': 'eq.a.1.x', 'empresa-b': 'eq.b.2.y' });
    borrarTokenDeEquipo('empresa-a');
    expect(tokensDeEquipo()).toEqual({ 'empresa-b': 'eq.b.2.y' });
  });

  it('descarta valores que no son tokens de equipo (almacenamiento alterado)', () => {
    localStorage.setItem(
      'restaurante.equipos',
      JSON.stringify({ a: 'se.otro', b: 42, c: 'eq.c.3.z' }),
    );
    expect(tokensDeEquipo()).toEqual({ c: 'eq.c.3.z' });
    localStorage.setItem('restaurante.equipos', '{no es json');
    expect(tokensDeEquipo()).toEqual({});
  });

  it('la sesión vive en sessionStorage y el equipo en localStorage', () => {
    guardarTokenDeSesion('se.a.b.c');
    guardarTokenDeEquipo('a', 'eq.a.1.x');
    expect(sessionStorage.getItem('restaurante.sesion')).toContain('se.a.b.c');
    expect(localStorage.getItem('restaurante.sesion')).toBeNull();
    expect(localStorage.getItem('restaurante.equipos')).toContain('eq.a.1.x');
    expect(tokenDeSesion()).toBe('se.a.b.c');
  });

  it('nunca guarda un PIN ni una contraseña', () => {
    guardarTokenDeSesion('se.a.b.c');
    guardarSoporteEnCurso({
      empresaId: 'a',
      empresaNombre: 'Empresa',
      iniciadoEn: new Date().toISOString(),
    });
    expect(soporteEnCurso()?.empresaNombre).toBe('Empresa');
    const todo = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(todo).not.toMatch(/pin|contrasena|password/i);
  });
});

describe('formato', () => {
  it('dice los roles como en el negocio', () => {
    expect(etiquetaDeRol('COCINA_BARRA')).toBe('Cocina/Barra');
    expect(etiquetaDeRol('ADMINISTRADOR')).toBe('Administrador');
  });

  it('fechas sin zonas horarias de por medio', () => {
    expect(formatearFecha('2026-11-10')).toBe('10/11/2026');
    expect(fechaLarga('2026-11-18')).toBe('18 de noviembre de 2026');
  });

  it('cuenta regresiva y plurales', () => {
    expect(relojDeCuenta(272)).toBe('4:32');
    expect(relojDeCuenta(0)).toBe('0:00');
    expect(relojDeCuenta(-5)).toBe('0:00');
    expect(pluralSucursales(1)).toBe('1 sucursal');
    expect(pluralSucursales(3)).toBe('3 sucursales');
  });
});

describe('montos sin coma flotante', () => {
  it('redondea medio hacia arriba lo que un número de coma flotante deja abajo', () => {
    // Number(1.005).toFixed(2) da "1.00" y Number(1234.005).toFixed(2) da "1234.00".
    expect(formatearMonto('1.005')).toBe('1.01');
    expect(formatearMonto('1234.005')).toBe('1,234.01');
    expect(formatearMonto('8.345')).toBe('8.35');
  });

  it('rellena con ceros y agrupa miles', () => {
    expect(formatearMonto('120')).toBe('120.00');
    expect(formatearMonto('0.1')).toBe('0.10');
    expect(formatearMonto('12345678.9')).toBe('12,345,678.90');
    expect(formatearMonto(' 0.30 ')).toBe('0.30');
  });

  it('no pierde dígitos en montos que un número de coma flotante no representa', () => {
    expect(formatearMonto('9007199254740993.10')).toBe('9,007,199,254,740,993.10');
  });

  it('admite un mínimo y un máximo de decimales distintos', () => {
    const precio = { minDecimales: 2, maxDecimales: 4 };
    expect(formatearMonto('0.0500', precio)).toBe('0.05');
    expect(formatearMonto('0.12345', precio)).toBe('0.1235');
    expect(formatearMonto('1.5', precio)).toBe('1.50');
  });

  it('no deja un cero negativo y conserva el signo del resto', () => {
    expect(formatearMonto('-0.001')).toBe('0.00');
    expect(formatearMonto('-1234.5')).toBe('-1,234.50');
  });

  it('devuelve null si no es un número finito', () => {
    for (const texto of ['', '  ', 'abc', 'S/ 10', 'NaN', 'Infinity']) {
      expect(formatearMonto(texto)).toBeNull();
    }
  });

  it('el precio de un plan usa el mismo formato y deja el texto raro como llegó', () => {
    expect(textoDePrecio('1234.005')).toBe('S/ 1,234.005');
    expect(textoDePrecio('1.00005')).toBe('S/ 1.0001');
    expect(textoDePrecio('sin precio')).toBe('sin precio');
  });

  it('el monto de un pago solo acepta importes positivos, también los casi cero', () => {
    expect(montoNormalizado('0.01')).toBe('0.01');
    expect(montoNormalizado('0.0')).toBeNull();
    expect(montoNormalizado('0,00')).toBeNull();
    expect(montoNormalizado('1234.005')).toBeNull();
  });
});
