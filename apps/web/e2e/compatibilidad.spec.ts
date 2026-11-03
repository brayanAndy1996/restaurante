import { expect, test, type Page } from '@playwright/test';
import { sinDesbordeHorizontal } from './ayudas-web';

// Compatibilidad (criterio 91): desde 360 px (y 320 px) sin desplazamiento de lado, controles táctiles de 48 px o más,
// texto al 200 % sin cortes, `prefers-reduced-motion` sin animaciones y solo funciones del CSS que Chrome para Android
// y Safari para iPhone recientes ya tienen. Corre en Chromium (el único navegador instalado): Safari se cubre con la
// comprobación de funciones de abajo, no con un motor de WebKit.
const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';
const API = 'http://localhost:3100';

test.skip(!!process.env.E2E_API_URL, 'Usa los datos de la API falsa');

const ANCHOS = [320, 360, 390, 768, 1024];

async function abrirMesa(page: Page, ancho: number, alto = 740) {
  await page.setViewportSize({ width: ancho, height: alto });
  await page.goto(`/m/${CODIGO_MESA}`);
  await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
}

/** Lo que se toca y está a la vista, con su alto y su ancho. */
async function controlesTactiles(page: Page, raiz: string) {
  return page.evaluate((selectorRaiz) => {
    const raizEl = document.querySelector(selectorRaiz) ?? document.body;
    const candidatos = raizEl.querySelectorAll<HTMLElement>(
      'a[href], button, label.opcion, summary, [role="button"]',
    );
    const salida: { nombre: string; ancho: number; alto: number }[] = [];
    for (const el of candidatos) {
      const caja = el.getBoundingClientRect();
      const estilo = getComputedStyle(el);
      // Lo oculto (el enlace "Ir a la carta" fuera de pantalla, lo agotado) no se toca.
      if (caja.width === 0 || caja.height === 0 || estilo.visibility === 'hidden') continue;
      if (caja.bottom < 0 || caja.top > innerHeight * 4 || caja.right < 0) continue;
      if (el.classList.contains('saltar')) continue;
      salida.push({
        nombre: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40),
        ancho: Math.round(caja.width),
        alto: Math.round(caja.height),
      });
    }
    return salida;
  }, raiz);
}

test.describe('sin desplazamiento de lado', () => {
  for (const ancho of ANCHOS) {
    test(`a ${ancho} px la carta, el modo mesa y sus hojas caben`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 740 });
      await page.goto('/sabor-norteno/miraflores');
      await sinDesbordeHorizontal(page, `la carta a ${ancho} px`);

      await abrirMesa(page, ancho);
      await sinDesbordeHorizontal(page, `el modo mesa a ${ancho} px`);

      await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
      const producto = page.getByRole('dialog', { name: 'Lomo saltado' });
      await producto.getByLabel('Término medio').check();
      await producto.getByLabel(/Huevo frito/).check();
      await sinDesbordeHorizontal(page, `la hoja de producto a ${ancho} px`);
      await producto.getByRole('button', { name: /Agregar al pedido/ }).click();

      await page.getByRole('button', { name: /Ver tu pedido/ }).click();
      await expect(page.getByRole('dialog', { name: 'Tu pedido' })).toBeVisible();
      await sinDesbordeHorizontal(page, `"Tu pedido" a ${ancho} px`);
    });
  }

  test('con el texto al 200 % tampoco, y la barra no tapa lo último de la carta', async ({
    page,
  }) => {
    await abrirMesa(page, 360);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await sinDesbordeHorizontal(page, 'el modo mesa con el texto al 200 %');
    // Al llegar al final, lo último de la carta queda por encima de la barra fija.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const ultimo = await page.locator('.producto').last().boundingBox();
    const barra = await page.locator('.barra').boundingBox();
    expect(ultimo && barra && ultimo.y + ultimo.height <= barra.y + 1).toBe(true);
  });
});

