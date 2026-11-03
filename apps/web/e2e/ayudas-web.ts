import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Ayudas de las pruebas E2E de la carta web: medir lo que baja la primera vista (criterio 88), revisar la accesibilidad
 * con axe (criterio 90) y comprobar que nada se desplaza de lado (criterio 91).
 */

export const KB = 1024;

export interface Descarga {
  url: string;
  tipo: string;
  /** Bytes que viajaron por la red (cabeceras y cuerpo, ya comprimido). */
  bytes: number;
  /** Bytes del cuerpo comprimido. */
  cuerpo: number;
  codificacion: string | undefined;
}

/** Anota cada petición terminada de la página con los bytes que de verdad pasaron por la red. */
export function vigilarDescargas(page: Page): Descarga[] {
  const descargas: Descarga[] = [];
  page.on('requestfinished', (peticion) => {
    void (async () => {
      const [tamanos, respuesta] = await Promise.all([peticion.sizes(), peticion.response()]);
      descargas.push({
        url: peticion.url(),
        tipo: peticion.resourceType(),
        bytes: tamanos.requestHeadersSize + tamanos.responseHeadersSize + tamanos.responseBodySize,
        cuerpo: tamanos.responseBodySize,
        codificacion: respuesta?.headers()['content-encoding'],
      });
    })();
  });
  return descargas;
}

/** Bytes que viajaron por la red (con cabeceras) de lo que cumpla el filtro. */
export const suma = (
  descargas: readonly Descarga[],
  filtro: (d: Descarga) => boolean = () => true,
) => descargas.filter(filtro).reduce((total, d) => total + d.bytes, 0);

/** Bytes del cuerpo comprimido (gzip) de lo que cumpla el filtro: lo que mide el presupuesto de JavaScript y CSS. */
export const sumaCuerpos = (
  descargas: readonly Descarga[],
  filtro: (d: Descarga) => boolean = () => true,
) => descargas.filter(filtro).reduce((total, d) => total + d.cuerpo, 0);

/** Deja pasar lo que queda de las peticiones en curso (la medida de `sizes()` llega un instante después). */
export async function esperarDescargas(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

export async function sinDesbordeHorizontal(page: Page, donde = 'la página'): Promise<void> {
  const medidas = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  expect(
    medidas.ancho,
    `${donde} no se desplaza de lado (${medidas.ancho} > ${medidas.visible})`,
  ).toBeLessThanOrEqual(medidas.visible);
}

export interface Hallazgo {
  donde: string;
  regla: string;
  impacto: string | null | undefined;
  ayuda: string;
  elementos: string[];
}

/**
 * Revisa la página con axe contra WCAG 2.2 AA (más las buenas prácticas). Falla con cualquier problema **serio o
 * crítico**; los demás se devuelven para anotarlos en el informe.
 */
export async function revisarAccesibilidad(page: Page, donde: string): Promise<Hallazgo[]> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const hallazgos = resultado.violations.map((v) => ({
    donde,
    regla: v.id,
    impacto: v.impact,
    ayuda: v.help,
    elementos: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  const graves = hallazgos.filter((h) => h.impacto === 'serious' || h.impacto === 'critical');
  expect(graves, `axe: fallas graves en ${donde}`).toEqual([]);
  return hallazgos;
}
