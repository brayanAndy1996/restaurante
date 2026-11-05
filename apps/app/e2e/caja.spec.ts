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
import { CELULAR, fechaDeLima } from './ayudas';
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
  esperarPulsosDeGaveta,
  esperarTicketCon,
  irAlSalon,
  pulsosDeGaveta,
  irAAjustes,
  prepararImpresionDeCaja,
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

  await test.step('el Cajero cobra la parte 2 de 2 (S/ 33.00), con su propio correlativo, y la mesa queda libre', async () => {
    const { page } = cajero;
    await abrirElCobroDeLaMesa(page, '2');
    // La cuenta quedó en partes iguales: solo falta la última, y el cobro ya viene así.
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
