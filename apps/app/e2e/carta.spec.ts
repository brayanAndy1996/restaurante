import {
  expect,
  test,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { CELULAR, llamarApi, tokenDeSesion } from './ayudas';
import {
  afirmarClavesDeIdempotencia,
  crearEscenarioDeCarta,
  entrarEnCelular,
  fotoDePrueba,
  type EscenarioDeCarta,
} from './ayudas-carta';

/**
 * La carta y la disponibilidad (historia 003, sección 2, tarea T28) en un celular de 360 px, contra la API real
 * y PostgreSQL, sin ningún mock. Cinco personas de la misma empresa, en este orden:
 *
 * 1. el Administrador arma la carta (estación, familia, productos, una foto, precio propio en S1, no
 *    disponible en S2, un producto que no se vende solo, un combo y un menú del día) y ordena los productos;
 * 2. Cocina/Barra de S1 arma el menú de hoy y marca un plato agotado solo por hoy: el combo que lo lleva
 *    queda sin poder venderse;
 * 3. un Cajero de S1 cambia un precio, le pone precio propio en S1 y ve la fila de S2 solo para leer;
 * 4. el Administrador convierte el combo en un producto simple y confirma lo que se quita;
 * 5. un Mozo no ve ni la Carta ni la Disponibilidad;
 * 6. en una tableta, la lista de productos y la de agotados pasan a tabla.
 *
 * Cada paso depende del anterior, así que los pasos corren en serie. Los datos de cada corrida son de una
 * empresa nueva: se puede repetir sobre la misma base. Toda escritura de la carta debe llevar su clave de
 * idempotencia: cada paso lo comprueba con lo que la PWA mandó de verdad.
 */
test.describe.configure({ mode: 'serial' });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 820, height: 1180 },
  isMobile: false,
};

const FAMILIA = 'Fondos';
const ESTACION = 'Cocina';
const LOMO = 'Lomo saltado';
const ARROZ = 'Arroz chaufa';
const AJI = 'Ají de la casa';
const SALSA = 'Salsa huancaína';
const GASEOSA = 'Gaseosa de la casa';
const COMBO = 'Combo criollo';
const MENU = 'Menú ejecutivo';
const TIEMPO = 'Segundo';

let e: EscenarioDeCarta;
const abiertos: BrowserContext[] = [];

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeCarta(request);
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
});

// --- Atajos de la pantalla --------------------------------------------------------------------------

/** Un destino de la navegación inferior ("Carta", "Disponibilidad"). */
const destino = (page: Page, nombre: string): Locator =>
  page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: nombre });

/** Una sección de la carta ("Familias", "Estaciones"…). */
const seccionDeCarta = (page: Page, nombre: string): Locator =>
  page
    .getByRole('group', { name: 'Secciones de la carta' })
    .getByRole('button', { name: nombre, exact: true });

/** Una sección de Disponibilidad ("Agotados", "Menú del día"). */
const seccionDeDisponibilidad = (page: Page, nombre: string): Locator =>
  page
    .getByRole('group', { name: 'Secciones de disponibilidad' })
    .getByRole('button', { name: nombre, exact: true });

/** La familia de la lista de productos. */
const familia = (page: Page): Locator => page.getByRole('region', { name: FAMILIA });

/** El bloque de un producto en la lista de agotados (en celular, una fila de lista). */
const filaDeAgotados = (page: Page, nombre: string): Locator =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByText(nombre, { exact: true }) })
    .filter({ has: page.getByRole('switch') });

/** La fila de una sucursal en "Precio por sucursal". */
const filaDeSucursal = (page: Page, nombre: string): Locator =>
  page
    .locator('li.sucursal')
    .filter({ has: page.getByRole('heading', { name: nombre, exact: true }) });

