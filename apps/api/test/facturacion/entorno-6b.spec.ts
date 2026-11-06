import { describe, expect, it } from 'vitest';
import {
  CLAVE_CIFRADO_LOCAL,
  EntornoInvalidoError,
  PADRON_RUC_URL_POR_DEFECTO,
  cargarEntorno,
  exigirEntornoDeProduccion,
} from '../../src/config/entorno';

// Pruebas del desarrollador (no protegidas) de las variables de entorno de 6b (historia 006, "Variables de entorno
// nuevas").

const base = {
  DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
  DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
};

const produccion = {
  ...base,
  NODE_ENV: 'production',
  PIN_PEPPER: Buffer.alloc(32, 7).toString('base64'),
  ORIGENES_PERMITIDOS: 'https://app.ejemplo.pe',
  ARCHIVOS_DRIVER: 'r2',
  ARCHIVOS_URL_PUBLICA: 'https://fotos.ejemplo.pe',
  R2_ACCOUNT_ID: 'x',
  R2_ACCESS_KEY_ID: 'x',
  R2_SECRET_ACCESS_KEY: 'x',
  R2_BUCKET: 'fotos',
  R2_BUCKET_COMPROBANTES: 'comprobantes',
  CLAVE_CIFRADO: Buffer.alloc(32, 3).toString('base64'),
  DATABASE_COLAS_URL: 'postgres://restaurante_colas:x@localhost:5432/restaurante_test',
  PSE_CONECTOR: 'simulador',
};

describe('valores por defecto', () => {
  it('con development y test: simulador, clave de desarrollo, worker apagado, 30 s y el padrón de SUNAT', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const entorno = cargarEntorno({ ...base, NODE_ENV });
      expect(entorno.PSE_CONECTOR).toBe('simulador');
      expect(entorno.PSE_TIMEOUT_MS).toBe(30_000);
      expect(entorno.CLAVE_CIFRADO).toBe(CLAVE_CIFRADO_LOCAL);
      expect(Buffer.from(CLAVE_CIFRADO_LOCAL, 'base64').length).toBeGreaterThanOrEqual(32);
      expect(entorno.WORKER).toBe('deshabilitado');
      expect(entorno.PADRON_RUC_URL).toBe(PADRON_RUC_URL_POR_DEFECTO);
      expect(entorno.ARCHIVOS_COMPROBANTES_DIRECTORIO).toBe('./archivos-privados');
      expect(entorno.DATABASE_COLAS_URL).toBeUndefined();
      expect(entorno.DATABASE_REFERENCIA_URL).toBeUndefined();
    }
  });

  it('en producción el conector y la clave pueden faltar al leer el entorno', () => {
    const entorno = cargarEntorno({ ...base, NODE_ENV: 'production' });
    expect(entorno.PSE_CONECTOR).toBeUndefined();
    expect(entorno.CLAVE_CIFRADO).toBeUndefined();
  });
});

describe('WORKER', () => {
  it('habilitado solo vale fuera de las pruebas: con NODE_ENV=test siempre queda deshabilitado', () => {
    expect(cargarEntorno({ ...base, NODE_ENV: 'development', WORKER: 'habilitado' }).WORKER).toBe(
      'habilitado',
    );
    expect(cargarEntorno({ ...produccion, WORKER: 'habilitado' }).WORKER).toBe('habilitado');
    expect(cargarEntorno({ ...base, NODE_ENV: 'test', WORKER: 'habilitado' }).WORKER).toBe(
      'deshabilitado',
    );
  });

  it('rechaza un valor desconocido', () => {
    expect(() => cargarEntorno({ ...base, NODE_ENV: 'development', WORKER: 'si' })).toThrow(
      /WORKER/,
    );
  });
});

