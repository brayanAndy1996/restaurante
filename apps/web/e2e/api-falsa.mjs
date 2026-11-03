// API falsa de la carta web para las pruebas E2E de `apps/web` (historia 005, 5b). Responde lo mismo que las rutas
// públicas de la API (`/publico/cartas/…`, `/publico/mesas/…`, `/archivos/…`) con datos de ejemplo, y cada
// respuesta pasa por los esquemas de `packages/contratos` antes de salir: si el contrato cambia, esta API falla
// con él y no se queda atrás. Además tiene unas rutas de control (`/__control/…`) para que la prueba agote un plato
// y cuente las consultas de disponibilidad (cuántas llevaron `If-None-Match` y cuántas se respondieron con 304).
//
//   node e2e/api-falsa.mjs            (puerto 3100, o el de `API_FALSA_PUERTO`)
//
// También hace de mesa: acepta llamados (`POST /publico/mesas/:código/llamados`, idempotente por `id`) y dice su
// estado (`GET …/llamados/:id`), y las rutas de control dejan provocar cada respuesta que la carta web debe saber
// decir en palabras: `/__control/llamado/<estado>` (cambia el estado del último llamado), `/__control/cerrado`,
// `/__control/limite/<segundos>` (el siguiente envío recibe un 429), `/__control/caida/<n>` (los siguientes n envíos
// se cortan sin respuesta, como una pérdida de señal), `/__control/error/<estado>` (el siguiente envío recibe ese
// error del servidor) y `/__control/conflicto/<n>` (los siguientes n envíos reciben 409 `CONFLICTO`, como cuando dos
// peticiones del mismo `id` llegan a la vez). La empresa `caida` responde 502 a cualquier lectura de su carta.
//
// Para probar contra la API real (con PostgreSQL), arranca la API y la carta web con sus variables y usa
// `E2E_API_URL`; las pruebas que usan las rutas de control (`/__control/…`) se saltan solas.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import {
  cartaPublicaSchema,
  disponibilidadPublicaSchema,
  empresaPublicaSchema,
  estadoLlamadoPublicoSchema,
  llamadoEntradaSchema,
  llamadoPublicoSchema,
  mesaPublicaSchema,
} from '@restaurante/contratos';
import { calcularLinea, totalOrden } from '@restaurante/dominio';

const PUERTO = Number(process.env.API_FALSA_PUERTO ?? 3100);
const BASE = `http://localhost:${PUERTO}`;

/** Código de la mesa 4 de "Sabor Norteño": 22 caracteres en base64url, con mayúsculas y minúsculas. */
export const CODIGO_MESA = 'Mesa4AbCdEfGhIjKlMnOpQ';
export const CODIGO_MESA_DE_OTRA_EMPRESA = 'Zz9YyXxWwVvUuTtSsRrQqP';
/** Mesa de "Gran Carta", la de los 150 productos. */
export const CODIGO_MESA_GRANDE = 'GranMesa1AbCdEfGhIjKlM';

// --- Datos de ejemplo ------------------------------------------------------------------------------

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
  dia,
  desde: '00:00',
  hasta: '23:59',
}));

const EMPRESA = {
  nombre: 'Sabor Norteño',
  logoUrl: `${BASE}/archivos/logo.png`,
  colorPrincipal: '#CB4D29',
};

function producto(n, nombre, precio, extra = {}) {
  return {
    id: id(n),
    tipo: 'SIMPLE',
    nombre,
    descripcion: null,
    fotoUrl: null,
    precio,
    grupos: [],
    componentes: [],
    ...extra,
  };
}

const foto = (nombre) => `${BASE}/archivos/${nombre}.png`;

