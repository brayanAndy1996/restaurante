import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { leerQrPuente } from '@restaurante/contratos';
import { EmuladorEscPos, SimuladorPuente, type TicketEmulado } from '../../api/test/soporte/puente';
import { CELULAR, llamarApi, tokenDeSesion } from './ayudas';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import {
  IMPRESORAS,
  PUENTE_DESCONECTADO,
  SIN_PUENTE,
  afirmarSinAvisoDeImpresion,
  bannerDeImpresion,
  crearImpresoraDeRed,
  crearSalonPorApi,
  elegirDestinoDeEstacion,
  filaDeImpresora,
  irAImpresion,
  noResponde,
  vigilarEscriturasDeImpresion,
} from './ayudas-impresion';
import {
  CARTA,
  PRECIOS,
  abrirElComandero,
  afirmarClavesDelSalon,
  baldosaDeMesa,
  crearEscenarioDeSalon,
  elegirProducto,
  esperarLaCuenta,
  tarjetaDeCocina,
  type EscenarioDeSalon,
} from './ayudas-salon';

/**
 * Impresión de la entrega 3b (historia 004, tarea T47), de punta a punta y sin ningún mock: la API real con
 * PostgreSQL y el tiempo real encendido, un emulador de impresora ESC/POS (un servidor TCP que lee los bytes
 * del ticket, como una impresora de red) por cada impresora, y el simulador del puente (el mismo protocolo que
 * usará la app Android) que vincula con el texto del QR, pide los trabajos y los manda por TCP.
 *
 * Tres personas de la misma empresa en celulares de 360 px: el Administrador (Ajustes › Impresión), un Mozo y
 * Cocina/Barra (el KDS). Los pasos, en este orden (cada uno depende del anterior, así que corren en serie):
 *
 * 1. el Administrador crea dos impresoras de red que apuntan a los emuladores, pone Cocina en la primera y la
 *    pre-cuenta en la segunda;
 * 2. vincula el puente copiando el texto del QR al simulador;
 * 3. imprime la página de prueba y el emulador la recibe;
 * 4. el Mozo comanda: el ticket de Cocina llega al emulador en menos de 5 s y Barra sigue en el KDS;
 * 5. se apaga la impresora de Cocina: aparece «no responde» y la comanda siguiente queda en cola;
 * 6. al prenderla sale el ticket y el aviso se va;
 * 7. se detiene el puente: aparece «puente desconectado» y lo que se pide queda en cola (comanda y pre-cuenta);
 * 8. al volver el puente salen en orden: la comanda por Cocina y la pre-cuenta por la impresora de caja;
 * 9. un Mozo reimprime la comanda y el ticket lleva la marca «REIMPRESIÓN»;
 * 10. en una tableta, Ajustes › Impresión aprovecha el ancho.
 *
 * Usa el reloj real: el aviso de «puente desconectado» sale a los 60 s sin señal más la revisión periódica de la
 * API (cada 20 s) y la de la PWA (cada 15 s), así que el paso 7 dura un par de minutos. Los datos de cada corrida
 * son de una empresa nueva y las impresoras escuchan en puertos libres: se puede repetir sobre la misma base.
 * Toda escritura de la PWA lleva su clave de idempotencia: cada paso lo comprueba con lo que la PWA mandó de verdad.
 */
test.describe.configure({ mode: 'serial' });
// Un control que no está falla en segundos, no a los dos minutos del tiempo de la prueba.
test.use({ actionTimeout: 15_000 });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 820, height: 1180 },
  isMobile: false,
};

/** El Administrador copia el texto del QR con el botón: el navegador de la prueba debe dejarle leer el portapapeles. */
const CELULAR_CON_PORTAPAPELES: BrowserContextOptions = {
  ...CELULAR,
  permissions: ['clipboard-read', 'clipboard-write'],
};

/** Desde la respuesta del envío, el ticket tiene que estar en la impresora antes de esto (RNF-02). */
const PRESUPUESTO_DE_ENTREGA_MS = 5_000;

let e: EscenarioDeSalon;
let cocinaEmu: EmuladorEscPos;
let cajaEmu: EmuladorEscPos;
let simulador: SimuladorPuente | undefined;
const abiertos: BrowserContext[] = [];

interface Persona {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDeImpresion>;
}
let admin: Persona;
let mozo: Persona;
let cocina: Persona;
/** La cuenta de la mesa 1, que acompaña todo el servicio. */
let ordenId = '';
/** El primer ticket que salió por Cocina (el de la comanda del paso 4). */
let ticketOriginal: TicketEmulado;
/** La credencial del puente, para que el paso 8 lo reconecte sin pedir otro QR. */
let credencial: { api: string; token: string };

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
  await crearSalonPorApi(request, e);
  cocinaEmu = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: IMPRESORAS.cocina });
  cajaEmu = await EmuladorEscPos.iniciar({ anchoMm: 80, nombre: IMPRESORAS.caja });
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
  await simulador?.detener().catch(() => undefined);
  await Promise.all([cocinaEmu?.cerrar(), cajaEmu?.cerrar()]);
});

