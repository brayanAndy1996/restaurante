import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import {
  type CartaPublica,
  type EstadoLlamadoPublico,
  type LlamadoPublico,
  type MesaPublica,
  type QrMesasRespuesta,
} from '@restaurante/contratos';
import { CELULAR, llamarApi, type Persona } from './ayudas';
import { afirmarPantallaDeCelular, entrarEnCelular } from './ayudas-carta';
import {
  abrirLaListaDeLlamados,
  avisoDelCliente,
  bannerDeLlamado,
  botonAtender,
  crearSegundoMozo,
  enlaceDeLlamado,
  estadoComoCliente,
  mandarComoCliente,
  pedidoDelCliente,
  segmentoDeLlamados,
  verMesaComoCliente,
  vigilarEscriturasDeLlamados,
} from './ayudas-llamados';
import {
  CARTA,
  afirmarClavesDelSalon,
  afirmarEstadoDeMesa,
  baldosaDeMesa,
  crearEscenarioDeSalon,
  cuentaPorApi,
  destino,
  esperarLaCuenta,
  itemDeCuenta,
  tarjetaDeCocina,
  type EscenarioDeSalon,
} from './ayudas-salon';

/**
 * Llamados desde la mesa de la entrega 5a (historia 005, tarea T14, criterio 77), contra la API real y PostgreSQL,
 * con el tiempo real encendido y sin ningún mock. La carta web (5b) todavía no existe: el cliente se simula con las
 * peticiones que haría su navegador a la API pública (`/publico/mesas/:codigo/...`). Todo lo demás lo hacen
 * personas en celulares de 360 px, cada una en su propio contexto del navegador: el Administrador (solo al
 * principio), dos Mozos, el Cajero y Cocina/Barra.
 *
 * Los pasos, en este orden (cada uno depende del anterior, así que corren en serie):
 *
 * 1. el Administrador configura y publica la carta web de S1, crea las mesas, abre la hoja de QR y de ahí sale el
 *    código de cada mesa; el cliente simulado ve su mesa por la API pública;
 * 2. el cliente pide en la mesa 1 (libre): el Mozo y el Cajero reciben el aviso, Cocina no;
 * 3. el Mozo lo atiende (la mesa estaba libre: la abre con 2 comensales), cambia una cantidad, quita un plato y lo
 *    pasa a la cuenta: Cocina no recibe nada;
 * 4. el Mozo pulsa «Enviar» y Cocina/Barra recibe la comanda, solo con lo que quedó;
 * 5. el cliente manda «Pedir la cuenta»: el aviso es solo del Mozo responsable; lo atiende y pide la pre-cuenta;
 * 6. la mesa 2: «Llamar al mozo» (abre la mesa al atenderlo) y «Pedir la cuenta» sin consumo;
 * 7. la mesa 3: un llamado repetido (mismo id) no aparece dos veces, un segundo distinto se rechaza y se descarta;
 * 8. la mesa 4: dos mozos atienden el mismo llamado y el segundo lee quién lo tomó;
 * 9. a 360 px, las pantallas de llamados no se desplazan de lado y sus controles miden 44 px o más; en una
 *    tableta aprovechan el ancho.
 *
 * El vencimiento a los 15 minutos NO se prueba aquí: la API que levanta Playwright usa el reloj del sistema (el
 * `RELOJ` inyectable solo existe al crear la aplicación en las pruebas de integración) y esperar 15 minutos de
 * verdad no cabe en una corrida. Lo cubren las pruebas de integración de la API, con su reloj controlado.
 *
 * Los datos de cada corrida son de una empresa nueva: se puede repetir sobre la misma base. Toda escritura de la PWA
 * sobre llamados y cuentas debe llevar su clave de idempotencia: cada paso lo comprueba con lo que la PWA mandó de
 * verdad.
 */
test.describe.configure({ mode: 'serial' });
// Un control que no está falla en segundos, no a los dos minutos del tiempo de la prueba.
test.use({ actionTimeout: 15_000 });

const TABLETA: BrowserContextOptions = {
  ...CELULAR,
  viewport: { width: 820, height: 1180 },
  isMobile: false,
};

const ZONA = 'Salón principal';
const CAPACIDADES = ['4', '2', '6', '2', '4'];

let e: EscenarioDeSalon;
let mozo2: Persona;
const abiertos: BrowserContext[] = [];

interface Equipo {
  contexto: BrowserContext;
  page: Page;
  escrituras: ReturnType<typeof vigilarEscriturasDeLlamados>;
}
let mozoA: Equipo;
let mozoB: Equipo;
let cajero: Equipo;
let cocina: Equipo;

/** El código de cada mesa (por su nombre «1», «2»…), tal como lo da la hoja de QR. */
const codigos: Record<string, string> = {};
/** El id público de cada producto de la carta, por su nombre, tal como lo ve el cliente. */
const productos: Record<string, string> = {};
let ordenMesa1 = '';
/** El id del pedido de la mesa 1, para preguntarle al cliente cómo lo ve. */
let idPedidoMesa1 = '';

test.beforeAll(async ({ request }) => {
  e = await crearEscenarioDeSalon(request);
  mozo2 = await crearSegundoMozo(request, e);
});
test.afterAll(async () => {
  for (const contexto of abiertos) await contexto.close().catch(() => undefined);
});

async function entrar(
  browser: Browser,
  persona: Persona,
  sucursal?: string,
  opciones: BrowserContextOptions = CELULAR,
): Promise<Equipo> {
  const { contexto, page } = await entrarEnCelular(browser, persona, sucursal, opciones);
  abiertos.push(contexto);
  return { contexto, page, escrituras: vigilarEscriturasDeLlamados(page) };
}

