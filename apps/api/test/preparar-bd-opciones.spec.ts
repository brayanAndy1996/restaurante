import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { prepararBaseDeDatos } from '../scripts/lib/preparar-bd';
import { urlAdminDeMantenimiento } from '../scripts/lib/roles';
import { urlDeRol } from './utilidades';

// Pruebas del desarrollador (no protegidas) de dos detalles de `prepararBaseDeDatos`.

describe('base de mantenimiento del administrador', () => {
  it('es la de DATABASE_ADMIN_URL; postgres si no nombra una o nombra la de destino', () => {
    const url = 'postgres://doadmin:clave@host:25060/defaultdb?sslmode=require';
    expect(urlAdminDeMantenimiento(url, 'restaurante')).toBe(url);
    expect(urlAdminDeMantenimiento('postgres://u:p@h:5432/postgres', 'restaurante')).toBe(
      'postgres://u:p@h:5432/postgres',
    );
    expect(urlAdminDeMantenimiento('postgres://u:p@h:5432', 'restaurante')).toBe(
      'postgres://u:p@h:5432/postgres',
    );
    expect(urlAdminDeMantenimiento('postgres://u:p@h:5432/restaurante', 'restaurante')).toBe(
      'postgres://u:p@h:5432/postgres',
    );
  });
});

describe('bloqueo asesor de db:preparar', () => {
  it('si otra preparación lo tiene, falla con un mensaje claro cuando vence la espera', async () => {
    const otro = new Client({ connectionString: urlDeRol('admin', 'postgres') });
    otro.on('error', () => undefined);
    await otro.connect();
    try {
      await otro.query("SELECT pg_advisory_lock(hashtext('restaurante:preparar-bd'))");
      const baseDeDatos = `rest_bloqueo_${randomBytes(3).toString('hex')}`;
      const inicio = Date.now();
      await expect(
        prepararBaseDeDatos({
          baseDeDatos,
          env: { ...process.env, NODE_ENV: 'test' },
          esperaBloqueoMs: 400,
        }),
      ).rejects.toThrow(/No se obtuvo el bloqueo de preparación en 0\.4 s.*db:preparar/);
      expect(Date.now() - inicio).toBeLessThan(10_000);
    } finally {
      await otro.end();
    }
  });
});
