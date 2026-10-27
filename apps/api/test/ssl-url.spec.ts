import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { crearSequelize } from '../src/nucleo/base-de-datos/crear-sequelize';
import { urlAdminParaBase, urlParaRol } from '../scripts/lib/roles';

// Prueba del desarrollador (no protegida): TLS en producción administrada. La API (Sequelize) y los
// scripts (`pg`) toman el `sslmode` de la propia URL, y las URL de los roles derivadas de
// `DATABASE_ADMIN_URL` lo conservan.

const BASE = 'postgres://doadmin:clave@host.db.ondigitalocean.com:25060/defaultdb';

function sslDeSequelize(url: string): unknown {
  const sequelize = crearSequelize({ url, poolMax: 1, aplicacion: 'prueba-ssl' });
  return (sequelize as unknown as { options: { dialectOptions: { ssl?: unknown } } }).options
    .dialectOptions.ssl;
}

function sslDePg(url: string): unknown {
  return (
    new Client({ connectionString: url }) as unknown as { connectionParameters: { ssl: unknown } }
  ).connectionParameters.ssl;
}

describe('sslmode en las URL de conexión', () => {
  it('sin sslmode no hay TLS (desarrollo local)', () => {
    expect(sslDeSequelize(BASE)).toBeUndefined();
    expect(sslDePg(BASE)).toBe(false);
  });

  it('sslmode=disable lo apaga explícitamente', () => {
    expect(sslDeSequelize(`${BASE}?sslmode=disable`)).toBe(false);
    expect(sslDePg(`${BASE}?sslmode=disable`)).toBe(false);
  });

  it('sslmode=verify-full activa TLS con verificación del certificado', () => {
    for (const ssl of [
      sslDeSequelize(`${BASE}?sslmode=verify-full`),
      sslDePg(`${BASE}?sslmode=verify-full`),
    ]) {
      expect(ssl).toEqual({});
    }
  });

  it('sslmode=require con uselibpqcompat=true cifra sin verificar el certificado', () => {
    const url = `${BASE}?sslmode=require&uselibpqcompat=true`;
    expect(sslDeSequelize(url)).toEqual({ rejectUnauthorized: false });
    expect(sslDePg(url)).toEqual({ rejectUnauthorized: false });
  });

  it('las URL de los roles derivadas del administrador conservan el sslmode', () => {
    const admin = `${BASE}?sslmode=verify-full`;
    const env = { ...process.env, NODE_ENV: 'test' };
    expect(new URL(urlParaRol(admin, 'api', 'restaurante', env)).searchParams.get('sslmode')).toBe(
      'verify-full',
    );
    expect(new URL(urlAdminParaBase(admin, 'restaurante')).searchParams.get('sslmode')).toBe(
      'verify-full',
    );
  });
});
