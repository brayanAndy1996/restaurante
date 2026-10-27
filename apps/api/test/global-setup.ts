import { prepararBaseDeDatos } from '../scripts/lib/preparar-bd';
import { migrarArriba } from '../scripts/lib/migraciones';
import { BASE_DE_PRUEBA, urlDeRol } from './utilidades/bd';

/**
 * Preparación global de las pruebas de integración (una vez por ejecución):
 * roles idempotentes, base `restaurante_test` nueva (dueño: restaurante_migrador) con sus
 * permisos y las migraciones aplicadas como migrador. Exige DATABASE_ADMIN_URL.
 */
export default async function preparar(): Promise<void> {
  if (!process.env.DATABASE_ADMIN_URL) {
    throw new Error(
      'Las pruebas de integración de la API necesitan DATABASE_ADMIN_URL (un usuario administrador de ' +
        'PostgreSQL 16), por ejemplo: DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres ' +
        'pnpm test. No se saltan en silencio.',
    );
  }
  // NODE_ENV=test explícito: las contraseñas por defecto solo valen así (criterio 29b), y un proceso
  // de prueba puede haberlo recibido vacío o con otro valor.
  await prepararBaseDeDatos({
    baseDeDatos: BASE_DE_PRUEBA,
    recrear: true,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  await migrarArriba(urlDeRol('migrador'));
}