const FAMILIAS = [
  {
    id: id(101),
    nombre: 'Entradas',
    productos: [
      producto(1, 'Causa limeña', '22.00', {
        descripcion: 'Capas de papa amarilla con pollo, palta y mayonesa casera.',
        fotoUrl: foto('causa'),
      }),
      producto(2, 'Anticuchos de corazón', '26.00', {
        descripcion: 'Dos palitos con papa dorada y ají panca.',
      }),
    ],
  },
  {
    id: id(102),
    nombre: 'Ceviches',
    productos: [
      producto(3, 'Ceviche clásico', '38.50', {
        descripcion: 'Pescado del día, limón, ají limo, camote y choclo.',
        fotoUrl: foto('ceviche'),
      }),
    ],
  },
  {
    id: id(103),
    nombre: 'Platos de fondo',
    productos: [
      producto(4, 'Lomo saltado', '36.00', {
        descripcion: 'Lomo fino, cebolla, tomate y papas fritas, con arroz.',
        fotoUrl: foto('lomo'),
        grupos: [
          {
            id: id(202),
            nombre: 'Punto de la carne',
            seleccion: 'UNICA',
            minimo: 1,
            maximo: 1,
            obligatorio: true,
            modificadores: [
              { id: id(311), nombre: 'Jugoso', precioExtra: '0.00' },
              { id: id(312), nombre: 'Término medio', precioExtra: '0.00' },
              { id: id(313), nombre: 'Bien cocido', precioExtra: '0.00' },
            ],
          },
          {
            id: id(203),
            nombre: 'Extras',
            seleccion: 'MULTIPLE',
            minimo: 0,
            maximo: 2,
            obligatorio: false,
            modificadores: [
              { id: id(321), nombre: 'Huevo frito', precioExtra: '3.00' },
              { id: id(322), nombre: 'Porción de arroz', precioExtra: '4.00' },
              { id: id(323), nombre: 'Ají amarillo molido', precioExtra: '2.00' },
            ],
          },
        ],
      }),
      producto(5, 'Arroz con pollo', '28.00', {
        descripcion: 'Arroz al culantro con presa de pollo, salsa criolla y papa a la huancaína.',
        fotoUrl: foto('arroz'),
      }),
    ],
  },
  {
    id: id(104),
    nombre: 'Bebidas',
    productos: [producto(6, 'Chicha morada', '16.00', { descripcion: 'Jarra para compartir.' })],
  },
  {
    id: id(105),
    nombre: 'Postres',
    productos: [producto(7, 'Suspiro a la limeña', '14.00')],
  },
  {
    id: id(106),
    nombre: 'Menú del día',
    productos: [
      producto(8, 'Menú ejecutivo', '25.00', {
        tipo: 'MENU_DEL_DIA',
        descripcion: 'Incluye entrada, plato de fondo y refresco.',
        grupos: [
          {
            id: id(201),
            nombre: 'Entrada',
            seleccion: 'UNICA',
            minimo: 1,
            maximo: 1,
            obligatorio: true,
            modificadores: [
              { id: id(301), nombre: 'Causa limeña', precioExtra: '0.00' },
              { id: id(302), nombre: 'Ensalada fresca', precioExtra: '0.00' },
              { id: id(303), nombre: 'Ceviche chico', precioExtra: '6.00' },
            ],
          },
        ],
      }),
      producto(9, 'Combo familiar', '89.90', {
        tipo: 'COMBO',
        descripcion: 'Para cuatro personas.',
        componentes: [
          { nombre: 'Lomo saltado', cantidad: 2 },
          { nombre: 'Arroz con pollo', cantidad: 2 },
          { nombre: 'Jarra de chicha', cantidad: 1 },
        ],
      }),
    ],
  },
];

function carta(empresa, sucursal, familias = FAMILIAS) {
  return cartaPublicaSchema.parse({ empresa, sucursal, familias });
}

// --- Carta grande (criterio 88: HTML de 60 kB o menos con 150 productos) ---------------------------------------
// 10 familias × 15 productos, todos con foto y una descripción de unos 100 caracteres; un tercio con un grupo de 4
// opciones y un quinto combos de 3 componentes. Es la empresa `gran-carta`, aparte de "Sabor Norteño" para que las
// demás pruebas no la vean. Los textos varían de plato en plato (nada que el gzip aplaste por repetido).

