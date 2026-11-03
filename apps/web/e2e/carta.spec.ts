import { expect, test, type Page } from '@playwright/test';

// La carta web de punta a punta (T22; criterios 79 a 83): HTML del servidor, cabeceras, redirecciones, 404 y la
// disponibilidad en vivo, contra la API falsa de `e2e/api-falsa.mjs` (o una API real con `E2E_API_URL`).
const API = process.env.E2E_API_URL ?? 'http://localhost:3100';
const CON_CONTROL = !process.env.E2E_API_URL;
const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';
const ARROZ_CON_POLLO = '00000000-0000-4000-8000-000000000005';

const CARTA = '/sabor-norteno/miraflores';

async function control(request: import('@playwright/test').APIRequestContext, ruta: string) {
  const respuesta = await request.post(`${API}/__control/${ruta}`);
  expect(respuesta.ok()).toBe(true);
}

async function sinDesbordeHorizontal(page: Page) {
  const desborda = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(desborda).toBe(false);
}

test.describe('la carta', () => {
  test('se arma en el servidor con la marca, el horario, las familias y los productos', async ({
    page,
  }) => {
    const respuesta = await page.goto(CARTA);
    expect(respuesta?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-PE');
    await expect(page.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeVisible();
    await expect(page.getByText('Miraflores', { exact: true })).toBeVisible();
    await expect(page.getByText('Av. Larco 345, Miraflores')).toBeVisible();
    await expect(page.getByText(/^Abierto ahora · hasta las 23:59$/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Entradas',
      'Ceviches',
      'Platos de fondo',
      'Bebidas',
      'Postres',
      'Menú del día',
    ]);
    await expect(page.getByText('S/ 38.50', { exact: true })).toBeVisible();
    await expect(page.getByText('38 soles con 50 céntimos')).toBeAttached();
    await expect(
      page.getByText(/2 × Lomo saltado, 2 × Arroz con pollo, Jarra de chicha/),
    ).toBeVisible();
    await expect(page.getByText('Ceviche chico (+ S/ 6.00)')).toBeVisible();
    // Las fotos pasan por la optimización de Next y llevan el nombre del plato como texto alternativo.
    const foto = page.getByRole('img', { name: 'Causa limeña' });
    await expect(foto).toHaveAttribute('src', /^\/_next\/image\?url=/);
    await sinDesbordeHorizontal(page);
  });

  test('el color de la marca llega por variables: el del restaurante, sin tocar', async ({
    page,
  }) => {
    await page.goto(CARTA);
    const marca = await page.locator('.carta').evaluate((el) => ({
      marca: el.style.getPropertyValue('--marca'),
      sobre: el.style.getPropertyValue('--sobre-marca'),
    }));
    expect(marca).toEqual({ marca: '#CB4D29', sobre: '#FFFFFF' });
    if (CON_CONTROL) {
      await page.goto('/aji-amarillo/centro');
      const claro = await page.locator('.carta').evaluate((el) => ({
        marca: el.style.getPropertyValue('--marca'),
        sobre: el.style.getPropertyValue('--sobre-marca'),
      }));
      expect(claro).toEqual({ marca: '#F2A900', sobre: '#111111' });
      const fondo = await page
        .locator('.cabecera')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(fondo).toBe('rgb(242, 169, 0)');
    }
  });

  test('las familias son una fila fija arriba que se desliza de lado, con enlaces de 48 px', async ({
    page,
  }) => {
    await page.goto(CARTA);
    const fila = page.locator('.familias ul');
    // Hay más familias de las que caben: la fila se desliza de lado y la página no.
    expect(await fila.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await sinDesbordeHorizontal(page);
    for (const enlace of await page.locator('.familias a').all()) {
      expect((await enlace.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const caja = await page.locator('.familias').boundingBox();
    expect(caja?.y).toBe(0);
    // Al bajar, la familia que está en pantalla queda marcada.
    await expect(page.locator('.familias a[aria-current="true"]')).toHaveText('Menú del día');
  });

  test('tocar una familia lleva a su sección y la deja marcada', async ({ page }) => {
    await page.goto(CARTA);
    await page.getByRole('link', { name: 'Platos de fondo', exact: true }).click();
    await expect(page).toHaveURL(/#f-/);
    await expect(page.getByRole('heading', { level: 2, name: 'Platos de fondo' })).toBeInViewport();
    await expect(page.locator('.familias a[aria-current="true"]')).toHaveText('Platos de fondo');
  });

  test.describe('sin JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('se lee completa y las familias son enlaces que funcionan', async ({ page }) => {
      await page.goto(CARTA);
      await expect(page.getByText('Lomo saltado', { exact: true })).toBeVisible();
      await expect(page.getByText('Combo familiar')).toBeAttached();
      const enlace = page.getByRole('link', { name: 'Bebidas', exact: true });
      await expect(enlace).toHaveAttribute('href', /^#f-/);
      await enlace.click();
      await expect(page.getByRole('heading', { level: 2, name: 'Bebidas' })).toBeInViewport();
    });
  });

  test('sin horario cargado la cabecera no dice nada del horario', async ({ page }) => {
    test.skip(!CON_CONTROL, 'Usa datos de la API falsa');
    await page.goto('/sabor-norteno/barranco');
    await expect(page.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeVisible();
    await expect(page.getByText(/Abierto ahora|Cerrado ahora/)).toHaveCount(0);
  });

  for (const ancho of [320, 360, 768]) {
    test(`sin desplazamiento horizontal a ${ancho} px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 740 });
      await page.goto(CARTA);
      await sinDesbordeHorizontal(page);
      await page.goto(`/m/${CODIGO_MESA}`);
      await sinDesbordeHorizontal(page);
    });
  }
});

test.describe('cabeceras y vista previa (criterio 80 y 83)', () => {
  test('la carta se guarda 30 s en el CDN y no lleva nada de la mesa', async ({ request }) => {
    const respuesta = await request.get(CARTA);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['cache-control']).toBe(
      'public, s-maxage=30, stale-while-revalidate=60',
    );
    expect(respuesta.headers()['x-robots-tag']).toBeUndefined();
    expect(respuesta.headers()['referrer-policy']).toBeUndefined();
  });

  test('el modo mesa nunca se guarda, no se indexa y no deja el código en el Referer', async ({
    request,
  }) => {
    test.skip(!CON_CONTROL, 'Usa el código de mesa de la API falsa');
    const respuesta = await request.get(`/m/${CODIGO_MESA}`);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['cache-control']).toBe('private, no-store');
    expect(respuesta.headers()['x-robots-tag']).toBe('noindex');
    expect(respuesta.headers()['referrer-policy']).toBe('no-referrer');
  });

  test('la carta lleva su vista previa: título, descripción, url e imagen de 1200 × 630', async ({
    page,
    request,
  }) => {
    await page.goto(CARTA);
    const meta = (propiedad: string) =>
      page
        .locator(`meta[property="${propiedad}"], meta[name="${propiedad}"]`)
        .getAttribute('content');
    expect(await meta('og:title')).toBe('Sabor Norteño · Miraflores');
    expect(await meta('og:description')).toContain('Av. Larco 345, Miraflores');
    expect(await meta('og:url')).toMatch(/\/sabor-norteno\/miraflores$/);
    expect(await meta('twitter:card')).toBe('summary_large_image');
    expect(await meta('og:image:width')).toBe('1200');
    expect(await meta('og:image:height')).toBe('630');
    const imagen = await meta('og:image');
    expect(imagen).toMatch(/opengraph-image/);
    const respuesta = await request.get(imagen ?? '');
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['content-type']).toBe('image/png');
    const bytes = await respuesta.body();
    // IHDR de un PNG: ancho y alto en los bytes 16 a 23.
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });

  test('el modo mesa lleva una vista previa genérica, sin el código y sin indexarse', async ({
    page,
  }) => {
    test.skip(!CON_CONTROL, 'Usa el código de mesa de la API falsa');
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page).toHaveTitle('Tu mesa');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const html = await page.content();
    expect(html).not.toContain('property="og:url"');
    expect(html).not.toContain('property="og:image"');
    // Ni el código aparece en la dirección canónica ni en ninguna etiqueta de la cabecera.
    expect(await page.locator('head').innerHTML()).not.toContain(CODIGO_MESA);
  });

  test('robots.txt excluye el modo mesa', async ({ request }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /m/');
  });
});

test.describe('direcciones (criterio 79)', () => {
  test('una dirección con mayúsculas redirige con 308 a minúsculas y conserva la consulta', async ({
    request,
  }) => {
    const respuesta = await request.get('/Sabor-Norteno/MIRAFLORES?origen=qr', { maxRedirects: 0 });
    expect(respuesta.status()).toBe(308);
    expect(new URL(respuesta.headers()['location'] ?? '', 'http://x').pathname).toBe(CARTA);
    expect(respuesta.headers()['location']).toContain('origen=qr');
  });

  test('la de la empresa sola también', async ({ request }) => {
    const respuesta = await request.get('/Sabor-Norteno', { maxRedirects: 0 });
    expect(respuesta.status()).toBe(308);
    expect(respuesta.headers()['location']).toBe('/sabor-norteno');
  });

  test('el código de una mesa no se pasa a minúsculas', async ({ request }) => {
    const respuesta = await request.get(`/M/${CODIGO_MESA}`, { maxRedirects: 0 });
    expect(respuesta.status()).toBe(308);
    expect(respuesta.headers()['location']).toBe(`/m/${CODIGO_MESA}`);
  });

  test('con mayúsculas se llega a la carta siguiendo la redirección', async ({ page }) => {
    await page.goto('/SABOR-NORTENO/Miraflores');
    await expect(page).toHaveURL(/\/sabor-norteno\/miraflores$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeVisible();
  });

  test('lo que la API responde con 404 muestra «Esta carta no está disponible» con estado 404', async ({
    page,
  }) => {
    for (const ruta of [
      '/sabor-norteno/no-existe',
      '/empresa-que-no-existe',
      '/m/ZzzzzzzzzzzzzzzzzzzzzZ',
    ]) {
      const respuesta = await page.goto(ruta);
      expect(respuesta?.status(), ruta).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Esta carta no está disponible' }),
      ).toBeVisible();
    }
  });

  test('una empresa con varias sucursales las lista', async ({ page }) => {
    test.skip(!CON_CONTROL, 'Usa datos de la API falsa');
    await page.goto('/sabor-norteno');
    await expect(page.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeVisible();
    await page.getByRole('link', { name: /Barranco/ }).click();
    await expect(page).toHaveURL(/\/sabor-norteno\/barranco$/);
  });

  test('una empresa con una sola sucursal redirige con 307 a su carta', async ({
    request,
    page,
  }) => {
    test.skip(!CON_CONTROL, 'Usa datos de la API falsa');
    const respuesta = await request.get('/una-sede', { maxRedirects: 0 });
    expect(respuesta.status()).toBe(307);
    expect(respuesta.headers()['location']).toBe('/una-sede/centro');
    await page.goto('/una-sede');
    await expect(page).toHaveURL(/\/una-sede\/centro$/);
  });
});

test.describe('el modo mesa muestra la carta con el encabezado de la mesa', () => {
  test.skip(!CON_CONTROL, 'Usa el código de mesa de la API falsa');

  test('"Mesa 4", el horario y la carta; sin la dirección', async ({ page }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeVisible();
    await expect(page.getByText('Mesa 4', { exact: true })).toBeVisible();
    await expect(page.getByText('Av. Larco 345, Miraflores')).toHaveCount(0);
    await expect(page.getByText('Lomo saltado', { exact: true })).toBeVisible();
  });

  test('un número solo se dice "Mesa 7"', async ({ page }) => {
    await page.goto('/m/Zz9YyXxWwVvUuTtSsRrQqP');
    await expect(page.getByText('Mesa 7', { exact: true })).toBeVisible();
  });
});

test.describe('disponibilidad en vivo (criterio 82)', () => {
  test.skip(!CON_CONTROL, 'Usa las rutas de control de la API falsa');
  test.beforeEach(async ({ request }) => control(request, 'reiniciar'));

  test('un plato agotado desaparece en menos de 25 s sin recargar', async ({ page, request }) => {
    await page.goto(CARTA);
    const plato = page.getByText('Arroz con pollo', { exact: true }).first();
    await expect(plato).toBeVisible();
    await control(request, `agotar/${ARROZ_CON_POLLO}`);
    await expect(plato).toBeHidden({ timeout: 25_000 });
    // El resto de la carta sigue donde estaba.
    await expect(page.getByText('Lomo saltado', { exact: true })).toBeVisible();
  });

  test('si se agota todo lo de una familia, su sección y su enlace también se ocultan', async ({
    page,
    request,
  }) => {
    await page.goto(CARTA);
    await control(request, 'agotar/00000000-0000-4000-8000-000000000006'); // Chicha morada: la única de Bebidas
    await expect(page.getByRole('heading', { level: 2, name: 'Bebidas' })).toBeHidden({
      timeout: 25_000,
    });
    await expect(page.getByRole('link', { name: 'Bebidas', exact: true })).toBeHidden();
  });

  test('cada consulta lleva If-None-Match y, sin cambios, el servidor responde 304', async ({
    page,
    request,
  }) => {
    await page.clock.install();
    await page.goto(CARTA);
    await expect
      .poll(async () => (await (await request.get(`${API}/__control/estadisticas`)).json()).total)
      .toBe(1);
    await page.clock.runFor(15_000);
    await expect
      .poll(
        async () =>
          (await (await request.get(`${API}/__control/estadisticas`)).json()).respuestas304,
      )
      .toBe(1);
    const estadisticas = await (await request.get(`${API}/__control/estadisticas`)).json();
    expect(estadisticas).toEqual({ total: 2, conIfNoneMatch: 1, respuestas304: 1 });
  });

  test('al volver a la pestaña consulta de una vez', async ({ page, request }) => {
    await page.goto(CARTA);
    await expect
      .poll(async () => (await (await request.get(`${API}/__control/estadisticas`)).json()).total)
      .toBe(1);
    await control(request, `agotar/${ARROZ_CON_POLLO}`);
    // La pestaña pasa a segundo plano y vuelve: debe consultar sin esperar los 15 s.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByText('Arroz con pollo', { exact: true }).first()).toBeHidden({
      timeout: 5_000,
    });
  });
});
