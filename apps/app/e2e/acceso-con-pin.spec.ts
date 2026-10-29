import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  CELULAR,
  COMPUTADORA,
  abrirSesion,
  crearEscenario,
  escribirPin,
  ingresarConContrasena,
  llamarApi,
  pinEquivocado,
  tokenDeSesion,
  tokensDeEquipo,
  type Escenario,
} from './ayudas';

/**
 * Acceso con equipos recordados e ingreso con PIN (tarea T35, criterios 92 a 97 y 100). Los pasos se
 * suceden en el mismo celular, que conserva su almacenamiento entre una pestaña y otra (como una app
 * que se cierra y se vuelve a abrir), y una computadora aparte para el administrador.
 */
test.describe.configure({ mode: 'serial' });

let escenario: Escenario;
let celular: BrowserContext;
let computadora: BrowserContext;

/** Abre la app "de nuevo": una pestaña nueva en el mismo celular (sin sesión, con el equipo recordado). */
async function abrirDeNuevo(): Promise<Page> {
  const page = await celular.newPage();
  await page.goto('/');
  return page;
}

async function cambiarUsuario(page: Page): Promise<void> {
  await abrirSesion(page);
  await page.getByRole('button', { name: 'Cambiar usuario' }).click();
}

test.beforeAll(async ({ browser, request }) => {
  escenario = await crearEscenario(request);
  celular = await browser.newContext(CELULAR);
  computadora = await browser.newContext(COMPUTADORA);
});

test.afterAll(async () => {
  await celular?.close();
  await computadora?.close();
});

test('ingresa con usuario y contraseña y el celular queda recordado', async () => {
  const { mozo } = escenario;
  const page = await celular.newPage();
  await page.goto('/');

  // Un celular que nunca entró: ingreso con usuario y contraseña, sin pedir el PIN.
  await ingresarConContrasena(page, mozo.usuario, mozo.temporal);
  await expect(page.getByRole('heading', { name: 'Elige tu contraseña' })).toBeVisible();
  await page.getByLabel('Contraseña temporal', { exact: true }).fill(mozo.temporal);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(mozo.contrasena);
  await page.getByLabel('Repite la contraseña nueva').fill(mozo.contrasena);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` })).toBeVisible();

  // Sin pedirle nada, el equipo la recuerda: guarda el token de equipo de su empresa.
  await expect
    .poll(async () => Object.keys(await tokensDeEquipo(page)))
    .toEqual([escenario.empresaId]);
  const token = (await tokensDeEquipo(page))[escenario.empresaId];
  expect(token).toMatch(/^eq\.[0-9a-f-]{36}\.[0-9a-f-]{36}\./);

  // La hoja de la sesión ya ofrece cambiar de usuario y olvidar este equipo.
  await expect(async () => {
    await abrirSesion(page);
    await expect(page.getByRole('button', { name: 'Cambiar usuario' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  await expect(page.getByRole('button', { name: 'Mis equipos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Olvidar este equipo' })).toBeVisible();
  await page.screenshot({ path: 'e2e/resultados/01-hoja-de-sesion.png' });
  await page.getByRole('button', { name: 'Mis equipos' }).click();

  // "Mis equipos": este equipo, marcado como el actual.
  await expect(page.getByRole('heading', { name: 'Mis equipos' })).toBeVisible();
  const lista = page.getByRole('list', { name: 'Mis equipos' });
  await expect(lista.getByRole('listitem')).toHaveCount(1);
  await expect(lista).toContainText('Este equipo');
  await page.screenshot({ path: 'e2e/resultados/02-mis-equipos.png' });
  await page.close();
});

test('entra con PIN en un celular que la recuerda, y un PIN equivocado no la deja pasar', async () => {
  const { mozo } = escenario;
  const page = await abrirDeNuevo();

  // Una sola persona recordada: va directo al teclado, con su nombre y el largo de su PIN.
  await expect(page.getByRole('heading', { name: 'Escribe tu PIN' })).toBeVisible();
  await expect(page.getByText(mozo.nombre)).toBeVisible();
  await expect(page.getByText('PIN de 4 dígitos')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '0 de 4 dígitos' })).toBeAttached();
  await page.screenshot({ path: 'e2e/resultados/03-pin.png' });

  await escribirPin(page, pinEquivocado(mozo.pin));
  await expect(page.getByText('El PIN no es correcto')).toBeVisible();
  await page.screenshot({ path: 'e2e/resultados/04-pin-incorrecto.png' });
  // Después del error los puntos se vacían solos y se puede volver a intentar.
  await expect(page.getByRole('status').filter({ hasText: '0 de 4 dígitos' })).toBeAttached();

  await escribirPin(page, mozo.pin);
  await expect(page.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` })).toBeVisible();
  await expect(page.getByText('Escribe tu PIN')).toHaveCount(0);
  await page.close();
});