async function entrar(
  browser: Browser,
  persona: Parameters<typeof entrarEnCelular>[1],
  sucursal?: string,
  opciones: BrowserContextOptions = CELULAR,
): Promise<Persona> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal, opciones);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDeImpresion(page) };
}

// --- Atajos ----------------------------------------------------------------------------------------------

/** Los trabajos de impresión del día, tal como los ve la API (para comprobar lo que la pantalla dice). */
async function trabajosPorApi(
  request: Parameters<typeof llamarApi>[0],
  page: Page,
): Promise<
  {
    id: string;
    tipo: string;
    estado: string;
    impresora: { nombre: string };
    reimpresionDe: string | null;
  }[]
> {
  const r = await llamarApi<
    {
      id: string;
      tipo: string;
      estado: string;
      impresora: { nombre: string };
      reimpresionDe: string | null;
    }[]
  >(request, '/impresion/trabajos', { token: await tokenDeSesion(page) });
  expect(r.estado, 'GET de los trabajos de impresión').toBe(200);
  return r.cuerpo;
}

/** Agrega un producto de la carta al borrador y lo envía; devuelve la respuesta del `POST …/envios`. */
async function comandar(page: Page, titulo: string, productos: [nombre: string, precio: string][]) {
  await abrirElComandero(page, titulo);
  for (const [nombre, precio] of productos) {
    if (nombre === CARTA.gaseosa) {
      await page
        .getByRole('group', { name: 'Familias de la carta' })
        .getByRole('button', { name: CARTA.familias.bebidas })
        .click();
    } else {
      await page
        .getByRole('group', { name: 'Familias de la carta' })
        .getByRole('button', { name: CARTA.familias.fondos })
        .click();
    }
    const hoja = await elegirProducto(page, nombre, precio);
    await hoja.getByRole('button', { name: `Agregar · ${precio}` }).click();
    await expect(hoja).toBeHidden();
  }
  const respuesta = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /^\/ordenes\/[^/]+\/envios$/.test(new URL(r.url()).pathname),
  );
  const clicEn = Date.now();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const recibida = await respuesta;
  const enRespuesta = Date.now();
  expect(recibida.status(), 'el envío se aceptó').toBe(201);
  await esperarLaCuenta(page, titulo);
  return { en: enRespuesta, clicEn };
}

// ---------------------------------------------------------------------------------------------------------

test('el Administrador crea dos impresoras de red que apuntan a los emuladores y elige dónde sale cada cosa', async ({
  browser,
}) => {
  admin = await entrar(browser, e.administrador, e.s1.nombre, CELULAR_CON_PORTAPAPELES);
  const { page } = admin;

  await test.step('sin impresoras, Ajustes › Impresión lo dice y no hay ningún aviso', async () => {
    await irAImpresion(page);
    await expect(page.getByText('Aún no hay impresoras', { exact: true })).toBeVisible();
    await expect(page.getByText('Sin puente', { exact: true })).toBeVisible();
    await afirmarSinAvisoDeImpresion(page);
    await page.screenshot({
      path: 'e2e/resultados/impresion-1-sin-impresoras.png',
      fullPage: true,
    });
  });

  await test.step('crea la impresora de Cocina apuntando al emulador', async () => {
    await crearImpresoraDeRed(page, {
      nombre: IMPRESORAS.cocina,
      host: cocinaEmu.host,
      puerto: cocinaEmu.puerto,
    });
    await expect(filaDeImpresora(page, IMPRESORAS.cocina)).toContainText(
      `${cocinaEmu.host}:${cocinaEmu.puerto}`,
    );
  });

  await test.step('crea la impresora de la caja apuntando a otro emulador', async () => {
    await crearImpresoraDeRed(page, {
      nombre: IMPRESORAS.caja,
      host: cajaEmu.host,
      puerto: cajaEmu.puerto,
    });
    await expect(page.getByText('2 impresoras activas')).toBeVisible();
  });

  await test.step('con impresoras y sin puente, todos ven que los tickets no saldrán', async () => {
    // El estado de la impresión se vuelve a pedir cada 15 s: el aviso sale a más tardar en la siguiente vuelta.
    const aviso = bannerDeImpresion(page, SIN_PUENTE);
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    await expect(aviso).toContainText('Los tickets nuevos quedan en cola.');
  });

  await test.step('pone Cocina en su impresora; Barra sigue en la pantalla de cocina', async () => {
    await elegirDestinoDeEstacion(page, CARTA.estaciones.cocina, IMPRESORAS.cocina);
    await expect(page.getByText(`Cocina sale ahora por ${IMPRESORAS.cocina}.`)).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: CARTA.estaciones.barra, exact: true }),
    ).toHaveValue('KDS');
  });

  await test.step('elige la impresora de caja para la pre-cuenta', async () => {
    await page
      .getByRole('combobox', { name: 'Impresora de la pre-cuenta', exact: true })
      .selectOption({ label: IMPRESORAS.caja });
    await expect(page.getByText(`La pre-cuenta sale ahora por ${IMPRESORAS.caja}.`)).toBeVisible();
  });

  await test.step('a 360 px la pantalla cabe a lo ancho y sus controles miden 44 px o más', async () => {
    await page.screenshot({ path: 'e2e/resultados/impresion-2-destinos.png', fullPage: true });
    await afirmarPantallaDeCelular(page, 'Ajustes › Impresión');
  });

  afirmarClavesDelSalon(admin.escrituras, [
    ['POST', /\/impresoras$/],
    ['PUT', /\/estaciones-destino\/[^/]+$/],
    ['PUT', /\/impresion$/],
  ]);
});

