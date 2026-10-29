import type { EnvioRespuesta } from '@restaurante/contratos';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { claveDeBorrador } from '../src/modulos/salon/borrador';
import { ID, json, renderApp } from './ayudas';
import {
  M_JUGOSO,
  M_TRES_CUARTOS,
  ORDEN_ID,
  P_GASEOSA,
  P_LOMO,
  servidorDeCuenta,
} from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, uuid } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 91 y 92 (comandero, borrador y envío; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const CLAVE = claveDeBorrador(ID.empresa, ID.usuario, ORDEN_ID);
const RUTA = `/salon/ordenes/${ORDEN_ID}/agregar`;
const RUTA_ENVIO = `/ordenes/${ORDEN_ID}/envios`;

const envioRespuesta = (numero = 1): EnvioRespuesta => ({
  id: uuid(3000),
  ordenId: ORDEN_ID,
  numero,
  esAdicion: numero > 1,
  items: [itemDeOrden(1)],
  comandas: [],
});

/** El botón de la hoja (no los «Agregar una unidad de …» de la cantidad). */
const AGREGAR = /^Agregar( ·|$)/;

const tile = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Abre el comandero, elige el Lomo con 3/4 y lo agrega al borrador. */
async function agregarLomo(cantidad = 1) {
  await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
  const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
  await userEvent.click(within(hoja).getByRole('radio', { name: /3\/4/ }));
  for (let i = 1; i < cantidad; i++) {
    await userEvent.click(within(hoja).getByRole('button', { name: /Agregar una unidad/ }));
  }
  await userEvent.click(within(hoja).getByRole('button', { name: AGREGAR }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lomo saltado' })).toBeNull());
}

async function verPorEnviar() {
  await userEvent.click(screen.getByRole('button', { name: /^Revisar lo que falta enviar/ }));
}

describe('Comandero: la carta (criterio 91)', () => {
  it('ofrece los productos que se venden solos con su precio, por familia', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    const productos = await screen.findByRole('list', { name: 'Productos de Fondos' });
    expect(
      within(productos).getByRole('button', { name: 'Lomo saltado, S/\u00a028.00' }),
    ).toBeVisible();
    expect(
      within(productos).getByRole('button', { name: 'Combo hamburguesa, S/\u00a022.90' }),
    ).toBeVisible();
    // Un ingrediente que no se vende solo no se ofrece.
    expect(screen.queryByText('Huevo frito')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
    const bebidas = await screen.findByRole('list', { name: 'Productos de Bebidas' });
    expect(
      within(bebidas).getByRole('button', { name: 'Gaseosa 1 L, S/\u00a09.00' }),
    ).toBeVisible();
  });

  it('lo que no se puede vender se ve apagado con el motivo y no abre nada', async () => {
    const s = servidorDeCuenta();
    renderApp(RUTA);
    await screen.findByRole('list', { name: 'Productos de Fondos' });
    // Menú sin armar (familia Fondos) y chicha agotada (familia Bebidas).
    const menu = tile(/^Menú del día/);
    expect(menu).toHaveAccessibleName('Menú del día, S/\u00a012.00, Menú sin armar');
    expect(menu).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText('Menú sin armar')).toBeVisible();
    await userEvent.click(menu);
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
    const chicha = await screen.findByRole('button', { name: /^Chicha morada/ });
    expect(chicha).toHaveAccessibleName('Chicha morada, S/\u00a08.00, Agotado');
    expect(within(chicha).getByText('Agotado')).toBeVisible();
    await userEvent.click(chicha);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Decisión 2: ni "quedan N" ni ninguna cantidad, y ni siquiera se pide el stock.
    expect(screen.queryByText(/quedan/i)).toBeNull();
    expect(s.de('GET', '/salon/stock')).toHaveLength(0);
  });

  it('la búsqueda por nombre ignora tildes y mayúsculas y recorre todas las familias', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await screen.findByRole('list', { name: 'Productos de Fondos' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar un producto' }), 'GASEOSA');
    const resultados = await screen.findByRole('list', { name: 'Resultados de la búsqueda' });
    expect(within(resultados).getAllByRole('button')).toHaveLength(1);
    expect(within(resultados).getByRole('button', { name: /^Gaseosa 1 L/ })).toBeVisible();
    // Mientras se busca, las familias no estorban.
    expect(screen.queryByRole('group', { name: 'Familias de la carta' })).toBeNull();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar un producto' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar un producto' }), 'zzz');
    expect(await screen.findByText(/Ninguno se llama «zzz»/)).toBeVisible();
  });
});

