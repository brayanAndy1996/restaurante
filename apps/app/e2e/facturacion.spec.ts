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
  botonDeCobrar,
  cobrarYEsperar,
  esperarTicketCon,
  irACaja,
  prepararImpresionDeCaja,
  darClaveDeSupervisor,
} from './ayudas-caja';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import {
  RUC,
  cargarElPadron,
  escribirRucDeFactura,
  esperarControlDelSimulador,
  estadoAnteSunat,
  emitirComprobanteNuevo,
  estadoDelComprobanteNuevo,
  limpiarElSimulador,
  rechazarRucEnElSimulador,
  vigilarEscriturasDeFacturacion,
  irAlPanelDeCaja,
  irAlPanelDeAjustes,
  filaDelPanel,
  filaDelReporte,
  abrirComprobanteDelPanel,
  prepararLaFacturacion,
} from './ayudas-facturacion';
import { crearSalonPorApi } from './ayudas-impresion';
import {
  afirmarClavesDelSalon,
  crearEscenarioDeSalon,
  type EscenarioDeSalon,
} from './ayudas-salon';

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

/**
 * DEFECTOS ENCONTRADOS POR ESTA PRUEBA EN LA PWA (se reportaron al orquestador; no se tocó el código de producción). Cada
 * prueba afectada se salta (`test.fixme`) mientras la constante valga `true`; al corregir el defecto se pone en `false` y
 * la prueba debe pasar sin más cambios.
 *
 * 1. La hoja «Nota de crédito» se cierra sola. `ComprobanteDetallePagina` la monta con `notaAbierta && puedeNota`, y
 *    `puedeNota` deja de ser verdad apenas SUNAT acepta una nota de anulación o de cambio a factura (el original pasa a
 *    ANULADO, en vivo): a ~1 s de emitirla, la persona pierde el resultado («Nota de crédito emitida», el número de la
 *    factura nueva, el estado de los dos documentos, el ticket) y se queda con el detalle del original.
 * 2. El detalle de un comprobante nuevo conserva lo de la reemisión anterior. `DetalleCargado` no se vuelve a montar al
 *    pasar de un comprobante a otro (misma ruta, otro `:id`), así que `reemision.data` sigue puesto: tras «Emitir otro» →
 *    rechazado otra vez → «Ver el comprobante nuevo», el detalle del nuevo sigue mostrando «Comprobante nuevo emitido»
 *    y no ofrece «Emitir otro» hasta recargar.
 */
const DEFECTO_LA_HOJA_DE_NOTA_SE_CIERRA_SOLA = true;
const DEFECTO_EL_DETALLE_CONSERVA_LA_REEMISION_ANTERIOR = true;

let e: EscenarioDeSalon;
let emulador: EmuladorEscPos;
let puente: SimuladorPuente | undefined;
const abiertos: BrowserContext[] = [];

interface Persona {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDeFacturacion>;
}
let cajero: Persona;
let mozo: Persona;
let supervisor: Persona;
let admin: Persona;

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
  return { contexto, page, escrituras: vigilarEscriturasDeFacturacion(page) };
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

