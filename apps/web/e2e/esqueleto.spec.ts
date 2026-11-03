import { expect, test } from '@playwright/test';

// Esqueleto de T20: lo que no depende de la API. El recorrido de punta a punta llega con T25.
test.describe('esqueleto de la carta web', () => {
  test('una dirección que no existe responde 404 con «Esta carta no está disponible»', async ({
    page,
  }) => {
    const respuesta = await page.goto('/ruta/que-no-existe/seguro');
    expect(respuesta?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Esta carta no está disponible' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-PE');
  });

  test('un código de mesa con forma imposible responde 404 sin llegar a la API', async ({
    page,
  }) => {
    const respuesta = await page.goto('/m/corto');
    expect(respuesta?.status()).toBe(404);
    expect(respuesta?.headers()['cache-control']).toBe('private, no-store');
    expect(respuesta?.headers()['referrer-policy']).toBe('no-referrer');
    expect(respuesta?.headers()['x-robots-tag']).toBe('noindex');
  });

  test('robots.txt excluye el modo mesa', async ({ request }) => {
    const respuesta = await request.get('/robots.txt');
    expect(respuesta.ok()).toBe(true);
    expect(await respuesta.text()).toContain('Disallow: /m/');
  });
});