describe('Comandero: la hoja de producto (criterio 91)', () => {
  it('dice la regla de cada grupo y valida el mínimo antes de agregar', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });

    expect(within(hoja).getByRole('group', { name: 'Término' })).toHaveAccessibleDescription(
      'Obligatorio: elige 1',
    );
    expect(within(hoja).getByRole('group', { name: 'Extras' })).toHaveAccessibleDescription(
      'Opcional: hasta 2',
    );
    // Sin elegir el término todavía no hay precio de línea.
    await userEvent.click(within(hoja).getByRole('button', { name: AGREGAR }));
    expect(await within(hoja).findAllByText(/Elige 1 en «Término»/)).not.toHaveLength(0);
    expect(within(hoja).getByRole('group', { name: 'Término' })).toBeInvalid();
    // Nada pasó al borrador.
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('el precio sale de calcularLinea: base más extras, por la cantidad', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
    await userEvent.click(within(hoja).getByRole('radio', { name: /Jugoso/ }));
    expect(within(hoja).getByRole('button', { name: 'Agregar · S/\u00a028.00' })).toBeEnabled();

    await userEvent.click(within(hoja).getByRole('checkbox', { name: /Huevo/ }));
    expect(within(hoja).getByRole('button', { name: 'Agregar · S/\u00a030.50' })).toBeEnabled();
    await userEvent.click(within(hoja).getByRole('button', { name: /Agregar una unidad/ }));
    expect(within(hoja).getByRole('button', { name: 'Agregar · S/\u00a061.00' })).toBeEnabled();
  });

  it('con el máximo elegido, las demás opciones del grupo quedan bloqueadas y lo dicen', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
    await userEvent.click(within(hoja).getByRole('checkbox', { name: /Huevo/ }));
    await userEvent.click(within(hoja).getByRole('checkbox', { name: /Plátano/ }));
    const queso = within(hoja).getByRole('checkbox', { name: /Queso/ });
    expect(queso).toBeDisabled();
    expect(queso).toHaveAccessibleDescription('Ya elegiste 2');
    await userEvent.click(within(hoja).getByRole('checkbox', { name: /Plátano/ }));
    expect(within(hoja).getByRole('checkbox', { name: /Queso/ })).toBeEnabled();
  });

  it('una opción agotada se ve, bloqueada y con su motivo', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Combo hamburguesa/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Combo hamburguesa' });
    expect(within(hoja).getByText(/Incluye Hamburguesa clásica/)).toBeVisible();
    const cerveza = within(hoja).getByRole('radio', { name: /Cerveza Pilsen/ });
    expect(cerveza).toBeDisabled();
    expect(within(hoja).getByText('No disponible')).toBeVisible();
  });

  it('cantidad, observación, tiempo 2 y para llevar van a la línea del borrador', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
    await userEvent.click(within(hoja).getByRole('radio', { name: /3\/4/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Tiempo 2' }));
    await userEvent.click(within(hoja).getByRole('checkbox', { name: /Para llevar/ }));
    await userEvent.type(within(hoja).getByRole('textbox', { name: /Observación/ }), 'sin ají');
    await userEvent.click(within(hoja).getByRole('button', { name: AGREGAR }));

    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    expect(guardado.envioId).toBeNull();
    expect(guardado.lineas).toHaveLength(1);
    expect(guardado.lineas[0]).toMatchObject({
      productoId: P_LOMO,
      cantidad: 1,
      observacion: 'sin ají',
      tiempo: 2,
      paraLlevar: true,
      precioUnitario: '28.00',
      modificadores: [{ id: M_TRES_CUARTOS, nombre: '3/4', precioExtra: '0.00' }],
    });
  });

  it('la observación no pasa de 140 caracteres', async () => {
    servidorDeCuenta();
    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: /^Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByRole('textbox', { name: /Observación/ })).toHaveAttribute(
      'maxlength',
      '140',
    );
  });
});

