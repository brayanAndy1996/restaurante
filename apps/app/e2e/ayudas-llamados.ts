import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { llamarApi, type Persona } from './ayudas';
import type { Escritura } from './ayudas-carta';
import type { EscenarioDeSalon } from './ayudas-salon';

/**
 * Preparación del E2E de los llamados desde la mesa (historia 005, entrega 5a, tarea T14). La carta web de 5b
 * todavía no existe: el cliente se simula con las peticiones que haría su navegador a la API pública
 * (`/publico/mesas/:codigo/...`). El resto (configurar la carta, ver el QR, atender, pasar a la cuenta,
 * enviar) lo hacen las personas desde la PWA.
 */

// --- Un segundo mozo --------------------------------------------------------------------------------------

/** Un segundo Mozo de S1 (con la contraseña ya cambiada), para que dos mozos atiendan el mismo llamado. */
export async function crearSegundoMozo(
  request: APIRequestContext,
  e: EscenarioDeSalon,
): Promise<Persona> {
  const sufijo = e.administrador.usuario.split('.').pop() ?? Date.now().toString(36);
  const mozo: Persona = {
    nombre: 'Mario Segundo',
    primerNombre: 'Mario',
    usuario: `e2e.llamados.mozo2.${sufijo}`,
    temporal: 'Temporal-E2E-4',
    contrasena: 'Clave-Mario-E2E-4',
    pin: '',
  };
  const admin = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: e.administrador.usuario, contrasena: e.administrador.contrasena },
  });
  expect(admin.estado, 'ingreso del Administrador por la API').toBe(201);
  const nuevo = await llamarApi<{ pin: string }>(request, '/usuarios', {
    metodo: 'POST',
    token: admin.cuerpo.token,
    cuerpo: {
      nombre: mozo.nombre,
      nombreUsuario: mozo.usuario,
      esAdministrador: false,
      accesos: [{ sucursalId: e.s1.id, rol: 'MOZO' }],
      contrasenaTemporal: mozo.temporal,
    },
  });
  expect(nuevo.estado, 'alta del segundo mozo').toBe(201);
  mozo.pin = nuevo.cuerpo.pin;
  const sesion = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: mozo.usuario, contrasena: mozo.temporal },
  });
  expect(sesion.estado).toBe(201);
  const cambio = await llamarApi(request, '/sesion/contrasena', {
    metodo: 'PUT',
    token: sesion.cuerpo.token,
    cuerpo: { actual: mozo.temporal, nueva: mozo.contrasena },
  });
  expect(cambio.estado).toBe(204);
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: sesion.cuerpo.token });
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: admin.cuerpo.token });
  return mozo;
}

// --- El cliente (API pública) ------------------------------------------------------------------------------

/** Una línea del pedido del cliente: el producto por su id público y la cantidad. */
export interface LineaDelCliente {
  productoId: string;
  cantidad: number;
  observacion?: string;
}

export type CuerpoDeLlamado =
  | { id: string; tipo: 'PEDIDO'; lineas: unknown[]; nota?: string }
  | { id: string; tipo: 'LLAMAR_MOZO' | 'PEDIR_CUENTA' };

/** El cuerpo de un pedido, con un `id` nuevo (el que genera el navegador del cliente al pulsar «Enviar»). */
export function pedidoDelCliente(
  lineas: readonly LineaDelCliente[],
  nota?: string,
): CuerpoDeLlamado {
  return {
    id: randomUUID(),
    tipo: 'PEDIDO',
    lineas: lineas.map((l) => ({
      productoId: l.productoId,
      modificadorIds: [],
      cantidad: l.cantidad,
      ...(l.observacion ? { observacion: l.observacion } : {}),
    })),
    ...(nota ? { nota } : {}),
  };
}

export const avisoDelCliente = (tipo: 'LLAMAR_MOZO' | 'PEDIR_CUENTA'): CuerpoDeLlamado => ({
  id: randomUUID(),
  tipo,
});

/** `GET /publico/mesas/:codigo`: lo que el cliente ve de su mesa al escanear el QR. */
export const verMesaComoCliente = <T = unknown>(request: APIRequestContext, codigo: string) =>
  llamarApi<T>(request, `/publico/mesas/${codigo}`);

/** `POST /publico/mesas/:codigo/llamados`: el cliente pulsa «Enviar» (sin sesión, sin clave de idempotencia: el `id` es la clave). */
export const mandarComoCliente = <T = unknown>(
  request: APIRequestContext,
  codigo: string,
  cuerpo: CuerpoDeLlamado,
) => llamarApi<T>(request, `/publico/mesas/${codigo}/llamados`, { metodo: 'POST', cuerpo });

/** `GET /publico/mesas/:codigo/llamados/:id`: el estado que ve el cliente mientras espera. */
export const estadoComoCliente = <T = { estado: string }>(
  request: APIRequestContext,
  codigo: string,
  id: string,
) => llamarApi<T>(request, `/publico/mesas/${codigo}/llamados/${id}`);

// --- Lo que la PWA le manda a la API -----------------------------------------------------------------------

/** Las escrituras de los llamados y de las cuentas que hace la PWA (`POST`, `PUT`, `PATCH`, `DELETE`), con su clave. */
const ESCRITURA_DE_LLAMADOS = /^\/(llamados|ordenes)(\/|$)/;

export function vigilarEscriturasDeLlamados(page: Page): Escritura[] {
  const escrituras: Escritura[] = [];
  page.on('request', (peticion) => {
    const metodo = peticion.method();
    if (metodo === 'GET' || metodo === 'OPTIONS') return;
    const ruta = new URL(peticion.url()).pathname;
    if (!ESCRITURA_DE_LLAMADOS.test(ruta)) return;
    escrituras.push({ metodo, ruta, clave: peticion.headers()['idempotency-key'] });
  });
  return escrituras;
}

// --- Atajos de la pantalla ----------------------------------------------------------------------------------

/** El banner de aviso de un llamado nuevo («Mesa 1 · Pedido (4 platos)»), en cualquier pantalla. */
export const bannerDeLlamado = (page: Page, texto: string | RegExp): Locator =>
  page.getByRole('status').filter({ hasText: texto });

/** El segmento «Llamados» del salón, con su contador de pendientes. */
export const segmentoDeLlamados = (page: Page): Locator =>
  page
    .getByRole('group', { name: 'Qué ver en el salón' })
    .getByRole('button', { name: /^Llamados/ });

/** Abre la lista de llamados del salón (el segmento «Llamados»). */
export async function abrirLaListaDeLlamados(page: Page): Promise<void> {
  await segmentoDeLlamados(page).click();
  await expect(page.getByRole('heading', { name: 'Pendientes', level: 2 })).toBeVisible();
}

/** La fila de un llamado pendiente, buscada por su botón «Atender la mesa N». */
export const botonAtender = (page: Page, mesa: string): Locator =>
  page.getByRole('button', { name: `Atender la mesa ${mesa}`, exact: true });

/** El enlace al detalle de un llamado pendiente, por mesa y tipo («Ver el llamado de la mesa 1: Pedido»). */
export const enlaceDeLlamado = (page: Page, mesa: string, tipo: string): Locator =>
  page.getByRole('link', { name: `Ver el llamado de la mesa ${mesa}: ${tipo}`, exact: true });
