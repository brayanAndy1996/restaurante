// Historia 003, grupo C1 · almacén de archivos (criterio 14 y decisión 1): `leerImagen`, `AlmacenEnDisco`,
// `AlmacenR2`, la elección del almacén por `ARCHIVOS_DRIVER` y sus reglas por entorno. Pruebas del
// desarrollador (no protegidas). No usan la base de datos, salvo la del servidor estático de desarrollo.
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  EntornoInvalidoError,
  cargarEntorno,
  exigirEntornoDeProduccion,
} from '../../src/config/entorno';
import {
  AlmacenEnDisco,
  AlmacenEnMemoria,
  AlmacenR2,
  CACHE_CONTROL_FOTOS,
  crearAlmacenDeEntorno,
  leerImagen,
} from '../../src/nucleo/archivos';
import { fijarEntornoDePrueba } from '../utilidades';
import { jpegValido, pngValido, webpConPerdida, webpExtendido, webpValido } from './ayudas';

describe('leerImagen', () => {
  it('lee el formato, el tipo, la extensión y las dimensiones de cada formato', () => {
    expect(leerImagen(pngValido(320, 200))).toEqual({
      formato: 'png',
      tipo: 'image/png',
      extension: 'png',
      ancho: 320,
      alto: 200,
    });
    expect(leerImagen(jpegValido(640, 480))).toMatchObject({
      formato: 'jpeg',
      tipo: 'image/jpeg',
      extension: 'jpg',
      ancho: 640,
      alto: 480,
    });
    for (const webp of [webpValido(333, 222), webpConPerdida(333, 222), webpExtendido(333, 222)]) {
      expect(leerImagen(webp)).toMatchObject({ formato: 'webp', ancho: 333, alto: 222 });
    }
  });

  it('un JPEG con marcadores antes del cuadro (APP, DQT, DHT) y relleno FF se lee igual', () => {
    const jpeg = jpegValido(500, 400);
    const apps = Buffer.concat([
      Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x01]), // DQT de 2 bytes de datos
      Buffer.from([0xff, 0xff, 0xff, 0xc4, 0x00, 0x03, 0x00]), // relleno FF y DHT
    ]);
    const conMarcadores = Buffer.concat([jpeg.subarray(0, 2), apps, jpeg.subarray(2)]);
    expect(leerImagen(conMarcadores)).toMatchObject({ ancho: 500, alto: 400 });
  });

  it('rechaza (null) lo que no es un JPEG, PNG o WebP completo', () => {
    const png = pngValido();
    const jpeg = jpegValido();
    const webp = webpValido();
    const malos: [string, Buffer][] = [
      ['vacío', Buffer.alloc(0)],
      ['texto', Buffer.from('hola')],
      ['GIF', Buffer.from('GIF89a......', 'latin1')],
      ['BMP', Buffer.from('BM123456789012345678', 'latin1')],
      ['PNG sin IEND', png.subarray(0, png.length - 12)],
      ['PNG con bytes de más al final', Buffer.concat([png, Buffer.from([0])])],
      ['PNG que no empieza con IHDR', Buffer.concat([png.subarray(0, 8), png.subarray(33)])],
      ['PNG de 0 px', pngValido(0, 10)],
      ['JPEG sin EOI', jpeg.subarray(0, jpeg.length - 2)],
      ['JPEG cortado antes del cuadro', jpeg.subarray(0, 14)],
      ['JPEG sin cuadro (solo SOI y EOI)', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
      ['JPEG de 0 px', jpegValido(0, 10)],
      ['WebP truncado', webp.subarray(0, webp.length - 1)],
      ['WebP con bytes de más', Buffer.concat([webp, Buffer.from([0, 0])])],
      [
        'WebP de otro trozo',
        Buffer.concat([webp.subarray(0, 12), Buffer.from('VP8Q'), webp.subarray(16)]),
      ],
      [
        'RIFF que no es WebP',
        Buffer.concat([
          Buffer.from('RIFF'),
          webp.subarray(4, 8),
          Buffer.from('WAVE'),
          webp.subarray(12),
        ]),
      ],
    ];
    for (const [nombre, datos] of malos) expect(leerImagen(datos), nombre).toBeNull();
  });

  it('un archivo corrupto con dimensiones fuera de rango no lanza: devuelve null', () => {
    const jpeg = Buffer.from(jpegValido());
    jpeg.fill(0xff, 20, 40);
    expect(() => leerImagen(jpeg)).not.toThrow();
    for (let n = 0; n < 60; n++) {
      expect(() => leerImagen(pngValido().subarray(0, n))).not.toThrow();
      expect(() => leerImagen(jpegValido().subarray(0, n))).not.toThrow();
      expect(() => leerImagen(webpValido().subarray(0, n))).not.toThrow();
    }
  });
});