test('una segunda persona usa el mismo celular y se cambia de usuario con un toque', async ({
  request,
}) => {
  const { mozo, administrador } = escenario;
  const page = await abrirDeNuevo();
  await escribirPin(page, mozo.pin);
  await expect(page.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` })).toBeVisible();

  // "Cambiar usuario": vuelve a la pantalla de PIN y desde ahí entra otra persona con su contraseña.
  await cambiarUsuario(page);
  await expect(page.getByRole('heading', { name: 'Escribe tu PIN' })).toBeVisible();
  await page.getByRole('link', { name: 'Ingresar con usuario y contraseña' }).click();
  await ingresarConContrasena(page, administrador.usuario, administrador.contrasena);
  await expect(
    page.getByRole('heading', { name: `Hola, ${administrador.primerNombre}` }),
  ).toBeVisible();

  // Ahora el equipo recuerda a dos personas: elegir el nombre y escribir el PIN de cada una.
  await expect(async () => {
    await cambiarUsuario(page);
    await expect(page.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  await expect(page.getByText('Este celular recuerda a 2 de 5 personas.')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(mozo.nombre) })).toBeVisible();
  await page.screenshot({ path: 'e2e/resultados/05-elegir-persona.png' });

  await page.getByRole('button', { name: new RegExp(administrador.nombre) }).click();
  await expect(page.getByText('PIN de 6 dígitos')).toBeVisible();
  await escribirPin(page, administrador.pin);
  await expect(
    page.getByRole('heading', { name: `Hola, ${administrador.primerNombre}` }),
  ).toBeVisible();
  const tokenDelAdministrador = await tokenDeSesion(page);
  const equipo = (await tokensDeEquipo(page))[escenario.empresaId]!;
  expect(tokenDelAdministrador).toMatch(/^se\./);

  // Cambio de persona: entra Lucía y la sesión de Marta queda cerrada en el servidor.
  await cambiarUsuario(page);
  await page.getByRole('button', { name: new RegExp(mozo.nombre) }).click();
  await escribirPin(page, mozo.pin);
  await expect(page.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` })).toBeVisible();
  const anterior = await llamarApi(request, '/sesion', {
    token: tokenDelAdministrador,
    equipo,
  });
  expect(anterior.estado).toBe(401);
  await page.close();
});

