import type { OrdenRespuesta, SalonRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { json, renderApp, type Manejador } from './ayudas';
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

// spec: 004-salon-cocina, criterios 45 a 49 y 94 (mover y unir con el mapa en modo selección; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const RUTA_CUENTA = `/salon/ordenes/${ORDEN_ID}`;
const RUTA_MOVER = `${RUTA_CUENTA}/mover`;
const RUTA_UNIR = `${RUTA_CUENTA}/unir`;
const API_MOVER = `/ordenes/${ORDEN_ID}/movimiento`;
const API_UNIR = `/ordenes/${ORDEN_ID}/union`;

const M = (n: number) => uuid(100 + n);

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** La mesa 4 es la cuenta de Ana; la 5 está ocupada por Luis; la 6 y la 7 están libres; la 8 está en pre-cuenta. */
function salonDeEjemplo(): SalonRespuesta {
  return salon([
    zona(
      Z_SALON,
      'Salón principal',
      [
        mesa(4, '4', { columna: 1, fila: 1, orden: { total: '169.20' } }),
        mesa(5, '5', { columna: 2, fila: 1, orden: { mozo: 'Luis Vega', total: '85.00' } }),
        mesa(6, '6', { columna: 3, fila: 1 }),
        mesa(7, '7', { columna: 1, fila: 2 }),
        mesa(8, '8', {
          columna: 2,
          fila: 2,
          estado: 'EN_PRECUENTA',
          orden: { mozo: 'Rosa Díaz', total: '40.00' },
        }),
      ],
      { columnas: 3, filas: 2 },
    ),
  ]);
}

function cuenta(extra: Partial<OrdenRespuesta> = {}): OrdenRespuesta {
  return ordenDeMesa(4, {
    total: '169.20',
    items: [itemDeOrden(1, { totalVigente: '28.00' })],
    ...extra,
  });
}

function montar(
  opciones: {
    orden?: OrdenRespuesta;
    salon?: SalonRespuesta;
    extra?: Record<string, Manejador>;
  } = {},
) {
  let salonActual = opciones.salon ?? salonDeEjemplo();
  let version = 1;
  const s = servidorDeCuenta({
    sesion: sesionDeRol('MOZO'),
    orden: opciones.orden ?? cuenta(),
    extra: {
      'GET /salon': ({ cabeceras }) =>
        cabeceras.get('If-None-Match') === `"${version}"`
          ? json(304)
          : json(200, salonActual, { ETag: `"${version}"` }),
      ...(opciones.extra ?? {}),
    },
  });
  return {
    ...s,
    cambiarSalon(nuevo: SalonRespuesta) {
      salonActual = nuevo;
      version += 1;
    },
  };
}

const tile = (n: string) => screen.getByRole('button', { name: new RegExp(`^Mesa ${n},`) });
const tileInerte = (n: string) => screen.getByRole('img', { name: new RegExp(`^Mesa ${n},`) });

describe('La cuenta ofrece «Mover» y «Unir» (criterio 94)', () => {
  it('con la cuenta abierta lleva al mapa en modo selección', async () => {
    montar();
    renderApp(RUTA_CUENTA);
    const mover = await screen.findByRole('link', { name: 'Mover' });
    expect(mover).toHaveAttribute('href', RUTA_MOVER);
    expect(screen.getByRole('link', { name: 'Unir' })).toHaveAttribute('href', RUTA_UNIR);
  });

  it('una cuenta que ya no está abierta no las ofrece', async () => {
    montar({ orden: cuenta({ estado: 'ANULADA' }) });
    renderApp(RUTA_CUENTA);
    await screen.findByText('Esta cuenta ya no está abierta');
    expect(screen.queryByRole('link', { name: 'Mover' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Unir' })).toBeNull();
  });
});

describe('Mover la cuenta (criterios 45 y 94)', () => {
  it('el mapa solo deja elegir mesas libres y dice quién queda a cargo', async () => {
    montar();
    renderApp(RUTA_MOVER);
    expect(
      await screen.findByText('Toca la mesa libre a la que pasa la cuenta de la mesa 4.'),
    ).toBeVisible();
    expect(screen.getByText(/Sigue a cargo de/)).toHaveTextContent('Sigue a cargo de Ana Ríos.');

    // Libres: se tocan. Ocupadas y la propia cuenta: se ven, con el motivo, pero no se tocan.
    expect(tile('6')).toBeEnabled();
    expect(tile('7')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Mesa 5,/ })).toBeNull();
    expect(tileInerte('5')).toHaveAccessibleName(/Ocupada.*ocupada: para juntar cuentas usa Unir/);
    expect(tileInerte('8')).toHaveAccessibleName(
      /Pre-cuenta.*ocupada: para juntar cuentas usa Unir/,
    );
    expect(tileInerte('4')).toHaveAccessibleName(/es de esta cuenta/);

    // Sin elegir nada, la acción dice qué falta y no se puede tocar.
    expect(screen.getByRole('button', { name: 'Elige una mesa libre' })).toBeDisabled();
  });

  it('elegir una mesa libre pide confirmar con el mozo a cargo y manda el movimiento con su clave', async () => {
    const s = montar({
      extra: { [`POST ${API_MOVER}`]: () => json(200, cuenta()) },
    });
    renderApp(RUTA_MOVER);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('6'));
    expect(tile('6')).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Mover a la mesa 6' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Mover a la mesa 6?' });
    expect(dialogo).toHaveTextContent(
      'La cuenta pasa de la mesa 4 a la mesa 6. Sigue a cargo de Ana Ríos.',
    );
    expect(dialogo).toHaveTextContent('Los ítems y la pre-cuenta no cambian.');
    // Todavía no se mandó nada.
    expect(s.de('POST', API_MOVER)).toHaveLength(0);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, mover' }));
    await waitFor(() => expect(s.de('POST', API_MOVER)).toHaveLength(1));
    const [llamada] = s.de('POST', API_MOVER);
    // Una cuenta con una sola mesa no manda la mesa de origen.
    expect(llamada?.cuerpo).toEqual({ mesaDestinoId: M(6) });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    // Vuelve a la cuenta y lo dice.
    expect(
      await screen.findByText('La cuenta pasó a la mesa 6. La mesa 4 quedó libre.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });

  it('una cuenta con varias mesas pide elegir cuál se mueve y la manda como origen', async () => {
    const s = montar({
      orden: cuenta({
        mesas: [
          { id: M(4), nombre: '4' },
          { id: M(5), nombre: '5' },
        ],
      }),
      extra: { [`POST ${API_MOVER}`]: () => json(200, cuenta()) },
    });
    renderApp(RUTA_MOVER);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('7'));
    // Elegida la mesa libre, falta decir cuál de las dos se mueve.
    expect(screen.getByRole('button', { name: 'Elige la mesa que mueves' })).toBeDisabled();

    const grupo = screen.getByRole('group', { name: 'Mesa que se mueve' });
    await userEvent.click(within(grupo).getByRole('button', { name: 'Mesa 5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mover a la mesa 7' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Mover a la mesa 7?' });
    expect(dialogo).toHaveTextContent('La cuenta pasa de la mesa 5 a la mesa 7');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, mover' }));

    await waitFor(() => expect(s.de('POST', API_MOVER)).toHaveLength(1));
    expect(s.de('POST', API_MOVER)[0]?.cuerpo).toEqual({
      mesaOrigenId: M(5),
      mesaDestinoId: M(7),
    });
  });

  it('si la mesa se ocupó mientras tanto, lo dice, no navega y conserva el resto', async () => {
    montar({
      extra: {
        [`POST ${API_MOVER}`]: () =>
          json(409, { codigo: 'MESA_OCUPADA', mensaje: 'Mesa ocupada', ordenId: uuid(906) }),
      },
    });
    renderApp(RUTA_MOVER);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('6'));
    await userEvent.click(screen.getByRole('button', { name: 'Mover a la mesa 6' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Mover a la mesa 6?' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, mover' }));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos mover');
    expect(aviso).toHaveTextContent('Esa mesa acaba de ocuparse. Elige otra libre, o usa «Unir»');
    // Sigue en el mapa para elegir otra.
    expect(screen.getByRole('button', { name: 'Elige una mesa libre' })).toBeDisabled();
  });

  it('repetir el toque después de un fallo reenvía con la misma clave de idempotencia', async () => {
    let intentos = 0;
    const s = montar({
      extra: {
        [`POST ${API_MOVER}`]: () => {
          intentos += 1;
          return intentos === 1
            ? json(409, { codigo: 'CONFLICTO', mensaje: 'Otra persona está cambiando' })
            : json(200, cuenta());
        },
      },
    });
    renderApp(RUTA_MOVER);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('6'));
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Mover a la mesa 6' }));
      const dialogo = await screen.findByRole('dialog', { name: '¿Mover a la mesa 6?' });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, mover' }));
      if (i === 0) await screen.findByText(/Otra persona está cambiando estas mesas a la vez/);
    }
    await waitFor(() => expect(s.de('POST', API_MOVER)).toHaveLength(2));
    const [primera, segunda] = s.de('POST', API_MOVER);
    expect(segunda?.cabeceras.get('Idempotency-Key')).toBe(
      primera?.cabeceras.get('Idempotency-Key'),
    );
  });

  it('si otra persona ocupa la mesa elegida antes de confirmar, la suelta y avisa', async () => {
    const s = montar();
    renderApp(RUTA_MOVER);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('6'));
    expect(screen.getByRole('button', { name: 'Mover a la mesa 6' })).toBeEnabled();

    // El mozo Luis abre la mesa 6.
    s.cambiarSalon(
      salon([
        zona(
          Z_SALON,
          'Salón principal',
          [
            mesa(4, '4', { columna: 1, fila: 1, orden: { total: '169.20' } }),
            mesa(6, '6', { columna: 3, fila: 1, orden: { mozo: 'Luis Vega' } }),
            mesa(7, '7', { columna: 1, fila: 2 }),
          ],
          { columnas: 3, filas: 2 },
        ),
      ]),
    );
    await act(async () => {
      socketVigente()?.conectar();
      socketVigente()?.desdeElServidor('salon.cambio', { sucursalId: uuid(0) });
    });
    expect(await screen.findByText('Ya no se puede elegir')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Elige una mesa libre' })).toBeDisabled();
  });
});

describe('Unir mesas (criterios 46, 47 y 94)', () => {
  it('deja elegir mesas libres y ocupadas, menos las de la propia cuenta', async () => {
    montar();
    renderApp(RUTA_UNIR);
    expect(
      await screen.findByText(
        'Toca las mesas que se suman a la cuenta de la mesa 4. Pueden estar libres u ocupadas.',
      ),
    ).toBeVisible();
    expect(screen.getByText(/La venta queda a nombre de/)).toHaveTextContent(
      'La venta queda a nombre de Ana Ríos, el mozo de esta cuenta.',
    );
    expect(tile('5')).toBeEnabled();
    expect(tile('6')).toBeEnabled();
    expect(tile('8')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Mesa 4,/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Elige las mesas a unir' })).toBeDisabled();
  });

  it('muestra el mozo y el total de lo elegido y la frase de confirmar nombra a quien queda a cargo', async () => {
    const s = montar({ extra: { [`POST ${API_UNIR}`]: () => json(200, cuenta()) } });
    renderApp(RUTA_UNIR);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('5'));
    await userEvent.click(tile('6'));

    const elegidas = screen.getByRole('region', { name: 'Mesas elegidas' });
    expect(elegidas).toHaveTextContent('Se unen a esta cuenta (2)');
    expect(elegidas).toHaveTextContent('Mesa 5 · Ocupada · Luis Vega · S/ 85.00');
    expect(elegidas).toHaveTextContent('Mesa 6 · Libre');

    await userEvent.click(screen.getByRole('button', { name: 'Unir 5 y 6' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Unir 5 y 6?' });
    expect(dialogo).toHaveTextContent(
      'Unir 5 y 6 a la cuenta de la mesa 4: la venta queda a nombre de Ana Ríos.',
    );
    // La cuenta ocupada que se absorbe, con su mozo y su total.
    expect(dialogo).toHaveTextContent('Mesa 5');
    expect(dialogo).toHaveTextContent('cuenta de Luis Vega · S/ 85.00');
    expect(s.de('POST', API_UNIR)).toHaveLength(0);

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, unir' }));
    await waitFor(() => expect(s.de('POST', API_UNIR)).toHaveLength(1));
    const [llamada] = s.de('POST', API_UNIR);
    expect(llamada?.cuerpo).toEqual({ mesaIds: [M(5), M(6)] });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByText(
        'Se unieron 5 y 6 a esta cuenta. La venta queda a nombre de Ana Ríos.',
      ),
    ).toBeVisible();
  });

  it('volver a tocar una mesa elegida la quita; unir solo mesas libres no menciona otras cuentas', async () => {
    montar();
    renderApp(RUTA_UNIR);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('6'));
    await userEvent.click(tile('7'));
    expect(screen.getByRole('button', { name: 'Unir 6 y 7' })).toBeEnabled();
    await userEvent.click(tile('7'));
    expect(tile('7')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Unir 6' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Unir 6?' });
    expect(dialogo).toHaveTextContent('Las mesas libres pasan a compartir esta cuenta.');
    expect(dialogo).not.toHaveTextContent('Estas cuentas se juntan');
  });

  it('avisa que la pre-cuenta de la otra cuenta y la de esta dejan de valer', async () => {
    montar({
      orden: cuenta({
        estado: 'EN_PRECUENTA',
        precuentaVigente: {
          id: uuid(7001),
          numero: 1,
          total: '169.20',
          emitidaEn: '2026-10-29T17:05:00.000Z',
        },
      }),
    });
    renderApp(RUTA_UNIR);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(tile('8'));
    await userEvent.click(screen.getByRole('button', { name: 'Unir 8' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Unir 8?' });
    expect(dialogo).toHaveTextContent('cuenta de Rosa Díaz · S/ 40.00');
    expect(dialogo).toHaveTextContent('La pre-cuenta de la otra cuenta deja de valer.');
    expect(dialogo).toHaveTextContent('la pre-cuenta de esta cuenta deja de valer');
  });

  it('en la vista de lista cada mesa muestra su mozo y su total, y las no elegibles dicen por qué', async () => {
    montar();
    renderApp(RUTA_UNIR);
    await screen.findByRole('grid', { name: 'Mesas de Salón principal' });
    await userEvent.click(screen.getByRole('switch', { name: 'Lista' }));
    const lista = await screen.findByRole('list', { name: 'Mesas de Salón principal' });
    const fila5 = within(lista).getByRole('button', { name: /^Mesa 5,/ });
    expect(fila5).toHaveTextContent('Luis Vega');
    expect(fila5).toHaveTextContent('S/ 85.00');
    const fila4 = within(lista).getByRole('button', { name: /^Mesa 4,/ });
    expect(fila4).toBeDisabled();
    expect(fila4).toHaveTextContent('No se puede: es de esta cuenta');

    await userEvent.click(fila5);
    expect(fila5).toHaveAttribute('aria-pressed', 'true');
    expect(fila5).toHaveTextContent('Elegida');
    expect(screen.getByRole('button', { name: 'Unir 5' })).toBeEnabled();
  });
});
