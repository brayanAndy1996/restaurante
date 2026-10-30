import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { llamarApi, tokenDeSesion, type Persona } from './ayudas';
import { crearEscenarioDeCarta, type Escritura, type EscenarioDeCarta } from './ayudas-carta';

/**
 * Preparación del E2E del salón y la cocina (historia 004, entrega 3a). La empresa, sus personas y la carta se
 * crean por la API (es el alta y la carga inicial, no lo que se prueba); el mapa de mesas y todo el servicio lo
 * hacen las personas desde la PWA.
 */

export interface EscenarioDeSalon extends EscenarioDeCarta {
  /** Quien da la clave para anular un ítem enviado (PIN de 6 dígitos). */
  supervisor: Persona;
}

/** Los productos de la carta de la prueba, con la estación donde se preparan. */
export const CARTA = {
  estaciones: { cocina: 'Cocina', barra: 'Barra' },
  familias: { fondos: 'Fondos', bebidas: 'Bebidas' },
  lomo: 'Lomo saltado',
  arroz: 'Arroz chaufa',
  ceviche: 'Ceviche mixto',
  gaseosa: 'Gaseosa de la casa',
  combo: 'Combo criollo',
} as const;

/** Precios con IGV de cada producto, como los muestra la PWA (`S/ 28.00`). */
export const PRECIOS = {
  lomo: 'S/ 28.00',
  ceviche: 'S/ 38.00',
  gaseosa: 'S/ 6.00',
  combo: 'S/ 40.00',
} as const;

async function ingresarPorApi(request: APIRequestContext, persona: Persona): Promise<string> {
  const entrada = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: persona.usuario, contrasena: persona.contrasena },
  });
  expect(entrada.estado, `ingreso de ${persona.usuario}`).toBe(201);
  return entrada.cuerpo.token;
}

/**
 * La empresa de la corrida (Administrador, Cocina/Barra, Cajero y Mozo de S1, como en la carta) más un
 * Supervisor, con la carta ya cargada: dos estaciones, dos familias, cuatro productos simples y un combo con
 * un componente de cada estación. El mapa de mesas queda vacío: lo diseña el Administrador en la prueba.
 */