test('un RUC con baja de oficio avisa y solo se cobra con «Emitir igual»', async () => {
  const { page } = cajero;

  await test.step('el Mozo comanda un ceviche en la mesa 1 y el Cajero abre su cobro con factura', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.ceviche]);
    await abrirElCobroDeLaMesa(page, '1');
    await elegirTipoDeComprobante(page, 'Factura');
  });

  await test.step('el padrón lo trae como BAJA DE OFICIO / NO HABIDO: aviso con fecha y la marca «Emitir igual»', async () => {
    await escribirRucDeFactura(page, RUC.bajaDeOficio.numero, 200);
    await expect(
      page.getByText(
        /^Este RUC figura como BAJA DE OFICIO \/ NO HABIDO en el padrón de SUNAT del \d{2}\/\d{2}$/,
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Razón social')).toHaveValue(RUC.bajaDeOficio.razonSocial);
    // El padrón no trae su dirección: la escribe el Cajero.
    await expect(page.getByLabel('Dirección fiscal')).toHaveValue('');
    await page.getByLabel('Dirección fiscal').fill('Jr. Los Pinos 123, Lima');
    await expect(page.getByRole('checkbox', { name: 'Emitir igual' })).not.toBeChecked();
    await page.screenshot({ path: captura('13-ruc-baja-de-oficio-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cobro con un RUC de baja de oficio');
  });

  await test.step('sin la marca no se cobra: el cuerpo no sale hacia la API y la casilla marca el error', async () => {
    await expect(page.getByText('Marca «Emitir igual» para usar este RUC.')).toBeVisible();
    const cobros = () => cajero.escrituras.filter((w) => /\/cobros$/.test(w.ruta)).length;
    const antes = cobros();
    await botonDeCobrar(page).click();
    await expect(page.getByText('Marca «Emitir igual» o corrige el RUC.')).toBeVisible();
    // Dale tiempo a una petición que no debería salir.
    await page.waitForTimeout(500);
    expect(cobros()).toBe(antes);
  });

  await test.step('con la marca cobra, SUNAT acepta la factura y el aviso no vuelve', async () => {
    await page.getByRole('checkbox', { name: 'Emitir igual' }).check();
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toMatch(/^F001-\d{8}$/);
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT', { timeout: 30_000 });
  });
});

test('un rechazo del simulador sale en el aviso del Supervisor y se corrige con «Emitir otro» hasta que SUNAT acepta', async ({
  browser,
  request,
}) => {
  const MENSAJE = 'El RUC del cliente no es válido para SUNAT (simulado)';
  await rechazarRucEnElSimulador(request, RUC.sunat.numero, { codigo: '2800', mensaje: MENSAJE });
  const { page } = cajero;
  let rechazado = '';

  await test.step('el Cajero cobra una factura al RUC que el simulador rechaza y ve el motivo con «Emitir otro»', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.gaseosa]);
    await abrirElCobroDeLaMesa(page, '1');
    await elegirTipoDeComprobante(page, 'Factura');
    await escribirRucDeFactura(page, RUC.sunat.numero, 200);
    await expect(page.getByLabel('Razón social')).toHaveValue(RUC.sunat.razonSocial);
    const cobro = await cobrarYEsperar(page);
    rechazado = cobro.comprobante.numero;
    const estado = estadoAnteSunat(page);
    await expect(estado).toContainText(`Rechazado: SUNAT: ${MENSAJE}`, { timeout: 30_000 });
    // El Cajero puede emitir otro: no se le dice que avise al supervisor.
    await expect(estado).toContainText('Corrige los datos y emite otro comprobante.');
    await expect(estado).not.toContainText('Avísale a tu supervisor');
    await expect(estado.getByRole('link', { name: 'Emitir otro' })).toBeVisible();
    await page.screenshot({ path: captura('14-factura-rechazada-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado con la factura rechazada');
  });

  supervisor = await entrar(browser, e.supervisor);
  const sp = supervisor.page;

  await test.step('el Supervisor ve el aviso en Caja con el modo simulado y va a los comprobantes con alerta', async () => {
    await irACaja(sp);
    const aviso = sp.locator('.ui-banner').filter({ hasText: '1 comprobante rechazado' });
    await expect(aviso).toBeVisible();
    await expect(
      sp.locator('.ui-banner').filter({ hasText: 'Facturación en modo simulado' }),
    ).toBeVisible();
    await sp.screenshot({ path: captura('15-aviso-del-supervisor-360'), fullPage: true });
    await afirmarPantallaDeCelular(sp, 'Caja › Aviso de comprobantes rechazados');
    await aviso.getByRole('link', { name: 'Ver comprobantes' }).click();
    await expect(sp).toHaveURL(/\/caja\/comprobantes\?alerta=1$/);
    await abrirComprobanteDelPanel(sp, rechazado);
    await expect(estadoAnteSunat(sp)).toContainText(`Rechazado: SUNAT: ${MENSAJE}`);
    await expect(sp.getByRole('heading', { name: 'Respuesta de SUNAT' })).toBeVisible();
    await expect(sp.getByText('2800', { exact: true })).toBeVisible();
  });

  await test.step('«Emitir otro»: parte del cliente del rechazado, se corrige el RUC y el padrón llena los datos nuevos', async () => {
    await sp.getByRole('button', { name: 'Emitir otro', exact: true }).click();
    await expect(sp.getByRole('heading', { name: 'Emitir otro comprobante' })).toBeVisible();
    await expect(sp.getByLabel('RUC', { exact: true })).toHaveValue(RUC.sunat.numero);
    await sp.screenshot({ path: captura('16-emitir-otro-360'), fullPage: true });
    await afirmarPantallaDeCelular(sp, 'Comprobantes › Emitir otro');
    await escribirRucDeFactura(sp, RUC.panaderia.numero, 200);
    await expect(sp.getByLabel('Razón social')).toHaveValue(RUC.panaderia.razonSocial);
    await expect(sp.getByLabel('Dirección fiscal')).toHaveValue(RUC.panaderia.direccion);
  });

  await test.step('el comprobante nuevo sale con otro número y SUNAT lo acepta; el rechazado conserva el suyo', async () => {
    const nuevo = await emitirComprobanteNuevo(sp);
    expect(nuevo).not.toBe(rechazado);
    await expect(sp.getByRole('heading', { name: 'Comprobante nuevo emitido' })).toBeVisible();
    await expect(estadoDelComprobanteNuevo(sp)).toContainText('Aceptado por SUNAT', {
      timeout: 30_000,
    });
    await sp.screenshot({ path: captura('17-emitir-otro-aceptado-360'), fullPage: true });
    await afirmarPantallaDeCelular(sp, 'Comprobantes › Emitir otro aceptado');
    await irACaja(sp);
    await sp.getByRole('link', { name: 'Comprobantes', exact: true }).click();
    await expect(sp).toHaveURL(/\/caja\/comprobantes(\?.*)?$/);
    await expect(
      sp
        .getByRole('link', { name: new RegExp(`${rechazado}, Rechazado`) })
        .or(sp.getByRole('row', { name: new RegExp(`${rechazado}.*Rechazado`) })),
    ).toBeVisible();
    await expect(
      sp
        .getByRole('link', { name: new RegExp(`${nuevo}, Aceptado`) })
        .or(sp.getByRole('row', { name: new RegExp(`${nuevo}.*Aceptado`) })),
    ).toBeVisible();
  });

  await test.step('ya nadie debe corregir nada: el aviso de rechazados desaparece de Caja', async () => {
    await irACaja(sp);
    await expect(
      sp.locator('.ui-banner').filter({ hasText: 'Facturación en modo simulado' }),
    ).toBeVisible();
    await expect(sp.locator('.ui-banner').filter({ hasText: 'rechazado' })).toHaveCount(0);
  });
});

test('una devolución parcial con la clave del Supervisor sale en efectivo de la caja del Cajero y aparece en el X', async () => {
  const { page } = cajero;
  let boleta = '';

  await test.step('el Mozo comanda dos lomos y una gaseosa y el Cajero cobra la boleta en efectivo (S/ 62.00)', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.lomo, PLATOS.lomo, PLATOS.gaseosa]);
    await abrirElCobroDeLaMesa(page, '1');
    await page.getByRole('textbox', { name: 'Recibido' }).fill('70');
    const cobro = await cobrarYEsperar(page);
    boleta = cobro.comprobante.numero;
    expect(boleta).toMatch(/^B001-\d{8}$/);
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT', { timeout: 30_000 });
  });

  await test.step('desde Caja › Comprobantes abre la boleta aceptada y toca «Nota de crédito»', async () => {
    await irAlPanelDeCaja(page);
    await abrirComprobanteDelPanel(page, boleta);
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT');
    await page.getByRole('button', { name: 'Nota de crédito', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Nota de crédito' })).toBeVisible();
  });

  const hoja = page.getByRole('dialog', { name: 'Nota de crédito' });
  await test.step('elige «Devolver ítems», una unidad de lomo y el motivo: el total sale de calcularNotaCredito', async () => {
    await hoja
      .getByRole('group', { name: 'Qué quieres hacer' })
      .getByRole('button', { name: 'Devolver ítems', exact: true })
      .click();
    // Los dos lomos salieron en dos líneas de la boleta: se devuelve uno.
    await hoja.getByRole('button', { name: 'Agregar una unidad de Lomo saltado' }).first().click();
    await expect(hoja.getByRole('definition').filter({ hasText: 'S/ 28.00' })).toBeVisible();
    await expect(hoja.getByText(/^Incluye IGV S\/\s4\.27 · 1 unidad$/)).toBeVisible();
    await hoja.getByRole('button', { name: 'Producto en mal estado', exact: true }).click();
    await expect(hoja.getByText('Sale de tu turno en Caja 1')).toBeVisible();
    await page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: captura('18-nota-de-credito-360') });
    await afirmarPantallaDeCelular(page, 'Comprobante › Nota de crédito (devolución)');
  });

  await test.step('el Cajero pide la clave: el Supervisor ve lo que autoriza y la da; la nota sale devolviendo S/ 28.00 en efectivo', async () => {
    emulador.limpiar();
    await hoja.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
    const ventana = page.getByRole('dialog', { name: 'Clave de supervisor' });
    await expect(ventana).toContainText(
      `Nota de crédito · Devolución · ${boleta} · S/ 28.00 · devuelve S/ 28.00 en efectivo`,
    );
    await darClaveDeSupervisor(page, e.supervisor.pin);
    await expect(hoja.getByText('Nota de crédito emitida')).toBeVisible();
    await expect(hoja.getByText('Devuelto en efectivo')).toBeVisible();
    await expect(hoja.getByRole('region', { name: 'Estado ante SUNAT' })).toContainText(
      'Aceptado por SUNAT',
      { timeout: 30_000 },
    );
    await page.screenshot({ path: captura('19-nota-emitida-360') });
    await afirmarPantallaDeCelular(page, 'Comprobante › Nota de crédito emitida');
  });

  await test.step('el ticket de la nota llega al emulador con lo que modifica y abre la gaveta', async () => {
    const ticket = await esperarTicketCon(emulador, 'NOTA DE CRÉDITO ELECTRÓNICA');
    expect(ticket.texto).toContain(boleta);
    expect(ticket.texto).toContain('Producto en mal estado');
    expect(ticket.pulsosGaveta).toBe(1);
    expect(ticket.qrs[0]).toContain('|07|BC01|');
  });

  await test.step('la boleta sigue «Aceptado» y lista su nota de crédito; el original no se anula', async () => {
    await hoja.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT');
    await expect(page.getByRole('link', { name: /^BC01-\d{8}$/ })).toBeVisible();
  });

  await test.step('el X del Cajero muestra la devolución en los egresos y la baja del efectivo esperado', async () => {
    await irACaja(page);
    await page.getByRole('button', { name: 'Reporte X', exact: true }).click();
    await expect(page.getByText(/^Generado a las /)).toBeVisible();
    await expect(filaDelReporte(page, 'Efectivo que entró o salió', 'Egresos')).toHaveText(
      'S/ 28.00',
    );
    // 200.00 de fondo + 28.00 + 38.00 + 6.00 + 62.00 cobrados en efectivo − 28.00 devueltos.
    await expect(filaDelReporte(page, 'Lo que debería haber en caja', 'Efectivo')).toHaveText(
      'S/ 306.00',
    );
    await page.screenshot({ path: captura('20-reporte-x-con-devolucion-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Reporte X con la devolución');
  });

  afirmarClavesDelSalon(cajero.escrituras, [
    ['POST', /^\/notas-credito$/],
    ['POST', /^\/autorizaciones$/],
  ]);
});

