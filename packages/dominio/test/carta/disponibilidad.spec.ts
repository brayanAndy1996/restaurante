// Historia 003, criterio 59 (T23): reglas puras de disponibilidad de la carta. Pruebas del desarrollador (no
// protegidas): cada motivo, su prioridad, el menú sin armar, las opciones insuficientes y la vigencia de un
// agotado con los ejemplos del criterio 44.
import { describe, expect, it } from 'vitest';
import {
  MOTIVOS_NO_VENDIBLE,
  agotadoVigente,
  diaOperativo,
  vendibilidad,
  type ProductoParaVendibilidad,
} from '../../src';

const base: ProductoParaVendibilidad = {
  activo: true,
  disponibleEnSucursal: true,
  agotado: false,
  tipo: 'SIMPLE',
  precio: '28.00',
  componentes: [],
  grupos: [],
  opcionesDelDia: 0,
};

const con = (cambios: Partial<ProductoParaVendibilidad>): ProductoParaVendibilidad => ({
  ...base,
  ...cambios,
});

describe('agotadoVigente (criterios 44 y 59)', () => {
  it('REACTIVAR vale siempre, también si el día cambió', () => {
    expect(agotadoVigente({ diaOperativo: '2026-11-03', hasta: 'REACTIVAR' }, '2026-11-03')).toBe(
      true,
    );
    expect(agotadoVigente({ diaOperativo: '2026-11-03', hasta: 'REACTIVAR' }, '2026-12-25')).toBe(
      true,
    );
  });

  it('FIN_DEL_DIA vale mientras el día operativo sea el de la marca', () => {
    expect(agotadoVigente({ diaOperativo: '2026-11-03', hasta: 'FIN_DEL_DIA' }, '2026-11-03')).toBe(
      true,
    );
    expect(agotadoVigente({ diaOperativo: '2026-11-03', hasta: 'FIN_DEL_DIA' }, '2026-11-04')).toBe(
      false,
    );
  });

  it('FIN_DEL_DIA no vale para un día anterior al de la marca (la hora de corte cambió)', () => {
    expect(agotadoVigente({ diaOperativo: '2026-11-04', hasta: 'FIN_DEL_DIA' }, '2026-11-03')).toBe(
      false,
    );
  });

  describe('ejemplos del criterio 44 con hora de corte 05:00', () => {
    const corte = '05:00';
    const vigente = (marcado: string, ahora: string): boolean =>
      agotadoVigente(
        { diaOperativo: diaOperativo(new Date(marcado), corte), hasta: 'FIN_DEL_DIA' },
        diaOperativo(new Date(ahora), corte),
      );

    it('marcado el 3 a las 21:00 sigue agotado a las 04:59 del 4 y deja de estarlo a las 05:00', () => {
      expect(vigente('2026-11-03T21:00:00-05:00', '2026-11-04T04:59:00-05:00')).toBe(true);
      expect(vigente('2026-11-03T21:00:00-05:00', '2026-11-04T05:00:00-05:00')).toBe(false);
    });

    it('marcado el 4 a las 02:00 (día operativo 3) deja de estarlo a las 05:00 del 4', () => {
      expect(vigente('2026-11-04T02:00:00-05:00', '2026-11-04T04:59:00-05:00')).toBe(true);
      expect(vigente('2026-11-04T02:00:00-05:00', '2026-11-04T05:00:00-05:00')).toBe(false);
    });
  });
});