/** La foto llegó de verdad: la API la sirve a otro origen y el navegador la dibuja. */
async function esperarImagenCargada(imagen: Locator): Promise<void> {
  await expect(imagen).toBeVisible();
  await expect
    .poll(() => imagen.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      message: 'la foto se descarga de la API (CORS y CORP de /archivos)',
    })
    .toBeGreaterThan(0);
}

async function agregarEnLaLista(
  page: Page,
  seccion: 'Familias' | 'Estaciones',
  nombre: string,
): Promise<void> {
  const [boton, campo, crear] =
    seccion === 'Familias'
      ? ['Agregar familia', 'Nombre de la familia', 'Crear familia']
      : ['Agregar estación', 'Nombre de la estación', 'Crear estación'];
  await seccionDeCarta(page, seccion).click();
  // Con la lista vacía hay dos botones iguales (el del estado vacío y el fijo abajo): se toca el de abajo.
  await page.getByRole('button', { name: boton, exact: true }).last().click();
  await page.getByLabel(campo).fill(nombre);
  await page.getByRole('button', { name: crear, exact: true }).click();
  await expect(
    page.getByRole('list', { name: seccion }).getByText(nombre, { exact: true }),
  ).toBeVisible();
}

/** Llena los datos de un producto simple nuevo y lo crea; termina en su pantalla de edición. */
async function crearProducto(
  page: Page,
  datos: { nombre: string; precio?: string; estacion: string },
): Promise<void> {
  await page.getByRole('link', { name: 'Nuevo producto' }).last().click();
  await expect(page.getByRole('heading', { name: 'Nuevo producto' })).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill(datos.nombre);
  await page.getByLabel('Familia').selectOption({ label: FAMILIA });
  if (datos.precio === undefined) {
    // Un producto que no se vende solo no lleva precio: solo sirve dentro de un combo o como opción.
    await page.getByRole('switch', { name: 'Se vende solo' }).click();
    await expect(page.getByLabel('Precio con IGV')).toHaveCount(0);
  } else {
    await page.getByLabel('Precio con IGV').fill(datos.precio);
  }
  await page.getByLabel('Estación').selectOption({ label: datos.estacion });
  await page.getByRole('radio', { name: /^Sin control/ }).check();
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('heading', { name: datos.nombre, exact: true })).toBeVisible();
  await expect(page.getByText('Producto creado')).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------

