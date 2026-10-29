import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { CELULAR } from './ayudas';
import { afirmarPantallaDeCelular, entrarEnCelular, medirPantalla } from './ayudas-carta';
import {
  CARTA,
  PRECIOS,
  afirmarClavesDelSalon,
  afirmarEstadoDeMesa,
  baldosaDeMesa,
  crearEscenarioDeSalon,
  cuentaPorApi,
  destino,
  esperarLaCuenta,
  itemDeCuenta,
  tarjetaDeCocina,
  vigilarEscriturasDelSalon,
  type EscenarioDeSalon,
} from './ayudas-salon';

/**
 * Salón y cocina de la entrega 3a (historia 004, tarea T28) en celulares de 360 px, contra la API real y
 * PostgreSQL, con el tiempo real encendido y sin ningún mock. Tres personas de la misma empresa se ven en vivo:
 *
 * - el Mozo atiende la mesa en su celular;
 * - Cocina/Barra de S1 mira el KDS en el suyo;
 * - un Supervisor mira el mapa del salón en otro (y es quien da la clave para anular).
 *
 * Los pasos, en este orden (cada uno depende del anterior, así que corren en serie):
 *
 * 1. el Administrador diseña una zona con tres mesas;
 * 2. el Mozo abre la mesa 1 y el Supervisor la ve en rojo sin recargar;
 * 3. el Mozo comanda un combo y un lomo en segundo tiempo y envía; el KDS ve la comanda con «Esperar»;
 * 4. el Mozo marcha; Cocina marca «Listo» y el Mozo recibe el aviso;
 * 5. el Mozo agrega una adición, pide la pre-cuenta (amarillo) y agrega otra adición (vuelve a rojo);
 * 6. pide otra pre-cuenta y anula 1 de 2 con la clave del Supervisor; el KDS ve la anulación con su motivo;
 * 7. une la mesa 2 y mueve la cuenta a la mesa 3;
 * 8. un envío con la red cortada queda «Pendiente de envío» y sale una sola vez al volver;
 * 9. a 360 px, las pantallas no se desplazan de lado y sus controles miden 44 px o más;
 * 10. en una tableta, el salón, la cuenta, el comandero y la cocina aprovechan el ancho.
 *
 * Los datos de cada corrida son de una empresa nueva: se puede repetir sobre la misma base. Toda escritura del
 * salón y la cocina debe llevar su clave de idempotencia: cada paso lo comprueba con lo que la PWA mandó de verdad.
 */
test.describe.configure({ mode: 'serial' });
// Un control que no está falla en segundos, no a los dos minutos del tiempo de la prueba.
test.use({ actionTimeout: 15_000 });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 820, height: 1180 },
  isMobile: false,
};

const ZONA = 'Salón principal';

let e: EscenarioDeSalon;
const abiertos: BrowserContext[] = [];

interface Persona {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDelSalon>;
}
let mozo: Persona;
let cocina: Persona;
let supervisor: Persona;
/** La cuenta de la mesa 1, que acompaña todo el servicio. */
let ordenId = '';

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
});

async function entrar(
  browser: Browser,
  persona: Parameters<typeof entrarEnCelular>[1],
  sucursal?: string,
  opciones: BrowserContextOptions = CELULAR,
): Promise<Persona> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal, opciones);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDelSalon(page) };
}

// --- Atajos de la pantalla --------------------------------------------------------------------------

/** El panel «Por enviar» del comandero (en celular se llega tocando el resumen de abajo). */
async function verPorEnviar(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Revisar lo que falta enviar/ }).click();
  const panel = page.getByRole('region', { name: 'Por enviar' });
  await expect(panel).toBeVisible();
  return panel;
}

/** Abre el comandero desde la cuenta y deja la carta a la vista. */
async function abrirElComandero(page: Page, titulo: string): Promise<void> {
  await page.getByRole('link', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Agregar a ${titulo}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Carta' })).toBeVisible();
}

/** Toca un producto de la carta del comandero; abre su hoja. */
async function elegirProducto(page: Page, nombre: string, precio: string) {
  await page.getByRole('button', { name: `${nombre}, ${precio}`, exact: true }).click();
  const hoja = page.getByRole('dialog', { name: nombre });
  await expect(hoja).toBeVisible();
  return hoja;
}

/** El PIN del supervisor en el teclado propio de la ventana de clave (el del sistema nunca se abre). */
async function escribirPinEn(ventana: Locator, pin: string): Promise<void> {
  for (const digito of pin) {
    await ventana.getByRole('button', { name: digito, exact: true }).click();
  }
}

/** El mapa del salón cambió en vivo si la pestaña nunca se recargó: se marca al empezar y debe seguir ahí. */
async function marcarSinRecarga(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __sinRecarga: boolean }).__sinRecarga = true;
  });
}
async function afirmarSinRecarga(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => (window as unknown as { __sinRecarga?: boolean }).__sinRecarga),
    'la pestaña no se recargó: el cambio llegó en vivo',
  ).toBe(true);
}

// ---------------------------------------------------------------------------------------------------------