describe('AlmacenEnDisco', () => {
  let carpeta: string;
  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'carta-disco-'));
  });
  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  it('guarda con subcarpetas, borra y no falla al borrar lo que no existe', async () => {
    const almacen = new AlmacenEnDisco(carpeta, 'http://localhost:3000/archivos');
    const clave = 'carta/empresa/producto/a.png';
    await almacen.guardar(clave, Buffer.from('contenido'), 'image/png');
    expect((await readFile(join(carpeta, clave))).toString()).toBe('contenido');
    expect(almacen.urlPublica(clave)).toBe(`http://localhost:3000/archivos/${clave}`);
    await almacen.borrar(clave);
    await expect(stat(join(carpeta, clave))).rejects.toThrow();
    await expect(almacen.borrar(clave)).resolves.toBeUndefined();
  });

  it('rechaza una clave que sale de la carpeta o está vacía', async () => {
    const almacen = new AlmacenEnDisco(carpeta, 'http://x/archivos');
    for (const clave of ['../fuera.png', 'a/../../fuera.png', '/etc/passwd', '', '.']) {
      await expect(almacen.guardar(clave, Buffer.from('x'), 'image/png'), clave).rejects.toThrow(
        RangeError,
      );
      await expect(almacen.borrar(clave), clave).rejects.toThrow(RangeError);
    }
  });
});

