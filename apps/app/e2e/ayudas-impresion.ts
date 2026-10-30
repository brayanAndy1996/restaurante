import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { llamarApi } from './ayudas';
import type { Escritura } from './ayudas-carta';
import { destino, type EscenarioDeSalon } from './ayudas-salon';

/**
 * Preparación y atajos del E2E de la impresión (historia 004, entrega 3b, tarea T47). El Administrador crea las
 * impresoras, elige los destinos y vincula el puente desde la PWA; el mapa de mesas (que es de la entrega 3a y ya
 * tiene su propio E2E) se arma por la API para ir directo a lo que se prueba aquí.
 */

export const ZONA = 'Salón principal';

/** Las dos impresoras de la prueba: la de cocina caliente y la de la caja. */
export const IMPRESORAS = { cocina: 'Cocina caliente', caja: 'Caja principal' } as const;

/** Lo que dice la PWA cuando la sucursal tiene impresoras y ningún puente las alcanza (criterio 122). */
export const SIN_PUENTE = 'No hay un puente de impresión vinculado';
export const PUENTE_DESCONECTADO = 'El puente de impresión está desconectado';
export const noResponde = (impresora: string): string => `La impresora ${impresora} no responde`;

/**
 * Una zona de 3 × 2 celdas con tres mesas libres (la 1 de 4 personas, la 2 de 2 y la 3 de 6), creadas por la API con
 * el Administrador de la empresa de la prueba.
 */
export async function crearSalonPorApi(
  request: APIRequestContext,
  escenario: EscenarioDeSalon,
): Promise<void> {
  const sesion = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: {
      usuario: escenario.administrador.usuario,
      contrasena: escenario.administrador.contrasena,
    },
  });
  expect(sesion.estado, 'ingreso del Administrador').toBe(201);
  const token = sesion.cuerpo.token;
  const sucursal = `/sucursales/${escenario.s1.id}`;

  const zona = await llamarApi<{ id: string }>(request, `${sucursal}/zonas`, {
    metodo: 'POST',
    token,
    idempotente: true,
    cuerpo: { nombre: ZONA, columnas: 3, filas: 2 },
  });
  expect(zona.estado, 'alta de la zona').toBe(201);
  const mesas = [
    { nombre: '1', capacidad: 4 },
    { nombre: '2', capacidad: 2 },
    { nombre: '3', capacidad: 6 },
  ];
  for (const [i, mesa] of mesas.entries()) {
    const creada = await llamarApi(request, `${sucursal}/zonas/${zona.cuerpo.id}/mesas`, {
      metodo: 'POST',
      token,
      idempotente: true,
      cuerpo: { ...mesa, forma: 'CUADRADA', columna: i + 1, fila: 1 },
    });
    expect(creada.estado, `alta de la mesa ${mesa.nombre}`).toBe(201);
  }
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token });
}

// --- Lo que la PWA le manda a la API ---------------------------------------------------------------------

/** Las escrituras de la impresión y del salón que esta prueba espera ver con su clave de idempotencia. */
const ESCRITURA_DE_IMPRESION =
  /^\/(ordenes|impresion)(\/|$)|^\/sucursales\/[^/]+\/(impresoras|estaciones-destino|impresion|vinculaciones-puente|puentes)(\/|$)/;

/** Anota cada escritura (`POST`, `PUT`, `PATCH`, `DELETE`) de la impresión y del salón que hace la PWA, con su clave. */
export function vigilarEscriturasDeImpresion(page: Page): Escritura[] {
  const escrituras: Escritura[] = [];
  page.on('request', (peticion) => {
    const metodo = peticion.method();
    if (metodo === 'GET' || metodo === 'OPTIONS') return;
    const ruta = new URL(peticion.url()).pathname;
    if (!ESCRITURA_DE_IMPRESION.test(ruta)) return;
    escrituras.push({ metodo, ruta, clave: peticion.headers()['idempotency-key'] });
  });
  return escrituras;
}

// --- Atajos de la pantalla ---------------------------------------------------------------------------

/** Ajustes › Impresión, desde cualquier pantalla del Administrador. */
export async function irAImpresion(page: Page): Promise<void> {
  await destino(page, 'Ajustes').click();
  await page
    .getByRole('group', { name: 'Secciones de Ajustes' })
    .getByRole('button', { name: 'Impresión', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Impresoras', level: 3 })).toBeVisible();
}

/** El aviso de impresión de todas las pantallas (un banner con `role="status"`) que dice `titulo`. */
export const bannerDeImpresion = (page: Page, titulo: string | RegExp): Locator =>
  page
    .locator('.ui-banner')
    .filter({ has: page.locator('.ui-banner__titulo', { hasText: titulo }) });

/** Ningún aviso de impresión a la vista (los tres que puede mostrar la PWA). */
export async function afirmarSinAvisoDeImpresion(page: Page): Promise<void> {
  await expect(
    page.locator('.ui-banner__titulo').filter({
      hasText: /puente de impresión|La impresora .* no responde|Las impresoras .* no responden/,
    }),
  ).toHaveCount(0);
}

/** Crea una impresora de red desde el formulario de Ajustes › Impresión. */
export async function crearImpresoraDeRed(
  page: Page,
  datos: { nombre: string; host: string; puerto: number },
): Promise<void> {
  await page.getByRole('button', { name: 'Agregar impresora' }).click();
  await page.getByLabel('Nombre de la impresora').fill(datos.nombre);
  await page.getByLabel('Dirección de la impresora').fill(datos.host);
  await page.getByLabel('Puerto').fill(String(datos.puerto));
  await page
    .getByRole('group', { name: 'Ancho del papel' })
    .getByRole('button', { name: '80 mm' })
    .click();
  await page.getByRole('button', { name: 'Crear impresora' }).click();
  await expect(page.getByText(`Impresora ${datos.nombre} creada.`)).toBeVisible();
}

/** Elige en «Dónde sale cada estación» la impresora (o la pantalla de cocina) de una estación. */
export async function elegirDestinoDeEstacion(
  page: Page,
  estacion: string,
  opcion: string,
): Promise<void> {
  await page.getByRole('combobox', { name: estacion, exact: true }).selectOption({ label: opcion });
}

/** La fila (en celular) o la tabla (en tableta) de una impresora de la lista, para leer su estado. */
export const filaDeImpresora = (page: Page, nombre: string): Locator =>
  page.getByRole('list', { name: 'Impresoras' }).getByRole('listitem').filter({ hasText: nombre });
