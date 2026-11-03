import type { CartaWebRespuesta } from '@restaurante/contratos';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeFoto, type MotorDeImagen } from '../src/lib/imagen';
import {
  borradorDeCartaWeb,
  colorEscrito,
  direccionEscrita,
  errorDeDireccion,
  hayCambios,
  marcaEnLaCarta,
  sitioDeLaCarta,
  validarCartaWeb,
  vistaDeLaDireccion,
} from '../src/modulos/administracion/carta-web/carta-web';
import { prepararLogo } from '../src/modulos/administracion/carta-web/logo';

// spec: 005-carta-web-mesa, criterios 74 y 76 en la interfaz (lógica de Ajustes › Carta web, no protegida).

const SUC = '33333333-3333-4333-8333-333333333333';
const SUC_B = '44444444-4444-4444-8444-444444444444';

const configurada: CartaWebRespuesta = {
  configurada: true,
  nombre: 'Sabor Norteño',
  slug: 'sabor-norteno',
  colorPrincipal: '#1D4A9E',
  logoUrl: null,
  url: 'https://carta.ejemplo.pe/sabor-norteno',
  sucursales: [
    {
      sucursalId: SUC,
      nombre: 'Miraflores',
      slug: 'miraflores',
      publicada: true,
      url: 'https://carta.ejemplo.pe/sabor-norteno/miraflores',
    },
    { sucursalId: SUC_B, nombre: 'Surco', slug: null, publicada: false, url: null },
  ],
};

describe('direcciones', () => {
  it('muestra la dirección como se verá: sin protocolo ni barra final', () => {
    expect(sitioDeLaCarta(configurada)).toBe('carta.ejemplo.pe');
    expect(vistaDeLaDireccion('carta.ejemplo.pe', 'sabor-norteno')).toBe(
      'carta.ejemplo.pe/sabor-norteno',
    );
    expect(vistaDeLaDireccion('carta.ejemplo.pe', 'sabor-norteno', 'miraflores')).toBe(
      'carta.ejemplo.pe/sabor-norteno/miraflores',
    );
    // Antes de guardar la primera vez no se conoce el sitio.
    expect(
      sitioDeLaCarta({ ...configurada, configurada: false, slug: null, url: null }),
    ).toBeNull();
    expect(vistaDeLaDireccion(null, '')).toBe('…/…');
  });

  it('dice por qué una dirección no sirve', () => {
    expect(errorDeDireccion('sabor-norteno')).toBeUndefined();
    expect(errorDeDireccion('')).toBe('Escribe la dirección');
    expect(errorDeDireccion('ab')).toBe('Usa al menos 3 caracteres');
    expect(errorDeDireccion('a'.repeat(41))).toBe('Usa 40 caracteres como máximo');
    expect(errorDeDireccion('carta')).toBe('Esa dirección está reservada. Elige otra');
    expect(errorDeDireccion('Sabor')).toMatch(/minúsculas/);
    expect(errorDeDireccion('sabor_norteno')).toMatch(/guiones entre palabras/);
    expect(errorDeDireccion('sabor--norteno')).toMatch(/guiones entre palabras/);
  });

  it('escribir la dirección pasa a minúsculas y cambia los espacios por guiones', () => {
    expect(direccionEscrita('Sabor Norteño')).toBe('sabor-norteño');
    expect(direccionEscrita('mi carta')).toBe('mi-carta');
  });
});

describe('color', () => {
  it('agrega el # y pasa a mayúsculas lo que se escribe', () => {
    expect(colorEscrito('ffd400')).toBe('#FFD400');
    expect(colorEscrito(' #1d4a9e ')).toBe('#1D4A9E');
    expect(colorEscrito('')).toBe('');
  });

  it('un color con buen contraste no se toca; uno claro se oscurece (cálculo de packages/dominio)', () => {
    const bueno = marcaEnLaCarta('#1D4A9E');
    expect(bueno).toMatchObject({ fondo: '#1D4A9E', seOscurecio: false, texto: '#FFFFFF' });
    const claro = marcaEnLaCarta('#FFD400');
    expect(claro?.seOscurecio).toBe(true);
    expect(claro?.fondo).not.toBe('#FFD400');
    expect(Number(claro?.contrasteElegido)).toBeLessThan(4.5);
    expect(Number(claro?.contrasteFinal)).toBeGreaterThanOrEqual(4.5);
    expect(marcaEnLaCarta('#12')).toBeNull();
  });
});

