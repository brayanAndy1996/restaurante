import type { EnvioRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { claveDeBorrador } from '../src/modulos/salon/borrador';
import { ID, json, renderApp } from './ayudas';
import { ORDEN_ID, P_LOMO, servidorDeCuenta } from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 32, 33, 90 y 92 (la cuenta de la mesa; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const CLAVE = claveDeBorrador(ID.empresa, ID.usuario, ORDEN_ID);
const RUTA = `/salon/ordenes/${ORDEN_ID}`;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Una cuenta con una comanda (lomo con extras, observación y tiempo 2; combo en cocina) y una adición. */
function cuentaConItems() {
  return ordenDeMesa(4, {
    total: '169.20',
    items: [
      itemDeOrden(1, {
        cantidad: 2,
        cantidadVigente: 2,
        totalVigente: '67.00',
        precioUnitario: '33.50',
        modificadores: [
          { nombre: '3/4', precioExtra: '0.00' },
          { nombre: 'Huevo', precioExtra: '2.50' },
        ],
        observacion: 'sin ají',
        tiempo: 2,
        cocina: { enviado: 2, enPreparacion: 0, listo: 0, anulado: 0 },
      }),
      itemDeOrden(2, {
        nombre: 'Combo hamburguesa',
        tipo: 'COMBO',
        cantidad: 3,
        cantidadVigente: 3,
        totalVigente: '85.20',
        precioUnitario: '28.40',
        paraLlevar: true,
        modificadores: [{ nombre: 'Cerveza Pilsen', precioExtra: '4.50' }],
        cocina: { enviado: 0, enPreparacion: 1, listo: 2, anulado: 0 },
      }),
      itemDeOrden(3, {
        envioNumero: 2,
        esAdicion: true,
        nombre: 'Gaseosa 1 L',
        precioUnitario: '9.00',
        totalVigente: '9.00',
        cocina: { enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 },
        comandadoPor: { id: uuid(801), nombre: 'Carla Caja' },
        enviadoEn: '2026-10-29T17:20:00.000Z',
      }),
    ],
  });
}

describe('La cuenta de la mesa (criterio 90)', () => {
  it('muestra las mesas, quién atiende, los ítems agrupados por envío y el total', async () => {
    servidorDeCuenta({ orden: cuentaConItems() });
    renderApp(RUTA);
    expect(await screen.findByRole('heading', { name: 'Mesa 4' })).toBeVisible();
    expect(screen.getByText('Ocupada')).toBeVisible();
    expect(screen.getByText(/Ana Ríos · 3 comensales · Abierta hace/)).toBeVisible();

    const comanda = screen.getByRole('region', { name: 'Comanda' });
    expect(within(comanda).getByText(/12:05 · Ana Ríos/)).toBeVisible();
    expect(within(comanda).getByText('Lomo saltado')).toBeVisible();
    expect(within(comanda).getByText('3/4 · Huevo')).toBeVisible();
    expect(within(comanda).getByText('«sin ají»')).toBeVisible();
    expect(within(comanda).getByText('S/ 67.00')).toBeVisible();
    // Su estado en cocina, con palabras.
    expect(within(comanda).getByText('Enviado a cocina')).toBeVisible();
    expect(within(comanda).getByText('2 listos de 3')).toBeVisible();
    expect(within(comanda).getByText('Para llevar')).toBeVisible();

    // La adición dice quién la comandó (no es el mozo responsable).
    const adicion = screen.getByRole('region', { name: 'Adición 2' });
    expect(within(adicion).getByText(/12:20 · Carla Caja/)).toBeVisible();
    expect(within(adicion).getByText('Gaseosa 1 L')).toBeVisible();

    // El total es el de la API (calculado con packages/dominio): la pantalla no suma.
    expect(screen.getByText('S/ 169.20')).toBeVisible();
  });

  it('un ítem de segundo tiempo dice "Esperar" y, ya marchado, "Marchado"', async () => {
    const orden = cuentaConItems();
    orden.items[1] = {
      ...orden.items[1]!,
      tiempo: 2,
      marchadoEn: '2026-10-29T17:30:00.000Z',
    };
    servidorDeCuenta({ orden });
    renderApp(RUTA);
    const comanda = await screen.findByRole('region', { name: 'Comanda' });
    expect(within(comanda).getByText('Esperar')).toBeVisible();
    expect(within(comanda).getByText('Marchado')).toBeVisible();
  });

  it('un ítem anulado se ve tachado y dicho con palabras, sin total', async () => {
    const orden = ordenDeMesa(4, {
      items: [
        itemDeOrden(1, {
          estado: 'ANULADO',
          cantidadAnulada: 1,
          cantidadVigente: 0,
          totalVigente: '0.00',
        }),
        itemDeOrden(2, {
          nombre: 'Cerveza',
          cantidad: 3,
          cantidadVigente: 2,
          cantidadAnulada: 1,
          totalVigente: '18.00',
        }),
      ],
    });
    servidorDeCuenta({ orden });
    renderApp(RUTA);
    const comanda = await screen.findByRole('region', { name: 'Comanda' });
    expect(within(comanda).getByText('Anulado')).toBeVisible();
    expect(within(comanda).getByText('1 anulado')).toBeVisible();
    expect(within(comanda).getByText('S/ 18.00')).toBeVisible();
  });

  it('sin ítems dice qué hacer, y «Agregar» lleva al comandero', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    expect(await screen.findByText('Aún no se envió nada')).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Agregar' }));
    expect(await screen.findByRole('heading', { name: 'Agregar a Mesa 4' })).toBeVisible();
  });

  it('una cuenta que ya no está abierta no ofrece agregar ni marchar', async () => {
    servidorDeCuenta({
      orden: ordenDeMesa(4, { estado: 'ANULADA', items: [itemDeOrden(1, { tiempo: 2 })] }),
    });
    renderApp(RUTA);
    expect(await screen.findByText('Esta cuenta ya no está abierta')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Agregar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marchar' })).toBeNull();
  });

  it('una cuenta unida a otra lleva a la cuenta principal, con el borrador que tuviera', async () => {
    const PRINCIPAL = uuid(905);
    servidorDeCuenta({
      orden: ordenDeMesa(4, { estado: 'UNIDA', unidaA: PRINCIPAL }),
      extra: { [`GET /ordenes/${PRINCIPAL}`]: () => json(200, ordenDeMesa(5)) },
    });
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        envioId: null,
        lineas: [
          {
            clave: 'l1',
            productoId: P_LOMO,
            nombre: 'Lomo saltado',
            modificadores: [],
            cantidad: 1,
            observacion: '',
            tiempo: 1,
            paraLlevar: false,
            precioUnitario: '28.00',
          },
        ],
      }),
    );
    renderApp(RUTA);
    expect(await screen.findByRole('heading', { name: 'Mesa 5' })).toBeVisible();
    expect(await screen.findByText('Las cuentas se unieron')).toBeVisible();
    expect(localStorage.getItem(CLAVE)).toBeNull();
    const pasado = JSON.parse(
      localStorage.getItem(claveDeBorrador(ID.empresa, ID.usuario, PRINCIPAL)) ?? 'null',
    );
    expect(pasado.lineas).toHaveLength(1);
  });

  it('un error al cargar se dice y se puede reintentar', async () => {
    let intento = 0;
    servidorDeCuenta({
      extra: {
        'GET /ordenes/*': () => {
          intento += 1;
          return intento === 1
            ? json(400, { codigo: 'DATOS_INVALIDOS', mensaje: 'Datos inválidos' })
            : json(200, ordenDeMesa(4));
        },
      },
    });
    renderApp(RUTA);
    expect(await screen.findByText('No pudimos cargar la cuenta')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Mesa 4' })).toBeVisible();
  });

  it('una cuenta que no existe (o de otra sucursal) se dice, sin mostrar nada de otra empresa', async () => {
    servidorDeCuenta({
      extra: {
        'GET /ordenes/*': () =>
          json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'La orden no existe' }),
      },
    });
    renderApp(RUTA);
    expect(await screen.findByText('Esta cuenta no existe')).toBeVisible();
  });
});

