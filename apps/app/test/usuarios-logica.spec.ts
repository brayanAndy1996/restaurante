import type { UsuarioRespuesta } from '@restaurante/contratos';
import { usuarioCrearEntradaSchema } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  cambiosDelUsuario,
  entradaDeCreacion,
  formularioDeUsuario,
  formularioVacio,
  generarContrasenaTemporal,
  hayCambios,
  largoDePinDelFormulario,
  resumenDeAccesos,
  validarFormulario,
  type EstadoDelFormulario,
} from '../src/modulos/administracion/usuarios';
import { ID } from './ayudas';

const usuario = (parcial: Partial<UsuarioRespuesta> = {}): UsuarioRespuesta => ({
  id: ID.otro,
  nombre: 'Rosa Quispe',
  nombreUsuario: 'rosa.quispe',
  esAdministrador: false,
  accesos: [{ sucursalId: ID.sucursalA, rol: 'MOZO' }],
  activo: true,
  horario: null,
  largoPin: 4,
  contrasenaTemporal: false,
  equiposRecordados: 0,
  creadoEn: '2026-10-27T10:00:00.000Z',
  actualizadoEn: '2026-10-27T10:00:00.000Z',
  ...parcial,
});

const nombres = new Map([
  [ID.sucursalA, 'Miraflores'],
  [ID.sucursalB, 'Surco'],
]);

function completo(parcial: Partial<EstadoDelFormulario> = {}): EstadoDelFormulario {
  return {
    ...formularioVacio(),
    nombre: 'Rosa Quispe',
    nombreUsuario: 'Rosa.Quispe',
    contrasenaTemporal: 'Temporal-1',
    accesos: { [ID.sucursalA]: 'MOZO' },
    ...parcial,
  };
}

describe('validar el formulario de usuario', () => {
  it('un formulario completo no tiene errores y cumple el contrato de la API', () => {
    const estado = completo();
    expect(validarFormulario(estado, 'crear')).toEqual({});
    expect(usuarioCrearEntradaSchema.safeParse(entradaDeCreacion(estado)).success).toBe(true);
  });

  it('el nombre de usuario se guarda en minúsculas', () => {
    expect(entradaDeCreacion(completo()).nombreUsuario).toBe('rosa.quispe');
  });

  it('dice qué falta con frases claras', () => {
    const errores = validarFormulario(formularioVacio(), 'crear');
    expect(errores).toEqual({
      nombre: 'Escribe el nombre de la persona',
      nombreUsuario: 'Escribe un nombre de usuario',
      contrasenaTemporal: 'Escribe una contraseña temporal o genera una',
      accesos: 'Elige el rol en al menos una sucursal',
    });
  });

  it('rechaza un nombre de usuario con espacios o tildes y una contraseña corta', () => {
    const errores = validarFormulario(
      completo({ nombreUsuario: 'rosa quispe', contrasenaTemporal: 'corta' }),
      'crear',
    );
    expect(errores.nombreUsuario).toContain('3 a 50 caracteres');
    expect(errores.contrasenaTemporal).toBe('Usa al menos 8 caracteres');
  });

  it('al editar no pide usuario ni contraseña', () => {
    expect(
      validarFormulario(completo({ nombreUsuario: '', contrasenaTemporal: '' }), 'editar'),
    ).toEqual({});
  });

  it('un administrador no necesita accesos ni horario', () => {
    expect(
      validarFormulario(
        completo({ esAdministrador: true, accesos: {}, limitarHorario: true, horario: [] }),
        'crear',
      ),
    ).toEqual({});
    expect(
      entradaDeCreacion(
        completo({
          esAdministrador: true,
          limitarHorario: true,
          horario: [{ dia: 1, desde: '10:00', hasta: '12:00' }],
        }),
      ),
    ).toMatchObject({
      accesos: [],
    });
    expect(
      entradaDeCreacion(
        completo({
          esAdministrador: true,
          limitarHorario: true,
          horario: [{ dia: 1, desde: '10:00', hasta: '12:00' }],
        }),
      ),
    ).not.toHaveProperty('horario');
  });

  it('con horario exige al menos un tramo y que los tramos no se crucen', () => {
    expect(validarFormulario(completo({ limitarHorario: true }), 'crear').horario).toContain(
      'al menos un tramo',
    );
    const cruzados = completo({
      limitarHorario: true,
      horario: [
        { dia: 5, desde: '18:00', hasta: '02:00' },
        { dia: 6, desde: '01:00', hasta: '03:00' },
      ],
    });
    expect(validarFormulario(cruzados, 'crear').horario).toContain('tramos marcados');
  });

  it('el largo del PIN lo da packages/dominio', () => {
    expect(largoDePinDelFormulario(completo())).toBe(4);
    expect(
      largoDePinDelFormulario(
        completo({ accesos: { [ID.sucursalA]: 'MOZO', [ID.sucursalB]: 'CAJERO' } }),
      ),
    ).toBe(6);
    expect(largoDePinDelFormulario(completo({ esAdministrador: true }))).toBe(6);
  });
});