test('la sesión se cierra por inactividad según la sucursal y vuelve a la pantalla de PIN', async ({
  request,
}) => {
  test.setTimeout(150_000);
  const { administrador, mozo } = escenario;

  // El Administrador fija 1 minuto de inactividad desde "Acceso" (otra pantalla de T35).
  const admin = await computadora.newPage();
  await admin.goto('/');
  await ingresarConContrasena(admin, administrador.usuario, administrador.contrasena);
  await expect(
    admin.getByRole('heading', { name: `Hola, ${administrador.primerNombre}` }),
  ).toBeVisible();
  await admin.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await admin.getByRole('button', { name: 'Acceso', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Cierre por inactividad' })).toBeVisible();
  const campo = admin
    .getByRole('group', { name: escenario.sucursalNombre })
    .getByLabel('Cierre por inactividad (minutos)', { exact: true });
  await expect(campo).toHaveValue('5');
  await campo.fill('1');
  await admin.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(admin.getByText('Cambios guardados')).toBeVisible();
  await admin.screenshot({ path: 'e2e/resultados/06-acceso-sucursal.png' });
  await admin.close();

  // Lucía entra con PIN y deja el celular sin tocar.
  const page = await abrirDeNuevo();
  await expect(page.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(mozo.nombre) }).click();
  await escribirPin(page, mozo.pin);
  await expect(page.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` })).toBeVisible();
  const token = await tokenDeSesion(page);
  const equipo = (await tokensDeEquipo(page))[escenario.empresaId]!;

  // A los 30 segundos del cierre avisa; al minuto cierra y pide el PIN de nuevo.
  await expect(page.getByText(/Tu sesión se cerrará en 0:\d\d/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Seguir trabajando' })).toBeVisible();
  await page.screenshot({ path: 'e2e/resultados/07-sesion-por-vencer.png' });
  await expect(page.getByText('Tu sesión se cerró por inactividad')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible();
  await page.screenshot({ path: 'e2e/resultados/08-sesion-cerrada.png' });

  // Y en el servidor la sesión ya no sirve.
  const respuesta = await llamarApi(request, '/sesion', { token, equipo });
  expect(respuesta.estado).toBe(401);
  await page.close();
});

test('el administrador revoca el equipo de un trabajador y su sesión deja de valer', async () => {
  const { administrador, mozo } = escenario;

  // Lucía trabaja en su celular con una sesión PIN abierta.
  const celularDeLucia = await abrirDeNuevo();
  await celularDeLucia.getByRole('button', { name: new RegExp(mozo.nombre) }).click();
  await escribirPin(celularDeLucia, mozo.pin);
  await expect(
    celularDeLucia.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` }),
  ).toBeVisible();

  // Desde su computadora, la administradora abre a Lucía y olvida su celular.
  // Su computadora ya la recuerda (entró con contraseña en el paso anterior): entra con su PIN de 6 dígitos.
  const admin = await computadora.newPage();
  await admin.goto('/');
  await expect(admin.getByRole('heading', { name: 'Escribe tu PIN' })).toBeVisible();
  await escribirPin(admin, administrador.pin);
  await expect(
    admin.getByRole('heading', { name: `Hola, ${administrador.primerNombre}` }),
  ).toBeVisible();
  await admin.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Usuarios', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await admin
    .getByRole('link', { name: new RegExp(mozo.nombre) })
    .first()
    .click();
  await expect(admin.getByRole('heading', { name: 'Equipos recordados' })).toBeVisible();
  const equipos = admin.getByRole('list', { name: 'Equipos recordados' });
  await expect(equipos.getByRole('listitem')).toHaveCount(1);
  await admin.screenshot({ path: 'e2e/resultados/09-equipos-del-usuario.png' });
  await equipos.getByRole('button', { name: /^Olvidar/ }).click();
  await expect(admin.getByRole('dialog')).toContainText('Olvidar un equipo');
  await admin.getByRole('dialog').getByRole('button', { name: 'Olvidar', exact: true }).click();
  await expect(admin.getByText(`Ningún equipo recuerda a ${mozo.nombre}`)).toBeVisible();

  // En el celular de Lucía, la siguiente petición responde 401: vuelve a la pantalla de PIN, ya sin ella.
  await celularDeLucia.reload();
  await expect(celularDeLucia.getByText('Tu sesión ya no es válida')).toBeVisible();
  await expect(celularDeLucia.getByRole('heading', { name: 'Escribe tu PIN' })).toBeVisible();
  await expect(celularDeLucia.getByText(administrador.nombre)).toBeVisible();
  await expect(celularDeLucia.getByText(mozo.nombre)).toHaveCount(0);
  await celularDeLucia.screenshot({ path: 'e2e/resultados/10-equipo-revocado.png' });

  // Para volver a entrar con PIN, Lucía tiene que ingresar otra vez con su contraseña.
  await celularDeLucia.getByRole('link', { name: 'Ingresar con usuario y contraseña' }).click();
  await ingresarConContrasena(celularDeLucia, mozo.usuario, mozo.contrasena);
  await expect(
    celularDeLucia.getByRole('heading', { name: `Hola, ${mozo.primerNombre}` }),
  ).toBeVisible();
  await celularDeLucia.close();
  await admin.close();
});
