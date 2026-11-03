import { describe, expect, it } from 'vitest';
import {
  CARTA_WEB_URL_LOCAL,
  EntornoInvalidoError,
  cargarEntorno,
  exigirEntornoDeProduccion,
} from '../src/config/entorno';

// Variables de entorno de la historia 005 (T3): `CARTA_WEB_URL` y `CABECERA_IP_CLIENTE`. No es una prueba protegida.

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
  DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
};

const baseProduccion = {
  ...base,
  NODE_ENV: 'production',
  PIN_PEPPER: Buffer.alloc(32, 7).toString('base64'),
  ORIGENES_PERMITIDOS: 'https://app.ejemplo.pe',
  ARCHIVOS_DRIVER: 'r2',
  ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe',
  R2_ACCOUNT_ID: 'x',
  R2_ACCESS_KEY_ID: 'x',
  R2_SECRET_ACCESS_KEY: 'x',
  R2_BUCKET: 'x',
};

describe('CARTA_WEB_URL', () => {
  it('con development y test vale http://localhost:3001 si no se define', () => {
    expect(CARTA_WEB_URL_LOCAL).toBe('http://localhost:3001');
    expect(cargarEntorno(base).CARTA_WEB_URL).toBe('http://localhost:3001');
    expect(cargarEntorno({ ...base, NODE_ENV: 'test' }).CARTA_WEB_URL).toBe(
      'http://localhost:3001',
    );
  });

  it('en producción puede faltar y la API arranca igual (solo avisa)', () => {
    const entorno = cargarEntorno(baseProduccion);
    expect(entorno.CARTA_WEB_URL).toBeUndefined();
    expect(() => exigirEntornoDeProduccion(entorno)).not.toThrow();
  });

  it('una variable vacía es lo mismo que una ausente', () => {
    expect(cargarEntorno({ ...baseProduccion, CARTA_WEB_URL: '' }).CARTA_WEB_URL).toBeUndefined();
  });

  it('usa el valor definido y le quita las barras finales', () => {
    expect(
      cargarEntorno({ ...baseProduccion, CARTA_WEB_URL: 'https://carta.ejemplo.pe/' })
        .CARTA_WEB_URL,
    ).toBe('https://carta.ejemplo.pe');
    expect(cargarEntorno({ ...base, CARTA_WEB_URL: 'http://localhost:4000' }).CARTA_WEB_URL).toBe(
      'http://localhost:4000',
    );
  });

  it('rechaza lo que no es una URL http(s)', () => {
    for (const mala of ['carta.ejemplo.pe', 'ftp://carta.ejemplo.pe', 'no es una url']) {
      expect(() => cargarEntorno({ ...base, CARTA_WEB_URL: mala }), mala).toThrow(
        EntornoInvalidoError,
      );
      expect(() => cargarEntorno({ ...base, CARTA_WEB_URL: mala }), mala).toThrow(/CARTA_WEB_URL/);
    }
  });
});

describe('CABECERA_IP_CLIENTE', () => {
  it('sin definir es undefined (se usa la IP de la conexión), también en producción', () => {
    expect(cargarEntorno(base).CABECERA_IP_CLIENTE).toBeUndefined();
    expect(cargarEntorno(baseProduccion).CABECERA_IP_CLIENTE).toBeUndefined();
  });

  it('se guarda en minúsculas', () => {
    expect(
      cargarEntorno({ ...base, CABECERA_IP_CLIENTE: 'CF-Connecting-IP' }).CABECERA_IP_CLIENTE,
    ).toBe('cf-connecting-ip');
  });

  it('rechaza lo que no es el nombre de una cabecera', () => {
    for (const mala of ['cf connecting ip', 'cf_connecting_ip', 'x:y', '-x', 'cabecera/ip']) {
      expect(() => cargarEntorno({ ...base, CABECERA_IP_CLIENTE: mala }), mala).toThrow(
        /CABECERA_IP_CLIENTE/,
      );
    }
  });
});