describe('validar y comparar lo escrito', () => {
  it('sin cambios no hay nada que enviar', () => {
    const b = borradorDeCartaWeb(configurada);
    expect(hayCambios(configurada, b)).toBe(false);
    expect(validarCartaWeb(configurada, b)).toEqual({ ok: true, empresa: null, sucursales: [] });
  });

  it('sin configurar, lo escrito es lo que se guarda, y solo se envían las sucursales que se tocaron', () => {
    const vacia: CartaWebRespuesta = {
      ...configurada,
      configurada: false,
      nombre: null,
      slug: null,
      url: null,
      sucursales: configurada.sucursales.map((s) => ({
        ...s,
        slug: null,
        publicada: false,
        url: null,
      })),
    };
    const b = borradorDeCartaWeb(vacia);
    // Sin escribir nada no hay nada que guardar.
    expect(hayCambios(vacia, b)).toBe(false);
    b.nombre = 'Sabor Norteño';
    b.slug = 'sabor-norteno';
    b.sucursales[0] = { ...b.sucursales[0]!, slug: 'miraflores', publicada: true };
    expect(validarCartaWeb(vacia, b)).toEqual({
      ok: true,
      empresa: { nombre: 'Sabor Norteño', slug: 'sabor-norteno', colorPrincipal: '#1D4A9E' },
      sucursales: [{ sucursalId: SUC, slug: 'miraflores', publicada: true }],
    });
  });

  it('rechaza lo que la API rechazaría, con un mensaje por campo', () => {
    const b = borradorDeCartaWeb(configurada);
    b.nombre = '   ';
    b.slug = 'api';
    b.colorPrincipal = '#12';
    const r = validarCartaWeb(configurada, b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.nombre).toBe('Escribe el nombre que verán tus clientes');
      expect(r.errores.slug).toBe('Esa dirección está reservada. Elige otra');
      expect(r.errores.colorPrincipal).toMatch(/#RRGGBB/);
    }
  });

  it('una sucursal sin dirección que no se publica se deja como está; publicarla pide la dirección', () => {
    const b = borradorDeCartaWeb(configurada);
    expect(validarCartaWeb(configurada, b).ok).toBe(true);
    b.sucursales[1] = { ...b.sucursales[1]!, publicada: true };
    const r = validarCartaWeb(configurada, b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.sucursales[SUC_B]).toBe(
        'Escribe la dirección de esta sucursal para publicarla',
      );
    }
  });

  it('dos sucursales con la misma dirección (sin importar mayúsculas) no pasan', () => {
    const b = borradorDeCartaWeb(configurada);
    b.sucursales[1] = { ...b.sucursales[1]!, slug: 'miraflores' };
    const r = validarCartaWeb(configurada, b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.sucursales[SUC_B]).toMatch(/Miraflores ya usa esa dirección/);
  });
});

describe('preparar el logo', () => {
  const imagen = (ancho: number, alto: number) => ({
    ancho,
    alto,
    origen: {} as CanvasImageSource,
    liberar: vi.fn(),
  });
  const motor = (ancho: number, alto: number, tamanoReducido = 100_000): MotorDeImagen => ({
    decodificar: vi.fn(async () => imagen(ancho, alto)),
    codificar: vi.fn(
      async () => new Blob([new Uint8Array(tamanoReducido)], { type: 'image/jpeg' }),
    ),
  });
  const png = (peso: number) => new Blob([new Uint8Array(peso)], { type: 'image/png' });

  it('un logo que ya cumple se sube tal cual, para no perder la transparencia', async () => {
    const original = png(40_000);
    const m = motor(400, 400);
    expect(await prepararLogo(original, m)).toBe(original);
    expect(m.codificar).not.toHaveBeenCalled();
  });

  it('uno muy pequeño ni se sube: el mensaje dice qué hacer', async () => {
    await expect(prepararLogo(png(1000), motor(32, 32))).rejects.toMatchObject({
      motivo: 'MUY_PEQUENA',
    });
    await expect(prepararLogo(png(1000), motor(32, 32))).rejects.toBeInstanceOf(ErrorDeFoto);
  });

  it('uno demasiado grande se reduce a 1024 px de lado mayor', async () => {
    const m = motor(4000, 3000);
    const reducido = await prepararLogo(png(900_000), m);
    expect(reducido.type).toBe('image/jpeg');
    expect(m.codificar).toHaveBeenCalledWith(expect.anything(), 1024, 768, expect.any(Number));
  });

  it('uno que pesa más de 1 MB se reduce aunque mida poco', async () => {
    const m = motor(1500, 1500);
    await prepararLogo(png(2_000_000), m);
    expect(m.codificar).toHaveBeenCalledWith(expect.anything(), 1024, 1024, expect.any(Number));
  });

  it('si el navegador no lo puede leer pero la API lo aceptaría por tipo y peso, lo deja pasar', async () => {
    const original = png(40_000);
    const m: MotorDeImagen = {
      decodificar: vi.fn(async () => {
        throw new Error('no se pudo');
      }),
      codificar: vi.fn(),
    };
    expect(await prepararLogo(original, m)).toBe(original);
    const heic = new Blob([new Uint8Array(1000)], { type: 'image/heic' });
    await expect(prepararLogo(heic, m)).rejects.toMatchObject({ motivo: 'NO_SE_PUDO_LEER' });
  });

  it('uno demasiado alargado se rechaza', async () => {
    await expect(prepararLogo(png(2_000_000), motor(8000, 100))).rejects.toMatchObject({
      motivo: 'FORMA_NO_VALIDA',
    });
  });
});
