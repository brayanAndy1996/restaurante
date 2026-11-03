import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// El modo mesa en el navegador de un celular (T24; criterios 82 y 84 a 87), contra la API falsa de
// `e2e/api-falsa.mjs`, que deja provocar cada respuesta (sin red, 422 por línea, estados del llamado). El recorrido
// de punta a punta con el Mozo en la PWA y la API real es `e2e/mesa-punta-a-punta.spec.ts` (T25).
const API = 'http://localhost:3100';
const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';
const LOMO = '00000000-0000-4000-8000-000000000004';

test.skip(!!process.env.E2E_API_URL, 'Usa las rutas de control de la API falsa');

async function control(request: APIRequestContext, ruta: string) {
  const respuesta = await request.post(`${API}/__control/${ruta}`);
  expect(respuesta.ok()).toBe(true);
}

const llamados = async (request: APIRequestContext) =>
  (await (await request.get(`${API}/__control/llamados`)).json()) as Array<{
    id: string;
    tipo: string;
  }>;

const estadisticas = async (request: APIRequestContext) =>
  (await (await request.get(`${API}/__control/mesa`)).json()) as { recibidos: number };

/** Agrega a "Tu pedido" un lomo saltado término medio con huevo frito. */
async function agregarLomo(page: Page) {
  await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
  const hoja = page.getByRole('dialog', { name: 'Lomo saltado' });
  await hoja.getByLabel('Término medio').check();
  await hoja.getByLabel(/Huevo frito/).check();
  await hoja.getByRole('button', { name: /Agregar al pedido/ }).click();
  await expect(hoja).toBeHidden();
}

async function abrirPedido(page: Page) {
  await page.getByRole('button', { name: /Ver tu pedido/ }).click();
  const hoja = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(hoja).toBeVisible();
  return hoja;
}

test.describe('modo mesa', () => {
  test.beforeEach(async ({ request, page }) => {
    await control(request, 'reiniciar');
    await page.goto(`/m/${CODIGO_MESA}`);
    // La barra y las hojas son una isla de cliente: se espera a que esté lista.
    await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
  });

  test('el código no sale en el Referer ni se guarda (cabeceras del modo mesa)', async ({
    request,
  }) => {
    const respuesta = await request.get(`/m/${CODIGO_MESA}`);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['referrer-policy']).toBe('no-referrer');
    expect(respuesta.headers()['cache-control']).toBe('private, no-store');
    expect(respuesta.headers()['x-robots-tag']).toBe('noindex');
  });

  test('arma un pedido, lo envía y ve el estado cambiar con palabras', async ({
    page,
    request,
  }) => {
    await agregarLomo(page);
    await expect(page.getByRole('button', { name: /Ver tu pedido/ })).toContainText('1 plato');
    const hoja = await abrirPedido(page);
    await expect(hoja.getByText('Término medio · Huevo frito')).toBeVisible();
    await hoja.getByLabel(/Nota para el mozo/).fill('Somos 4');
    await hoja.getByRole('button', { name: 'Enviar al mozo' }).click();

    await expect(page.getByText('Avisamos al mozo')).toBeVisible();
    await expect(page.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const [llamado] = await llamados(request);
    expect(llamado?.tipo).toBe('PEDIDO');

    await control(request, 'llamado/ATENDIDO');
    await expect(page.getByText('El mozo viene a tu mesa')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Entendido' }).click();
    await expect(page.getByText('El mozo viene a tu mesa')).toBeHidden();
    await expect(page.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  test('el pedido sobrevive a una recarga', async ({ page }) => {
    await agregarLomo(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /Ver tu pedido/ })).toContainText('1 plato');
    await expect(page.getByText('1 en tu pedido')).toBeVisible();
  });

  test('sin red, reintenta con el mismo id y el mozo recibe un solo pedido', async ({
    page,
    request,
  }) => {
    await agregarLomo(page);
    await control(request, 'caida/2');
    const hoja = await abrirPedido(page);
    await hoja.getByRole('button', { name: 'Enviar al mozo' }).click();
    await expect(hoja.getByText('Sin conexión')).toBeVisible();
    await expect(page.getByText('Avisamos al mozo')).toBeVisible({ timeout: 10_000 });
    expect((await estadisticas(request)).recibidos).toBe(3);
    expect(await llamados(request)).toHaveLength(1);
  });

  test('un 409 CONFLICTO se reintenta con el mismo id y el mozo recibe un solo pedido (criterio 29)', async ({
    page,
    request,
  }) => {
    await agregarLomo(page);
    await control(request, 'conflicto/1');
    const hoja = await abrirPedido(page);
    await hoja.getByRole('button', { name: 'Enviar al mozo' }).click();
    await expect(page.getByText('Avisamos al mozo')).toBeVisible({ timeout: 10_000 });
    // El primer envío recibió el 409; el reintento (1 s después, mismo id) quedó guardado.
    expect((await estadisticas(request)).recibidos).toBe(2);
    expect(await llamados(request)).toHaveLength(1);
  });

  test('un plato que se agota antes de enviar queda marcado "Se agotó" y no deja enviar', async ({
    page,
    request,
  }) => {
    await agregarLomo(page);
    await control(request, `agotar/${LOMO}`);
    const hoja = await abrirPedido(page);
    await hoja.getByRole('button', { name: 'Enviar al mozo' }).click();
    await expect(hoja.getByRole('alert')).toContainText('No pudimos enviar tu pedido');
    await expect(hoja.getByText('Se agotó', { exact: true })).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await hoja.getByRole('button', { name: /Quitar Lomo saltado/ }).click();
    await expect(hoja.getByText('Todavía no agregaste nada')).toBeVisible();
  });

  test('lo que se agota mientras tanto se marca en el pedido sin recargar (criterio 82)', async ({
    page,
    request,
  }) => {
    await agregarLomo(page);
    await control(request, `agotar/${LOMO}`);
    // La disponibilidad se consulta cada 15 s con la página visible.
    const hoja = await abrirPedido(page);
    await expect(hoja.getByText('Se agotó', { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(hoja.getByRole('button', { name: 'Enviar al mozo' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('llamar al mozo pide confirmación y manda un llamado sin pedido', async ({
    page,
    request,
  }) => {
    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    const hoja = page.getByRole('dialog', { name: '¿Llamamos al mozo a tu mesa?' });
    await expect(hoja.getByText(/El mozo recibirá un aviso en la Mesa 4/)).toBeVisible();
    await hoja.getByRole('button', { name: 'Sí, llamar al mozo' }).click();
    await expect(page.getByText('Avisamos al mozo')).toBeVisible();
    expect((await llamados(request)).map((l) => l.tipo)).toEqual(['LLAMAR_MOZO']);
  });

  test('con el local cerrado, el envío dice por qué en palabras', async ({ page, request }) => {
    await control(request, 'cerrado');
    await page.reload();
    await expect(page.getByText('El local está cerrado ahora')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pedir la cuenta/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('no se desplaza de lado ni a 320 px con la barra y una hoja abiertas', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await agregarLomo(page);
    await abrirPedido(page);
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(desborda).toBe(false);
  });
});
