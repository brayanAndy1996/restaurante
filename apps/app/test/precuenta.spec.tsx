import type { OrdenRespuesta, PrecuentaRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { json, renderApp } from './ayudas';
import { ORDEN_ID, servidorDeCuenta } from './ayudas-comandero';
import { socketVigente } from './ayudas-tiempo-real';
import {
  itemDeOrden,
  mesa,
  ordenDeMesa,
  salon,
  sesionDeRol,
  uuid,
  zona,
  Z_SALON,
} from './ayudas-salon';

// spec: 004-salon-cocina, criterios 50 a 54 y 95 (la pre-cuenta en pantalla; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const RUTA = `/salon/ordenes/${ORDEN_ID}`;
const API = `/ordenes/${ORDEN_ID}/precuentas`;
const NOTA = 'Precios con IGV incluido. No es un comprobante de pago.';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function abierta(extra: Partial<OrdenRespuesta> = {}): OrdenRespuesta {
  return ordenDeMesa(4, {
    total: '169.20',
    items: [
      itemDeOrden(1, { nombre: 'Lomo saltado', cantidad: 2, cantidadVigente: 2 }),
      itemDeOrden(2, {
        nombre: 'Combo hamburguesa',
        tipo: 'COMBO',
        cantidad: 3,
        cantidadVigente: 3,
      }),
    ],
    ...extra,
  });
}

const enPrecuenta = (numero = 1): OrdenRespuesta =>
  abierta({
    estado: 'EN_PRECUENTA',
    precuentaVigente: {
      id: uuid(7000 + numero),
      numero,
      total: '169.20',
      emitidaEn: '2026-10-29T17:10:00.000Z',
    },
  });

function precuentaDe(extra: Partial<PrecuentaRespuesta> = {}): PrecuentaRespuesta {
  return {
    id: uuid(7001),
    numero: 1,
    emitidaEn: '2026-10-29T17:10:00.000Z',
    orden: {
      id: ORDEN_ID,
      mesas: [{ id: uuid(104), nombre: '4' }],
      mozo: { id: uuid(800), nombre: 'Ana Ríos' },
      comensales: 3,
    },
    lineas: [
      {
        itemId: uuid(1001),
        nombre: 'Lomo saltado',
        modificadores: ['3/4', 'Huevo'],
        cantidad: 2,
        precioUnitario: '33.50',
        total: '67.00',
      },
      {
        itemId: uuid(1002),
        nombre: 'Combo hamburguesa',
        modificadores: [],
        cantidad: 3,
        precioUnitario: '28.40',
        total: '85.20',
      },
      {
        itemId: uuid(1003),
        nombre: 'Chicha morada',
        modificadores: [],
        cantidad: 1,
        precioUnitario: '17.00',
        total: '17.00',
      },
    ],
    total: '169.20',
    nota: NOTA,
    ...extra,
  };
}

/** El servidor de la cuenta: pedir la pre-cuenta deja la cuenta en pre-cuenta, como hace la API. */
function montar(opciones: { orden?: OrdenRespuesta; precuenta?: PrecuentaRespuesta } = {}) {
  const s = servidorDeCuenta({
    sesion: sesionDeRol('MOZO'),
    orden: opciones.orden ?? abierta(),
  });
  s.poner(`POST ${API}`, () => {
    const pre = opciones.precuenta ?? precuentaDe();
    s.estado.orden = enPrecuenta(pre.numero);
    return json(201, pre);
  });
  return s;
}

/** Otra persona agregó o anuló algo: la cuenta vuelve a rojo y la pre-cuenta ya no vale. */
async function cambiarLaCuenta(s: ReturnType<typeof montar>) {
  s.estado.orden = abierta({ total: '197.60' });
  await act(async () => {
    socketVigente()?.conectar();
    socketVigente()?.desdeElServidor('orden.cambio', { ordenId: ORDEN_ID });
  });
}

describe('Pedir la pre-cuenta (criterios 50 y 95)', () => {
  it('la cuenta con ítems la ofrece; sin ítems vigentes, no', async () => {
    montar();
    const { unmount } = renderApp(RUTA);
    expect(await screen.findByRole('button', { name: 'Pedir pre-cuenta' })).toBeVisible();
    unmount();

    montar({ orden: abierta({ items: [] }) });
    renderApp(RUTA);
    await screen.findByText('Aún no se envió nada');
    expect(screen.queryByRole('button', { name: 'Pedir pre-cuenta' })).toBeNull();
  });

  it('manda el pedido con un id propio y su clave, y muestra el detalle con cifras tabulares', async () => {
    const s = montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));

    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    const [llamada] = s.de('POST', API);
    expect(llamada?.cuerpo).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    expect(within(hoja).getByText('Pre-cuenta 1')).toBeVisible();
    expect(hoja).toHaveTextContent('Mesa 4 · Ana Ríos · 3 comensales');
    // Las líneas, con sus modificadores y su importe.
    const lineas = within(hoja).getByRole('list', { name: 'Detalle de la pre-cuenta' });
    const lomo = within(lineas).getAllByRole('listitem')[0];
    expect(lomo).toHaveTextContent('2 ×');
    expect(lomo).toHaveTextContent('Lomo saltado');
    expect(lomo).toHaveTextContent('3/4 · Huevo');
    expect(lomo).toHaveTextContent('S/ 33.50 cada uno');
    expect(lomo).toHaveTextContent('S/ 67.00');
    expect(within(lineas).getAllByRole('listitem')).toHaveLength(3);
    // Los importes llevan la clase de las cifras tabulares.
    expect(within(lomo as HTMLElement).getByText('S/ 67.00')).toHaveClass('precuenta__importe');
  });

  it('el total lleva IGV incluido y no se desglosa; dice que no es un comprobante y que aún no se imprime', async () => {
    montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });

    expect(hoja).toHaveTextContent('Total');
    expect(hoja).toHaveTextContent('IGV incluido');
    expect(within(hoja).getByText('S/ 169.20')).toBeVisible();
    expect(hoja).toHaveTextContent('Precios con IGV incluido. No es un comprobante de pago.');
    expect(hoja).toHaveTextContent('La impresión llega con el puente de impresión.');
    // Sin desglose de IGV ni de base imponible (decisión 5).
    expect(hoja).not.toHaveTextContent(/base imponible|subtotal|IGV \(|18\s?%|op\. gravada/i);
    // Sin ICBPER en la cuenta, la hoja no lo menciona.
    expect(hoja).not.toHaveTextContent('ICBPER');
    // Está vigente: no dice que dejó de valer.
    expect(hoja).not.toHaveTextContent('ya no vale');
  });

  it('con un producto con ICBPER, la nota de la API agrega «El ICBPER se suma al cobrar.»', async () => {
    montar({ precuenta: precuentaDe({ nota: `${NOTA} El ICBPER se suma al cobrar.` }) });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    expect(within(hoja).getByText('El ICBPER se suma al cobrar.')).toBeVisible();
    expect(within(hoja).getByText(NOTA)).toBeVisible();
  });

  it('una cuenta ya en pre-cuenta dice cuál es y vuelve a mostrar la vigente', async () => {
    const s = servidorDeCuenta({ sesion: sesionDeRol('MOZO'), orden: enPrecuenta(2) });
    s.poner(`POST ${API}`, () => json(201, precuentaDe({ numero: 2 })));
    renderApp(RUTA);
    expect(await screen.findByText(/Pre-cuenta 2 pedida a las 12:10\./)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ver pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    expect(within(hoja).getByText('Pre-cuenta 2')).toBeVisible();
    expect(hoja).not.toHaveTextContent('ya no vale');
  });

  it('si la cuenta se llenó mientras tanto, lo dice con palabras', async () => {
    const s = montar();
    s.poner(`POST ${API}`, () =>
      json(409, { codigo: 'ORDEN_SIN_CONSUMO', mensaje: 'Sin consumo vigente' }),
    );
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos pedir la pre-cuenta');
    expect(aviso).toHaveTextContent('Aún no hay nada vigente en la cuenta');
  });
});

