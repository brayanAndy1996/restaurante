// Historia 004, grupo C1 (criterios 63b y 63c, decisión 11): la regla única de inactividad, sin base de datos.
// Pruebas del desarrollador (no protegidas); la protegida `salon-critica/inactividad-cocina.spec.ts` la recorre
// por HTTP con el reloj de la API.
import { ROLES } from '@restaurante/dominio';
import { describe, expect, it } from 'vitest';
import { minutosDeInactividad } from '../../src/modulos/seguridad/inactividad';

const base = { minutosSucursal: null, minutosCocina: null, minutosSesion: 30 } as const;

describe('minutosDeInactividad', () => {
  it('Cocina/Barra usa minutosInactividadCocina (60 por defecto), con PIN y con contraseña', () => {
    for (const tipo of ['PIN', 'CONTRASENA'] as const) {
      expect(minutosDeInactividad({ ...base, tipo, rol: 'COCINA_BARRA' })).toBe(60);
      expect(
        minutosDeInactividad({
          ...base,
          tipo,
          rol: 'COCINA_BARRA',
          minutosSucursal: 12,
          minutosCocina: 720,
        }),
      ).toBe(720);
    }
  });

  it('los demás roles: PIN con los minutos de la sucursal (5 por defecto), contraseña con los 30 guardados', () => {
    for (const rol of ROLES.filter((r) => r !== 'COCINA_BARRA')) {
      expect(minutosDeInactividad({ ...base, tipo: 'PIN', rol })).toBe(5);
      expect(
        minutosDeInactividad({ ...base, tipo: 'PIN', rol, minutosSucursal: 12, minutosCocina: 90 }),
      ).toBe(12);
      expect(
        minutosDeInactividad({
          ...base,
          tipo: 'CONTRASENA',
          rol,
          minutosSucursal: 12,
          minutosCocina: 90,
        }),
      ).toBe(30);
    }
  });

  it('sin sucursal activa (sin rol): PIN 5 y contraseña 30, aunque la configuración de Cocina/Barra exista', () => {
    expect(minutosDeInactividad({ ...base, tipo: 'PIN', rol: null, minutosCocina: 90 })).toBe(5);
    expect(
      minutosDeInactividad({ ...base, tipo: 'CONTRASENA', rol: null, minutosCocina: 90 }),
    ).toBe(30);
  });

  it('el soporte conserva lo guardado (30), también con un rol que no es el suyo', () => {
    for (const rol of [null, 'ADMINISTRADOR', 'COCINA_BARRA'] as const) {
      expect(
        minutosDeInactividad({
          ...base,
          tipo: 'SOPORTE',
          rol,
          minutosSucursal: 7,
          minutosCocina: 90,
        }),
      ).toBe(30);
    }
  });
});
