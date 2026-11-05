import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { SimuladorPuente, type EmuladorEscPos } from '../../api/test/soporte/puente';
import { llamarApi, tokenDeSesion } from './ayudas';
import type { Escritura } from './ayudas-carta';
import { destino, type EscenarioDeSalon } from './ayudas-salon';

/**
 * Preparación y atajos del E2E de la caja, el cobro y los comprobantes (historia 006, entrega 6a, tarea T23). La
 * empresa, las personas, la carta y el mapa de mesas salen de las ayudas del salón; aquí se agrega la impresora de la
 * caja (un emulador ESC/POS con gaveta), el puente (el simulador) y los atajos de las pantallas de Caja y de Cobro.
 */

/** Dónde se guardan las capturas que se revisan a ojo (las de 360 y 768 px). */
export const CARPETA_DE_CAPTURAS =
  process.env.E2E_CAPTURAS ??
  '/tmp/claude-0/-home-user-restaurante/bc2aaf19-a181-576b-9a27-fbcdf777bd2d/scratchpad/6a-c6';

export const IMPRESORA_DE_CAJA = 'Epson de caja';

/** Entra por la API con usuario y contraseña (solo para preparar datos). */
export async function tokenPorApi(
  request: APIRequestContext,
  persona: { usuario: string; contrasena: string },
): Promise<string> {
  const entrada = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: persona.usuario, contrasena: persona.contrasena },
  });
  expect(entrada.estado, `ingreso de ${persona.usuario}`).toBe(201);
  return entrada.cuerpo.token;
}

/**
 * La impresora de la caja: el Administrador la da de alta apuntando al emulador (con gaveta) y la elige como la de la
 * caja de la sucursal; el puente se vincula con el texto del QR. Es la preparación del equipo del local, no lo que se
 * prueba aquí (eso ya lo prueba la E2E de la impresión).
 */
export async function prepararImpresionDeCaja(
  request: APIRequestContext,
  e: EscenarioDeSalon,
  emulador: EmuladorEscPos,
): Promise<SimuladorPuente> {
  const token = await tokenPorApi(request, e.administrador);
  const sucursal = `/sucursales/${e.s1.id}`;
  const creada = await llamarApi<{ id: string }>(request, `${sucursal}/impresoras`, {
    metodo: 'POST',
    token,
    cuerpo: {
      nombre: IMPRESORA_DE_CAJA,
      conexion: { tipo: 'RED', host: emulador.host, puerto: emulador.puerto },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: true,
    },
  });
  expect(creada.estado, 'alta de la impresora de la caja').toBe(201);
  const destinoCaja = await llamarApi(request, `${sucursal}/impresion`, {
    metodo: 'PUT',
    token,
    cuerpo: { impresoraCajaId: creada.cuerpo.id },
  });
  expect(destinoCaja.estado, 'impresora de la caja de la sucursal').toBe(200);
  const vinculacion = await llamarApi<{ qr: string }>(request, `${sucursal}/vinculaciones-puente`, {
    metodo: 'POST',
    token,
  });
  expect(vinculacion.estado, 'código de vinculación del puente').toBe(201);
  const puente = await SimuladorPuente.iniciar({
    qr: vinculacion.cuerpo.qr,
    nombreEquipo: 'Puente de la caja',
    modelo: 'Simulador E2E',
  });
  expect(puente.conectado, 'el puente se conectó').toBe(true);
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token });
  return puente;
}

// --- Lo que la PWA le manda a la API ---------------------------------------------------------------------

/** Las escrituras de la caja: turnos, cuentas (cobros y descuentos), comprobantes, mostrador y la impresión. */
const ESCRITURA_DE_CAJA =
  /^\/(turnos|comprobantes|ventas-mostrador|impresion|autorizaciones)(\/|$)|^\/cuentas\/[^/]+\/(cobros|descuentos|cortesias)(\/|$)|^\/ordenes(\/|$)|^\/sucursales\/[^/]+\/(cajas|emisores)(\/|$)/;