export async function crearEscenarioDeSalon(request: APIRequestContext): Promise<EscenarioDeSalon> {
  const base = await crearEscenarioDeCarta(request);
  const token = await ingresarPorApi(request, base.administrador);

  const sufijo = base.administrador.usuario.split('.').pop() ?? Date.now().toString(36);
  const supervisor: Persona = {
    nombre: 'Rosa Supervisora',
    primerNombre: 'Rosa',
    usuario: `e2e.salon.supervisor.${sufijo}`,
    temporal: 'Temporal-E2E-3',
    contrasena: 'Clave-Rosa-E2E-3',
    pin: '',
  };
  const nuevo = await llamarApi<{ pin: string }>(request, '/usuarios', {
    metodo: 'POST',
    token,
    cuerpo: {
      nombre: supervisor.nombre,
      nombreUsuario: supervisor.usuario,
      esAdministrador: false,
      accesos: [{ sucursalId: base.s1.id, rol: 'SUPERVISOR' }],
      contrasenaTemporal: supervisor.temporal,
    },
  });
  expect(nuevo.estado, 'alta del supervisor').toBe(201);
  supervisor.pin = nuevo.cuerpo.pin;
  expect(supervisor.pin).toMatch(/^\d{6}$/);
  const sesionSupervisor = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: supervisor.usuario, contrasena: supervisor.temporal },
  });
  expect(sesionSupervisor.estado).toBe(201);
  const cambio = await llamarApi(request, '/sesion/contrasena', {
    metodo: 'PUT',
    token: sesionSupervisor.cuerpo.token,
    cuerpo: { actual: supervisor.temporal, nueva: supervisor.contrasena },
  });
  expect(cambio.estado).toBe(204);
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: sesionSupervisor.cuerpo.token });

  // La carta: lo mínimo para comandar con ruteo por estación y un combo que reparte su preparación.
  async function crear<T extends { id: string }>(ruta: string, cuerpo: unknown): Promise<T> {
    const r = await llamarApi<T>(request, ruta, {
      metodo: 'POST',
      token,
      cuerpo,
      idempotente: true,
    });
    expect(r.estado, `POST ${ruta} ${JSON.stringify(cuerpo)}`).toBe(201);
    return r.cuerpo;
  }
  const cocina = await crear('/carta/estaciones', { nombre: CARTA.estaciones.cocina });
  const barra = await crear('/carta/estaciones', { nombre: CARTA.estaciones.barra });
  const fondos = await crear('/carta/familias', { nombre: CARTA.familias.fondos });
  const bebidas = await crear('/carta/familias', { nombre: CARTA.familias.bebidas });
  const simple = (nombre: string, precio: string, familiaId: string, estacionId: string) =>
    crear<{ id: string }>('/carta/productos', {
      tipo: 'SIMPLE',
      nombre,
      familiaId,
      precio,
      estacionId,
      tipoControlStock: 'SIN_CONTROL',
    });
  await simple(CARTA.lomo, '28.00', fondos.id, cocina.id);
  const arroz = await simple(CARTA.arroz, '18.00', fondos.id, cocina.id);
  await simple(CARTA.ceviche, '38.00', fondos.id, cocina.id);
  const gaseosa = await simple(CARTA.gaseosa, '6.00', bebidas.id, barra.id);
  await crear('/carta/productos', {
    tipo: 'COMBO',
    nombre: CARTA.combo,
    familiaId: fondos.id,
    precio: '40.00',
    tipoControlStock: 'SIN_CONTROL',
    componentes: [
      { productoId: arroz.id, cantidad: 1 },
      { productoId: gaseosa.id, cantidad: 1 },
    ],
  });

  await llamarApi(request, '/sesion', { metodo: 'DELETE', token });
  return { ...base, supervisor };
}

// --- Lo que la PWA le manda a la API ---------------------------------------------------------------------

/** Las escrituras del salón y la cocina: órdenes, comandas, autorizaciones y el mapa de mesas. */
const ESCRITURA_DE_SALON =
  /^\/(ordenes|cocina|autorizaciones)(\/|$)|^\/sucursales\/[^/]+\/(zonas|mesas)(\/|$)/;

/** Anota cada escritura (`POST`, `PUT`, `PATCH`, `DELETE`) del salón y la cocina que hace la PWA, con su clave. */
export function vigilarEscriturasDelSalon(page: Page): Escritura[] {
  const escrituras: Escritura[] = [];
  page.on('request', (peticion) => {
    const metodo = peticion.method();
    if (metodo === 'GET' || metodo === 'OPTIONS') return;
    const ruta = new URL(peticion.url()).pathname;
    if (!ESCRITURA_DE_SALON.test(ruta)) return;
    escrituras.push({ metodo, ruta, clave: peticion.headers()['idempotency-key'] });
  });
  return escrituras;
}

/**
 * Toda escritura del salón y la cocina lleva su clave de idempotencia (regla del proyecto), y se vieron las
 * que se esperaban: así el chequeo no pasa "por no haber mirado nada". Cada esperada es `METODO /ruta`
 * (la ruta como expresión regular sobre el camino de la URL).
 */
export function afirmarClavesDelSalon(
  escrituras: readonly Escritura[],
  esperadas: readonly [metodo: string, ruta: RegExp][],
): void {
  expect(
    escrituras.filter((w) => !w.clave).map((w) => `${w.metodo} ${w.ruta}`),
    'escrituras del salón sin Idempotency-Key',
  ).toEqual([]);
  for (const [metodo, ruta] of esperadas) {
    expect(
      escrituras.some((w) => w.metodo === metodo && ruta.test(w.ruta)),
      `se esperaba al menos un ${metodo} ${ruta}`,
    ).toBe(true);
  }
}

// --- Atajos de la pantalla ---------------------------------------------------------------------------