test('el Administrador vincula el puente copiando el texto del QR al simulador', async () => {
  const { page } = admin;
  let textoDelQr = '';

  await test.step('«Vincular puente» muestra el QR, el texto para copiar y la cuenta regresiva', async () => {
    await page.getByRole('button', { name: 'Vincular puente' }).click();
    await expect(page.getByRole('heading', { name: 'Vincular el puente', level: 4 })).toBeVisible();
    const qr = page.getByRole('img', { name: 'Código QR para vincular el puente' });
    await expect(qr).toBeVisible();
    await expect(page.getByRole('timer')).toContainText(/^(10:00|9:5\d)$/);

    // El QR se lee a 30 cm en un celular de 360 px: ocupa buena parte del ancho y cada módulo mide varios píxeles.
    const caja = await qr.boundingBox();
    const lado = Number((await qr.getAttribute('viewBox'))?.split(' ')[2]);
    expect(caja?.width ?? 0, 'ancho del QR en px').toBeGreaterThanOrEqual(240);
    expect(caja?.width ?? 0, 'el QR cabe en el celular').toBeLessThanOrEqual(360);
    expect((caja?.width ?? 0) / lado, 'px por módulo del QR').toBeGreaterThanOrEqual(4);

    const texto = page.getByLabel('Si no puedes escanear, copia este texto');
    textoDelQr = await texto.inputValue();
    expect(textoDelQr).toMatch(/^restaurante-puente:\/\/vincular\?api=.+&t=vi\./);
    await page.screenshot({
      path: 'e2e/resultados/impresion-3-vincular-puente.png',
      fullPage: true,
    });
    await afirmarPantallaDeCelular(page, 'Ajustes › Impresión › Vincular puente');
  });

  await test.step('«Copiar texto» lo deja en el portapapeles', async () => {
    await page.getByRole('button', { name: 'Copiar texto' }).click();
    await expect(page.getByRole('button', { name: 'Texto copiado' })).toBeVisible();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado, 'el portapapeles trae el mismo texto del QR').toBe(textoDelQr);
  });

  await test.step('el simulador del puente vincula con ese texto y se conecta', async () => {
    const qr = leerQrPuente(textoDelQr);
    expect(qr, 'el texto es un QR de vinculación').not.toBeNull();
    simulador = await SimuladorPuente.iniciar({
      qr: textoDelQr,
      nombreEquipo: 'Puente de la prueba',
      modelo: 'Simulador E2E',
    });
    expect(simulador.conectado, 'el socket del espacio /puente se conectó').toBe(true);
    expect(simulador.configuracion?.impresoras.map((i) => i.nombre).sort()).toEqual(
      [IMPRESORAS.caja, IMPRESORAS.cocina].sort(),
    );
    credencial = { api: simulador.urlApi ?? '', token: simulador.token ?? '' };
    expect(credencial.token).toMatch(/^pu\./);
  });

  await test.step('la PWA se entera sola: cierra el código, dice «Puente vinculado» y el aviso se va', async () => {
    await expect(page.getByText('Puente vinculado', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vincular el puente', level: 4 })).toHaveCount(
      0,
    );
    await expect(page.locator('.puente__estado')).toContainText('Puente de la prueba');
    await expect(page.locator('.puente__estado')).toContainText('Conectado');
    await expect(page.locator('.puente__estado')).toContainText('Simulador E2E');
    await afirmarSinAvisoDeImpresion(page);
    await page.screenshot({
      path: 'e2e/resultados/impresion-4-puente-vinculado.png',
      fullPage: true,
    });
  });

  afirmarClavesDelSalon(admin.escrituras, [['POST', /\/vinculaciones-puente$/]]);
});

