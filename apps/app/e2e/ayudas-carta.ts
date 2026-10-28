import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from '@playwright/test';
import { expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { CELULAR, ingresarConContrasena, llamarApi, type Persona } from './ayudas';

/**
 * Preparación del E2E de la carta (historia 003, sección 2): una empresa con dos sucursales y una persona
 * por rol. La empresa, sus dos sucursales, el Administrador y sus tres colaboradores se crean por la API
 * (es el alta de la plataforma, no lo que se prueba); todo lo de la carta se hace desde la PWA.
 */

const SUPERADMIN_USUARIO = process.env.E2E_SUPERADMIN_USUARIO ?? 'superadmin';
const SUPERADMIN_CONTRASENA = process.env.E2E_SUPERADMIN_CONTRASENA ?? 'Superadmin-Demo-1';

export interface EscenarioDeCarta {
  empresaId: string;
  empresaNombre: string;
  /** La sucursal donde trabajan Cocina/Barra, el Cajero y el Mozo (y donde entra el Administrador). */
  s1: { id: string; nombre: string };
  /** La otra sucursal: nadie más que el Administrador tiene acceso a ella. */
  s2: { id: string; nombre: string };
  administrador: Persona;
  cocina: Persona;
  cajero: Persona;
  mozo: Persona;
}

/** Dígito verificador de un RUC (módulo 11), para generar RUC válidos y distintos en cada corrida. */
function rucValido(base10: string): string {
  const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = factores.reduce((s, f, i) => s + f * Number(base10[i]), 0);
  const resto = 11 - (suma % 11);
  return base10 + String(resto >= 10 ? resto - 10 : resto);
}

/** Cambia por la API la contraseña temporal de alguien y cierra esa sesión: queda lista para entrar por la PWA. */
async function fijarContrasena(
  request: APIRequestContext,
  usuario: string,
  temporal: string,
  definitiva: string,
): Promise<void> {
  const sesion = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario, contrasena: temporal },
  });
  expect(sesion.estado, `ingreso de ${usuario}`).toBe(201);
  const cambio = await llamarApi(request, '/sesion/contrasena', {
    metodo: 'PUT',
    token: sesion.cuerpo.token,
    cuerpo: { actual: temporal, nueva: definitiva },
  });
  expect(cambio.estado, `cambio de contraseña de ${usuario}`).toBe(204);
  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: sesion.cuerpo.token });
}

