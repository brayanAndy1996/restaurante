import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import type { CartaPublica, EstadoLlamadoPublico, QrMesasRespuesta } from '@restaurante/contratos';
import { CELULAR, llamarApi, type Persona } from '../../app/e2e/ayudas';
import { entrarEnCelular } from '../../app/e2e/ayudas-carta';
import { bannerDeLlamado, vigilarEscriturasDeLlamados } from '../../app/e2e/ayudas-llamados';
import {
  CARTA,
  afirmarClavesDelSalon,
  crearEscenarioDeSalon,
  cuentaPorApi,
  destino,
  esperarLaCuenta,
  tarjetaDeCocina,
  type EscenarioDeSalon,
} from '../../app/e2e/ayudas-salon';
import {
  KB,
  esperarDescargas,
  revisarAccesibilidad,
  suma,
  sumaCuerpos,
  vigilarDescargas,
} from './ayudas-web';

/**
 * El modo mesa de punta a punta (historia 005, 5b, tarea T25, criterio 92), contra la API real y PostgreSQL, con la
 * PWA del personal y la carta web servidas de verdad y sin ningún mock. Dos personas a la vez, cada una en su propio
 * navegador de 360 × 740: el **cliente** en `apps/web` (la carta web, sentado en la mesa 1) y el **Mozo** en
 * `apps/app` (la PWA); además Cocina/Barra, que agota un plato y mira el KDS.
 *
 * Los pasos, en este orden (cada uno depende del anterior, así que corren en serie):
 *
 * 1. el Administrador publica la carta de S1 y crea la mesa 1; de la hoja de QR sale el código de la mesa;
 * 2. el cliente escanea (abre `/m/<código>`) y ve la carta con lo disponible; Cocina/Barra agota un plato desde la
 *    PWA y desaparece de la carta del cliente, sin recargar, con el combo que lo lleva;
 * 3. el cliente arma un pedido y lo envía; la primera respuesta se pierde en el camino (el servidor recibió el
 *    pedido, el cliente no lo supo): reintenta con el mismo `id` y el Mozo ve un solo aviso;
 * 4. el Mozo lo atiende (abre la mesa) y el cliente lo ve; el Mozo lo pasa a la cuenta y el cliente ve que el mozo
 *    tomó su pedido; el KDS no recibe nada hasta que el Mozo pulsa «Enviar»;
 * 5. el cliente pide la cuenta; el Mozo la atiende y el cliente lo ve;
 * 6. la primera vista de la carta a 360 × 740 pesa lo que debe (criterio 88) y axe no encuentra fallas graves
 *    (criterio 90) en la carta real.
 *
 * Los datos de cada corrida son de una empresa nueva: se puede repetir sobre la misma base. Se vigila que el cliente
 * mande cada envío con su `id` y que la PWA mande sus escrituras con clave de idempotencia.
 */
test.describe.configure({ mode: 'serial' });
// Un control que no está falla en segundos, no a los tres minutos del tiempo de la prueba.
test.use({ actionTimeout: 15_000 });

test.skip(!process.env.E2E_API_URL, 'Necesita la API real y PostgreSQL (E2E_API_URL)');

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

/** El celular del cliente: el suyo propio, con la carta web (no la PWA del personal). */
const CELULAR_DEL_CLIENTE: BrowserContextOptions = { ...CELULAR, baseURL: WEB };

let e: EscenarioDeSalon;
const abiertos: BrowserContext[] = [];
let codigoMesa = '';
let empresaSlug = '';

interface Equipo {
  contexto: BrowserContext;
  page: Page;
  /** Las escrituras de llamados, cuentas y cocina que hace la PWA de esa persona, con su clave de idempotencia. */
  escrituras: ReturnType<typeof vigilarEscriturasDeLlamados>;
}
let mozo: Equipo;
let cocina: Equipo;
let cliente: { contexto: BrowserContext; page: Page };
/** Los envíos de llamados que el cliente mandó a la API, con su `id`. */
const enviosDelCliente: { id: string; tipo: string }[] = [];

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
});

