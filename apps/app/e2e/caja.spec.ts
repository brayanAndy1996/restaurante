import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { EmuladorEscPos, type SimuladorPuente } from '../../api/test/soporte/puente';
import { CELULAR, fechaDeLima } from './ayudas';
import {
  CARPETA_DE_CAPTURAS,
  IMPRESORA_DE_CAJA,
  abrirCajaConFondo,
  esperarPulsosDeGaveta,
  pulsosDeGaveta,
  irAAjustes,
  prepararImpresionDeCaja,
  vigilarEscriturasDeCaja,
} from './ayudas-caja';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import { crearSalonPorApi } from './ayudas-impresion';
import {
  afirmarClavesDelSalon,
  crearEscenarioDeSalon,
  type EscenarioDeSalon,
} from './ayudas-salon';

/**
 * Caja, cobro y comprobantes de la entrega 6a (historia 006, tarea T23, criterio 118), de punta a punta y sin ningún
 * mock: la API real con PostgreSQL, un emulador de impresora ESC/POS (con gaveta) y el simulador del puente de 3b.
 *
 * Personas de la misma empresa, cada una en su propio contexto: el Administrador, un Cajero y un Supervisor (que
 * también cobra, con su propia caja), un Mozo y Cocina/Barra. Los pasos corren en serie, cada uno depende del anterior.
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 768, height: 1024 },
  isMobile: false,
};

let e: EscenarioDeSalon;
let emulador: EmuladorEscPos;
let puente: SimuladorPuente | undefined;
const abiertos: BrowserContext[] = [];

interface Persona {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDeCaja>;
}
let admin: Persona;
let cajero: Persona;
let supervisor: Persona;

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
  await crearSalonPorApi(request, e);
  emulador = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: IMPRESORA_DE_CAJA });
  puente = await prepararImpresionDeCaja(request, e, emulador);
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
  await puente?.detener().catch(() => undefined);
  await emulador?.cerrar();
});

async function entrar(
  browser: Browser,
  persona: Parameters<typeof entrarEnCelular>[1],
  sucursal?: string,
  opciones: BrowserContextOptions = CELULAR,
): Promise<Persona> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal, opciones);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDeCaja(page) };
}

const captura = (nombre: string) => `${CARPETA_DE_CAPTURAS}/${nombre}.png`;

// ---------------------------------------------------------------------------------------------------------

test('el Administrador deja lista la caja: la tasa de IGV, dos cajas con sus series y la impresora', async ({
  browser,
}) => {
  admin = await entrar(browser, e.administrador, e.s1.nombre);
  const { page } = admin;

  await test.step('pone la tasa de IGV del emisor', async () => {
    await irAAjustes(page, 'Emisores');
    await page.getByRole('button', { name: 'Agregar tasa' }).click();
    await page.getByLabel('Desde').fill(fechaDeLima(-30));
    await page.getByLabel('Tasa de IGV (%)').fill('18');
    await page.getByRole('button', { name: 'Guardar tasa' }).click();
    await expect(page.getByRole('heading', { name: 'Tasa de IGV' })).toBeVisible();
    await expect(page.getByText('18')).not.toHaveCount(0);
    await afirmarPantallaDeCelular(page, 'Ajustes › Emisores');
  });

  await test.step('crea Caja 1 y Caja 2, cada una con su serie de boletas y de facturas', async () => {
    await irAAjustes(page, 'Cajas');
    const nueva = async (nombre: string, boletas: string, facturas: string) => {
      await page.getByRole('button', { name: 'Agregar caja' }).click();
      await page.getByLabel('Nombre de la caja').fill(nombre);
      await page.getByLabel('Serie de boletas').fill(boletas);
      await page.getByLabel('Serie de facturas').fill(facturas);
      await page.getByRole('button', { name: 'Crear caja' }).click();
      await expect(page.getByText(`Caja ${nombre} creada.`)).toBeVisible();
    };
    await nueva('Caja 1', 'B001', 'F001');
    await nueva('Caja 2', 'B002', 'F002');
    const fila = page.getByRole('button', { name: /^Caja 1/ });
    await expect(fila).toContainText('Boletas B001');
    await expect(fila).toContainText('Facturas F001');
    await page.screenshot({ path: captura('01-cajas-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Ajustes › Cajas');
  });

  afirmarClavesDelSalon(admin.escrituras, [
    ['POST', /\/cajas$/],
    ['PUT', /\/series\/BOLETA$/],
  ]);
});

test('el Cajero abre su caja con fondo y la gaveta se abre; el Supervisor abre la suya en una tableta', async ({
  browser,
}) => {
  cajero = await entrar(browser, e.cajero);
  const { page } = cajero;

  await test.step('abre Caja 1 con S/ 200.00 y la pantalla dice que se abre la gaveta', async () => {
    emulador.limpiar();
    const turno = await abrirCajaConFondo(page, 'Caja 1', '200');
    expect(turno.impresion).toBe('EN_COLA');
    await expect(page.getByText(`Abriendo la gaveta en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
    await expect(page.getByText('S/ 200.00').first()).toBeVisible();
    await page.screenshot({ path: captura('02-turno-abierto-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Mi turno');
  });

  await test.step('el emulador recibe el pulso de la gaveta, sin papel ni corte', async () => {
    await esperarPulsosDeGaveta(emulador, 1);
    const solos = [...emulador.tickets, ...emulador.parciales].filter((t) => t.pulsosGaveta > 0);
    expect(solos[0]?.lineas).toEqual([]);
    expect(solos[0]?.corte).toBeNull();
  });

  await test.step('el Supervisor abre Caja 2 con S/ 100.00 (otro equipo, pantalla de tableta)', async () => {
    supervisor = await entrar(browser, e.supervisor, undefined, TABLETA);
    const antes = pulsosDeGaveta(emulador);
    const turno = await abrirCajaConFondo(supervisor.page, 'Caja 2', '100');
    expect(turno.impresion).toBe('EN_COLA');
    await esperarPulsosDeGaveta(emulador, antes + 1);
    await supervisor.page.screenshot({ path: captura('02-turno-abierto-768'), fullPage: true });
  });

  afirmarClavesDelSalon(cajero.escrituras, [['POST', /^\/turnos$/]]);
});