describe('Marchar (criterios 32 y 33)', () => {
  const ordenPorMarchar = () =>
    ordenDeMesa(4, {
      items: [
        itemDeOrden(1, { tiempo: 1 }),
        itemDeOrden(2, { nombre: 'Ají de gallina', tiempo: 2 }),
        itemDeOrden(3, { nombre: 'Lomo saltado', tiempo: 2, cantidad: 2, cantidadVigente: 2 }),
      ],
    });

  it('solo aparece si hay ítems de segundo tiempo por marchar, y dice cuántos', async () => {
    servidorDeCuenta({ orden: ordenDeMesa(4, { items: [itemDeOrden(1, { tiempo: 1 })] }) });
    renderApp(RUTA);
    await screen.findByRole('region', { name: 'Comanda' });
    expect(screen.queryByRole('button', { name: 'Marchar' })).toBeNull();
  });

  it('manda la marcha con un id propio y clave de idempotencia, y luego muestra "Marchado"', async () => {
    let orden = ordenPorMarchar();
    const s = servidorDeCuenta({
      orden,
      extra: {
        [`POST ${RUTA.replace('/salon', '')}/marchas`]: ({ cuerpo }) => {
          orden = {
            ...orden,
            items: orden.items.map((i) =>
              i.tiempo === 2 ? { ...i, marchadoEn: '2026-10-29T17:40:00.000Z' } : i,
            ),
          };
          s.estado.orden = orden;
          return json(201, { id: (cuerpo as { id: string }).id, comandas: [] });
        },
      },
    });
    renderApp(RUTA);
    expect(await screen.findByText('2 ítems de segundo tiempo')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Marchar' }));

    expect(await screen.findByText('Marcha enviada')).toBeVisible();
    const [llamada, ...otras] = s.de('POST', `/ordenes/${ORDEN_ID}/marchas`);
    expect(otras).toHaveLength(0);
    // Todos los que esperan: sin `itemIds`.
    expect(llamada?.cuerpo).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // La cuenta se vuelve a pedir y el botón desaparece: ya no queda nada por marchar.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Marchar' })).toBeNull());
    expect(screen.getAllByText('Marchado')).toHaveLength(2);
    expect(screen.queryByText('Esperar')).toBeNull();
  });

  it('sin red sale una sola vez: la misma clave y el mismo id en cada intento', async () => {
    let intentos = 0;
    const s = servidorDeCuenta({
      orden: ordenPorMarchar(),
      extra: {
        [`POST /ordenes/${ORDEN_ID}/marchas`]: ({ cuerpo }) => {
          intentos += 1;
          if (intentos <= 2) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(json(201, { id: (cuerpo as { id: string }).id, comandas: [] }));
        },
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Marchar' }));
    expect(await screen.findByText('Marcha enviada')).toBeVisible();
    const llamadas = s.de('POST', `/ordenes/${ORDEN_ID}/marchas`);
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
    expect(new Set(llamadas.map((l) => (l.cuerpo as { id: string }).id)).size).toBe(1);
  });

  it('si otra persona ya marchó, lo dice y la cuenta se actualiza', async () => {
    const s = servidorDeCuenta({
      orden: ordenPorMarchar(),
      extra: {
        [`POST /ordenes/${ORDEN_ID}/marchas`]: () =>
          json(409, { codigo: 'NADA_QUE_MARCHAR', mensaje: 'No hay nada por marchar' }),
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Marchar' }));
    expect(await screen.findByText(/No hay nada por marchar/)).toBeVisible();
    await waitFor(() => expect(s.de('GET', `/ordenes/${ORDEN_ID}`).length).toBeGreaterThan(1));
  });
});

describe('La cuenta y el borrador (criterio 92)', () => {
  const linea = {
    clave: 'l1',
    productoId: P_LOMO,
    nombre: 'Lomo saltado',
    modificadores: [{ id: uuid(2202), nombre: '3/4', precioExtra: '0.00' }],
    cantidad: 2,
    observacion: '',
    tiempo: 1,
    paraLlevar: false,
    precioUnitario: '28.00',
  };
  const envio: EnvioRespuesta = {
    id: uuid(3000),
    ordenId: ORDEN_ID,
    numero: 2,
    esAdicion: true,
    items: [],
    comandas: [],
  };

  it('lo que falta enviar se ve con su total y lleva de vuelta a «Por enviar»', async () => {
    localStorage.setItem(CLAVE, JSON.stringify({ lineas: [linea], envioId: null }));
    servidorDeCuenta();
    renderApp(RUTA);
    const fila = await screen.findByRole('link', { name: /Por enviar/ });
    expect(within(fila).getByText('2 ítems sin enviar a cocina')).toBeVisible();
    expect(within(fila).getByText('S/ 56.00')).toBeVisible();
    await userEvent.click(fila);
    expect(await screen.findByRole('heading', { name: 'Agregar a Mesa 4' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Editar 2 × Lomo saltado/ })).toBeVisible();
  });

  it('con un envío sin terminar (recarga o cambio de usuario) ofrece «Reintentar el envío» con el mismo id', async () => {
    localStorage.setItem(CLAVE, JSON.stringify({ lineas: [linea], envioId: uuid(3000) }));
    const s = servidorDeCuenta({
      extra: { [`POST /ordenes/${ORDEN_ID}/envios`]: () => json(201, envio) },
    });
    renderApp(RUTA);
    expect(await screen.findByText('Hay un envío sin terminar')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar el envío' }));

    expect(await screen.findByText('Pedido enviado')).toBeVisible();
    expect(screen.getByText('La adición 2 se envió a cocina.')).toBeVisible();
    const [llamada] = s.de('POST', `/ordenes/${ORDEN_ID}/envios`);
    expect(llamada?.cuerpo).toMatchObject({
      id: uuid(3000),
      lineas: [{ productoId: P_LOMO, cantidad: 2, modificadorIds: [uuid(2202)] }],
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(CLAVE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar el envío' })).toBeNull();
  });

  describe('el aviso de «Pedido enviado» no promete que el ticket salió (M5)', () => {
    const estadoDeImpresion = (puente: boolean) => ({
      ahora: new Date().toISOString(),
      puente: puente
        ? {
            id: uuid(300),
            nombre: 'Puente de Cocina',
            ultimaSenalEn: new Date().toISOString(),
            conectado: true,
          }
        : null,
      impresoras: [
        {
          id: uuid(101),
          nombre: 'Cocina',
          estado: 'LISTA' as const,
          estadoDesde: new Date().toISOString(),
          pendientes: 0,
        },
      ],
    });

    async function enviarPendiente(puente: boolean) {
      localStorage.setItem(CLAVE, JSON.stringify({ lineas: [linea], envioId: uuid(3000) }));
      servidorDeCuenta({
        extra: {
          [`POST /ordenes/${ORDEN_ID}/envios`]: () => json(201, envio),
          'GET /impresion/estado': () => json(200, estadoDeImpresion(puente)),
        },
      });
      renderApp(RUTA);
      await userEvent.click(await screen.findByRole('button', { name: 'Reintentar el envío' }));
      return screen.findByText('Pedido enviado');
    }

    it('con la impresión en orden, dice que se envió a cocina, sin decir que ya salió', async () => {
      await enviarPendiente(true);
      expect(await screen.findByText('La adición 2 se envió a cocina.')).toBeVisible();
      expect(screen.queryByText(/ya salió/)).toBeNull();
    });

    it('si la impresión tiene un problema (sin puente), dice que quedó en cola de impresión', async () => {
      await enviarPendiente(false);
      expect(
        await screen.findByText('La adición 2 se envió a cocina y quedó en cola de impresión.'),
      ).toBeVisible();
    });
  });

  it('el borrador de otra persona del mismo equipo no aparece', async () => {
    localStorage.setItem(
      claveDeBorrador(ID.empresa, uuid(77), ORDEN_ID),
      JSON.stringify({ lineas: [linea], envioId: uuid(3000) }),
    );
    servidorDeCuenta({ sesion: sesionDeRol('MOZO') });
    renderApp(RUTA);
    await screen.findByRole('heading', { name: 'Mesa 4' });
    expect(screen.queryByText('Hay un envío sin terminar')).toBeNull();
    expect(screen.queryByRole('link', { name: /Por enviar/ })).toBeNull();
  });
});