describe('Si después se agrega o se anula algo (criterio 53, decisión 10)', () => {
  it('la hoja abierta deja de presentar la pre-cuenta como vigente y ofrece pedir otra', async () => {
    const s = montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    await waitFor(() => expect(s.de('GET', `/ordenes/${ORDEN_ID}`).length).toBeGreaterThan(1));
    expect(hoja).not.toHaveTextContent('ya no vale');

    await cambiarLaCuenta(s);

    expect(await within(hoja).findByText('Esta pre-cuenta ya no vale')).toBeVisible();
    expect(hoja).toHaveTextContent('Pre-cuenta 1: ya no vale');
    expect(hoja).toHaveTextContent('Se agregó o se anuló algo después de pedirla');

    // Pide otra: número siguiente, vuelve a ser la vigente.
    s.poner(`POST ${API}`, () => {
      s.estado.orden = enPrecuenta(2);
      return json(201, precuentaDe({ id: uuid(7002), numero: 2, total: '197.60' }));
    });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir otra pre-cuenta' }));
    await waitFor(() => expect(within(hoja).getByText('Pre-cuenta 2')).toBeVisible());
    expect(hoja).not.toHaveTextContent('ya no vale');
    expect(within(hoja).getByText('S/ 197.60')).toBeVisible();
    const [primera, segunda] = s.de('POST', API);
    expect((segunda?.cuerpo as { id: string }).id).not.toBe((primera?.cuerpo as { id: string }).id);
  });

  it('con la hoja cerrada, la cuenta avisa que la pre-cuenta ya no vale', async () => {
    const s = montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Volver a la cuenta' }));
    await screen.findByRole('button', { name: 'Ver pre-cuenta' });

    await cambiarLaCuenta(s);

    const aviso = await screen.findByText('La pre-cuenta 1 ya no vale');
    expect(aviso).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pedir pre-cuenta' })).toBeVisible();
  });

  it('mover no la invalida: la cuenta sigue en pre-cuenta y no avisa nada', async () => {
    const s = montar();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir pre-cuenta' }));
    const hoja = await screen.findByRole('dialog', { name: 'Pre-cuenta' });
    // Cambia solo la mesa de la cuenta.
    s.estado.orden = { ...enPrecuenta(1), mesas: [{ id: uuid(107), nombre: '7' }] };
    await act(async () => {
      socketVigente()?.conectar();
      socketVigente()?.desdeElServidor('orden.cambio', { ordenId: ORDEN_ID });
    });
    await waitFor(() => expect(screen.getAllByText(/Mesa 7/).length).toBeGreaterThan(0));
    expect(hoja).not.toHaveTextContent('ya no vale');
  });
});

describe('La mesa en pre-cuenta se ve en amarillo en el salón (criterio 95)', () => {
  it('la baldosa lleva el estado «Pre-cuenta» con su texto y su color de advertencia', async () => {
    servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      extra: {
        'GET /salon': () =>
          json(
            200,
            salon([
              zona(Z_SALON, 'Salón principal', [
                mesa(4, '4', { columna: 1, estado: 'EN_PRECUENTA', orden: { total: '169.20' } }),
                mesa(5, '5', { columna: 2, orden: {} }),
              ]),
            ]),
          ),
      },
    });
    renderApp('/salon');
    const amarilla = await screen.findByRole('button', { name: /^Mesa 4,.*Pre-cuenta/ });
    expect(amarilla).toHaveClass('ui-mesa--en-precuenta');
    expect(within(amarilla).getByText('Pre-cuenta')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Mesa 5,.*Ocupada/ })).toHaveClass(
      'ui-mesa--ocupada',
    );
  });
});