describe('validación de formato', () => {
  it('CLAVE_CIFRADO y CLAVE_CIFRADO_ANTERIOR: base64 de 32 bytes o más', () => {
    for (const variable of ['CLAVE_CIFRADO', 'CLAVE_CIFRADO_ANTERIOR']) {
      expect(() =>
        cargarEntorno({
          ...base,
          NODE_ENV: 'development',
          [variable]: Buffer.alloc(31).toString('base64'),
        }),
      ).toThrow(new RegExp(`${variable}: debe estar en base64`));
      expect(() => cargarEntorno({ ...base, NODE_ENV: 'development', [variable]: '***' })).toThrow(
        EntornoInvalidoError,
      );
      expect(() =>
        cargarEntorno({
          ...base,
          NODE_ENV: 'development',
          [variable]: Buffer.alloc(32).toString('base64'),
        }),
      ).not.toThrow();
    }
  });

  it('PSE_TIMEOUT_MS entre 1 s y 120 s; PSE_CONECTOR en minúsculas', () => {
    const dev = { ...base, NODE_ENV: 'development' };
    expect(cargarEntorno({ ...dev, PSE_TIMEOUT_MS: '5000' }).PSE_TIMEOUT_MS).toBe(5000);
    for (const malo of ['500', '200000', 'abc', '1.5']) {
      expect(() => cargarEntorno({ ...dev, PSE_TIMEOUT_MS: malo }), malo).toThrow(
        EntornoInvalidoError,
      );
    }
    expect(() => cargarEntorno({ ...dev, PSE_CONECTOR: 'Nubefact' })).toThrow(/PSE_CONECTOR/);
    expect(cargarEntorno({ ...dev, PSE_CONECTOR: 'nubefact' }).PSE_CONECTOR).toBe('nubefact');
  });

  it('las URL de la cola y del padrón; PADRON_RUC_URL admite file://', () => {
    const dev = { ...base, NODE_ENV: 'development' };
    expect(() => cargarEntorno({ ...dev, DATABASE_COLAS_URL: 'http://x' })).toThrow(
      /DATABASE_COLAS_URL/,
    );
    expect(() => cargarEntorno({ ...dev, DATABASE_REFERENCIA_URL: 'x' })).toThrow(
      /DATABASE_REFERENCIA_URL/,
    );
    expect(cargarEntorno({ ...dev, PADRON_RUC_URL: 'file:///tmp/padron.zip' }).PADRON_RUC_URL).toBe(
      'file:///tmp/padron.zip',
    );
    expect(() => cargarEntorno({ ...dev, PADRON_RUC_URL: 'ftp://x/padron.zip' })).toThrow(
      /PADRON_RUC_URL/,
    );
  });

  it('R2_BUCKET_COMPROBANTES es obligatoria con r2 y no puede ser el bucket público', () => {
    const sin: Record<string, string> = { ...produccion };
    delete sin.R2_BUCKET_COMPROBANTES;
    expect(() => cargarEntorno(sin)).toThrow(/R2_BUCKET_COMPROBANTES es obligatoria/);
    expect(() => cargarEntorno({ ...produccion, R2_BUCKET_COMPROBANTES: 'fotos' })).toThrow(
      /bucket distinto/,
    );
  });

  describe('con el almacén en disco la carpeta de los comprobantes no queda dentro de la que sirve /archivos', () => {
    const desarrollo = { ...base, NODE_ENV: 'development' };
    const conCarpetas = (publica?: string, privada?: string) => ({
      ...desarrollo,
      ...(publica === undefined ? {} : { ARCHIVOS_DIRECTORIO: publica }),
      ...(privada === undefined ? {} : { ARCHIVOS_COMPROBANTES_DIRECTORIO: privada }),
    });

    it('los valores por defecto (hermanas) y carpetas separadas pasan', () => {
      expect(() => cargarEntorno(desarrollo)).not.toThrow();
      expect(() => cargarEntorno(conCarpetas('/datos/fotos', '/datos/privado'))).not.toThrow();
      expect(() =>
        cargarEntorno(conCarpetas('/datos/fotos', '/datos/fotos-privadas')),
      ).not.toThrow();
      expect(() => cargarEntorno(conCarpetas('./archivos', './archivos-privados'))).not.toThrow();
    });

    it.each([
      ['la misma carpeta', '/datos/fotos', '/datos/fotos'],
      ['una subcarpeta', '/datos/fotos', '/datos/fotos/privado'],
      [
        'una subcarpeta con rutas relativas y ..',
        './archivos',
        './archivos/../archivos/comprobantes',
      ],
      [
        'la carpeta por defecto de las fotos con otra raíz privada dentro',
        undefined,
        './archivos/privado',
      ],
    ])('rechaza %s', (_nombre, publica, privada) => {
      expect(() => cargarEntorno(conCarpetas(publica, privada))).toThrow(
        /ARCHIVOS_COMPROBANTES_DIRECTORIO no puede ser ARCHIVOS_DIRECTORIO ni estar dentro/,
      );
    });

    it('con memoria (pruebas) no se exige: no se sirve ninguna carpeta', () => {
      expect(() =>
        cargarEntorno({
          ...base,
          NODE_ENV: 'test',
          ARCHIVOS_DIRECTORIO: '/datos/fotos',
          ARCHIVOS_COMPROBANTES_DIRECTORIO: '/datos/fotos/privado',
        }),
      ).not.toThrow();
    });
  });
});

describe('exigirEntornoDeProduccion', () => {
  it('con todo lo de 6b no se queja', () => {
    expect(() => exigirEntornoDeProduccion(cargarEntorno(produccion))).not.toThrow();
  });

  it.each(['CLAVE_CIFRADO', 'DATABASE_COLAS_URL', 'PSE_CONECTOR'])(
    'sin %s la API no arranca en producción',
    (faltante) => {
      const env: Record<string, string> = { ...produccion };
      delete env[faltante];
      expect(() => exigirEntornoDeProduccion(cargarEntorno(env))).toThrow(
        new RegExp(`${faltante} es obligatoria en producción`),
      );
    },
  );

  it('lista todo lo que falta de una vez', () => {
    const env: Record<string, string> = { ...produccion };
    for (const k of ['CLAVE_CIFRADO', 'DATABASE_COLAS_URL', 'PSE_CONECTOR']) delete env[k];
    try {
      exigirEntornoDeProduccion(cargarEntorno(env));
      throw new Error('debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(EntornoInvalidoError);
      expect((error as EntornoInvalidoError).problemas).toHaveLength(3);
    }
  });
});
