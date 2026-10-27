// pnpm db:preparar [baseDeDatos]  (por defecto: la de DATABASE_URL o, si no está definida, restaurante).
// Idempotente.
import { cargarEnvDeLaRaiz } from '../src/config/cargar-env';
import { prepararBaseDeDatos } from './lib/preparar-bd';
import { baseDeDatosDelEntorno } from './lib/roles';

async function main() {
  cargarEnvDeLaRaiz();
  const baseDeDatos = process.argv[2] ?? baseDeDatosDelEntorno();
  await prepararBaseDeDatos({ baseDeDatos, registrar: (mensaje) => console.log(mensaje) });
  console.log('Preparación de la base de datos terminada.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