const NOMBRES_DE_FAMILIA = [
  'Entradas frías',
  'Entradas calientes',
  'Ceviches y tiraditos',
  'Sopas y chupes',
  'Platos de fondo',
  'Parrillas',
  'Arroces y tallarines',
  'Guarniciones',
  'Postres y dulces',
  'Bebidas',
];
const PLATOS = [
  'Causa de pollo',
  'Papa rellena',
  'Choritos a la chalaca',
  'Ocopa arequipeña',
  'Tamal criollo',
  'Anticucho de res',
  'Rocoto relleno',
  'Chicharrón de calamar',
  'Ceviche de pescado',
  'Leche de tigre',
  'Tiradito ají amarillo',
  'Aguadito de pollo',
  'Parihuela',
  'Chupe de camarones',
  'Lomo saltado',
  'Ají de gallina',
  'Seco de cordero',
  'Tacu tacu con lomo',
  'Pollo a la brasa',
  'Costillas BBQ',
  'Arroz con mariscos',
  'Tallarín verde',
  'Arroz chaufa',
  'Papas doradas',
  'Yuca frita',
  'Ensalada criolla',
  'Mazamorra morada',
  'Suspiro limeño',
  'Picarones',
  'Chicha morada',
];
const SABORES = [
  'ají amarillo',
  'limón sutil',
  'culantro fresco',
  'ají panca',
  'huacatay',
  'camote glaseado',
  'choclo desgranado',
  'cebolla morada',
  'rocoto picante',
  'salsa criolla',
];
const GUARNICIONES = ['arroz blanco', 'papas doradas', 'yuca sancochada', 'ensalada fresca'];

function familiasGrandes() {
  return Array.from({ length: 10 }, (_, f) => ({
    id: id(1000 + f),
    nombre: NOMBRES_DE_FAMILIA[f],
    productos: Array.from({ length: 15 }, (_, p) => {
      const n = f * 15 + p;
      const nombre = `${PLATOS[(n * 7) % PLATOS.length]} ${['clásico', 'de la casa', 'especial'][n % 3]}`;
      // Unos 100 caracteres, distintos en cada plato.
      const descripcion =
        `Preparado al momento con ${SABORES[n % SABORES.length]} y ${SABORES[(n * 3 + 1) % SABORES.length]}, ` +
        `acompañado de ${GUARNICIONES[n % GUARNICIONES.length]}. Porción para una persona.`;
      const extra = { descripcion, fotoUrl: foto(`plato-${n}`) };
      if (n % 3 === 0) {
        extra.grupos = [
          {
            id: id(5000 + n),
            nombre: n % 2 === 0 ? 'Guarnición' : 'Tamaño',
            seleccion: 'UNICA',
            minimo: 1,
            maximo: 1,
            obligatorio: true,
            modificadores: ['Primera', 'Segunda', 'Tercera', 'Cuarta'].map((opcion, k) => ({
              id: id(10000 + n * 10 + k),
              nombre: `${opcion} opción ${n}`,
              precioExtra: k === 0 ? '0.00' : `${k * 2}.00`,
            })),
          },
        ];
      } else if (n % 5 === 1) {
        extra.tipo = 'COMBO';
        extra.componentes = [
          { nombre: PLATOS[(n * 5) % PLATOS.length], cantidad: 1 },
          { nombre: PLATOS[(n * 5 + 11) % PLATOS.length], cantidad: 2 },
          { nombre: PLATOS[(n * 5 + 19) % PLATOS.length], cantidad: 1 },
        ];
      }
      return producto(1000 + n, nombre, (12 + (n % 23) * 1.5).toFixed(2), extra);
    }),
  }));
}

const SUCURSAL_MIRAFLORES = {
  nombre: 'Miraflores',
  slug: 'miraflores',
  direccion: 'Av. Larco 345, Miraflores',
  horario: TODOS_LOS_DIAS,
  abiertaAhora: true,
};
const SUCURSAL_BARRANCO = {
  nombre: 'Barranco',
  slug: 'barranco',
  direccion: 'Jr. Domeyer 120, Barranco',
  horario: [],
  abiertaAhora: null,
};
const SUCURSAL_CENTRO = {
  nombre: 'Centro',
  slug: 'centro',
  direccion: 'Jr. de la Unión 800, Lima',
  horario: TODOS_LOS_DIAS,
  abiertaAhora: true,
};

const FAMILIAS_GRANDES = familiasGrandes();

