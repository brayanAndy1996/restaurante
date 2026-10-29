import { beforeEach, describe, expect, it } from 'vitest';
import {
  aLineaDeEnvio,
  cambiarBorrador,
  claveDeBorrador,
  leerBorrador,
  pasarBorrador,
  totalDeLinea,
  totalDelBorrador,
  unidadesDelBorrador,
  type LineaBorrador,
} from '../src/modulos/salon/borrador';
import {
  buscarProductos,
  calcularDeProducto,
  erroresPorGrupo,
  familiasParaVender,
  incluyeDelProducto,
  motivoCorto,
  recargoDeOpcion,
  reglaDelGrupo,
} from '../src/modulos/salon/comandero';
import { textoDeRechazo } from '../src/modulos/salon/enviar-borrador';
import {
  agruparPorEnvio,
  estadoEnCocina,
  itemsPorMarchar,
  textoDeItems,
  tituloDeEnvio,
  tituloDeMesas,
} from '../src/modulos/salon/ordenes';
import {
  G_BEBIDA,
  G_EXTRAS,
  G_TERMINO,
  M_HUEVO,
  M_JUGOSO,
  M_PLATANO,
  M_QUESO,
  P_CHICHA,
  P_COMBO,
  P_LOMO,
  P_MENU,
  cartaDeEjemplo,
  productoDeVenta,
} from './ayudas-comandero';
import { itemDeOrden, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 55, 90 y 91 (reglas del comandero y del borrador; pruebas no protegidas).

const carta = cartaDeEjemplo();
const lomo = carta.familias[0]!.productos.find((p) => p.id === P_LOMO)!;
const combo = carta.familias[0]!.productos.find((p) => p.id === P_COMBO)!;

describe('qué se ofrece', () => {
  it('solo las familias con productos que se venden solos, en el orden de la carta', () => {
    const familias = familiasParaVender(carta.familias);
    expect(familias.map((f) => f.nombre)).toEqual(['Fondos', 'Bebidas']);
    expect(familias[0]!.productos.map((p) => p.nombre)).toEqual([
      'Lomo saltado',
      'Combo hamburguesa',
      'Menú del día',
    ]);
    // Una familia con solo ingredientes no aparece.
    expect(
      familiasParaVender([
        {
          id: uuid(1),
          nombre: 'Insumos',
          productos: [productoDeVenta(uuid(2), 'Sal', { seVendeSolo: false })],
        },
      ]),
    ).toEqual([]);
  });

  it('busca por nombre sin importar tildes ni mayúsculas; un texto vacío no busca nada', () => {
    const familias = familiasParaVender(carta.familias);
    expect(buscarProductos(familias, 'COMBO').map((p) => p.nombre)).toEqual(['Combo hamburguesa']);
    expect(buscarProductos(familias, 'menu').map((p) => p.nombre)).toEqual(['Menú del día']);
    expect(buscarProductos(familias, '  ')).toEqual([]);
    expect(buscarProductos(familias, 'zzz')).toEqual([]);
  });

  it('dice por qué una baldosa está apagada, y nada si se puede vender', () => {
    const chicha = carta.familias[1]!.productos.find((p) => p.id === P_CHICHA)!;
    const menu = carta.familias[0]!.productos.find((p) => p.id === P_MENU)!;
    expect(motivoCorto(lomo)).toBeNull();
    expect(motivoCorto(chicha)).toBe('Agotado');
    expect(motivoCorto(menu)).toBe('Menú sin armar');
    expect(motivoCorto({ ...chicha, agotado: { ...chicha.agotado!, origen: 'SIN_STOCK' } })).toBe(
      'Sin stock',
    );
    expect(
      motivoCorto(
        productoDeVenta(uuid(9), 'Combo', {
          vendible: false,
          motivo: 'COMPONENTE_NO_DISPONIBLE',
          componentes: [
            {
              productoId: uuid(8),
              nombre: 'Pan',
              cantidad: 1,
              estacionId: null,
              disponible: false,
            },
          ],
        }),
      ),
    ).toBe('Sin Pan');
    expect(
      motivoCorto(productoDeVenta(uuid(9), 'X', { vendible: false, motivo: 'INACTIVO' })),
    ).toBe('No disponible');
    expect(
      motivoCorto(
        productoDeVenta(uuid(9), 'X', { vendible: false, motivo: 'OPCIONES_INSUFICIENTES' }),
      ),
    ).toBe('Faltan opciones');
  });
});

describe('grupos de modificadores', () => {
  it('dice la regla de cada grupo con palabras', () => {
    expect(reglaDelGrupo({ minimo: 1, maximo: 1 })).toBe('Obligatorio: elige 1');
    expect(reglaDelGrupo({ minimo: 0, maximo: 1 })).toBe('Opcional: elige 1 o ninguno');
    expect(reglaDelGrupo({ minimo: 0, maximo: 2 })).toBe('Opcional: hasta 2');
    expect(reglaDelGrupo({ minimo: 2, maximo: 2 })).toBe('Obligatorio: elige 2');
    expect(reglaDelGrupo({ minimo: 1, maximo: 3 })).toBe('Elige de 1 a 3');
  });

  it('dice cuánto cuesta cada opción', () => {
    expect(recargoDeOpcion('0.00')).toBe('Sin recargo');
    expect(recargoDeOpcion('2.50')).toBe('+ S/ 2.50');
  });

  it('el precio sale de calcularLinea: base más extras por la cantidad', () => {
    const r = calcularDeProducto(
      lomo,
      { [G_TERMINO]: [M_JUGOSO], [G_EXTRAS]: [M_HUEVO, M_PLATANO] },
      2,
    );
    expect(r).toMatchObject({ valido: true, precioUnitario: '33.50', total: '67.00' });
  });

  it('sin cumplir el mínimo no hay precio y el grupo dice qué falta', () => {
    const sin = calcularDeProducto(lomo, {}, 1);
    expect(sin.valido).toBe(false);
    expect(erroresPorGrupo(lomo, sin)).toEqual({ [G_TERMINO]: 'Elige 1 en «Término»' });

    const demasiados = calcularDeProducto(
      lomo,
      { [G_TERMINO]: [M_JUGOSO], [G_EXTRAS]: [M_HUEVO, M_PLATANO, M_QUESO] },
      1,
    );
    expect(erroresPorGrupo(lomo, demasiados)).toEqual({
      [G_EXTRAS]: 'Elige como máximo 2 en «Extras»',
    });
  });

  it('una opción que ya no está disponible invalida la selección', () => {
    const cerveza = combo.grupos
      .find((g) => g.id === G_BEBIDA)!
      .modificadores.find((m) => !m.disponible)!;
    const r = calcularDeProducto(combo, { [G_BEBIDA]: [cerveza.id] }, 1);
    expect(r.valido).toBe(false);
  });

  it('dice qué incluye un combo', () => {
    expect(incluyeDelProducto(combo)).toBe('Incluye Hamburguesa clásica');
    expect(incluyeDelProducto(lomo)).toBeNull();
  });
});

describe('el borrador', () => {
  const linea = (n: number, extra: Partial<LineaBorrador> = {}): LineaBorrador => ({
    clave: `l${n}`,
    productoId: P_LOMO,
    nombre: 'Lomo saltado',
    modificadores: [{ id: M_JUGOSO, nombre: 'Jugoso', precioExtra: '0.00' }],
    cantidad: 2,
    observacion: '',
    tiempo: 1,
    paraLlevar: false,
    precioUnitario: '28.00',
    ...extra,
  });
  const clave = claveDeBorrador(uuid(1), uuid(2), uuid(3));

  beforeEach(() => localStorage.clear());

  it('la clave es de la empresa, de la persona y de la orden', () => {
    expect(clave).not.toBe(claveDeBorrador(uuid(1), uuid(9), uuid(3)));
    expect(clave).not.toBe(claveDeBorrador(uuid(1), uuid(2), uuid(9)));
    expect(clave).not.toBe(claveDeBorrador(uuid(9), uuid(2), uuid(3)));
    expect(claveDeBorrador(uuid(1), null, uuid(3))).toContain('soporte');
  });

  it('lo guardado se lee igual tras una recarga, y el mismo texto da el mismo objeto', () => {
    cambiarBorrador(clave, (b) => ({ ...b, lineas: [linea(1)] }));
    const a = leerBorrador(clave);
    expect(a.lineas).toHaveLength(1);
    expect(leerBorrador(clave)).toBe(a);
    expect(JSON.parse(localStorage.getItem(clave) ?? '')).toMatchObject({
      lineas: [{ clave: 'l1' }],
    });
  });

  it('vacío y sin envío en curso no deja nada guardado', () => {
    cambiarBorrador(clave, (b) => ({ ...b, lineas: [linea(1)] }));
    cambiarBorrador(clave, (b) => ({ ...b, lineas: [] }));
    expect(localStorage.getItem(clave)).toBeNull();
    // Con un envío sin terminar sí se conserva, aunque no quedaran líneas.
    cambiarBorrador(clave, () => ({ lineas: [], envioId: uuid(5) }));
    expect(localStorage.getItem(clave)).not.toBeNull();
  });

  it('un borrador dañado o con líneas mal formadas se trata como vacío', () => {
    localStorage.setItem(clave, '{no es json');
    expect(leerBorrador(clave).lineas).toEqual([]);
    localStorage.setItem(clave, JSON.stringify({ lineas: [{ clave: 1 }, 'x', null], envioId: 3 }));
    expect(leerBorrador(clave)).toEqual({ lineas: [], envioId: null });
  });

  it('pasarlo a otra cuenta lo suma a lo que hubiera, olvida el id del envío y quita las marcas de rechazo', () => {
    const otra = claveDeBorrador(uuid(1), uuid(2), uuid(4));
    cambiarBorrador(clave, () => ({
      lineas: [linea(1, { rechazo: 'Agotado' })],
      envioId: uuid(5),
    }));
    cambiarBorrador(otra, () => ({ lineas: [linea(2)], envioId: null }));
    pasarBorrador(clave, otra);
    expect(localStorage.getItem(clave)).toBeNull();
    const pasado = leerBorrador(otra);
    expect(pasado.lineas.map((l) => l.clave)).toEqual(['l2', 'l1']);
    expect(pasado.lineas[1]).not.toHaveProperty('rechazo');
    expect(pasado.envioId).toBeNull();
  });

  it('los totales salen de totalOrden: nada se suma a mano', () => {
    const lineas = [linea(1), linea(2, { cantidad: 3, precioUnitario: '0.10' })];
    expect(totalDeLinea(lineas[0]!)).toBe('56.00');
    expect(totalDelBorrador(lineas)).toBe('56.30');
    expect(totalDelBorrador([])).toBe('0.00');
    expect(unidadesDelBorrador(lineas)).toBe(5);
  });

  it('la línea de envío lleva ids, cantidad, tiempo y para llevar; la observación solo si hay', () => {
    expect(aLineaDeEnvio(linea(1))).toEqual({
      productoId: P_LOMO,
      modificadorIds: [M_JUGOSO],
      cantidad: 2,
      tiempo: 1,
      paraLlevar: false,
    });
    expect(
      aLineaDeEnvio(linea(1, { observacion: '  sin ají ', tiempo: 2, paraLlevar: true })),
    ).toEqual({
      productoId: P_LOMO,
      modificadorIds: [M_JUGOSO],
      cantidad: 2,
      observacion: 'sin ají',
      tiempo: 2,
      paraLlevar: true,
    });
  });
});

describe('el motivo de un rechazo', () => {
  it.each([
    ['AGOTADO', 'Agotado'],
    ['COMPONENTE_NO_DISPONIBLE', 'Falta un componente del producto'],
    [`MODIFICADOR_NO_DISPONIBLE: ${uuid(1)}`, 'Una opción elegida ya no está disponible'],
    ['MODIFICADOR_DESCONOCIDO: x', 'Una opción elegida ya no existe'],
    ['MENOS_DEL_MINIMO', 'Faltan opciones por elegir'],
    ['MAS_DEL_MAXIMO', 'Elegiste más opciones de las permitidas'],
    ['MENU_SIN_ARMAR', 'El menú de hoy no está armado'],
    ['NO_DISPONIBLE', 'No disponible en esta sucursal'],
    ['INACTIVO', 'Ya no está en la carta'],
    ['MONTO_FUERA_DE_RANGO', 'El monto pasa del máximo permitido'],
  ])('%s se dice "%s"', (codigo, frase) => {
    expect(textoDeRechazo(codigo)).toBe(frase);
  });

  it('un texto que ya viene en español se respeta y uno genérico en inglés se cambia', () => {
    expect(textoDeRechazo('No hay mesa libre')).toBe('No hay mesa libre');
    expect(textoDeRechazo('Invalid input')).toBe('Revisa este dato');
  });
});

describe('la cuenta', () => {
  it('titula las mesas: una, dos o varias', () => {
    expect(tituloDeMesas([{ nombre: '4' }])).toBe('Mesa 4');
    expect(tituloDeMesas([{ nombre: 'B3' }])).toBe('Mesa B3');
    expect(tituloDeMesas([{ nombre: '4' }, { nombre: '5' }])).toBe('Mesas 4 y 5');
    expect(tituloDeMesas([{ nombre: '4' }, { nombre: '5' }, { nombre: '6' }])).toBe(
      'Mesas 4, 5 y 6',
    );
    expect(tituloDeMesas([])).toBe('Cuenta de la mesa');
  });

  it('el primer envío es la comanda y los siguientes, adiciones', () => {
    expect(tituloDeEnvio(1, false)).toBe('Comanda');
    expect(tituloDeEnvio(2, true)).toBe('Adición 2');
    expect(tituloDeEnvio(3, true)).toBe('Adición 3');
  });

  it('agrupa los ítems por envío en orden de envío', () => {
    const grupos = agruparPorEnvio([
      itemDeOrden(3, { envioNumero: 2, esAdicion: true }),
      itemDeOrden(1),
      itemDeOrden(2),
    ]);
    expect(grupos.map((g) => [g.titulo, g.items.length])).toEqual([
      ['Comanda', 2],
      ['Adición 2', 1],
    ]);
    expect(grupos[0]?.comandadoPor).toBe('Ana Ríos');
    expect(agruparPorEnvio([])).toEqual([]);
  });

  it('dice el estado en cocina con palabras', () => {
    const cocina = (enviado: number, enPreparacion: number, listo: number) =>
      itemDeOrden(1, { cocina: { enviado, enPreparacion, listo, anulado: 0 } });
    expect(estadoEnCocina(cocina(3, 0, 0))).toBe('Enviado a cocina');
    expect(estadoEnCocina(cocina(1, 2, 0))).toBe('Preparando');
    expect(estadoEnCocina(cocina(1, 0, 2))).toBe('2 listos de 3');
    expect(estadoEnCocina(cocina(2, 0, 1))).toBe('1 listo de 3');
    expect(estadoEnCocina(cocina(0, 0, 3))).toBe('Todo listo');
    expect(estadoEnCocina(cocina(0, 0, 1))).toBe('Listo');
    // Sin estación (una gaseosa) o anulado: nada que decir.
    expect(estadoEnCocina(cocina(0, 0, 0))).toBeNull();
    expect(estadoEnCocina(itemDeOrden(1, { estado: 'ANULADO' }))).toBeNull();
  });

  it('solo marcha lo de segundo tiempo, enviado, sin marchar y con cantidad vigente', () => {
    const items = [
      itemDeOrden(1, { tiempo: 1 }),
      itemDeOrden(2, { tiempo: 2 }),
      itemDeOrden(3, { tiempo: 2, marchadoEn: '2026-10-29T17:30:00.000Z' }),
      itemDeOrden(4, { tiempo: 2, estado: 'ANULADO', cantidadVigente: 0 }),
      itemDeOrden(5, { tiempo: 2, cantidadVigente: 0 }),
    ];
    expect(itemsPorMarchar({ items }).map((i) => i.id)).toEqual([items[1]!.id]);
  });

  it('cuenta los ítems en singular y plural', () => {
    expect(textoDeItems(1)).toBe('1 ítem');
    expect(textoDeItems(3)).toBe('3 ítems');
  });
});