test('el Administrador arma la carta: estación, familia, productos con foto y precios por sucursal, combo y menú del día', async ({
  browser,
}) => {
  const { contexto, page, escrituras } = await entrarEnCelular(
    browser,
    e.administrador,
    e.s1.nombre,
  );
  abiertos.push(contexto);

  await test.step('estación y familia', async () => {
    await destino(page, 'Carta').click();
    await expect(page.getByRole('heading', { name: 'Carta', level: 1 })).toBeVisible();
    await expect(seccionDeCarta(page, 'Estaciones')).toBeVisible();
    await agregarEnLaLista(page, 'Estaciones', ESTACION);
    await agregarEnLaLista(page, 'Familias', FAMILIA);
    await page.screenshot({ path: 'e2e/resultados/carta-1-familias.png' });
  });

  await test.step('producto con foto', async () => {
    await seccionDeCarta(page, 'Productos').click();
    await crearProducto(page, { nombre: LOMO, precio: '28.00', estacion: ESTACION });

    await page.getByLabel(`Elegir foto de ${LOMO}`).setInputFiles({
      name: 'lomo.png',
      mimeType: 'image/png',
      buffer: fotoDePrueba(),
    });
    // La foto se reduce en el navegador, se sube y la API la sirve desde su almacén.
    await esperarImagenCargada(page.getByRole('img', { name: `Foto de ${LOMO}` }));
    await expect(page.getByRole('button', { name: 'Quitar foto' })).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/carta-2-producto-con-foto.png' });
  });

  await test.step('otro precio en S1 y no disponible en S2', async () => {
    const s1 = filaDeSucursal(page, e.s1.nombre);
    const s2 = filaDeSucursal(page, e.s2.nombre);
    await expect(s1).toContainText('Es el precio de la empresa.');
    await page.getByLabel(`Precio propio en ${e.s1.nombre}`).fill('26.00');
    await page.getByRole('button', { name: `Guardar ${e.s1.nombre}` }).click();
    await expect(s1.getByRole('status')).toContainText('Guardado');
    await expect(s1).toContainText('Precio propio. La empresa cobra S/ 28.00.');
    await expect(s1.locator('.sucursal__monto')).toHaveText('S/ 26.00');

    await page.getByRole('switch', { name: `Disponible en ${e.s2.nombre}` }).click();
    await page.getByRole('button', { name: `Guardar ${e.s2.nombre}` }).click();
    await expect(s2.getByRole('status')).toContainText('Guardado');
    await page.screenshot({
      path: 'e2e/resultados/carta-3-precio-por-sucursal.png',
      fullPage: true,
    });
  });

  await test.step('otro plato simple', async () => {
    await destino(page, 'Carta').click();
    await crearProducto(page, { nombre: ARROZ, precio: '18.00', estacion: ESTACION });
  });

  await test.step('un producto que nace sin venderse solo (sin precio)', async () => {
    await destino(page, 'Carta').click();
    await crearProducto(page, { nombre: AJI, estacion: ESTACION });
    await expect(
      page.getByText('Este producto no se vende solo, así que no lleva precio.'),
    ).toBeVisible();
    const s1 = filaDeSucursal(page, e.s1.nombre);
    await expect(s1.getByRole('switch', { name: `Disponible en ${e.s1.nombre}` })).toBeVisible();
    await expect(s1.getByRole('textbox')).toHaveCount(0);
    await expect(s1.locator('.sucursal__monto')).toHaveCount(0);
  });

  await test.step('un producto que deja de venderse solo después', async () => {
    await destino(page, 'Carta').click();
    await crearProducto(page, { nombre: SALSA, precio: '4.00', estacion: ESTACION });
    await expect(filaDeSucursal(page, e.s1.nombre).locator('.sucursal__monto')).toHaveText(
      'S/ 4.00',
    );
    await page.getByRole('switch', { name: 'Se vende solo' }).click();
    await expect(page.getByLabel('Precio con IGV')).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();
    await expect(
      page.getByText('Este producto no se vende solo, así que no lleva precio.'),
    ).toBeVisible();
    await expect(filaDeSucursal(page, e.s1.nombre).locator('.sucursal__monto')).toHaveCount(0);
    // Sigue así al volver a pedirlo a la API.
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Se vende solo' })).not.toBeChecked();
  });

  await test.step('un producto desactivado', async () => {
    await destino(page, 'Carta').click();
    await crearProducto(page, { nombre: GASEOSA, precio: '6.00', estacion: ESTACION });
    await page.getByRole('button', { name: 'Desactivar producto' }).click();
    await page
      .getByRole('dialog', { name: `¿Desactivar «${GASEOSA}»?` })
      .getByRole('button', { name: 'Desactivar producto' })
      .click();
    await expect(page.getByRole('button', { name: 'Reactivar producto' })).toBeVisible();
  });

  await test.step('combo con tres componentes', async () => {
    await destino(page, 'Carta').click();
    await page.getByRole('link', { name: 'Nuevo producto' }).last().click();
    await page
      .getByRole('group', { name: 'Tipo de producto' })
      .getByRole('button', { name: 'Combo' })
      .click();
    await page.getByLabel('Nombre', { exact: true }).fill(COMBO);
    await page.getByLabel('Familia').selectOption({ label: FAMILIA });
    await page.getByLabel('Precio base con IGV').fill('40.00');
    await page.getByRole('radio', { name: /^Sin control/ }).check();

    for (const nombre of [LOMO, ARROZ, AJI]) {
      await page.getByRole('button', { name: 'Agregar un componente' }).click();
      await page.getByRole('button', { name: `Agregar ${nombre}`, exact: true }).click();
    }
    await page.getByRole('button', { name: `Agregar una unidad de ${ARROZ}` }).click();
    await expect(page.getByRole('group', { name: `Cantidad de ${ARROZ}` })).toContainText('2');
    await page.screenshot({ path: 'e2e/resultados/carta-4-combo.png', fullPage: true });

    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByRole('heading', { name: COMBO, exact: true })).toBeVisible();
    await expect(page.getByText('Producto creado')).toBeVisible();
  });

  await test.step('menú del día con un tiempo creado desde el propio producto', async () => {
    await destino(page, 'Carta').click();
    await page.getByRole('link', { name: 'Nuevo producto' }).last().click();
    await page
      .getByRole('group', { name: 'Tipo de producto' })
      .getByRole('button', { name: 'Menú del día' })
      .click();
    await page.getByLabel('Nombre', { exact: true }).fill(MENU);
    await page.getByLabel('Familia').selectOption({ label: FAMILIA });
    await page.getByLabel('Precio base con IGV').fill('15.00');
    await page.getByRole('radio', { name: /^Sin control/ }).check();

    await page.getByRole('button', { name: 'Crear un grupo nuevo' }).click();
    const panel = page.getByRole('group', { name: 'Nuevo grupo' });
    await panel.getByLabel('Nombre del grupo').fill(TIEMPO);
    await panel.getByLabel('Nombre de la opción 1').fill(LOMO);
    await panel.getByLabel('Producto ligado de la opción 1').selectOption({ label: LOMO });
    await panel.getByRole('button', { name: 'Agregar opción' }).click();
    await panel.getByLabel('Nombre de la opción 2').fill(ARROZ);
    await panel.getByLabel('Producto ligado de la opción 2').selectOption({ label: ARROZ });
    await panel.getByRole('button', { name: 'Crear grupo' }).click();
    await expect(
      page.getByText(`Grupo «${TIEMPO}» creado y agregado a este producto`),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByRole('heading', { name: MENU, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Armar el menú del día' })).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/carta-5-menu-del-dia.png', fullPage: true });
  });

  await test.step('la lista de productos, con la miniatura de la foto', async () => {
    await destino(page, 'Carta').click();
    for (const nombre of [LOMO, ARROZ, AJI, SALSA, COMBO, MENU]) {
      await expect(familia(page).getByText(nombre, { exact: true }).first()).toBeVisible();
    }
    // El desactivado no está hasta que se piden los inactivos.
    await expect(familia(page).getByText(GASEOSA, { exact: true })).toHaveCount(0);
    await esperarImagenCargada(familia(page).locator('img').first());
    await expect(page.getByText(/^7 productos · 1 inactivo$/)).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/carta-6-productos.png', fullPage: true });
  });

  await test.step('ordena los productos con un desactivado entre ellos', async () => {
    await page.getByRole('button', { name: 'Ordenar' }).click();
    await page.getByRole('button', { name: `Subir ${GASEOSA}` }).click();
    await page.getByRole('button', { name: `Subir ${GASEOSA}` }).click();
    await page.getByRole('button', { name: 'Guardar orden' }).click();
    await expect(page.getByRole('button', { name: 'Guardar orden' })).toHaveCount(0);
    await expect(page.getByText('No pudimos guardar el orden')).toHaveCount(0);

    // Con los inactivos a la vista, el orden pedido es el que quedó guardado (también tras recargar).
    await page.reload();
    await page.getByRole('button', { name: 'Ver inactivos' }).click();
    await expect(familia(page).locator('.ui-fila__titulo')).toHaveText([
      LOMO,
      ARROZ,
      GASEOSA,
      AJI,
      SALSA,
      COMBO,
      MENU,
    ]);
    await page.screenshot({ path: 'e2e/resultados/carta-6b-orden.png', fullPage: true });
  });

  afirmarClavesDeIdempotencia(escrituras, ['POST', 'PUT', 'PATCH']);
});