describe('cambios al editar un usuario', () => {
  it('sin tocar nada, no hay cambios', () => {
    const u = usuario();
    expect(hayCambios(cambiosDelUsuario(u, formularioDeUsuario(u)))).toBe(false);
  });

  it('envía solo lo que cambió', () => {
    const u = usuario();
    const estado = { ...formularioDeUsuario(u), nombre: 'Rosa Quispe Díaz' };
    expect(cambiosDelUsuario(u, estado)).toEqual({ nombre: 'Rosa Quispe Díaz' });
  });

  it('cambiar un acceso envía todos los accesos', () => {
    const u = usuario();
    const estado = {
      ...formularioDeUsuario(u),
      accesos: { [ID.sucursalA]: 'MOZO' as const, [ID.sucursalB]: 'CAJERO' as const },
    };
    expect(cambiosDelUsuario(u, estado).accesos).toEqual([
      { sucursalId: ID.sucursalA, rol: 'MOZO' },
      { sucursalId: ID.sucursalB, rol: 'CAJERO' },
    ]);
  });

  it('el orden de los tramos no cuenta como un cambio', () => {
    const horario = [
      { dia: 2, desde: '11:00', hasta: '15:00' },
      { dia: 1, desde: '11:00', hasta: '15:00' },
    ];
    const u = usuario({ horario });
    expect(hayCambios(cambiosDelUsuario(u, formularioDeUsuario(u)))).toBe(false);
  });

  it('quitar el límite de horario envía null', () => {
    const u = usuario({ horario: [{ dia: 1, desde: '11:00', hasta: '15:00' }] });
    const estado = { ...formularioDeUsuario(u), limitarHorario: false };
    expect(cambiosDelUsuario(u, estado)).toEqual({ horario: null });
  });

  it('hacer administrador a alguien con horario envía también horario null (criterio 106)', () => {
    const u = usuario({ horario: [{ dia: 1, desde: '11:00', hasta: '15:00' }] });
    const estado = { ...formularioDeUsuario(u), esAdministrador: true, accesos: {} };
    expect(cambiosDelUsuario(u, estado)).toEqual({
      esAdministrador: true,
      accesos: [],
      horario: null,
    });
  });
});

describe('presentación', () => {
  it('resume los accesos en una línea', () => {
    expect(resumenDeAccesos(usuario({ esAdministrador: true, accesos: [] }), nombres)).toBe(
      'Administrador · todas las sucursales',
    );
    expect(resumenDeAccesos(usuario(), nombres)).toBe('Mozo · Miraflores');
    expect(
      resumenDeAccesos(
        usuario({
          accesos: [
            { sucursalId: ID.sucursalA, rol: 'MOZO' },
            { sucursalId: ID.sucursalB, rol: 'MOZO' },
          ],
        }),
        nombres,
      ),
    ).toBe('Mozo · 2 sucursales');
    expect(
      resumenDeAccesos(
        usuario({
          accesos: [
            { sucursalId: ID.sucursalA, rol: 'MOZO' },
            { sucursalId: ID.sucursalB, rol: 'CAJERO' },
          ],
        }),
        nombres,
      ),
    ).toBe('Mozo en Miraflores, Cajero en Surco');
  });

  it('la contraseña temporal generada es legible y válida', () => {
    for (let i = 0; i < 50; i++) {
      const c = generarContrasenaTemporal();
      expect(c).toHaveLength(10);
      expect(c).not.toMatch(/[01OIl]/);
    }
    expect(new Set(Array.from({ length: 20 }, () => generarContrasenaTemporal())).size).toBe(20);
  });
});
