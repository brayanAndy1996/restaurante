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