test('el Administrador diseña una zona con tres mesas', async ({ browser }) => {
  const admin = await entrar(browser, e.administrador, e.s1.nombre);
  const { page } = admin;

  await test.step('sin zonas, el salón le dice qué hacer', async () => {
    await expect(page.getByText('Diseña tu salón', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/salon-1-diseña-tu-salon.png' });
    await page.getByRole('link', { name: 'Diseñar el salón' }).click();
    await expect(page.getByText('Aún no hay zonas', { exact: true })).toBeVisible();
  });

  await test.step('crea la zona de 3 × 2 celdas', async () => {
    await page.getByRole('button', { name: 'Agregar zona' }).click();
    await page.getByLabel('Nombre de la zona').fill(ZONA);
    await page.getByLabel('Columnas').fill('3');
    await page.getByLabel('Filas').fill('2');
    await page.getByRole('button', { name: 'Crear zona', exact: true }).click();
    await expect(page.getByText(`Zona ${ZONA} creada.`)).toBeVisible();
    await expect(page.getByText(/^3 × 2 celdas · 0 mesas$/)).toBeVisible();
  });

  await test.step('pone sus tres mesas, una por celda', async () => {
    const capacidades = ['4', '2', '6'];
    for (const [i, capacidad] of capacidades.entries()) {
      const nombre = String(i + 1);
      await page.getByRole('button', { name: 'Agregar mesa' }).click();
      await expect(page.getByLabel('Nombre de la mesa')).toHaveValue(nombre);
      await page.getByLabel('Capacidad (personas)').fill(capacidad);
      await page.getByRole('button', { name: 'Crear mesa' }).click();
      await expect(page.getByText(`Mesa ${nombre} creada.`)).toBeVisible();
      await expect(
        page.getByRole('button', { name: new RegExp(`^Mesa ${nombre},`) }),
      ).toBeVisible();
    }
    await page.screenshot({ path: 'e2e/resultados/salon-2-mapa-de-mesas.png', fullPage: true });
  });

  await test.step('el salón ya las muestra libres', async () => {
    await destino(page, 'Salón').click();
    await expect(page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();
    await expect(page.getByText('3 libres')).toBeVisible();
    for (const n of ['1', '2', '3']) await afirmarEstadoDeMesa(page, n, 'libre');
  });

  afirmarClavesDelSalon(admin.escrituras, [
    ['POST', /\/zonas$/],
    ['POST', /\/zonas\/[^/]+\/mesas$/],
  ]);
  await admin.contexto.close();
});

test('el Mozo abre la mesa 1 y el Supervisor la ve en rojo sin recargar', async ({ browser }) => {
  [mozo, cocina, supervisor] = [
    await entrar(browser, e.mozo),
    await entrar(browser, e.cocina),
    await entrar(browser, e.supervisor),
  ];
  await expect(mozo.page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();
  await expect(cocina.page.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();
  await expect(supervisor.page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();
  await expect(cocina.page.getByText('Sin comandas pendientes')).toBeVisible();

  // Cocina/Barra no atiende mesas: su navegación no tiene el Salón, y el Mozo no tiene la Cocina.
  await expect(destino(cocina.page, 'Salón')).toHaveCount(0);
  await expect(destino(mozo.page, 'Cocina')).toHaveCount(0);

  await marcarSinRecarga(supervisor.page);
  for (const n of ['1', '2', '3']) await afirmarEstadoDeMesa(supervisor.page, n, 'libre');

  await test.step('la hoja «Abrir mesa» propone la capacidad y el mozo responsable es quien abre', async () => {
    await baldosaDeMesa(mozo.page, '1').click();
    const hoja = mozo.page.getByRole('dialog', { name: 'Abrir mesa 1' });
    await expect(hoja).toBeVisible();
    const comensales = hoja.getByRole('group', { name: 'Cantidad de comensales' });
    await expect(comensales).toContainText('4');
    await expect(hoja.getByText('La mesa es para 4 personas.')).toBeVisible();
    await expect(hoja.getByText('Tú', { exact: true })).toBeVisible();
    await expect(hoja.getByText(e.mozo.nombre)).toBeVisible();
    await hoja.getByRole('button', { name: 'Quitar uno de comensales' }).click();
    await expect(comensales).toContainText('3');
    await mozo.page.waitForTimeout(400); // la hoja termina de subir
    await mozo.page.screenshot({ path: 'e2e/resultados/salon-3-abrir-mesa.png' });
    await hoja.getByRole('button', { name: 'Abrir mesa', exact: true }).click();
  });

  await test.step('lleva a la cuenta de la mesa, ocupada y todavía vacía', async () => {
    ordenId = await esperarLaCuenta(mozo.page, 'Mesa 1');
    await expect(mozo.page.locator('.cuenta__cabecera')).toContainText('Ocupada');
    await expect(mozo.page.locator('.cuenta__datos')).toContainText(
      `${e.mozo.nombre} · 3 comensales`,
    );
    await expect(mozo.page.getByText('Aún no se envió nada')).toBeVisible();
    // Sin ningún envío, la mesa se puede liberar o anular; todavía no hay pre-cuenta que pedir.
    await expect(mozo.page.getByRole('button', { name: 'Liberar la mesa' })).toBeVisible();
    await expect(mozo.page.getByRole('button', { name: /pre-cuenta/i })).toHaveCount(0);
  });

  await test.step('el Supervisor la ve ocupada, en rojo, sin recargar', async () => {
    await afirmarEstadoDeMesa(supervisor.page, '1', 'ocupada');
    await expect(baldosaDeMesa(supervisor.page, '1')).toHaveAttribute(
      'aria-label',
      /Ocupada · 3 · \d+ min/,
    );
    await expect(supervisor.page.getByText('1 ocupada')).toBeVisible();
    await afirmarEstadoDeMesa(supervisor.page, '2', 'libre');
    await afirmarSinRecarga(supervisor.page);
    await supervisor.page.screenshot({ path: 'e2e/resultados/salon-4-supervisor-ve-ocupada.png' });
  });

  afirmarClavesDelSalon(mozo.escrituras, [['POST', /^\/ordenes$/]]);
});

test('el Mozo comanda un combo y un lomo en segundo tiempo y envía; el KDS ve la comanda de Cocina con «Esperar»', async ({
  request,
}) => {
  const { page } = mozo;

  await test.step('arma el borrador con el combo y el lomo en tiempo 2', async () => {
    await abrirElComandero(page, 'Mesa 1');

    const combo = await elegirProducto(page, CARTA.combo, PRECIOS.combo);
    await expect(combo).toContainText(CARTA.arroz);
    await expect(combo).toContainText(CARTA.gaseosa);
    await combo.getByRole('button', { name: `Agregar · ${PRECIOS.combo}` }).click();
    await expect(combo).toBeHidden();

    const lomo = await elegirProducto(page, CARTA.lomo, PRECIOS.lomo);
    await lomo.getByRole('button', { name: 'Tiempo 2' }).click();
    await expect(
      lomo.getByText('Cocina lo recibe como «Esperar» hasta que marches.'),
    ).toBeVisible();
    await lomo.getByLabel(/Observación/).fill('sin cebolla');
    await lomo.getByRole('button', { name: `Agregar · ${PRECIOS.lomo}` }).click();
    await expect(lomo).toBeHidden();
  });

  await test.step('el borrador sobrevive a una recarga y muestra cada línea', async () => {
    await page.reload();
    await expect(page.getByText('2 ítems por enviar')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Revisar lo que falta enviar/ })).toContainText(
      'S/ 68.00',
    );
    const borrador = await verPorEnviar(page);
    await expect(borrador.getByRole('list', { name: 'Productos por enviar' })).toBeVisible();
    await expect(borrador.getByRole('button', { name: /^Editar 1 × Combo criollo/ })).toBeVisible();
    const lineaLomo = borrador.getByRole('button', { name: /^Editar 1 × Lomo saltado/ });
    await expect(lineaLomo).toContainText('Tiempo 2');
    await expect(lineaLomo).toContainText('«sin cebolla»');
    await expect(borrador.getByText('Total por enviar')).toBeVisible();
    await expect(borrador).toContainText('S/ 68.00');
    await page.screenshot({ path: 'e2e/resultados/salon-5-por-enviar.png' });
    await page.getByRole('button', { name: 'Seguir agregando' }).click();
  });

  await test.step('envía y la cuenta muestra la comanda agrupada', async () => {
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('Pedido enviado')).toBeVisible();
    await expect(page.getByText('La comanda ya salió a cocina.')).toBeVisible();
    const grupo = page.getByRole('region', { name: 'Comanda', exact: true });
    await expect(grupo).toContainText(e.mozo.nombre);
    await expect(itemDeCuenta(grupo, CARTA.combo)).toContainText('Enviado a cocina');
    const lomo = itemDeCuenta(grupo, CARTA.lomo);
    await expect(lomo).toContainText('Esperar');
    await expect(lomo).toContainText('«sin cebolla»');
    await expect(lomo).toContainText(PRECIOS.lomo);
    await expect(page.locator('.cuenta__total')).toContainText('S/ 68.00');
    await expect(page.getByRole('region', { name: 'Segundo tiempo' })).toContainText(
      '1 ítem de segundo tiempo',
    );
    await page.screenshot({ path: 'e2e/resultados/salon-6-cuenta-enviada.png', fullPage: true });
  });

  await test.step('el KDS recibe la comanda de Cocina con «Esperar» y la de Barra con la bebida del combo', async () => {
    const deCocina = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina');
    await expect(deCocina).toBeVisible();
    await expect(deCocina).toContainText(e.mozo.nombre);
    await expect(deCocina).toContainText('3 comensales');
    // El combo reparte su preparación: el arroz va a Cocina y dice de qué combo es.
    await expect(deCocina).toContainText(CARTA.arroz);
    await expect(deCocina).toContainText(CARTA.combo);
    const lineaLomo = deCocina.getByRole('listitem').filter({ hasText: CARTA.lomo });
    await expect(lineaLomo).toContainText('Esperar');
    await expect(lineaLomo).toContainText('Nota: sin cebolla');
    await expect(
      deCocina.getByRole('listitem').filter({ hasText: CARTA.arroz }).getByText('Esperar'),
    ).toHaveCount(0);
    // No lleva la gaseosa: es de Barra.
    await expect(deCocina).not.toContainText(CARTA.gaseosa);

    const deBarra = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra');
    await expect(deBarra).toContainText(CARTA.gaseosa);
    await expect(cocina.page.getByText('2 pendientes')).toBeVisible();
    await cocina.page.screenshot({ path: 'e2e/resultados/salon-7-kds-comanda.png' });
  });

  await test.step('el filtro de estación se recuerda en el equipo', async () => {
    const filtros = cocina.page.getByRole('group', { name: 'Estaciones' });
    await filtros.getByRole('button', { name: 'Cocina', exact: true }).click();
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra')).toHaveCount(0);
    await expect(cocina.page.getByText('1 pendiente', { exact: true })).toBeVisible();
    await cocina.page.reload();
    await expect(filtros.getByRole('button', { name: 'Cocina', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina')).toBeVisible();
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra')).toHaveCount(0);
    await filtros.getByRole('button', { name: 'Todas', exact: true }).click();
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra')).toBeVisible();
  });

  await test.step('la API recibió un solo envío con su clave de idempotencia', async () => {
    const envios = mozo.escrituras.filter(
      (w) => w.metodo === 'POST' && /^\/ordenes\/[^/]+\/envios$/.test(w.ruta),
    );
    expect(envios).toHaveLength(1);
    expect(envios[0]?.clave).toMatch(/^[0-9a-f-]{36}$/);
    const cuenta = await cuentaPorApi(request, page, ordenId);
    expect(cuenta.items.map((i) => `${i.cantidad} ${i.nombre}`).sort()).toEqual([
      `1 ${CARTA.combo}`,
      `1 ${CARTA.lomo}`,
    ]);
  });
  afirmarClavesDelSalon(mozo.escrituras, [['POST', /\/envios$/]]);
});

test('el Mozo marcha, Cocina marca «Listo» y el Mozo recibe el aviso', async () => {
  const { page } = mozo;

  await test.step('marcha el segundo tiempo y Cocina ve la marcha', async () => {
    await page.getByRole('button', { name: 'Marchar', exact: true }).click();
    await expect(page.getByText('Marcha enviada')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Segundo tiempo' })).toHaveCount(0);
    await expect(itemDeCuenta(page, CARTA.lomo)).toContainText('Marchado');
    await expect(itemDeCuenta(page, CARTA.lomo)).not.toContainText('Esperar');

    const marcha = tarjetaDeCocina(cocina.page, 'Marchar', 'Mesa 1', 'Cocina');
    await expect(marcha).toBeVisible();
    await expect(marcha).toContainText('Marchar: sacar ahora el segundo tiempo.');
    await expect(marcha).toContainText(CARTA.lomo);
    await expect(marcha.getByRole('button', { name: 'Enterado, Mesa 1' })).toBeVisible();
    await cocina.page.screenshot({ path: 'e2e/resultados/salon-8-kds-marchar.png' });
    await marcha.getByRole('button', { name: 'Enterado, Mesa 1' }).click();
    await expect(marcha).toHaveCount(0);
  });

  // «Preparando» es del KDS: su evento (`cocina.linea`) no lleva la orden, así que la cuenta del Mozo no se
  // refresca con él; el Mozo se entera con «Listo» (`cocina.listo`).
  await test.step('Cocina pone el lomo «Preparando»', async () => {
    const deCocina = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina');
    await deCocina.getByRole('button', { name: `Preparando: ${CARTA.lomo}` }).click();
    await expect(
      deCocina.getByRole('button', { name: `Preparando: ${CARTA.lomo}` }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('Cocina marca «Listo» y el Mozo recibe el aviso en el salón', async () => {
    const deCocina = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina');
    await deCocina.getByRole('button', { name: `Listo: ${CARTA.lomo}` }).click();
    await expect(
      deCocina.getByRole('button', { name: `Deshacer el listo: ${CARTA.lomo}` }),
    ).toBeVisible();
    // La cuenta del Mozo cambia sin recargar.
    await expect(itemDeCuenta(page, CARTA.lomo)).toContainText('Listo');

    await page.getByRole('link', { name: 'Volver a Salón' }).click();
    const aviso = page.getByRole('button', {
      name: /^Lomo saltado × 1 de la mesa 1 está listo\. Toca para quitar el aviso\.$/,
    });
    await expect(aviso).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Avisos' })).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/salon-9-aviso-de-listo.png' });
    await aviso.click();
    await expect(page.getByRole('heading', { name: 'Avisos' })).toHaveCount(0);
  });

  await test.step('«Todo listo» en Barra avisa también la bebida del combo', async () => {
    const deBarra = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra');
    await deBarra.getByRole('button', { name: 'Todo listo, Mesa 1' }).click();
    await expect(deBarra).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Gaseosa de la casa × 1 de la mesa 1 está listo\./ }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Gaseosa de la casa × 1/ }).click();
    await expect(page.getByRole('heading', { name: 'Avisos' })).toHaveCount(0);
    // Lo terminado queda en «Recientes» por si se puso por error.
    await expect(cocina.page.getByRole('button', { name: /^Recientes/ })).toContainText(
      /comandas? de la última hora/,
    );
  });

  afirmarClavesDelSalon(mozo.escrituras, [['POST', /\/marchas$/]]);
  afirmarClavesDelSalon(cocina.escrituras, [
    ['PUT', /\/cocina\/lineas\/[^/]+\/estado$/],
    ['PUT', /\/cocina\/comandas\/[^/]+\/listo$/],
    ['PUT', /\/cocina\/comandas\/[^/]+\/visto$/],
  ]);
});

test('el Mozo agrega una adición, pide la pre-cuenta (amarillo) y agrega otra (vuelve a rojo)', async () => {
  const { page } = mozo;
  await baldosaDeMesa(page, '1').click();
  await esperarLaCuenta(page, 'Mesa 1');

  await test.step('adición 2: dos ceviches', async () => {
    await abrirElComandero(page, 'Mesa 1');
    const ceviche = await elegirProducto(page, CARTA.ceviche, PRECIOS.ceviche);
    await ceviche.getByRole('button', { name: `Agregar una unidad de ${CARTA.ceviche}` }).click();
    await expect(
      ceviche.getByRole('group', { name: `Cantidad de ${CARTA.ceviche}` }),
    ).toContainText('2');
    await ceviche.getByRole('button', { name: 'Agregar · S/ 76.00' }).click();
    await expect(page.getByText('2 ítems por enviar')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('La adición 2 ya salió a cocina.')).toBeVisible();
    await expect(
      itemDeCuenta(page.getByRole('region', { name: 'Adición 2' }), CARTA.ceviche),
    ).toContainText('2 ×');
    await expect(page.locator('.cuenta__total')).toContainText('S/ 144.00');

    const adicion = tarjetaDeCocina(cocina.page, 'Adición', 'Mesa 1', 'Cocina');
    await expect(adicion).toBeVisible();
    await expect(adicion).toContainText(CARTA.ceviche);
    await expect(adicion.getByText('2 ×')).toBeVisible();
  });

  await test.step('la pre-cuenta pone la mesa en amarillo para todos', async () => {
    await page.getByRole('button', { name: 'Pedir pre-cuenta' }).click();
    const hoja = page.getByRole('dialog', { name: 'Pre-cuenta' });
    await expect(hoja).toBeVisible();
    await expect(hoja).toContainText('Pre-cuenta 1');
    await expect(hoja.getByRole('list', { name: 'Detalle de la pre-cuenta' })).toContainText(
      `${CARTA.ceviche}`,
    );
    await expect(hoja.locator('.precuenta__total')).toContainText('S/ 144.00');
    await expect(hoja).toContainText('IGV incluido');
    await expect(hoja).toContainText('La impresión llega con el puente de impresión');
    await page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: 'e2e/resultados/salon-10-precuenta.png' });
    await hoja.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await expect(hoja).toBeHidden();

    await expect(page.locator('.cuenta__cabecera')).toContainText('Pre-cuenta');
    await expect(page.locator('.cuenta__precuenta-dato')).toContainText(
      'Pre-cuenta 1 pedida a las',
    );
    await afirmarEstadoDeMesa(supervisor.page, '1', 'en-precuenta');
    await expect(supervisor.page.getByText('1 en pre-cuenta')).toBeVisible();
    await supervisor.page.screenshot({
      path: 'e2e/resultados/salon-11-supervisor-ve-precuenta.png',
    });
  });

  await test.step('una adición deja sin valor la pre-cuenta y la mesa vuelve a rojo', async () => {
    await abrirElComandero(page, 'Mesa 1');
    await page
      .getByRole('group', { name: 'Familias de la carta' })
      .getByRole('button', { name: CARTA.familias.bebidas })
      .click();
    const gaseosa = await elegirProducto(page, CARTA.gaseosa, PRECIOS.gaseosa);
    await gaseosa.getByRole('button', { name: `Agregar · ${PRECIOS.gaseosa}` }).click();
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('La adición 3 ya salió a cocina.')).toBeVisible();

    await expect(page.locator('.cuenta__cabecera')).toContainText('Ocupada');
    await expect(page.locator('.cuenta__precuenta-dato')).toHaveCount(0);
    await expect(page.locator('.cuenta__total')).toContainText('S/ 150.00');
    await afirmarEstadoDeMesa(supervisor.page, '1', 'ocupada');
    await afirmarSinRecarga(supervisor.page);
    // La barra tiene su comanda de adición.
    await expect(tarjetaDeCocina(cocina.page, 'Adición', 'Mesa 1', 'Barra')).toBeVisible();
  });

  afirmarClavesDelSalon(mozo.escrituras, [['POST', /\/precuentas$/]]);
});

test('el Mozo pide otra pre-cuenta y anula 1 de 2 con la clave del Supervisor; el KDS ve la anulación con su motivo', async ({
  request,
}) => {
  const { page } = mozo;

  await test.step('otra pre-cuenta: la mesa vuelve a amarillo', async () => {
    await page.getByRole('button', { name: 'Pedir pre-cuenta' }).click();
    const hoja = page.getByRole('dialog', { name: 'Pre-cuenta' });
    await expect(hoja).toContainText('Pre-cuenta 2');
    await expect(hoja.locator('.precuenta__total')).toContainText('S/ 150.00');
    await hoja.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await afirmarEstadoDeMesa(supervisor.page, '1', 'en-precuenta');
    await expect(page.getByRole('button', { name: 'Ver pre-cuenta' })).toBeVisible();
  });

  await test.step('anula 1 de 2 ceviches: cantidad, motivo y destino del stock', async () => {
    await page.getByRole('button', { name: `Anular ${CARTA.ceviche}` }).click();
    const hoja = page.getByRole('dialog', { name: 'Anular ítem' });
    await expect(hoja).toBeVisible();
    await expect(hoja).toContainText('2 enviados · S/ 76.00');
    // Por defecto se anula todo (decisión 6); se baja a una unidad.
    await expect(hoja.getByRole('group', { name: `Cantidad de ${CARTA.ceviche}` })).toContainText(
      '2',
    );
    await hoja.getByRole('button', { name: `Quitar una unidad de ${CARTA.ceviche}` }).click();
    await expect(hoja.getByRole('group', { name: `Cantidad de ${CARTA.ceviche}` })).toContainText(
      '1',
    );

    // Sin motivo ni destino del stock no se puede pedir la clave.
    await hoja.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
    await expect(hoja.getByText('Elige o escribe el motivo')).toBeVisible();
    await expect(hoja.getByText('Elige qué pasa con el stock')).toBeVisible();

    await hoja.getByRole('button', { name: 'Error al comandar' }).click();
    await hoja.getByRole('radio', { name: /Vuelve al stock/ }).check();
    await mozo.page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: 'e2e/resultados/salon-12-anular-item.png' });
    await hoja.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
  });

  await test.step('la ventana de clave dice qué se autoriza; una clave mala no anula nada', async () => {
    const ventana = page.getByRole('dialog', { name: 'Clave de supervisor' });
    await expect(ventana).toBeVisible();
    await expect(ventana).toContainText(`Anular ítem: ${CARTA.ceviche} × 1 · S/ 38.00`);
    await expect(ventana).toContainText('Motivo: Error al comandar');
    await escribirPinEn(ventana, '111111');
    await expect(ventana.getByText('La clave no es válida')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Anular ítem' })).toBeAttached();
    await expect(itemDeCuenta(page, CARTA.ceviche)).toContainText('2 ×');

    await page.waitForTimeout(700); // los puntos del error se vacían
    await escribirPinEn(ventana, e.supervisor.pin);
    await expect(ventana).toBeHidden();
  });

  await test.step('la cuenta queda con 1 ceviche, la pre-cuenta ya no vale y la mesa vuelve a rojo', async () => {
    await expect(page.getByRole('dialog', { name: 'Anular ítem' })).toBeHidden();
    await expect(page.getByText(`Anulaste 1 × ${CARTA.ceviche}.`)).toBeVisible();
    const ceviche = itemDeCuenta(page, CARTA.ceviche);
    await expect(ceviche).toContainText('1 ×');
    await expect(ceviche).toContainText('1 anulado');
    await expect(page.locator('.cuenta__total')).toContainText('S/ 112.00');
    await expect(page.locator('.cuenta__cabecera')).toContainText('Ocupada');
    await afirmarEstadoDeMesa(supervisor.page, '1', 'ocupada');
    await afirmarSinRecarga(supervisor.page);
    await page.screenshot({ path: 'e2e/resultados/salon-13-item-anulado.png', fullPage: true });
  });

  await test.step('el KDS ve la anulación con su motivo y la da por enterada', async () => {
    const anulacion = tarjetaDeCocina(cocina.page, 'Anulación', 'Mesa 1', 'Cocina');
    await expect(anulacion).toBeVisible();
    await expect(anulacion).toContainText('No lo prepares.');
    await expect(anulacion).toContainText('Motivo: Error al comandar');
    await expect(anulacion).toContainText(CARTA.ceviche);
    await cocina.page.screenshot({ path: 'e2e/resultados/salon-14-kds-anulacion.png' });
    await anulacion.getByRole('button', { name: 'Enterado, Mesa 1' }).click();
    await expect(anulacion).toHaveCount(0);
  });

  await test.step('la API tiene la anulación hecha una sola vez y con la clave pedida', async () => {
    const cuenta = await cuentaPorApi<{
      total: string;
      items: { nombre: string; cantidad: number; cantidadAnulada: number }[];
    }>(request, page, ordenId);
    expect(cuenta.total).toBe('112.00');
    const ceviche = cuenta.items.find((i) => i.nombre === CARTA.ceviche);
    expect(ceviche).toMatchObject({ cantidad: 2, cantidadAnulada: 1 });
    const anulaciones = mozo.escrituras.filter((w) => /\/anulaciones$/.test(w.ruta));
    // Las dos veces que se pidió la clave: la mala no llegó a anular (solo hay un POST de anulación).
    expect(anulaciones).toHaveLength(1);
    afirmarClavesDelSalon(mozo.escrituras, [
      ['POST', /\/autorizaciones$/],
      ['POST', /\/items\/[^/]+\/anulaciones$/],
    ]);
  });
});

test('el Mozo une la mesa 2 y mueve la cuenta a la mesa 3', async () => {
  const { page } = mozo;

  await test.step('une la mesa 2 libre a la cuenta', async () => {
    await page.getByRole('link', { name: 'Unir', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unir mesas', level: 1 })).toBeVisible();
    await expect(page.getByText('La venta queda a nombre de')).toBeVisible();
    // La mesa 1 es de la propia cuenta: no se puede elegir.
    await expect(baldosaDeMesa(page, '1')).toHaveCount(0);
    await baldosaDeMesa(page, '2').click();
    await expect(page.getByRole('region', { name: 'Mesas elegidas' })).toContainText(
      'Mesa 2 · Libre',
    );
    await page.screenshot({ path: 'e2e/resultados/salon-15-unir.png' });
    await page.getByRole('button', { name: 'Unir 2', exact: true }).click();
    const confirmacion = page.getByRole('dialog', { name: '¿Unir 2?' });
    await expect(confirmacion).toContainText(
      `Unir 2 a la cuenta de la mesa 1: la venta queda a nombre de ${e.mozo.nombre}.`,
    );
    await confirmacion.getByRole('button', { name: 'Sí, unir' }).click();

    await esperarLaCuenta(page, 'Mesas 1 y 2');
    await expect(
      page.getByText(`Se unieron 2 a esta cuenta. La venta queda a nombre de ${e.mozo.nombre}.`),
    ).toBeVisible();
    await expect(page.locator('.cuenta__total')).toContainText('S/ 112.00');
  });

  await test.step('el Supervisor ve las dos mesas como un grupo', async () => {
    const sup = supervisor.page;
    await afirmarEstadoDeMesa(sup, '1', 'ocupada');
    await afirmarEstadoDeMesa(sup, '2', 'ocupada');
    await expect(baldosaDeMesa(sup, '1')).toHaveAttribute('aria-label', /Grupo con 2/);
    await expect(baldosaDeMesa(sup, '2')).toHaveAttribute('aria-label', /Grupo con 1/);
    await expect(sup.getByRole('list', { name: 'Mesas unidas' })).toContainText(
      'Mesa 1 · Grupo con 2',
    );
    await expect(sup.getByText('2 ocupadas')).toBeVisible();
    await sup.screenshot({ path: 'e2e/resultados/salon-16-supervisor-ve-grupo.png' });
  });

  await test.step('mueve la cuenta de la mesa 1 a la mesa 3', async () => {
    await page.getByRole('link', { name: 'Mover', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mover la cuenta', level: 1 })).toBeVisible();
    // Con dos mesas hay que decir cuál se mueve.
    await expect(page.getByRole('button', { name: 'Elige una mesa libre' })).toBeDisabled();
    await page
      .getByRole('group', { name: 'Mesa que se mueve' })
      .getByRole('button', { name: 'Mesa 1' })
      .click();
    // Solo las libres se pueden elegir: la 2 es de la cuenta.
    await expect(baldosaDeMesa(page, '2')).toHaveCount(0);
    await baldosaDeMesa(page, '3').click();
    await page.getByRole('button', { name: 'Mover a la mesa 3' }).click();
    const confirmacion = page.getByRole('dialog', { name: '¿Mover a la mesa 3?' });
    await expect(confirmacion).toContainText(
      `La cuenta pasa de la mesa 1 a la mesa 3. Sigue a cargo de ${e.mozo.nombre}.`,
    );
    await expect(confirmacion).toContainText('Los ítems y la pre-cuenta no cambian.');
    await confirmacion.getByRole('button', { name: 'Sí, mover' }).click();

    await esperarLaCuenta(page, 'Mesas 2 y 3');
    await expect(
      page.getByText('La cuenta pasó a la mesa 3. La mesa 1 quedó libre.'),
    ).toBeVisible();
    await expect(page.locator('.cuenta__total')).toContainText('S/ 112.00');
  });

  await test.step('el Supervisor ve la mesa 1 libre y el grupo en las mesas 2 y 3', async () => {
    const sup = supervisor.page;
    await afirmarEstadoDeMesa(sup, '1', 'libre');
    await afirmarEstadoDeMesa(sup, '2', 'ocupada');
    await afirmarEstadoDeMesa(sup, '3', 'ocupada');
    await expect(baldosaDeMesa(sup, '3')).toHaveAttribute('aria-label', /Grupo con 2/);
    await expect(sup.getByText('1 libre', { exact: true })).toBeVisible();
    await afirmarSinRecarga(sup);
    await sup.screenshot({ path: 'e2e/resultados/salon-17-supervisor-ve-movida.png' });
  });

  afirmarClavesDelSalon(mozo.escrituras, [
    ['POST', /\/union$/],
    ['POST', /\/movimiento$/],
  ]);
});

test('un envío con la red cortada queda «Pendiente de envío» y sale una sola vez al volver', async ({
  request,
}) => {
  const { page, contexto } = mozo;
  const intentos: { clave: string | undefined }[] = [];
  const respuestas: number[] = [];
  page.on('request', (p) => {
    if (p.method() === 'POST' && /^\/ordenes\/[^/]+\/envios$/.test(new URL(p.url()).pathname)) {
      intentos.push({ clave: p.headers()['idempotency-key'] });
    }
  });
  page.on('response', (r) => {
    if (
      r.request().method() === 'POST' &&
      /\/ordenes\/[^/]+\/envios$/.test(new URL(r.url()).pathname)
    ) {
      respuestas.push(r.status());
    }
  });

  await abrirElComandero(page, 'Mesas 2 y 3');
  await page
    .getByRole('group', { name: 'Familias de la carta' })
    .getByRole('button', { name: CARTA.familias.bebidas })
    .click();
  const gaseosa = await elegirProducto(page, CARTA.gaseosa, PRECIOS.gaseosa);
  await gaseosa.getByLabel(/Observación/).fill('sin hielo');
  await gaseosa.getByRole('button', { name: `Agregar · ${PRECIOS.gaseosa}` }).click();
  await expect(page.getByText('1 ítem por enviar')).toBeVisible();

  await test.step('sin red, «Enviar» no se pierde: dice «Pendiente de envío» y el borrador se bloquea', async () => {
    await contexto.setOffline(true);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pendiente de envío' })).toBeVisible();
    const borrador = await verPorEnviar(page);
    await expect(borrador.getByText('Pendiente de envío')).toBeVisible();
    await expect(borrador).toContainText('Tus cambios se enviarán solos al volver la red');
    // Mientras espera, la línea no se puede editar ni quitar.
    await expect(borrador.getByRole('button', { name: /^Editar / })).toHaveCount(0);
    await expect(borrador.getByRole('button', { name: /^Quitar / })).toHaveCount(0);
    await expect(page.getByText('Sin conexión', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/salon-18-pendiente-de-envio.png' });
    expect(respuestas, 'sin red no hay respuesta del servidor').toEqual([]);
  });

  await test.step('al volver la red sale una sola vez, con la misma clave', async () => {
    await contexto.setOffline(false);
    await esperarLaCuenta(page, 'Mesas 2 y 3');
    await expect(page.getByText('La adición 4 ya salió a cocina.')).toBeVisible();
    await expect(page.getByText('Sin conexión', { exact: true })).toHaveCount(0);

    expect(
      intentos.length,
      'el primer intento falló por la red y hubo al menos un reintento',
    ).toBeGreaterThanOrEqual(2);
    expect(
      new Set(intentos.map((i) => i.clave)).size,
      'todos los intentos llevan la misma clave',
    ).toBe(1);
    expect(intentos[0]?.clave).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      respuestas.filter((s) => s >= 200 && s < 300),
      'una sola respuesta de éxito',
    ).toHaveLength(1);
  });

  await test.step('la cuenta y la cocina tienen la gaseosa una sola vez', async () => {
    const cuenta = await cuentaPorApi<{
      total: string;
      items: { nombre: string; cantidad: number; envioNumero: number }[];
    }>(request, page, ordenId);
    const gaseosas = cuenta.items.filter((i) => i.nombre === CARTA.gaseosa);
    expect(gaseosas.map((i) => `${i.envioNumero}:${i.cantidad}`).sort()).toEqual(['3:1', '4:1']);
    expect(cuenta.total).toBe('118.00');
    await expect(page.locator('.cuenta__total')).toContainText('S/ 118.00');

    const deBarra = cocina.page.getByRole('article', {
      name: /^Adición, Mesas (2 y 3|3 y 2), Barra$/,
    });
    await expect(deBarra).toHaveCount(2);
    await expect(deBarra.filter({ hasText: 'Nota: sin hielo' })).toHaveCount(1);
    await cocina.page.waitForTimeout(1500);
    await expect(deBarra).toHaveCount(2);
  });
});

// --- Diseño: 360 px y tableta ------------------------------------------------------------------------

test('a 360 px, las pantallas del salón y la cocina no se desplazan de lado y sus controles miden 44 px o más', async ({
  browser,
}) => {
  const { page } = mozo;
  expect(page.viewportSize()?.width, 'el celular de la prueba mide 360 px').toBe(360);

  await test.step('Salón: mapa, lista y hoja de abrir mesa', async () => {
    await page.getByRole('link', { name: 'Volver a Salón' }).click();
    await expect(page.getByText('1 libre', { exact: true })).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Salón > mapa');
    await page.screenshot({ path: 'e2e/resultados/salon-19-mapa-360.png', fullPage: true });

    await page.getByRole('switch', { name: 'Lista' }).click();
    await expect(page.getByRole('list', { name: `Mesas de ${ZONA}` })).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Salón > lista');
    await page.screenshot({ path: 'e2e/resultados/salon-20-lista-360.png', fullPage: true });
    await page.getByRole('switch', { name: 'Lista' }).click();

    await baldosaDeMesa(page, '1').click();
    const hoja = page.getByRole('dialog', { name: 'Abrir mesa 1' });
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Salón > hoja de abrir mesa');
    await hoja.getByRole('button', { name: 'Cancelar' }).click();
    await expect(hoja).toBeHidden();
  });

  await test.step('Cuenta: ítems, hoja de anular y ventana de clave', async () => {
    await baldosaDeMesa(page, '2').click();
    await esperarLaCuenta(page, 'Mesas 2 y 3');
    await afirmarPantallaDeCelular(page, 'Cuenta de la mesa');

    await page.getByRole('button', { name: `Anular ${CARTA.ceviche}` }).click();
    const hoja = page.getByRole('dialog', { name: 'Anular ítem' });
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Cuenta > hoja de anular ítem');
    await hoja.getByRole('button', { name: 'Error al comandar' }).click();
    await hoja.getByRole('radio', { name: /Es merma/ }).check();
    await hoja.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
    const ventana = page.getByRole('dialog', { name: 'Clave de supervisor' });
    await expect(ventana).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Cuenta > ventana de clave de supervisor');
    await ventana.getByRole('button', { name: 'Cancelar' }).click();
    await hoja.getByRole('button', { name: 'Cerrar' }).click();
    await expect(hoja).toBeHidden();
  });

  await test.step('Comandero: carta, hoja de producto y «Por enviar»', async () => {
    await abrirElComandero(page, 'Mesas 2 y 3');
    await afirmarPantallaDeCelular(page, 'Comandero > carta');
    await page.screenshot({ path: 'e2e/resultados/salon-21-comandero-360.png', fullPage: true });

    const hoja = await elegirProducto(page, CARTA.lomo, PRECIOS.lomo);
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Comandero > hoja de producto');
    await page.screenshot({ path: 'e2e/resultados/salon-22-hoja-de-producto-360.png' });
    await hoja.getByRole('button', { name: `Agregar · ${PRECIOS.lomo}` }).click();
    await expect(hoja).toBeHidden();

    await verPorEnviar(page);
    await afirmarPantallaDeCelular(page, 'Comandero > por enviar');
    await page.screenshot({ path: 'e2e/resultados/salon-23-por-enviar-360.png', fullPage: true });
    // El borrador se puede deshacer sin clave.
    await page.getByRole('button', { name: `Quitar 1 × ${CARTA.lomo}` }).click();
    await expect(page.getByText('Nada por enviar')).toBeVisible();
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await page.getByRole('button', { name: `Quitar 1 × ${CARTA.lomo}` }).click();
    await page.getByRole('link', { name: /^Volver a / }).click();
  });

  await test.step('Pre-cuenta, mover y unir', async () => {
    await esperarLaCuenta(page, 'Mesas 2 y 3');
    await page.getByRole('button', { name: 'Pedir pre-cuenta' }).click();
    const hoja = page.getByRole('dialog', { name: 'Pre-cuenta' });
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Cuenta > pre-cuenta');
    await hoja.getByRole('button', { name: 'Volver a la cuenta' }).click();

    await page.getByRole('link', { name: 'Mover', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mover la cuenta', level: 1 })).toBeVisible();
    await expect(baldosaDeMesa(page, '1')).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Mover la cuenta');
    await page.screenshot({ path: 'e2e/resultados/salon-24-mover-360.png', fullPage: true });
    await page.getByRole('link', { name: /^Volver a / }).click();

    await page.getByRole('link', { name: 'Unir', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unir mesas', level: 1 })).toBeVisible();
    await expect(baldosaDeMesa(page, '1')).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Unir mesas');
    await page.getByRole('link', { name: /^Volver a / }).click();
    await esperarLaCuenta(page, 'Mesas 2 y 3');
  });

  await test.step('Cocina: la comanda, la anulación y las recientes', async () => {
    const pagina = cocina.page;
    await expect(pagina.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();
    await expect(
      pagina.getByRole('article', { name: /^Adición, Mesas (2 y 3|3 y 2), Cocina$/ }),
    ).toBeVisible();
    await afirmarPantallaDeCelular(pagina, 'Cocina');
    await pagina.getByRole('button', { name: /^Recientes/ }).click();
    await afirmarPantallaDeCelular(pagina, 'Cocina > recientes');
    await pagina.screenshot({ path: 'e2e/resultados/salon-25-cocina-360.png', fullPage: true });
  });

  await test.step('Ajustes: el mapa de mesas y su editor', async () => {
    const admin = await entrar(browser, e.administrador, e.s1.nombre);
    await destino(admin.page, 'Ajustes').click();
    await admin.page.getByRole('button', { name: 'Mapa de mesas' }).click();
    await expect(admin.page.getByRole('grid', { name: `Mesas de ${ZONA}` })).toBeVisible();
    await afirmarPantallaDeCelular(admin.page, 'Ajustes > mapa de mesas');
    await baldosaDeMesa(admin.page, '2').click();
    await expect(admin.page.getByRole('group', { name: 'Mover la mesa' })).toBeVisible();
    await afirmarPantallaDeCelular(admin.page, 'Ajustes > editar una mesa');
    await admin.page.screenshot({ path: 'e2e/resultados/salon-26-editor-360.png', fullPage: true });
    await admin.contexto.close();
  });

  // Que haya medido de verdad: las pantallas tienen controles táctiles.
  expect((await medirPantalla(page)).medidos).toBeGreaterThan(0);
});

test('en una tableta, el mapa, la cuenta, el comandero y la cocina aprovechan el ancho', async ({
  browser,
}) => {
  const mesas = await entrar(browser, e.mozo, undefined, TABLETA);
  const kds = await entrar(browser, e.cocina, undefined, TABLETA);
  const todo = (p: Page) =>
    p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  await test.step('Salón: mapa más ancho y avisos', async () => {
    await expect(mesas.page.getByRole('grid', { name: `Mesas de ${ZONA}` })).toBeVisible();
    for (const n of ['1', '2', '3']) await expect(baldosaDeMesa(mesas.page, n)).toBeVisible();
    await afirmarEstadoDeMesa(mesas.page, '2', 'en-precuenta');
    await afirmarEstadoDeMesa(mesas.page, '1', 'libre');
    expect(await todo(mesas.page), 'sin desplazamiento lateral').toBe(true);
    await mesas.page.screenshot({
      path: 'e2e/resultados/salon-27-mapa-tableta.png',
      fullPage: true,
    });
  });

  await test.step('Comandero: la carta y «Por enviar» se ven a la vez', async () => {
    await baldosaDeMesa(mesas.page, '2').click();
    await esperarLaCuenta(mesas.page, 'Mesas 2 y 3');
    await abrirElComandero(mesas.page, 'Mesas 2 y 3');
    await expect(mesas.page.getByRole('region', { name: 'Carta' })).toBeVisible();
    await expect(mesas.page.getByRole('region', { name: 'Por enviar' })).toBeVisible();
    // No hay botón para cambiar de panel: ya están los dos.
    await expect(mesas.page.getByRole('button', { name: 'Seguir agregando' })).toHaveCount(0);
    const hoja = await elegirProducto(mesas.page, CARTA.lomo, PRECIOS.lomo);
    await mesas.page.waitForTimeout(400);
    await mesas.page.screenshot({ path: 'e2e/resultados/salon-28-comandero-tableta.png' });
    await hoja.getByRole('button', { name: 'Cerrar' }).click();
    expect(await todo(mesas.page), 'sin desplazamiento lateral').toBe(true);
  });

  await test.step('Cocina: las comandas se reparten en columnas', async () => {
    const tarjetas = kds.page
      .getByRole('list', { name: 'Comandas pendientes' })
      .getByRole('article');
    await expect(tarjetas.first()).toBeVisible();
    expect(await tarjetas.count()).toBeGreaterThanOrEqual(2);
    const cajas = await tarjetas.evaluateAll((els) =>
      els.map((el) => {
        const c = el.getBoundingClientRect();
        return { x: Math.round(c.left), y: Math.round(c.top) };
      }),
    );
    expect(
      new Set(cajas.map((c) => c.x)).size,
      'las comandas ocupan más de una columna',
    ).toBeGreaterThan(1);
    expect(await todo(kds.page), 'sin desplazamiento lateral').toBe(true);
    await kds.page.screenshot({
      path: 'e2e/resultados/salon-29-cocina-tableta.png',
      fullPage: true,
    });
  });
});