test('Cocina/Barra de S1 arma el menú de hoy y marca un plato agotado solo por hoy: el combo que lo lleva no se puede vender', async ({
  browser,
}) => {
  const { contexto, page, escrituras } = await entrarEnCelular(browser, e.cocina);
  abiertos.push(contexto);
  // Cada respuesta de la vista de la sucursal, con la condición que mandó la PWA (`If-None-Match`).
  const vistas: { estado: number; condicional: string | undefined }[] = [];
  page.on('response', (respuesta) => {
    if (new URL(respuesta.url()).pathname !== '/carta/sucursal') return;
    vistas.push({
      estado: respuesta.status(),
      condicional: respuesta.request().headers()['if-none-match'],
    });
  });

  await expect(destino(page, 'Carta')).toHaveCount(0);
  await destino(page, 'Disponibilidad').click();
  await expect(page.getByRole('heading', { name: 'Disponibilidad', level: 1 })).toBeVisible();

  await test.step('arma el menú de hoy', async () => {
    await seccionDeDisponibilidad(page, 'Menú del día').click();
    await expect(page.getByText('El menú de hoy no está armado: no se puede vender')).toBeVisible();
    await expect(page.getByRole('heading', { name: MENU })).toBeVisible();
    await expect(page.getByText('Sin armar')).toBeVisible();

    const tiempo = page.getByRole('group', { name: TIEMPO });
    await tiempo.getByRole('checkbox', { name: new RegExp(`^${LOMO}`) }).check();
    await tiempo.getByRole('checkbox', { name: new RegExp(`^${ARROZ}`) }).check();
    await expect(page.getByText('Sin guardar')).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/carta-7-menu-marcado.png', fullPage: true });
    await page.getByRole('button', { name: 'Guardar el menú de hoy' }).click();
    await expect(page.getByText('El menú de hoy quedó guardado.')).toBeVisible();
    await expect(page.getByText('Armado', { exact: true })).toBeVisible();
    await expect(page.getByText('El menú de hoy no está armado: no se puede vender')).toHaveCount(
      0,
    );
  });

  await test.step('la lista de agotados se vuelve a pedir con ETag y la API responde 304', async () => {
    await seccionDeDisponibilidad(page, 'Agotados').click();
    // Entran los productos activos y disponibles en S1, también el que no se vende solo; no el desactivado.
    await expect(page.getByText(/^6 productos · 0 agotados$/)).toBeVisible();
    await expect(page.getByText(GASEOSA)).toHaveCount(0);
    const primera = vistas.find((v) => v.estado === 200);
    expect(primera, 'la primera lectura de la vista baja completa').toBeTruthy();
    expect(primera?.condicional).toBeUndefined();

    // Al volver a la pestaña la PWA pide la vista otra vez; nada cambió, así que la API contesta 304. La
    // lectura que ya está en curso (la de la propia pantalla) absorbe el aviso: se repite hasta que sale una nueva.
    // La secuencia se anota como "200,200c,304c": el estado y una "c" cuando la consulta llevó `If-None-Match`.
    await expect
      .poll(
        async () => {
          await page.evaluate(() =>
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
          );
          return vistas.map((v) => `${v.estado}${v.condicional ? 'c' : ''}`).join(',');
        },
        {
          intervals: [1000],
          message:
            'una consulta con If-None-Match que la API contesta 304 (CORS deja pasar ETag e If-None-Match)',
        },
      )
      .toMatch(/304c/);
    await expect(page.getByText(/^6 productos · 0 agotados$/)).toBeVisible();
  });

  await test.step('marca el lomo agotado solo por hoy', async () => {
    await page.getByRole('switch', { name: `Agotado: ${LOMO}` }).click();

    const hoja = page.getByRole('dialog', { name: `Marcar «${LOMO}» como agotado` });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('Solo por hoy')).toBeVisible();
    await expect(hoja.getByText('Hasta que lo reactive')).toBeVisible();
    // La hora de corte sale de la sucursal (`GET /sucursales/:id`): la de una sucursal nueva es las 05:00.
    await expect(hoja).toContainText('Vuelve solo a las 05:00, cuando empieza el siguiente día.');
    // La hoja avisa qué más se afecta: el combo que lo lleva y el menú donde es opción.
    await expect(hoja).toContainText(COMBO);
    await page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: 'e2e/resultados/carta-8-hoja-de-agotado.png' });
    await hoja.getByRole('button', { name: 'Marcar como agotado' }).click();
    await expect(hoja).toBeHidden();

    // Se ve marcado al instante, y sigue marcado cuando la vista se vuelve a pedir a la API.
    await expect(filaDeAgotados(page, LOMO).getByText('Agotado hoy')).toBeVisible();
    await expect(page.getByRole('switch', { name: `Agotado: ${LOMO}` })).toBeChecked();
    await expect(page.getByText(`${LOMO} está agotado`)).toBeVisible();
  });

  await test.step('el combo que lo contiene aparece no vendible', async () => {
    const combo = filaDeAgotados(page, COMBO);
    await expect(combo.getByText('No se puede vender')).toBeVisible();
    await expect(combo).toContainText(`${LOMO} no está disponible.`);
    await expect(page.getByText(/^6 productos · 1 agotado$/)).toBeVisible();
    await page.screenshot({ path: 'e2e/resultados/carta-9-agotados.png', fullPage: true });
  });

  await test.step('recarga la pantalla: lo marcado viene de la API', async () => {
    await page.reload();
    await expect(page.getByText(/^6 productos · 1 agotado$/)).toBeVisible();
    await expect(filaDeAgotados(page, LOMO).getByText('Agotado hoy')).toBeVisible();
    await expect(filaDeAgotados(page, COMBO).getByText('No se puede vender')).toBeVisible();
    await expect(filaDeAgotados(page, ARROZ).getByText('No se puede vender')).toHaveCount(0);

    // "Solo agotados" deja solo el lomo.
    await page
      .getByRole('group', { name: 'Qué mostrar' })
      .getByRole('button', { name: 'Solo agotados' })
      .click();
    await expect(page.getByText(/^1 de 6 productos · 1 agotado$/)).toBeVisible();
    await expect(filaDeAgotados(page, COMBO)).toHaveCount(0);

    // El menú del día dice que el lomo ya no está disponible y por qué.
    await seccionDeDisponibilidad(page, 'Menú del día').click();
    const tiempo = page.getByRole('group', { name: TIEMPO });
    await expect(tiempo.getByRole('checkbox', { name: new RegExp(`^${LOMO}`) })).toBeChecked();
    await expect(tiempo.getByText('Agotado hoy')).toBeVisible();
  });

  afirmarClavesDeIdempotencia(escrituras, ['PUT']);
});

