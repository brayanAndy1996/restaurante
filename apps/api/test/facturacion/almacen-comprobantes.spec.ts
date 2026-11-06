import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargarEntorno } from '../../src/config/entorno';
import {
  AlmacenComprobantesEnDisco,
  AlmacenComprobantesEnMemoria,
  AlmacenComprobantesR2,
  claveDeArchivoDeComprobante,
  crearAlmacenDeComprobantesDeEntorno,
} from '../../src/nucleo/archivos';

// Pruebas del desarrollador (no protegidas) del almacén privado de comprobantes (historia 006, criterio 131): memoria,
// disco y R2 guardan y leen bajo las claves `comprobantes/<empresaId>/<comprobanteId>/…`.

const EMPRESA = '11111111-1111-1111-1111-111111111111';
const COMPROBANTE = '22222222-2222-2222-2222-222222222222';
const CLAVE = claveDeArchivoDeComprobante(EMPRESA, COMPROBANTE, 'documento.xml');

describe('claves de los archivos', () => {
  it('llevan la empresa y el comprobante', () => {
    expect(CLAVE).toBe(`comprobantes/${EMPRESA}/${COMPROBANTE}/documento.xml`);
    expect(claveDeArchivoDeComprobante(EMPRESA, COMPROBANTE, 'cdr.zip')).toBe(
      `comprobantes/${EMPRESA}/${COMPROBANTE}/cdr.zip`,
    );
  });
});

describe('AlmacenComprobantesEnMemoria', () => {
  it('guarda, lee y sobrescribe la misma clave', async () => {
    const almacen = new AlmacenComprobantesEnMemoria();
    expect(await almacen.leer(CLAVE)).toBeNull();
    await almacen.guardar(CLAVE, Buffer.from('uno'), 'application/xml');
    await almacen.guardar(CLAVE, Buffer.from('dos'), 'application/xml');
    expect((await almacen.leer(CLAVE))?.toString()).toBe('dos');
    expect(almacen.claves()).toEqual([CLAVE]);
  });
});

describe('AlmacenComprobantesEnDisco', () => {
  let carpeta: string;
  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'comprobantes-'));
  });
  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  it('guarda y lee bajo la carpeta, y lo que no existe es null', async () => {
    const almacen = new AlmacenComprobantesEnDisco(carpeta);
    expect(await almacen.leer(CLAVE)).toBeNull();
    await almacen.guardar(CLAVE, Buffer.from('<xml/>'), 'application/xml');
    expect((await almacen.leer(CLAVE))?.toString()).toBe('<xml/>');
    expect(await readdir(join(carpeta, 'comprobantes', EMPRESA, COMPROBANTE))).toEqual([
      'documento.xml',
    ]);
  });

  it.each(['../fuera.xml', 'comprobantes/../../x', '/etc/passwd', 'a//b', '', 'a b/c.xml'])(
    'rechaza la clave %j',
    async (clave) => {
      const almacen = new AlmacenComprobantesEnDisco(carpeta);
      await expect(almacen.guardar(clave, Buffer.from('x'), 'text/plain')).rejects.toThrow(
        RangeError,
      );
      await expect(almacen.leer(clave)).rejects.toThrow(RangeError);
    },
  );
});

describe('AlmacenComprobantesR2', () => {
  function conRespuestas(respuestas: Response[]) {
    const peticiones: Request[] = [];
    const fetchFalso = (async (entrada: Request | string) => {
      peticiones.push(entrada as Request);
      return respuestas.shift() ?? new Response(null, { status: 500 });
    }) as unknown as typeof fetch;
    const almacen = new AlmacenComprobantesR2({
      cuentaId: 'cuenta',
      accessKeyId: 'clave',
      secretAccessKey: 'secreto',
      bucket: 'privado',
      fetch: fetchFalso,
    });
    return { almacen, peticiones };
  }

  it('guarda con PUT firmado en el bucket privado y sin caché pública', async () => {
    const { almacen, peticiones } = conRespuestas([new Response(null, { status: 200 })]);
    await almacen.guardar(CLAVE, Buffer.from('<xml/>'), 'application/xml');
    const [peticion] = peticiones;
    expect(peticion?.method).toBe('PUT');
    expect(peticion?.url).toBe(
      `https://cuenta.r2.cloudflarestorage.com/privado/comprobantes/${EMPRESA}/${COMPROBANTE}/documento.xml`,
    );
    expect(peticion?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(peticion?.headers.get('cache-control')).toBe('private, no-store');
  });

  it('lee con GET; un 404 es null y otro error lanza', async () => {
    const lectura = conRespuestas([new Response('contenido', { status: 200 })]);
    expect((await lectura.almacen.leer(CLAVE))?.toString()).toBe('contenido');
    expect(lectura.peticiones[0]?.method).toBe('GET');
    expect(
      await conRespuestas([new Response(null, { status: 404 })]).almacen.leer(CLAVE),
    ).toBeNull();
    await expect(
      conRespuestas([new Response(null, { status: 403 })]).almacen.leer(CLAVE),
    ).rejects.toThrow(/HTTP 403/);
    await expect(
      conRespuestas([new Response(null, { status: 500 })]).almacen.guardar(
        CLAVE,
        Buffer.from('x'),
        'application/xml',
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('crearAlmacenDeComprobantesDeEntorno', () => {
  const BASES = {
    DATABASE_URL: 'postgres://api@localhost/x',
    DATABASE_PLATAFORMA_URL: 'postgres://plataforma@localhost/x',
  };

  it('memoria por defecto; disco en desarrollo; R2 con su bucket privado', () => {
    expect(
      crearAlmacenDeComprobantesDeEntorno(
        cargarEntorno({ ...BASES, NODE_ENV: 'test', ARCHIVOS_DRIVER: 'memoria' }),
      ),
    ).toBeInstanceOf(AlmacenComprobantesEnMemoria);
    expect(
      crearAlmacenDeComprobantesDeEntorno(
        cargarEntorno({ ...BASES, NODE_ENV: 'development', ARCHIVOS_DRIVER: 'disco' }),
      ),
    ).toBeInstanceOf(AlmacenComprobantesEnDisco);
    expect(
      crearAlmacenDeComprobantesDeEntorno(
        cargarEntorno({
          ...BASES,
          NODE_ENV: 'development',
          ARCHIVOS_DRIVER: 'r2',
          ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe',
          R2_ACCOUNT_ID: 'c',
          R2_ACCESS_KEY_ID: 'a',
          R2_SECRET_ACCESS_KEY: 's',
          R2_BUCKET: 'fotos',
          R2_BUCKET_COMPROBANTES: 'privado',
        }),
      ),
    ).toBeInstanceOf(AlmacenComprobantesR2);
  });
});