test('el Administrador imprime la página de prueba y el emulador la recibe', async ({
  request,
}) => {
  const { page } = admin;

  await test.step('abre la impresora y pide la página de prueba', async () => {
    await page.getByRole('button', { name: new RegExp(`^${IMPRESORAS.cocina}`) }).click();
    await expect(page.getByRole('heading', { name: IMPRESORAS.cocina, level: 3 })).toBeVisible();
    await page.getByRole('button', { name: 'Imprimir página de prueba' }).click();
    await expect(page.getByText('Página de prueba en cola', { exact: true })).toBeVisible();
    await expect(page.getByText('Sale en unos segundos', { exact: false })).toBeVisible();
    await page.screenshot({
      path: 'e2e/resultados/impresion-5-pagina-de-prueba.png',
      fullPage: true,
    });
  });

  await test.step('el emulador recibe la hoja completa, con tildes, eñe y el monto', async () => {
    const ticket = await cocinaEmu.esperarTicket(PRESUPUESTO_DE_ENTREGA_MS);
    expect(ticket.completo, 'la hoja llegó entera, hasta el corte').toBe(true);
    expect(ticket.comandosDesconocidos, 'la impresora entiende todos los comandos').toEqual([]);
    expect(ticket.texto).toContain('PÁGINA DE PRUEBA');
    expect(ticket.texto).toContain(`Impresora: ${IMPRESORAS.cocina}`);
    expect(ticket.texto).toContain('Ancho: 80 mm (48 columnas)');
    expect(ticket.texto).toContain('áéíóú ÁÉÍÓÚ ñ Ñ ü ¿¡ S/ 1,234.50');
    expect(ticket.lineas.every((l) => l.texto.length <= cocinaEmu.columnas)).toBe(true);
    await cajaEmu.noRecibe(200);
  });

  await test.step('«Trabajos de hoy» la muestra impresa', async () => {
    await page.getByRole('button', { name: 'Cancelar' }).click();
    const trabajos = page.getByRole('list', { name: 'Trabajos de hoy' });
    const fila = trabajos.getByRole('listitem').filter({ hasText: 'Página de prueba' });
    await expect(fila).toHaveCount(1);
    // La lista se vuelve a pedir cada 20 s: la hoja pasa de «Pendiente» a «Impreso» sin que nadie toque nada.
    await expect(fila).toContainText('Impreso', { timeout: 40_000 });
    expect(
      (await trabajosPorApi(request, page)).map((t) => `${t.tipo}:${t.estado}`),
      'la API la tiene impresa',
    ).toEqual(['PRUEBA:IMPRESO']);
  });

  afirmarClavesDelSalon(admin.escrituras, [['POST', /\/impresoras\/[^/]+\/prueba$/]]);
});