const captura = (page: Page, nombre: string, completa = false) =>
  page.screenshot({ path: `e2e/resultados/llamados-${nombre}.png`, fullPage: completa });

/** Deja abierto el mapa de mesas del salón (el segmento «Mesas», o la flecha desde una pantalla de detalle). */
async function irALasMesas(page: Page): Promise<void> {
  const mesas = page
    .getByRole('group', { name: 'Qué ver en el salón' })
    .getByRole('button', { name: 'Mesas', exact: true });
  if (!(await mesas.isVisible())) {
    await page
      .getByRole('link', { name: 'Volver a Salón' })
      .or(destino(page, 'Salón'))
      .first()
      .click();
  }
  await mesas.click();
  await expect(page.getByRole('grid', { name: `Mesas de ${ZONA}` })).toBeVisible();
}

/**
 * Deja abierta la lista de llamados del salón. Si la pantalla ya es el salón, basta tocar el segmento; desde una
 * pantalla de detalle (la cuenta) se vuelve con la flecha. El Mozo no tiene barra de navegación: solo atiende el salón.
 */
async function irALosLlamados(page: Page): Promise<void> {
  if (!(await segmentoDeLlamados(page).isVisible())) {
    await page
      .getByRole('link', { name: 'Volver a Salón' })
      .or(destino(page, 'Salón'))
      .first()
      .click();
  }
  await abrirLaListaDeLlamados(page);
}

// ---------------------------------------------------------------------------------------------------------

