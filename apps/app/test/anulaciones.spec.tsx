import type { AutorizacionRespuesta, OrdenRespuesta } from '@restaurante/contratos';
import type { Rol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { json, renderApp } from './ayudas';
import { ORDEN_ID, servidorDeCuenta } from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, sesionDeRol, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 34 a 44 y 93 (anular un ítem, anular la orden y liberar la mesa; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const RUTA = `/salon/ordenes/${ORDEN_ID}`;
const ITEM = uuid(1001);
const RUTA_ANULAR_ITEM = `/ordenes/${ORDEN_ID}/items/${ITEM}/anulaciones`;
const RUTA_ANULAR_ORDEN = `/ordenes/${ORDEN_ID}/anulacion`;
const RUTA_LIBERAR = `/ordenes/${ORDEN_ID}/liberacion`;

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Tres lomos saltados enviados (S/ 28.00 cada uno) y una gaseosa. */
function cuenta(extra: Partial<OrdenRespuesta> = {}): OrdenRespuesta {
  return ordenDeMesa(4, {
    total: '93.00',
    items: [
      itemDeOrden(1, {
        cantidad: 3,
        cantidadVigente: 3,
        totalVigente: '84.00',
        precioUnitario: '28.00',
      }),
      itemDeOrden(2, {
        nombre: 'Gaseosa 1 L',
        precioUnitario: '9.00',
        totalVigente: '9.00',
        cocina: { enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 },
      }),
    ],
    ...extra,
  });
}

const autorizada = (extra: Partial<AutorizacionRespuesta> = {}): AutorizacionRespuesta => ({
  autorizacionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  accion: 'ANULAR_ITEM_ENVIADO',
  autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
  expiraEn: new Date(Date.now() + 120_000).toISOString(),
  ...extra,
});

const servidor = (rol: Rol, orden: OrdenRespuesta) =>
  servidorDeCuenta({ sesion: sesionDeRol(rol), orden });

async function pin(digitos: string) {
  const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
  for (const d of digitos) await userEvent.click(within(ventana).getByRole('button', { name: d }));
}

/** Abre «Anular» del ítem, elige motivo y destino. */
async function prepararAnulacion(opciones: { menos?: number; destino?: string } = {}) {
  await userEvent.click(await screen.findByRole('button', { name: 'Anular Lomo saltado' }));
  const hoja = await screen.findByRole('dialog', { name: 'Anular ítem' });
  for (let i = 0; i < (opciones.menos ?? 0); i++) {
    await userEvent.click(
      within(hoja).getByRole('button', { name: 'Quitar una unidad de Lomo saltado' }),
    );
  }
  await userEvent.click(within(hoja).getByRole('button', { name: 'Error al comandar' }));
  await userEvent.click(
    within(hoja).getByRole('radio', { name: new RegExp(opciones.destino ?? 'Vuelve al stock') }),
  );
  return hoja;
}

describe('Anular un ítem enviado: la hoja (criterio 93)', () => {
  it('cada ítem enviado tiene «Anular»; la hoja propone toda la cantidad y no elige el destino del stock', async () => {
    servidor('MOZO', cuenta());
    renderApp(RUTA);
    expect(await screen.findByRole('button', { name: 'Anular Lomo saltado' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Anular Gaseosa 1 L' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Anular Lomo saltado' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular ítem' });
    expect(within(hoja).getByText('Lomo saltado')).toBeVisible();
    // Por defecto, toda la cantidad.
    expect(within(hoja).getByRole('group', { name: 'Cantidad de Lomo saltado' })).toHaveTextContent(
      '× 3',
    );
    // Los atajos de motivo y las dos opciones del stock, ninguna elegida.
    expect(within(hoja).getByRole('button', { name: 'Producto agotado' })).toBeVisible();
    const vuelve = within(hoja).getByRole('radio', { name: /Vuelve al stock/ });
    const merma = within(hoja).getByRole('radio', { name: /Es merma/ });
    expect(vuelve).not.toBeChecked();
    expect(merma).not.toBeChecked();
  });

  it('un ítem de una sola unidad no pide cantidad', async () => {
    servidor('MOZO', cuenta());
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Anular Gaseosa 1 L' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular ítem' });
    expect(within(hoja).queryByRole('group', { name: /^Cantidad de/ })).toBeNull();
  });

  it('sin motivo ni destino no sigue: lo dice y no llama a la API', async () => {
    const s = servidor('MOZO', cuenta());
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Anular Lomo saltado' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular ítem' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    expect(within(hoja).getByText('Elige o escribe el motivo')).toBeVisible();
    expect(within(hoja).getByText('Elige qué pasa con el stock')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull();
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('un ítem ya anulado no ofrece «Anular»', async () => {
    servidor(
      'MOZO',
      cuenta({
        items: [
          itemDeOrden(1, { estado: 'ANULADO', cantidadAnulada: 1, cantidadVigente: 0 }),
          itemDeOrden(2, { nombre: 'Gaseosa 1 L' }),
        ],
      }),
    );
    renderApp(RUTA);
    await screen.findByText('Gaseosa 1 L');
    expect(screen.queryByRole('button', { name: 'Anular Lomo saltado' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anular Gaseosa 1 L' })).toBeVisible();
  });

  it('lo que el rol no puede hacer no aparece', async () => {
    const mozo = sesionDeRol('MOZO');
    servidorDeCuenta({
      sesion: {
        ...mozo,
        permisos: {
          ...mozo.permisos!,
          ANULAR_ITEM_ENVIADO: 'prohibido',
          ANULAR_ORDEN: 'prohibido',
        },
      },
      orden: cuenta(),
    });
    renderApp(RUTA);
    await screen.findByText('Lomo saltado');
    expect(screen.queryByRole('button', { name: /^Anular/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
  });
});

describe('Anular un ítem con clave de supervisor (Mozo y Cajero; criterios 35 a 37)', () => {
  it('toda la cantidad: pide la clave con el mismo motivo y anula con la autorización', async () => {
    const orden = cuenta();
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden,
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) => {
          const entrada = cuerpo as { id: string; cantidad: number };
          s.estado.orden = { ...orden, total: '9.00', items: [orden.items[1]!] };
          return json(201, {
            id: entrada.id,
            itemId: ITEM,
            cantidad: entrada.cantidad,
            motivo: 'Error al comandar',
            destinoStock: 'VUELVE',
            autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
            item: { ...orden.items[0]!, cantidadAnulada: 3, cantidadVigente: 0, estado: 'ANULADO' },
            comandas: [],
          });
        },
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));

    // La ventana de 002 dice qué se autoriza y trae el motivo ya elegido, sin pedirlo otra vez.
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Anular ítem: Lomo saltado × 3 · S/ 84.00');
    expect(ventana).toHaveTextContent('Motivo: Error al comandar');
    expect(within(ventana).queryByLabelText('Motivo')).toBeNull();
    await pin('123456');

    await waitFor(() => expect(s.de('POST', RUTA_ANULAR_ITEM)).toHaveLength(1));
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toEqual({
      accion: 'ANULAR_ITEM_ENVIADO',
      motivo: 'Error al comandar',
      pin: '123456',
    });
    const llamada = s.de('POST', RUTA_ANULAR_ITEM)[0]!;
    expect(llamada.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      cantidad: 3,
      motivo: 'Error al comandar',
      destinoStock: 'VUELVE',
    });
    expect(llamada.cabeceras.get('X-Autorizacion')).toBe(autorizada().autorizacionId);
    expect(llamada.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);

    // La cuenta se actualiza y lo dice.
    expect(await screen.findByText('Anulaste 3 × Lomo saltado.')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('Lomo saltado')).toBeNull());
    expect(screen.getByText('S/ 9.00', { selector: '.cuenta__total b' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Anular ítem' })).toBeNull();
  });

  it('cantidad parcial: anula solo las unidades elegidas y lo dice a quien autoriza', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('CAJERO'),
      orden: cuenta(),
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${RUTA_ANULAR_ITEM}`]: () =>
          json(409, { codigo: 'ORDEN_NO_ABIERTA', mensaje: 'Cerrada' }),
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion({ menos: 1, destino: 'Es merma' });
    expect(within(hoja).getByRole('group', { name: 'Cantidad de Lomo saltado' })).toHaveTextContent(
      '× 2',
    );
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Anular ítem: Lomo saltado × 2 · S/ 56.00');
    await pin('123456');
    await waitFor(() => expect(s.de('POST', RUTA_ANULAR_ITEM)).toHaveLength(1));
    expect(s.de('POST', RUTA_ANULAR_ITEM)[0]?.cuerpo).toMatchObject({
      cantidad: 2,
      destinoStock: 'MERMA',
    });
  });

  it('un corte de red repite la misma Idempotency-Key, el mismo id y la misma autorización', async () => {
    let intentos = 0;
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: cuenta(),
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) => {
          intentos += 1;
          if (intentos <= 2) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(
            json(201, {
              id: (cuerpo as { id: string }).id,
              itemId: ITEM,
              cantidad: 3,
              motivo: 'Error al comandar',
              destinoStock: 'VUELVE',
              autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
              item: itemDeOrden(1, { estado: 'ANULADO', cantidadVigente: 0, cantidadAnulada: 3 }),
              comandas: [],
            }),
          );
        },
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');
    expect(await screen.findByText('Anulaste 3 × Lomo saltado.')).toBeVisible();

    const llamadas = s.de('POST', RUTA_ANULAR_ITEM);
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('X-Autorizacion'))).size).toBe(1);
    expect(new Set(llamadas.map((l) => (l.cuerpo as { id: string }).id)).size).toBe(1);
    // La clave del supervisor se pidió una sola vez.
    expect(s.de('POST', '/autorizaciones')).toHaveLength(1);
  });

  it('si la API dice que la autorización venció, pide otra clave y conserva lo elegido', async () => {
    let intentos = 0;
    const segunda = autorizada({ autorizacionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    let autorizaciones = 0;
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: cuenta(),
      extra: {
        'POST /autorizaciones': () => {
          autorizaciones += 1;
          return json(201, autorizaciones === 1 ? autorizada() : segunda);
        },
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) => {
          intentos += 1;
          if (intentos === 1) {
            return json(403, { codigo: 'AUTORIZACION_INVALIDA', mensaje: 'Venció' });
          }
          return json(201, {
            id: (cuerpo as { id: string }).id,
            itemId: ITEM,
            cantidad: 2,
            motivo: 'Error al comandar',
            destinoStock: 'MERMA',
            autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
            item: itemDeOrden(1, { cantidadVigente: 1, cantidadAnulada: 2, cantidad: 3 }),
            comandas: [],
          });
        },
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion({ menos: 1, destino: 'Es merma' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');

    // Se vuelve a pedir la clave, con el mismo motivo y lo mismo que se había elegido.
    const ventana = await screen.findByText('Motivo: Error al comandar');
    expect(ventana).toBeVisible();
    await waitFor(() => expect(s.de('POST', '/autorizaciones')).toHaveLength(1));
    const nueva = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(nueva).toHaveTextContent('Anular ítem: Lomo saltado × 2 · S/ 56.00');
    await pin('654321');

    expect(await screen.findByText('Anulaste 2 × Lomo saltado.')).toBeVisible();
    const llamadas = s.de('POST', RUTA_ANULAR_ITEM);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]?.cabeceras.get('X-Autorizacion')).toBe(autorizada().autorizacionId);
    expect(llamadas[1]?.cabeceras.get('X-Autorizacion')).toBe(segunda.autorizacionId);
    // Es una autorización nueva: otra clave de idempotencia, pero la misma anulación y los mismos datos.
    expect(llamadas[1]?.cabeceras.get('Idempotency-Key')).not.toBe(
      llamadas[0]?.cabeceras.get('Idempotency-Key'),
    );
    expect((llamadas[1]?.cuerpo as { id: string }).id).toBe(
      (llamadas[0]?.cuerpo as { id: string }).id,
    );
    expect(llamadas[1]?.cuerpo).toMatchObject({ cantidad: 2, destinoStock: 'MERMA' });
  });

  it('una autorización que venció mientras tanto no se usa: se pide otra antes de enviar', async () => {
    let autorizaciones = 0;
    let anulaciones = 0;
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: cuenta(),
      extra: {
        'POST /autorizaciones': () => {
          autorizaciones += 1;
          return json(
            201,
            autorizaciones === 1
              ? autorizada()
              : autorizada({ autorizacionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
          );
        },
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) => {
          anulaciones += 1;
          if (anulaciones === 1) return json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' });
          return json(201, {
            id: (cuerpo as { id: string }).id,
            itemId: ITEM,
            cantidad: 3,
            motivo: 'Error al comandar',
            destinoStock: 'VUELVE',
            autorizadoPor: { id: uuid(70), nombre: 'Rosa Quispe' },
            item: itemDeOrden(1, { estado: 'ANULADO', cantidadVigente: 0, cantidadAnulada: 3 }),
            comandas: [],
          });
        },
      },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      renderApp(RUTA);
      const hoja = await prepararAnulacion();
      await userEvent.click(
        within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }),
      );
      await pin('123456');
      // El servidor falla (no es la red): la hoja sigue abierta con lo elegido.
      expect(await within(hoja).findByText('No pudimos anular')).toBeVisible();
      expect(s.de('POST', RUTA_ANULAR_ITEM)).toHaveLength(1);

      // Pasan más de 2 minutos: la autorización guardada ya no vale.
      vi.setSystemTime(Date.now() + 150_000);
      await userEvent.click(
        within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }),
      );
      await screen.findByRole('dialog', { name: 'Clave de supervisor' });
      expect(within(hoja).getByText(/La autorización venció/)).toBeVisible();
      // Todavía no salió nada con la vencida.
      expect(s.de('POST', RUTA_ANULAR_ITEM)).toHaveLength(1);
      await pin('654321');
      expect(await screen.findByText('Anulaste 3 × Lomo saltado.')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
    const llamadas = s.de('POST', RUTA_ANULAR_ITEM);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]?.cabeceras.get('X-Autorizacion')).toBe(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    );
    expect((llamadas[1]?.cuerpo as { id: string }).id).toBe(
      (llamadas[0]?.cuerpo as { id: string }).id,
    );
  });

  it('si cancela la ventana de clave no se anula nada y lo elegido sigue en la hoja', async () => {
    const s = servidorDeCuenta({ sesion: sesionDeRol('MOZO'), orden: cuenta() });
    renderApp(RUTA);
    const hoja = await prepararAnulacion({ menos: 1 });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    await userEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'Anular ítem' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Error al comandar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });

  it('si la cuenta cambió (409), lo dice y la vuelve a pedir', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: cuenta(),
      extra: {
        'POST /autorizaciones': () => json(201, autorizada()),
        [`POST ${RUTA_ANULAR_ITEM}`]: () =>
          json(409, { codigo: 'ITEM_NO_ANULABLE', mensaje: 'Ya está anulado' }),
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    await pin('123456');
    expect(
      await screen.findByText('Este ítem ya estaba anulado. Actualizamos la pantalla.'),
    ).toBeVisible();
    await waitFor(() => expect(s.de('GET', `/ordenes/${ORDEN_ID}`).length).toBeGreaterThan(1));
  });
});

describe('Anular un ítem sin clave (Supervisor y Administrador; criterio 36)', () => {
  it('basta una confirmación: no pide clave ni manda autorización', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('SUPERVISOR'),
      orden: cuenta(),
      extra: {
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) =>
          json(201, {
            id: (cuerpo as { id: string }).id,
            itemId: ITEM,
            cantidad: 2,
            motivo: 'Error al comandar',
            destinoStock: 'VUELVE',
            autorizadoPor: null,
            item: itemDeOrden(1, { cantidadVigente: 1, cantidadAnulada: 2, cantidad: 3 }),
            comandas: [],
          }),
      },
    });
    renderApp(RUTA);
    const hoja = await prepararAnulacion({ menos: 1 });
    expect(within(hoja).queryByText(/supervisor debe poner su clave/)).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular ítem' }));

    const confirmar = await screen.findByRole('dialog', { name: '¿Anular 2 × Lomo saltado?' });
    expect(confirmar).toHaveTextContent('Se quitan S/ 56.00 de la cuenta');
    expect(confirmar).toHaveTextContent('El stock vuelve.');
    expect(s.de('POST', RUTA_ANULAR_ITEM)).toHaveLength(0);
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Sí, anular ítem' }));

    expect(await screen.findByText('Anulaste 2 × Lomo saltado.')).toBeVisible();
    const llamada = s.de('POST', RUTA_ANULAR_ITEM)[0]!;
    expect(llamada.cabeceras.get('X-Autorizacion')).toBeNull();
    expect(llamada.cuerpo).toMatchObject({ cantidad: 2, destinoStock: 'VUELVE' });
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Clave de supervisor' })).toBeNull();
  });

  it('«Cancelar» en la confirmación no anula nada', async () => {
    const s = servidorDeCuenta({ sesion: sesionDeRol('ADMINISTRADOR'), orden: cuenta() });
    renderApp(RUTA);
    const hoja = await prepararAnulacion();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular ítem' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Anular 3 × Lomo saltado?' });
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '¿Anular 3 × Lomo saltado?' })).toBeNull(),
    );
    expect(s.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(0);
  });
});

describe('Después de anular (criterio 40)', () => {
  it('una cuenta en pre-cuenta vuelve a «Ocupada» y dice que la pre-cuenta ya no vale', async () => {
    const enPrecuenta = cuenta({
      estado: 'EN_PRECUENTA',
      precuentaVigente: {
        id: uuid(3100),
        numero: 1,
        total: '93.00',
        emitidaEn: '2026-10-29T17:10:00.000Z',
      },
    });
    const s = servidorDeCuenta({
      sesion: sesionDeRol('SUPERVISOR'),
      orden: enPrecuenta,
      extra: {
        [`POST ${RUTA_ANULAR_ITEM}`]: ({ cuerpo }) => {
          s.estado.orden = {
            ...enPrecuenta,
            estado: 'ABIERTA',
            precuentaVigente: null,
            total: '65.00',
          };
          return json(201, {
            id: (cuerpo as { id: string }).id,
            itemId: ITEM,
            cantidad: 1,
            motivo: 'Error al comandar',
            destinoStock: 'VUELVE',
            autorizadoPor: null,
            item: itemDeOrden(1, { cantidadVigente: 2, cantidadAnulada: 1, cantidad: 3 }),
            comandas: [],
          });
        },
      },
    });
    renderApp(RUTA);
    expect(await screen.findByText('Pre-cuenta')).toBeVisible();
    const hoja = await prepararAnulacion({ menos: 2 });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular ítem' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Anular 1 × Lomo saltado?' });
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Sí, anular ítem' }));

    expect(await screen.findByText(/La pre-cuenta ya no vale/)).toBeVisible();
    expect(await screen.findByText('Ocupada')).toBeVisible();
    expect(screen.queryByText('Pre-cuenta')).toBeNull();
  });
});

describe('Anular la orden (criterios 42 y 43)', () => {
  it('con clave: pide motivo y destino, la ventana dice el total y la mesa queda libre', async () => {
    const abierta = cuenta();
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: abierta,
      extra: {
        'POST /autorizaciones': () => json(201, autorizada({ accion: 'ANULAR_ORDEN' })),
        [`POST ${RUTA_ANULAR_ORDEN}`]: () => {
          const anulada: OrdenRespuesta = {
            ...abierta,
            estado: 'ANULADA',
            anuladaEn: '2026-10-29T17:40:00.000Z',
            total: '0.00',
            items: abierta.items.map((i) => ({
              ...i,
              estado: 'ANULADO' as const,
              cantidadAnulada: i.cantidad,
              cantidadVigente: 0,
              totalVigente: '0.00',
            })),
          };
          s.estado.orden = anulada;
          return json(200, anulada);
        },
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Anular la orden' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular la orden' });
    // Sin cantidad: es la cuenta entera.
    expect(within(hoja).queryByRole('group', { name: /^Cantidad de/ })).toBeNull();
    await userEvent.click(within(hoja).getByRole('button', { name: 'El cliente lo pidió' }));
    await userEvent.click(within(hoja).getByRole('radio', { name: /Es merma/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Pedir clave de supervisor' }));
    const ventana = await screen.findByRole('dialog', { name: 'Clave de supervisor' });
    expect(ventana).toHaveTextContent('Anular la orden: Mesa 4 · 4 ítems · S/ 93.00');
    await pin('123456');

    expect(await screen.findByText(/Anulaste la orden\. La mesa quedó libre\./)).toBeVisible();
    expect(s.de('POST', '/autorizaciones')[0]?.cuerpo).toMatchObject({
      accion: 'ANULAR_ORDEN',
      motivo: 'El cliente lo pidió',
    });
    const llamada = s.de('POST', RUTA_ANULAR_ORDEN)[0]!;
    expect(llamada.cuerpo).toEqual({ motivo: 'El cliente lo pidió', destinoStock: 'MERMA' });
    expect(llamada.cabeceras.get('X-Autorizacion')).toBe(autorizada().autorizacionId);
    expect(llamada.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // La cuenta ya no está abierta: no queda nada que anular ni liberar.
    await waitFor(() => expect(screen.getByText('Anulada')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Anular la orden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
  });

  it('el Supervisor confirma sin clave', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('SUPERVISOR'),
      orden: cuenta(),
      extra: { [`POST ${RUTA_ANULAR_ORDEN}`]: () => json(200, { ...cuenta(), estado: 'ANULADA' }) },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Anular la orden' }));
    const hoja = await screen.findByRole('dialog', { name: 'Anular la orden' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Producto agotado' }));
    await userEvent.click(within(hoja).getByRole('radio', { name: /Vuelve al stock/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Anular la orden' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Anular la orden?' });
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Sí, anular la orden' }));
    await waitFor(() => expect(s.de('POST', RUTA_ANULAR_ORDEN)).toHaveLength(1));
    expect(s.de('POST', RUTA_ANULAR_ORDEN)[0]?.cabeceras.get('X-Autorizacion')).toBeNull();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
  });
});

describe('Liberar la mesa sin consumo (decisión 7, criterio 44)', () => {
  it('una mesa sin nada enviado se libera sin clave, con una confirmación', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: ordenDeMesa(4),
      extra: {
        [`POST ${RUTA_LIBERAR}`]: () => {
          const liberada = ordenDeMesa(4, { estado: 'ANULADA', sinConsumo: true });
          s.estado.orden = liberada;
          return json(200, liberada);
        },
      },
    });
    renderApp(RUTA);
    // Sin ítems no hay nada que anular: solo se ofrece liberar.
    expect(screen.queryByRole('button', { name: 'Anular la orden' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Liberar la mesa' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Liberar Mesa 4?' });
    expect(confirmar).toHaveTextContent('No se envió nada a cocina');
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Liberar la mesa' }));

    expect(await screen.findByText('La mesa quedó libre.')).toBeVisible();
    const llamada = s.de('POST', RUTA_LIBERAR)[0]!;
    expect(llamada.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(llamada.cabeceras.get('X-Autorizacion')).toBeNull();
    expect(s.de('POST', '/autorizaciones')).toHaveLength(0);
    await waitFor(() => expect(screen.getByText('Anulada')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
  });

  it('con algo vigente en la cuenta no se ofrece liberar, solo anular la orden', async () => {
    servidorDeCuenta({ sesion: sesionDeRol('MOZO'), orden: cuenta() });
    renderApp(RUTA);
    await screen.findByText('Lomo saltado');
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anular la orden' })).toBeVisible();
  });

  it('con todo anulado se ofrece liberar; si la API dice que hubo consumo, ofrece «Anular la orden»', async () => {
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: cuenta({
        total: '0.00',
        items: [itemDeOrden(1, { estado: 'ANULADO', cantidadAnulada: 1, cantidadVigente: 0 })],
      }),
      extra: {
        [`POST ${RUTA_LIBERAR}`]: () =>
          json(409, { codigo: 'ORDEN_CON_CONSUMO', mensaje: 'La orden tuvo un envío' }),
      },
    });
    renderApp(RUTA);
    expect(screen.queryByRole('button', { name: 'Anular la orden' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Liberar la mesa' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Liberar Mesa 4?' });
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Liberar la mesa' }));

    expect(await screen.findByText('Esta mesa ya tuvo pedidos')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Anular la orden' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
    expect(s.de('POST', RUTA_LIBERAR)).toHaveLength(1);
  });

  it('sin red sale una sola vez: la misma clave en cada intento', async () => {
    let intentos = 0;
    const s = servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: ordenDeMesa(4),
      extra: {
        [`POST ${RUTA_LIBERAR}`]: () => {
          intentos += 1;
          if (intentos <= 2) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(
            json(200, ordenDeMesa(4, { estado: 'ANULADA', sinConsumo: true })),
          );
        },
      },
    });
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Liberar la mesa' }));
    const confirmar = await screen.findByRole('dialog', { name: '¿Liberar Mesa 4?' });
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Liberar la mesa' }));
    expect(await screen.findByText('La mesa quedó libre.')).toBeVisible();
    const llamadas = s.de('POST', RUTA_LIBERAR);
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
  });

  it('una cuenta que ya no está abierta no ofrece liberar ni anular', async () => {
    servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: ordenDeMesa(4, { estado: 'ANULADA', items: [itemDeOrden(1)] }),
    });
    renderApp(RUTA);
    await screen.findByText('Esta cuenta ya no está abierta');
    expect(screen.queryByRole('button', { name: /^Anular/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Liberar la mesa' })).toBeNull();
  });
});
