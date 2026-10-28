// Ayudantes de las pruebas no protegidas de la carta (historia 003, grupo C1). Reutilizan la fábrica de las
// pruebas protegidas (`../carta-critica/fabrica-permisos-carta`) solo para armar la aplicación, las empresas
// y las sesiones; no la modifican.
import { deflateSync } from 'node:zlib';
import {
  crearEscenarioCarta,
  llamar,
  pngValido,
  sesionContrasena,
  sesionesDe,
  unico,
  type AppCarta,
  type EscenarioCarta,
} from '../carta-critica/fabrica-permisos-carta';

export { crearEscenarioCarta, llamar, pngValido, sesionContrasena, sesionesDe, unico };
export type { AppCarta, EscenarioCarta };

/** Crea una estación y una familia y devuelve sus ids (el Administrador de la empresa, sin sucursal activa). */
export async function sembrarBase(ctx: AppCarta, token: string) {
  const estacion = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/estaciones',
    cuerpo: { nombre: unico('Cocina') },
  });
  const familia = await llamar(ctx, token, {
    metodo: 'post',
    ruta: '/carta/familias',
    cuerpo: { nombre: unico('Fondos') },
  });
  return { estacionId: estacion.body.id as string, familiaId: familia.body.id as string };
}

/** Cuerpo de un producto simple válido. */
export function productoSimple(
  base: { estacionId: string; familiaId: string },
  extra: Record<string, unknown> = {},
) {
  return {
    tipo: 'SIMPLE',
    nombre: unico('Producto'),
    familiaId: base.familiaId,
    precio: '25.00',
    estacionId: base.estacionId,
    tipoControlStock: 'UNIDADES',
    ...extra,
  };
}

// ------------------------------------------------------------------------------------------------
// Imágenes de muestra
// ------------------------------------------------------------------------------------------------

/**
 * Un JPEG con la estructura mínima que lee `leerImagen`: SOI, JFIF, SOF0 con las dimensiones, SOS, unos
 * bytes de datos y EOI. No se puede decodificar, pero tiene la forma de un archivo completo.
 */
export function jpegValido(ancho = 240, alto = 240): Buffer {
  const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    u16(alto),
    u16(ancho),
    Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
    Buffer.from([
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    ]),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Un WebP sin pérdida (`VP8L`) con las dimensiones pedidas. */
export function webpValido(ancho = 240, alto = 240): Buffer {
  const datos = Buffer.alloc(10);
  datos[0] = 0x2f; // firma de VP8L
  datos.writeUInt32LE(((ancho - 1) & 0x3fff) | (((alto - 1) & 0x3fff) << 14), 1);
  const trozo = Buffer.concat([Buffer.from('VP8L'), uint32(datos.length), datos]);
  return Buffer.concat([Buffer.from('RIFF'), uint32(4 + trozo.length), Buffer.from('WEBP'), trozo]);
}

/** Un WebP con pérdida (`VP8 `). */
export function webpConPerdida(ancho = 240, alto = 240): Buffer {
  const datos = Buffer.alloc(10);
  datos.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 0);
  datos.writeUInt16LE(ancho, 6);
  datos.writeUInt16LE(alto, 8);
  const trozo = Buffer.concat([Buffer.from('VP8 '), uint32(datos.length), datos]);
  return Buffer.concat([Buffer.from('RIFF'), uint32(4 + trozo.length), Buffer.from('WEBP'), trozo]);
}

/** Un WebP extendido (`VP8X`). */
export function webpExtendido(ancho = 240, alto = 240): Buffer {
  const datos = Buffer.alloc(10);
  datos.writeUIntLE(ancho - 1, 4, 3);
  datos.writeUIntLE(alto - 1, 7, 3);
  const trozo = Buffer.concat([Buffer.from('VP8X'), uint32(datos.length), datos]);
  return Buffer.concat([Buffer.from('RIFF'), uint32(4 + trozo.length), Buffer.from('WEBP'), trozo]);
}

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** Un PNG de escala de grises de cualquier tamaño (rápido: filas de ceros comprimidas). */
export { deflateSync };