test('el Administrador publica la carta de S1, crea las mesas y de la hoja de QR sale el código de cada mesa', async ({
  browser,
  request,
}) => {
  const sufijo = e.administrador.usuario.split('.').pop() ?? 'x';
  const empresaSlug = `llamados-${sufijo}`;
  const admin = await entrar(browser, e.administrador, e.s1.nombre);
  const { page } = admin;

  await test.step('configura el nombre y la dirección de la carta y publica S1', async () => {
    await destino(page, 'Ajustes').click();
    await page.getByRole('button', { name: 'Carta web' }).click();
    await expect(page.getByText('Aún no configuraste tu carta web')).toBeVisible();
    await page.getByLabel('Nombre que ven tus clientes').fill('Cevichería de los Llamados');
    await page.getByLabel('Dirección de tu carta').fill(empresaSlug);
    await page.getByLabel(`Dirección de ${e.s1.nombre}`).fill('miraflores');
    await page.getByRole('switch', { name: `Publicada: ${e.s1.nombre}` }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Cambios guardados. Tu carta ya tiene estos datos.')).toBeVisible();
    await expect(page.locator('.ui-etiqueta--ok', { hasText: 'Publicada' })).toBeVisible();
    await captura(page, '01-carta-web-publicada', true);
  });

  await test.step('crea la zona y las cinco mesas del salón', async () => {
    await page.getByRole('button', { name: 'Mapa de mesas' }).click();
    await expect(page.getByText('Aún no hay zonas', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Agregar zona' }).click();
    await page.getByLabel('Nombre de la zona').fill(ZONA);
    await page.getByLabel('Columnas').fill('3');
    await page.getByLabel('Filas').fill('2');
    await page.getByRole('button', { name: 'Crear zona', exact: true }).click();
    await expect(page.getByText(`Zona ${ZONA} creada.`)).toBeVisible();
    for (const [i, capacidad] of CAPACIDADES.entries()) {
      const nombre = String(i + 1);
      await page.getByRole('button', { name: 'Agregar mesa' }).click();
      await expect(page.getByLabel('Nombre de la mesa')).toHaveValue(nombre);
      await page.getByLabel('Capacidad (personas)').fill(capacidad);
      await page.getByRole('button', { name: 'Crear mesa' }).click();
      await expect(page.getByText(`Mesa ${nombre} creada.`)).toBeVisible();
    }
  });

  await test.step('la hoja de QR trae un código por mesa y se puede imprimir', async () => {
    const lista = page.waitForResponse(
      (r) =>
        /\/sucursales\/[^/]+\/qr-mesas$/.test(new URL(r.url()).pathname) &&
        r.request().method() === 'GET',
    );
    await page.getByRole('link', { name: 'QR de las mesas' }).click();
    const qr = (await (await lista).json()) as QrMesasRespuesta;
    await expect(page.getByRole('heading', { name: 'QR de las mesas', level: 1 })).toBeVisible();
    expect(qr.cartaPublicada, 'la carta de S1 ya está publicada').toBe(true);
    expect(qr.mesas.map((m) => m.nombre)).toEqual(['1', '2', '3', '4', '5']);
    for (const mesa of qr.mesas) {
      expect(mesa.codigo, `la mesa ${mesa.nombre} tiene su código`).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(mesa.url, `el QR de la mesa ${mesa.nombre} lleva su código`).toMatch(
        new RegExp(`/m/${mesa.codigo}$`),
      );
      codigos[mesa.nombre] = mesa.codigo!;
    }
    expect(new Set(Object.values(codigos)).size, 'cada mesa, un código distinto').toBe(5);

    await expect(page.getByRole('button', { name: 'Imprimir la hoja' })).toBeEnabled();
    await expect(page.getByRole('img', { name: 'Código QR de la mesa 1' })).toBeVisible();
    await captura(page, '02-hoja-de-qr', true);
    // Lo que sale en papel: solo las tarjetas, con el escaneo y el nombre de la sucursal.
    // La hoja es de papel A4 (794 px de ancho): se mira con ese ancho, no con el del celular.
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.emulateMedia({ media: 'print' });
    await expect(
      page.getByText('Escanea para ver la carta y llamar al mozo').first(),
    ).toBeVisible();
    await captura(page, '03-hoja-de-qr-impresa', true);
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 360, height: 740 });
  });

  await test.step('el cliente simulado abre su mesa y ve la carta pública', async () => {
    const mesa = await verMesaComoCliente<MesaPublica>(request, codigos['1']!);
    expect(mesa.estado).toBe(200);
    expect(mesa.cuerpo).toEqual({
      mesa: { nombre: '1' },
      carta: { empresaSlug, sucursalSlug: 'miraflores' },
      aceptaLlamados: true,
      motivoNoAcepta: null,
      llamadoPendiente: null,
    });
    const carta = await llamarApi<CartaPublica>(
      request,
      `/publico/cartas/${empresaSlug}/miraflores`,
    );
    expect(carta.estado).toBe(200);
    for (const producto of carta.cuerpo.familias.flatMap((f) => f.productos)) {
      productos[producto.nombre] = producto.id;
    }
    for (const nombre of [CARTA.lomo, CARTA.ceviche, CARTA.gaseosa]) {
      expect(productos[nombre], `${nombre} está en la carta pública`).toBeTruthy();
    }
    // Un código que no existe no revela nada.
    const falso = await verMesaComoCliente(request, 'A'.repeat(22));
    expect(falso.estado).toBe(404);
  });

  await admin.contexto.close();
});

test('el Mozo, el Cajero y Cocina abren sus celulares: las cinco mesas están libres', async ({
  browser,
}) => {
  [mozoA, mozoB, cajero, cocina] = [
    await entrar(browser, e.mozo),
    await entrar(browser, mozo2),
    await entrar(browser, e.cajero),
    await entrar(browser, e.cocina),
  ];
  await expect(cocina.page.getByRole('heading', { name: 'Cocina', level: 1 })).toBeVisible();
  await expect(cocina.page.getByText('Sin comandas pendientes')).toBeVisible();
  for (const persona of [mozoA, mozoB, cajero]) {
    await expect(persona.page.getByRole('heading', { name: 'Salón', level: 1 })).toBeVisible();
    for (const n of ['1', '2', '3', '4', '5']) await afirmarEstadoDeMesa(persona.page, n, 'libre');
    await expect(segmentoDeLlamados(persona.page)).toContainText('Llamados (0)');
  }
});

test('el cliente pide en la mesa 1 libre: el Mozo y el Cajero reciben el aviso y Cocina no', async ({
  request,
}) => {
  const pedido = pedidoDelCliente(
    [
      { productoId: productos[CARTA.lomo]!, cantidad: 2 },
      { productoId: productos[CARTA.ceviche]!, cantidad: 1, observacion: 'sin ají' },
      { productoId: productos[CARTA.gaseosa]!, cantidad: 1 },
    ],
    'Es un cumpleaños, gracias',
  );
  const idPedido = pedido.id;
  idPedidoMesa1 = idPedido;

  await test.step('el cliente pulsa «Enviar»', async () => {
    const r = await mandarComoCliente<LlamadoPublico>(request, codigos['1']!, pedido);
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({
      id: idPedido,
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      total: '100.00',
    });
    expect(r.cuerpo.lineas.map((l) => `${l.cantidad} ${l.nombre}`)).toEqual([
      `2 ${CARTA.lomo}`,
      `1 ${CARTA.ceviche}`,
      `1 ${CARTA.gaseosa}`,
    ]);
    // Lo que el cliente ve mientras espera: pendiente, y su mesa ya avisa que hay un llamado.
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(request, codigos['1']!, idPedido);
    expect(estado.cuerpo).toMatchObject({ id: idPedido, estado: 'PENDIENTE' });
    const mesa = await verMesaComoCliente<MesaPublica>(request, codigos['1']!);
    expect(mesa.cuerpo.llamadoPendiente).toMatchObject({ tipo: 'PEDIDO' });
  });

  await test.step('el Mozo y el Cajero ven el aviso, en vivo y sin recargar', async () => {
    for (const persona of [mozoA, cajero]) {
      await expect(bannerDeLlamado(persona.page, 'Mesa 1 · Pedido (4 platos)')).toBeVisible();
    }
    await expect(segmentoDeLlamados(mozoA.page)).toContainText('Llamados (1)');
    await captura(mozoA.page, '04-mozo-aviso-de-pedido');
    await captura(cajero.page, '05-cajero-aviso-de-pedido');
  });

  await test.step('Cocina/Barra no recibe ningún aviso', async () => {
    await cocina.page.waitForTimeout(1_000);
    await expect(bannerDeLlamado(cocina.page, /Mesa 1/)).toHaveCount(0);
    await expect(cocina.page.getByText('Sin comandas pendientes')).toBeVisible();
  });

  await test.step('el segundo mozo también lo ve (la mesa está libre: es de todos)', async () => {
    await expect(bannerDeLlamado(mozoB.page, 'Mesa 1 · Pedido (4 platos)')).toBeVisible();
  });
});

test('el Mozo atiende con la mesa libre y la abre con 2 comensales; cambia una cantidad, quita un plato y lo pasa a la cuenta sin que Cocina reciba nada', async ({
  request,
}) => {
  const { page } = mozoA;

  await test.step('toca «Ver» en el aviso y revisa el pedido con el cliente', async () => {
    await bannerDeLlamado(page, 'Mesa 1 · Pedido (4 platos)')
      .getByRole('link', { name: 'Ver' })
      .click();
    await expect(page.getByRole('heading', { name: 'Mesa 1', level: 1 })).toBeVisible();
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Pedido · (recién llegó|hace \d+ min)/)).toBeVisible();
    await expect(page.getByText('«Es un cumpleaños, gracias»')).toBeVisible();
    const lineas = page.getByRole('list', { name: 'Lo que pidió el cliente' });
    await expect(lineas).toContainText(`2 × ${CARTA.lomo}`);
    await expect(lineas).toContainText(`1 × ${CARTA.ceviche}`);
    await expect(lineas).toContainText('«sin ají»');
    await expect(lineas).toContainText(`1 × ${CARTA.gaseosa}`);
    await expect(page.getByText('Total para la cuenta')).toBeVisible();
    await expect(page.locator('.llamado-detalle__total')).toContainText('S/ 100.00');
    // Todavía no se puede ajustar nada: primero se atiende.
    await expect(page.getByRole('button', { name: `Quitar ${CARTA.ceviche}` })).toHaveCount(0);
    await captura(page, '06-mozo-detalle-del-pedido', true);
  });

  await test.step('«Atender»: la mesa está libre, así que pide los comensales y la abre a su nombre', async () => {
    await page.getByRole('button', { name: 'Atender', exact: true }).click();
    const hoja = page.getByRole('dialog', { name: 'Atender la mesa 1' });
    await expect(hoja).toBeVisible();
    const comensales = hoja.getByRole('group', { name: 'Cantidad de comensales' });
    await expect(comensales).toContainText('4');
    await expect(hoja.getByText('La mesa es para 4 personas.')).toBeVisible();
    await hoja.getByRole('button', { name: 'Quitar uno de comensales' }).click();
    await hoja.getByRole('button', { name: 'Quitar uno de comensales' }).click();
    await expect(comensales).toContainText('2');
    await page.waitForTimeout(400); // la hoja termina de subir
    await captura(page, '07-mozo-atender-y-abrir-la-mesa');
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByText('Abriste la mesa a tu nombre')).toBeVisible();
    await expect(
      page.getByText('Falta pasarlo a la cuenta', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(`Atiende ${e.mozo.nombre}`)).toBeVisible();
  });

  await test.step('el aviso se va de los otros equipos y la mesa se ve ocupada en el salón del Cajero', async () => {
    await expect(bannerDeLlamado(cajero.page, 'Mesa 1 · Pedido')).toHaveCount(0);
    await expect(bannerDeLlamado(mozoB.page, 'Mesa 1 · Pedido')).toHaveCount(0);
    await afirmarEstadoDeMesa(cajero.page, '1', 'ocupada');
    await expect(baldosaDeMesa(cajero.page, '1')).toHaveAttribute('aria-label', /Ocupada · 2 ·/);
    await expect(segmentoDeLlamados(cajero.page)).toContainText('Llamados (0)');
    // El cliente lo ve atendido: el mozo ya viene, pero su pedido todavía no está en la cuenta.
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(
      request,
      codigos['1']!,
      idPedidoMesa1,
    );
    expect(estado.cuerpo.estado).toBe('ATENDIDO');
  });

  await test.step('cambia una cantidad (2 lomos a 1) y quita el ceviche', async () => {
    await page.getByRole('button', { name: `Quitar una unidad de ${CARTA.lomo}` }).click();
    await expect(page.getByRole('group', { name: `Cantidad de ${CARTA.lomo}` })).toContainText('1');
    await expect(page.locator('.llamado-detalle__total')).toContainText('S/ 72.00');

    await page.getByRole('button', { name: `Quitar ${CARTA.ceviche}` }).click();
    await expect(page.getByRole('list', { name: 'Líneas que quitaste' })).toContainText(
      `Quitaste ${CARTA.ceviche}`,
    );
    await expect(page.getByRole('list', { name: 'Lo que pidió el cliente' })).not.toContainText(
      CARTA.ceviche,
    );
    await expect(page.locator('.llamado-detalle__total')).toContainText('S/ 34.00');
    await captura(page, '08-mozo-ajusta-el-pedido', true);

    // Un error se deshace: el ceviche vuelve y se quita otra vez.
    await page.getByRole('button', { name: `Deshacer: volver a poner ${CARTA.ceviche}` }).click();
    await expect(page.locator('.llamado-detalle__total')).toContainText('S/ 72.00');
    await page.getByRole('button', { name: `Quitar ${CARTA.ceviche}` }).click();
    await expect(page.locator('.llamado-detalle__total')).toContainText('S/ 34.00');
  });

  await test.step('«Pasar a la cuenta»: las líneas esperan en «Por enviar» y Cocina no recibe nada', async () => {
    await page.getByRole('button', { name: 'Pasar a la cuenta' }).click();
    ordenMesa1 = await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('Pedido pasado a la cuenta')).toBeVisible();
    const porEnviar = page.getByRole('region', { name: 'Por enviar' });
    await expect(porEnviar).toContainText('2 ítems sin enviar a cocina');
    await expect(porEnviar).toContainText('S/ 34.00');
    await expect(page.getByText('Aún no se envió nada')).toBeVisible();
    await captura(page, '09-mozo-pasado-a-la-cuenta', true);

    // Nada llegó a cocina ni a la cuenta: solo está en el borrador de este equipo.
    await cocina.page.waitForTimeout(1_500);
    await expect(cocina.page.getByText('Sin comandas pendientes')).toBeVisible();
    await expect(cocina.page.getByRole('article')).toHaveCount(0);
    const cuenta = await cuentaPorApi<{ items: unknown[]; total: string }>(
      request,
      page,
      ordenMesa1,
    );
    expect(cuenta.items, 'la cuenta no tiene ningún ítem enviado').toEqual([]);
    expect(cuenta.total).toBe('0.00');

    const estado = await estadoComoCliente<EstadoLlamadoPublico>(
      request,
      codigos['1']!,
      idPedidoMesa1,
    );
    expect(estado.cuerpo.estado).toBe('PASADO_A_CUENTA');
  });

  afirmarClavesDelSalon(mozoA.escrituras, [
    ['POST', /^\/llamados\/[^/]+\/atencion$/],
    ['POST', /^\/llamados\/[^/]+\/paso-a-cuenta$/],
  ]);
});

