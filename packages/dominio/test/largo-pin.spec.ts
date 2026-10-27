// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// P3 · Largo del PIN según los roles de la persona (criterios 21 y 21b).
import { describe, expect, it } from 'vitest';
import { largoPin, type Rol } from '../src';

const ROLES_DE_ACCESO = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'] as const;

describe('largoPin · ejemplos del criterio 21', () => {
  it('Mozo en una sucursal → 4', () => {
    expect(largoPin({ esAdministrador: false, roles: ['MOZO'] })).toBe(4);
  });

  it('Mozo en S1 y Cocina/Barra en S2 → 4', () => {
    expect(largoPin({ esAdministrador: false, roles: ['MOZO', 'COCINA_BARRA'] })).toBe(4);
  });

  it('Mozo en S1 y Cajero en S2 → 6', () => {
    expect(largoPin({ esAdministrador: false, roles: ['MOZO', 'CAJERO'] })).toBe(6);
  });

  it('Administrador → 6', () => {
    expect(largoPin({ esAdministrador: true, roles: [] })).toBe(6);
  });
});

describe('largoPin · un solo rol', () => {
  it.each([
    ['MOZO', 4],
    ['COCINA_BARRA', 4],
    ['CAJERO', 6],
    ['SUPERVISOR', 6],
  ] as const)('%s → %i', (rol, largo) => {
    expect(largoPin({ esAdministrador: false, roles: [rol] })).toBe(largo);
  });
});

describe('largoPin · varios roles: manda el mayor', () => {
  it('Mozo y Cocina/Barra repetidos en varias sucursales → 4', () => {
    expect(
      largoPin({ esAdministrador: false, roles: ['MOZO', 'COCINA_BARRA', 'MOZO', 'COCINA_BARRA'] }),
    ).toBe(4);
  });

  it('Cocina/Barra y Supervisor → 6', () => {
    expect(largoPin({ esAdministrador: false, roles: ['COCINA_BARRA', 'SUPERVISOR'] })).toBe(6);
  });

  it('Cajero y Supervisor → 6', () => {
    expect(largoPin({ esAdministrador: false, roles: ['CAJERO', 'SUPERVISOR'] })).toBe(6);
  });

  it('no depende del orden de los roles', () => {
    expect(largoPin({ esAdministrador: false, roles: ['CAJERO', 'MOZO'] })).toBe(6);
    expect(largoPin({ esAdministrador: false, roles: ['MOZO', 'CAJERO'] })).toBe(6);
    expect(
      largoPin({ esAdministrador: false, roles: ['COCINA_BARRA', 'MOZO', 'SUPERVISOR'] }),
    ).toBe(6);
  });
});

describe('largoPin · el Administrador manda sobre cualquier acceso', () => {
  it('Administrador con roles de 4 dígitos → 6', () => {
    expect(largoPin({ esAdministrador: true, roles: ['MOZO'] })).toBe(6);
    expect(largoPin({ esAdministrador: true, roles: ['MOZO', 'COCINA_BARRA'] })).toBe(6);
  });

  it('Administrador con roles de 6 dígitos → 6', () => {
    expect(largoPin({ esAdministrador: true, roles: ['CAJERO'] })).toBe(6);
  });
});

describe('largoPin · todas las combinaciones de accesos', () => {
  function subconjuntos<T>(lista: readonly T[]): T[][] {
    const resultado: T[][] = [];
    for (let mascara = 1; mascara < 1 << lista.length; mascara++) {
      resultado.push(lista.filter((_, i) => (mascara & (1 << i)) !== 0));
    }
    return resultado;
  }

  it('6 si es Administrador o tiene Cajero o Supervisor; 4 si todos son Mozo o Cocina/Barra', () => {
    for (const roles of subconjuntos(ROLES_DE_ACCESO)) {
      const tieneSeis = roles.includes('CAJERO') || roles.includes('SUPERVISOR');
      expect(largoPin({ esAdministrador: false, roles }), `roles ${roles.join(', ')}`).toBe(
        tieneSeis ? 6 : 4,
      );
      expect(
        largoPin({ esAdministrador: true, roles: roles as Rol[] }),
        `administrador con ${roles.join(', ')}`,
      ).toBe(6);
    }
  });

  it('solo devuelve 4 o 6', () => {
    for (const roles of subconjuntos(ROLES_DE_ACCESO)) {
      expect([4, 6]).toContain(largoPin({ esAdministrador: false, roles }));
    }
  });
});

describe('largoPin · no modifica sus argumentos', () => {
  it('deja intacta la lista de roles', () => {
    const roles: Rol[] = ['MOZO', 'CAJERO'];
    largoPin({ esAdministrador: false, roles });
    expect(roles).toEqual(['MOZO', 'CAJERO']);
  });
});
