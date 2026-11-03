import { expect, test } from '@playwright/test';
import { KB, esperarDescargas, suma, sumaCuerpos, vigilarDescargas } from './ayudas-web';

// Presupuesto de peso (criterio 88): lo que de verdad baja la primera vista a 360 × 740, medido en el navegador con
// los bytes que pasaron por la red (cabeceras y cuerpo comprimido). `scripts/presupuesto.mjs` mide lo mismo en el build;
// aquí se comprueba contra la carta armada y servida de verdad, con fotos, el logo y la disponibilidad.
const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';

test.skip(!!process.env.E2E_API_URL, 'Usa los datos de la API falsa');

const esJs = (d: { tipo: string; url: string }) => d.tipo === 'script';

test.describe('primera vista a 360 × 740', () => {
  for (const { nombre, ruta, limiteJsKb } of [
    { nombre: 'la carta', ruta: '/sabor-norteno/miraflores', limiteJsKb: 140 },
    { nombre: 'el modo mesa', ruta: `/m/${CODIGO_MESA}`, limiteJsKb: 150 },
  ]) {
    test(`${nombre} baja 400 kB o menos en total, sin fuentes web y con lo comprimido`, async ({
      page,
    }) => {
      const descargas = vigilarDescargas(page);
      const respuesta = await page.goto(ruta);
      expect(respuesta?.status()).toBe(200);
      await esperarDescargas(page);

      const total = suma(descargas);
      const js = sumaCuerpos(descargas, esJs);
      const css = sumaCuerpos(descargas, (d) => d.tipo === 'stylesheet');
      const html = sumaCuerpos(descargas, (d) => d.tipo === 'document');
      test.info().annotations.push({
        type: 'peso',
        description: `${nombre}: total ${(total / KB).toFixed(1)} kB · JS ${(js / KB).toFixed(1)} kB · CSS ${(css / KB).toFixed(1)} kB · HTML ${(html / KB).toFixed(1)} kB · ${descargas.length} peticiones`,
      });

      expect(total, 'la primera vista transfiere 400 kB o menos').toBeLessThanOrEqual(400 * KB);
      expect(js, `JavaScript de la primera carga: ${limiteJsKb} kB o menos`).toBeLessThanOrEqual(
        limiteJsKb * KB,
      );
      expect(css, 'CSS: 20 kB o menos').toBeLessThanOrEqual(20 * KB);
      expect(html, 'HTML de una carta chica: lejos de los 60 kB').toBeLessThanOrEqual(60 * KB);
      // La pila del sistema: ni un byte de tipografía.
      expect(descargas.filter((d) => d.tipo === 'font')).toEqual([]);
      // Lo que baja el servidor viene comprimido (salvo lo diminuto, que el servidor no comprime).
      for (const d of descargas.filter(
        (d) => ['document', 'script', 'stylesheet'].includes(d.tipo) && d.cuerpo > KB,
      )) {
        expect(d.codificacion, `${d.url} viene comprimido`).toMatch(/gzip|br|zstd/);
      }
      // Cada foto de la lista, 25 kB o menos; el logo, 15 kB o menos.
      for (const d of descargas.filter((d) => d.tipo === 'image')) {
        const esLogo = d.url.includes(encodeURIComponent('/archivos/logo'));
        expect(d.cuerpo, `${d.url} pesa lo que debe`).toBeLessThanOrEqual((esLogo ? 15 : 25) * KB);
      }
    });
  }

  test('el modo mesa no baja las hojas ni los montos hasta el primer toque, y entonces baja poco', async ({
    page,
  }) => {
    const descargas = vigilarDescargas(page);
    await page.goto(`/m/${CODIGO_MESA}`);
    await esperarDescargas(page);
    const antes = sumaCuerpos(descargas, esJs);
    expect(descargas.filter(esJs).every((d) => !d.url.includes('decimal'))).toBe(true);

    // El primer toque (y un plato) baja el bloque aparte: hojas y reglas de montos de `packages/dominio`.
    await page.getByRole('button', { name: /^Chicha morada, 16 soles/ }).click();
    await expect(page.getByRole('dialog', { name: 'Chicha morada' })).toBeVisible();
    await esperarDescargas(page);
    const despues = sumaCuerpos(descargas, esJs);
    const bloque = despues - antes;
    test.info().annotations.push({
      type: 'peso',
      description: `bloque que baja al primer toque: ${(bloque / KB).toFixed(1)} kB (JS total ${(despues / KB).toFixed(1)} kB)`,
    });
    expect(bloque, 'lo que baja al primer toque').toBeGreaterThan(0);
    expect(bloque).toBeLessThanOrEqual(25 * KB);
  });

  test('la carta pública no baja nada del modo mesa', async ({ page }) => {
    const descargas = vigilarDescargas(page);
    await page.goto('/sabor-norteno/miraflores');
    await esperarDescargas(page);
    await page.mouse.wheel(0, 600);
    await esperarDescargas(page);
    const cuerpos = await Promise.all(
      descargas.filter(esJs).map((d) => page.request.get(d.url).then((r) => r.text())),
    );
    expect(cuerpos.some((texto) => texto.includes('Avisamos al mozo'))).toBe(false);
    expect(cuerpos.some((texto) => texto.includes('DecimalError'))).toBe(false);
  });
});