test.describe('controles táctiles de 48 px o más', () => {
  const minimo = 48;

  test('la carta del modo mesa y su barra', async ({ page }) => {
    await abrirMesa(page, 360);
    const controles = await controlesTactiles(page, 'body');
    expect(controles.length).toBeGreaterThan(8);
    for (const c of controles) {
      expect(c.alto, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
      expect(c.ancho, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
    }
  });

  test('la hoja de producto, "Tu pedido" y las confirmaciones', async ({ page }) => {
    await abrirMesa(page, 360);
    await page.getByRole('button', { name: /^Lomo saltado, 36 soles/ }).click();
    const producto = page.getByRole('dialog', { name: 'Lomo saltado' });
    await producto.getByLabel('Jugoso').check();
    for (const c of await controlesTactiles(page, 'dialog[open]')) {
      expect(c.alto, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
      expect(c.ancho, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
    }
    await producto.getByRole('button', { name: /Agregar al pedido/ }).click();

    await page.getByRole('button', { name: /Ver tu pedido/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tu pedido' })).toBeVisible();
    for (const c of await controlesTactiles(page, 'dialog[open]')) {
      expect(c.alto, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
      expect(c.ancho, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();

    await page.getByRole('button', { name: /Pedir la cuenta/ }).click();
    await expect(page.getByRole('dialog', { name: '¿Pedimos la cuenta?' })).toBeVisible();
    for (const c of await controlesTactiles(page, 'dialog[open]')) {
      expect(c.alto, `"${c.nombre}" mide ${c.ancho} × ${c.alto}`).toBeGreaterThanOrEqual(minimo);
    }
  });
});

test.describe('movimiento y funciones del navegador', () => {
  test('con prefers-reduced-motion la hoja no se anima ni la página se desplaza suavemente', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrirMesa(page, 360);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('auto');
    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    const hoja = page.getByRole('dialog');
    await expect(hoja).toBeVisible();
    expect(await hoja.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });

  test('sin reducir el movimiento, la hoja sube en 220 ms (el único movimiento)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await abrirMesa(page, 360);
    await page.getByRole('button', { name: /Llamar al mozo/ }).click();
    const hoja = page.getByRole('dialog');
    await expect(hoja).toBeVisible();
    expect(await hoja.evaluate((e) => getComputedStyle(e).animationDuration)).toBe('0.22s');
  });

  test('solo usa funciones del CSS que Chrome para Android y Safari para iPhone recientes ya tienen', async ({
    page,
  }) => {
    await page.goto('/');
    const soporte = await page.evaluate(() => ({
      colorMix: CSS.supports('color', 'color-mix(in oklab, red 8%, white)'),
      has: CSS.supports('selector(:has(input:checked))'),
      dvh: CSS.supports('max-height', '92dvh'),
      zonaSegura: CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)'),
      snap: CSS.supports('scroll-snap-type', 'x proximity'),
      dialogo:
        typeof HTMLDialogElement !== 'undefined' && 'showModal' in HTMLDialogElement.prototype,
      tabular: CSS.supports('font-variant-numeric', 'tabular-nums'),
    }));
    // Chrome 111 y Safari 16.4 (lo que Next 16 declara como mínimo) tienen todo esto: si el navegador de la prueba
    // lo tiene, la hoja de estilos no usa nada que falte allá.
    expect(soporte).toEqual({
      colorMix: true,
      has: true,
      dvh: true,
      zonaSegura: true,
      snap: true,
      dialogo: true,
      tabular: true,
    });
  });

  test('el viewport usa el ancho del dispositivo y no bloquea el zoom', async ({ page }) => {
    await page.goto(`/m/${CODIGO_MESA}`);
    const contenido = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(contenido).toContain('width=device-width');
    expect(contenido).not.toMatch(/user-scalable=no|maximum-scale=1(\.0)?(?!\d)/);
  });

  test('a pleno sol: el texto principal y el de los avisos contrastan 4.5:1 o más', async ({
    page,
    request,
  }) => {
    await request.post(`${API}/__control/reiniciar`);
    await abrirMesa(page, 360);
    const colores = await page.evaluate(() => {
      const luz = (c: string) => {
        const [r, g, b] = c
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number) as [number, number, number];
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const razon = (a: string, b: string) => {
        const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p) as [number, number];
        return (x + 0.05) / (y + 0.05);
      };
      const de = (selector: string) => {
        const el = document.querySelector(selector)!;
        const estilo = getComputedStyle(el);
        return razon(
          estilo.color,
          estilo.backgroundColor === 'rgba(0, 0, 0, 0)'
            ? 'rgb(255,255,255)'
            : estilo.backgroundColor,
        );
      };
      return {
        nombre: de('.producto__nombre'),
        descripcion: de('.producto__desc'),
        cabecera: de('.cabecera'),
        botonSecundario: de('.boton-secundario'),
      };
    });
    for (const [que, razon] of Object.entries(colores)) {
      expect(razon, `contraste de ${que}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