test('el Administrador cambia una boleta por factura: la boleta queda «Anulado» y la factura nueva «Aceptado»', async ({
  browser,
}) => {
  test.fixme(
    DEFECTO_LA_HOJA_DE_NOTA_SE_CIERRA_SOLA,
    'La hoja «Nota de crédito» se cierra sola cuando el original pasa a ANULADO (ver la constante)',
  );
  let boleta = '';
  admin = await entrar(browser, e.administrador, e.s1.nombre);
  const { page } = admin;

  await test.step('el Mozo comanda un ceviche y el Cajero cobra la boleta (S/ 38.00) en efectivo', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.ceviche]);
    await abrirElCobroDeLaMesa(cajero.page, '1');
    const cobro = await cobrarYEsperar(cajero.page);
    boleta = cobro.comprobante.numero;
    await expect(estadoAnteSunat(cajero.page)).toContainText('Aceptado por SUNAT', {
      timeout: 30_000,
    });
  });

  await test.step('en Ajustes › Comprobantes el Administrador abre la boleta y elige «Cambiar a factura»', async () => {
    await irAlPanelDeAjustes(page);
    await abrirComprobanteDelPanel(page, boleta);
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT');
    await page.getByRole('button', { name: 'Nota de crédito', exact: true }).click();
    const hoja = page.getByRole('dialog', { name: 'Nota de crédito' });
    await hoja
      .getByRole('group', { name: 'Qué quieres hacer' })
      .getByRole('button', { name: 'Cambiar a factura', exact: true })
      .click();
    await escribirRucDeFactura(page, RUC.activo.numero, 200);
    await expect(hoja.getByLabel('Razón social')).toHaveValue(RUC.activo.razonSocial);
    await expect(hoja.getByLabel('Dirección fiscal')).toHaveValue(RUC.activo.direccion);
    await hoja.getByRole('button', { name: 'El cliente pidió factura', exact: true }).click();
    await page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: captura('21-cambio-a-factura-360') });
    await afirmarPantallaDeCelular(page, 'Comprobante › Cambiar a factura');
  });

  const hoja = page.getByRole('dialog', { name: 'Nota de crédito' });
  await test.step('el Administrador emite sin clave: salen la nota de crédito y la factura, y SUNAT acepta las dos', async () => {
    emulador.limpiar();
    await hoja.getByRole('button', { name: 'Emitir nota de crédito', exact: true }).click();
    await expect(hoja.getByText('Nota de crédito emitida')).toBeVisible();
    await expect(hoja.getByText('Devolución de dinero')).toBeVisible();
    await expect(hoja.getByText('Ninguna', { exact: true })).toBeVisible();
    await expect(
      hoja
        .getByRole('region', { name: 'Estado ante SUNAT' })
        .filter({ hasText: 'Aceptado por SUNAT' }),
    ).toHaveCount(2, { timeout: 30_000 });
    await expect(hoja.getByText(/^Factura · F001-\d{8}$/)).toBeVisible();
    await page.screenshot({ path: captura('22-cambio-emitido-360') });
    await afirmarPantallaDeCelular(page, 'Comprobante › Cambio a factura emitido');
  });

  await test.step('salen los dos tickets (la nota y la factura) y ninguno abre la gaveta', async () => {
    const nota = await esperarTicketCon(emulador, 'NOTA DE CRÉDITO ELECTRÓNICA');
    const factura = await esperarTicketCon(emulador, 'Representación impresa de la FACTURA');
    expect(nota.pulsosGaveta + factura.pulsosGaveta).toBe(0);
    expect(nota.texto).toContain(boleta);
    expect(factura.texto).toContain(RUC.activo.numero);
  });

  await test.step('la boleta pasa a «Anulado» en la misma pantalla y el panel lista la factura nueva aceptada', async () => {
    await hoja.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(estadoAnteSunat(page)).toContainText('Anulado', { timeout: 30_000 });
    await expect(page.getByRole('link', { name: /^F001-\d{8}$/ })).toBeVisible();
    await page.screenshot({ path: captura('23-boleta-anulada-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Comprobante › Boleta anulada');
    await irAlPanelDeAjustes(page);
    await expect(filaDelPanel(page, boleta)).toContainText('Anulado');
  });

  await test.step('el cambio no es dinero nuevo: el X del Cajero no suma la factura ni resta nada', async () => {
    const { page: pc } = cajero;
    await irACaja(pc);
    await pc.getByRole('button', { name: 'Reporte X', exact: true }).click();
    // Cinco cobros: tres facturas (una rechazada), la boleta de S/ 62.00 y esta boleta; la reemisión y el cambio no cuentan.
    await expect(filaDelReporte(pc, 'Ventas', 'Total vendido')).toHaveText('S/ 172.00');
    await expect(pc.getByText('5 comprobantes', { exact: true })).toBeVisible();
    await expect(filaDelReporte(pc, 'Efectivo que entró o salió', 'Egresos')).toHaveText(
      'S/ 28.00',
    );
    await expect(filaDelReporte(pc, 'Lo que debería haber en caja', 'Efectivo')).toHaveText(
      'S/ 344.00',
    );
  });

  afirmarClavesDelSalon(admin.escrituras, [['POST', /^\/notas-credito$/]]);
  // Un Administrador no pide clave: la nota no lleva autorización.
  expect(admin.escrituras.some((w) => /^\/autorizaciones$/.test(w.ruta))).toBe(false);
});