const EMPRESAS = {
  'sabor-norteno': { datos: EMPRESA, sucursales: [SUCURSAL_MIRAFLORES, SUCURSAL_BARRANCO] },
  // La carta de 150 productos del criterio 88 (peso del HTML).
  'gran-carta': {
    datos: {
      nombre: 'Gran Carta',
      logoUrl: `${BASE}/archivos/logo.png`,
      colorPrincipal: '#1D4A9E',
    },
    sucursales: [SUCURSAL_CENTRO],
    familias: FAMILIAS_GRANDES,
  },
  // Una sola sucursal: `/<empresa>` redirige con 307 a su carta.
  'una-sede': {
    datos: { nombre: 'Una Sede', logoUrl: null, colorPrincipal: '#1D4A9E' },
    sucursales: [SUCURSAL_CENTRO],
  },
  // Un color de marca claro: se conserva y lleva letras casi negras.
  'aji-amarillo': {
    datos: { nombre: 'Ají Amarillo', logoUrl: null, colorPrincipal: '#F2A900' },
    sucursales: [SUCURSAL_CENTRO],
  },
};

const MESAS = {
  [CODIGO_MESA]: { empresa: 'sabor-norteno', sucursal: 'miraflores', nombre: 'Mesa 4' },
  [CODIGO_MESA_DE_OTRA_EMPRESA]: { empresa: 'aji-amarillo', sucursal: 'centro', nombre: '7' },
  [CODIGO_MESA_GRANDE]: { empresa: 'gran-carta', sucursal: 'centro', nombre: 'Mesa 1' },
};

// --- Disponibilidad (cambia con /__control/agotar) -------------------------------------------------

const agotados = new Set();
const estadisticas = { total: 0, conIfNoneMatch: 0, respuestas304: 0 };

// --- Mesa: llamados (el reloj es el real; vencen a los 15 minutos) -----------------------------------

/** id → { respuesta, estado, tipo, huella }: lo que la API real guarda del llamado. */
const llamados = new Map();
const simulacion = { cerrado: false, limite: 0, caidas: 0, error: 0, conflictos: 0, recibidos: 0 };

function pendienteDeLaMesa() {
  return [...llamados.values()].find((l) => l.estado === 'PENDIENTE') ?? null;
}

function lineasDelLlamado(entrada, familias = FAMILIAS) {
  const productos = new Map(familias.flatMap((f) => f.productos).map((p) => [p.id, p]));
  const rechazos = [];
  const lineas = [];
  entrada.lineas.forEach((linea, i) => {
    const producto = productos.get(linea.productoId);
    if (!producto) {
      rechazos.push({ campo: `lineas.${i}`, mensaje: 'PRODUCTO_NO_EXISTE' });
      return;
    }
    if (agotados.has(producto.id)) {
      rechazos.push({ campo: `lineas.${i}`, mensaje: 'AGOTADO' });
      return;
    }
    const grupos = producto.grupos.map((g) => ({
      ...g,
      modificadores: g.modificadores.map((m) => ({
        ...m,
        disponible: !(agotados.has(`mod:${producto.id}`) && m.id === id(303)),
      })),
    }));
    const calculo = calcularLinea(
      { precio: producto.precio, grupos },
      linea.modificadorIds,
      linea.cantidad,
    );
    if (!calculo.valido) {
      const detalle = calculo.errores.map((e) =>
        'modificadorId' in e ? `${e.codigo}: ${e.modificadorId}` : e.codigo,
      );
      rechazos.push({ campo: `lineas.${i}`, mensaje: detalle.join('; ') });
      return;
    }
    const nombres = new Map(grupos.flatMap((g) => g.modificadores.map((m) => [m.id, m.nombre])));
    lineas.push({
      nombre: producto.nombre,
      modificadores: linea.modificadorIds.map((m) => nombres.get(m)),
      cantidad: linea.cantidad,
      observacion: linea.observacion ?? null,
      precioUnitario: calculo.precioUnitario,
      total: calculo.total,
    });
  });
  return { lineas, rechazos };
}

