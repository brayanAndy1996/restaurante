import { Client } from 'pg';
import {
  ROLES,
  exigirUrlAdmin,
  urlAdminParaBase,
  urlParaRol,
  type RolConUrl,
} from '../../scripts/lib/roles';

/** Base de datos de las pruebas de integración (se recrea en cada ejecución). */
export const BASE_DE_PRUEBA = process.env.BASE_DE_PRUEBA ?? 'restaurante_test';

/** `admin` es el administrador de `DATABASE_ADMIN_URL`; los demás son los roles de la aplicación. */
export type RolDePrueba = RolConUrl | 'admin';

/** Nombres de los roles de PostgreSQL (`restaurante_migrador`, `restaurante_api`, `restaurante_plataforma`, `restaurante_tiempo_real`). */
export const NOMBRES_DE_ROLES = ROLES;

/** URL de `restaurante_test` para un rol. Lanza un error claro si falta `DATABASE_ADMIN_URL`. */
export function urlDeRol(rol: RolDePrueba, baseDeDatos: string = BASE_DE_PRUEBA): string {
  const admin = exigirUrlAdmin();
  if (rol === 'admin') return urlAdminParaBase(admin, baseDeDatos);
  // NODE_ENV=test: un proceso de prueba puede haber fijado NODE_ENV=production, que exige DB_PASSWORD_*.
  return urlParaRol(admin, rol, baseDeDatos, { ...process.env, NODE_ENV: 'test' });
}

/** Las cinco URL de `restaurante_test`. */
export function urlsDePrueba(): Record<RolDePrueba, string> {
  return {
    admin: urlDeRol('admin'),
    migrador: urlDeRol('migrador'),
    api: urlDeRol('api'),
    plataforma: urlDeRol('plataforma'),
    tiempoReal: urlDeRol('tiempoReal'),
  };
}

/**
 * Abre un cliente `pg` ya conectado a `restaurante_test` con el rol indicado. Quien lo abre debe
 * cerrarlo con `await cliente.end()`. Los errores de conexión inesperados no tumban el proceso.
 */
export async function abrirCliente(
  rol: RolDePrueba,
  baseDeDatos: string = BASE_DE_PRUEBA,
): Promise<Client> {
  const cliente = new Client({ connectionString: urlDeRol(rol, baseDeDatos) });
  cliente.on('error', () => undefined);
  await cliente.connect();
  return cliente;
}

/** Abre un cliente, ejecuta `fn` y lo cierra siempre. */
export async function conCliente<T>(
  rol: RolDePrueba,
  fn: (cliente: Client) => Promise<T>,
): Promise<T> {
  const cliente = await abrirCliente(rol);
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}