test('compartir por WhatsApp arma el enlace del PDF y un contexto sin sesión lo abre', async ({
  browser,
}) => {
  const { page, contexto } = cajero;
  const wa: string[] = [];
  // WhatsApp no se abre de verdad: se anota a dónde iba la pestaña.
  await contexto.route('https://wa.me/**', async (ruta) => {
    wa.push(ruta.request().url());
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'WhatsApp simulado' });
  });
  let enlace = '';
  let factura = '';

  await test.step('el Cajero abre la primera factura (aceptada, con su PDF) en Caja › Comprobantes', async () => {
    await irAlPanelDeCaja(page);
    await page
      .getByRole('link', { name: /^Factura F001-00000001, / })
      .or(page.getByRole('link', { name: 'F001-00000001', exact: true }))
      .first()
      .click();
    factura = 'F001-00000001';
    await expect(page.getByRole('heading', { name: new RegExp(factura), level: 1 })).toBeVisible();
    await expect(estadoAnteSunat(page)).toContainText('Aceptado por SUNAT');
  });

  await test.step('«Compartir por WhatsApp» con el celular del cliente: abre wa.me con el texto y el enlace', async () => {
    await page.getByRole('button', { name: 'Compartir por WhatsApp' }).click();
    await page.getByLabel('Celular del cliente').fill('987 654 321');
    await page.screenshot({ path: captura('24-compartir-whatsapp-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Comprobante › Compartir por WhatsApp');
    const [pestana] = await Promise.all([
      contexto.waitForEvent('page'),
      page.getByRole('button', { name: 'Abrir WhatsApp', exact: true }).click(),
    ]);
    await expect.poll(() => wa.length, { message: 'la pestaña fue a wa.me' }).toBeGreaterThan(0);
    await pestana.close();
    const destino = new URL(wa[0]!);
    expect(destino.origin + destino.pathname).toBe('https://wa.me/51987654321');
    const texto = destino.searchParams.get('text') ?? '';
    expect(texto).toMatch(
      new RegExp(`^Tu FACTURA ${factura} de E2E Carta \\w+ S\\.A\\.C\\. por S/ 28\\.00: http\\S+$`),
    );
    enlace = texto.slice(texto.lastIndexOf(': ') + 2);
    expect(enlace).toMatch(/^http:\/\/localhost:\d+\/publico\/comprobantes\/[A-Za-z0-9_-]{20,}$/);
    // El celular no se guarda: al volver a abrir el formulario está vacío.
    await expect(page.getByLabel('Celular del cliente')).toHaveCount(0);
    await page.getByRole('button', { name: 'Compartir por WhatsApp' }).click();
    await expect(page.getByLabel('Celular del cliente')).toHaveValue('');
  });

  await test.step('un contexto sin sesión abre el enlace: el PDF público responde', async () => {
    const anonimo = await browser.newContext();
    abiertos.push(anonimo);
    const respuesta = await anonimo.request.get(enlace);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['content-type']).toContain('application/pdf');
    expect(respuesta.headers()['cache-control']).toContain('private');
    const cuerpo = await respuesta.body();
    expect(cuerpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(cuerpo.length).toBeGreaterThan(1_000);
    // Sin sesión de ninguna clase: el contexto no trae nada de la PWA.
    const sesion = await anonimo.storageState();
    expect(sesion.cookies).toEqual([]);
    expect(sesion.origins).toEqual([]);

    // Un sello cambiado o la ruta sin sello no devuelven nada (el mismo 404 en los dos casos).
    const sello = enlace.slice(enlace.lastIndexOf('/') + 1);
    const base = enlace.slice(0, enlace.lastIndexOf('/') + 1);
    const alterado = `${base}${sello.slice(0, -2)}${sello.endsWith('AA') ? 'BB' : 'AA'}`;
    const [conSelloAlterado, sinSello] = await Promise.all([
      anonimo.request.get(alterado),
      anonimo.request.get(base),
    ]);
    expect(conSelloAlterado.status()).toBe(404);
    expect(sinSello.status()).toBe(404);
  });

  await test.step('«Compartir» sin celular elige el contacto en WhatsApp (wa.me sin número)', async () => {
    wa.length = 0;
    await page.getByLabel('Celular del cliente').fill('');
    const [pestana] = await Promise.all([
      contexto.waitForEvent('page'),
      page.getByRole('button', { name: 'Abrir WhatsApp', exact: true }).click(),
    ]);
    await expect.poll(() => wa.length).toBeGreaterThan(0);
    await pestana.close();
    const destino = new URL(wa[0]!);
    expect(destino.origin + destino.pathname).toBe('https://wa.me/');
    expect(destino.searchParams.get('text')).toContain(factura);
  });
});