function disponibilidad(familias = FAMILIAS) {
  const vendibles = familias
    .flatMap((f) => f.productos)
    .filter((p) => !agotados.has(p.id))
    .map((p) => ({
      id: p.id,
      modificadoresNoDisponibles: agotados.has(`mod:${p.id}`) ? [id(303)] : [],
    }));
  return disponibilidadPublicaSchema.parse({ vendibles });
}

// --- Imágenes: PNG de un color con una banda, sin depender de ninguna librería ---------------------

function png(color, ancho = 320, alto = 320) {
  const crc = (buf) => {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(buf) >>> 0);
    return c;
  };
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    return Buffer.concat([largo, cuerpo, crc(cuerpo)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    const base = y * (ancho * 3 + 1);
    const banda = y > alto * 0.4 && y < alto * 0.6;
    for (let x = 0; x < ancho; x += 1) {
      const pixel = banda ? color.map((c) => 255 - Math.round((255 - c) * 0.45)) : color;
      filas[base + 1 + x * 3] = pixel[0];
      filas[base + 2 + x * 3] = pixel[1];
      filas[base + 3 + x * 3] = pixel[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(filas)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const IMAGENES = {
  logo: png([22, 25, 29], 160, 160),
  causa: png([243, 190, 80]),
  ceviche: png([150, 200, 190]),
  lomo: png([200, 140, 100]),
  arroz: png([150, 190, 90]),
};

// --- Servidor --------------------------------------------------------------------------------------

const CACHE_CONTROL_CARTA = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';
const CACHE_CONTROL_DISPONIBILIDAD = 'public, max-age=5, s-maxage=5';

function enviar(res, estado, cuerpo, cabeceras = {}) {
  res.writeHead(estado, cabeceras);
  res.end(cuerpo);
}

function json(res, estado, dato, cabeceras = {}) {
  enviar(res, estado, JSON.stringify(dato), { 'Content-Type': 'application/json', ...cabeceras });
}

const noEncontrado = (res) =>
  json(res, 404, { codigo: 'NO_ENCONTRADO', mensaje: 'No encontramos lo que buscas' });

/** Como la API real: `ETag` fuerte y 304 con `If-None-Match` igual. */
function conEtag(req, res, dato, cacheControl, esDisponibilidad = false) {
  const cuerpo = JSON.stringify(dato);
  const etag = `"${createHash('sha1').update(cuerpo).digest('hex').slice(0, 16)}"`;
  const cabeceras = {
    ETag: etag,
    'Cache-Control': cacheControl,
    'Content-Type': 'application/json',
  };
  const enviado = req.headers['if-none-match'];
  if (esDisponibilidad) {
    estadisticas.total += 1;
    if (enviado) estadisticas.conIfNoneMatch += 1;
  }
  if (enviado === etag) {
    if (esDisponibilidad) estadisticas.respuestas304 += 1;
    return enviar(res, 304, undefined, cabeceras);
  }
  return enviar(res, 200, cuerpo, cabeceras);
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE);
  const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  // CORS de las rutas públicas (criterio 16): cualquier origen, sin credenciales, con `ETag` expuesto.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
  if (req.method === 'OPTIONS') {
    return enviar(res, 204, undefined, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'If-None-Match, Content-Type, Idempotency-Key',
      'Access-Control-Max-Age': '600',
    });
  }

  if (url.pathname === '/health') return json(res, 200, { estado: 'ok' });

  if (partes[0] === '__control') {
    if (partes[1] === 'estadisticas') return json(res, 200, estadisticas);
    // Los envíos que llegaron (con los reintentos) y los llamados distintos que quedaron guardados.
    if (partes[1] === 'mesa') {
      return json(res, 200, { recibidos: simulacion.recibidos, llamados: llamados.size });
    }
    if (partes[1] === 'llamados') {
      return json(
        res,
        200,
        [...llamados.values()].map((l) => ({ ...l.respuesta, estado: l.estado })),
      );
    }
    if (partes[1] === 'llamado' && partes[2]) {
      const ultimo = [...llamados.values()].at(-1);
      if (ultimo) ultimo.estado = partes[2];
      return json(res, 200, { ok: Boolean(ultimo) });
    }
    if (partes[1] === 'cerrado') {
      simulacion.cerrado = partes[2] !== 'no';
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'limite') {
      simulacion.limite = Number(partes[2] ?? 120);
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'caida') {
      simulacion.caidas = Number(partes[2] ?? 1);
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'error') {
      simulacion.error = Number(partes[2] ?? 500);
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'conflicto') {
      simulacion.conflictos = Number(partes[2] ?? 1);
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'reiniciar') {
      llamados.clear();
      Object.assign(simulacion, {
        cerrado: false,
        limite: 0,
        caidas: 0,
        error: 0,
        conflictos: 0,
        recibidos: 0,
      });
      agotados.clear();
      Object.assign(estadisticas, { total: 0, conIfNoneMatch: 0, respuestas304: 0 });
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'agotar' && partes[2]) {
      agotados.add(partes[2]);
      return json(res, 200, { ok: true });
    }
    if (partes[1] === 'agotar-opcion' && partes[2]) {
      agotados.add(`mod:${partes[2]}`);
      return json(res, 200, { ok: true });
    }
    return noEncontrado(res);
  }

  if (partes[0] === 'archivos' && partes[1]) {
    const nombreDeImagen = partes[1].replace(/\.png$/, '');
    // Las fotos de la carta grande (`plato-<n>`) son todas la misma imagen, con otra dirección cada una.
    const imagen = IMAGENES[/^plato-\d+$/.test(nombreDeImagen) ? 'causa' : nombreDeImagen];
    if (!imagen) return noEncontrado(res);
    return enviar(res, 200, imagen, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    });
  }

  if (partes[0] === 'publico' && partes[1] === 'cartas') {
    // Una empresa cuya API "se cae": cualquier lectura responde 502 (como un proxy sin servidor detrás). Sirve para
    // comprobar que un error del servidor nunca sale con la caché pública de la carta (criterio 80).
    if ((partes[2] ?? '').toLowerCase() === 'caida') {
      return json(res, 502, { codigo: 'ERROR_INTERNO', mensaje: 'Bad gateway' });
    }
    const empresa = EMPRESAS[(partes[2] ?? '').toLowerCase()];
    if (!empresa) return noEncontrado(res);
    if (partes.length === 3) {
      const cuerpo = empresaPublicaSchema.parse({
        empresa: empresa.datos,
        sucursales: empresa.sucursales.map(({ nombre, slug, direccion }) => ({
          nombre,
          slug,
          direccion,
        })),
      });
      return conEtag(req, res, cuerpo, CACHE_CONTROL_CARTA);
    }
    const sucursal = empresa.sucursales.find((s) => s.slug === (partes[3] ?? '').toLowerCase());
    if (!sucursal) return noEncontrado(res);
    if (partes.length === 4) {
      return conEtag(
        req,
        res,
        carta(empresa.datos, sucursal, empresa.familias),
        CACHE_CONTROL_CARTA,
      );
    }
    if (partes.length === 5 && partes[4] === 'disponibilidad') {
      return conEtag(
        req,
        res,
        disponibilidad(empresa.familias),
        CACHE_CONTROL_DISPONIBILIDAD,
        true,
      );
    }
    return noEncontrado(res);
  }

  if (partes[0] === 'publico' && partes[1] === 'mesas' && partes.length === 3) {
    const mesa = MESAS[partes[2] ?? ''];
    if (!mesa) return noEncontrado(res);
    const cuerpo = mesaPublicaSchema.parse({
      mesa: { nombre: mesa.nombre },
      carta: { empresaSlug: mesa.empresa, sucursalSlug: mesa.sucursal },
      aceptaLlamados: !simulacion.cerrado,
      motivoNoAcepta: simulacion.cerrado ? 'FUERA_DE_HORARIO' : null,
      llamadoPendiente: pendienteDeLaMesa()
        ? { tipo: pendienteDeLaMesa().tipo, venceEn: pendienteDeLaMesa().venceEn }
        : null,
    });
    return json(res, 200, cuerpo, { 'Cache-Control': 'no-store' });
  }

  if (partes[0] === 'publico' && partes[1] === 'mesas' && partes[3] === 'llamados') {
    const datosMesa = MESAS[partes[2] ?? ''];
    if (!datosMesa) return noEncontrado(res);
    const error = (estado, codigo, mensaje, extra = {}) =>
      json(res, estado, { codigo, mensaje, ...extra });
    if (req.method === 'GET' && partes.length === 5) {
      const llamado = llamados.get((partes[4] ?? '').toLowerCase());
      if (!llamado) return noEncontrado(res);
      const vencido = llamado.estado === 'PENDIENTE' && Date.now() >= Date.parse(llamado.venceEn);
      return json(
        res,
        200,
        estadoLlamadoPublicoSchema.parse({
          id: llamado.id,
          tipo: llamado.tipo,
          estado: vencido ? 'VENCIDO' : llamado.estado,
          venceEn: llamado.venceEn,
        }),
        { 'Cache-Control': 'no-store' },
      );
    }
    if (req.method === 'POST' && partes.length === 4) {
      let texto = '';
      req.on('data', (trozo) => (texto += trozo));
      req.on('end', () => {
        simulacion.recibidos += 1;
        if (simulacion.caidas > 0) {
          simulacion.caidas -= 1;
          return req.socket.destroy();
        }
        if (simulacion.error > 0) {
          const estado = simulacion.error;
          simulacion.error = 0;
          return error(estado, 'ERROR_INTERNO', 'Error interno');
        }
        // Dos peticiones del mismo `id` a la vez (criterio 29): la API real responde 409 `CONFLICTO` a una y,
        // repetida, la réplica por `id` responde 201.
        if (simulacion.conflictos > 0) {
          simulacion.conflictos -= 1;
          return error(409, 'CONFLICTO', 'La operación con esa clave sigue en curso');
        }
        let entrada;
        try {
          entrada = llamadoEntradaSchema.parse(JSON.parse(texto));
        } catch {
          return error(400, 'DATOS_INVALIDOS', 'Datos inválidos');
        }
        const previo = llamados.get(entrada.id.toLowerCase());
        if (previo) return json(res, 201, previo.respuesta);
        if (simulacion.cerrado) {
          return error(409, 'FUERA_DE_HORARIO', 'El local está cerrado. Habla con el personal');
        }
        if (pendienteDeLaMesa()) {
          return error(409, 'LLAMADO_PENDIENTE', 'Ya avisamos al mozo');
        }
        if (simulacion.limite > 0) {
          const segundos = simulacion.limite;
          simulacion.limite = 0;
          return error(429, 'DEMASIADOS_LLAMADOS', 'Enviaste muchos avisos seguidos', {
            reintentarEnSegundos: segundos,
          });
        }
        const { lineas, rechazos } =
          entrada.tipo === 'PEDIDO'
            ? lineasDelLlamado(entrada, EMPRESAS[datosMesa.empresa].familias)
            : { lineas: [], rechazos: [] };
        if (rechazos.length > 0) {
          return error(422, 'PRODUCTO_NO_VENDIBLE', 'El producto está agotado', {
            campos: rechazos,
          });
        }
        const creadoEn = new Date();
        const venceEn = new Date(creadoEn.getTime() + 15 * 60_000);
        const respuesta = llamadoPublicoSchema.parse({
          id: entrada.id.toLowerCase(),
          tipo: entrada.tipo,
          estado: 'PENDIENTE',
          creadoEn: creadoEn.toISOString(),
          venceEn: venceEn.toISOString(),
          lineas,
          total:
            entrada.tipo === 'PEDIDO'
              ? totalOrden(
                  lineas.map((l) => ({
                    precioUnitario: l.precioUnitario,
                    cantidad: l.cantidad,
                    cantidadAnulada: 0,
                  })),
                )
              : null,
        });
        llamados.set(respuesta.id, {
          id: respuesta.id,
          tipo: respuesta.tipo,
          estado: 'PENDIENTE',
          venceEn: respuesta.venceEn,
          respuesta,
          entrada,
        });
        json(res, 201, respuesta);
      });
      return;
    }
    return noEncontrado(res);
  }

  return noEncontrado(res);
});

servidor.listen(PUERTO, () => {
  console.log(`API falsa de la carta web en ${BASE}`);
});
