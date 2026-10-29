import type { APIRequestContext, BrowserContextOptions, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173';
export const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const SUPERADMIN_USUARIO = process.env.E2E_SUPERADMIN_USUARIO ?? 'superadmin';
const SUPERADMIN_CONTRASENA = process.env.E2E_SUPERADMIN_CONTRASENA ?? 'Superadmin-Demo-1';

/** El celular de las personas del restaurante: 360 px de ancho, táctil, hora de Lima. */
export const CELULAR: BrowserContextOptions = {
  baseURL: APP,
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'es-PE',
  timezoneId: 'America/Lima',
  // El service worker de la PWA solo guarda archivos estáticos; se bloquea para que cada corrida sea limpia.
  serviceWorkers: 'block',
};

/** La computadora del administrador (otro equipo, otra pantalla). */
export const COMPUTADORA: BrowserContextOptions = {
  baseURL: APP,
  viewport: { width: 1280, height: 800 },
  locale: 'es-PE',
  timezoneId: 'America/Lima',
  serviceWorkers: 'block',
};

// --- API directa (solo para preparar los datos de la prueba) ----------------------------------------

interface OpcionesApi {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  token?: string;
  equipo?: string;
}

export async function llamarApi<T = unknown>(
  request: APIRequestContext,
  ruta: string,
  { metodo = 'GET', cuerpo, token, equipo }: OpcionesApi = {},
): Promise<{ estado: number; cuerpo: T }> {
  const respuesta = await request.fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(equipo ? { 'X-Equipo': equipo } : {}),
    },
    ...(cuerpo === undefined ? {} : { data: cuerpo }),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status(), cuerpo: (texto ? JSON.parse(texto) : null) as T };
}

/** Dígito verificador de un RUC (módulo 11), para generar RUC válidos y distintos en cada corrida. */
function rucValido(base10: string): string {
  const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = factores.reduce((s, f, i) => s + f * Number(base10[i]), 0);
  const resto = 11 - (suma % 11);
  return base10 + String(resto >= 10 ? resto - 10 : resto);
}

export interface Persona {
  nombre: string;
  primerNombre: string;
  usuario: string;
  /** Contraseña temporal con la que entra por primera vez (la cambia en el primer ingreso). */
  temporal: string;
  /** Contraseña definitiva, cuando ya la cambió. */
  contrasena: string;
  pin: string;
}

export interface Escenario {
  /** Token del superadministrador (para ajustar la suscripción de la sucursal). */
  superadmin: string;
  suscripcionId: string;
  cajero: Persona;
  supervisor: Persona;
  empresaId: string;
  empresaNombre: string;
  sucursalId: string;
  sucursalNombre: string;
  administrador: Persona;
  mozo: Persona;
}

const SOLO_DIGITOS = (texto: string) => /^\d+$/.test(texto);

/**
 * Crea por la API una empresa nueva con su Administrador (con la contraseña ya cambiada) y un Mozo con
 * contraseña temporal. Los nombres llevan un sufijo único, así que la prueba se puede repetir sobre la
 * misma base.
 */