async function entrar(browser: Browser, persona: Persona, sucursal?: string): Promise<Equipo> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDeLlamados(page) };
}

const captura = (page: Page, nombre: string) =>
  page.screenshot({ path: `e2e/resultados/punta-a-punta-${nombre}.png` });

/** El Mozo toca «Ver» en el aviso de un llamado y queda en su detalle. */
async function verElAviso(page: Page, texto: string) {
  await bannerDeLlamado(page, texto).getByRole('link', { name: 'Ver' }).click();
  await expect(page.getByRole('heading', { name: 'Mesa 1', level: 1 })).toBeVisible();
}

/** Agrega a «Tu pedido» un producto de la carta web, con la cantidad que se pide. */
async function agregarAlPedido(
  page: Page,
  nombre: string,
  precio: number,
  { cantidad = 1, indicaciones }: { cantidad?: number; indicaciones?: string } = {},
) {
  await page.getByRole('button', { name: new RegExp(`^${nombre}, ${precio} soles`) }).click();
  const hoja = page.getByRole('dialog', { name: nombre });
  await expect(hoja).toBeVisible();
  for (let i = 1; i < cantidad; i += 1) {
    await hoja.getByRole('button', { name: 'Agregar uno' }).click();
  }
  if (indicaciones) await hoja.getByLabel(/Indicaciones/).fill(indicaciones);
  await hoja.getByRole('button', { name: /Agregar al pedido/ }).click();
  await expect(hoja).toBeHidden();
}

