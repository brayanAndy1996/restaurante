import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { EmuladorEscPos, type SimuladorPuente } from '../../api/test/soporte/puente';
import { CELULAR, fechaDeLima, llamarApi } from './ayudas';
import {
  CARPETA_DE_CAPTURAS,
  IMPRESORA_DE_CAJA,
  PLATOS,
  abrirCajaConFondo,
  abrirElCobroDeLaMesa,
  abrirMesaYComandar,
  botonDeCobrar,
  darClaveDeSupervisor,
  cobrarYEsperar,
  elegirParteDelCobro,
  cerrarConZ,
  escribirConteo,
  esperarPulsosDeGaveta,
  irACerrarCaja,
  esperarTicketCon,
  irACaja,
  irAlSalon,
  pulsosDeGaveta,
  irAAjustes,
  prepararImpresionDeCaja,
  tokenPorApi,
  vigilarEscriturasDeCaja,
} from './ayudas-caja';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import { crearSalonPorApi } from './ayudas-impresion';
import {
  afirmarClavesDelSalon,
  afirmarEstadoDeMesa,
  baldosaDeMesa,
  crearEscenarioDeSalon,
  esperarLaCuenta,
  tarjetaDeCocina,
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

/**
 * El mismo recorrido corre en dos proyectos de Playwright (criterio 118: «viewport de celular y de tableta»): `celular`
 * (360 × 740: cada persona en su celular y el Supervisor, además, en una tableta) y `tablet` (768 × 1024: todas las
 * personas en tableta). Las capturas de la tableta llevan el prefijo `tablet-` para no pisar las del celular.
 */
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
let admin: Persona;
let cajero: Persona;
let supervisor: Persona;
let mozo: Persona;
let cocina: Persona;
/** El ticket del primer comprobante, tal como lo decodifica el emulador. */
let texto = '';

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
    // En celular la lista son filas con etiquetas («Boletas B001»); en tableta, una tabla con una columna por serie.
    const fila = enTableta()
      ? page.getByRole('row', { name: /^Caja 1/ })
      : page.getByRole('button', { name: /^Caja 1/ });
    await expect(fila).toContainText(enTableta() ? 'B001' : 'Boletas B001');
    await expect(fila).toContainText(enTableta() ? 'F001' : 'Facturas F001');
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

test('el Mozo abre la mesa 1 y comanda; el Cajero cobra con efectivo (con vuelto) y Yape y la mesa queda libre', async ({
  browser,
}) => {
  [mozo, cocina] = [await entrar(browser, e.mozo), await entrar(browser, e.cocina)];

  await test.step('el Mozo abre la mesa 1 y comanda dos lomos y una gaseosa (S/ 62.00); Cocina recibe la comanda', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.lomo, PLATOS.lomo, PLATOS.gaseosa]);
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina')).toBeVisible();
  });

  const { page } = cajero;
  await test.step('el Cajero ve la mesa 1 en «Por cobrar» y abre su cobro', async () => {
    await abrirElCobroDeLaMesa(page, '1');
    await expect(botonDeCobrar(page)).toHaveText('Cobrar S/\u00a062.00');
  });

  await test.step('paga S/ 20.00 con Yape y el resto en efectivo con S/ 50.00', async () => {
    await page.getByRole('button', { name: 'Agregar otro pago' }).click();
    await page.getByLabel('Monto del pago 2').fill('20');
    await page.getByLabel('Número de operación').fill('YAPE-0001');
    await page.getByRole('textbox', { name: 'Recibido' }).fill('50');
    await expect(page.getByText('Vuelto').first()).toBeVisible();
    await page.screenshot({ path: captura('03-cobro-dos-medios-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cobro con dos medios');
    emulador.limpiar();
    const respuesta = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /^\/cuentas\/[^/]+\/cobros$/.test(new URL(r.url()).pathname),
    );
    await botonDeCobrar(page).click();
    const cobro = await respuesta;
    expect(cobro.status(), 'el cobro se aceptó').toBe(201);
    expect(cobro.request().headers()['idempotency-key']).toMatch(/\S/);
    const cuerpo = (await cobro.json()) as { impresion: string; vuelto: string };
    expect(cuerpo.impresion).toBe('EN_COLA');
    expect(cuerpo.vuelto).toBe('8.00');
  });

  await test.step('el resultado dice el comprobante, el vuelto, que imprime en la caja y que la mesa quedó libre', async () => {
    await expect(page.getByText('Boleta · B001-00000001')).toBeVisible();
    await expect(page.getByText('Vuelto', { exact: true })).toBeVisible();
    await expect(page.locator('.resultado__vuelto')).toContainText('S/ 8.00');
    await expect(page.getByText(`Imprimiendo en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
    await expect(page.getByText('Mesa 1 libre')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Imprimir otra vez' })).toBeEnabled();
    await page.screenshot({ path: captura('04-resultado-imprimiendo-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado del cobro');
  });

  await test.step('el ticket del comprobante llega al emulador con el QR y el pulso de la gaveta', async () => {
    const ticket = await emulador.esperarTicket(10_000);
    expect(ticket.texto).toContain('BOLETA DE VENTA ELECTRÓNICA');
    expect(ticket.texto).toContain('B001-00000001');
    expect(ticket.texto).toContain('Lomo saltado');
    expect(ticket.texto).toContain('Yape');
    expect(ticket.texto).toContain('Vuelto');
    expect(ticket.texto).not.toContain('REIMPRESIÓN');
    expect(ticket.qrs).toHaveLength(1);
    expect(ticket.qrs[0]).toContain('|03|B001|00000001|');
    expect(ticket.pulsosGaveta).toBe(1);
    expect(ticket.corte).not.toBeNull();
    texto = ticket.texto;
    // El ticket tal como lo decodifica el emulador, para revisarlo a ojo.
    writeFileSync(`${CARPETA_DE_CAPTURAS}/06-ticket-del-comprobante.txt`, `${ticket.marcado}\n`);
  });

  await test.step('la mesa queda libre para el Mozo y la comanda sigue en Cocina', async () => {
    await irAlSalon(mozo.page);
    await afirmarEstadoDeMesa(mozo.page, '1', 'libre');
  });

  await test.step('«Imprimir otra vez» saca una copia con la marca REIMPRESIÓN y sin abrir la gaveta', async () => {
    await page.getByRole('button', { name: 'Imprimir otra vez' }).click();
    await expect(page.getByText(`Imprimiendo otra copia en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
    const copia = await emulador.esperarTicket(10_000);
    expect(copia.texto).toContain('REIMPRESIÓN');
    expect(copia.texto).toContain('B001-00000001');
    expect(copia.pulsosGaveta).toBe(0);
    expect(copia.qrs).toHaveLength(1);
    await page.screenshot({ path: captura('05-reimpresion-360'), fullPage: true });
  });

  afirmarClavesDelSalon(cajero.escrituras, [
    ['POST', /\/cuentas\/[^/]+\/cobros$/],
    ['POST', /\/comprobantes\/[^/]+\/impresiones$/],
  ]);
  void texto;
});

test('la cuenta de la mesa 2 se divide por ítems con el Cajero y en partes iguales entre el Supervisor y el Cajero', async () => {
  await test.step('el Mozo abre la mesa 2 y comanda dos cevices y un lomo (S/ 104.00)', async () => {
    await abrirMesaYComandar(mozo.page, '2', [PLATOS.ceviche, PLATOS.ceviche, PLATOS.lomo]);
  });

  await test.step('el Cajero cobra un ceviche por ítems (S/ 38.00) y falta cobrar S/ 66.00', async () => {
    const { page } = cajero;
    await abrirElCobroDeLaMesa(page, '2');
    await elegirParteDelCobro(page, 'Por ítems');
    await page.getByRole('button', { name: 'Agregar una unidad de Ceviche mixto' }).first().click();
    await expect(botonDeCobrar(page)).toHaveText('Cobrar S/\u00a038.00');
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toBe('B001-00000002');
    expect(cobro.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '66.00' });
    await expect(page.getByText('Boleta · B001-00000002')).toBeVisible();
    await expect(page.getByText('Falta cobrar S/ 66.00')).toBeVisible();
    await expect(page.getByText('Mesa 2 libre')).toHaveCount(0);
    await page.screenshot({ path: captura('07-cobro-por-items-falta-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado del cobro por ítems');
  });

  await test.step('el Supervisor cobra la parte 1 de 2 de lo que falta (S/ 33.00) en su caja, en la tableta', async () => {
    const { page } = supervisor;
    await abrirElCobroDeLaMesa(page, '2');
    await elegirParteDelCobro(page, 'Partes iguales');
    await expect(page.getByText('Cada parte es de S/ 33.00')).toBeVisible();
    await expect(botonDeCobrar(page)).toHaveText('Cobrar la parte 1 de 2 · S/\u00a033.00');
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toBe('B002-00000001');
    expect(cobro.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '33.00' });
    await expect(page.getByText('Parte 1 de 2 de Mesa 2.')).toBeVisible();
    await page.screenshot({ path: captura('08-parte-igual-768'), fullPage: true });
  });

  await test.step('el Supervisor recarga la pantalla: el equipo recuerda las 2 partes y propone la que falta, no el saldo entero', async () => {
    const { page } = supervisor;
    await page.reload();
    await expect(page.getByText('Parte 1 de 2')).toBeVisible();
    await expect(page.getByText('Pagada · B002-00000001')).toBeVisible();
    await expect(botonDeCobrar(page)).toHaveText('Cobrar la parte 2 de 2 · S/\u00a033.00');
    await expect(page.getByText('Ya se cobró 1 parte igual de esta cuenta')).toHaveCount(0);
    await page.screenshot({ path: captura('08b-parte-igual-recargada-768'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cobro en partes iguales tras recargar');
  });

  await test.step('el Cajero cobra la parte 2 de 2 (S/ 33.00), con su propio correlativo, y la mesa queda libre', async () => {
    const { page } = cajero;
    await abrirElCobroDeLaMesa(page, '2');
    // La cuenta quedó en partes iguales, pero este equipo no sabe en cuántas se dividió: lo dice y pide confirmarlo antes
    // de cobrar (no propone el saldo entero).
    await expect(page.getByText('Ya se cobró 1 parte igual de esta cuenta')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cobrar', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Cobrar la parte/ })).toHaveCount(0);
    await page.screenshot({ path: captura('08c-parte-igual-otro-equipo-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Confirmar en cuántas partes se dividió');
    await page.getByRole('button', { name: 'Quitar uno de partes en total' }).click();
    await page.getByRole('button', { name: 'Se dividió en 2 partes' }).click();
    await expect(page.getByText('Esta es la última parte: S/ 33.00')).toBeVisible();
    await expect(botonDeCobrar(page)).toHaveText('Cobrar la parte 2 de 2 · S/\u00a033.00');
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toBe('B001-00000003');
    expect(cobro.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
    await expect(page.getByText('Mesa 2 libre')).toBeVisible();
    await irAlSalon(mozo.page);
    await afirmarEstadoDeMesa(mozo.page, '2', 'libre');
  });
});

test('el Cajero aplica un descuento por ítem con la clave del Supervisor y cobra con el descuento', async () => {
  const { page } = cajero;
  await abrirMesaYComandar(mozo.page, '3', [PLATOS.lomo]);

  await test.step('el Cajero abre la cuenta de la mesa 3 y elige «Descuento a Lomo saltado»', async () => {
    await irAlSalon(page);
    // El mapa se actualiza en vivo: si todavía la ve libre, tocarla abriría otra cuenta.
    await afirmarEstadoDeMesa(page, '3', 'ocupada');
    await baldosaDeMesa(page, '3').click();
    await esperarLaCuenta(page, 'Mesa 3');
    await page.getByRole('link', { name: 'Descuentos y cortesías' }).click();
    await page.getByRole('button', { name: 'Descuento a Lomo saltado' }).click();
    const hoja = page.getByRole('dialog', { name: 'Descuento' });
    await hoja.getByLabel('Porcentaje del descuento').fill('10');
    await hoja.getByRole('button', { name: 'Cliente frecuente' }).click();
    await page.waitForTimeout(400); // la hoja termina de subir
    await page.screenshot({ path: captura('09-descuento-hoja-360') });
    await hoja.getByRole('button', { name: 'Pedir clave de supervisor' }).click();
  });

  await test.step('la ventana pide la clave de un Supervisor; con la suya el descuento queda aplicado', async () => {
    await darClaveDeSupervisor(page, e.supervisor.pin);
    await expect(page.getByText(/2\.80 · Cliente frecuente/)).toBeVisible();
    const desglose = page.getByLabel('Desglose de la cuenta');
    await expect(desglose).toContainText('S/ 25.20');
    await page.screenshot({ path: captura('10-descuento-aplicado-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cuenta con descuento');
  });

  await test.step('cobra S/ 25.20 en efectivo; la boleta sale con el descuento', async () => {
    await page.getByRole('link', { name: /^Cobrar S\/\s?25\.20$/ }).click();
    await expect(botonDeCobrar(page)).toHaveText('Cobrar S/\u00a025.20');
    const cobro = await cobrarYEsperar(page);
    expect(cobro.comprobante.numero).toBe('B001-00000004');
    await expect(page.getByText('Mesa 3 libre')).toBeVisible();
    const ticket = await esperarTicketCon(emulador, 'B001-00000004');
    expect(ticket.texto).toMatch(/Descuento/i);
  });
});

test('la venta de mostrador se cobra y manda el pedido a Cocina con su «Llamado N» en el KDS', async () => {
  const { page } = cajero;
  await irACaja(page);
  await page.getByRole('link', { name: /Vender en el mostrador/ }).click();
  await expect(page.getByRole('heading', { name: 'Mostrador', level: 1 })).toBeVisible();

  await test.step('arma la venta con un ceviche y la revisa', async () => {
    await page.getByRole('button', { name: /^Ceviche mixto/ }).click();
    const hoja = page.getByRole('dialog', { name: 'Ceviche mixto' });
    await hoja.getByRole('button', { name: /^Agregar( ·|$)/ }).click();
    await expect(hoja).toBeHidden();
    // En tableta la carta y la venta se ven juntas: no hay que pasar a la venta.
    if (!enTableta()) await page.getByRole('button', { name: /^Revisar la venta/ }).click();
    await expect(page.getByRole('heading', { name: 'La venta' })).toBeVisible();
    // La caja dice qué comprobantes emite su emisor (régimen general: boleta y factura).
    const tipos = page.getByRole('group', { name: 'Tipo de comprobante' });
    await expect(tipos.getByRole('button', { name: 'Boleta' })).toBeVisible();
    await expect(tipos.getByRole('button', { name: 'Factura' })).toBeVisible();
  });

  await test.step('cobra y enviar: sale el «Llamado 1» en grande, con su comprobante', async () => {
    const respuesta = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/ventas-mostrador',
    );
    await page.getByRole('button', { name: /^Cobrar y enviar/ }).click();
    const venta = await respuesta;
    expect(venta.status(), 'la venta se aceptó').toBe(201);
    expect(venta.request().headers()['idempotency-key']).toMatch(/\S/);
    await expect(page.locator('.resultado__llamado')).toHaveText('Llamado 1');
    await expect(page.getByText('Boleta · B001-00000005')).toBeVisible();
    await expect(page.getByText(`Imprimiendo en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
    await page.screenshot({ path: captura('11-mostrador-llamado-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado de la venta de mostrador');
  });

  await test.step('Cocina ve la comanda con el «Llamado 1» y no hay mesa que liberar', async () => {
    const tarjeta = tarjetaDeCocina(cocina.page, 'Comanda', 'Llamado 1', 'Cocina');
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toContainText('Ceviche mixto');
    await cocina.page.screenshot({ path: captura('12-kds-llamado-360') });
  });

  afirmarClavesDelSalon(cajero.escrituras, [['POST', /^\/ventas-mostrador$/]]);
});

test('el Cajero imprime el reporte X', async () => {
  const { page } = cajero;
  await irACaja(page);
  await page.getByRole('button', { name: 'Reporte X', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ventas' })).toBeVisible();
  await page.screenshot({ path: captura('13-reporte-x-imprimir-360'), fullPage: true });
  await afirmarPantallaDeCelular(page, 'Caja › Reporte X');

  emulador.limpiar();
  const respuesta = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && /\/turnos\/[^/]+\/reporte-x\/impresiones$/.test(r.url()),
  );
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
  const impresion = await respuesta;
  expect(impresion.status()).toBe(201);
  expect(impresion.request().headers()['idempotency-key']).toMatch(/\S/);
  await expect(page.getByText(`Imprimiendo el reporte X en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
  await page.screenshot({ path: captura('14-reporte-x-imprimiendo-360'), fullPage: true });

  const ticket = await esperarTicketCon(emulador, 'REPORTE X');
  expect(ticket.texto).toContain('Caja 1');
  expect(ticket.texto).toContain('ESPERADO EN CAJA');
  expect(ticket.texto).toContain('376.20');
  expect(ticket.texto).toContain('Reporte parcial');
  expect(ticket.pulsosGaveta).toBe(0);
  writeFileSync(`${CARPETA_DE_CAPTURAS}/15-ticket-reporte-x.txt`, `${ticket.marcado}\n`);

  // En la tableta del Supervisor el reporte X y su «Imprimir» aprovechan el ancho.
  const tableta = supervisor.page;
  await irACaja(tableta);
  await tableta.getByRole('button', { name: 'Reporte X', exact: true }).click();
  await expect(tableta.getByRole('heading', { name: 'Ventas' })).toBeVisible();
  await expect(tableta.getByRole('button', { name: 'Imprimir', exact: true })).toBeVisible();
  await tableta.screenshot({ path: captura('13-reporte-x-imprimir-768'), fullPage: true });
});

test('el Cajero cierra a ciegas con una diferencia y su motivo y la Z sale impresa; el Supervisor, última caja, no puede cerrar con una mesa abierta', async () => {
  const { page } = cajero;

  await test.step('el Mozo abre la mesa 1 otra vez y comanda un lomo (S/ 28.00); queda abierta', async () => {
    await abrirMesaYComandar(mozo.page, '1', [PLATOS.lomo]);
  });

  await test.step('el Cajero cuenta a ciegas: la pantalla no dice cuánto debería haber', async () => {
    emulador.limpiar();
    await irACerrarCaja(page);
    await expect(page.getByText('Esperado')).toHaveCount(0);
    await escribirConteo(page, {
      Efectivo: '375',
      'Tarjeta de crédito': '0',
      'Tarjeta de débito': '0',
      Yape: '20',
      Plin: '0',
    });
    await page.screenshot({ path: captura('16-cierre-a-ciegas-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cerrar caja (conteo a ciegas)');
  });

  await test.step('faltan S/ 1.20 de efectivo: sin motivo no cierra y solo dice «No cuadra»; con el motivo cierra', async () => {
    const primero = await cerrarConZ(page);
    expect(primero.status(), 'sin motivo, la API pide el de la diferencia').toBe(422);
    await expect(page.getByText('No cuadra', { exact: true })).toBeVisible();
    // La diferencia exacta se ve recién en la Z cerrada: ahora no hay ningún monto de más o de menos.
    await expect(page.getByText(/Faltan S\/|Sobran S\/|Esperado/)).toHaveCount(0);
    await page
      .getByRole('textbox', { name: 'Motivo de la diferencia en efectivo' })
      .fill('Un vuelto mal dado');
    await page.screenshot({ path: captura('17-cierre-con-diferencia-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Cierre con diferencia');
    const cierre = await cerrarConZ(page);
    expect(cierre.status()).toBe(200);
    expect(cierre.request().headers()['idempotency-key']).toMatch(/\S/);
  });

  await test.step('la Z queda en pantalla con el conteo, la diferencia y su motivo, e imprimiéndose', async () => {
    await expect(page.getByText('Caja 1 cerrada')).toBeVisible();
    await expect(page.getByText('Motivo: Un vuelto mal dado')).toBeVisible();
    await expect(page.getByText('Faltan S/ 1.20')).toBeVisible();
    await expect(page.getByText(`Imprimiendo el reporte Z en ${IMPRESORA_DE_CAJA}`)).toBeVisible();
    await page.screenshot({ path: captura('18-reporte-z-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Reporte Z');
  });

  await test.step('el emulador recibe la Z con el conteo y el motivo de la diferencia', async () => {
    const ticket = await esperarTicketCon(emulador, 'REPORTE Z');
    expect(ticket.texto).toContain('375.00');
    expect(ticket.texto).toContain('Un vuelto mal dado');
    expect(ticket.pulsosGaveta).toBe(0);
    writeFileSync(`${CARPETA_DE_CAPTURAS}/19-ticket-reporte-z.txt`, `${ticket.marcado}\n`);
  });

  await test.step('«Listo» lleva a abrir otra caja', async () => {
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Caja que vas a abrir' })).toBeVisible();
  });

  await test.step('el Supervisor es la última caja abierta: «Cerrar con Z» se bloquea con la mesa 1 abierta', async () => {
    const { page: tableta } = supervisor;
    await irACerrarCaja(tableta);
    await escribirConteo(tableta, {
      Efectivo: '133',
      'Tarjeta de crédito': '0',
      'Tarjeta de débito': '0',
      Yape: '0',
      Plin: '0',
    });
    const cierre = await cerrarConZ(tableta);
    expect(cierre.status()).toBe(409);
    await expect(tableta.getByText('Queda 1 cuenta abierta')).toBeVisible();
    await expect(tableta.getByRole('list', { name: 'Cuentas abiertas' })).toContainText('Mesa 1');
    await tableta.screenshot({ path: captura('20-cierre-bloqueado-768'), fullPage: true });
  });

  await test.step('cobra la mesa 1 en su caja (S/ 28.00) y cierra: efectivo S/ 161.00, cuadra', async () => {
    const { page: tableta } = supervisor;
    await abrirElCobroDeLaMesa(tableta, '1');
    const cobro = await cobrarYEsperar(tableta);
    expect(cobro.comprobante.numero).toBe('B002-00000002');
    await expect(tableta.getByText('Mesa 1 libre')).toBeVisible();
    await irACerrarCaja(tableta);
    await escribirConteo(tableta, {
      Efectivo: '161',
      'Tarjeta de crédito': '0',
      'Tarjeta de débito': '0',
      Yape: '0',
      Plin: '0',
    });
    const cierre = await cerrarConZ(tableta);
    expect(cierre.status()).toBe(200);
    await expect(tableta.getByText('Caja 2 cerrada')).toBeVisible();
    await expect(tableta.getByText('Cuadra').first()).toBeVisible();
    await tableta.screenshot({ path: captura('21-reporte-z-768'), fullPage: true });
  });

  afirmarClavesDelSalon(cajero.escrituras, [['POST', /\/turnos\/[^/]+\/cierre$/]]);
});

test('sin impresora de caja el cobro y la apertura se hacen igual y la pantalla lo dice', async ({
  request,
}) => {
  await test.step('el Administrador quita la impresora de la caja de la sucursal', async () => {
    const token = await tokenPorApi(request, e.administrador);
    const r = await llamarApi(request, `/sucursales/${e.s1.id}/impresion`, {
      metodo: 'PUT',
      token,
      cuerpo: { impresoraCajaId: null },
    });
    expect(r.estado).toBe(200);
    await llamarApi(request, '/sesion', { metodo: 'DELETE', token });
  });

  const { page } = cajero;
  await test.step('el Cajero abre Caja 1 con fondo: la caja abre y dice «Sin impresora de caja»', async () => {
    const turno = await abrirCajaConFondo(page, 'Caja 1', '50');
    expect(turno.impresion).toBe('SIN_IMPRESORA');
    expect(turno.trabajoId ?? null).toBeNull();
    await expect(page.getByText('Sin impresora de caja')).toBeVisible();
    await expect(
      page.getByText('El Administrador puede elegirla en Ajustes › Cajas.'),
    ).toBeVisible();
    await page.screenshot({ path: captura('22-apertura-sin-impresora-360'), fullPage: true });
  });

  await test.step('cobra una mesa: el cobro sale igual, sin ticket, y el resultado dice «Sin impresora de caja»', async () => {
    await abrirMesaYComandar(mozo.page, '3', [PLATOS.gaseosa]);
    await abrirElCobroDeLaMesa(page, '3');
    emulador.limpiar();
    const cobro = await cobrarYEsperar(page);
    expect(cobro.impresion).toBe('SIN_IMPRESORA');
    await expect(page.getByText('Mesa 3 libre')).toBeVisible();
    await expect(page.getByText('Sin impresora de caja')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Imprimir otra vez' })).toBeEnabled();
    await page.screenshot({ path: captura('23-resultado-sin-impresora-360'), fullPage: true });
    await afirmarPantallaDeCelular(page, 'Caja › Resultado sin impresora');
    await emulador.noRecibe(500);
  });

  await test.step('«Imprimir otra vez» sin impresora lo dice en palabras', async () => {
    await page.getByRole('button', { name: 'Imprimir otra vez' }).click();
    await expect(page.getByText('No pudimos imprimir otra vez')).toBeVisible();
    await expect(page.getByText(/Esta caja no tiene impresora/)).toBeVisible();
  });

  await test.step('en la tableta del Supervisor pasa lo mismo: abre su caja y cobra sin impresora', async () => {
    const { page: tableta } = supervisor;
    await irACaja(tableta);
    await tableta
      .getByRole('button', { name: 'Listo', exact: true })
      .click()
      .catch(() => undefined);
    const turno = await abrirCajaConFondo(tableta, 'Caja 2', '20');
    expect(turno.impresion).toBe('SIN_IMPRESORA');
    await expect(tableta.getByText('Sin impresora de caja')).toBeVisible();
    await abrirMesaYComandar(mozo.page, '2', [PLATOS.gaseosa]);
    await abrirElCobroDeLaMesa(tableta, '2');
    const cobro = await cobrarYEsperar(tableta);
    expect(cobro.impresion).toBe('SIN_IMPRESORA');
    await expect(tableta.getByText('Sin impresora de caja')).toBeVisible();
    await tableta.screenshot({ path: captura('23-resultado-sin-impresora-768'), fullPage: true });
  });
});