test('un Cajero de S1 entra a Carta sin ver Estaciones, cambia un precio y ve la fila de S2 solo para leer', async ({
  browser,
}) => {
  const { contexto, page, escrituras } = await entrarEnCelular(browser, e.cajero);
  abiertos.push(contexto);

  await expect(destino(page, 'Disponibilidad')).toHaveCount(0);
  await destino(page, 'Carta').click();
  await expect(page.getByRole('heading', { name: 'Carta', level: 1 })).toBeVisible();
  await expect(seccionDeCarta(page, 'Productos')).toBeVisible();
  await expect(seccionDeCarta(page, 'Familias')).toBeVisible();
  await expect(seccionDeCarta(page, 'Modificadores')).toBeVisible();
  await expect(seccionDeCarta(page, 'Estaciones')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/resultados/carta-10-cajero.png' });

  // Aunque escriba la dirección de Estaciones, vuelve a Productos.
  await page.goto('/carta?ver=estaciones');
  await expect(page.getByRole('heading', { name: 'Carta', level: 1 })).toBeVisible();
  await expect(familia(page)).toBeVisible();

  await test.step('cambia el precio de un producto y le pone precio propio en S1', async () => {
    await familia(page).getByRole('link', { name: ARROZ }).first().click();
    await expect(page.getByRole('heading', { name: ARROZ, exact: true })).toBeVisible();
    await page.getByLabel('Precio con IGV').fill('19.50');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();

    const s1 = filaDeSucursal(page, e.s1.nombre);
    // La fila de S1 sigue el precio nuevo de la empresa hasta que tenga uno propio.
    await expect(s1.locator('.sucursal__monto')).toHaveText('S/ 19.50');
    await page.getByLabel(`Precio propio en ${e.s1.nombre}`).fill('17.50');
    await page.getByRole('button', { name: `Guardar ${e.s1.nombre}` }).click();
    await expect(s1.getByRole('status')).toContainText('Guardado');
    await expect(s1.locator('.sucursal__monto')).toHaveText('S/ 17.50');
    await expect(s1).toContainText('Precio propio. La empresa cobra S/ 19.50.');
  });

  await test.step('la fila de S2 es solo para leer', async () => {
    const s2 = filaDeSucursal(page, e.s2.nombre);
    await expect(s2).toBeVisible();
    await expect(s2).toContainText('Solo la cambia el Administrador o un Cajero de esta sucursal.');
    await expect(s2.getByRole('switch')).toHaveCount(0);
    await expect(s2.getByRole('textbox')).toHaveCount(0);
    await expect(s2.getByRole('button')).toHaveCount(0);
    await expect(s2.locator('.sucursal__monto')).toHaveText('S/ 19.50');
    await page.screenshot({
      path: 'e2e/resultados/carta-11-fila-de-solo-lectura.png',
      fullPage: true,
    });
  });

  await test.step('el lomo, no disponible en S2, se ve así desde S1', async () => {
    await destino(page, 'Carta').click();
    await familia(page).getByRole('link', { name: LOMO }).first().click();
    const s2 = filaDeSucursal(page, e.s2.nombre);
    await expect(s2).toContainText('No disponible');
    await expect(s2.getByRole('switch')).toHaveCount(0);
    await expect(filaDeSucursal(page, e.s1.nombre).locator('.sucursal__monto')).toHaveText(
      'S/ 26.00',
    );
  });

  afirmarClavesDeIdempotencia(escrituras, ['PATCH', 'PUT']);
});

test('el Administrador cambia el combo a simple y confirma la hoja que lista lo que se quita', async ({
  browser,
}) => {
  const { contexto, page, escrituras } = await entrarEnCelular(
    browser,
    e.administrador,
    e.s1.nombre,
  );
  abiertos.push(contexto);

  await destino(page, 'Carta').click();

  await test.step('el lomo tiene precio propio en S1: no puede dejar de venderse solo', async () => {
    await familia(page).getByRole('link', { name: LOMO }).first().click();
    await page.getByRole('switch', { name: 'Se vende solo' }).click();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    const aviso = page.getByText('No pudimos guardar').locator('..');
    await expect(aviso).toContainText('Quita primero esos precios en «Precio por sucursal»');
    await expect(aviso).toContainText(e.s1.nombre);
    await destino(page, 'Carta').click();
  });

  await familia(page).getByRole('link', { name: COMBO }).first().click();
  await expect(page.getByRole('heading', { name: COMBO, exact: true })).toBeVisible();

  await page
    .getByRole('group', { name: 'Tipo de producto' })
    .getByRole('button', { name: 'Simple' })
    .click();
  await expect(page.getByText('Al guardar, pasará a ser simple')).toBeVisible();
  await expect(page.getByText('Se quitarán sus 3 componentes.')).toBeVisible();
  await page.getByLabel('Estación').selectOption({ label: ESTACION });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  const hoja = page.getByRole('dialog', { name: '¿Cambiar a simple?' });
  await expect(hoja).toBeVisible();
  await expect(hoja).toContainText(
    'Para cambiar el tipo hay que quitar esto. No se puede deshacer',
  );
  await expect(hoja).toContainText(
    `Se quitarán los componentes: ${LOMO} × 1, ${ARROZ} × 2, ${AJI} × 1.`,
  );
  await page.waitForTimeout(400); // la hoja termina de subir
  await page.screenshot({ path: 'e2e/resultados/carta-12-cambio-de-tipo.png' });
  await hoja.getByRole('button', { name: 'Cambiar a simple' }).click();

  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await expect(page.getByText('Ahora es simple.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Componentes' })).toHaveCount(0);

  // Ya no es un combo: sigue siendo simple al volver a pedirlo a la API, con su estación.
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Tipo de producto' }).getByRole('button', { name: 'Simple' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Componentes' })).toHaveCount(0);
  await expect(page.getByLabel('Estación')).toHaveValue(/.+/);

  afirmarClavesDeIdempotencia(escrituras, ['PATCH']);
});

