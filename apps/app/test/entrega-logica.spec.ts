import { describe, expect, it } from 'vitest';
import {
  AVISO_PDF_PENDIENTE,
  AVISO_PDF_PREPARANDO,
  avisoDeDisponibilidad,
  celularParaWhatsApp,
  direccionDeWhatsApp,
  mensajeDeFalloDelPdf,
  textoParaWhatsApp,
} from '../src/modulos/facturacion/compartir';
import { ErrorApi } from '../src/lib/errores';

// spec: 006-caja-cobro, criterio 161 (pruebas no protegidas del texto, el celular y la dirección de WhatsApp).

const boleta = {
  tipo: 'BOLETA' as const,
  numero: 'B001-00000124',
  emisor: { razonSocial: 'Cevichería Sol S.A.C.' },
  totales: { total: '69.20' },
};

describe('El mensaje de WhatsApp (criterio 161)', () => {
  it('dice el tipo, el número, el emisor, el total y el enlace', () => {
    expect(textoParaWhatsApp(boleta, 'https://api.ejemplo.pe/publico/comprobantes/abc')).toBe(
      'Tu BOLETA B001-00000124 de Cevichería Sol S.A.C. por S/ 69.20: https://api.ejemplo.pe/publico/comprobantes/abc',
    );
  });

  it('la factura y la nota de crédito llevan su propio título', () => {
    expect(textoParaWhatsApp({ ...boleta, tipo: 'FACTURA', numero: 'F001-00000030' }, 'u')).toMatch(
      /^Tu FACTURA F001-00000030 /,
    );
    expect(
      textoParaWhatsApp({ ...boleta, tipo: 'NOTA_CREDITO_BOLETA', numero: 'BC01-00000002' }, 'u'),
    ).toMatch(/^Tu NOTA DE CRÉDITO BC01-00000002 /);
  });

  it('el total lleva miles y dos decimales, con un espacio normal', () => {
    expect(textoParaWhatsApp({ ...boleta, totales: { total: '1234.5' } }, 'u')).toContain(
      'por S/ 1,234.50: u',
    );
  });
});

describe('El celular de WhatsApp (criterio 161)', () => {
  it('vacío es «sin celular»', () => {
    expect(celularParaWhatsApp('')).toEqual({ numero: null });
    expect(celularParaWhatsApp('   ')).toEqual({ numero: null });
  });

  it.each([
    ['987654321', '51987654321'],
    ['987 654 321', '51987654321'],
    ['987-654-321', '51987654321'],
    ['+51 987 654 321', '51987654321'],
    ['51987654321', '51987654321'],
    ['(987) 654.321', '51987654321'],
  ])('«%s» vale', (escrito, esperado) => {
    expect(celularParaWhatsApp(escrito)).toEqual({ numero: esperado });
  });

  it.each([
    '12345',
    '887654321',
    '98765432',
    '9876543210',
    'abcdefghi',
    '+34987654321',
    '5198765432',
  ])('«%s» se rechaza', (escrito) => {
    expect(celularParaWhatsApp(escrito)).toBeNull();
  });
});

describe('La dirección de wa.me (criterio 161)', () => {
  it('con celular lleva 51 y el texto codificado', () => {
    expect(direccionDeWhatsApp('Hola & chau: ñ', '51987654321')).toBe(
      'https://wa.me/51987654321?text=Hola%20%26%20chau%3A%20%C3%B1',
    );
  });

  it('sin celular deja elegir el contacto', () => {
    expect(direccionDeWhatsApp('Hola', null)).toBe('https://wa.me/?text=Hola');
  });
});

describe('El aviso de disponibilidad del PDF (criterio 159)', () => {
  it('antes de que SUNAT acepte dice que estará listo cuando acepte', () => {
    for (const estado of ['POR_ENVIAR', 'ENVIADO', 'RECHAZADO'] as const) {
      expect(avisoDeDisponibilidad({ estado })).toBe(AVISO_PDF_PENDIENTE);
    }
  });

  it('un aceptado sin PDF todavía dice que se está preparando; con PDF o sin dato, nada', () => {
    expect(avisoDeDisponibilidad({ estado: 'ACEPTADO', pdfDisponible: false })).toBe(
      AVISO_PDF_PREPARANDO,
    );
    expect(avisoDeDisponibilidad({ estado: 'ACEPTADO', pdfDisponible: true })).toBeNull();
    expect(avisoDeDisponibilidad({ estado: 'ACEPTADO' })).toBeNull();
    expect(avisoDeDisponibilidad({ estado: 'ANULADO', pdfDisponible: true })).toBeNull();
  });

  it('el mensaje del 409 de la API es el que se muestra', () => {
    const error = new ErrorApi({
      estado: 409,
      codigo: 'PDF_NO_DISPONIBLE',
      mensaje: 'El PDF se está preparando; inténtalo de nuevo en un minuto',
    });
    expect(mensajeDeFalloDelPdf(error)).toBe(
      'El PDF se está preparando; inténtalo de nuevo en un minuto',
    );
  });
});
