// Entorno de los scripts que usan la API o la conexión de plataforma (semilla, `plataforma:superadmin`):
// carga el `.env` de la raíz y, si faltan, deriva las URL de la aplicación de `DATABASE_ADMIN_URL`
// (roles de la aplicación, base `restaurante`).
import { cargarEnvDeLaRaiz } from '../../src/config/cargar-env';
import { BASE_DE_DATOS_POR_DEFECTO, urlParaRol } from './roles';

export function prepararEntornoDeScript(): void {
  cargarEnvDeLaRaiz();
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!admin) return;
  process.env.DATABASE_URL ??= urlParaRol(admin, 'api', BASE_DE_DATOS_POR_DEFECTO);
  process.env.DATABASE_PLATAFORMA_URL ??= urlParaRol(
    admin,
    'plataforma',
    BASE_DE_DATOS_POR_DEFECTO,
  );
}