/** Crea la empresa de la corrida con dos sucursales y a las cuatro personas del recorrido. */
export async function crearEscenarioDeCarta(request: APIRequestContext): Promise<EscenarioDeCarta> {
  const sufijo = Date.now().toString(36);
  const ingreso = await llamarApi<{ token: string }>(request, '/plataforma/sesiones', {
    metodo: 'POST',
    cuerpo: { usuario: SUPERADMIN_USUARIO, contrasena: SUPERADMIN_CONTRASENA },
  });
  expect(ingreso.estado, 'ingreso del superadministrador (¿corriste pnpm db:semilla?)').toBe(201);

  const ruc = rucValido(`20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
  const administrador: Persona = {
    nombre: 'Marta Carta',
    primerNombre: 'Marta',
    usuario: `e2e.carta.admin.${sufijo}`,
    temporal: 'Temporal-E2E-1',
    contrasena: 'Clave-Admin-E2E-1',
    pin: '',
  };
  const empresaNombre = `E2E Carta ${sufijo}`;
  const s1Nombre = `Miraflores ${sufijo}`;
  const s2Nombre = `Surco ${sufijo}`;
  const alta = await llamarApi<{
    empresaId: string;
    sucursales: { id: string; nombre: string }[];
    administrador: { pin: string };
  }>(request, '/plataforma/empresas', {
    metodo: 'POST',
    token: ingreso.cuerpo.token,
    cuerpo: {
      nombre: empresaNombre,
      emisores: [{ ruc, razonSocial: `E2E Carta ${sufijo} S.A.C.`, regimen: 'GENERAL' }],
      sucursales: [
        {
          rucEmisor: ruc,
          nombre: s1Nombre,
          codigoEstablecimiento: '0001',
          direccion: 'Av. de las Pruebas 123, Miraflores',
        },
        {
          rucEmisor: ruc,
          nombre: s2Nombre,
          codigoEstablecimiento: '0002',
          direccion: 'Av. de las Pruebas 456, Surco',
        },
      ],
      administrador: {
        nombre: administrador.nombre,
        nombreUsuario: administrador.usuario,
        contrasenaTemporal: administrador.temporal,
      },
      motivo: 'Prueba E2E de la carta',
    },
  });
  expect(alta.estado, 'alta de la empresa de la prueba').toBe(201);
  administrador.pin = alta.cuerpo.administrador.pin;
  const s1 = alta.cuerpo.sucursales.find((s) => s.nombre === s1Nombre);
  const s2 = alta.cuerpo.sucursales.find((s) => s.nombre === s2Nombre);
  expect(s1 && s2, 'las dos sucursales de la empresa').toBeTruthy();

  await fijarContrasena(
    request,
    administrador.usuario,
    administrador.temporal,
    administrador.contrasena,
  );
  const entrada = await llamarApi<{ token: string }>(request, '/sesiones/contrasena', {
    metodo: 'POST',
    cuerpo: { usuario: administrador.usuario, contrasena: administrador.contrasena },
  });
  expect(entrada.estado).toBe(201);

  async function crearConRol(
    rol: 'COCINA_BARRA' | 'CAJERO' | 'MOZO',
    nombre: string,
    primerNombre: string,
  ): Promise<Persona> {
    const persona: Persona = {
      nombre,
      primerNombre,
      usuario: `e2e.carta.${rol.toLowerCase()}.${sufijo}`,
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
        accesos: [{ sucursalId: s1!.id, rol }],
        contrasenaTemporal: persona.temporal,
      },
    });
    expect(nuevo.estado, `alta de ${rol}`).toBe(201);
    persona.pin = nuevo.cuerpo.pin;
    await fijarContrasena(request, persona.usuario, persona.temporal, persona.contrasena);
    return persona;
  }
  const cocina = await crearConRol('COCINA_BARRA', 'Pedro Cocina', 'Pedro');
  const cajero = await crearConRol('CAJERO', 'Carla Caja', 'Carla');
  const mozo = await crearConRol('MOZO', 'Lucía Salón', 'Lucía');

  await llamarApi(request, '/sesion', { metodo: 'DELETE', token: entrada.cuerpo.token });
  return {
    empresaId: alta.cuerpo.empresaId,
    empresaNombre,
    s1: { id: s1!.id, nombre: s1Nombre },
    s2: { id: s2!.id, nombre: s2Nombre },
    administrador,
    cocina,
    cajero,
    mozo,
  };
}

/**
 * Abre un celular nuevo (sin equipos recordados, sin sesión) e ingresa con usuario y contraseña. Quien tiene
 * acceso a varias sucursales (el Administrador) elige la que se le pide.
 */
export async function entrarEnCelular(
  browser: Browser,
  persona: Persona,
  sucursal?: string,
  opciones: BrowserContextOptions = CELULAR,
): Promise<{ contexto: BrowserContext; page: Page; escrituras: Escritura[] }> {
  const contexto = await browser.newContext(opciones);
  const page = await contexto.newPage();
  const escrituras = vigilarEscrituras(page);
  await page.goto('/');
  await ingresarConContrasena(page, persona.usuario, persona.contrasena);
  if (sucursal) {
    await expect(page.getByRole('heading', { name: 'Elige tu sucursal' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(sucursal) }).click();
  }
  await expect(page.getByRole('heading', { name: `Hola, ${persona.primerNombre}` })).toBeVisible();
  return { contexto, page, escrituras };
}

/** Una escritura a `/carta` que la PWA mandó a la API: el método, la ruta y la clave de idempotencia que llevó. */
export interface Escritura {
  metodo: string;
  ruta: string;
  clave: string | undefined;
}

/** Anota cada escritura a `/carta` que hace la PWA (los `POST`, `PUT`, `PATCH` y `DELETE`), con su clave. */
function vigilarEscrituras(page: Page): Escritura[] {
  const escrituras: Escritura[] = [];
  page.on('request', (peticion) => {
    const url = new URL(peticion.url());
    if (!url.pathname.startsWith('/carta') || peticion.method() === 'GET') return;
    if (peticion.method() === 'OPTIONS') return;
    escrituras.push({
      metodo: peticion.method(),
      ruta: url.pathname,
      clave: peticion.headers()['idempotency-key'],
    });
  });
  return escrituras;
}

/**
 * Toda escritura de la carta lleva su clave de idempotencia (criterio 78 y reglas del proyecto), y se vieron
 * al menos los métodos que se esperaban: así el chequeo no pasa "por no haber mirado nada".
 */
export function afirmarClavesDeIdempotencia(
  escrituras: readonly Escritura[],
  metodos: string[],
): void {
  expect(
    escrituras.filter((w) => !w.clave).map((w) => `${w.metodo} ${w.ruta}`),
    'escrituras de la carta sin Idempotency-Key',
  ).toEqual([]);
  for (const metodo of metodos) {
    expect(
      escrituras.some((w) => w.metodo === metodo),
      `se esperaba al menos un ${metodo} a /carta`,
    ).toBe(true);
  }
}

// --- Una foto de prueba ----------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabecera.subarray(4), datos])), 0);
  return Buffer.concat([cabecera, datos, crc]);
}

/** Un PNG de 480 × 360 con un degradado (más de 200 píxeles de lado: lo que pide la carta). */
export function fotoDePrueba(): Buffer {
  const ancho = 480;
  const alto = 360;
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const inicio = y * (ancho * 3 + 1);
    filas[inicio] = 0; // sin filtro
    for (let x = 0; x < ancho; x++) {
      const i = inicio + 1 + x * 3;
      filas[i] = 200 - Math.round((y / alto) * 80); // rojo
      filas[i + 1] = 90 + Math.round((x / ancho) * 90); // verde
      filas[i + 2] = 40;
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8; // 8 bits por canal
  cabecera[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(filas)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}