describe('vendibilidad (criterio 59)', () => {
  it('un producto simple activo, disponible y sin agotar es vendible, sin motivo', () => {
    expect(vendibilidad(base)).toEqual({ vendible: true, motivo: null });
  });

  it('cada motivo, solo', () => {
    expect(vendibilidad(con({ activo: false }))).toEqual({ vendible: false, motivo: 'INACTIVO' });
    expect(vendibilidad(con({ disponibleEnSucursal: false }))).toEqual({
      vendible: false,
      motivo: 'NO_DISPONIBLE',
    });
    expect(vendibilidad(con({ agotado: true }))).toEqual({ vendible: false, motivo: 'AGOTADO' });
    expect(vendibilidad(con({ componentes: [{ disponible: true }, { disponible: false }] }))).toEqual(
      { vendible: false, motivo: 'COMPONENTE_NO_DISPONIBLE' },
    );
    expect(vendibilidad(con({ tipo: 'MENU_DEL_DIA', opcionesDelDia: 0 }))).toEqual({
      vendible: false,
      motivo: 'MENU_SIN_ARMAR',
    });
    expect(
      vendibilidad(
        con({ grupos: [{ minimo: 1, modificadores: [{ disponible: false }, { disponible: false }] }] }),
      ),
    ).toEqual({ vendible: false, motivo: 'OPCIONES_INSUFICIENTES' });
  });

  describe('prioridad: gana el primer motivo de MOTIVOS_NO_VENDIBLE', () => {
    // Un producto al que le aplican todos los motivos; se va corrigiendo uno por uno, en orden.
    const todo = con({
      activo: false,
      disponibleEnSucursal: false,
      agotado: true,
      tipo: 'MENU_DEL_DIA',
      componentes: [{ disponible: false }],
      grupos: [{ minimo: 1, modificadores: [{ disponible: false }] }],
      opcionesDelDia: 0,
    });

    it('en cadena, cada corrección deja ver el motivo siguiente', () => {
      const vistos: (string | null)[] = [];
      let producto = todo;
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, activo: true };
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, disponibleEnSucursal: true };
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, agotado: false };
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, componentes: [{ disponible: true }] };
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, opcionesDelDia: 3 };
      vistos.push(vendibilidad(producto).motivo);
      producto = { ...producto, grupos: [{ minimo: 1, modificadores: [{ disponible: true }] }] };
      vistos.push(vendibilidad(producto).motivo);
      expect(vistos).toEqual([...MOTIVOS_NO_VENDIBLE, null]);
    });

    it('agotado gana a un componente no disponible', () => {
      expect(vendibilidad(con({ agotado: true, componentes: [{ disponible: false }] })).motivo).toBe(
        'AGOTADO',
      );
    });

    it('un componente no disponible gana a un menú sin armar', () => {
      expect(
        vendibilidad(
          con({ tipo: 'MENU_DEL_DIA', opcionesDelDia: 0, componentes: [{ disponible: false }] }),
        ).motivo,
      ).toBe('COMPONENTE_NO_DISPONIBLE');
    });

    it('un menú sin armar gana a las opciones insuficientes', () => {
      expect(
        vendibilidad(
          con({
            tipo: 'MENU_DEL_DIA',
            opcionesDelDia: 0,
            grupos: [{ minimo: 1, modificadores: [] }],
          }),
        ).motivo,
      ).toBe('MENU_SIN_ARMAR');
    });
  });

  describe('menú del día', () => {
    it('con opciones del día y los grupos cubiertos es vendible', () => {
      expect(
        vendibilidad(
          con({
            tipo: 'MENU_DEL_DIA',
            opcionesDelDia: 4,
            grupos: [
              { minimo: 1, modificadores: [{ disponible: true }, { disponible: true }] },
              { minimo: 1, modificadores: [{ disponible: true }] },
            ],
          }),
        ),
      ).toEqual({ vendible: true, motivo: null });
    });

    it('sin opciones del día solo cuenta para el tipo MENU_DEL_DIA', () => {
      expect(vendibilidad(con({ tipo: 'COMBO', opcionesDelDia: 0 }))).toEqual({
        vendible: true,
        motivo: null,
      });
      expect(vendibilidad(con({ tipo: 'SIMPLE', opcionesDelDia: 0 }))).toEqual({
        vendible: true,
        motivo: null,
      });
    });

    it('un tiempo obligatorio sin platos disponibles deja el menú no vendible aunque otro tenga', () => {
      expect(
        vendibilidad(
          con({
            tipo: 'MENU_DEL_DIA',
            opcionesDelDia: 2,
            grupos: [
              { minimo: 1, modificadores: [{ disponible: true }] },
              { minimo: 1, modificadores: [{ disponible: false }] },
            ],
          }),
        ),
      ).toEqual({ vendible: false, motivo: 'OPCIONES_INSUFICIENTES' });
    });
  });

  describe('opciones insuficientes', () => {
    it('cuenta solo las disponibles contra el mínimo', () => {
      const grupo = (disponibles: boolean[], minimo: number) => ({
        minimo,
        modificadores: disponibles.map((disponible) => ({ disponible })),
      });
      expect(vendibilidad(con({ grupos: [grupo([true, false, true], 2)] })).vendible).toBe(true);
      expect(vendibilidad(con({ grupos: [grupo([true, false, false], 2)] })).motivo).toBe(
        'OPCIONES_INSUFICIENTES',
      );
    });

    it('un grupo opcional (mínimo 0) sin ninguna opción disponible no impide la venta', () => {
      expect(
        vendibilidad(con({ grupos: [{ minimo: 0, modificadores: [{ disponible: false }] }] })),
      ).toEqual({ vendible: true, motivo: null });
      expect(vendibilidad(con({ grupos: [{ minimo: 0, modificadores: [] }] })).vendible).toBe(true);
    });

    it('un modificador ligado a un producto agotado (disponible: false) agota la única opción obligatoria', () => {
      // El llamador resuelve `disponible` con el producto ligado (activo, disponible y sin agotar).
      expect(
        vendibilidad(
          con({
            grupos: [{ minimo: 1, modificadores: [{ disponible: false }, { disponible: true }] }],
          }),
        ).vendible,
      ).toBe(true);
      expect(
        vendibilidad(con({ grupos: [{ minimo: 1, modificadores: [{ disponible: false }] }] }))
          .motivo,
      ).toBe('OPCIONES_INSUFICIENTES');
    });
  });

  it('un producto que no se vende solo (sin precio) no es no vendible por eso', () => {
    expect(vendibilidad(con({ precio: null }))).toEqual({ vendible: true, motivo: null });
  });
});