test('el Administrador publica la carta de S1, crea la mesa 1 y de la hoja de QR sale su código', async ({
  browser,
}) => {
  const sufijo = e.administrador.usuario.split('.').pop() ?? 'x';
  empresaSlug = `mesa-web-${sufijo}`;
  const { page, contexto } = await entrarEnCelular(browser, e.administrador, e.s1.nombre);
  abiertos.push(contexto);

  await test.step('configura la carta web y publica S1', async () => {
    await destino(page, 'Ajustes').click();
    await page.getByRole('button', { name: 'Carta web' }).click();
    await page.getByLabel('Nombre que ven tus clientes').fill('Cevichería de la Mesa Web');
    await page.getByLabel('Dirección de tu carta').fill(empresaSlug);
    await page.getByLabel(`Dirección de ${e.s1.nombre}`).fill('miraflores');
    await page.getByRole('switch', { name: `Publicada: ${e.s1.nombre}` }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Cambios guardados. Tu carta ya tiene estos datos.')).toBeVisible();
  });

  await test.step('crea la zona y la mesa 1 (para 4 personas)', async () => {
    await page.getByRole('button', { name: 'Mapa de mesas' }).click();
    await page.getByRole('button', { name: 'Agregar zona' }).click();
    await page.getByLabel('Nombre de la zona').fill('Salón principal');
    await page.getByLabel('Columnas').fill('3');
    await page.getByLabel('Filas').fill('2');
    await page.getByRole('button', { name: 'Crear zona', exact: true }).click();
    await expect(page.getByText('Zona Salón principal creada.')).toBeVisible();
    await page.getByRole('button', { name: 'Agregar mesa' }).click();
    await expect(page.getByLabel('Nombre de la mesa')).toHaveValue('1');
    await page.getByLabel('Capacidad (personas)').fill('4');
    await page.getByRole('button', { name: 'Crear mesa' }).click();
    await expect(page.getByText('Mesa 1 creada.')).toBeVisible();
  });

  await test.step('la hoja de QR trae el código de la mesa, y el QR apunta a la carta web', async () => {
    const lista = page.waitForResponse(
      (r) =>
        /\/sucursales\/[^/]+\/qr-mesas$/.test(new URL(r.url()).pathname) &&
        r.request().method() === 'GET',
    );
    await page.getByRole('link', { name: 'QR de las mesas' }).click();
    const qr = (await (await lista).json()) as QrMesasRespuesta;
    expect(qr.cartaPublicada).toBe(true);
    const mesa = qr.mesas.find((m) => m.nombre === '1');
    expect(mesa?.codigo).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // La API arma la dirección del QR con `CARTA_WEB_URL`: la misma carta web que se prueba aquí.
    expect(mesa?.url).toBe(`${WEB}/m/${mesa?.codigo}`);
    codigoMesa = mesa!.codigo!;
  });
});

test('el cliente escanea su mesa y ve la carta; Cocina agota un plato desde la PWA y desaparece de su pantalla, sin recargar', async ({
  browser,
}) => {
  cocina = await entrar(browser, e.cocina);
  mozo = await entrar(browser, e.mozo);
  const contexto = await browser.newContext(CELULAR_DEL_CLIENTE);
  abiertos.push(contexto);
  const page = await contexto.newPage();
  cliente = { contexto, page };
  // Cada llamado que el cliente manda a la API, con el `id` que generó su navegador.
  page.on('request', (peticion) => {
    if (peticion.method() === 'POST' && /\/publico\/mesas\/[^/]+\/llamados$/.test(peticion.url())) {
      const cuerpo = peticion.postDataJSON() as { id: string; tipo: string };
      enviosDelCliente.push({ id: cuerpo.id, tipo: cuerpo.tipo });
    }
  });

  await test.step('escanea: abre /m/<código> y ve la carta de S1 con lo disponible', async () => {
    const respuesta = await page.goto(`/m/${codigoMesa}`);
    expect(respuesta?.status()).toBe(200);
    // El código no sale en el Referer, no se guarda y no se indexa (criterio 80).
    expect(respuesta?.headers()['referrer-policy']).toBe('no-referrer');
    expect(respuesta?.headers()['cache-control']).toBe('private, no-store');
    expect(respuesta?.headers()['x-robots-tag']).toBe('noindex');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Cevichería de la Mesa Web' }),
    ).toBeVisible();
    await expect(page.getByText('Mesa 1', { exact: true })).toBeVisible();
    for (const nombre of [CARTA.lomo, CARTA.arroz, CARTA.ceviche, CARTA.gaseosa, CARTA.combo]) {
      await expect(page.getByRole('heading', { level: 3, name: nombre })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Tu mesa' })).toBeVisible();
    await captura(page, '01-cliente-escanea');
  });

  await test.step('Cocina/Barra marca el arroz chaufa agotado y, sin recargar, el arroz y el combo que lo lleva desaparecen de la carta del cliente', async () => {
    const pagina = cocina.page;
    await expect(pagina.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();
    await destino(pagina, 'Disponibilidad').click();
    await expect(pagina.getByRole('heading', { name: 'Disponibilidad', level: 1 })).toBeVisible();
    await pagina
      .getByRole('group', { name: 'Secciones de disponibilidad' })
      .getByRole('button', { name: 'Agotados', exact: true })
      .click();
    await pagina.getByRole('switch', { name: `Agotado: ${CARTA.arroz}` }).click();
    const hoja = pagina.getByRole('dialog', { name: `Marcar «${CARTA.arroz}» como agotado` });
    await expect(hoja).toBeVisible();
    await hoja.getByRole('button', { name: 'Marcar como agotado' }).click();
    await expect(hoja).toBeHidden();
    await expect(pagina.getByText(`${CARTA.arroz} está agotado`)).toBeVisible();

    // La carta consulta la disponibilidad cada 15 s con la página visible (criterio 82).
    const arroz = page.getByRole('heading', { level: 3, name: CARTA.arroz });
    await expect(arroz).toBeHidden({ timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 3, name: CARTA.combo })).toBeHidden();
    await expect(page.getByRole('heading', { level: 3, name: CARTA.lomo })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${CARTA.arroz},`) })).toBeHidden();
    // Cocina vuelve a su pantalla de comandas.
    await destino(pagina, 'Cocina').click();
    await expect(pagina.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();
    await expect(pagina.getByText('Sin comandas pendientes')).toBeVisible();
  });
});

test('el cliente arma su pedido y lo envía: la respuesta se pierde, reintenta con el mismo id y el Mozo ve un solo aviso', async ({
  request,
}) => {
  const { page } = cliente;

  await test.step('arma el pedido: 2 lomos, un ceviche sin ají y una gaseosa', async () => {
    await agregarAlPedido(page, CARTA.lomo, 28, { cantidad: 2 });
    await agregarAlPedido(page, CARTA.ceviche, 38, { indicaciones: 'sin ají' });
    await agregarAlPedido(page, CARTA.gaseosa, 6);
    const ver = page.getByRole('button', { name: /Ver tu pedido/ });
    await expect(ver).toContainText('4 platos');
    await expect(ver).toContainText('100 soles');
    await expect(page.getByText('2 en tu pedido')).toBeVisible();
    await captura(page, '02-cliente-barra-con-pedido');
  });

  await test.step('el pedido sobrevive a una recarga de la página', async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: /Ver tu pedido/ })).toContainText('4 platos');
    await expect(page.getByText('2 en tu pedido')).toBeVisible();
  });

  await test.step('«Enviar al mozo»: el servidor lo recibe, pero el cliente no recibe la respuesta', async () => {
    let perdidas = 0;
    await page.route(`${API}/publico/mesas/*/llamados`, async (ruta) => {
      if (ruta.request().method() === 'POST' && perdidas === 0) {
        perdidas += 1;
        await ruta.fetch(); // el servidor guarda el llamado y responde 201...
        await ruta.abort('connectionreset'); // ...pero la respuesta no llega al cliente.
        return;
      }
      await ruta.continue();
    });
    await page.getByRole('button', { name: /Ver tu pedido/ }).click();
    const hoja = page.getByRole('dialog', { name: 'Tu pedido' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('2 × Lomo saltado')).toBeVisible();
    await hoja.getByLabel(/Nota para el mozo/).fill('Es un cumpleaños, gracias');
    await page.waitForTimeout(400); // la hoja termina de subir
    await captura(page, '03-cliente-tu-pedido');
    await hoja.getByRole('button', { name: 'Enviar al mozo' }).click();

    await expect(page.getByText('Avisamos al mozo')).toBeVisible({ timeout: 15_000 });
    expect(perdidas).toBe(1);
    // Los dos envíos (el perdido y el reintento) llevaron el mismo `id`.
    expect(enviosDelCliente).toHaveLength(2);
    expect(enviosDelCliente[1]!.id).toBe(enviosDelCliente[0]!.id);
    await expect(page.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await captura(page, '04-cliente-avisamos-al-mozo');
  });

  await test.step('el Mozo recibe un solo aviso, en vivo y sin recargar', async () => {
    await expect(bannerDeLlamado(mozo.page, 'Mesa 1 · Pedido (4 platos)')).toHaveCount(1);
    await expect(
      mozo.page
        .getByRole('group', { name: 'Qué ver en el salón' })
        .getByRole('button', { name: /^Llamados/ }),
    ).toContainText('Llamados (1)');
    await captura(mozo.page, '05-mozo-aviso-de-pedido');
    // El cliente lo ve pendiente en la API pública.
    const estado = await llamarApi<EstadoLlamadoPublico>(
      request,
      `/publico/mesas/${codigoMesa}/llamados/${enviosDelCliente[0]!.id}`,
    );
    expect(estado.cuerpo).toMatchObject({ id: enviosDelCliente[0]!.id, estado: 'PENDIENTE' });
  });
});

test('el Mozo atiende y pasa el pedido a la cuenta; el cliente ve cada estado en su pantalla y el KDS no recibe nada hasta «Enviar»', async ({
  request,
}) => {
  const pagina = mozo.page;
  const { page } = cliente;

  await test.step('el Mozo revisa el pedido con lo que el cliente armó, sin cambiar nada', async () => {
    await verElAviso(pagina, 'Mesa 1 · Pedido (4 platos)');
    const lineas = pagina.getByRole('list', { name: 'Lo que pidió el cliente' });
    await expect(lineas).toContainText(`2 × ${CARTA.lomo}`);
    await expect(lineas).toContainText(`1 × ${CARTA.ceviche}`);
    await expect(lineas).toContainText('«sin ají»');
    await expect(lineas).toContainText(`1 × ${CARTA.gaseosa}`);
    await expect(pagina.getByText('«Es un cumpleaños, gracias»')).toBeVisible();
    await expect(pagina.locator('.llamado-detalle__total')).toContainText('S/ 100.00');
  });

  await test.step('«Atender»: abre la mesa a su nombre y el cliente lo ve', async () => {
    await pagina.getByRole('button', { name: 'Atender', exact: true }).click();
    const hoja = pagina.getByRole('dialog', { name: 'Atender la mesa 1' });
    await expect(hoja).toBeVisible();
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(pagina.getByText('Abriste la mesa a tu nombre')).toBeVisible();

    // La carta del cliente consulta el estado cada 10 s mientras el llamado no termina.
    await expect(page.getByText('El mozo viene a tu mesa')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Llamar al mozo/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await captura(page, '06-cliente-atendido');
  });

  await test.step('«Pasar a la cuenta»: el cliente ve que el mozo tomó su pedido y Cocina no recibe nada', async () => {
    await pagina.getByRole('button', { name: 'Pasar a la cuenta' }).click();
    const ordenId = await esperarLaCuenta(pagina, 'Mesa 1');
    await expect(pagina.getByText('Pedido pasado a la cuenta')).toBeVisible();
    await expect(page.getByText('El mozo tomó tu pedido')).toBeVisible({ timeout: 20_000 });
    await captura(page, '07-cliente-el-mozo-tomo-su-pedido');

    // Nada llegó a cocina: solo está en el borrador del Mozo.
    await expect(cocina.page.getByText('Sin comandas pendientes')).toBeVisible();
    await expect(cocina.page.getByRole('article')).toHaveCount(0);
    const cuenta = await cuentaPorApi<{ items: unknown[]; total: string }>(
      request,
      pagina,
      ordenId,
    );
    expect(cuenta.items).toEqual([]);
    expect(cuenta.total).toBe('0.00');
  });

  await test.step('el Mozo pulsa «Enviar» y entonces sí llega la comanda a Cocina', async () => {
    await pagina.getByRole('region', { name: 'Por enviar' }).getByRole('link').click();
    await expect(pagina.getByRole('heading', { name: 'Agregar a Mesa 1', level: 1 })).toBeVisible();
    await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
    await esperarLaCuenta(pagina, 'Mesa 1');
    await expect(pagina.getByText('La comanda se envió a cocina.')).toBeVisible();
    const deCocina = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina');
    await expect(deCocina).toBeVisible();
    await expect(deCocina).toContainText(CARTA.lomo);
    await expect(deCocina).toContainText('sin ají');
  });

  afirmarClavesDelSalon(mozo.escrituras, [
    ['POST', /^\/llamados\/[^/]+\/atencion$/],
    ['POST', /^\/llamados\/[^/]+\/paso-a-cuenta$/],
    ['POST', /\/envios$/],
  ]);
});

test('el cliente pide la cuenta: el Mozo la atiende y el cliente lo ve', async ({ request }) => {
  const pagina = mozo.page;
  const { page } = cliente;

  await test.step('«Pedir la cuenta» pide confirmación y manda un aviso sin pedido', async () => {
    await page.getByRole('button', { name: 'Entendido' }).click();
    await expect(page.getByText('El mozo tomó tu pedido')).toBeHidden();
    await page.getByRole('button', { name: /Pedir la cuenta/ }).click();
    const hoja = page.getByRole('dialog', { name: '¿Pedimos la cuenta?' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText(/El mozo traerá la cuenta de la Mesa 1/)).toBeVisible();
    await page.waitForTimeout(400);
    await captura(page, '08-cliente-confirma-pedir-la-cuenta');
    await hoja.getByRole('button', { name: 'Sí, pedir la cuenta' }).click();
    await expect(page.getByText('Avisamos al mozo')).toBeVisible();
    expect(enviosDelCliente.at(-1)?.tipo).toBe('PEDIR_CUENTA');
  });

  await test.step('el aviso es del Mozo responsable; lo atiende y el cliente lo ve', async () => {
    await expect(bannerDeLlamado(pagina, 'Mesa 1 · Pide la cuenta')).toBeVisible();
    await verElAviso(pagina, 'Mesa 1 · Pide la cuenta');
    await pagina.getByRole('button', { name: 'Atender', exact: true }).click();
    await esperarLaCuenta(pagina, 'Mesa 1');
    await expect(pagina.getByText('El cliente pidió la cuenta')).toBeVisible();
    await expect(page.getByText('El mozo viene a tu mesa')).toBeVisible({ timeout: 20_000 });
    const estado = await llamarApi<EstadoLlamadoPublico>(
      request,
      `/publico/mesas/${codigoMesa}/llamados/${enviosDelCliente.at(-1)!.id}`,
    );
    expect(estado.cuerpo.estado).toBe('ATENDIDO');
  });
});

test('la primera vista de la carta real pesa lo que debe y axe no encuentra fallas graves', async ({
  browser,
  request,
}) => {
  const carta = await llamarApi<CartaPublica>(request, `/publico/cartas/${empresaSlug}/miraflores`);
  expect(carta.estado).toBe(200);

  for (const { nombre, ruta, limiteJsKb } of [
    { nombre: 'el modo mesa', ruta: `/m/${codigoMesa}`, limiteJsKb: 150 },
    { nombre: 'la carta', ruta: `/${empresaSlug}/miraflores`, limiteJsKb: 140 },
  ]) {
    await test.step(`${nombre}: primera vista a 360 × 740`, async () => {
      // Un celular nuevo, sin nada en la caché: lo que baja la primera vez que se escanea el QR.
      const contexto = await browser.newContext(CELULAR_DEL_CLIENTE);
      abiertos.push(contexto);
      const page = await contexto.newPage();
      const descargas = vigilarDescargas(page);
      const respuesta = await page.goto(ruta);
      expect(respuesta?.status()).toBe(200);
      await esperarDescargas(page);

      const total = suma(descargas);
      const js = sumaCuerpos(descargas, (d) => d.tipo === 'script');
      test.info().annotations.push({
        type: 'peso',
        description: `${nombre}: total ${(total / KB).toFixed(1)} kB · JS ${(js / KB).toFixed(1)} kB · ${descargas.length} peticiones`,
      });
      expect(total, `${nombre}: la primera vista transfiere 400 kB o menos`).toBeLessThanOrEqual(
        400 * KB,
      );
      expect(js, `${nombre}: JavaScript de la primera carga`).toBeLessThanOrEqual(limiteJsKb * KB);
      expect(descargas.filter((d) => d.tipo === 'font')).toEqual([]);

      await revisarAccesibilidad(page, `${nombre} real`);
      if (ruta.startsWith('/m/')) {
        await page.getByRole('button', { name: new RegExp(`^${CARTA.lomo}, 28 soles`) }).click();
        await expect(page.getByRole('dialog', { name: CARTA.lomo })).toBeVisible();
        await page.waitForTimeout(400);
        await revisarAccesibilidad(page, 'hoja de producto real');
      }
    });
  }
});