export async function crearEscenario(request: APIRequestContext): Promise<Escenario> {
  const sufijo = Date.now().toString(36);
  const ingreso = await llamarApi<{ token: string }>(request, '/plataforma/sesiones', {
    metodo: 'POST',
    cuerpo: { usuario: SUPERADMIN_USUARIO, contrasena: SUPERADMIN_CONTRASENA },
  });
  expect(ingreso.estado, 'ingreso del superadministrador (¿corriste pnpm db:semilla?)').toBe(201);
  const superadmin = ingreso.cuerpo.token;

  const ruc = rucValido(`20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
  const administrador: Persona = {
    nombre: 'Marta Prueba',
    primerNombre: 'Marta',
    usuario: `e2e.admin.${sufijo}`,
    temporal: 'Temporal-E2E-1',
    contrasena: 'Clave-Admin-E2E-1',
    pin: '',
  };
  const empresaNombre = `E2E Cevichería ${sufijo}`;
  const sucursalNombre = `E2E Sucursal ${sufijo}`;
  const alta = await llamarApi<{
    empresaId: string;
    sucursales: { id: string; suscripcion: { id: string } }[];
    administrador: { pin: string };
  }>(request, '/plataforma/empresas', {
    metodo: 'POST',
    token: superadmin,
    cuerpo: {
      nombre: empresaNombre,
      emisores: [{ ruc, razonSocial: `E2E ${sufijo} S.A.C.`, regimen: 'GENERAL' }],
      sucursales: [
        {
          rucEmisor: ruc,
          nombre: sucursalNombre,
          codigoEstablecimiento: '0001',
          direccion: 'Av. de las Pruebas 123, Lima',
        },
      ],
      administrador: {
        nombre: administrador.nombre,
        nombreUsuario: administrador.usuario,
        contrasenaTemporal: administrador.temporal,
      },
      motivo: 'Prueba E2E del acceso con PIN',
    },
  });
  expect(alta.estado, 'alta de la empresa de la prueba').toBe(201);
  administrador.pin = alta.cuerpo.administrador.pin;
  const sucursalId = alta.cuerpo.sucursales[0]!.id;

  // El Administrador cambia su contraseña temporal (sin recordar ningún equipo: eso lo hace la prueba).
  const entrada = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: administrador.usuario, contrasena: administrador.temporal },
  });
  expect(entrada.estado).toBe(201);
  const cambio = await llamarApi(request, '/sesion/contrasena', {
    metodo: 'PUT',
    token: entrada.cuerpo.token,
    cuerpo: { actual: administrador.temporal, nueva: administrador.contrasena },
  });
  expect(cambio.estado).toBe(204);

  // El Mozo queda con contraseña temporal: la cambia en la prueba, como en la vida real.
  const mozo: Persona = {
    nombre: 'Lucía Prueba',
    primerNombre: 'Lucía',
    usuario: `e2e.mozo.${sufijo}`,
    temporal: 'Temporal-E2E-2',
    contrasena: 'Clave-Mozo-E2E-2',
    pin: '',
  };
  const creado = await llamarApi<{ pin: string }>(request, '/usuarios', {
    metodo: 'POST',
    token: entrada.cuerpo.token,
    cuerpo: {
      nombre: mozo.nombre,
      nombreUsuario: mozo.usuario,
      esAdministrador: false,
      accesos: [{ sucursalId, rol: 'MOZO' }],
      contrasenaTemporal: mozo.temporal,
    },
  });
  expect(creado.estado, 'alta del mozo').toBe(201);
  mozo.pin = creado.cuerpo.pin;
  expect(SOLO_DIGITOS(administrador.pin) && administrador.pin.length === 6).toBe(true);
  expect(SOLO_DIGITOS(mozo.pin) && mozo.pin.length === 4).toBe(true);

  // Un Cajero y un Supervisor (PIN de 6 dígitos), con la contraseña ya cambiada: se usan para la ventana
  // de clave de supervisor. El Cajero pide la clave; el Supervisor la da.
  async function crearConRol(
    rol: 'CAJERO' | 'SUPERVISOR',
    nombre: string,
    primerNombre: string,
  ): Promise<Persona> {
    const persona: Persona = {
      nombre,
      primerNombre,
      usuario: `e2e.${rol.toLowerCase()}.${sufijo}`,
      temporal: 'Temporal-E2E-3',
      contrasena: `Clave-${primerNombre}-E2E-3`,
      pin: '',
    };
    const nuevo = await llamarApi<{ pin: string }>(request, '/usuarios', {
      metodo: 'POST',
      token: entrada.cuerpo.token,
      cuerpo: {
        nombre,
        nombreUsuario: persona.usuario,
        esAdministrador: false,
        accesos: [{ sucursalId, rol }],
        contrasenaTemporal: persona.temporal,
      },
    });
    expect(nuevo.estado, `alta de ${rol}`).toBe(201);
    persona.pin = nuevo.cuerpo.pin;
    expect(persona.pin).toMatch(/^\d{6}$/);
    const sesion = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
      metodo: 'POST',
      cuerpo: { usuario: persona.usuario, contrasena: persona.temporal },
    });
    expect(sesion.estado).toBe(201);
    const cambioDePersona = await llamarApi(request, '/sesion/contrasena', {
      metodo: 'PUT',
      token: sesion.cuerpo.token,
      cuerpo: { actual: persona.temporal, nueva: persona.contrasena },
    });
    expect(cambioDePersona.estado).toBe(204);
    await llamarApi(request, '/sesion', { metodo: 'DELETE', token: sesion.cuerpo.token });
    return persona;
  }
  const cajero = await crearConRol('CAJERO', 'Carlos Caja', 'Carlos');
  const supervisor = await crearConRol('SUPERVISOR', 'Rosa Supervisora', 'Rosa');

  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: entrada.cuerpo.token });
  return {
    superadmin,
    suscripcionId: alta.cuerpo.sucursales[0]!.suscripcion.id,
    cajero,
    supervisor,
    empresaId: alta.cuerpo.empresaId,
    empresaNombre,
    sucursalId,
    sucursalNombre,
    administrador,
    mozo,
  };
}

// --- Acciones sobre la PWA ----------------------------------------------------------------------------

/** Escribe el PIN con el teclado de la pantalla (el del sistema nunca se abre). */
export async function escribirPin(page: Page, pin: string): Promise<void> {
  for (const digito of pin) {
    await page.getByRole('button', { name: digito, exact: true }).click();
  }
}

/** Ingresa en la pantalla de usuario y contraseña. */
export async function ingresarConContrasena(
  page: Page,
  usuario: string,
  contrasena: string,
): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Ingresa' })).toBeVisible();
  await page.getByLabel('Usuario').fill(usuario);
  await page.getByLabel('Contraseña', { exact: true }).fill(contrasena);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}

/** Un PIN del largo de `pin` que seguro no es el suyo. */
export function pinEquivocado(pin: string): string {
  const otro = pin === '1'.repeat(pin.length) ? '2' : '1';
  return otro.repeat(pin.length);
}

/** Abre la hoja de la sesión (la inicial de la persona, arriba a la derecha). */
export async function abrirSesion(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Sesión de / }).click();
  await expect(page.getByRole('heading', { name: 'Tu sesión' })).toBeVisible();
}

/** Tokens de equipo guardados por la PWA en este navegador (`empresaId → token`). */
export async function tokensDeEquipo(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('restaurante.equipos') ?? '{}'));
}

/** Token de la sesión de empresa guardado en esta pestaña. */
export async function tokenDeSesion(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (JSON.parse(sessionStorage.getItem('restaurante.sesion') ?? '{}') as { token?: string })
        .token ?? '',
  );
}

/** Fecha de hoy en Lima (`AAAA-MM-DD`), desplazada `dias` días. */
export function fechaDeLima(dias = 0): string {
  const base = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

/** Fija el vencimiento de la suscripción de la sucursal (como lo haría el superadministrador). */
export async function ajustarVencimiento(
  request: APIRequestContext,
  escenario: Escenario,
  vencimiento: string,
): Promise<void> {
  const r = await llamarApi(request, `/plataforma/suscripciones/${escenario.suscripcionId}`, {
    metodo: 'PATCH',
    token: escenario.superadmin,
    cuerpo: { vencimiento, motivo: 'Prueba E2E del aviso de suscripción' },
  });
  expect(r.estado, 'ajuste del vencimiento').toBe(200);
}

/**
 * La barra de la sesión dice quién entró. Es la señal común a todos los roles, sea cual sea su pantalla
 * inicial (Salón o Cocina, criterio 87 de 004).
 */
export async function afirmarSesionDe(pagina: Page, persona: { nombre: string }): Promise<void> {
  await expect(pagina.getByRole('button', { name: `Sesión de ${persona.nombre}` })).toBeVisible();
}
