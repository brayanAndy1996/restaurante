import { expect, test, type BrowserContext } from '@playwright/test';
import {
  CELULAR,
  afirmarSesionDe,
  ajustarVencimiento,
  crearEscenario,
  escribirPin,
  fechaDeLima,
  ingresarConContrasena,
  type Escenario,
} from './ayudas';

/**
 * Ventana de clave de supervisor (T39, criterio 98) y avisos de suscripción del Administrador (T42,
 * criterio 99), en viewport de celular y contra la API real.
 *
 * Todavía no hay acciones protegidas reales: la ventana se ejercita con la pantalla de demostración que
 * existe solo en el servidor de desarrollo (`/demo/clave-supervisor`). Por eso este archivo no corre
 * contra el paquete de producción (`vite preview`): en CI la PWA se sirve con `vite dev`.
 */
test.describe.configure({ mode: 'serial' });

let escenario: Escenario;
let celular: BrowserContext;

test.beforeAll(async ({ browser, request }) => {
  escenario = await crearEscenario(request);
  celular = await browser.newContext(CELULAR);
});
test.afterAll(async () => {
  await celular?.close();
});

test('un Cajero pide la clave de un Supervisor, y las claves malas dicen todas lo mismo', async () => {
  const { cajero, supervisor } = escenario;
  const page = await celular.newPage();
  await page.goto('/');
  await ingresarConContrasena(page, cajero.usuario, cajero.contrasena);
  await afirmarSesionDe(page, cajero);

  // La demostración solo existe en desarrollo y ya no cuelga de Inicio (el Cajero entra en el Salón): se abre por su dirección.
  await page.goto('/demo/clave-supervisor');
  // Para un Cajero, anular un ítem enviado exige la clave de un supervisor.
  await page.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
  const ventana = page.getByRole('dialog', { name: 'Clave de supervisor' });
  await expect(ventana).toContainText('Anular ítem: Ceviche mixto x1');
  await page.waitForTimeout(500); // la hoja termina de subir
  await page.screenshot({ path: 'e2e/resultados/clave-1-ventana.png' });

  // Tres claves malas de distinta causa: inexistente, la del propio solicitante y la de un Cajero.
  await ventana.getByRole('button', { name: 'Error al comandar' }).click();
  const mensajes: string[] = [];
  for (const malo of ['111111', cajero.pin]) {
    await escribirPin(page, malo);
    await expect(ventana.getByText('La clave no es válida')).toBeVisible();
    mensajes.push((await ventana.getByRole('alert').textContent()) ?? '');
    await page.screenshot({ path: `e2e/resultados/clave-2-error-${mensajes.length}.png` });
    await expect(ventana.getByRole('status').filter({ hasText: '0 de 6 dígitos' })).toBeAttached();
  }
  expect(new Set(mensajes).size).toBe(1);

  // La clave del supervisor autoriza y la ventana devuelve la autorización.
  await escribirPin(page, supervisor.pin);
  await expect(page.getByText(`Autorizó ${supervisor.nombre}`)).toBeVisible();
  await expect(page.getByTestId('autorizacion-id')).toHaveText(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('timer')).toContainText(/Vale [01]:\d\d más/);
  await expect(ventana).toBeHidden();
  await page.screenshot({ path: 'e2e/resultados/clave-3-autorizada.png' });

  // Tras cinco claves malas seguidas, el siguiente intento ya responde con el bloqueo y su cuenta regresiva.
  await page.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
  await ventana.getByRole('button', { name: 'Error al comandar' }).click();
  for (let i = 0; i < 6; i++) {
    await escribirPin(page, '222222');
    if (i < 5) {
      await expect(ventana.getByText('La clave no es válida')).toBeVisible();
      await expect(
        ventana.getByRole('status').filter({ hasText: '0 de 6 dígitos' }),
      ).toBeAttached();
    }
  }
  await expect(ventana.getByText('Clave bloqueada por unos minutos')).toBeVisible();
  await expect(ventana.getByRole('timer')).toHaveText(/^[45]:\d\d$/);
  await expect(ventana.getByRole('button', { name: '1', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'e2e/resultados/clave-4-bloqueo.png' });
  await page.close();
});

test('el Administrador ve el aviso de gracia y luego el de suspensión, y no puede cerrarlos', async ({
  request,
}) => {
  const { administrador } = escenario;
  const page = await celular.newPage();

  // Vencida hace 3 días con 7 de gracia: quedan 5 días antes de suspender.
  await ajustarVencimiento(request, escenario, fechaDeLima(-3));
  // El celular ya recuerda al Cajero (PIN): la Administradora entra por usuario y contraseña.
  await page.goto('/ingreso');
  await ingresarConContrasena(page, administrador.usuario, administrador.contrasena);
  await afirmarSesionDe(page, administrador);
  const gracia = page.getByRole('status').filter({ hasText: 'de gracia' });
  await expect(gracia).toContainText(`${escenario.sucursalNombre}: quedan 5 días de gracia`);
  await expect(gracia).toContainText('Se suspenderá el');
  await expect(gracia).toContainText('La suspensión solo impide abrir caja.');
  await expect(gracia.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/resultados/aviso-1-gracia.png' });

  // Vencida hace 20 días: suspendida. La app sigue funcionando (consultas, usuarios).
  await ajustarVencimiento(request, escenario, fechaDeLima(-20));
  await page.reload();
  const suspendida = page.getByRole('status').filter({ hasText: 'sucursal suspendida' });
  await expect(suspendida).toContainText(`${escenario.sucursalNombre}: sucursal suspendida`);
  await expect(suspendida).toContainText(
    'No se puede abrir caja. Puedes consultar y exportar tus datos.',
  );
  await expect(suspendida.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/resultados/aviso-2-suspendida.png' });
  // La Administradora entra en el Salón (criterio 87 de 004): Ajustes está en la navegación, no en Inicio.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Ajustes' })
    .click();
  await expect(page.getByRole('heading', { name: 'Ajustes' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usuarios', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(suspendida).toBeVisible();

  // Un pago (o un ajuste) la reactiva y el aviso desaparece en la siguiente lectura de la sesión.
  await ajustarVencimiento(request, escenario, fechaDeLima(20));
  await page.reload();
  await expect(page.getByText('sucursal suspendida')).toHaveCount(0);
  await expect(page.getByText('de gracia')).toHaveCount(0);
  await page.close();
});
