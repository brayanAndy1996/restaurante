import { calcularCuenta } from '@restaurante/dominio/caja';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/errores';
import {
  demuestraQueNoQuedo,
  falloDeVenta,
  repreciar,
  totalDeLaVenta,
} from '../src/modulos/caja/mostrador';
import type { LineaBorrador } from '../src/modulos/salon/borrador';
import { P_GASEOSA, P_LOMO, cartaDeEjemplo, productoDeVenta } from './ayudas-comandero';
import { uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 79, 84 y 85 (la lógica del mostrador en la PWA; pruebas no protegidas).

const BOLSA = uuid(2900);
const AHORA = Date.parse('2026-11-05T17:00:00.000Z');

function linea(productoId: string, precioUnitario: string, cantidad: number, clave: string) {
  return {
    clave,
    productoId,
    nombre: clave,
    modificadores: [],
    cantidad,
    observacion: '',
    tiempo: 1,
    paraLlevar: false,
    precioUnitario,
  } satisfies LineaBorrador;
}

function carta() {
  const c = cartaDeEjemplo();
  c.familias[1]?.productos.push(
    productoDeVenta(BOLSA, 'Bolsa plástica', { precio: '0.20', aplicaIcbper: true }),
  );
  return c.familias;
}

describe('totalDeLaVenta', () => {
  it('es el total de calcularCuenta con el ICBPER de las bolsas', () => {
    const lineas = [
      linea(P_GASEOSA, '9.00', 1, 'a'),
      linea(P_LOMO, '28.00', 2, 'b'),
      linea(BOLSA, '0.20', 5, 'c'),
    ];
    const venta = totalDeLaVenta(lineas, carta(), 'DETALLADO', AHORA);
    expect(venta.ok && venta.total).toBe('68.50');
    const esperado = calcularCuenta({
      lineas: lineas.map((l) => ({
        itemId: l.clave,
        precioUnitario: l.precioUnitario,
        cantidad: l.cantidad,
        cantidadCortesia: 0,
        afectacion: 'GRAVADO',
        aplicaIcbper: l.productoId === BOLSA,
        descuento: null,
      })),
      descuentoCuenta: null,
      tasaIgv: '18.00',
      montoIcbper: '0.50',
    });
    expect(esperado.totales.total).toBe('68.50');
  });

  it('no cambia con la tasa de IGV ni con el formato del comprobante', () => {
    const lineas = [linea(P_LOMO, '33.34', 3, 'a')];
    const detallado = totalDeLaVenta(lineas, carta(), 'DETALLADO', AHORA);
    const consumo = totalDeLaVenta(lineas, carta(), 'CONSUMO', AHORA);
    expect(detallado.ok && detallado.total).toBe('100.02');
    expect(consumo.ok && consumo.total).toBe('100.02');
    // La tasa solo reparte base e IGV: con o sin IGV (Nuevo RUS) el total es el mismo.
    const total = (tasaIgv: string | null) =>
      calcularCuenta({
        lineas: [
          {
            itemId: 'a',
            precioUnitario: '33.34',
            cantidad: 3,
            cantidadCortesia: 0,
            afectacion: 'GRAVADO',
            aplicaIcbper: false,
            descuento: null,
          },
        ],
        descuentoCuenta: null,
        tasaIgv,
        montoIcbper: '0.50',
      }).totales.total;
    expect(total(null)).toBe(total('18.00'));
  });

  it('una venta vacía, o con un producto que ya no está en la carta, no tiene total', () => {
    expect(totalDeLaVenta([], carta(), 'DETALLADO', AHORA)).toEqual({ ok: false, motivo: 'VACIA' });
    expect(
      totalDeLaVenta([linea(uuid(9999), '5.00', 1, 'Sopa')], carta(), 'DETALLADO', AHORA),
    ).toEqual({ ok: false, motivo: 'FUERA_DE_CARTA', nombres: ['Sopa'] });
  });
});

describe('repreciar', () => {
  it('toma el precio de la carta de ahora y conserva todo lo demás', () => {
    const familias = carta();
    const gaseosa = familias.flatMap((f) => f.productos).find((p) => p.id === P_GASEOSA);
    if (gaseosa) gaseosa.precio = '10.00';
    const [nueva] = repreciar(
      [{ ...linea(P_GASEOSA, '9.00', 2, 'a'), observacion: 'sin hielo' }],
      familias,
    );
    expect(nueva).toMatchObject({ precioUnitario: '10.00', cantidad: 2, observacion: 'sin hielo' });
  });
});

describe('Errores de la venta', () => {
  const error = (
    estado: number,
    codigo: string,
    campos: { campo: string; mensaje: string }[] = [],
  ) => new ErrorApi({ estado, codigo, mensaje: codigo, campos });

  it('CUENTA_CAMBIO trae el total nuevo de campos.total', () => {
    const fallo = falloDeVenta(
      error(409, 'CUENTA_CAMBIO', [{ campo: 'total', mensaje: 'El total ahora es S/ 38.00' }]),
    );
    expect(fallo).toMatchObject({ cuentaCambio: true, totalNuevo: '38.00' });
  });

  it('solo una respuesta que prueba que no quedó suelta el id', () => {
    expect(demuestraQueNoQuedo(error(422, 'PRODUCTO_NO_VENDIBLE'))).toBe(true);
    expect(demuestraQueNoQuedo(error(422, 'PAGOS_NO_CUADRAN'))).toBe(true);
    expect(demuestraQueNoQuedo(error(409, 'CUENTA_CAMBIO'))).toBe(true);
    expect(demuestraQueNoQuedo(error(409, 'TURNO_CERRADO'))).toBe(true);
    expect(demuestraQueNoQuedo(error(409, 'CONFLICTO'))).toBe(false);
    expect(demuestraQueNoQuedo(error(403, 'PROHIBIDO'))).toBe(false);
    expect(demuestraQueNoQuedo(error(500, 'ERROR_INTERNO'))).toBe(false);
    expect(demuestraQueNoQuedo(error(0, 'SIN_CONEXION'))).toBe(false);
    expect(demuestraQueNoQuedo(error(0, 'ENVIO_CANCELADO'))).toBe(false);
  });
});