describe('AlmacenR2', () => {
  interface Pedido {
    url: string;
    metodo: string;
    cabeceras: Record<string, string>;
    cuerpo: number;
    /** Si la llamada lleva un límite de tiempo (`AbortSignal`). */
    conLimite: boolean;
  }

  function almacenCon(respuestas: number[]): { almacen: AlmacenR2; pedidos: Pedido[] } {
    const pedidos: Pedido[] = [];
    const llamar = (async (peticion: Request, init?: RequestInit) => {
      pedidos.push({
        conLimite: init?.signal instanceof AbortSignal,
        url: peticion.url,
        metodo: peticion.method,
        cabeceras: Object.fromEntries(peticion.headers.entries()),
        cuerpo: (await peticion.arrayBuffer()).byteLength,
      });
      return new Response(null, { status: respuestas.shift() ?? 200 });
    }) as unknown as typeof fetch;
    return {
      almacen: new AlmacenR2({
        cuentaId: 'cuenta123',
        accessKeyId: 'AKIAPRUEBA',
        secretAccessKey: 'secreto',
        bucket: 'fotos',
        urlBase: 'https://fotos.ejemplo.pe/',
        fetch: llamar,
      }),
      pedidos,
    };
  }

  it('guarda con PUT firmado (SigV4), el tipo y la caché de un año inmutable', async () => {
    const { almacen, pedidos } = almacenCon([200]);
    await almacen.guardar('carta/e/p/foto uno.png', Buffer.from('12345'), 'image/png');
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0]!;
    expect(p.metodo).toBe('PUT');
    expect(p.url).toBe('https://cuenta123.r2.cloudflarestorage.com/fotos/carta/e/p/foto%20uno.png');
    expect(p.cabeceras['content-type']).toBe('image/png');
    expect(p.cabeceras['cache-control']).toBe(CACHE_CONTROL_FOTOS);
    expect(CACHE_CONTROL_FOTOS).toBe('public, max-age=31536000, immutable');
    expect(p.cabeceras.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAPRUEBA\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
    );
    // Con S3 sobre HTTPS, aws4fetch firma sin el hash del cuerpo (`UNSIGNED-PAYLOAD`), que R2 acepta.
    expect(p.cabeceras['x-amz-content-sha256']).toMatch(/^([0-9a-f]{64}|UNSIGNED-PAYLOAD)$/);
    expect(p.cuerpo).toBe(5);
    // La subida corre dentro de la transacción de la petición: no puede quedar colgada sin límite.
    expect(p.conLimite).toBe(true);
  });

  it('borra con DELETE firmado; un 404 no es un error y un 5xx sí', async () => {
    const { almacen, pedidos } = almacenCon([204, 404, 500]);
    await almacen.borrar('carta/e/p/a.png');
    await almacen.borrar('carta/e/p/b.png');
    await expect(almacen.borrar('carta/e/p/c.png')).rejects.toThrow(/HTTP 500/);
    expect(pedidos.map((p) => p.metodo)).toEqual(['DELETE', 'DELETE', 'DELETE']);
    expect(pedidos.every((p) => p.conLimite)).toBe(true);
    expect(pedidos[0]!.cabeceras.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('un rechazo de R2 al guardar lanza (la subida no se da por hecha)', async () => {
    const { almacen } = almacenCon([403]);
    await expect(almacen.guardar('carta/x.png', Buffer.from('1'), 'image/png')).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('la URL pública es la base del bucket más la clave, sin doble barra', () => {
    const { almacen } = almacenCon([]);
    expect(almacen.urlPublica('carta/e/p/a.png')).toBe('https://fotos.ejemplo.pe/carta/e/p/a.png');
  });
});

describe('ARCHIVOS_DRIVER y sus reglas por entorno', () => {
  const base = {
    DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
    DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
  };
  const pepper = Buffer.alloc(32, 7).toString('base64');
  const r2 = {
    ARCHIVOS_DRIVER: 'r2',
    ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe',
    R2_ACCOUNT_ID: 'cuenta',
    R2_ACCESS_KEY_ID: 'clave',
    R2_SECRET_ACCESS_KEY: 'secreto',
    R2_BUCKET: 'fotos',
  };

  it('por defecto: memoria con test, disco con development y nada en producción', () => {
    expect(cargarEntorno({ ...base, NODE_ENV: 'test' }).ARCHIVOS_DRIVER).toBe('memoria');
    expect(cargarEntorno({ ...base, NODE_ENV: 'development' }).ARCHIVOS_DRIVER).toBe('disco');
    expect(cargarEntorno({ ...base, NODE_ENV: 'production' }).ARCHIVOS_DRIVER).toBeUndefined();
  });

  it('con disco: carpeta por defecto ./archivos y URL de la propia API; las explícitas mandan', () => {
    expect(cargarEntorno({ ...base, NODE_ENV: 'development', PORT: '4000' })).toMatchObject({
      ARCHIVOS_DIRECTORIO: './archivos',
      ARCHIVOS_URL_PUBLICA: 'http://localhost:4000/archivos',
    });
    expect(
      cargarEntorno({
        ...base,
        NODE_ENV: 'development',
        ARCHIVOS_DIRECTORIO: '/tmp/f',
        ARCHIVOS_URL_PUBLICA: 'http://localhost:3000/archivos/',
      }),
    ).toMatchObject({
      ARCHIVOS_DIRECTORIO: '/tmp/f',
      ARCHIVOS_URL_PUBLICA: 'http://localhost:3000/archivos',
    });
  });

  it('rechaza disco fuera de development (test y production) y un driver desconocido', () => {
    for (const NODE_ENV of ['test', 'production']) {
      const intento = () => cargarEntorno({ ...base, NODE_ENV, ARCHIVOS_DRIVER: 'disco' });
      expect(intento, NODE_ENV).toThrow(EntornoInvalidoError);
      expect(intento, NODE_ENV).toThrow(/ARCHIVOS_DRIVER=disco solo vale con NODE_ENV=development/);
    }
    expect(() =>
      cargarEntorno({ ...base, NODE_ENV: 'development', ARCHIVOS_DRIVER: 'disco' }),
    ).not.toThrow();
    expect(() => cargarEntorno({ ...base, NODE_ENV: 'test', ARCHIVOS_DRIVER: 's3' })).toThrow(
      /ARCHIVOS_DRIVER/,
    );
  });

  it('r2 exige sus cuatro credenciales y la URL pública, en cualquier entorno', () => {
    for (const faltante of Object.keys(r2).filter((k) => k !== 'ARCHIVOS_DRIVER')) {
      const env: Record<string, string> = { ...base, NODE_ENV: 'production', ...r2 };
      delete env[faltante];
      expect(() => cargarEntorno(env), faltante).toThrow(
        new RegExp(`${faltante} es obligatoria con ARCHIVOS_DRIVER=r2`),
      );
    }
    expect(cargarEntorno({ ...base, NODE_ENV: 'development', ...r2 }).ARCHIVOS_DRIVER).toBe('r2');
  });

  it('rechaza una URL pública que no es http(s)', () => {
    expect(() =>
      cargarEntorno({ ...base, NODE_ENV: 'development', ARCHIVOS_URL_PUBLICA: 'archivos' }),
    ).toThrow(/ARCHIVOS_URL_PUBLICA no es una URL/);
    expect(() =>
      cargarEntorno({ ...base, NODE_ENV: 'development', ARCHIVOS_URL_PUBLICA: 'ftp://x/archivos' }),
    ).toThrow(/ARCHIVOS_URL_PUBLICA/);
  });

  it('en producción la API exige r2 al arrancar; memoria no basta', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      PIN_PEPPER: pepper,
      ORIGENES_PERMITIDOS: 'https://app.ejemplo.pe',
    };
    const sinDriver = () => exigirEntornoDeProduccion(cargarEntorno(prod));
    expect(sinDriver).toThrow(/ARCHIVOS_DRIVER=r2 es obligatorio en producción/);
    const conMemoria = () =>
      exigirEntornoDeProduccion(cargarEntorno({ ...prod, ARCHIVOS_DRIVER: 'memoria' }));
    expect(conMemoria).toThrow(/ARCHIVOS_DRIVER=r2 es obligatorio/);
    expect(() => exigirEntornoDeProduccion(cargarEntorno({ ...prod, ...r2 }))).not.toThrow();
  });

  it('crearAlmacenDeEntorno elige el almacén de cada driver', () => {
    const entorno = (extra: Record<string, string>) =>
      cargarEntorno({ ...base, NODE_ENV: 'development', ...extra });
    expect(crearAlmacenDeEntorno(entorno({ ARCHIVOS_DRIVER: 'memoria' }))).toBeInstanceOf(
      AlmacenEnMemoria,
    );
    expect(crearAlmacenDeEntorno(entorno({ ARCHIVOS_DRIVER: 'disco' }))).toBeInstanceOf(
      AlmacenEnDisco,
    );
    const almacenR2 = crearAlmacenDeEntorno(entorno(r2));
    expect(almacenR2).toBeInstanceOf(AlmacenR2);
    expect(almacenR2.urlPublica('carta/a.png')).toBe('https://fotos.ejemplo.pe/carta/a.png');
  });
});

describe('servidor estático de /archivos (solo desarrollo con disco)', () => {
  let carpeta: string;
  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'carta-estatico-'));
    await mkdir(join(carpeta, 'carta/e/p'), { recursive: true });
    await writeFile(join(carpeta, 'carta/e/p/a.png'), pngValido());
    await writeFile(join(carpeta, '.secreto'), 'no');
  });
  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  async function conEntorno(
    nodeEnv: 'development' | 'test',
    extra: Record<string, string | undefined>,
    fn: (http: () => ReturnType<typeof request>) => Promise<void>,
  ) {
    fijarEntornoDePrueba({ nodeEnv, empresaPorHeader: false, extra });
    const app = await crearAplicacion({ logger: false });
    try {
      await fn(() => request(app.getHttpServer()));
    } finally {
      await app.close();
    }
  }

  it('con development y disco sirve los archivos con su tipo y sin listar carpetas ni ocultos', async () => {
    await conEntorno(
      'development',
      { ARCHIVOS_DRIVER: 'disco', ARCHIVOS_DIRECTORIO: carpeta },
      async (http) => {
        const res = await http().get('/archivos/carta/e/p/a.png');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect((await http().get('/archivos/carta/e/p/')).status).toBe(404);
        expect((await http().get('/archivos/.secreto')).status).toBe(404);
        expect((await http().get('/archivos/../.secreto')).status).toBe(404);
        expect((await http().get('/archivos/carta/e/p/no-existe.png')).status).toBe(404);
      },
    );
  });

  it('con test (memoria) no hay servidor estático: /archivos responde 404 de la API', async () => {
    await conEntorno('test', { ARCHIVOS_DIRECTORIO: carpeta }, async (http) => {
      const res = await http().get('/archivos/carta/e/p/a.png');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ codigo: expect.any(String) });
    });
  });
});