test('el Mozo pulsa «Enviar» y la comanda llega a Cocina/Barra solo con lo que quedó', async ({
  request,
}) => {
  const { page } = mozoA;

  await test.step('abre «Por enviar», revisa y envía', async () => {
    await page.getByRole('region', { name: 'Por enviar' }).getByRole('link').click();
    await expect(page.getByRole('heading', { name: 'Agregar a Mesa 1', level: 1 })).toBeVisible();
    const borrador = page.getByRole('region', { name: 'Por enviar' });
    await expect(
      borrador.getByRole('button', { name: new RegExp(`^Editar 1 × ${CARTA.lomo}`) }),
    ).toBeVisible();
    await expect(
      borrador.getByRole('button', { name: new RegExp(`^Editar 1 × ${CARTA.gaseosa}`) }),
    ).toBeVisible();
    await expect(borrador.getByRole('button', { name: /Ceviche/ })).toHaveCount(0);
    await expect(borrador).toContainText('S/ 34.00');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('Pedido enviado')).toBeVisible();
    await expect(page.getByText('La comanda se envió a cocina.')).toBeVisible();
    await expect(itemDeCuenta(page, CARTA.lomo)).toContainText('Enviado a cocina');
    await expect(itemDeCuenta(page, CARTA.ceviche)).toHaveCount(0);
    await expect(page.locator('.cuenta__total')).toContainText('S/ 34.00');
    await captura(page, '10-mozo-comanda-enviada', true);
  });

  await test.step('Cocina recibe la comanda: el lomo en Cocina y la gaseosa en Barra, sin el ceviche', async () => {
    const deCocina = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Cocina');
    await expect(deCocina).toBeVisible();
    await expect(deCocina).toContainText(CARTA.lomo);
    await expect(deCocina).toContainText(e.mozo.nombre);
    await expect(deCocina).toContainText('2 comensales');
    await expect(deCocina).not.toContainText(CARTA.ceviche);
    const deBarra = tarjetaDeCocina(cocina.page, 'Comanda', 'Mesa 1', 'Barra');
    await expect(deBarra).toContainText(CARTA.gaseosa);
    await expect(cocina.page.getByText('2 pendientes')).toBeVisible();
    await captura(cocina.page, '11-cocina-recibe-la-comanda');
  });

  await test.step('la API tiene la cuenta con solo lo pasado, y un solo envío con su clave', async () => {
    const cuenta = await cuentaPorApi<{
      total: string;
      items: { nombre: string; cantidad: number }[];
    }>(request, page, ordenMesa1);
    expect(cuenta.items.map((i) => `${i.cantidad} ${i.nombre}`).sort()).toEqual(
      [`1 ${CARTA.gaseosa}`, `1 ${CARTA.lomo}`].sort(),
    );
    expect(cuenta.total).toBe('34.00');
    const envios = mozoA.escrituras.filter(
      (w) => w.metodo === 'POST' && /^\/ordenes\/[^/]+\/envios$/.test(w.ruta),
    );
    expect(envios).toHaveLength(1);
    expect(envios[0]?.clave).toMatch(/^[0-9a-f-]{36}$/);
  });
  afirmarClavesDelSalon(mozoA.escrituras, [['POST', /\/envios$/]]);
});

