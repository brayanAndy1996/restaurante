import { expect, test, type Page } from '@playwright/test';
import { revisarAccesibilidad, type Hallazgo } from './ayudas-web';

// Accesibilidad (criterio 90): WCAG 2.2 AA con axe en cada pantalla y estado del modo mesa, con tres colores de
// restaurante (naranja, azul y el ají amarillo, que lleva letras casi negras), más lo que axe no ve: la estructura de
// títulos, el enlace "Ir a la carta", el foco visible de 3 px, los nombres de lo que se toca y los precios que se
// leen completos. Corre contra la API falsa; el modo mesa real se revisa también en `punta-a-punta.spec.ts`.
const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';
const CODIGO_MESA_AMARILLA = 'Zz9YyXxWwVvUuTtSsRrQqP';
const API = 'http://localhost:3100';

test.skip(!!process.env.E2E_API_URL, 'Usa los datos de la API falsa');

const otros: Hallazgo[] = [];
let revisadas = 0;
test.afterAll(() => {
  // Lo que axe marca como moderado o leve no frena nada, pero queda a la vista en el informe.
  console.log(`axe · ${revisadas} pantallas revisadas · ${otros.length} hallazgos no graves`);
  for (const h of otros) {
    console.log(
      `axe · ${h.impacto} · ${h.donde} · ${h.regla}: ${h.ayuda} (${h.elementos.join(' | ')})`,
    );
  }
});

async function revisar(page: Page, donde: string) {
  revisadas += 1;
  otros.push(...(await revisarAccesibilidad(page, donde)));
}

async function control(page: Page, ruta: string) {
  const respuesta = await page.request.post(`${API}/__control/${ruta}`);
  expect(respuesta.ok()).toBe(true);
}

