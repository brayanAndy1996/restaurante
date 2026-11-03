import { describe, expect, it } from 'vitest';
import { problemaConIpLocal } from '../lib/imagenes';

// `IMAGENES_PERMITIR_IP_LOCAL=1` solo se acepta con direcciones locales: en producción abriría el servidor de Next a
// pedir imágenes de la red interna.
describe('problemaConIpLocal', () => {
  it('sin la variable (o con otro valor) no hay nada que comprobar', () => {
    expect(problemaConIpLocal({ CARTA_WEB_URL: 'https://carta.ejemplo.pe' })).toBeNull();
    expect(
      problemaConIpLocal({
        IMAGENES_PERMITIR_IP_LOCAL: '0',
        CARTA_WEB_URL: 'https://carta.ejemplo.pe',
      }),
    ).toBeNull();
  });

  it('con direcciones locales (o ninguna) se acepta', () => {
    expect(problemaConIpLocal({ IMAGENES_PERMITIR_IP_LOCAL: '1' })).toBeNull();
    expect(
      problemaConIpLocal({
        IMAGENES_PERMITIR_IP_LOCAL: '1',
        CARTA_WEB_URL: 'http://localhost:3001',
        ARCHIVOS_URL_PUBLICA: 'http://127.0.0.1:3100/archivos',
      }),
    ).toBeNull();
  });

  it('con la carta en un dominio público se rechaza y dice por qué', () => {
    const problema = problemaConIpLocal({
      IMAGENES_PERMITIR_IP_LOCAL: '1',
      CARTA_WEB_URL: 'https://carta.ejemplo.pe',
    });
    expect(problema).toContain('CARTA_WEB_URL');
    expect(problema).toContain('IMAGENES_PERMITIR_IP_LOCAL');
  });

  it('con los archivos en un dominio público (el bucket) se rechaza', () => {
    expect(
      problemaConIpLocal({
        IMAGENES_PERMITIR_IP_LOCAL: '1',
        CARTA_WEB_URL: 'http://localhost:3001',
        ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe/archivos',
      }),
    ).toContain('ARCHIVOS_URL_PUBLICA');
  });

  it('un nombre que solo empieza como localhost, o una dirección ilegible, se rechaza', () => {
    for (const valor of ['http://localhost.ejemplo.pe', 'no es una url']) {
      expect(
        problemaConIpLocal({ IMAGENES_PERMITIR_IP_LOCAL: '1', CARTA_WEB_URL: valor }),
      ).not.toBeNull();
    }
  });
});