test('el Mozo comanda: el ticket de Cocina llega a la impresora en menos de 5 s y Barra sigue en el KDS', async ({
  browser,
  request,
}) => {
  [mozo, cocina] = [await entrar(browser, e.mozo), await entrar(browser, e.cocina)];
  await expect(mozo.page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();
  await expect(cocina.page.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();

  await test.step('el KDS dice qué estación sale por impresora y que la impresión está lista', async () => {
    await expect(
      cocina.page.getByText(`Cocina sale por la impresora ${IMPRESORAS.cocina}`),
    ).toBeVisible();
    await expect(cocina.page.locator('.cocina__impresion')).toContainText('Impresión lista');
    await afirmarSinAvisoDeImpresion(cocina.page);
    await afirmarSinAvisoDeImpresion(mozo.page);
  });

  await test.step('el Mozo abre la mesa 1', async () => {
    await baldosaDeMesa(mozo.page, '1').click();
    const hoja = mozo.page.getByRole('dialog', { name: 'Abrir mesa 1' });
    await expect(hoja).toBeVisible();
    await mozo.page.waitForTimeout(400); // la hoja termina de subir
    await hoja.getByRole('button', { name: 'Abrir mesa', exact: true }).click();
    ordenId = await esperarLaCuenta(mozo.page, 'Mesa 1');
  });

  let enRespuesta = 0;
  let clicEn = 0;
  let llegada: { ticket: TicketEmulado; en: number };
  await test.step('envía un lomo (Cocina) y una gaseosa (Barra) y mide cuánto tarda el ticket', async () => {
    const esperando = cocinaEmu
      .esperarTicket(PRESUPUESTO_DE_ENTREGA_MS * 2)
      .then((ticket) => ({ ticket, en: Date.now() }));
    ({ en: enRespuesta, clicEn } = await comandar(mozo.page, 'Mesa 1', [
      [CARTA.lomo, PRECIOS.lomo],
      [CARTA.gaseosa, PRECIOS.gaseosa],
    ]));
    llegada = await esperando;
  });

  await test.step('el ticket llega entero, en menos de 5 s desde la respuesta del envío', async () => {
    const demora = Math.max(0, llegada.en - enRespuesta);
    test
      .info()
      .annotations.push({ type: 'entrega', description: `${demora} ms hasta la impresora` });
    console.log(
      `[impresion] ticket de Cocina: ${llegada.en - enRespuesta} ms desde la respuesta del envío, ${llegada.en - clicEn} ms desde el clic`,
    );
    expect(demora, 'ms desde la respuesta del envío hasta el emulador').toBeLessThan(
      PRESUPUESTO_DE_ENTREGA_MS,
    );
    ticketOriginal = llegada.ticket;
    expect(ticketOriginal.completo).toBe(true);
    expect(ticketOriginal.comandosDesconocidos).toEqual([]);
    expect(ticketOriginal.texto).toMatch(/COCINA.*COMANDA/);
    expect(ticketOriginal.texto).toMatch(/MESA 1/i);
    expect(ticketOriginal.texto).toContain(e.mozo.nombre);
    expect(ticketOriginal.texto).toContain(CARTA.lomo);
    // La gaseosa es de Barra, que sigue en la pantalla: no sale por esta impresora.
    expect(ticketOriginal.texto).not.toContain(CARTA.gaseosa);
    expect(ticketOriginal.texto).not.toContain('REIMPRESIÓN');
    await cajaEmu.noRecibe(200);
  });

  await test.step('Barra sigue en el KDS y la comanda de Cocina ya no sale en pantalla', async () => {
    const deBarra = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra');
    await expect(deBarra).toBeVisible();
    await expect(deBarra).toContainText(CARTA.gaseosa);
    await expect(tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina')).toHaveCount(0);
    await expect(cocina.page.getByText('1 pendiente', { exact: true })).toBeVisible();
    await cocina.page.screenshot({ path: 'e2e/resultados/impresion-6-kds-barra.png' });
  });

  await test.step('la API tiene la comanda de Cocina impresa (y nada pendiente)', async () => {
    await expect
      .poll(async () =>
        (await trabajosPorApi(request, mozo.page))
          .filter((t) => t.tipo === 'COMANDA')
          .map((t) => `${t.impresora.nombre}:${t.estado}`),
      )
      .toEqual([`${IMPRESORAS.cocina}:IMPRESO`]);
  });

  afirmarClavesDelSalon(mozo.escrituras, [
    ['POST', /^\/ordenes$/],
    ['POST', /\/envios$/],
  ]);
});

test('se apaga la impresora de Cocina: aparece «no responde» y la comanda siguiente queda en cola', async ({
  request,
}) => {
  const impresosAntes = cocinaEmu.tickets.length;
  await cocinaEmu.apagar();

  await test.step('el Mozo envía un ceviche (Cocina) con la impresora apagada', async () => {
    await comandar(mozo.page, 'Mesa 1', [[CARTA.ceviche, PRECIOS.ceviche]]);
    // Según el momento, la impresora apagada aún no se ve como «no responde»: se aceptan las dos frases exactas.
    await expect(
      mozo.page.getByText(/La adición 2 se envió a cocina( y quedó en cola de impresión)?\./),
    ).toBeVisible();
  });

  await test.step('todos ven que la impresora no responde y cuántos tickets esperan', async () => {
    const aviso = bannerDeImpresion(mozo.page, noResponde(IMPRESORAS.cocina));
    await expect(aviso).toBeVisible({ timeout: 40_000 });
    await expect(aviso).toContainText('Los tickets quedan en cola (1).');
    await expect(aviso).toContainText('Revisa que esté encendida');
    await afirmarPantallaDeCelular(mozo.page, 'Cuenta con el aviso de impresión');
    await mozo.page.screenshot({ path: 'e2e/resultados/impresion-7-no-responde.png' });

    await expect(bannerDeImpresion(cocina.page, noResponde(IMPRESORAS.cocina))).toBeVisible();
    await expect(cocina.page.locator('.cocina__impresion')).toContainText(
      '1 impresora no responde',
    );
    await expect(cocina.page.locator('.cocina__impresion')).toContainText('1 en cola');
    await cocina.page.screenshot({ path: 'e2e/resultados/impresion-8-kds-no-responde.png' });
  });

  await test.step('Ajustes › Impresión la marca «No responde» y cuenta su ticket pendiente', async () => {
    const fila = filaDeImpresora(admin.page, IMPRESORAS.cocina);
    await expect(fila).toContainText('No responde', { timeout: 40_000 });
    await expect(fila).toContainText('1 pendiente');
    await expect(filaDeImpresora(admin.page, IMPRESORAS.caja)).not.toContainText('No responde');
  });

  await test.step('el ticket sigue en cola: la impresora no recibió nada', async () => {
    expect(cocinaEmu.tickets.length).toBe(impresosAntes);
    await expect
      .poll(async () =>
        (await trabajosPorApi(request, mozo.page))
          .filter((t) => t.tipo === 'ADICION')
          .map((t) => t.estado),
      )
      .toEqual(['PENDIENTE']);
  });
});

test('al prender la impresora, el ticket sale y el aviso se va', async ({ request }) => {
  await cocinaEmu.prender();

  await test.step('el simulador reintenta solo y el ticket sale completo', async () => {
    const ticket = await cocinaEmu.esperarTicket(60_000);
    expect(ticket.completo).toBe(true);
    expect(ticket.comandosDesconocidos).toEqual([]);
    expect(ticket.texto).toMatch(/COCINA.*ADICI/);
    expect(ticket.texto).toContain(CARTA.ceviche);
    expect(ticket.texto).not.toContain(CARTA.lomo);
  });

  await test.step('el aviso se va de todas las pantallas', async () => {
    await expect(bannerDeImpresion(mozo.page, noResponde(IMPRESORAS.cocina))).toHaveCount(0, {
      timeout: 40_000,
    });
    await afirmarSinAvisoDeImpresion(cocina.page);
    await expect(cocina.page.locator('.cocina__impresion')).toContainText('Impresión lista');
    await expect(filaDeImpresora(admin.page, IMPRESORAS.cocina)).toContainText('Lista', {
      timeout: 40_000,
    });
    await expect(filaDeImpresora(admin.page, IMPRESORAS.cocina)).not.toContainText('pendiente');
  });

  await test.step('la API tiene los dos tickets de Cocina impresos, cada uno una sola vez', async () => {
    await expect
      .poll(async () =>
        (await trabajosPorApi(request, mozo.page))
          .filter((t) => t.tipo === 'COMANDA' || t.tipo === 'ADICION')
          .map((t) => `${t.tipo}:${t.estado}`)
          .sort(),
      )
      .toEqual(['ADICION:IMPRESO', 'COMANDA:IMPRESO']);
    await cocinaEmu.noRecibe(300);
  });
});

test('se detiene el puente: aparece «puente desconectado» y la comanda y la pre-cuenta quedan en cola', async ({
  request,
}) => {
  // 60 s sin señal + hasta 20 s de la revisión de la API + hasta 15 s de la PWA, con margen.
  test.setTimeout(300_000);
  if (!simulador) throw new Error('El simulador del puente no está iniciado');
  const impresosPorCocina = cocinaEmu.tickets.length;
  await simulador.detener();
  const detenidoEn = Date.now();

  await test.step('con el reloj real, todos ven que el puente está desconectado', async () => {
    const aviso = bannerDeImpresion(mozo.page, PUENTE_DESCONECTADO);
    await expect(aviso).toBeVisible({ timeout: 150_000 });
    const segundos = Math.round((Date.now() - detenidoEn) / 1000);
    test
      .info()
      .annotations.push({ type: 'desconexion', description: `${segundos} s hasta el aviso` });
    console.log(`[impresion] puente desconectado: aviso a los ${segundos} s`);
    expect(segundos, 'el aviso no sale antes de los 60 s sin señal').toBeGreaterThanOrEqual(55);
    await expect(aviso).toContainText('Última señal');
    await expect(aviso).toContainText('Los tickets nuevos quedan en cola.');
    await expect(bannerDeImpresion(cocina.page, PUENTE_DESCONECTADO)).toBeVisible({
      timeout: 40_000,
    });
    await expect(cocina.page.locator('.cocina__impresion')).toContainText('puente desconectado');
    await expect(bannerDeImpresion(admin.page, PUENTE_DESCONECTADO)).toBeVisible({
      timeout: 40_000,
    });
    await expect(admin.page.locator('.puente__estado')).toContainText('Sin señal');
    await mozo.page.screenshot({ path: 'e2e/resultados/impresion-9-puente-desconectado.png' });
    await admin.page.screenshot({
      path: 'e2e/resultados/impresion-10-puente-sin-senal.png',
      fullPage: true,
    });
  });

  await test.step('el Mozo envía otro lomo y pide la pre-cuenta: los dos quedan en cola', async () => {
    await comandar(mozo.page, 'Mesa 1', [[CARTA.lomo, PRECIOS.lomo]]);
    // El puente ya se ve desconectado: el aviso agrega que el ticket quedó en cola.
    await expect(
      mozo.page.getByText('La adición 3 se envió a cocina y quedó en cola de impresión.'),
    ).toBeVisible();

    await mozo.page.getByRole('button', { name: 'Pedir pre-cuenta' }).click();
    const hoja = mozo.page.getByRole('dialog', { name: 'Pre-cuenta' });
    await expect(hoja).toBeVisible();
    await expect(hoja).toContainText('Pre-cuenta 1');
    await expect(hoja).toContainText('En cola');
    await expect(hoja).not.toContainText('Sin impresora de caja');
    await mozo.page.waitForTimeout(400); // la hoja termina de subir
    await mozo.page.screenshot({ path: 'e2e/resultados/impresion-11-precuenta-en-cola.png' });
    await hoja.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await expect(hoja).toBeHidden();
  });

  await test.step('el aviso cuenta los dos tickets que esperan', async () => {
    await expect(bannerDeImpresion(mozo.page, PUENTE_DESCONECTADO)).toContainText(
      'Los tickets quedan en cola (2).',
      { timeout: 40_000 },
    );
    expect(cocinaEmu.tickets.length, 'Cocina no recibió nada más').toBe(impresosPorCocina);
    expect(cajaEmu.tickets.length, 'la caja no recibió nada todavía').toBe(0);
    await expect
      .poll(async () =>
        (await trabajosPorApi(request, mozo.page))
          .filter((t) => t.estado === 'PENDIENTE')
          .map((t) => `${t.tipo}:${t.impresora.nombre}`)
          .sort(),
      )
      .toEqual([`ADICION:${IMPRESORAS.cocina}`, `PRECUENTA:${IMPRESORAS.caja}`]);
  });

  afirmarClavesDelSalon(mozo.escrituras, [['POST', /\/precuentas$/]]);
});

test('al volver el puente salen los tickets en orden: la comanda por Cocina y la pre-cuenta por la impresora de caja', async ({
  request,
}) => {
  const reconectado = await SimuladorPuente.iniciar({
    api: credencial.api,
    token: credencial.token,
  });
  simulador = reconectado;

  await test.step('la pre-cuenta sale por la impresora de caja', async () => {
    const ticket = await cajaEmu.esperarTicket(30_000);
    expect(ticket.completo).toBe(true);
    expect(ticket.comandosDesconocidos).toEqual([]);
    expect(ticket.texto).toMatch(/PRE-CUENTA N\.º 1/);
    expect(ticket.texto).toMatch(/MESA 1/i);
    expect(ticket.texto).toContain(CARTA.lomo);
    expect(ticket.texto).toContain(CARTA.ceviche);
    expect(ticket.texto).toContain(CARTA.gaseosa);
    expect(ticket.texto).toMatch(/TOTAL S\/ 100\.00/);
    // La pre-cuenta no desglosa impuestos: dice IGV incluido en la nota, no una línea de IGV.
    expect(ticket.texto).not.toMatch(/\bIGV\s+S\//);
  });

  await test.step('la comanda sale por Cocina, y nada más', async () => {
    const ticket = await cocinaEmu.esperarTicket(30_000);
    expect(ticket.texto).toMatch(/COCINA.*ADICI/);
    expect(ticket.texto).toContain(CARTA.lomo);
    expect(ticket.texto).not.toContain(CARTA.ceviche);
    await cocinaEmu.noRecibe(300);
    await cajaEmu.noRecibe(300);
  });

  await test.step('el simulador los imprimió en el orden en que se crearon y la API los da por impresos', async () => {
    await reconectado.esperarImpresos(2, 10_000);
    expect(reconectado.impresiones.map((i) => i.tipo)).toEqual(['ADICION', 'PRECUENTA']);
    await expect
      .poll(async () =>
        (await trabajosPorApi(request, mozo.page)).filter((t) => t.estado !== 'IMPRESO'),
      )
      .toEqual([]);
  });

  await test.step('el aviso se va de todas las pantallas', async () => {
    await expect(bannerDeImpresion(mozo.page, PUENTE_DESCONECTADO)).toHaveCount(0, {
      timeout: 40_000,
    });
    await afirmarSinAvisoDeImpresion(cocina.page);
    await afirmarSinAvisoDeImpresion(admin.page);
    await expect(cocina.page.locator('.cocina__impresion')).toContainText('Impresión lista');
    await expect(admin.page.locator('.puente__estado')).toContainText('Conectado');
  });
});

test('un Mozo reimprime una comanda y el ticket lleva la marca «REIMPRESIÓN»', async ({
  request,
}) => {
  const { page } = mozo;

  await test.step('abre «Tickets impresos» en la cuenta', async () => {
    await page.getByRole('button', { name: /^Tickets impresos/ }).click();
    const comanda = page.getByRole('region', { name: 'Tickets: Comanda' });
    await expect(comanda).toBeVisible();
    await expect(comanda).toContainText(IMPRESORAS.cocina);
    await expect(comanda).toContainText('Impreso');
    await page.screenshot({
      path: 'e2e/resultados/impresion-12-tickets-de-la-cuenta.png',
      fullPage: true,
    });
  });

  await test.step('toca «Reimprimir» en la comanda', async () => {
    const comanda = page.getByRole('region', { name: 'Tickets: Comanda' });
    await comanda
      .getByRole('button', { name: new RegExp(`^Reimprimir comanda de ${IMPRESORAS.cocina}`) })
      .click();
    await expect(page.getByText('Reimpresión en cola', { exact: true })).toBeVisible();
  });

  let reimpreso: TicketEmulado;
  await test.step('Cocina recibe la copia con la marca arriba y el mismo contenido', async () => {
    reimpreso = await cocinaEmu.esperarTicket(30_000);
    expect(reimpreso.completo).toBe(true);
    expect(reimpreso.comandosDesconocidos).toEqual([]);
    expect(reimpreso.lineas[0]?.texto, 'la marca va en la primera línea').toMatch(
      /^-+ REIMPRESIÓN -+$/,
    );
    expect(reimpreso.lineas[0]?.negrita, 'la marca va en negrita').toBe(true);
    expect(reimpreso.texto).toContain('REIMPRESIÓN');
    for (const linea of ticketOriginal.lineas.map((l) => l.texto).filter((t) => t.trim() !== '')) {
      expect(reimpreso.texto, `la copia repite «${linea}»`).toContain(linea);
    }
    await cajaEmu.noRecibe(200);
  });

  await test.step('la cuenta y la API muestran la reimpresión como un trabajo nuevo, sin tocar el original', async () => {
    await expect(
      page
        .getByRole('region', { name: 'Tickets: Comanda' })
        .getByText('Reimpresión', { exact: true }),
    ).toBeVisible({ timeout: 40_000 });
    const trabajos = await trabajosPorApi(request, page);
    const comandas = trabajos.filter((t) => t.tipo === 'COMANDA');
    expect(comandas).toHaveLength(2);
    const original = comandas.find((t) => t.reimpresionDe === null);
    const copia = comandas.find((t) => t.reimpresionDe !== null);
    expect(copia?.reimpresionDe).toBe(original?.id);
    expect(original?.estado).toBe('IMPRESO');
    await expect
      .poll(
        async () => (await trabajosPorApi(request, page)).find((t) => t.id === copia?.id)?.estado,
      )
      .toBe('IMPRESO');
  });

  afirmarClavesDelSalon(mozo.escrituras, [['POST', /\/impresion\/trabajos\/[^/]+\/reimpresion$/]]);
  expect(ordenId).toMatch(/^[0-9a-f-]{36}$/);
});

// --- Diseño: tableta ---------------------------------------------------------------------------------------

test('en una tableta, Ajustes › Impresión aprovecha el ancho con tablas', async ({ browser }) => {
  const tableta = await entrar(browser, e.administrador, e.s1.nombre, TABLETA);
  const { page } = tableta;
  await irAImpresion(page);

  await test.step('las impresoras en una tabla, con su estado en palabras', async () => {
    const tabla = page.getByRole('table', { name: 'Impresoras' });
    await expect(tabla).toBeVisible();
    for (const nombre of Object.values(IMPRESORAS)) {
      const fila = tabla.getByRole('row').filter({ hasText: nombre });
      await expect(fila).toContainText('Red');
      await expect(fila).toContainText('80 mm');
      await expect(fila).toContainText('Lista');
    }
  });

  await test.step('los trabajos de hoy en una tabla, con la reimpresión marcada', async () => {
    const tabla = page.getByRole('table', { name: 'Trabajos de hoy' });
    await expect(tabla).toBeVisible();
    await expect(tabla.getByRole('row').filter({ hasText: 'Pre-cuenta' })).toContainText('Impreso');
    await expect(tabla.getByRole('row').filter({ hasText: 'Reimpresión' })).toHaveCount(1);
    await expect(tabla.getByRole('row').filter({ hasText: 'Página de prueba' })).toHaveCount(1);
  });

  await test.step('el destino de cada estación y el puente se ven completos, sin avisos', async () => {
    await expect(
      page.getByRole('combobox', { name: CARTA.estaciones.cocina, exact: true }),
    ).toHaveValue(/.+/);
    await expect(page.locator('.puente__estado')).toContainText('Conectado');
    await afirmarSinAvisoDeImpresion(page);
    const sinDesplazamiento = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(sinDesplazamiento, 'sin desplazamiento lateral').toBe(true);
    await page.screenshot({ path: 'e2e/resultados/impresion-13-tableta.png', fullPage: true });
  });

  await tableta.contexto.close();
});