test.describe('axe, sin fallas graves', () => {
  test.beforeEach(async ({ page }) => control(page, 'reiniciar'));

  test('la carta pública (naranja) y la de un restaurante de color claro (ají amarillo)', async ({
    page,
  }) => {
    await page.goto('/sabor-norteno/miraflores');
    await revisar(page, 'carta pública · naranja');
    await page.goto('/aji-amarillo/centro');
    await revisar(page, 'carta pública · ají amarillo');
    await page.goto('/sabor-norteno');
    await revisar(page, 'sucursales de la empresa');
    await page.goto('/no-existe/seguro');
    await revisar(page, 'esta carta no está disponible');
  });

  test('el modo mesa: la carta, la hoja de producto, "Tu pedido" y las confirmaciones', async ({
    page,
  }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
    await revisar(page, 'modo mesa · carta');

    await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
    const producto = page.getByRole('dialog', { name: 'Lomo saltado' });
    await expect(producto).toBeVisible();
    await page.waitForTimeout(400); // la hoja termina de subir
    await revisar(page, 'modo mesa · hoja de producto');
    await producto.getByLabel('Término medio').check();
    await producto.getByLabel(/Huevo frito/).check();
    await revisar(page, 'modo mesa · hoja de producto con opciones');
    await producto.getByRole('button', { name: /Agregar al pedido/ }).click();

    await page.getByRole('button', { name: /Ver tu pedido/ }).click();
    const pedido = page.getByRole('dialog', { name: 'Tu pedido' });
    await expect(pedido).toBeVisible();
    await page.waitForTimeout(400);
    await revisar(page, 'modo mesa · Tu pedido');
    await pedido.getByRole('button', { name: 'Cerrar' }).click();

    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    await expect(page.getByRole('dialog', { name: '¿Llamamos al mozo a tu mesa?' })).toBeVisible();
    await page.waitForTimeout(400);
    await revisar(page, 'modo mesa · confirmar llamar al mozo');
  });

  test('los estados del llamado y los errores, con palabras y sin depender del color', async ({
    page,
  }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
    await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
    const producto = page.getByRole('dialog', { name: 'Lomo saltado' });
    await producto.getByLabel('Jugoso').check();
    await producto.getByRole('button', { name: /Agregar al pedido/ }).click();
    await control(page, 'agotar/00000000-0000-4000-8000-000000000004');
    await page.getByRole('button', { name: /Ver tu pedido/ }).click();
    const pedido = page.getByRole('dialog', { name: 'Tu pedido' });
    await pedido.getByRole('button', { name: 'Enviar al mozo' }).click();
    await expect(pedido.getByText('Se agotó', { exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    await revisar(page, 'modo mesa · línea rechazada "Se agotó" y envío apagado');
    await pedido.getByRole('button', { name: /Quitar Lomo saltado/ }).click();
    await pedido.getByRole('button', { name: 'Cerrar' }).click();

    await control(page, 'reiniciar');
    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    await page.getByRole('button', { name: 'Sí, llamar al mozo' }).click();
    await expect(page.getByText('Avisamos al mozo')).toBeVisible();
    await revisar(page, 'modo mesa · estado pendiente');
    for (const [estado, texto] of [
      ['ATENDIDO', 'El mozo viene a tu mesa'],
      ['DESCARTADO', 'No pudimos atender este pedido'],
      ['VENCIDO', 'Nadie respondió a tiempo'],
    ] as const) {
      await control(page, `llamado/${estado}`);
      // Se pregunta cada 10 s con la página visible, o al volver a la pestaña.
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.getByText(texto)).toBeVisible({ timeout: 15_000 });
      await revisar(page, `modo mesa · ${estado}`);
      await page.getByRole('button', { name: 'Entendido' }).click();
      await page.getByRole('button', { name: /Llamar al mozo/ }).click();
      await page.getByRole('button', { name: 'Sí, llamar al mozo' }).click();
      await expect(page.getByText('Avisamos al mozo')).toBeVisible();
    }
  });

  test('el modo mesa de un restaurante de color claro (letras casi negras sobre el amarillo)', async ({
    page,
  }) => {
    await page.goto(`/m/${CODIGO_MESA_AMARILLA}`);
    await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
    await revisar(page, 'modo mesa · ají amarillo');
    await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
    await expect(page.getByRole('dialog', { name: 'Lomo saltado' })).toBeVisible();
    await page.waitForTimeout(400);
    await revisar(page, 'modo mesa · ají amarillo · hoja de producto');
  });
});

test.describe('lo que axe no ve', () => {
  test('la estructura: idioma, un h1, un h2 por familia y el enlace "Ir a la carta" primero', async ({
    page,
  }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-PE');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Entradas',
      'Ceviches',
      'Platos de fondo',
      'Bebidas',
      'Postres',
      'Menú del día',
    ]);
    await page.keyboard.press('Tab');
    const primero = page.getByRole('link', { name: 'Ir a la carta' });
    await expect(primero).toBeFocused();
    await expect(primero).toBeVisible();
  });

  test('cada foto lleva el nombre del producto y cada precio se lee completo', async ({ page }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    await expect(page.getByRole('img', { name: 'Causa limeña' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Lomo saltado' })).toHaveCount(1);
    // El precio a la vista se oculta al lector de pantalla y su lugar lo ocupa "36 soles".
    await expect(page.getByText('36 soles', { exact: true })).toHaveCount(1);
    await expect(page.getByText('38 soles con 50 céntimos', { exact: true })).toHaveCount(1);
    await expect(page.getByText('S/ 36.00').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(
      page.getByRole('button', { name: 'Lomo saltado, 36 soles. Agregar al pedido' }),
    ).toBeVisible();
  });

  test('el foco se ve con 3 px y las hojas son diálogos que atrapan y devuelven el foco', async ({
    page,
  }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    const llamar = page.getByRole('button', { name: /Llamar al mozo/ });
    await llamar.focus();
    await page.keyboard.press('Tab'); // al siguiente...
    await page.keyboard.press('Shift+Tab'); // ...y de vuelta, para que el foco sea de teclado
    await expect(llamar).toBeFocused();
    expect(await llamar.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('3px');
    expect(await llamar.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');

    await page.keyboard.press('Enter');
    const hoja = page.getByRole('dialog', { name: '¿Llamamos al mozo a tu mesa?' });
    await expect(hoja).toBeVisible();
    // El foco inicial va al título, no a un botón.
    await expect(hoja.getByRole('heading', { name: '¿Llamamos al mozo a tu mesa?' })).toBeFocused();
    // El foco queda atrapado: con Tab nunca llega a la página de atrás (que queda inerte); como mucho sale a la
    // barra del navegador, que es lo que hace cualquier diálogo modal nativo, y vuelve al diálogo.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const enLaPaginaDeAtras = await page.evaluate(() => {
        const actual = document.activeElement;
        return actual !== document.body && actual?.closest('dialog') === null;
      });
      expect(enLaPaginaDeAtras, 'el foco no escapa del diálogo').toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect(hoja).toBeHidden();
    await expect(llamar).toBeFocused();
  });

  test('los avisos y errores se anuncian (aria-live) y llevan icono y palabras', async ({
    page,
    request,
  }) => {
    await request.post(`${API}/__control/reiniciar`);
    await page.goto(`/m/${CODIGO_MESA}`);
    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    await page.getByRole('button', { name: 'Sí, llamar al mozo' }).click();
    const barra = page.getByRole('region', { name: 'Tu mesa' });
    await expect(barra.locator('[aria-live="polite"]')).toContainText('Avisamos al mozo');
    await expect(barra.getByRole('status')).toContainText('Puedes seguir viendo la carta.');
    // Con un pendiente, otro envío se rechaza en palabras, con role="alert".
    await request.post(`${API}/__control/reiniciar`);
    await page.goto(`/m/${CODIGO_MESA}`);
    await request.post(`${API}/__control/cerrado`);
    await page.getByRole('button', { name: /Pedir la cuenta/ }).click();
    await page.getByRole('button', { name: 'Sí, pedir la cuenta' }).click();
    const alerta = page.getByRole('dialog').getByRole('alert');
    await expect(alerta).toContainText('El local está cerrado ahora');
    await expect(alerta.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