/** Un destino de la navegación inferior ("Salón", "Cocina", "Ajustes"…). */
export const destino = (page: Page, nombre: string): Locator =>
  page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: nombre });

/** La baldosa de una mesa en el mapa del salón (por su número: "Mesa 1, 4 personas, cuadrada, Libre"). */
export const baldosaDeMesa = (page: Page, nombre: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^Mesa ${nombre},`) });

export type EstadoVisible = 'libre' | 'ocupada' | 'en-precuenta';

/** Color de un token de la hoja de estilos (`--color-peligro`), tal como lo resuelve el navegador. */
async function colorDeToken(page: Page, token: string): Promise<string> {
  return page.evaluate((nombre) => {
    const sonda = document.createElement('span');
    sonda.style.borderTop = `3px solid var(${nombre})`;
    document.body.append(sonda);
    const color = getComputedStyle(sonda).borderTopColor;
    sonda.remove();
    return color;
  }, token);
}

/**
 * La mesa está en ese estado: lo dice con palabras ("Ocupada", "Pre-cuenta"), lleva su clase y su borde tiene el color
 * del estado (rojo para ocupada, amarillo para pre-cuenta). Sirve para mirar el mapa en vivo, sin recargar.
 */
export async function afirmarEstadoDeMesa(
  page: Page,
  nombre: string,
  estado: EstadoVisible,
): Promise<void> {
  const baldosa = baldosaDeMesa(page, nombre);
  const palabra = { libre: 'Libre', ocupada: 'Ocupada', 'en-precuenta': 'Pre-cuenta' }[estado];
  await expect(baldosa, `la mesa ${nombre} está ${palabra}`).toHaveClass(
    new RegExp(`ui-mesa--${estado}\\b`),
  );
  await expect(baldosa).toHaveAttribute('aria-label', new RegExp(`, ${palabra}\\b`));
  if (estado === 'libre') return;
  const token = estado === 'ocupada' ? '--color-peligro' : '--color-aviso-texto';
  const esperado = await colorDeToken(page, token);
  await expect(baldosa).toHaveCSS('border-top-color', esperado);
}

/** La cuenta abierta de una mesa: la señal de que se llegó a `/salon/ordenes/:id`. */
export async function esperarLaCuenta(page: Page, titulo: string): Promise<string> {
  await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/salon\/ordenes\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

/** La fila de un ítem en la cuenta. */
export const itemDeCuenta = (donde: Page | Locator, nombre: string): Locator =>
  donde.locator('.item', { hasText: nombre });

/** La tarjeta de una comanda en la cocina: "Comanda, Mesa 1, Cocina". */
export const tarjetaDeCocina = (
  page: Page,
  tipo: 'Comanda' | 'Adición' | 'Marchar' | 'Anulación',
  mesa: string,
  estacion: string,
): Locator => page.getByRole('article', { name: `${tipo}, ${mesa}, ${estacion}`, exact: true });

/** La cuenta tal como la ve la API (para comprobar lo que la pantalla dice). */
export async function cuentaPorApi<T = { items: { nombre: string; cantidad: number }[] }>(
  request: APIRequestContext,
  page: Page,
  ordenId: string,
): Promise<T> {
  const r = await llamarApi<T>(request, `/ordenes/${ordenId}`, {
    token: await tokenDeSesion(page),
  });
  expect(r.estado, 'GET de la cuenta').toBe(200);
  return r.cuerpo;
}

/** Abre el comandero desde la cuenta y deja la carta a la vista. */
export async function abrirElComandero(page: Page, titulo: string): Promise<void> {
  await page.getByRole('link', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Agregar a ${titulo}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Carta' })).toBeVisible();
}

/** Toca un producto de la carta del comandero; abre su hoja. */
export async function elegirProducto(page: Page, nombre: string, precio: string): Promise<Locator> {
  await page.getByRole('button', { name: `${nombre}, ${precio}`, exact: true }).click();
  const hoja = page.getByRole('dialog', { name: nombre });
  await expect(hoja).toBeVisible();
  return hoja;
}