describe('Comandero: el borrador (criterio 91)', () => {
  it('lo elegido va a «Por enviar» con su total y se edita o se quita sin clave', async () => {
    const s = servidorDeCuenta();
    renderApp(RUTA);
    await agregarLomo(2);

    // Abajo, a la vista: cuánto hay por enviar y el botón para enviarlo.
    expect(await screen.findByText('2 ítems por enviar')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeVisible();
    await verPorEnviar();
    const lista = screen.getByRole('list', { name: 'Productos por enviar' });
    expect(within(lista).getByText('Lomo saltado')).toBeVisible();
    expect(within(lista).getByText('3/4')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Por enviar' })).getByText('Total por enviar'),
    ).toBeVisible();

    // Editar: la hoja vuelve con lo elegido y guardar reemplaza la línea.
    await userEvent.click(within(lista).getByRole('button', { name: /^Editar 2 × Lomo saltado/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Lomo saltado' });
    expect(within(hoja).getByRole('radio', { name: /3\/4/ })).toBeChecked();
    await userEvent.click(within(hoja).getByRole('button', { name: /Quitar una unidad/ }));
    await userEvent.click(within(hoja).getByRole('button', { name: /^Guardar cambios/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('1 ítem por enviar')).toBeVisible();

    // Quitar: sin clave ni llamada a la API, y se puede deshacer.
    await userEvent.click(screen.getByRole('button', { name: /^Quitar 1 × Lomo saltado/ }));
    expect(await screen.findByText('Nada por enviar')).toBeVisible();
    expect(localStorage.getItem(CLAVE)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByRole('list', { name: 'Productos por enviar' })).toBeVisible();
    expect(s.llamadas.filter((l) => l.metodo !== 'GET')).toHaveLength(0);
  });

  it('sobrevive a la recarga: al volver, la misma persona encuentra lo que armó', async () => {
    servidorDeCuenta();
    const primera = renderApp(RUTA);
    await agregarLomo(2);
    await screen.findByText('2 ítems por enviar');
    primera.unmount();

    // La página nueva no recuerda nada en memoria: solo lo guardado en el equipo.
    renderApp(RUTA);
    expect(await screen.findByText('2 ítems por enviar')).toBeVisible();
    await verPorEnviar();
    expect(screen.getByRole('button', { name: /^Editar 2 × Lomo saltado/ })).toBeVisible();
    expect(screen.getAllByText('S/ 56.00').length).toBeGreaterThan(0);
  });

  it('es de cada persona y de cada cuenta: otra persona del mismo equipo no ve el borrador', async () => {
    servidorDeCuenta();
    renderApp(RUTA).unmount();
    // Lo que armó otra persona en esta cuenta, y lo que armó esta persona en otra cuenta.
    const linea = {
      clave: 'l1',
      productoId: P_GASEOSA,
      nombre: 'Gaseosa 1 L',
      modificadores: [],
      cantidad: 1,
      observacion: '',
      tiempo: 1,
      paraLlevar: false,
      precioUnitario: '9.00',
    };
    localStorage.setItem(
      claveDeBorrador(ID.empresa, uuid(77), ORDEN_ID),
      JSON.stringify({ lineas: [linea], envioId: null }),
    );
    localStorage.setItem(
      claveDeBorrador(ID.empresa, ID.usuario, uuid(905)),
      JSON.stringify({ lineas: [linea], envioId: null }),
    );
    renderApp(RUTA);
    await screen.findByRole('list', { name: 'Productos de Fondos' });
    // Nada por enviar: ni resumen abajo ni botón para revisarlo.
    expect(screen.queryByText(/por enviar$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Revisar lo que falta enviar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });

  it('un borrador dañado en el almacenamiento no rompe la pantalla', async () => {
    localStorage.setItem(CLAVE, '{no es json');
    servidorDeCuenta();
    renderApp(RUTA);
    await screen.findByRole('list', { name: 'Productos de Fondos' });
    expect(screen.queryByRole('button', { name: /^Revisar lo que falta enviar/ })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Buscar un producto' })).toBeVisible();
  });
});

describe('Comandero: enviar (criterios 15, 26 y 92)', () => {
  it('manda el envío con id propio y clave de idempotencia, vacía el borrador y vuelve a la cuenta', async () => {
    const s = servidorDeCuenta({
      extra: { [`POST ${RUTA_ENVIO}`]: () => json(201, envioRespuesta()) },
    });
    renderApp(RUTA);
    await agregarLomo(2);
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('heading', { name: 'Mesa 4' })).toBeInTheDocument();
    expect(await screen.findByText('Pedido enviado')).toBeVisible();
    const [llamada, ...otras] = s.de('POST', RUTA_ENVIO);
    expect(otras).toHaveLength(0);
    expect(llamada?.cuerpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      lineas: [
        {
          productoId: P_LOMO,
          modificadorIds: [M_TRES_CUARTOS],
          cantidad: 2,
          tiempo: 1,
          paraLlevar: false,
        },
      ],
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // Lo enviado ya no es borrador.
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('sin red queda "Pendiente de envío" y sale una sola vez, con la misma clave y el mismo id', async () => {
    let intentos = 0;
    const s = servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => {
          intentos += 1;
          if (intentos <= 2) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(json(201, envioRespuesta()));
        },
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Pedido enviado')).toBeVisible();
    const llamadas = s.de('POST', RUTA_ENVIO);
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(llamadas.map((l) => l.cabeceras.get('Idempotency-Key'))).size).toBe(1);
    expect(new Set(llamadas.map((l) => (l.cuerpo as { id: string }).id)).size).toBe(1);
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('mientras espera la red, dice "Pendiente de envío" y bloquea el borrador', async () => {
    let resolver: (r: Response) => void = () => undefined;
    let intento = 0;
    servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => {
          intento += 1;
          if (intento === 1) return Promise.reject(new TypeError('Failed to fetch'));
          return new Promise<Response>((r) => {
            resolver = r;
          });
        },
      },
    });
    // La espera entre intentos no termina sola: la prueba la deja colgada.
    vi.spyOn(espera, 'dormir').mockImplementation(() => new Promise(() => undefined));
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('button', { name: /Pendiente de envío/ })).toBeDisabled();
    await verPorEnviar();
    expect(screen.getAllByText('Pendiente de envío').length).toBeGreaterThan(0);
    // Bloqueado: la línea ya no se edita ni se quita.
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Quitar/ })).toBeNull();
    resolver(json(201, envioRespuesta()));
  });

  it('"Reintentar el envío" usa el mismo id, aunque la página se haya recargado', async () => {
    let intentos = 0;
    const s = servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => {
          intentos += 1;
          return intentos === 1
            ? json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' })
            : json(201, envioRespuesta());
        },
      },
    });
    const primera = renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    // No se sabe si llegó: el botón pasa a "Reintentar el envío" y el id se guardó.
    expect(await screen.findByRole('button', { name: 'Reintentar el envío' })).toBeVisible();
    const primerId = (s.de('POST', RUTA_ENVIO)[0]?.cuerpo as { id: string }).id;
    expect(JSON.parse(localStorage.getItem(CLAVE) ?? 'null').envioId).toBe(primerId);
    primera.unmount();

    renderApp(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar el envío' }));
    expect(await screen.findByText('Pedido enviado')).toBeVisible();
    const llamadas = s.de('POST', RUTA_ENVIO);
    expect(llamadas).toHaveLength(2);
    expect((llamadas[1]?.cuerpo as { id: string }).id).toBe(primerId);
    expect(llamadas[1]?.cuerpo).toEqual(llamadas[0]?.cuerpo);
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('con el envío sin terminar no se agregan más productos (el id ya es de ese pedido)', async () => {
    servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'Falló' }),
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    await screen.findByRole('button', { name: 'Reintentar el envío' });

    await userEvent.click(screen.getByRole('button', { name: 'Seguir agregando' }));
    expect(await screen.findByText('Primero termina el envío')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Productos de Fondos' })).toBeNull();
  });

  it('el rechazo se muestra en cada línea con su motivo, nada se pierde y el id se libera', async () => {
    let intento = 0;
    const s = servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => {
          intento += 1;
          return intento === 1
            ? json(422, {
                codigo: 'PRODUCTO_NO_VENDIBLE',
                mensaje: 'Un producto no se puede vender',
                campos: [{ campo: 'lineas.1', mensaje: 'AGOTADO' }],
              })
            : json(201, envioRespuesta());
        },
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    // Segunda línea: una gaseosa.
    await userEvent.click(screen.getByRole('button', { name: 'Bebidas' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Gaseosa 1 L/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Gaseosa 1 L' });
    await userEvent.click(within(hoja).getByRole('button', { name: AGREGAR }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('No se envió nada a cocina')).toBeVisible();

    // Estamos en «Por enviar»: la gaseosa lleva su motivo y el lomo, nada.
    const lista = screen.getByRole('list', { name: 'Productos por enviar' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(within(filas[0]!).queryByRole('alert')).toBeNull();
    expect(within(filas[1]!).getByRole('alert')).toHaveTextContent('No pasó: Agotado');
    // El borrador sigue completo y el id se liberó: el botón vuelve a ser "Enviar".
    expect(JSON.parse(localStorage.getItem(CLAVE) ?? 'null').lineas).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(CLAVE) ?? 'null').envioId).toBeNull();

    // Quitar la rechazada y enviar el resto lleva otro id, porque el primero no guardó nada.
    await userEvent.click(within(filas[1]!).getByRole('button', { name: /^Quitar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Pedido enviado')).toBeVisible();
    const llamadas = s.de('POST', RUTA_ENVIO);
    expect(llamadas).toHaveLength(2);
    expect((llamadas[1]?.cuerpo as { id: string }).id).not.toBe(
      (llamadas[0]?.cuerpo as { id: string }).id,
    );
    expect((llamadas[1]?.cuerpo as { lineas: unknown[] }).lineas).toHaveLength(1);
  });

  it.each([
    [403, 'PROHIBIDO', 'Tu usuario ya no puede enviar pedidos.'],
    [403, 'MODULO_NO_INCLUIDO', 'El salón no está incluido en tu plan.'],
    [409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para poder enviar el pedido.'],
  ])(
    'un %i %s no prueba que el envío no se guardó: conserva el id y el siguiente "Enviar" no duplica',
    async (estado, codigo, motivo) => {
      let intento = 0;
      const s = servidorDeCuenta({
        extra: {
          [`POST ${RUTA_ENVIO}`]: () => {
            intento += 1;
            return intento === 1
              ? json(estado, { codigo, mensaje: 'Rechazado antes de reconocer la réplica' })
              : json(201, envioRespuesta());
          },
        },
      });
      renderApp(RUTA);
      await agregarLomo();
      await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

      // Se dice el motivo, sin afirmar que no salió nada, y el botón ofrece reintentar con el mismo id.
      expect(await screen.findByText(motivo, { exact: false })).toBeVisible();
      expect(screen.queryByText('No se envió nada a cocina')).toBeNull();
      const primerId = (s.de('POST', RUTA_ENVIO)[0]?.cuerpo as { id: string }).id;
      const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
      expect(guardado.envioId).toBe(primerId);
      expect(guardado.lineas).toHaveLength(1);

      await userEvent.click(await screen.findByRole('button', { name: 'Reintentar el envío' }));
      expect(await screen.findByText('Pedido enviado')).toBeVisible();
      const llamadas = s.de('POST', RUTA_ENVIO);
      expect(llamadas).toHaveLength(2);
      expect((llamadas[1]?.cuerpo as { id: string }).id).toBe(primerId);
      expect(localStorage.getItem(CLAVE)).toBeNull();
    },
  );

  it.each([
    [422, 'DATOS_INVALIDOS'],
    [422, 'PRODUCTO_NO_VENDIBLE'],
    [422, 'SELECCION_INVALIDA'],
    [422, 'MONTO_FUERA_DE_RANGO'],
    [409, 'ORDEN_NO_ABIERTA'],
  ])('un %i %s demuestra que no se guardó: libera el id', async (estado, codigo) => {
    servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () => json(estado, { codigo, mensaje: 'No se guardó nada' }),
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('No se envió nada a cocina')).toBeVisible();
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    expect(guardado.envioId).toBeNull();
    expect(guardado.lineas).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeVisible();
  });

  it('el motivo de cada línea sale en palabras, también para un componente o una opción', async () => {
    servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () =>
          json(422, {
            codigo: 'SELECCION_INVALIDA',
            mensaje: 'La selección no es válida',
            campos: [{ campo: 'lineas.0', mensaje: `MODIFICADOR_NO_DISPONIBLE: ${M_JUGOSO}` }],
          }),
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Una opción elegida ya no está disponible/)).toBeVisible();
  });

  it('si la cuenta se unió a otra (409 con ordenId), lleva a esa cuenta con el borrador', async () => {
    const OTRA = uuid(905);
    servidorDeCuenta({
      extra: {
        [`POST ${RUTA_ENVIO}`]: () =>
          json(409, {
            codigo: 'ORDEN_NO_ABIERTA',
            mensaje: 'La orden se unió a otra',
            ordenId: OTRA,
          }),
        [`GET /ordenes/${OTRA}`]: () => json(200, ordenDeMesa(5)),
      },
    });
    renderApp(RUTA);
    await agregarLomo();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('heading', { name: 'Agregar a Mesa 5' })).toBeVisible();
    expect(await screen.findByText('La cuenta se unió a otra')).toBeVisible();
    // El borrador pasó a la cuenta nueva y la vieja quedó limpia.
    expect(localStorage.getItem(CLAVE)).toBeNull();
    const nuevo = JSON.parse(
      localStorage.getItem(claveDeBorrador(ID.empresa, ID.usuario, OTRA)) ?? 'null',
    );
    expect(nuevo.lineas).toHaveLength(1);
    expect(nuevo.envioId).toBeNull();
    expect(screen.getByRole('button', { name: /^Editar 1 × Lomo saltado/ })).toBeVisible();
  });

  it('una cuenta que ya no está abierta no deja agregar nada', async () => {
    servidorDeCuenta({ orden: ordenDeMesa(4, { estado: 'ANULADA' }) });
    renderApp(RUTA);
    expect(await screen.findByText('Esta cuenta ya no está abierta')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });
});

describe('Comandero: pantallas anchas', () => {
  it('en una tableta la carta y «Por enviar» se ven juntas, sin pestañas', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((consulta: string) =>
      ({
        matches: true,
        media: consulta,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      servidorDeCuenta();
      renderApp(RUTA);
      expect(await screen.findByRole('list', { name: 'Productos de Fondos' })).toBeVisible();
      expect(screen.getByRole('region', { name: 'Por enviar' })).toBeVisible();
      expect(screen.queryByRole('group', { name: 'Qué ver' })).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
