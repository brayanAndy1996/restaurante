import type { ProductoDeVenta } from '@restaurante/contratos';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afectadosPorAgotar,
  ayudaDeFila,
  cercaDelCorte,
  conAgotado,
  conIntencion,
  contar,
  estacionRecordada,
  estacionesDe,
  etiquetaDeAgotado,
  filtrarFamilias,
  minutosParaElCorte,
  motivoDeOpcionDelMenu,
  motivoEnPalabras,
  recordarEstacion,
  textoDeMinutos,
  vistaConIntenciones,
} from '../src/modulos/disponibilidad/agotados';

const E1 = 'e1000000-0000-4000-8000-0000000000e1';
const E2 = 'e2000000-0000-4000-8000-0000000000e2';
const id = (n: number) => `a${n}000000-0000-4000-8000-0000000000a${n}`;

function p(n: number, nombre: string, parcial: Partial<ProductoDeVenta> = {}): ProductoDeVenta {
  return {
    id: id(n),
    tipo: 'SIMPLE',
    nombre,
    descripcion: null,
    fotoUrl: null,
    precio: '10.00',
    seVendeSolo: true,
    afectacionIgv: 'GRAVADO',
    aplicaIcbper: false,
    estacionId: E1,
    tipoControlStock: 'SIN_CONTROL',
    agotado: null,
    vendible: true,
    motivo: null,
    grupos: [],
    componentes: [],
    ...parcial,
  };
}
const AGOTADO = {
  desde: '2026-10-29T15:00:00.000Z',
  hasta: 'FIN_DEL_DIA',
  origen: 'MANUAL',
} as const;
const familias = [
  { id: 'f1', nombre: 'Entradas', productos: [p(1, 'Ceviche mixto'), p(2, 'Ají de gallina')] },
  {
    id: 'f2',
    nombre: 'Bebidas',
    productos: [p(3, 'Chicha', { estacionId: E2, agotado: AGOTADO })],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('conAgotado y conIntencion (reglas de packages/dominio)', () => {
  it('marcar deja el producto no vendible con motivo AGOTADO y reactivar lo devuelve a vendible', () => {
    const marcado = conAgotado(p(1, 'Ceviche'), AGOTADO);
    expect(marcado).toMatchObject({ vendible: false, motivo: 'AGOTADO', agotado: AGOTADO });
    expect(conAgotado(marcado, null)).toMatchObject({
      vendible: true,
      motivo: null,
      agotado: null,
    });
  });

  it('reactivar un producto con un componente no disponible lo deja no vendible por el componente', () => {
    const combo = p(4, 'Combo', {
      tipo: 'COMBO',
      componentes: [
        { productoId: id(1), nombre: 'Ceviche', cantidad: 1, estacionId: E1, disponible: false },
      ],
    });
    expect(conAgotado(combo, null)).toMatchObject({
      vendible: false,
      motivo: 'COMPONENTE_NO_DISPONIBLE',
    });
  });

  it('un menú sin armar sigue sin armar al reactivarlo', () => {
    const menu = p(5, 'Menú', { tipo: 'MENU_DEL_DIA', vendible: false, motivo: 'MENU_SIN_ARMAR' });
    expect(conAgotado(menu, null).motivo).toBe('MENU_SIN_ARMAR');
  });

  it('la intención "marcar" conserva el "desde" que ya había y la de "reactivar" lo quita', () => {
    const viejo = p(1, 'Ceviche', { agotado: AGOTADO, vendible: false, motivo: 'AGOTADO' });
    const cambiado = conIntencion(viejo, {
      accion: 'marcar',
      hasta: 'REACTIVAR',
      version: 1,
      en: '2026-10-29T16:00:00.000Z',
    });
    expect(cambiado.agotado).toEqual({
      desde: AGOTADO.desde,
      hasta: 'REACTIVAR',
      origen: 'MANUAL',
    });
    expect(conIntencion(viejo, { accion: 'reactivar', version: 2, en: 'x' }).agotado).toBeNull();
    expect(conIntencion(viejo, undefined)).toBe(viejo);
  });

  it('sin intenciones la vista es la misma referencia', () => {
    expect(vistaConIntenciones(familias, {})).toBe(familias);
    const con = vistaConIntenciones(familias, {
      [id(1)]: { accion: 'marcar', hasta: 'FIN_DEL_DIA', version: 1, en: AGOTADO.desde },
    });
    expect(con[0]?.productos[0]?.agotado?.hasta).toBe('FIN_DEL_DIA');
    expect(con[0]?.productos[1]).toBe(familias[0]?.productos[1]);
  });
});

describe('filtros', () => {
  it('filtra por estación, texto (sin tildes ni mayúsculas) y solo agotados, y omite las familias vacías', () => {
    expect(
      filtrarFamilias(familias, { estacionId: E2, texto: '', soloAgotados: false }).map(
        (f) => f.nombre,
      ),
    ).toEqual(['Bebidas']);
    expect(
      filtrarFamilias(familias, {
        estacionId: null,
        texto: 'AJI',
        soloAgotados: false,
      })[0]?.productos.map((x) => x.nombre),
    ).toEqual(['Ají de gallina']);
    expect(
      filtrarFamilias(familias, { estacionId: null, texto: '', soloAgotados: true })
        .flatMap((f) => f.productos)
        .map((x) => x.nombre),
    ).toEqual(['Chicha']);
    expect(
      filtrarFamilias(familias, { estacionId: null, texto: 'zzz', soloAgotados: false }),
    ).toEqual([]);
  });

  it('un combo pertenece a las estaciones de sus componentes', () => {
    const combo = p(4, 'Combo', {
      tipo: 'COMBO',
      estacionId: null,
      componentes: [
        { productoId: id(1), nombre: 'A', cantidad: 1, estacionId: E1, disponible: true },
        { productoId: id(3), nombre: 'B', cantidad: 1, estacionId: E2, disponible: true },
        { productoId: id(2), nombre: 'C', cantidad: 1, estacionId: E2, disponible: true },
      ],
    });
    expect(estacionesDe(combo)).toEqual([E1, E2]);
    expect(
      ayudaDeFila(
        combo,
        new Map([
          [E1, 'Cocina'],
          [E2, 'Barra'],
        ]),
      ),
    ).toBe('Combo · Cocina, Barra');
    expect(ayudaDeFila(p(9, 'X', { estacionId: null }), new Map())).toBe('Sin estación');
  });

  it('cuenta productos y agotados dentro de la estación', () => {
    expect(contar(familias, null)).toEqual({ productos: 3, agotados: 1 });
    expect(contar(familias, E1)).toEqual({ productos: 2, agotados: 0 });
  });

  it('dice a qué productos afecta agotar uno', () => {
    const combo = p(4, 'Combo', {
      tipo: 'COMBO',
      componentes: [
        { productoId: id(1), nombre: 'Ceviche', cantidad: 1, estacionId: E1, disponible: true },
      ],
    });
    const lomo = p(6, 'Lomo', {
      grupos: [
        {
          id: 'g',
          nombre: 'Guarnición',
          seleccion: 'UNICA',
          minimo: 1,
          maximo: 1,
          obligatorio: true,
          modificadores: [
            {
              id: 'm',
              nombre: 'Ceviche chico',
              precioExtra: '0.00',
              productoId: id(1),
              disponible: true,
            },
          ],
        },
      ],
    });
    expect(
      afectadosPorAgotar(
        [{ id: 'f', nombre: 'F', productos: [p(1, 'Ceviche'), combo, lomo] }],
        id(1),
      ),
    ).toEqual({
      combos: ['Combo'],
      comoOpcion: ['Lomo'],
    });
  });
});

describe('motivos con palabras', () => {
  it('nombra el componente, el grupo y el menú', () => {
    expect(
      motivoEnPalabras(
        p(4, 'Combo', {
          motivo: 'COMPONENTE_NO_DISPONIBLE',
          componentes: [
            {
              productoId: id(1),
              nombre: 'Ceviche',
              cantidad: 1,
              estacionId: E1,
              disponible: false,
            },
            { productoId: id(2), nombre: 'Causa', cantidad: 1, estacionId: E1, disponible: false },
          ],
        }),
      ),
    ).toBe('Ceviche, Causa no están disponibles.');
    expect(motivoEnPalabras(p(5, 'Menú', { motivo: 'MENU_SIN_ARMAR' }))).toBe(
      'El menú de hoy no está armado.',
    );
    expect(
      motivoEnPalabras(
        p(6, 'Lomo', {
          motivo: 'OPCIONES_INSUFICIENTES',
          grupos: [
            {
              id: 'g',
              nombre: 'Guarnición',
              seleccion: 'MULTIPLE',
              minimo: 2,
              maximo: 3,
              obligatorio: true,
              modificadores: [
                {
                  id: 'm',
                  nombre: 'Arroz',
                  precioExtra: '0.00',
                  productoId: null,
                  disponible: true,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe('En «Guarnición» hacen falta 2 opciones y hay 1.');
  });

  it('un agotado o un producto vendible no llevan motivo aparte', () => {
    expect(motivoEnPalabras(p(1, 'X', { motivo: 'AGOTADO' }))).toBeNull();
    expect(motivoEnPalabras(p(1, 'X'))).toBeNull();
  });

  it('dice cuánto dura el agotado', () => {
    expect(etiquetaDeAgotado(AGOTADO)).toBe('Agotado hoy');
    expect(etiquetaDeAgotado({ ...AGOTADO, hasta: 'REACTIVAR' })).toBe(
      'Agotado hasta que lo reactiven',
    );
    expect(etiquetaDeAgotado({ ...AGOTADO, origen: 'SIN_STOCK' })).toBe('Agotado: sin stock');
  });

  it('el menú del día dice el motivo del producto ligado o el texto de siempre', () => {
    expect(motivoDeOpcionDelMenu(null)).toBe('No disponible hoy');
    expect(motivoDeOpcionDelMenu(undefined)).toBe('No está en la carta de esta sucursal');
    expect(motivoDeOpcionDelMenu(p(1, 'X', { agotado: AGOTADO, motivo: 'AGOTADO' }))).toBe(
      'Agotado hoy',
    );
    expect(motivoDeOpcionDelMenu(p(1, 'X', { motivo: 'COMPONENTE_NO_DISPONIBLE' }))).toBe(
      'Le falta un componente',
    );
    expect(motivoDeOpcionDelMenu(p(1, 'X'))).toBe('No disponible hoy');
  });
});

describe('hora de corte (hora de Lima)', () => {
  // 2026-10-29 04:20 en Lima (UTC-5) = 09:20 UTC
  const ahora = new Date('2026-10-29T09:20:00Z');
  it('cuenta los minutos hasta la siguiente hora de corte, también pasada la medianoche', () => {
    expect(minutosParaElCorte('05:00', ahora)).toBe(40);
    expect(minutosParaElCorte('04:20', ahora)).toBe(0);
    expect(minutosParaElCorte('04:00', ahora)).toBe(23 * 60 + 40);
    expect(minutosParaElCorte('00:00', new Date('2026-10-29T04:30:00Z'))).toBe(30);
  });

  it('avisa solo en la última hora y no cuando ya llegó', () => {
    expect(cercaDelCorte('05:00', ahora)).toBe(true);
    expect(cercaDelCorte('05:20', ahora)).toBe(true);
    expect(cercaDelCorte('05:21', ahora)).toBe(false);
    expect(cercaDelCorte('04:20', ahora)).toBe(false);
    expect(cercaDelCorte('03:00', ahora)).toBe(false);
  });

  it('dice los minutos', () => {
    expect(textoDeMinutos(1)).toBe('1 minuto');
    expect(textoDeMinutos(40)).toBe('40 minutos');
    expect(textoDeMinutos(60)).toBe('1 hora');
  });
});

describe('estación recordada', () => {
  it('se guarda por empresa y "todas" es null', () => {
    expect(estacionRecordada('emp')).toBeNull();
    recordarEstacion('emp', E2);
    expect(estacionRecordada('emp')).toBe(E2);
    expect(estacionRecordada('otra')).toBeNull();
    recordarEstacion('emp', null);
    expect(estacionRecordada('emp')).toBeNull();
  });
});