test('el cliente manda «Pedir la cuenta»: es un aviso solo del Mozo responsable; lo atiende y pide la pre-cuenta', async ({
  request,
}) => {
  const { page } = mozoA;
  const aviso = avisoDelCliente('PEDIR_CUENTA');

  await test.step('el cliente pulsa «Pedir la cuenta»', async () => {
    const r = await mandarComoCliente<LlamadoPublico>(request, codigos['1']!, aviso);
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({
      id: aviso.id,
      tipo: 'PEDIR_CUENTA',
      estado: 'PENDIENTE',
      total: null,
      lineas: [],
    });
  });

  await test.step('lo ve el Mozo responsable; el Cajero y el otro Mozo lo ven en la lista, sin el aviso', async () => {
    await expect(bannerDeLlamado(page, 'Mesa 1 · Pide la cuenta')).toBeVisible();
    await captura(page, '12-mozo-aviso-de-pedir-la-cuenta');
    // La mesa tiene mozo responsable: el aviso es solo de él.
    await expect(segmentoDeLlamados(cajero.page)).toContainText('Llamados (1)');
    await expect(bannerDeLlamado(cajero.page, 'Mesa 1 · Pide la cuenta')).toHaveCount(0);
    await expect(bannerDeLlamado(mozoB.page, 'Mesa 1 · Pide la cuenta')).toHaveCount(0);
    await abrirLaListaDeLlamados(cajero.page);
    await expect(enlaceDeLlamado(cajero.page, '1', 'Pide la cuenta')).toBeVisible();
    await expect(cajero.page.getByText('Para ti', { exact: true })).toHaveCount(0);
    await captura(cajero.page, '13-cajero-lista-sin-para-ti');
  });

  await test.step('el Mozo la atiende: va a la cuenta con la pre-cuenta a la vista', async () => {
    await bannerDeLlamado(page, 'Mesa 1 · Pide la cuenta')
      .getByRole('link', { name: 'Ver' })
      .click();
    await expect(page.getByRole('heading', { name: 'Mesa 1', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Atender', exact: true }).click();
    await esperarLaCuenta(page, 'Mesa 1');
    await expect(page.getByText('El cliente pidió la cuenta')).toBeVisible();
    await expect(page.getByText('Toca «Pedir pre-cuenta» cuando esté lista.')).toBeVisible();
    await captura(page, '14-mozo-pidieron-la-cuenta', true);
    await expect(segmentoDeLlamados(cajero.page)).toContainText('Llamados (0)');
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(request, codigos['1']!, aviso.id);
    expect(estado.cuerpo.estado).toBe('ATENDIDO');
  });

  await test.step('pide la pre-cuenta y la mesa pasa a amarillo para todos', async () => {
    await page.getByRole('button', { name: 'Pedir pre-cuenta' }).click();
    const hoja = page.getByRole('dialog', { name: 'Pre-cuenta' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByRole('list', { name: 'Detalle de la pre-cuenta' })).toContainText(
      CARTA.lomo,
    );
    await expect(hoja.locator('.precuenta__total')).toContainText('S/ 34.00');
    await page.waitForTimeout(400); // la hoja termina de subir
    await captura(page, '15-mozo-precuenta');
    await hoja.getByRole('button', { name: 'Volver a la cuenta' }).click();
    await expect(page.locator('.cuenta__cabecera')).toContainText('Pre-cuenta');
    await destino(cajero.page, 'Salón').click();
    await afirmarEstadoDeMesa(cajero.page, '1', 'en-precuenta');
  });

  afirmarClavesDelSalon(mozoA.escrituras, [
    ['POST', /^\/llamados\/[^/]+\/atencion$/],
    ['POST', /\/precuentas$/],
  ]);
});

test('la mesa 2: «Llamar al mozo» abre la mesa al atenderlo y «Pedir la cuenta» sin consumo no ofrece pre-cuenta', async ({
  request,
}) => {
  const { page } = mozoA;
  const llamar = avisoDelCliente('LLAMAR_MOZO');

  await test.step('el cliente llama al mozo y todos los mozos lo ven', async () => {
    const r = await mandarComoCliente<LlamadoPublico>(request, codigos['2']!, llamar);
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({
      tipo: 'LLAMAR_MOZO',
      estado: 'PENDIENTE',
      lineas: [],
      total: null,
    });
    for (const persona of [mozoA, mozoB, cajero]) {
      await expect(bannerDeLlamado(persona.page, 'Mesa 2 · Llama al mozo')).toBeVisible();
    }
  });

  await test.step('el Mozo lo atiende desde la lista: abre la mesa con la capacidad y queda a su nombre', async () => {
    await irALosLlamados(page);
    await expect(page.getByRole('list', { name: 'Llamados pendientes' })).toContainText('Mesa 2');
    await expect(page.getByText('Para ti', { exact: true })).toBeVisible();
    await captura(page, '16-mozo-lista-de-llamados');
    await botonAtender(page, '2').click();
    const hoja = page.getByRole('dialog', { name: 'Atender la mesa 2' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('La mesa es para 2 personas.')).toBeVisible();
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByText('Llamado atendido')).toBeVisible();
    await expect(
      page.getByText('Atendiste a la mesa 2 y quedó abierta a tu nombre.'),
    ).toBeVisible();
    await expect(page.getByText('No hay llamados pendientes')).toBeVisible();
    await captura(page, '17-mozo-llamado-atendido');
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(request, codigos['2']!, llamar.id);
    expect(estado.cuerpo.estado).toBe('ATENDIDO');
    await destino(cajero.page, 'Salón').click();
    await afirmarEstadoDeMesa(cajero.page, '2', 'ocupada');
    await expect(bannerDeLlamado(cajero.page, 'Mesa 2 · Llama al mozo')).toHaveCount(0);
  });

  await test.step('el cliente pide la cuenta sin haber consumido: el Mozo no tiene pre-cuenta que pedir', async () => {
    const cuenta = avisoDelCliente('PEDIR_CUENTA');
    const r = await mandarComoCliente<LlamadoPublico>(request, codigos['2']!, cuenta);
    expect(r.estado).toBe(201);
    // El Mozo está mirando la lista de llamados: ahí no hace falta el banner, el llamado aparece solo.
    await expect(bannerDeLlamado(page, 'Mesa 2 · Pide la cuenta')).toHaveCount(0);
    await expect(enlaceDeLlamado(page, '2', 'Pide la cuenta')).toBeVisible();
    await botonAtender(page, '2').click();
    await esperarLaCuenta(page, 'Mesa 2');
    await expect(page.getByText('El cliente pidió la cuenta')).toBeVisible();
    await expect(
      page.getByText(
        'Aún no hay nada enviado para cobrar. Cuando haya consumo podrás pedir la pre-cuenta.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /pre-cuenta/i })).toHaveCount(0);
    await captura(page, '18-mozo-pidieron-la-cuenta-sin-consumo', true);
  });

  afirmarClavesDelSalon(mozoA.escrituras, [['POST', /^\/llamados\/[^/]+\/atencion$/]]);
});

test('la mesa 3: un llamado repetido no aparece dos veces, un segundo distinto se rechaza y el Mozo descarta el pedido', async ({
  request,
}) => {
  const { page } = mozoA;
  const pedido = pedidoDelCliente([{ productoId: productos[CARTA.lomo]!, cantidad: 1 }]);

  await test.step('el cliente toca «Enviar» dos veces a la vez, con el mismo id', async () => {
    const [primera, segunda] = await Promise.all([
      mandarComoCliente<LlamadoPublico>(request, codigos['3']!, pedido),
      mandarComoCliente<LlamadoPublico>(request, codigos['3']!, pedido),
    ]);
    expect(primera.estado).toBe(201);
    expect(segunda.estado).toBe(201);
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    // Mientras esperan, otro llamado con otro id se rechaza.
    const otro = await mandarComoCliente<{ codigo: string }>(
      request,
      codigos['3']!,
      avisoDelCliente('LLAMAR_MOZO'),
    );
    expect(otro.estado).toBe(409);
    expect(otro.cuerpo.codigo).toBe('LLAMADO_PENDIENTE');
  });

  await test.step('en la lista del Mozo aparece una sola vez', async () => {
    await expect(bannerDeLlamado(page, 'Mesa 3 · Pedido (1 plato)')).toBeVisible();
    await irALosLlamados(page);
    await expect(enlaceDeLlamado(page, '3', 'Pedido')).toHaveCount(1);
    await expect(
      page.getByRole('list', { name: 'Llamados pendientes' }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(segmentoDeLlamados(page)).toContainText('Llamados (1)');
  });

  await test.step('el Mozo lo descarta con su motivo, sin abrir la mesa', async () => {
    await enlaceDeLlamado(page, '3', 'Pedido').click();
    await expect(page.getByRole('heading', { name: 'Mesa 3', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Descartar este llamado' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Pedido falso' }).click();
    await page.waitForTimeout(400);
    await captura(page, '19-mozo-descartar');
    await dialogo.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText('Llamado descartado')).toBeVisible();
    await expect(page.getByText('Descartado', { exact: true })).toBeVisible();
    await captura(page, '20-mozo-llamado-descartado');
  });

  await test.step('el cliente lo ve descartado, el aviso se va de los demás y la mesa sigue libre', async () => {
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(request, codigos['3']!, pedido.id);
    expect(estado.cuerpo.estado).toBe('DESCARTADO');
    await expect(bannerDeLlamado(cajero.page, 'Mesa 3')).toHaveCount(0);
    await expect(bannerDeLlamado(mozoB.page, 'Mesa 3')).toHaveCount(0);
    await afirmarEstadoDeMesa(cajero.page, '3', 'libre');
    const mesa = await verMesaComoCliente<MesaPublica>(request, codigos['3']!);
    expect(mesa.cuerpo.llamadoPendiente).toBeNull();
    // Volver a mandar el mismo id ya descartado no lo resucita ni crea otro.
    const replica = await mandarComoCliente<LlamadoPublico>(request, codigos['3']!, pedido);
    expect(replica.estado).toBe(201);
    expect(replica.cuerpo.id).toBe(pedido.id);
    await page.getByRole('link', { name: 'Volver a Llamados' }).click();
    await expect(enlaceDeLlamado(page, '3', 'Pedido')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Llamados recientes' })).toContainText('Mesa 3');
  });

  afirmarClavesDelSalon(mozoA.escrituras, [['POST', /^\/llamados\/[^/]+\/descarte$/]]);
});

test('la mesa 4: dos mozos atienden el mismo llamado y el segundo lee quién lo tomó', async ({
  request,
}) => {
  const llamar = avisoDelCliente('LLAMAR_MOZO');
  await mandarComoCliente(request, codigos['4']!, llamar);

  await test.step('los dos mozos lo ven y los dos abren la hoja para atenderlo', async () => {
    // El segundo mozo está en el mapa: le llega el aviso. El primero ya mira la lista: ahí aparece solo.
    await expect(bannerDeLlamado(mozoB.page, 'Mesa 4 · Llama al mozo')).toBeVisible();
    for (const persona of [mozoA, mozoB]) {
      await irALosLlamados(persona.page);
      await expect(enlaceDeLlamado(persona.page, '4', 'Llama al mozo')).toBeVisible();
      await botonAtender(persona.page, '4').click();
      await expect(persona.page.getByRole('dialog', { name: 'Atender la mesa 4' })).toBeVisible();
    }
  });

  await test.step('el primero confirma: la mesa queda abierta a su nombre', async () => {
    const hoja = mozoA.page.getByRole('dialog', { name: 'Atender la mesa 4' });
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(hoja).toBeHidden();
    await expect(
      mozoA.page.getByText('Atendiste a la mesa 4 y quedó abierta a tu nombre.'),
    ).toBeVisible();
  });

  await test.step('el segundo confirma después: ve quién lo tomó y no abre nada', async () => {
    const hoja = mozoB.page.getByRole('dialog', { name: 'Atender la mesa 4' });
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(hoja).toBeHidden();
    await expect(mozoB.page.getByText('No pudiste atenderlo')).toBeVisible();
    await expect(
      mozoB.page.getByText(`${e.mozo.nombre} ya está atendiendo este llamado.`),
    ).toBeVisible();
    await expect(mozoB.page.getByText('No hay llamados pendientes')).toBeVisible();
    await captura(mozoB.page, '21-segundo-mozo-ve-quien-lo-tomo');
  });

  await test.step('la mesa es del primero y solo tiene una cuenta', async () => {
    await irALasMesas(mozoB.page);
    await afirmarEstadoDeMesa(mozoB.page, '4', 'ocupada');
    await baldosaDeMesa(mozoB.page, '4').click();
    await esperarLaCuenta(mozoB.page, 'Mesa 4');
    await expect(mozoB.page.locator('.cuenta__datos')).toContainText(
      `${e.mozo.nombre} · 2 comensales`,
    );
    const estado = await estadoComoCliente<EstadoLlamadoPublico>(request, codigos['4']!, llamar.id);
    expect(estado.cuerpo.estado).toBe('ATENDIDO');
    // El intento del segundo mozo no dejó nada abierto y llevó su clave de idempotencia.
    afirmarClavesDelSalon(mozoB.escrituras, [['POST', /^\/llamados\/[^/]+\/atencion$/]]);
    afirmarClavesDelSalon(mozoA.escrituras, [['POST', /^\/llamados\/[^/]+\/atencion$/]]);
  });
});

// --- Diseño: 360 px y tableta ------------------------------------------------------------------------------

test('a 360 px, las pantallas de llamados no se desplazan de lado y sus controles miden 44 px o más', async ({
  request,
}) => {
  const { page } = mozoA;
  const pedido = pedidoDelCliente([
    { productoId: productos[CARTA.lomo]!, cantidad: 2, observacion: 'bien cocido' },
    { productoId: productos[CARTA.ceviche]!, cantidad: 1 },
  ]);
  await test.step('el aviso (con dos llamados) sobre el mapa de mesas', async () => {
    // Con la lista abierta el aviso sobra (ya está a la vista): los llamados llegan con el mapa de mesas abierto.
    await irALasMesas(page);
    const r = await mandarComoCliente<LlamadoPublico>(request, codigos['5']!, pedido);
    expect(r.estado).toBe(201);
    await expect(bannerDeLlamado(page, 'Mesa 5 · Pedido (3 platos)')).toBeVisible();
    await mandarComoCliente(request, codigos['3']!, avisoDelCliente('LLAMAR_MOZO'));
    await expect(bannerDeLlamado(page, 'Mesa 3 · Llama al mozo')).toBeVisible();
    await expect(bannerDeLlamado(page, 'Y 1 llamado más.')).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Salón > aviso de llamado');
    await captura(page, '22-aviso-360');
  });

  await test.step('la lista con dos pendientes', async () => {
    await abrirLaListaDeLlamados(page);
    await expect(
      page.getByRole('list', { name: 'Llamados pendientes' }).getByRole('listitem'),
    ).toHaveCount(2);
    await afirmarPantallaDeCelular(page, 'Salón > Llamados');
    await captura(page, '23-lista-360', true);
  });

  await test.step('el detalle de un pedido pendiente y la ventana de descartar', async () => {
    await enlaceDeLlamado(page, '5', 'Pedido').click();
    await expect(page.getByRole('heading', { name: 'Mesa 5', level: 1 })).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Llamado > detalle pendiente');
    await captura(page, '24-detalle-pendiente-360', true);
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Descartar este llamado' });
    await expect(dialogo).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Llamado > ventana de descartar');
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
  });

  await test.step('la hoja de atender y el pedido en atención, con sus controles de cantidad', async () => {
    await page.getByRole('button', { name: 'Atender', exact: true }).click();
    const hoja = page.getByRole('dialog', { name: 'Atender la mesa 5' });
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(400);
    await afirmarPantallaDeCelular(page, 'Llamado > hoja de atender');
    await hoja.getByRole('button', { name: 'Atender y abrir la mesa' }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole('button', { name: `Quitar ${CARTA.ceviche}` })).toBeVisible();
    await afirmarPantallaDeCelular(page, 'Llamado > en atención');
    await page.getByRole('button', { name: `Quitar ${CARTA.ceviche}` }).click();
    await afirmarPantallaDeCelular(page, 'Llamado > en atención con una línea quitada');
    await captura(page, '25-detalle-en-atencion-360', true);
  });

  await test.step('la cuenta con el pedido pasado', async () => {
    await page.getByRole('button', { name: 'Pasar a la cuenta' }).click();
    await esperarLaCuenta(page, 'Mesa 5');
    await afirmarPantallaDeCelular(page, 'Cuenta > pedido pasado a la cuenta');
  });
});

test('en una tableta, la lista de llamados y su detalle aprovechan el ancho', async ({
  browser,
}) => {
  const tableta = await entrar(browser, e.mozo, undefined, TABLETA);
  const { page } = tableta;
  const sinDesplazar = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );

  await test.step('la lista', async () => {
    await abrirLaListaDeLlamados(page);
    await expect(page.getByRole('list', { name: 'Llamados pendientes' })).toContainText('Mesa 3');
    expect(await sinDesplazar(), 'sin desplazamiento lateral').toBe(true);
    await captura(page, '26-lista-tableta', true);
  });

  await test.step('el detalle', async () => {
    await enlaceDeLlamado(page, '3', 'Llama al mozo').click();
    await expect(page.getByRole('heading', { name: 'Mesa 3', level: 1 })).toBeVisible();
    expect(await sinDesplazar(), 'sin desplazamiento lateral').toBe(true);
    await captura(page, '27-detalle-tableta', true);
  });
});
