import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { EmuladorEscPos, type SimuladorPuente } from '../../api/test/soporte/puente';
import { CELULAR } from './ayudas';
import {
  CARPETA_DE_CAPTURAS,
  IMPRESORA_DE_CAJA,
  PLATOS,
  abrirCajaConFondo,
  abrirElCobroDeLaMesa,
  abrirMesaYComandar,
  cobrarYEsperar,
  esperarTicketCon,
  prepararImpresionDeCaja,
  vigilarEscriturasDeCaja,
} from './ayudas-caja';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import {
  RUC,
  cargarElPadron,
  escribirRucDeFactura,
  esperarControlDelSimulador,
  estadoAnteSunat,
  limpiarElSimulador,
  prepararLaFacturacion,
} from './ayudas-facturacion';
import { crearSalonPorApi } from './ayudas-impresion';
import { crearEscenarioDeSalon, type EscenarioDeSalon } from './ayudas-salon';

/**
 * Facturación electrónica de la entrega 6b (historia 006, tarea T45, criterio 179), de punta a punta y sin ningún
 * mock: la API real con PostgreSQL y el worker de verdad (pg-boss), el PSE simulado, el padrón de RUC de ejemplo
 * cargado por el worker, el emulador de impresora ESC/POS y el simulador del puente de 3b.
 *
 * Cada persona vive en su propio contexto del navegador: un Cajero, un Supervisor y el Administrador; y un contexto sin
 * sesión para abrir el enlace del PDF. Los pasos corren en serie, cada uno depende del anterior.
 */
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 768, height: 1024 },
  isMobile: false,
};

/** El mismo recorrido corre en `celular` (360 × 740) y en `tablet` (768 × 1024, todas las personas en tableta). */
const enTableta = () => test.info().project.name === 'tablet';
const equipoBase = (): BrowserContextOptions => (enTableta() ? TABLETA : CELULAR);

let e: EscenarioDeSalon;
let emulador: EmuladorEscPos;
let puente: SimuladorPuente | undefined;
const abiertos: BrowserContext[] = [];

interface Persona {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDeCaja>;
}
let cajero: Persona;
let mozo: Persona;

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
  await crearSalonPorApi(request, e);
  emulador = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: IMPRESORA_DE_CAJA });
  puente = await prepararImpresionDeCaja(request, e, emulador);
  await esperarControlDelSimulador(request);
  await limpiarElSimulador(request);
  await cargarElPadron(request);
  await prepararLaFacturacion(request, e);
});
test.afterAll(async ({ request }) => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
  await puente?.detener().catch(() => undefined);
  await emulador?.cerrar();
  await limpiarElSimulador(request).catch(() => undefined);
});

async function entrar(
  browser: Browser,
  persona: Parameters<typeof entrarEnCelular>[1],
  sucursal?: string,
  opciones: BrowserContextOptions = equipoBase(),
): Promise<Persona> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal, opciones);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDeCaja(page) };
}

const captura = (nombre: string) =>
  enTableta()
    ? `${CARPETA_DE_CAPTURAS}/tablet-${nombre.replace(/-360$/, '-768')}.png`
    : `${CARPETA_DE_CAPTURAS}/${nombre}.png`;

/** Elige «Boleta» o «Factura» en el comprobante del cobro. */
async function elegirTipoDeComprobante(page: Page, tipo: 'Boleta' | 'Factura'): Promise<void> {
  const boton = page
    .getByRole('group', { name: 'Tipo de comprobante' })
    .getByRole('button', { name: tipo, exact: true });
  await boton.click();
  await expect(boton).toHaveAttribute('aria-pressed', 'true');
}

// ---------------------------------------------------------------------------------------------------------

test('el Cajero cobra una factura: el RUC llena la razón social y la dirección con el padrón y SUNAT la acepta en vivo', async ({
  browser,
}) => {
  [cajero, mozo] = [await entrar(browser, e.cajero), await entrar(browser, e.mozo)];
  const { page } = cajero;

  await test.step('abre Caja 1 con S/ 200.00 y el Mozo comanda un lomo saltado en la mesa 1', async () => {
    await abrirCajaConFondo(page, 'Caja 1', '200');
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.lomo]);
  });

  await test.step('en el cobro elige Factura y escribe el RUC: el padrón llena los datos del cliente', async () => {
    await abrirElCobroDeLaMesa(page, '1');
    await elegirTipoDeComprobante(page, 'Factura');
    await escribirRucDeFactura(page, RUC.activo.numero, 200);
    await expect(page.getByLabel('Razón social')).toHaveValue(RUC.activo.razonSocial);
    await expect(page.getByLabel('Dirección fiscal')).toHaveValue(RUC.activo.direccion);
    await expect(page.getByText(/^Datos del padrón de SUNAT del \d{2}\/\d{2}/)).toBeVisible();
    // Un RUC activo y habido no lleva aviso ni pide «Emitir igual».
    await expect(page.getByText('Emitir igual')).toHaveCount(0);
    await page.screenshot({ path: captura('11-factura-con-padron-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cobro con factura y padrón');
  });

  await test.step('cobra y el comprobante pasa a «Aceptado por SUNAT» sin recargar la pantalla', async () => {
    emulador.limpiar();
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toMatch(/^F001-\d{8}$/);
    await expect(page.getByText(`Factura · ${cobro.comprobante.numero}`)).toBeVisible();
    const estado = estadoAnteSunat(page);
    await expect(estado).toContainText('Aceptado por SUNAT', { timeout: 30_000 });
    // La empresa de la prueba factura en modo simulado: la marca lo dice.
    await expect(estado).toContainText('Simulado');
    await page.screenshot({ path: captura('12-factura-aceptada-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado con la factura aceptada');
  });

  await test.step('el ticket sale con la leyenda de 6b, la marca de simulado y el QR del cliente', async () => {
    const ticket = await esperarTicketCon(emulador, 'FACTURA ELECTRÓNICA');
    expect(ticket.texto).toContain('SIMULADO · SIN VALOR TRIBUTARIO');
    expect(ticket.texto).toContain('Representación impresa de la FACTURA ELECTRÓNICA');
    expect(ticket.texto).toContain(RUC.activo.numero);
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.qrs[0]).toContain(`|01|F001|`);
    expect(ticket.qrs[0]).toContain(`|6|${RUC.activo.numero}`);
  });
});