test('un Mozo no ve Carta ni Disponibilidad, y la API le niega ambas', async ({
  browser,
  request,
}) => {
  const { contexto, page } = await entrarEnCelular(browser, e.mozo);
  abiertos.push(contexto);

  await expect(destino(page, 'Carta')).toHaveCount(0);
  await expect(destino(page, 'Disponibilidad')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Carta|Disponibilidad/ })).toHaveCount(0);
  await page.screenshot({ path: 'e2e/resultados/carta-13-mozo.png' });

  for (const ruta of [
    '/carta',
    '/carta?ver=productos',
    '/disponibilidad',
    '/carta/productos/nuevo',
  ]) {
    await page.goto(ruta);
    await expect(page.getByRole('heading', { name: `Hola, ${e.mozo.primerNombre}` })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  }

  // La guarda de la pantalla solo ordena: quien decide es la API.
  const token = await tokenDeSesion(page);
  expect(token).not.toBe('');
  const productos = await llamarApi(request, '/carta/productos', { token });
  expect(productos.estado).toBe(403);
  const menu = await llamarApi(request, '/carta/sucursal/menu-del-dia', { token });
  expect(menu.estado).toBe(403);
});

test('en una tableta, la lista de productos y la de agotados pasan a tabla', async ({
  browser,
}) => {
  const cocina = await entrarEnCelular(browser, e.cocina, undefined, TABLETA);
  abiertos.push(cocina.contexto);
  await destino(cocina.page, 'Disponibilidad').click();
  const tabla = cocina.page.getByRole('table', { name: `Productos de ${FAMILIA}` });
  await expect(tabla).toBeVisible();
  const filaLomo = tabla.getByRole('row').filter({ hasText: LOMO });
  await expect(filaLomo).toContainText('Agotado hoy');
  await expect(filaLomo.getByRole('switch', { name: `Agotado: ${LOMO}` })).toBeChecked();
  await cocina.page.screenshot({
    path: 'e2e/resultados/carta-14-tableta-agotados.png',
    fullPage: true,
  });

  const cajero = await entrarEnCelular(browser, e.cajero, undefined, TABLETA);
  abiertos.push(cajero.contexto);
  await destino(cajero.page, 'Carta').click();
  const productos = cajero.page.getByRole('table', { name: `Productos de ${FAMILIA}` });
  await expect(productos).toBeVisible();
  // El Cajero cambió el arroz a S/ 19.50 con IGV (el precio propio de S1 se ve en la ficha del producto).
  await expect(productos.getByRole('row').filter({ hasText: ARROZ })).toContainText('S/ 19.50');
  await expect(productos.getByRole('row').filter({ hasText: AJI })).toContainText(
    'No se vende solo',
  );
  await cajero.page.screenshot({
    path: 'e2e/resultados/carta-15-tableta-carta.png',
    fullPage: true,
  });
});