test('«Emitir otro» de un reemplazo que SUNAT también rechazó: el detalle del comprobante nuevo ofrece «Emitir otro» otra vez', async ({
  request,
}) => {
  test.fixme(
    DEFECTO_EL_DETALLE_CONSERVA_LA_REEMISION_ANTERIOR,
    'El detalle del comprobante nuevo sigue mostrando la reemisión anterior (ver la constante)',
  );
  await rechazarRucEnElSimulador(request, RUC.sunat.numero, {
    codigo: '2800',
    mensaje: 'El RUC del cliente no es válido para SUNAT (simulado)',
  });
  const { page } = cajero;
  const sp = supervisor.page;
  let rechazado = '';
  let segundo = '';

  await test.step('el Cajero cobra una factura al RUC que el simulador rechaza', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.gaseosa]);
    await abrirElCobroDeLaMesa(page, '1');
    await elegirTipoDeComprobante(page, 'Factura');
    await escribirRucDeFactura(page, RUC.sunat.numero, 200);
    rechazado = (await cobrarYEsperar(page)).comprobante.numero;
    await expect(estadoAnteSunat(page)).toContainText('Rechazado: SUNAT:', { timeout: 30_000 });
  });

  await test.step('el Supervisor emite otro con los mismos datos y SUNAT lo rechaza otra vez', async () => {
    await irAlPanelDeCaja(sp);
    await abrirComprobanteDelPanel(sp, rechazado);
    await sp.getByRole('button', { name: 'Emitir otro', exact: true }).click();
    segundo = await emitirComprobanteNuevo(sp);
    await expect(estadoDelComprobanteNuevo(sp)).toContainText('Rechazado: SUNAT:', {
      timeout: 30_000,
    });
  });

  await test.step('«Ver el comprobante nuevo» abre su propio detalle: rechazado y con «Emitir otro»', async () => {
    await sp.getByRole('link', { name: 'Ver el comprobante nuevo' }).click();
    await expect(sp.getByRole('heading', { name: new RegExp(segundo), level: 1 })).toBeVisible();
    await expect(sp.getByRole('heading', { name: 'Comprobante nuevo emitido' })).toHaveCount(0);
    await expect(sp.getByRole('button', { name: 'Emitir otro', exact: true })).toBeVisible();
  });

  await test.step('«Emitir otro» corrigiendo el RUC: SUNAT acepta', async () => {
    await sp.getByRole('button', { name: 'Emitir otro', exact: true }).click();
    await escribirRucDeFactura(sp, RUC.panaderia.numero, 200);
    const tercero = await emitirComprobanteNuevo(sp);
    expect(new Set([rechazado, segundo, tercero]).size).toBe(3);
    await expect(estadoDelComprobanteNuevo(sp)).toContainText('Aceptado por SUNAT', {
      timeout: 30_000,
    });
  });
});
