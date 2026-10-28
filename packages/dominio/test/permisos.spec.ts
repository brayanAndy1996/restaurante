// spec: 002-plataforma-y-acceso (pruebas protegidas)
// Ajustado por 003-carta, decisión del usuario 5 (2026-10-28): EDITAR_CARTA permitido para el Cajero.
//
// P6 · Criterios 43 y 53 (matriz) · `requisitoPermiso`, `puedeAutorizar`, `alcanceReportes` y
// `permisosDeRol` de `packages/dominio`: una prueba por cada celda de la tabla "Roles y permisos" del
// documento de diseño (copiada en "Reglas de negocio" de la especificación).
import { describe, expect, it } from 'vitest';
import {
  ACCIONES,
  ROLES,
  alcanceReportes,
  permisosDeRol,
  puedeAutorizar,
  requisitoPermiso,
  type Accion,
  type RequisitoPermiso,
  type Rol,
} from '../src';

type Fila = readonly [
  mozo: RequisitoPermiso,
  cajero: RequisitoPermiso,
  cocinaBarra: RequisitoPermiso,
  supervisor: RequisitoPermiso,
  administrador: RequisitoPermiso,
];

const ORDEN_DE_ROLES: readonly Rol[] = [
  'MOZO',
  'CAJERO',
  'COCINA_BARRA',
  'SUPERVISOR',
  'ADMINISTRADOR',
];

const p = 'permitido';
const c = 'clave';
const x = 'prohibido';

/** La tabla de la especificación, celda por celda (columnas: Mozo, Cajero, Cocina/Barra, Supervisor, Administrador). */
const MATRIZ: Record<Accion, Fila> = {
  ATENDER_MESA: [p, p, x, p, p],
  MOVER_UNIR_MESAS: [p, p, x, p, p],
  ANULAR_ITEM_ENVIADO: [c, c, x, p, p],
  APLICAR_DESCUENTO: [c, c, x, p, p],
  APLICAR_CORTESIA: [c, c, x, p, p],
  ANULAR_ORDEN: [c, c, x, p, p],
  GESTIONAR_PEDIDOS_WEB: [x, p, x, p, p],
  COBRAR: [x, p, x, p, p],
  EMITIR_NOTA_CREDITO: [x, c, x, p, p],
  OPERAR_CAJA: [x, p, x, p, p],
  USAR_KDS: [x, x, p, p, p],
  GESTIONAR_DISPONIBILIDAD: [x, x, p, p, p],
  REGISTRAR_INGRESO_MERCADERIA: [x, p, x, p, p],
  AJUSTAR_STOCK: [x, x, x, p, p],
  EDITAR_CARTA: [x, p, x, x, p],
  ADMINISTRAR: [x, x, x, x, p],
};

const CELDAS = (Object.keys(MATRIZ) as Accion[]).flatMap((accion) =>
  ORDEN_DE_ROLES.map((rol, i) => ({
    accion,
    rol,
    esperado: MATRIZ[accion][i] as RequisitoPermiso,
  })),
);

describe('catálogo de roles y acciones', () => {
  it('los roles son los cinco de la matriz', () => {
    expect([...ROLES].sort()).toEqual([...ORDEN_DE_ROLES].sort());
  });

  it('las acciones son exactamente las 16 de la tabla', () => {
    expect([...ACCIONES].sort()).toEqual(Object.keys(MATRIZ).sort());
    expect(ACCIONES).toHaveLength(16);
  });
});

describe('requisitoPermiso: una prueba por celda (criterio 43)', () => {
  it.each(CELDAS)('$accion para $rol es $esperado', ({ accion, rol, esperado }) => {
    expect(requisitoPermiso(rol, accion)).toBe(esperado);
  });

  it('la matriz tiene 80 celdas (16 acciones por 5 roles)', () => {
    expect(CELDAS).toHaveLength(80);
  });
});

describe('puedeAutorizar: solo quien tiene la acción como permitido', () => {
  it.each(CELDAS)('$accion con $rol: $esperado', ({ accion, rol, esperado }) => {
    expect(puedeAutorizar(rol, accion)).toBe(esperado === 'permitido');
  });

  it('solo Supervisor y Administrador pueden autorizar una acción que exige clave a otros', () => {
    for (const accion of [
      'ANULAR_ITEM_ENVIADO',
      'APLICAR_DESCUENTO',
      'EMITIR_NOTA_CREDITO',
    ] as const) {
      expect(puedeAutorizar('MOZO', accion)).toBe(false);
      expect(puedeAutorizar('CAJERO', accion)).toBe(false);
      expect(puedeAutorizar('COCINA_BARRA', accion)).toBe(false);
      expect(puedeAutorizar('SUPERVISOR', accion)).toBe(true);
      expect(puedeAutorizar('ADMINISTRADOR', accion)).toBe(true);
    }
  });
});

describe('alcanceReportes', () => {
  it('Cajero ve su turno, Supervisor su sucursal y Administrador toda la empresa', () => {
    expect(alcanceReportes('CAJERO')).toBe('TURNO');
    expect(alcanceReportes('SUPERVISOR')).toBe('SUCURSAL');
    expect(alcanceReportes('ADMINISTRADOR')).toBe('EMPRESA');
  });

  it('Mozo y Cocina/Barra no ven reportes (null)', () => {
    expect(alcanceReportes('MOZO')).toBeNull();
    expect(alcanceReportes('COCINA_BARRA')).toBeNull();
  });
});

describe('permisosDeRol (es el campo `permisos` de GET /sesion)', () => {
  it.each(ORDEN_DE_ROLES.map((rol, i) => ({ rol, i })))(
    'devuelve el requisito de cada acción para $rol',
    ({ rol, i }) => {
      const esperado = Object.fromEntries(
        (Object.keys(MATRIZ) as Accion[]).map((accion) => [accion, MATRIZ[accion][i]]),
      );
      expect(permisosDeRol(rol)).toEqual(esperado);
    },
  );

  it('trae una entrada por cada acción, sin sobrantes', () => {
    for (const rol of ROLES) {
      expect(Object.keys(permisosDeRol(rol)).sort()).toEqual([...ACCIONES].sort());
    }
  });

  it('coincide con requisitoPermiso celda por celda', () => {
    for (const rol of ROLES) {
      const permisos = permisosDeRol(rol);
      for (const accion of ACCIONES) {
        expect(permisos[accion]).toBe(requisitoPermiso(rol, accion));
      }
    }
  });
});
