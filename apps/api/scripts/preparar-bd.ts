// pnpm db:preparar [baseDeDatos]  (por defecto: restaurante). Idempotente.
import { cargarEnvDeLaRaiz } from '../src/config/cargar-env';
import { prepararBaseDeDatos } from './lib/preparar-bd';
import { BASE_DE_DATOS_POR_DEFECTO } from './lib/roles';

async function main() {
  cargarEnvDeLaRaiz();
  const baseDeDatos = process.argv[2] ?? BASE_DE_DATOS_POR_DEFECTO;
  await prepararBaseDeDatos({ baseDeDatos, registrar: (mensaje) => console.log(mensaje) });
  console.log('Preparación de la base de datos terminada.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