/** Anota cada escritura (`POST`, `PUT`, `PATCH`, `DELETE`) de la caja que hace la PWA, con su clave. */
export function vigilarEscriturasDeCaja(page: Page): Escritura[] {
  const escrituras: Escritura[] = [];
  page.on('request', (peticion) => {
    const metodo = peticion.method();
    if (metodo === 'GET' || metodo === 'OPTIONS') return;
    const ruta = new URL(peticion.url()).pathname;
    if (!ESCRITURA_DE_CAJA.test(ruta)) return;
    escrituras.push({ metodo, ruta, clave: peticion.headers()['idempotency-key'] });
  });
  return escrituras;
}

// --- Atajos de la pantalla ---------------------------------------------------------------------------

/** Ajustes › <sección> (Cajas, Emisores…), desde cualquier pantalla del Administrador. */
export async function irAAjustes(page: Page, seccion: string): Promise<void> {
  await destino(page, 'Ajustes').click();
  const boton = page
    .getByRole('group', { name: 'Secciones de Ajustes' })
    .getByRole('button', { name: seccion, exact: true });
  await boton.click();
  await expect(boton).toHaveAttribute('aria-pressed', 'true');
}

/** `/caja` desde la navegación de quien cobra. */
export async function irACaja(page: Page): Promise<void> {
  await destino(page, 'Caja').click();
  await expect(page).toHaveURL(/\/caja(\?.*)?$/);
}

/** Abre la caja `nombre` con ese fondo; devuelve la respuesta de `POST /turnos`. */
export async function abrirCajaConFondo(page: Page, nombre: string, fondo: string) {
  await irACaja(page);
  await page.getByRole('radio', { name: new RegExp(nombre) }).click();
  await page.getByLabel('Fondo inicial').fill(fondo);
  const respuesta = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/turnos',
  );
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  const recibida = await respuesta;
  expect(recibida.status(), 'la caja se abrió').toBe(201);
  await expect(page.getByText('Turno abierto', { exact: true })).toBeVisible();
  return (await recibida.json()) as { id: string; impresion?: string; trabajoId?: string | null };
}

/** El turno de la persona (para comprobar lo que la pantalla dice). */
export async function turnoPorApi(request: APIRequestContext, page: Page) {
  const r = await llamarApi<{ id: string; caja: { nombre: string } }>(request, '/turnos/mio', {
    token: await tokenDeSesion(page),
  });
  expect(r.estado, 'GET de mi turno').toBe(200);
  return r.cuerpo;
}

/** Desde «Por cobrar» entra a la cuenta de una mesa y toca «Cobrar S/ …» hasta ver la pantalla del cobro. */
export async function abrirElCobroDeLaMesa(page: Page, mesa: string): Promise<void> {
  await irACaja(page);
  await page.getByRole('button', { name: 'Por cobrar', exact: true }).click();
  await page.getByRole('link', { name: new RegExp(`^Mesa ${mesa}, saldo`) }).click();
  await expect(
    page.getByRole('heading', { name: `Cobrar · Mesa ${mesa}`, level: 1 }),
  ).toBeVisible();
}

/** El botón principal del pie del cobro («Cobrar S/ 62.00»). */
export const botonDeCobrar = (page: Page): Locator =>
  page.getByRole('button', { name: /^Cobrar S\/\s?[\d,]+\.\d\d$/ });

/** Escribe la clave del supervisor en la ventana de PIN (teclado propio) y espera que se cierre. */
export async function darClaveDeSupervisor(page: Page, pin: string): Promise<void> {
  const ventana = page.getByRole('dialog', { name: 'Clave de supervisor' });
  await expect(ventana).toBeVisible();
  await page.waitForTimeout(400); // la hoja termina de subir
  for (const digito of pin) {
    await ventana.getByRole('button', { name: digito, exact: true }).click();
  }
  await expect(ventana).toBeHidden();
}

/** Los pulsos de gaveta que recibió el emulador (en tickets completos y en los que no llevan corte). */
export const pulsosDeGaveta = (emulador: EmuladorEscPos): number =>
  [...emulador.tickets, ...emulador.parciales].reduce((total, t) => total + t.pulsosGaveta, 0);

/** Espera que el emulador reciba al menos `n` pulsos de gaveta desde que se limpió. */
export async function esperarPulsosDeGaveta(emulador: EmuladorEscPos, n: number): Promise<void> {
  await expect
    .poll(() => pulsosDeGaveta(emulador), { message: 'pulsos de gaveta', timeout: 10_000 })
    .toBeGreaterThanOrEqual(n);
}
